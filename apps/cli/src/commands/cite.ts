// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getDb, getItems, getLibraries } from '../modules.js';
import { symbols } from '@zotero-headless/core';
import { eq, and } from 'drizzle-orm';

export const citeCommands: Command[] = [
  // ============ Citation/Bibliography Export ============

  {
    name: 'cite',
    aliases: ['citation', 'bibliography', 'bib'],
    description: 'Generate citations and bibliography using CSL (Citation Style Language)',
    options: [
      { name: '--style', alias: '-s', description: 'Citation style (apa, vancouver, harvard)', value: '<style>' },
      { name: '--format', alias: '-f', description: 'Output format (text, html, bibtex)', value: '<format>' },
      { name: '--output', alias: '-o', description: 'Output file', value: '<path>' },
      { name: '--item', alias: '-i', description: 'Get citation for specific item', value: '<key>' },
      { name: '--lang', description: 'Locale for citation (e.g. en-US, zh-CN)', value: '<locale>' },
    ],
    examples: [
      'zotero cite ABCD1234',
      'zotero cite ABCD1234 --style apa',
      'zotero cite ABCD1234 --format bibtex',
      'zotero cite --list-styles',
    ],
    execute: async (args) => {
      await initModules();

      const items = getItems();
      const libraries = getLibraries();
      const db = getDb()();
      const library = await db.select().from(libraries).get();

      if (!library) {
        console.log(`${symbols.error} No library found. Run "sync" first.`);
        return;
      }

      const styleIndex = args.indexOf('--style');
      const formatIndex = args.indexOf('--format');
      const outputIndex = args.indexOf('--output');
      const itemIndex = args.indexOf('--item');
      const langIndex = args.indexOf('--lang');
      const listStyles = args.includes('--list-styles');

      // List available styles
      if (listStyles) {
        console.log('Available citation styles (CSL):');
        console.log('  apa        - American Psychological Association (7th ed.)');
        console.log('  vancouver  - Vancouver system');
        console.log('  harvard    - Harvard referencing style');
        console.log('\nOutput formats:');
        console.log('  text       - Plain text (default)');
        console.log('  html       - HTML formatted');
        console.log('  bibtex     - BibTeX format');
        return;
      }

      // Get style and format
      let style = 'apa';
      if (styleIndex >= 0 && args[styleIndex + 1]) {
        style = args[styleIndex + 1].toLowerCase();
      }

      let outputFormat = 'text';
      if (formatIndex >= 0 && args[formatIndex + 1]) {
        outputFormat = args[formatIndex + 1].toLowerCase();
      }

      let locale = 'en-US';
      if (langIndex >= 0 && args[langIndex + 1]) {
        locale = args[langIndex + 1];
      }

      // Map style aliases
      const styleMap: Record<string, string> = {
        'harvard': 'harvard1',
      };
      const templateId = styleMap[style] || style;

      // Find item key from various positions
      let itemKey: string | undefined;
      if (itemIndex >= 0 && args[itemIndex + 1]) {
        itemKey = args[itemIndex + 1];
      } else {
        // Try first non-option argument
        for (const arg of args) {
          if (!arg.startsWith('--') && !arg.startsWith('-') && arg.length > 3) {
            itemKey = arg;
            break;
          }
        }
      }

      if (!itemKey) {
        console.log(`${symbols.error} Please provide an item key`);
        console.log('Usage: zotero cite <key> [--style <style>] [--format <format>]');
        console.log('   Or: zotero cite --item <key>');
        console.log('\nList styles: zotero cite --list-styles');
        return;
      }

      // Get item
      const item = await db.select()
        .from(items)
        .where(and(
          eq(items.key, itemKey),
          eq(items.libraryId, library.id)
        ))
        .get();

      if (!item) {
        console.log(`${symbols.error} Item ${itemKey} not found`);
        return;
      }

      // Parse item data
      const rawJson = JSON.parse(item.rawJson);
      const raw = rawJson.data || rawJson;
      let creators = raw.creators || [];
      if (typeof creators === 'string') {
        try { creators = JSON.parse(creators); } catch { creators = []; }
      }

      // Convert Zotero item to CSL-JSON
      const zoteroToCslType: Record<string, string> = {
        'journalArticle': 'article-journal',
        'book': 'book',
        'bookSection': 'chapter',
        'conferencePaper': 'paper-conference',
        'thesis': 'thesis',
        'report': 'report',
        'webpage': 'webpage',
        'preprint': 'article',
        'patent': 'patent',
        'presentation': 'speech',
        'document': 'document',
        'magazineArticle': 'article-magazine',
        'newspaperArticle': 'article-newspaper',
        'encyclopediaArticle': 'entry-encyclopedia',
        'dictionaryEntry': 'entry-dictionary',
        'film': 'motion_picture',
        'tvBroadcast': 'broadcast',
        'radioBroadcast': 'broadcast',
        'map': 'map',
        'statute': 'legislation',
        'case': 'legal_case',
        'hearing': 'hearing',
        'bill': 'bill',
        'letter': 'personal_communication',
        'email': 'personal_communication',
        'interview': 'interview',
        'blogPost': 'post-weblog',
        'forumPost': 'post',
        'computerProgram': 'software',
        'audioRecording': 'song',
        'videoRecording': 'motion_picture',
        'artwork': 'graphic',
        'manuscript': 'manuscript',
      };

      // Parse date string to CSL date-parts
      function parseDateToCsl(dateStr: string): any {
        if (!dateStr) return undefined;
        // Try ISO or common formats: "2017-8", "2017-08-24", "2017", "August 2017"
        const isoMatch = dateStr.match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/);
        if (isoMatch) {
          const parts: number[] = [parseInt(isoMatch[1])];
          if (isoMatch[2]) parts.push(parseInt(isoMatch[2]));
          if (isoMatch[3]) parts.push(parseInt(isoMatch[3]));
          return { 'date-parts': [parts] };
        }
        return { literal: dateStr };
      }

      // Map Zotero creator types to CSL roles
      function mapCreators(zoteroCreators: any[]): any[] {
        return zoteroCreators.map(c => ({
          family: c.lastName || undefined,
          given: c.firstName || undefined,
          literal: (!c.lastName && !c.firstName && c.name) ? c.name : undefined,
        }));
      }

      const cslItem: any = {
        id: itemKey,
        type: zoteroToCslType[raw.itemType] || 'article',
        title: raw.title || item.title,
        author: mapCreators(creators.filter((c: any) => c.creatorType === 'author')),
        editor: mapCreators(creators.filter((c: any) => c.creatorType === 'editor')),
        issued: parseDateToCsl(raw.date),
        'container-title': raw.publicationTitle || raw.websiteTitle || raw.bookTitle || undefined,
        volume: raw.volume || undefined,
        issue: raw.issue || undefined,
        page: raw.pages || undefined,
        DOI: raw.DOI || undefined,
        URL: raw.url || undefined,
        ISBN: raw.ISBN || undefined,
        ISSN: raw.ISSN || undefined,
        publisher: raw.publisher || undefined,
        'publisher-place': raw.place || undefined,
        abstract: raw.abstractNote || undefined,
        language: raw.language || undefined,
      };

      // Remove undefined values
      for (const key of Object.keys(cslItem)) {
        if (cslItem[key] === undefined) delete cslItem[key];
        if (Array.isArray(cslItem[key]) && cslItem[key].length === 0) delete cslItem[key];
      }

      // Use citation-js for proper CSL formatting
      const { Cite } = await import('@citation-js/core');
      await import('@citation-js/plugin-csl');
      await import('@citation-js/plugin-bibtex');

      const cite = new Cite([cslItem]);
      let citation = '';

      if (outputFormat === 'bibtex') {
        citation = cite.format('bibtex');
      } else if (outputFormat === 'html') {
        citation = cite.format('bibliography', { format: 'html', template: templateId, lang: locale });
      } else {
        citation = cite.format('bibliography', { format: 'text', template: templateId, lang: locale });
      }

      citation = citation.trim();

      // Output
      if (outputIndex >= 0 && args[outputIndex + 1]) {
        const fs = await import('fs');
        fs.writeFileSync(args[outputIndex + 1], citation);
        console.log(`${symbols.success} Citation written to ${args[outputIndex + 1]}`);
      } else {
        console.log(citation);
      }
    }
  },
];
