// @ts-nocheck

import { eq, and } from 'drizzle-orm';
import { symbols } from '@zotero-headless/core';
import { parseItemData, updateItemData } from '@zotero-headless/types';
import type { Command } from '../types.js';
import { initModules, getDb, getItems, getCollections, getLibraries } from '../modules.js';
import { resolveCollectionPath, displayTitle } from '../utils.js';

export const mvCommands: Command[] = [
  {
    name: 'mv',
    aliases: ['move'],
    description: 'Move items between collections or reparent collections',
    options: [
      { name: '--add', alias: '-a', description: 'Keep item in existing collections (add instead of move)' },
      { name: '--dry-run', alias: '-n', description: 'Preview changes without applying them' },
    ],
    examples: [
      'zotero mv ABCD1234 /Genetics            # Move item to collection',
      'zotero mv ABCD1234 /Genetics --add       # Add item to collection (keep existing)',
      'zotero mv ABCD1234 /                     # Remove item from all collections',
      'zotero mv /Old/Sub /NewParent            # Reparent a collection',
      'zotero mv /Parent/Child /                # Move collection to root level',
    ],
    execute: async (args) => {
      await initModules();

      const db = getDb()();
      const items = getItems();
      const collections = getCollections();
      const libraries = getLibraries();

      const library = await db.select().from(libraries).get();
      if (!library) {
        console.log(`${symbols.error} No library found. Run "sync" first.`);
        return;
      }

      // Parse flags
      const addMode = args.includes('--add') || args.includes('-a');
      const dryRun = args.includes('--dry-run') || args.includes('-n');

      // Extract positional args (skip flags)
      const positional: string[] = [];
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--add' || arg === '-a' || arg === '--dry-run' || arg === '-n') continue;
        positional.push(arg);
      }

      if (positional.length < 2) {
        console.log('Usage: zotero mv <source> <destination> [--add] [--dry-run]');
        console.log('');
        console.log('  source:      item key or collection path/key');
        console.log('  destination:  collection path/key, or "/" for root');
        console.log('');
        console.log('Options:');
        console.log('  --add, -a      Keep item in existing collections');
        console.log('  --dry-run, -n  Preview without making changes');
        return;
      }

      const sourcePath = positional[0];
      const destPath = positional[1];

      // Resolve destination
      let destCollection: { key: string; name: string; path: string } | null = null;
      const isRoot = destPath === '/';

      if (!isRoot) {
        destCollection = await resolveCollectionPath(db, library.id, destPath);
        if (!destCollection) {
          console.log(`${symbols.error} Destination collection not found: ${destPath}`);
          return;
        }
      }

      // Try resolving source as collection first
      const sourceCollection = await resolveCollectionPath(db, library.id, sourcePath);

      if (sourceCollection) {
        // === Collection reparent ===
        if (addMode) {
          console.log(`${symbols.error} --add flag is not valid for collection moves`);
          return;
        }

        const destKey = isRoot ? null : destCollection!.key;

        // Cycle detection: walk from destination up to root, ensure source is not an ancestor
        if (destKey) {
          const allCols = await db.select()
            .from(collections)
            .where(and(eq(collections.libraryId, library.id), eq(collections.deleted, false)))
            .all();
          const byKey = new Map<string, any>();
          for (const c of allCols) byKey.set(c.key, c);

          let current = destKey;
          while (current) {
            if (current === sourceCollection.key) {
              console.log(`${symbols.error} Cannot move collection under its own descendant (would create a cycle)`);
              return;
            }
            const parent = byKey.get(current);
            current = parent?.parentKey || null;
          }
        }

        // Check if already in the right place
        const col = await db.select()
          .from(collections)
          .where(eq(collections.key, sourceCollection.key))
          .get();

        if ((col.parentKey || null) === destKey) {
          console.log(`${symbols.info} Collection "${sourceCollection.name}" is already ${isRoot ? 'at root level' : `under ${destCollection!.path}`}`);
          return;
        }

        const destLabel = isRoot ? '/ (root)' : destCollection!.path;

        if (dryRun) {
          console.log(`[dry-run] Would move collection "${sourceCollection.name}" [${sourceCollection.key}] → ${destLabel}`);
          return;
        }

        // Update parentKey in rawJson
        let updatedRawJson = col.rawJson;
        if (updatedRawJson) {
          try {
            const envelope = JSON.parse(updatedRawJson);
            const data = envelope.data || envelope;
            data.parentCollection = destKey || false;
            updatedRawJson = JSON.stringify(envelope);
          } catch { /* keep original */ }
        }

        await db.update(collections)
          .set({
            parentKey: destKey,
            rawJson: updatedRawJson,
            synced: false,
            updatedAt: Math.floor(Date.now() / 1000),
          })
          .where(eq(collections.key, sourceCollection.key));

        console.log(`${symbols.success} Moved collection "${sourceCollection.name}" → ${destLabel}`);
        return;
      }

      // === Item move ===
      const item = await db.select()
        .from(items)
        .where(and(eq(items.key, sourcePath), eq(items.libraryId, library.id)))
        .get();

      if (!item) {
        console.log(`${symbols.error} No item or collection found: ${sourcePath}`);
        return;
      }

      const data = parseItemData(item.rawJson);
      const existingColKeys: string[] = data.collections || [];
      const title = displayTitle(item);

      let newColKeys: string[];

      if (isRoot) {
        // Move to "/" means remove from all collections
        newColKeys = [];
      } else if (addMode) {
        // Add mode: keep existing, append destination
        if (existingColKeys.includes(destCollection!.key)) {
          console.log(`${symbols.info} Item "${title}" is already in ${destCollection!.path}`);
          return;
        }
        newColKeys = [...existingColKeys, destCollection!.key];
      } else {
        // Move mode: replace all with destination only
        newColKeys = [destCollection!.key];
      }

      // Build human-readable summary
      const destLabel = isRoot ? '/ (no collection)' : destCollection!.path;

      if (dryRun) {
        console.log(`[dry-run] Would move item "${title}" [${item.key}]`);
        if (existingColKeys.length > 0) {
          console.log(`  From: ${existingColKeys.join(', ')}`);
        } else {
          console.log(`  From: (no collection)`);
        }
        console.log(`  To:   ${destLabel}`);
        if (addMode) console.log(`  Mode: add (keeping existing collections)`);
        return;
      }

      const updatedRawJson = updateItemData(item.rawJson, (d) => {
        d.collections = newColKeys;
      });

      await db.update(items)
        .set({
          rawJson: updatedRawJson,
          collectionKeys: JSON.stringify(newColKeys),
          synced: false,
        })
        .where(eq(items.key, item.key));

      if (addMode) {
        console.log(`${symbols.success} Added item "${title}" to ${destCollection!.path}`);
      } else if (isRoot) {
        console.log(`${symbols.success} Removed item "${title}" from all collections`);
      } else {
        console.log(`${symbols.success} Moved item "${title}" → ${destCollection!.path}`);
      }
    },
  },
];
