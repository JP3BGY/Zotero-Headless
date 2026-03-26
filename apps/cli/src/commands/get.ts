// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getDb, getItems, getLibraries } from '../modules.js';
import { formatDateTime } from '../utils.js';
import { symbols } from '@zotero-headless/core';
import { eq, and } from 'drizzle-orm';

export const getCommands: Command[] = [
  {
    name: 'get',
    aliases: ['show', 'cat', 'view'],
    description: 'Show item details. Aliases: show, cat, view',
    options: [
      { name: '--format', alias: '-f', description: 'Output format (json|yaml|text)', value: '<format>' },
      { name: '--attachments', alias: '-a', description: 'Include attachment info' },
    ],
    examples: [
      'zotero get ABC123',
      'zotero cat ABC123 -f json',
      'zotero show ABC123 -a',
    ],
    execute: async (args) => {
      await initModules();
      if (args.length === 0) {
        console.log(`${symbols.error} Please provide an item key`);
        console.log('   Usage: zotero get <key>');
        return;
      }

      const db = getDb()();
      const key = args[0];
      const library = await db.select().from(getLibraries()).get();

      if (!library) {
        console.log(`${symbols.error} No library found. Run "sync" first.`);
        return;
      }

      const items = getItems();
      const item = await db.select()
        .from(items)
        .where(and(eq(items.key, key), eq(items.libraryId, library.id)))
        .get();

      if (!item) {
        console.log(`${symbols.error} Item ${key} not found.`);
        return;
      }

      console.log(`\nItem: ${key}\n`);
      console.log(`   Title: ${item.title || '(none)'}`);
      console.log(`   Type: ${item.itemType}`);
      console.log(`   DOI: ${item.doi || '(none)'}`);
      console.log(`   URL: ${item.url || '(none)'}`);
      console.log(`   Date: ${item.publicationDate || '(none)'}`);
      console.log(`   Created: ${formatDateTime(item.createdAt)}`);
      console.log(`   Updated: ${formatDateTime(item.updatedAt)}`);
      console.log(`   Synced: ${item.synced ? 'Yes' : 'No'}`);
      console.log(`   Deleted: ${item.deleted ? 'Yes' : 'No'}`);

      const creators = JSON.parse(item.creators || '[]');
      if (creators.length > 0) {
        console.log(`\n   Creators:`);
        creators.forEach((c: any) => {
          console.log(`     - ${c.firstName || ''} ${c.lastName || ''} (${c.creatorType})`);
        });
      }
    }
  },
];
