// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getDb, getItems, getLibraries } from '../modules.js';
import { symbols } from '@zotero-headless/core';
import { eq, and, like, desc, sql } from 'drizzle-orm';
import { htmlToPlainText } from '../note-utils.js';

export const searchCommands: Command[] = [
  {
    name: 'search',
    aliases: ['find', 'grep', 'f'],
    description: 'Search items by keywords',
    options: [
      { name: '--field', alias: '-f', description: 'Search field (title|author|tags|note|all)', value: '<field>' },
      { name: '--since', alias: '-s', description: 'Search items since date', value: '<YYYY-MM-DD>' },
      { name: '--unsynced', alias: '-u', description: 'Search only unsynced items' },
      { name: '--limit', alias: '-l', description: 'Limit number of results', value: '<N>' },
    ],
    examples: [
      'zotero search "machine learning"',
      'zotero grep "Smith" -f author',
      'zotero f "findings" --field note',
    ],
    execute: async (args) => {
      await initModules();

      // Parse options
      const options: {
        query: string;
        field: 'title' | 'author' | 'tags' | 'note' | 'all';
        since?: string;
        unsynced?: boolean;
        limit: number;
      } = {
        field: 'title',
        limit: 20
      };

      const queryParts: string[] = [];

      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--field' || arg === '-f') {
          options.field = args[++i] as any;
        } else if (arg === '--since' || arg === '-s') {
          options.since = args[++i];
        } else if (arg === '--unsynced' || arg === '-u') {
          options.unsynced = true;
        } else if (arg === '--limit' || arg === '-l') {
          options.limit = parseInt(args[++i]) || 20;
        } else if (!arg.startsWith('-')) {
          queryParts.push(arg);
        }
      }

      options.query = queryParts.join(' ');

      if (!options.query) {
        console.log(`${symbols.error} Please provide a search query`);
        console.log('   Usage: zotero search <query> [options]');
        console.log('   Options:');
        console.log('     --field title|author|tags|note|all  (default: title)');
        console.log('       note: search in note content (Markdown/HTML)');
        console.log('     --since YYYY-MM-DD');
        console.log('     --unsynced');
        console.log('     --limit N');
        console.log('');
        console.log('   Examples:');
        console.log('     zotero search "machine learning"');
        console.log('     zotero search "findings" --field note');
        console.log('     zotero search "Smith" --field author');
        return;
      }

      const db = getDb()();
      const items = getItems();
      const libraries = getLibraries();
      const library = await db.select().from(libraries).get();

      if (!library) {
        console.log(`${symbols.error} No library found. Run "sync" first.`);
        return;
      }

      let results: any[] = [];

      // Note content search (special handling)
      if (options.field === 'note') {
        // Search in notes' rawJson for the query
        const noteResults = await db.select()
          .from(items)
          .where(and(
            eq(items.libraryId, library.id),
            eq(items.itemType, 'note'),
            like(items.rawJson, `%${options.query}%`)
          ))
          .limit(options.limit)
          .all();

        // Also get parent items
        const parentKeys = new Set<string>();
        for (const note of noteResults) {
          try {
            const rawData = JSON.parse(note.rawJson || '{}');
            const data = rawData.data || rawData;
            if (data.parentItem) {
              parentKeys.add(data.parentItem);
            }
          } catch {
            // ignore
          }
        }

        // Get parent items
        if (parentKeys.size > 0) {
          const parentItems = await db.select()
            .from(items)
            .where(and(
              eq(items.libraryId, library.id),
              sql`${items.key} IN (${Array.from(parentKeys).map(k => `'${k}'`).join(',')})`
            ))
            .all();

          // Merge with notes
          results = [...parentItems, ...noteResults];
        } else {
          results = noteResults;
        }
      } else {
        // Build search conditions for regular fields
        let whereConditions: any = eq(items.libraryId, library.id);

        // Field-specific search
        if (options.field === 'title' || options.field === 'all') {
          whereConditions = and(whereConditions, like(items.title, `%${options.query}%`));
        } else if (options.field === 'author') {
          whereConditions = and(whereConditions, like(items.creators, `%${options.query}%`));
        } else if (options.field === 'tags') {
          whereConditions = and(whereConditions, like(items.tags, `%${options.query}%`));
        }

        // Date filter
        if (options.since) {
          const sinceDate = new Date(options.since).getTime();
          if (!isNaN(sinceDate)) {
            whereConditions = and(whereConditions, desc(items.updatedAt) >= sinceDate);
          }
        }

        // Unsynced filter
        if (options.unsynced) {
          whereConditions = and(whereConditions, eq(items.synced, false));
        }

        results = await db.select()
          .from(items)
          .where(whereConditions)
          .limit(options.limit)
          .all();
      }

      // Build search description
      const filters: string[] = [];
      if (options.field !== 'title') filters.push(`field:${options.field}`);
      if (options.since) filters.push(`since:${options.since}`);
      if (options.unsynced) filters.push('unsynced');

      const filterDesc = filters.length > 0 ? ` (${filters.join(', ')})` : '';
      console.log(`\nSearch results for "${options.query}"${filterDesc} (${results.length}):\n`);

      if (results.length === 0) {
        console.log('   No results found.');
      } else {
        results.forEach(item => {
          const syncStatus = item.synced ? symbols.success : '';
          const itemType = item.itemType === 'note' ? '' : '';
          console.log(`  ${itemType} ${syncStatus} [${item.key}] ${item.title?.substring(0, 60) || '(no title)'}`);
          if (options.field === 'author' && item.creators) {
            console.log(`      Authors: ${item.creators.substring(0, 50)}`);
          }
          if (options.field === 'note' && item.itemType === 'note') {
            // Show a snippet of the note content
            try {
              // htmlToPlainText imported at top level
              const rawData = JSON.parse(item.rawJson || '{}');
              const data = rawData.data || rawData;
              const content = data.note || '';
              const snippet = htmlToPlainText(content, 60);
              if (snippet) {
                console.log(`      Note: ${snippet}`);
              }
            } catch {
              // ignore
            }
          }
        });
      }
    }
  },
];
