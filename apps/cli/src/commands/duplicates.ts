// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getDb, getItems, getLibraries } from '../modules.js';
import { formatDate } from '../utils.js';
import { symbols } from '@zotero-headless/core';
import { eq, and } from 'drizzle-orm';

export const duplicatesCommands: Command[] = [
  {
    name: 'duplicates',
    aliases: ['dupes', 'find-duplicates'],
    description: 'Find duplicate items in library',
    options: [
      { name: '--match-doi', description: 'Match by DOI' },
      { name: '--match-isbn', description: 'Match by ISBN' },
      { name: '--match-title', description: 'Match by title (exact)' },
      { name: '--fuzzy-title', description: 'Match by title (fuzzy)' },
      { name: '--merge', alias: '-m', description: 'Merge duplicates (keep oldest)', value: '<group-key>' },
      { name: '--delete', alias: '-d', description: 'Delete duplicates after merge' },
      { name: '--dry-run', alias: '-n', description: 'Show duplicates without merging' },
    ],
    examples: [
      'zotero duplicates',
      'zotero duplicates --match-doi',
      'zotero duplicates --fuzzy-title',
      'zotero duplicates --dry-run',
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

      // Get all non-deleted items
      const allItems = await db.select()
        .from(items)
        .where(and(
          eq(items.libraryId, library.id),
          eq(items.deleted, false)
        ));

      const matchDoi = args.includes('--match-doi');
      const matchIsbn = args.includes('--match-isbn');
      const matchTitle = args.includes('--match-title');
      const fuzzyTitle = args.includes('--fuzzy-title');
      const mergeArg = args.find(arg => arg.startsWith('--merge='))?.split('=')[1];
      const deleteDups = args.includes('--delete') || args.includes('-d');
      const dryRun = args.includes('--dry-run') || args.includes('-n');

      // Default: match by DOI and ISBN
      const useDoi = matchDoi || (!matchIsbn && !matchTitle && !fuzzyTitle);
      const useIsbn = matchIsbn || (!matchDoi && !matchTitle && !fuzzyTitle);
      const useTitleExact = matchTitle;
      const useTitleFuzzy = fuzzyTitle;

      // Group items by duplicate key
      const groups = new Map<string, typeof allItems>();

      for (const item of allItems) {
        let key: string | null = null;

        if (useDoi && item.doi) {
          key = `doi:${item.doi.toLowerCase()}`;
        }
        if (!key && useIsbn && item.isbn) {
          key = `isbn:${item.isbn.replace(/[-\s]/g, '')}`;
        }
        if (!key && (useTitleExact || useTitleFuzzy)) {
          const title = item.title?.toLowerCase().trim() || '';
          if (useTitleExact) {
            key = `title:${title}`;
          } else if (useTitleFuzzy && title.length > 5) {
            const words = title.split(/\s+/).slice(0, 3).join(' ');
            key = `title:${words}`;
          }
        }

        if (key && key.length > 5) {
          if (!groups.has(key)) {
            groups.set(key, []);
          }
          groups.get(key)!.push(item);
        }
      }

      // Filter to groups with duplicates (more than 1 item)
      const duplicates: typeof allItems[] = [];
      for (const [key, groupItems] of groups) {
        if (groupItems.length > 1) {
          duplicates.push(...groupItems);
        }
      }

      if (duplicates.length === 0) {
        console.log('No duplicates found.');
        return;
      }

      console.log(`\nFound ${duplicates.length} items in potential duplicate groups:\n`);

      // Show duplicate groups
      let groupNum = 0;
      const itemToGroup = new Map<string, number>();
      for (const [key, groupItems] of groups) {
        if (groupItems.length > 1) {
          groupNum++;
          console.log(`\nGroup ${groupNum} (${groupItems.length} items):`);
          const sorted = groupItems.sort((a, b) => a.createdAt - b.createdAt);
          for (const item of sorted) {
            itemToGroup.set(item.key, groupNum);
            const created = formatDate(item.createdAt);
            console.log(`  [${item.key}] ${item.title || '(no title)'}`);
            console.log(`      ${item.itemType} | Created: ${created}`);
            if (item.doi) console.log(`      DOI: ${item.doi}`);
            if (item.isbn) console.log(`      ISBN: ${item.isbn}`);
          }
        }
      }

      if (dryRun) {
        console.log('\n(--dry-run) No changes made.');
        return;
      }

      // Merge duplicates if requested
      if (mergeArg) {
        const groupKey = parseInt(mergeArg);
        let targetGroup: typeof allItems = [];

        groupNum = 0;
        for (const [key, groupItems] of groups) {
          if (groupItems.length > 1) {
            groupNum++;
            if (groupNum === groupKey) {
              targetGroup = groupItems;
              break;
            }
          }
        }

        if (targetGroup.length === 0) {
          console.log(`${symbols.error} Group ${groupKey} not found`);
          return;
        }

        // Keep oldest, mark others as deleted
        const sorted = targetGroup.sort((a, b) => a.createdAt - b.createdAt);
        const keep = sorted[0];
        const toDelete = sorted.slice(1);

        console.log(`\nMerging group ${groupKey}: keeping [${keep.key}]`);
        for (const item of toDelete) {
          console.log(`  Deleting: [${item.key}] ${item.title || '(no title)'}`);
          await db.update(items)
            .set({
              deleted: true,
              deletedAt: Math.floor(Date.now() / 1000),
              version: item.version + 1,
              synced: false
            })
            .where(eq(items.key, item.key));
        }
        console.log(`${symbols.success} Merged ${toDelete.length} duplicates`);
      }

      console.log('\nTo merge duplicates:');
      console.log('  zotero duplicates --merge=<group-number>');
      console.log('  zotero duplicates --merge=<group-number> --delete');
    }
  },
];
