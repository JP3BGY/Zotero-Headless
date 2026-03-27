// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getDb, getItems, getLibraries, getCollections } from '../modules.js';
import { symbols } from '@zotero-headless/core';
import { eq, and, sql } from 'drizzle-orm';

export const batchCommands: Command[] = [
  // ============ Batch Operations ============

  {
    name: 'batch',
    aliases: ['batch-operation', 'bulk'],
    description: 'Batch operations on multiple items',
    options: [
      { name: '--tag', alias: '-t', description: 'Add tags to multiple items', value: '<keys...> <tags...>' },
      { name: '--untag', description: 'Remove tags from multiple items', value: '<keys...> <tags...>' },
      { name: '--add-to-collection', description: 'Add items to collection', value: '<collection-key> <item-keys...>' },
      { name: '--remove-from-collection', description: 'Remove items from collection', value: '<collection-key> <item-keys...>' },
      { name: '--delete', alias: '-d', description: 'Delete multiple items (move to trash)' },
      { name: '--export', description: 'Export multiple items to file', value: '<format> <output-path> <keys...>' },
    ],
    examples: [
      'zotero batch --tag ABCD1234 WXYZ5678 "new-tag"',
      'zotero batch --add-to-collection ABCD1234 WXYZ5678',
      'zotero batch --export bibtex output.bib <keys...>',
    ],
    execute: async (args) => {
      await initModules();

      const items = getItems();
      const libraries = getLibraries();
      const collections = getCollections();
      const db = getDb()();
      const library = await db.select().from(libraries).get();

      if (!library) {
        console.log(`${symbols.error} No library found. Run "sync" first.`);
        return;
      }

      const tagIndex = args.indexOf('--tag');
      const untagIndex = args.indexOf('--untag');
      const addColIndex = args.indexOf('--add-to-collection');
      const removeColIndex = args.indexOf('--remove-from-collection');
      const deleteIndex = args.indexOf('--delete');
      const exportIndex = args.indexOf('--export');

      // Batch tag
      if (tagIndex >= 0) {
        const tags: string[] = [];
        const keys: string[] = [];

        // Find -- to separate keys from tags
        const dashDashIndex = args.indexOf('--');
        if (dashDashIndex >= 0) {
          for (let i = tagIndex + 1; i < dashDashIndex; i++) {
            if (args[i] && !args[i].startsWith('--')) keys.push(args[i]);
          }
          for (let i = dashDashIndex + 1; i < args.length; i++) {
            if (args[i]) tags.push(args[i]);
          }
        } else {
          // Try to detect: first arg after --tag is key, rest are tags if > 2 args
          for (let i = tagIndex + 1; i < args.length; i++) {
            if (args[i].startsWith('--')) break;
            if (i === tagIndex + 1 || i === tagIndex + 2) {
              keys.push(args[i]); // First two are keys
            } else {
              tags.push(args[i]); // Rest are tags
            }
          }
        }

        if (keys.length === 0 || tags.length === 0) {
          console.log('Usage: zotero batch --tag <key1> <key2> -- <tag1> <tag2>');
          console.log('   Or: zotero batch --tag key1 key2 tag1 tag2');
          return;
        }

        console.log(`Adding tags to ${keys.length} item(s)...`);

        for (const key of keys) {
          const item = await db.select()
            .from(items)
            .where(and(eq(items.key, key), eq(items.libraryId, library.id)))
            .get();

          if (!item) {
            console.log(`${symbols.error} Item ${key} not found`);
            continue;
          }

          const rawJson = JSON.parse(item.rawJson);
          const raw = rawJson.data || rawJson;
          const itemTags = raw.tags || [];
          const existingTags = new Set(itemTags.map((t: any) => typeof t === 'string' ? t.toLowerCase() : (t.tag || '').toLowerCase()));

          let addedCount = 0;
          for (const tag of tags) {
            if (!existingTags.has(tag.toLowerCase())) {
              itemTags.push({ tag, type: 0 });
              addedCount++;
            }
          }

          if (addedCount > 0) {
            raw.tags = itemTags;
            await db.update(items)
              .set({
                rawJson: JSON.stringify(rawJson),
                tags: JSON.stringify(itemTags),
                synced: false
              })
              .where(eq(items.key, key));
          }
        }

        console.log(`${symbols.success} Added ${tags.length} tag(s) to ${keys.length} item(s)`);
        return;
      }

      // Batch untag
      if (untagIndex >= 0) {
        const dashDashIndex = args.indexOf('--');
        const tags: string[] = [];
        const keys: string[] = [];

        if (dashDashIndex >= 0) {
          for (let i = untagIndex + 1; i < dashDashIndex; i++) {
            if (args[i] && !args[i].startsWith('--')) keys.push(args[i]);
          }
          for (let i = dashDashIndex + 1; i < args.length; i++) {
            if (args[i]) tags.push(args[i]);
          }
        }

        if (keys.length === 0 || tags.length === 0) {
          console.log('Usage: zotero batch --untag <key1> <key2> -- <tag1> <tag2>');
          return;
        }

        const tagsToRemove = new Set(tags.map(t => t.toLowerCase()));

        for (const key of keys) {
          const item = await db.select()
            .from(items)
            .where(and(eq(items.key, key), eq(items.libraryId, library.id)))
            .get();

          if (!item) continue;

          const rawJson = JSON.parse(item.rawJson);
          const raw = rawJson.data || rawJson;
          const itemTags = (raw.tags || []).filter((t: any) => {
            const tagName = typeof t === 'string' ? t.toLowerCase() : (t.tag || '').toLowerCase();
            return !tagsToRemove.has(tagName);
          });

          raw.tags = itemTags;
          await db.update(items)
            .set({
              rawJson: JSON.stringify(rawJson),
              tags: JSON.stringify(itemTags),
              synced: false
            })
            .where(eq(items.key, key));
        }

        console.log(`${symbols.success} Removed tags from ${keys.length} item(s)`);
        return;
      }

      // Batch add to collection
      if (addColIndex >= 0) {
        const collectionKey = args[addColIndex + 1];
        const itemKeys = args.slice(addColIndex + 2).filter(a => a && !a.startsWith('--'));

        if (!collectionKey || itemKeys.length === 0) {
          console.log('Usage: zotero batch --add-to-collection <collection-key> <item-key> [<item-key>...]');
          return;
        }

        const collection = await db.select()
          .from(collections)
          .where(eq(collections.key, collectionKey))
          .get();

        if (!collection) {
          console.log(`${symbols.error} Collection ${collectionKey} not found`);
          return;
        }

        for (const key of itemKeys) {
          const item = await db.select()
            .from(items)
            .where(and(eq(items.key, key), eq(items.libraryId, library.id)))
            .get();

          if (!item) continue;

          const rawJson = JSON.parse(item.rawJson);
          const raw = rawJson.data || rawJson;
          const colKeys: string[] = raw.collections || [];
          if (!colKeys.includes(collectionKey)) {
            colKeys.push(collectionKey);
            raw.collections = colKeys;
            await db.update(items)
              .set({
                rawJson: JSON.stringify(rawJson),
                collectionKeys: JSON.stringify(colKeys),
                synced: false
              })
              .where(eq(items.key, key));
          }
        }

        console.log(`${symbols.success} Added ${itemKeys.length} item(s) to collection ${collectionKey}`);
        return;
      }

      // Batch remove from collection
      if (removeColIndex >= 0) {
        const collectionKey = args[removeColIndex + 1];
        const itemKeys = args.slice(removeColIndex + 2).filter(a => a && !a.startsWith('--'));

        if (!collectionKey || itemKeys.length === 0) {
          console.log('Usage: zotero batch --remove-from-collection <collection-key> <item-key> [<item-key>...]');
          return;
        }

        for (const key of itemKeys) {
          const item = await db.select()
            .from(items)
            .where(and(eq(items.key, key), eq(items.libraryId, library.id)))
            .get();

          if (!item) continue;

          const rawJson = JSON.parse(item.rawJson);
          const raw = rawJson.data || rawJson;
          const colKeys: string[] = (raw.collections || []).filter((k: string) => k !== collectionKey);
          raw.collections = colKeys;
          await db.update(items)
            .set({
              rawJson: JSON.stringify(rawJson),
              collectionKeys: JSON.stringify(colKeys),
              synced: false
            })
            .where(eq(items.key, key));
        }

        console.log(`${symbols.success} Removed ${itemKeys.length} item(s) from collection ${collectionKey}`);
        return;
      }

      // Batch delete
      if (deleteIndex >= 0) {
        // Get item keys - they come after -d
        const deleteIdx = args.indexOf('-d');
        const keys = args.slice(deleteIdx + 1).filter(a => a && !a.startsWith('-'));

        if (keys.length === 0) {
          console.log('Usage: zotero batch -d <key1> <key2> ...');
          return;
        }

        console.log(`Moving ${keys.length} item(s) to trash...`);

        for (const key of keys) {
          const item = await db.select()
            .from(items)
            .where(and(eq(items.key, key), eq(items.libraryId, library.id), eq(items.deleted, false)))
            .get();

          if (!item) continue;

          await db.update(items)
            .set({
              deleted: true,
              deletedAt: Math.floor(Date.now() / 1000),
              version: item.version + 1,
              synced: false
            })
            .where(eq(items.key, key));
        }

        console.log(`${symbols.success} Moved ${keys.length} item(s) to trash`);
        return;
      }

      // Batch export
      if (exportIndex >= 0) {
        const format = args[exportIndex + 1];
        const outputPath = args[exportIndex + 2];
        const keys = args.slice(exportIndex + 3).filter(a => a && !a.startsWith('-'));

        if (!format || !outputPath || keys.length === 0) {
          console.log('Usage: zotero batch --export <format> <output-path> <key1> <key2>...');
          console.log('  Formats: bibtex, json, csv');
          return;
        }

        const exportItems = await db.select()
          .from(items)
          .where(and(
            eq(items.libraryId, library.id),
            sql`${items.key} IN (${keys.map(k => `'${k}'`).join(',')})`
          ));

        let output = '';

        if (format === 'json') {
          output = JSON.stringify(exportItems.map(i => JSON.parse(i.rawJson)), null, 2);
        } else if (format === 'bibtex') {
          for (const item of exportItems) {
            const rawJson = JSON.parse(item.rawJson);
            const raw = rawJson.data || rawJson;
            const key = item.key.toLowerCase();
            const author = (raw.creators || [])
              .filter((c: any) => c.creatorType === 'author')
              .map((c: any) => `${c.lastName || ''}, ${c.firstName || ''}`)
              .join(' and ');
            const year = raw.date ? new Date(raw.date).getFullYear() : '????';

            output += `@${raw.itemType || 'misc'}{${key},
  author = {${author}},
  title = {${item.title || ''}},
  year = {${year}},
  journal = {${raw.publicationTitle || ''}},
  doi = {${raw.DOI || ''}},
}
`;
          }
        } else if (format === 'csv') {
          output = 'key,title,itemType,doi,isbn,year\n';
          for (const item of exportItems) {
            const rawJson = JSON.parse(item.rawJson);
            const raw = rawJson.data || rawJson;
            const year = raw.date ? new Date(raw.date).getFullYear() : '';
            output += `"${item.key}","${(item.title || '').replace(/"/g, '""')}","${item.itemType}","${raw.DOI || ''}","${raw.ISBN || ''}","${year}"
`;
          }
        }

        const fs = await import('fs');
        fs.writeFileSync(outputPath, output);
        console.log(`${symbols.success} Exported ${exportItems.length} item(s) to ${outputPath}`);
        return;
      }

      // Default help
      console.log('Batch Operations:');
      console.log('  zotero batch --tag <keys...> -- <tags...>       Add tags to items');
      console.log('  zotero batch --untag <keys...> -- <tags...>    Remove tags from items');
      console.log('  zotero batch --add-to-collection <col> <keys>  Add items to collection');
      console.log('  zotero batch --remove-from-collection <col>   Remove items from collection');
      console.log('  zotero batch -d <key1> <key2>...               Delete (trash) multiple items');
      console.log('  zotero batch --export <fmt> <file> <keys...>    Export items to file');
    }
  },
];
