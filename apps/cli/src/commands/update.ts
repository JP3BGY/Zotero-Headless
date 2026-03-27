// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getDb, getItems, getLibraries } from '../modules.js';
import { symbols } from '@zotero-headless/core';
import { eq, and } from 'drizzle-orm';
import { parseItemData, updateItemData } from '@zotero-headless/types';

export const updateCommands: Command[] = [
  {
    name: 'update',
    aliases: ['u', 'edit', 'set', 'mod'],
    description: 'Update an item. Aliases: u, edit, set, mod',
    options: [
      { name: '--field', alias: '-f', description: 'Field to update', value: '<field>' },
      { name: '--value', alias: '-v', description: 'New value', value: '<value>' },
    ],
    examples: [
      'zotero update ABC123 --field title --value "New Title"',
      'zotero u ABC123 -f date -v "2024-01-01"',
    ],
    execute: async (args) => {
      await initModules();
      console.log('Updating item locally...\n');

      const key = args[0];
      const field = args[1];
      const value = args.slice(2).join(' ');

      if (!key || !field || !value) {
        console.log(`${symbols.error} Usage: zotero update <key> <field> <value>`);
        console.log('   Example: zotero update ABCD123 title "New Title"');
        console.log('\n   Available fields:');
        console.log('   title, date, abstract, url, doi');
        process.exit(1);
      }

      try {
        const db = getDb()();
        const library = await db.select().from(getLibraries()).get();

        if (!library) {
          console.log(`${symbols.error} No library found. Run "sync" first.`);
          process.exit(1);
        }

        // Get current item
        const item = await db.select()
          .from(getItems())
          .where(and(eq(getItems().key, key), eq(getItems().libraryId, library.id)))
          .get();

        if (!item) {
          console.log(`${symbols.error} Item ${key} not found.`);
          process.exit(1);
        }

        // Map CLI field names to Zotero API field names
        const fieldMap: Record<string, string> = {
          'title': 'title',
          'date': 'date',
          'abstract': 'abstractNote',
          'url': 'url',
          'doi': 'DOI'
        };

        const apiField = fieldMap[field.toLowerCase()] || field;
        const oldValue = parseItemData(item.rawJson)[apiField];

        // Update local database only (do not call API)
        console.log(`   Updating ${key}: ${field} = "${value}"`);

        // Update the field and re-serialize
        const updatedRawJson = updateItemData(item.rawJson, (data) => {
          data[apiField] = value;
        });

        // Update local item: mark as unsynced and update rawJson
        await db.update(getItems())
          .set({
            synced: false,
            updatedAt: Math.floor(Date.now() / 1000),  // 使用秒级时间戳
            rawJson: updatedRawJson,
            // Also update the title field if that's what changed
            ...(apiField === 'title' ? { title: value } : {})
          })
          .where(and(eq(getItems().key, key), eq(getItems().libraryId, library.id)))
          .run();

        console.log(`${symbols.success} Item updated locally!`);
        console.log(`   Changed: ${field} "${oldValue}" → "${value}"`);
        console.log(`\nRun "zotero sync" to upload changes to remote.`);
      } catch (error) {
        console.log(`${symbols.error} Failed to update item: ${error}`);
        process.exit(1);
      }
    }
  },
];
