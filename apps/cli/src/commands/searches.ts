// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getDb, getItems, getLibraries } from '../modules.js';
import { symbols } from '@zotero-headless/core';
import { eq, and } from 'drizzle-orm';

export const searchesCommands: Command[] = [
  {
    name: 'searches',
    aliases: ['search:list', 'saved-searches'],
    description: 'Manage saved searches',
    options: [
      { name: '--list', alias: '-l', description: 'List all saved searches' },
      { name: '--run', alias: '-r', description: 'Run a saved search', value: '<key>' },
      { name: '--delete', alias: '-d', description: 'Delete a saved search', value: '<key>' },
    ],
    examples: [
      'zotero searches --list',
      'zotero searches --run ABCD1234',
      'zotero searches --delete ABCD1234',
    ],
    execute: async (args) => {
      await initModules();

      const db = getDb()();
      const items = getItems();
      const libraries = getLibraries();
      const library = await db.select().from(libraries).get();

      const listIndex = args.indexOf('--list');
      const runIndex = args.indexOf('--run');
      const deleteIndex = args.indexOf('--delete');

      // List saved searches
      if (listIndex >= 0 || args.length === 0) {
        const searchItems = await db.select()
          .from(items)
          .where(and(
            library ? eq(items.libraryId, library.id) : undefined,
            eq(items.itemType, 'search')
          ));

        if (searchItems.length === 0) {
          console.log('No saved searches found.');
          console.log('\nTo create a saved search, use Zotero Desktop client.');
          return;
        }

        console.log(`\nSaved searches (${searchItems.length}):\n`);
        for (const item of searchItems) {
          const raw = JSON.parse(item.rawJson);
          console.log(`  [${item.key}] ${item.title || 'Unnamed search'}`);
          if (raw.conditions) {
            console.log(`      Conditions: ${JSON.stringify(raw.conditions).substring(0, 60)}...`);
          }
        }
        return;
      }

      // Run saved search
      if (runIndex >= 0) {
        const searchKey = args[runIndex + 1];
        if (!searchKey) {
          console.log('Usage: zotero searches --run <key>');
          return;
        }

        const searchItem = await db.select()
          .from(items)
          .where(and(eq(items.key, searchKey), eq(items.itemType, 'search')))
          .get();

        if (!searchItem) {
          console.log(`${symbols.error} Saved search ${searchKey} not found`);
          return;
        }

        // Parse search conditions and execute
        const raw = JSON.parse(searchItem.rawJson);
        const conditions = raw.conditions || [];

        // Simple condition matching - iterate items and filter
        let results = await db.select()
          .from(items)
          .where(and(
            library ? eq(items.libraryId, library.id) : undefined,
            eq(items.deleted, false)
          ));

        // Apply simple conditions (field + operator + value)
        for (const cond of conditions) {
          if (cond.condition && cond.value) {
            results = results.filter(item => {
              const fieldValue = item[cond.condition as keyof typeof item];
              if (!fieldValue) return false;
              const itemVal = String(fieldValue).toLowerCase();
              const searchVal = String(cond.value).toLowerCase();
              switch (cond.operator) {
                case 'contains':
                  return itemVal.includes(searchVal);
                case 'is':
                  return itemVal === searchVal;
                case 'isNot':
                  return itemVal !== searchVal;
                case 'beginsWith':
                  return itemVal.startsWith(searchVal);
                default:
                  return itemVal.includes(searchVal);
              }
            });
          }
        }

        console.log(`\nSearch "${searchItem.title}" returned ${results.length} item(s):\n`);
        for (const item of results.slice(0, 20)) {
          console.log(`  [${item.key}] ${item.title || '(no title)'}`);
        }
        if (results.length > 20) {
          console.log(`  ... and ${results.length - 20} more`);
        }
        return;
      }

      // Delete saved search
      if (deleteIndex >= 0) {
        const searchKey = args[deleteIndex + 1];
        if (!searchKey) {
          console.log('Usage: zotero searches --delete <key>');
          return;
        }

        const searchItem = await db.select()
          .from(items)
          .where(and(eq(items.key, searchKey), eq(items.itemType, 'search')))
          .get();

        if (!searchItem) {
          console.log(`${symbols.error} Saved search ${searchKey} not found`);
          return;
        }

        await db.update(items)
          .set({ deleted: true, version: searchItem.version + 1 })
          .where(eq(items.key, searchKey));

        console.log(`${symbols.success} Deleted saved search ${searchKey}`);
        return;
      }

      // Default help
      console.log('Saved Searches Commands:');
      console.log('  zotero searches --list           List all saved searches');
      console.log('  zotero searches --run <key>      Run a saved search');
      console.log('  zotero searches --delete <key>  Delete a saved search');
    }
  },
];
