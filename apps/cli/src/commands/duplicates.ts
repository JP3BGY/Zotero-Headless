// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getDb, getItems, getLibraries } from '../modules.js';
import { formatDate, displayTitle } from '../utils.js';
import { symbols } from '@zotero-headless/core';
import { parseItemData } from '@zotero-headless/types';
import { eq, and } from 'drizzle-orm';

// ============ Disjoint Set (Union-Find) ============
// Matches Zotero Desktop's Zotero.DisjointSetForest

class DisjointSetForest {
  private objects: Map<string, { id: string; parent: { id: string }; rank: number }> = new Map();

  find(id: string): string {
    if (!this.objects.has(id)) {
      this.objects.set(id, { id, parent: { id }, rank: 0 });
    }
    const obj = this.objects.get(id)!;
    if (obj.parent.id === obj.id) {
      return obj.id;
    }
    // Path compression
    const root = this.find(obj.parent.id);
    obj.parent = { id: root };
    return root;
  }

  union(xId: string, yId: string): void {
    const xRoot = this.find(xId);
    const yRoot = this.find(yId);
    if (xRoot === yRoot) return;

    const xObj = this.objects.get(xRoot)!;
    const yObj = this.objects.get(yRoot)!;

    if (xObj.rank < yObj.rank) {
      xObj.parent = { id: yRoot };
    } else if (xObj.rank > yObj.rank) {
      yObj.parent = { id: xRoot };
    } else {
      yObj.parent = { id: xRoot };
      xObj.rank++;
    }
  }

  /** Get all sets, each as an array of IDs */
  getSets(): string[][] {
    const groups = new Map<string, string[]>();
    for (const [id] of this.objects) {
      const root = this.find(id);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(id);
    }
    return [...groups.values()].filter(g => g.length > 1);
  }
}

// ============ Normalization Helpers ============

/**
 * Normalize string for comparison (matches Zotero Desktop's normalizeString):
 * - Remove diacritics
 * - Replace ASCII punctuation with spaces
 * - Trim and lowercase
 */
function normalizeString(str: string): string {
  if (!str) return '';
  str = String(str);
  // Remove diacritics (NFD decomposition + strip combining marks)
  str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Replace ASCII punctuation (! through / : through @ [ through ` { through ~) with spaces
  str = str.replace(/[!-/:-@[-`{-~]+/g, ' ');
  return str.trim().toLowerCase();
}

/** Clean and validate ISBN (matches Zotero Desktop's cleanISBN) */
function cleanISBN(isbn: string): string | false {
  isbn = isbn.replace(/[-\s]/g, '');
  if (isbn.length === 10) {
    // Validate ISBN-10 checksum
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      const d = parseInt(isbn[i]);
      if (isNaN(d)) return false;
      sum += d * (10 - i);
    }
    const check = isbn[9].toUpperCase();
    sum += check === 'X' ? 10 : parseInt(check);
    if (isNaN(sum) || sum % 11 !== 0) return false;
    return isbn;
  }
  if (isbn.length === 13) {
    // Validate ISBN-13 checksum
    let sum = 0;
    for (let i = 0; i < 13; i++) {
      const d = parseInt(isbn[i]);
      if (isNaN(d)) return false;
      sum += d * (i % 2 === 0 ? 1 : 3);
    }
    if (sum % 10 !== 0) return false;
    return isbn;
  }
  return false;
}

/** Extract year from a date string */
function extractYear(dateStr: string): string | null {
  if (!dateStr) return null;
  const match = dateStr.match(/^\d{4}/);
  return match && match[0] !== '0000' ? match[0] : null;
}

export const duplicatesCommands: Command[] = [
  {
    name: 'duplicates',
    aliases: ['dupes', 'find-duplicates'],
    description: 'Find duplicate items in library',
    options: [
      { name: '--merge', alias: '-m', description: 'Merge duplicates (keep oldest)', value: '<group-number>' },
      { name: '--delete', alias: '-d', description: 'Delete duplicates after merge' },
      { name: '--dry-run', alias: '-n', description: 'Show duplicates without merging' },
    ],
    examples: [
      'zotero duplicates',
      'zotero duplicates --dry-run',
      'zotero duplicates --merge=1',
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

      const mergeArg = args.find(arg => arg.startsWith('--merge='))?.split('=')[1];
      const deleteDups = args.includes('--delete') || args.includes('-d');
      const dryRun = args.includes('--dry-run') || args.includes('-n');

      // Get all non-deleted, non-attachment, non-note items
      const allItems = await db.select()
        .from(items)
        .where(and(
          eq(items.libraryId, library.id),
          eq(items.deleted, false)
        ));

      // Filter out attachments and notes (they aren't standalone items for dedup)
      const candidateItems = allItems.filter(item =>
        item.itemType !== 'attachment' && item.itemType !== 'note'
      );

      if (candidateItems.length === 0) {
        console.log('No items to check.');
        return;
      }

      console.log(`Scanning ${candidateItems.length} items for duplicates...`);

      const sets = new DisjointSetForest();

      // Build caches from rawJson (where the actual data lives)
      const isbnCache = new Map<string, string>();   // key -> cleaned ISBN
      const doiCache = new Map<string, string>();     // key -> uppercase DOI
      const yearCache = new Map<string, string>();    // key -> 4-digit year
      const titleCache = new Map<string, string>();   // key -> normalized title
      const creatorCache = new Map<string, { lastName: string; firstInitial: string }[]>();

      for (const item of candidateItems) {
        const data = parseItemData(item.rawJson);

        // ISBN (books only)
        const isbn = data.ISBN || item.isbn;
        if (isbn && item.itemType === 'book') {
          const cleaned = cleanISBN(String(isbn));
          if (cleaned) isbnCache.set(item.key, cleaned);
        }

        // DOI
        const doi = data.DOI || item.doi;
        if (doi && String(doi).startsWith('10.')) {
          doiCache.set(item.key, String(doi).trim().toUpperCase());
        }

        // Year
        const dateStr = data.date || item.publicationDate;
        if (dateStr) {
          const year = extractYear(String(dateStr));
          if (year) yearCache.set(item.key, year);
        }

        // Title
        const title = data.title || item.title;
        if (title) {
          const normalized = normalizeString(String(title));
          if (normalized) titleCache.set(item.key, normalized);
        }

        // Creators
        let creators = data.creators;
        if (typeof creators === 'string') {
          try { creators = JSON.parse(creators); } catch { creators = []; }
        }
        if (Array.isArray(creators) && creators.length > 0) {
          const normalized = creators.map((c: any) => {
            const lastName = normalizeString(c.lastName || c.name || '');
            const firstInitial = c.firstName ? normalizeString(c.firstName).charAt(0) : '';
            return { lastName, firstInitial };
          }).filter(c => c.lastName);
          if (normalized.length > 0) creatorCache.set(item.key, normalized);
        }
      }

      // --- Stage 1: Match by ISBN (books only) ---
      const isbnGroups = new Map<string, string[]>();
      for (const [key, isbn] of isbnCache) {
        if (!isbnGroups.has(isbn)) isbnGroups.set(isbn, []);
        isbnGroups.get(isbn)!.push(key);
      }
      for (const [, keys] of isbnGroups) {
        for (let i = 1; i < keys.length; i++) {
          sets.union(keys[0], keys[i]);
        }
      }

      // --- Stage 2: Match by DOI ---
      const doiGroups = new Map<string, string[]>();
      for (const [key, doi] of doiCache) {
        if (!doiGroups.has(doi)) doiGroups.set(doi, []);
        doiGroups.get(doi)!.push(key);
      }
      for (const [, keys] of doiGroups) {
        for (let i = 1; i < keys.length; i++) {
          sets.union(keys[0], keys[i]);
        }
      }

      // --- Stage 3: Match by normalized title + creator ---
      // Sort items by normalized title for efficient comparison
      const titleItems = candidateItems
        .filter(item => titleCache.has(item.key))
        .map(item => ({ key: item.key, title: titleCache.get(item.key)! }))
        .sort((a, b) => a.title < b.title ? -1 : a.title > b.title ? 1 : 0);

      for (let i = 0; i < titleItems.length; i++) {
        for (let j = i + 1; j < titleItems.length; j++) {
          const a = titleItems[i];
          const b = titleItems[j];

          // Titles must match (sorted, so mismatch means no more matches for i)
          if (a.title !== b.title) break;
          if (!a.title) break;

          // If both have DOIs and they differ → not duplicates
          if (doiCache.has(a.key) && doiCache.has(b.key)
              && doiCache.get(a.key) !== doiCache.get(b.key)) {
            continue;
          }

          // If both have ISBNs and they differ → not duplicates
          if (isbnCache.has(a.key) && isbnCache.has(b.key)
              && isbnCache.get(a.key) !== isbnCache.get(b.key)) {
            continue;
          }

          // If both have years and they differ by more than 1 → not duplicates
          if (yearCache.has(a.key) && yearCache.has(b.key)) {
            const diff = Math.abs(parseInt(yearCache.get(a.key)!) - parseInt(yearCache.get(b.key)!));
            if (diff > 1) continue;
          }

          // Check creator match: at least one shared creator (lastName + firstInitial)
          const aCreators = creatorCache.get(a.key);
          const bCreators = creatorCache.get(b.key);

          // If neither has creators → match
          if (!aCreators && !bCreators) {
            sets.union(a.key, b.key);
            continue;
          }

          // If only one has creators → skip (not a match)
          if (!aCreators || !bCreators) continue;

          // Check for at least one matching creator
          let creatorMatch = false;
          for (const ac of aCreators) {
            for (const bc of bCreators) {
              if (ac.lastName === bc.lastName && ac.firstInitial === bc.firstInitial) {
                creatorMatch = true;
                break;
              }
            }
            if (creatorMatch) break;
          }

          if (creatorMatch) {
            sets.union(a.key, b.key);
          }
        }
      }

      // Collect duplicate groups
      const duplicateGroups = sets.getSets();

      if (duplicateGroups.length === 0) {
        console.log('No duplicates found.');
        return;
      }

      // Build item lookup
      const itemMap = new Map<string, typeof candidateItems[0]>();
      for (const item of candidateItems) {
        itemMap.set(item.key, item);
      }

      // Count total duplicate items
      const totalDuplicateItems = duplicateGroups.reduce((sum, g) => sum + g.length, 0);
      console.log(`\nFound ${duplicateGroups.length} duplicate group(s) (${totalDuplicateItems} items total):\n`);

      // Display groups
      for (let groupNum = 0; groupNum < duplicateGroups.length; groupNum++) {
        const group = duplicateGroups[groupNum];
        const groupItems = group.map(key => itemMap.get(key)!).filter(Boolean);
        const sorted = groupItems.sort((a, b) => a.createdAt - b.createdAt);

        console.log(`Group ${groupNum + 1} (${sorted.length} items):`);
        for (const item of sorted) {
          const created = formatDate(item.createdAt);
          console.log(`  [${item.key}] ${displayTitle(item)}`);
          console.log(`      ${item.itemType} | Created: ${created}`);
          if (doiCache.has(item.key)) console.log(`      DOI: ${doiCache.get(item.key)}`);
          if (isbnCache.has(item.key)) console.log(`      ISBN: ${isbnCache.get(item.key)}`);
        }
        console.log('');
      }

      if (dryRun) {
        console.log('(--dry-run) No changes made.');
        return;
      }

      // Merge if requested
      if (mergeArg) {
        const groupIdx = parseInt(mergeArg) - 1;
        if (groupIdx < 0 || groupIdx >= duplicateGroups.length) {
          console.log(`${symbols.error} Group ${mergeArg} not found (valid: 1-${duplicateGroups.length})`);
          return;
        }

        const group = duplicateGroups[groupIdx];
        const groupItems = group.map(key => itemMap.get(key)!).filter(Boolean);
        const sorted = groupItems.sort((a, b) => a.createdAt - b.createdAt);
        const keep = sorted[0];
        const toDelete = sorted.slice(1);

        console.log(`Merging group ${mergeArg}: keeping [${keep.key}] "${displayTitle(keep)}"`);
        for (const item of toDelete) {
          console.log(`  Deleting: [${item.key}] ${displayTitle(item)}`);
          await db.update(items)
            .set({
              deleted: true,
              deletedAt: Math.floor(Date.now() / 1000),
              synced: false,
              updatedAt: Math.floor(Date.now() / 1000),
            })
            .where(and(eq(items.key, item.key), eq(items.libraryId, library.id)));
        }
        console.log(`${symbols.success} Merged: kept 1, deleted ${toDelete.length}`);
        return;
      }

      console.log('To merge a group:');
      console.log('  zotero duplicates --merge=<group-number>');
    }
  },
];
