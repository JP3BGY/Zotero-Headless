// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getDb, getItems, getLibraries } from '../modules.js';
import { formatDateTime } from '../utils.js';
import { symbols } from '@zotero-headless/core';
import { eq, and, count } from 'drizzle-orm';

export const statsCommands: Command[] = [
  {
    name: 'stats',
    aliases: ['st', 'info', 'status', 'df'],
    description: 'Show library statistics. Aliases: st, info, status, df',
    options: [
      { name: '--type', alias: '-t', description: 'Show stats for specific item type', value: '<type>' },
      { name: '--group', alias: '-g', description: 'Show stats by group library' },
    ],
    examples: [
      'zotero stats',
      'zotero stats -t book',
      'zotero stats --group',
    ],
    execute: async () => {
      await initModules();
      const db = getDb()();
      const items = getItems();
      const libraries = getLibraries();

      const library = await db.select().from(libraries).get();
      if (!library) {
        console.log(`${symbols.error} No library found. Run "sync" first.`);
        return;
      }

      const totalResult = await db.select({ count: count() })
        .from(items)
        .where(eq(items.libraryId, library.id))
        .get();

      const deletedResult = await db.select({ count: count() })
        .from(items)
        .where(and(eq(items.libraryId, library.id), eq(items.deleted, true)))
        .get();

      const unsyncedResult = await db.select({ count: count() })
        .from(items)
        .where(and(eq(items.libraryId, library.id), eq(items.synced, false)))
        .get();

      console.log('\nLibrary Statistics:\n');
      console.log(`   Library: ${library.name || 'My Library'}`);
      console.log(`   Zotero ID: ${library.zoteroId}`);
      console.log(`   Version: ${library.version}`);
      console.log(`   Last Sync: ${formatDateTime(library.lastSyncAt) || 'Never'}`);
      console.log(`   ─────────────────────`);
      console.log(`   Total Items: ${totalResult?.count ?? 0}`);
      console.log(`   Deleted: ${deletedResult?.count ?? 0}`);
      console.log(`   Unsynced: ${unsyncedResult?.count ?? 0}`);
      console.log();
    }
  },
];
