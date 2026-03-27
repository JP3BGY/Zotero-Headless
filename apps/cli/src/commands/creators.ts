// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getDb, getItems, getLibraries } from '../modules.js';
import { symbols } from '@zotero-headless/core';
import { eq, and } from 'drizzle-orm';
import { parseItemData, parseRawJson, updateItemData } from '@zotero-headless/types';

export const creatorsCommands: Command[] = [
  // ============ Creator Management ============

  {
    name: 'creators',
    aliases: ['author', 'authors'],
    description: 'Manage item creators/authors',
    options: [
      { name: '--list', alias: '-l', description: 'List creators for an item', value: '<key>' },
      { name: '--add', alias: '-a', description: 'Add creator to item', value: '<key> <first-name> <last-name> [<type>]' },
      { name: '--remove', alias: '-r', description: 'Remove creator from item', value: '<key> <creator-index>' },
      { name: '--set-primary', description: 'Set primary author', value: '<key> <creator-index>' },
    ],
    examples: [
      'zotero creators --list ABCD1234',
      'zotero creators --add ABCD1234 John Smith author',
      'zotero creators --remove ABCD1234 1',
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

      const listIndex = args.indexOf('--list');
      const addIndex = args.indexOf('--add');
      const removeIndex = args.indexOf('--remove');
      const setPrimaryIndex = args.indexOf('--set-primary');

      // List creators
      if (listIndex >= 0) {
        const itemKey = args[listIndex + 1];
        if (!itemKey) {
          console.log('Usage: zotero creators --list <key>');
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

        const raw = parseItemData(item.rawJson);
        let creators = raw.creators || [];
        if (typeof creators === 'string') {
          try { creators = JSON.parse(creators); } catch { creators = []; }
        }
        creators = creators as Array<{ firstName?: string; lastName?: string; creatorType?: string }>;

        if (creators.length === 0) {
          console.log(`No creators for [${itemKey}]`);
          return;
        }

        console.log(`\nCreators for [${itemKey}]:\n`);
        creators.forEach((creator, idx) => {
          const type = creator.creatorType || 'unknown';
          console.log(`  [${idx + 1}] ${creator.firstName || ''} ${creator.lastName || ''} (${type})`);
        });

        console.log('\nTo add: zotero creators --add <key> <first-name> <last-name> [type]');
        console.log('To remove: zotero creators --remove <key> <index>');
        return;
      }

      // Add creator
      if (addIndex >= 0) {
        const itemKey = args[addIndex + 1];
        const firstName = args[addIndex + 2];
        const lastName = args[addIndex + 3];
        const creatorType = args[addIndex + 4] || 'author';

        if (!itemKey || !firstName || !lastName) {
          console.log('Usage: zotero creators --add <key> <first-name> <last-name> [type]');
          console.log('  Types: author, editor, translator, illustrator, etc.');
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

        let updatedCreators2: any[];
        const updatedRawJson2 = updateItemData(item.rawJson, (data) => {
          const creators2 = data.creators || [];
          creators2.push({
            firstName,
            lastName,
            creatorType
          });
          data.creators = creators2;
          updatedCreators2 = creators2;
        });

        await db.update(items)
          .set({
            rawJson: updatedRawJson2,
            creators: JSON.stringify(updatedCreators2!),
            synced: false
          })
          .where(eq(items.key, itemKey));

        console.log(`${symbols.success} Added ${firstName} ${lastName} as ${creatorType} to [${itemKey}]`);
        return;
      }

      // Remove creator
      if (removeIndex >= 0) {
        const itemKey = args[removeIndex + 1];
        const creatorIdx = parseInt(args[removeIndex + 2]) - 1;

        if (!itemKey || isNaN(creatorIdx)) {
          console.log('Usage: zotero creators --remove <key> <index>');
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

        const rawData3 = parseItemData(item.rawJson);
        const creators3 = rawData3.creators || [];

        if (creatorIdx < 0 || creatorIdx >= creators3.length) {
          console.log(`${symbols.error} Invalid creator index. Valid: 1-${creators3.length}`);
          return;
        }

        const removed = creators3[creatorIdx];
        let updatedCreators3: any[];
        const updatedRawJson3 = updateItemData(item.rawJson, (data) => {
          const c = data.creators || [];
          c.splice(creatorIdx, 1);
          data.creators = c;
          updatedCreators3 = c;
        });

        await db.update(items)
          .set({
            rawJson: updatedRawJson3,
            creators: JSON.stringify(updatedCreators3!),
            synced: false
          })
          .where(eq(items.key, itemKey));

        console.log(`${symbols.success} Removed ${removed.firstName || ''} ${removed.lastName || ''} from [${itemKey}]`);
        return;
      }

      // Set primary
      if (setPrimaryIndex >= 0) {
        const itemKey = args[setPrimaryIndex + 1];
        const creatorIdx = parseInt(args[setPrimaryIndex + 2]) - 1;

        if (!itemKey || isNaN(creatorIdx)) {
          console.log('Usage: zotero creators --set-primary <key> <index>');
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

        const rawData4 = parseItemData(item.rawJson);
        const creators4 = rawData4.creators || [];

        if (creatorIdx < 0 || creatorIdx >= creators4.length) {
          console.log(`${symbols.error} Invalid creator index. Valid: 1-${creators4.length}`);
          return;
        }

        const selected = creators4[creatorIdx];
        let updatedCreators4: any[];
        // Move creator to front
        const updatedRawJson4 = updateItemData(item.rawJson, (data) => {
          const c = data.creators || [];
          c.splice(creatorIdx, 1);
          c.unshift(selected);
          data.creators = c;
          updatedCreators4 = c;
        });

        await db.update(items)
          .set({
            rawJson: updatedRawJson4,
            creators: JSON.stringify(updatedCreators4!),
            synced: false
          })
          .where(eq(items.key, itemKey));

        console.log(`${symbols.success} Set ${selected.firstName || ''} ${selected.lastName || ''} as primary author`);
        return;
      }

      // Default help
      console.log('Creator Management:');
      console.log('  zotero creators --list <key>                List creators');
      console.log('  zotero creators --add <key> <first> <last> [type]  Add creator');
      console.log('  zotero creators --remove <key> <index>      Remove creator');
      console.log('  zotero creators --set-primary <key> <idx>  Set primary author');
    }
  },
];
