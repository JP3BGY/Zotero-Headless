// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getDb, getItems, getLibraries } from '../modules.js';
import { symbols } from '@zotero-headless/core';
import { parseItemData, updateItemData } from '@zotero-headless/types';
import { eq, and } from 'drizzle-orm';
import { displayTitle } from '../utils.js';

export const relatedCommands: Command[] = [
  {
    name: 'related',
    aliases: ['rel'],
    description: 'Manage related items',
    options: [
      { name: '--list', alias: '-l', description: 'List related items for an item', value: '<key>' },
      { name: '--add', alias: '-a', description: 'Add related item', value: '<key> <related-key>' },
      { name: '--remove', alias: '-r', description: 'Remove related item', value: '<key> <related-key>' },
    ],
    examples: [
      'zotero related --list ABCD1234',
      'zotero related --add ABCD1234 WXYZ5678',
      'zotero related --remove ABCD1234 WXYZ5678',
    ],
    execute: async (args) => {
      await initModules();

      const db = getDb()();
      const items = getItems();
      const libraries = getLibraries();
      const library = await db.select().from(libraries).get();

      if (!library) {
        console.log(`${symbols.error} No library found. Run "sync" first.`);
        return;
      }

      const listIndex = args.indexOf('--list');
      const addIndex = args.indexOf('--add');
      const removeIndex = args.indexOf('--remove');

      // List related items
      if (listIndex >= 0) {
        const itemKey = args[listIndex + 1];
        if (!itemKey) {
          console.log('Usage: zotero related --list <key>');
          return;
        }

        const item = await db.select()
          .from(items)
          .where(and(eq(items.key, itemKey), eq(items.libraryId, library.id)))
          .get();

        if (!item) {
          console.log(`${symbols.error} Item ${itemKey} not found`);
          return;
        }

        // Related items stored in rawJson.data.relations
        const data = parseItemData(item.rawJson);
        const relatedKeys: string[] = data.related || [];

        if (relatedKeys.length === 0) {
          console.log(`No related items for [${itemKey}]`);
          return;
        }

        console.log(`\nRelated items for [${itemKey}]:\n`);
        for (const relKey of relatedKeys) {
          const relItem = await db.select()
            .from(items)
            .where(and(eq(items.key, relKey), eq(items.libraryId, library.id)))
            .get();

          if (relItem) {
            console.log(`  [${relKey}] ${displayTitle(relItem)}`);
            console.log(`      ${relItem.itemType}`);
          } else {
            console.log(`  [${relKey}] (not in library)`);
          }
        }
        return;
      }

      // Add related item
      if (addIndex >= 0) {
        const itemKey = args[addIndex + 1];
        const relatedKey = args[addIndex + 2];

        if (!itemKey || !relatedKey) {
          console.log('Usage: zotero related --add <key> <related-key>');
          return;
        }

        const item = await db.select()
          .from(items)
          .where(and(eq(items.key, itemKey), eq(items.libraryId, library.id)))
          .get();

        if (!item) {
          console.log(`${symbols.error} Item ${itemKey} not found`);
          return;
        }

        const relatedItem = await db.select()
          .from(items)
          .where(and(eq(items.key, relatedKey), eq(items.libraryId, library.id)))
          .get();

        if (!relatedItem) {
          console.log(`${symbols.error} Related item ${relatedKey} not found`);
          return;
        }

        const data = parseItemData(item.rawJson);
        const related: string[] = data.related || [];

        if (related.includes(relatedKey)) {
          console.log(`${symbols.info} Item ${relatedKey} already related`);
          return;
        }

        const newRawJson = updateItemData(item.rawJson, (d) => {
          const rel: string[] = d.related || [];
          rel.push(relatedKey);
          d.related = rel;
        });

        await db.update(items)
          .set({
            rawJson: newRawJson,
            synced: false
          })
          .where(eq(items.key, itemKey));

        console.log(`${symbols.success} Added [${relatedKey}] as related to [${itemKey}]`);
        return;
      }

      // Remove related item
      if (removeIndex >= 0) {
        const itemKey = args[removeIndex + 1];
        const relatedKey = args[removeIndex + 2];

        if (!itemKey || !relatedKey) {
          console.log('Usage: zotero related --remove <key> <related-key>');
          return;
        }

        const item = await db.select()
          .from(items)
          .where(and(eq(items.key, itemKey), eq(items.libraryId, library.id)))
          .get();

        if (!item) {
          console.log(`${symbols.error} Item ${itemKey} not found`);
          return;
        }

        const data = parseItemData(item.rawJson);
        const related: string[] = data.related || [];
        const filtered = related.filter(k => k !== relatedKey);

        if (filtered.length === related.length) {
          console.log(`${symbols.info} Item ${relatedKey} not in related list`);
          return;
        }

        const newRawJson = updateItemData(item.rawJson, (d) => {
          d.related = filtered;
        });

        await db.update(items)
          .set({
            rawJson: newRawJson,
            synced: false
          })
          .where(eq(items.key, itemKey));

        console.log(`${symbols.success} Removed [${relatedKey}] from related items`);
        return;
      }

      // Default help
      console.log('Related Items Commands:');
      console.log('  zotero related --list <key>          List related items');
      console.log('  zotero related --add <key> <rel-key>  Add related item');
      console.log('  zotero related --remove <key> <rel>   Remove related item');
    }
  },
];
