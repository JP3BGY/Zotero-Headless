// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getDb, getItems, getLibraries } from '../modules.js';
import { symbols } from '@zotero-headless/core';
import { eq, and } from 'drizzle-orm';

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

        const raw = JSON.parse(item.rawJson);
        const creators = (raw.creators || []) as Array<{ firstName?: string; lastName?: string; creatorType?: string }>;

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

        const raw = JSON.parse(item.rawJson);
        const creators = raw.creators || [];

        creators.push({
          firstName,
          lastName,
          creatorType
        });

        raw.creators = creators;

        await db.update(items)
          .set({
            rawJson: JSON.stringify(raw),
            version: item.version + 1,
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

        const raw = JSON.parse(item.rawJson);
        const creators = raw.creators || [];

        if (creatorIdx < 0 || creatorIdx >= creators.length) {
          console.log(`${symbols.error} Invalid creator index. Valid: 1-${creators.length}`);
          return;
        }

        const removed = creators.splice(creatorIdx, 1)[0];
        raw.creators = creators;

        await db.update(items)
          .set({
            rawJson: JSON.stringify(raw),
            version: item.version + 1,
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

        const raw = JSON.parse(item.rawJson);
        const creators = raw.creators || [];

        if (creatorIdx < 0 || creatorIdx >= creators.length) {
          console.log(`${symbols.error} Invalid creator index. Valid: 1-${creators.length}`);
          return;
        }

        // Move creator to front
        const selected = creators.splice(creatorIdx, 1)[0];
        creators.unshift(selected);
        raw.creators = creators;

        await db.update(items)
          .set({
            rawJson: JSON.stringify(raw),
            version: item.version + 1,
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
