// @ts-nocheck

import { eq, desc } from 'drizzle-orm';
import { symbols, appConfig } from '@zotero-headless/core';
import { Command } from '../types.js';
import { initModules, getDb, getItems, getItemTags } from '../modules.js';

export const tagsCommands: Command[] = [

  // ============ Tags Management ============

  {
    name: 'tags',
    aliases: ['tag', 't'],
    description: 'Manage item tags. Use subcommands: list, add, remove, delete',
    options: [
      { name: '--list', alias: '-l', description: 'List all tags in library' },
      { name: '--add', alias: '-a', description: 'Add tags to an item', value: '<key> <tags...>' },
      { name: '--remove', alias: '-r', description: 'Remove tags from an item', value: '<key> <tags...>' },
      { name: '--item', alias: '-i', description: 'Show tags for a specific item', value: '<key>' },
      { name: '--delete', alias: '-d', description: 'Delete a tag from library (removes from all items)', value: '<tag>' },
    ],
    examples: [
      'zotero tags --list',
      'zotero tags --add ABCD1234 "machine learning" "AI"',
      'zotero tags --remove ABCD1234 "old tag"',
      'zotero tags --item ABCD1234',
      'zotero tags --delete "unused tag"',
    ],
    execute: async (args) => {
      await initModules();

      const db = getDb()();
      const items = getItems();
      const itemTags = getItemTags();
      const libraryId = appConfig.zotero.userId;
      const listIndex = args.indexOf('--list');
      const addIndex = args.indexOf('--add');
      const removeIndex = args.indexOf('--remove');
      const itemIndex = args.indexOf('--item');
      const deleteIndex = args.indexOf('--delete');

      // List all tags
      if (listIndex >= 0 || (args.length === 0 || args[0] === 'list')) {
        console.log('Fetching tags...');
        const tagsResult = await db.select()
          .from(itemTags)
          .orderBy(desc(itemTags.tag));

        // Group by tag and count
        const tagCounts = new Map<string, { count: number; type: number }>();
        for (const row of tagsResult) {
          const existing = tagCounts.get(row.tag);
          if (existing) {
            existing.count++;
          } else {
            tagCounts.set(row.tag, { count: 1, type: row.tagType });
          }
        }

        if (tagCounts.size === 0) {
          console.log('   No tags found in library.');
          return;
        }

        console.log(`\nTags in library (${tagCounts.size}):\n`);
        const sortedTags = Array.from(tagCounts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
        for (const [tag, info] of sortedTags) {
          const typeLabel = info.type === 1 ? ' (auto)' : ' (user)';
          console.log(`  ${tag}${typeLabel}: ${info.count} items`);
        }
        return;
      }

      // Add tags to item
      if (addIndex >= 0) {
        const keyArg = args.find(arg => !arg.startsWith('--'));
        const addArgs = args.slice(addIndex + 1);
        const itemKey = addArgs[0];
        const tagsToAdd = addArgs.slice(1);

        if (!itemKey || tagsToAdd.length === 0) {
          console.log('Usage: zotero tags --add <item-key> <tag1> [tag2] ...');
          return;
        }

        // Find item in database
        const item = await db.select()
          .from(items)
          .where(eq(items.key, itemKey))
          .get();

        if (!item) {
          console.log(`${symbols.error} Item ${itemKey} not found`);
          return;
        }

        // Parse existing tags
        const existingTags: { tag: string; type: number }[] = JSON.parse(item.tags || '[]');
        const existingTagNames = new Set(existingTags.map(t => t.tag.toLowerCase()));

        // Add new tags
        const newTags = tagsToAdd
          .filter(tag => !existingTagNames.has(tag.toLowerCase()))
          .map(tag => ({ tag, type: 0 }));

        if (newTags.length === 0) {
          console.log(`${symbols.info} All tags already exist on this item`);
          return;
        }

        // Update item
        const allTags = [...existingTags, ...newTags];
        await db.update(items)
          .set({ tags: JSON.stringify(allTags), version: item.version + 1 })
          .where(eq(items.key, itemKey));

        console.log(`${symbols.success} Added ${newTags.length} tag(s) to ${itemKey}`);
        return;
      }

      // Remove tags from item
      if (removeIndex >= 0) {
        const removeArgs = args.slice(removeIndex + 1);
        const itemKey = removeArgs[0];
        const tagsToRemove = removeArgs.slice(1).map(t => t.toLowerCase());

        if (!itemKey || tagsToRemove.length === 0) {
          console.log('Usage: zotero tags --remove <item-key> <tag1> [tag2] ...');
          return;
        }

        // Find item in database
        const item = await db.select()
          .from(items)
          .where(eq(items.key, itemKey))
          .get();

        if (!item) {
          console.log(`${symbols.error} Item ${itemKey} not found`);
          return;
        }

        // Parse and filter tags
        const existingTags: { tag: string; type: number }[] = JSON.parse(item.tags || '[]');
        const filteredTags = existingTags.filter(t => !tagsToRemove.includes(t.tag.toLowerCase()));

        if (filteredTags.length === existingTags.length) {
          console.log(`${symbols.info} No matching tags found to remove`);
          return;
        }

        // Update item
        await db.update(items)
          .set({ tags: JSON.stringify(filteredTags), version: item.version + 1 })
          .where(eq(items.key, itemKey));

        console.log(`${symbols.success} Removed ${existingTags.length - filteredTags.length} tag(s) from ${itemKey}`);
        return;
      }

      // Show tags for specific item
      if (itemIndex >= 0) {
        const itemKey = args[itemIndex + 1];

        if (!itemKey) {
          console.log('Usage: zotero tags --item <item-key>');
          return;
        }

        const item = await db.select()
          .from(items)
          .where(eq(items.key, itemKey))
          .get();

        if (!item) {
          console.log(`${symbols.error} Item ${itemKey} not found`);
          return;
        }

        const itemTagList: { tag: string; type: number }[] = JSON.parse(item.tags || '[]');

        if (itemTagList.length === 0) {
          console.log(`No tags on item ${itemKey}`);
          return;
        }

        console.log(`Tags on ${itemKey} (${itemTagList.length}):\n`);
        for (const tag of itemTagList) {
          const typeLabel = tag.type === 1 ? ' (auto)' : ' (user)';
          console.log(`  ${tag.tag}${typeLabel}`);
        }
        return;
      }

      // Delete tag from library (removes from all items)
      if (deleteIndex >= 0) {
        const tagToDelete = args[deleteIndex + 1];

        if (!tagToDelete) {
          console.log('Usage: zotero tags --delete <tag-name>');
          return;
        }

        // Find all items with this tag
        const itemsWithTag = await db.select()
          .from(itemTags)
          .where(eq(itemTags.tag, tagToDelete));

        if (itemsWithTag.length === 0) {
          console.log(`${symbols.info} Tag "${tagToDelete}" not found in library`);
          return;
        }

        console.log(`Removing tag "${tagToDelete}" from ${itemsWithTag.length} item(s)...`);

        // Remove tag from each item
        for (const row of itemsWithTag) {
          const item = await db.select()
            .from(items)
            .where(eq(items.key, row.itemKey))
            .get();

          if (item) {
            const currentTags: { tag: string; type: number }[] = JSON.parse(item.tags || '[]');
            const filteredTags = currentTags.filter(t => t.tag.toLowerCase() !== tagToDelete.toLowerCase());
            await db.update(items)
              .set({ tags: JSON.stringify(filteredTags), version: item.version + 1 })
              .where(eq(items.key, row.itemKey));
          }
        }

        // Delete from item_tags table
        await db.delete(itemTags)
          .where(eq(itemTags.tag, tagToDelete));

        console.log(`${symbols.success} Deleted tag "${tagToDelete}" from library`);
        return;
      }

      // Default: show help
      console.log('Tags Management Commands:');
      console.log('  zotero tags --list                List all tags in library');
      console.log('  zotero tags --add <key> <tags>    Add tags to an item');
      console.log('  zotero tags --remove <key> <tags> Remove tags from an item');
      console.log('  zotero tags --item <key>           Show tags for an item');
      console.log('  zotero tags --delete <tag>         Delete tag from library');
    }
  },

];
