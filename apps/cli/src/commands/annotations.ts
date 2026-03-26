// @ts-nocheck

import { symbols } from '@zotero-headless/core';
import { eq, and, like } from 'drizzle-orm';
import { Command } from '../types.js';
import { initModules, getDb, getItems, getLibraries } from '../modules.js';
import { t } from '../i18n.js';

export const annotationCommands: Command[] = [

  {
    name: 'annotations',
    aliases: ['annot', 'highlights', 'hl'],
    description: 'Show annotations/highlights for an item. Aliases: annot, highlights, hl',
    options: [
      { name: '--color', alias: '-c', description: 'Filter by annotation color', value: '<color>' },
      { name: '--type', alias: '-t', description: 'Filter by type (highlight, note, image, underline)', value: '<type>' },
      { name: '--format', alias: '-f', description: 'Output format (text|json|markdown)', value: '<fmt>' },
    ],
    examples: [
      'zotero annotations ABC123',
      'zotero hl ABC123 --format markdown',
      'zotero annot ABC123 -t highlight',
      'zotero annot ABC123 -c yellow',
    ],
    execute: async (args) => {
      await initModules();

      const key = args.find(a => !a.startsWith('-'));
      if (!key) {
        console.log(`${symbols.error} Usage: zotero annotations <item-key> [--color <color>] [--type <type>] [--format text|json|markdown]`);
        console.log('   Example: zotero annotations ABCD1234');
        process.exit(1);
      }

      // Parse options
      const colorIdx = args.indexOf('--color') !== -1 ? args.indexOf('--color') : args.indexOf('-c');
      const typeIdx = args.indexOf('--type') !== -1 ? args.indexOf('--type') : args.indexOf('-t');
      const fmtIdx = args.indexOf('--format') !== -1 ? args.indexOf('--format') : args.indexOf('-f');
      const colorFilter = colorIdx !== -1 ? args[colorIdx + 1] : undefined;
      const typeFilter = typeIdx !== -1 ? args[typeIdx + 1] : undefined;
      const format = fmtIdx !== -1 ? args[fmtIdx + 1] : 'text';

      try {
        const db = getDb()();
        const items = getItems();
        const libraries = getLibraries();
        const library = await db.select().from(libraries).get();
        if (!library) {
          console.log(`${symbols.error} No library found. Run "sync" first.`);
          process.exit(1);
        }

        // Find the item
        const item = await db.select()
          .from(items)
          .where(and(eq(items.key, key), eq(items.libraryId, library.id)))
          .get();

        if (!item) {
          console.log(`${symbols.error} ${t('commands.annotations.notFound')}`);
          process.exit(1);
        }

        // Determine attachment keys to query annotations for
        let attachmentKeys: string[] = [];
        if (item.itemType === 'attachment') {
          attachmentKeys = [key];
        } else {
          // Find PDF attachment children
          const children = await db.select()
            .from(items)
            .where(and(
              eq(items.libraryId, library.id),
              eq(items.itemType, 'attachment'),
              eq(items.deleted, false),
              like(items.rawJson, `%"parentItem":"${key}"%`)
            ))
            .all();
          attachmentKeys = children.map((c: any) => c.key);
        }

        if (attachmentKeys.length === 0 && item.itemType !== 'annotation') {
          console.log(`\n${symbols.warning} ${t('commands.annotations.noAttachments')}`);
          return;
        }

        // Query annotation items
        const allAnnotations: any[] = [];
        for (const attKey of attachmentKeys) {
          const annots = await db.select()
            .from(items)
            .where(and(
              eq(items.libraryId, library.id),
              eq(items.itemType, 'annotation'),
              eq(items.deleted, false),
              like(items.rawJson, `%"parentItem":"${attKey}"%`)
            ))
            .all();
          allAnnotations.push(...annots);
        }

        // Parse annotation data
        let annotations = allAnnotations.map((row: any) => {
          const raw = JSON.parse(row.rawJson || '{}');
          const d = raw.data || raw;
          return {
            key: row.key,
            parentAttachmentKey: d.parentItem || '',
            annotationType: d.annotationType || 'highlight',
            annotationText: d.annotationText || '',
            annotationComment: d.annotationComment || '',
            annotationColor: d.annotationColor || '',
            annotationPageLabel: d.annotationPageLabel || '',
            annotationSortIndex: d.annotationSortIndex || '',
            tags: d.tags || [],
          };
        });

        // Apply filters
        if (colorFilter) {
          const colorMap: Record<string, string> = {
            yellow: '#ffd400', red: '#ff6666', green: '#5fb236',
            blue: '#2ea8e5', purple: '#a28ae5', orange: '#f19837',
          };
          const hex = colorMap[colorFilter.toLowerCase()] || colorFilter.toLowerCase();
          annotations = annotations.filter(a => a.annotationColor.toLowerCase() === hex);
        }
        if (typeFilter) {
          annotations = annotations.filter(a => a.annotationType === typeFilter.toLowerCase());
        }

        // Sort by sortIndex (page order)
        annotations.sort((a, b) => a.annotationSortIndex.localeCompare(b.annotationSortIndex));

        if (annotations.length === 0) {
          console.log(`\n${symbols.warning} ${t('commands.annotations.noAnnotations')}`);
          return;
        }

        const itemTitle = item.title || '(no title)';

        // Output based on format
        if (format === 'json') {
          console.log(JSON.stringify(annotations, null, 2));
        } else if (format === 'markdown') {
          console.log(`# ${itemTitle}\n`);
          let currentPage = '';
          for (const a of annotations) {
            const page = a.annotationPageLabel;
            if (page && page !== currentPage) {
              currentPage = page;
              console.log(`## Page ${page}\n`);
            }
            if (a.annotationType === 'note') {
              console.log(`- **${t('commands.annotations.note')}**: ${a.annotationComment}\n`);
            } else {
              if (a.annotationText) {
                console.log(`> ${a.annotationText}\n`);
              }
              if (a.annotationComment) {
                console.log(`${t('commands.annotations.comment')}: ${a.annotationComment}\n`);
              }
            }
          }
        } else {
          // Default: text format
          const colorDot = (hex: string): string => {
            const map: Record<string, string> = {
              '#ffd400': '\u{1F7E1}', '#ff6666': '\u{1F534}', '#5fb236': '\u{1F7E2}',
              '#2ea8e5': '\u{1F535}', '#a28ae5': '\u{1F7E3}', '#f19837': '\u{1F7E0}',
            };
            return map[hex.toLowerCase()] || '\u{26AA}';
          };

          console.log(`\n${t('commands.annotations.title', itemTitle, annotations.length)}\n`);
          for (const a of annotations) {
            const page = a.annotationPageLabel ? `[${t('commands.annotations.page')}${a.annotationPageLabel}]` : '';
            const dot = colorDot(a.annotationColor);

            if (a.annotationType === 'note') {
              console.log(`  ${page} ${dot} ${t('commands.annotations.note')}: ${a.annotationComment}`);
            } else {
              const text = a.annotationText ? `"${a.annotationText}"` : '';
              console.log(`  ${page} ${dot} ${text}`);
              if (a.annotationComment) {
                console.log(`        ${t('commands.annotations.comment')}: ${a.annotationComment}`);
              }
            }
            console.log();
          }
        }
      } catch (error) {
        console.log(`${symbols.error} Failed to get annotations: ${error}`);
        process.exit(1);
      }
    }
  },

];
