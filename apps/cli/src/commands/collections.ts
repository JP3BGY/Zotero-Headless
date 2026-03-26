// @ts-nocheck

import { eq, and, asc, notLike } from 'drizzle-orm';
import { symbols, appConfig } from '@zotero-headless/core';
import { Command } from '../types.js';
import { initModules, getDb, getItems, getCollections, getLibraries } from '../modules.js';
import { generateKey, resolveCollectionPath } from '../utils.js';

export const collectionsCommands: Command[] = [

  // ============ Collections Management ============

  {
    name: 'collections',
    aliases: ['col', 'folder'],
    description: 'Manage collections (folders). Use subcommands to list, create, or manage collections',
    options: [
      { name: '--list', alias: '-l', description: 'List all collections' },
      { name: '--create', alias: '-c', description: 'Create a new collection', value: '<name>' },
      { name: '--parent', alias: '-p', description: 'Parent collection key for nested collections', value: '<key>' },
      { name: '--add-item', description: 'Add item to collection', value: '<collection-key> <item-key>' },
      { name: '--remove-item', description: 'Remove item from collection', value: '<collection-key> <item-key>' },
      { name: '--delete', alias: '-d', description: 'Delete a collection', value: '<key>' },
    ],
    examples: [
      'zotero collections --list',
      'zotero collections --create "My Papers"',
      'zotero collections --create "Subfolder" --parent ABCD1234',
      'zotero collections --add-item ABCD1234 WXYZ5678',
      'zotero collections --remove-item ABCD1234 WXYZ5678',
      'zotero collections --delete ABCD1234',
    ],
    execute: async (args) => {
      await initModules();

      const db = getDb()();
      const items = getItems();
      const collections = getCollections();
      const listIndex = args.indexOf('--list');
      const createIndex = args.indexOf('--create');
      const addItemIndex = args.indexOf('--add-item');
      const removeItemIndex = args.indexOf('--remove-item');
      const deleteIndex = args.indexOf('--delete');

      // List collections
      if (listIndex >= 0 || args.length === 0) {
        // Note: Filtering by deleted requires SQLite boolean handling, so just get all and filter in JS
        const allCols = await db.select()
          .from(collections)
          .orderBy(asc(collections.name));

        // Filter out deleted collections in JavaScript
        const cols = allCols.filter(c => !c.deleted);

        if (cols.length === 0) {
          console.log('   No collections found.');
          return;
        }

        console.log(`\nCollections (${cols.length}):\n`);
        for (const col of cols) {
          const parentInfo = col.parentKey ? ` (parent: ${col.parentKey})` : ' (root)';
          console.log(`  [${col.key}] ${col.name}${parentInfo}`);
        }
        return;
      }

      // Create collection
      if (createIndex >= 0) {
        const name = args[createIndex + 1];
        const parentArg = args.find(arg => arg.startsWith('--parent='))?.split('=')[1] ||
                         args.find(arg => arg.startsWith('-p'))?.substring(2);

        if (!name) {
          console.log('Usage: zotero collections --create <name> [--parent=<key>]');
          return;
        }

        const newKey = generateKey();
        const now = Math.floor(Date.now() / 1000);

        await db.insert(collections)
          .values({
            key: newKey,
            libraryId: appConfig.zotero.userId,
            name,
            parentKey: parentArg || null,
            version: 0,
            createdAt: now,
            updatedAt: now,
            deleted: false,
            rawJson: JSON.stringify({ name, parentKey: parentArg || null })
          });

        console.log(`${symbols.success} Created collection "${name}" with key ${newKey}`);
        return;
      }

      // Add item to collection
      if (addItemIndex >= 0) {
        const collectionKey = args[addItemIndex + 1];
        const itemKey = args[addItemIndex + 2];

        if (!collectionKey || !itemKey) {
          console.log('Usage: zotero collections --add-item <collection-key> <item-key>');
          return;
        }

        // Verify collection exists
        const col = await db.select()
          .from(collections)
          .where(eq(collections.key, collectionKey))
          .get();

        if (!col) {
          console.log(`${symbols.error} Collection ${collectionKey} not found`);
          return;
        }

        // Verify item exists
        const item = await db.select()
          .from(items)
          .where(eq(items.key, itemKey))
          .get();

        if (!item) {
          console.log(`${symbols.error} Item ${itemKey} not found`);
          return;
        }

        // Parse existing collection keys
        const existingCollectionKeys: string[] = JSON.parse(item.collectionKeys || '[]');
        if (existingCollectionKeys.includes(collectionKey)) {
          console.log(`${symbols.info} Item already in collection`);
          return;
        }

        // Add collection key
        const newCollectionKeys = [...existingCollectionKeys, collectionKey];
        await db.update(items)
          .set({ collectionKeys: JSON.stringify(newCollectionKeys), version: item.version + 1 })
          .where(eq(items.key, itemKey));

        console.log(`${symbols.success} Added item ${itemKey} to collection ${collectionKey}`);
        return;
      }

      // Remove item from collection
      if (removeItemIndex >= 0) {
        const collectionKey = args[removeItemIndex + 1];
        const itemKey = args[removeItemIndex + 2];

        if (!collectionKey || !itemKey) {
          console.log('Usage: zotero collections --remove-item <collection-key> <item-key>');
          return;
        }

        // Get item
        const item = await db.select()
          .from(items)
          .where(eq(items.key, itemKey))
          .get();

        if (!item) {
          console.log(`${symbols.error} Item ${itemKey} not found`);
          return;
        }

        // Parse and filter collection keys
        const existingCollectionKeys: string[] = JSON.parse(item.collectionKeys || '[]');
        const newCollectionKeys = existingCollectionKeys.filter(k => k !== collectionKey);

        if (newCollectionKeys.length === existingCollectionKeys.length) {
          console.log(`${symbols.info} Item not in collection`);
          return;
        }

        await db.update(items)
          .set({ collectionKeys: JSON.stringify(newCollectionKeys), version: item.version + 1 })
          .where(eq(items.key, itemKey));

        console.log(`${symbols.success} Removed item ${itemKey} from collection ${collectionKey}`);
        return;
      }

      // Delete collection
      if (deleteIndex >= 0) {
        const collectionKey = args[deleteIndex + 1];

        if (!collectionKey) {
          console.log('Usage: zotero collections --delete <key>');
          return;
        }

        // Verify collection exists
        const col = await db.select()
          .from(collections)
          .where(eq(collections.key, collectionKey))
          .get();

        if (!col) {
          console.log(`${symbols.error} Collection ${collectionKey} not found`);
          return;
        }

        // Soft delete
        await db.update(collections)
          .set({ deleted: true, version: col.version + 1 })
          .where(eq(collections.key, collectionKey));

        console.log(`${symbols.success} Deleted collection ${collectionKey}`);
        return;
      }

      // Default: show help
      console.log('Collections Management Commands:');
      console.log('  zotero collections --list                         List all collections');
      console.log('  zotero collections --create <name>               Create collection');
      console.log('  zotero collections --create <name> --parent <key> Create nested collection');
      console.log('  zotero collections --add-item <col> <item>        Add item to collection');
      console.log('  zotero collections --remove-item <col> <item>    Remove item from collection');
      console.log('  zotero collections --delete <key>                Delete collection');
    }
  },

  // ============ Collection Tree ============

  {
    name: 'tree',
    aliases: ['tr'],
    description: 'Show collection hierarchy as a tree',
    options: [
      { name: '--root', alias: '-r', description: 'Start from a specific collection (path or key)', value: '<path|key>' },
      { name: '--depth', alias: '-d', description: 'Max depth to display', value: '<N>' },
      { name: '--items', alias: '-i', description: 'Show item count per collection' },
    ],
    examples: [
      'zotero tree',
      'zotero tree -r /Genetics',
      'zotero tree -r ABCD1234 -d 2',
      'zotero tree -i',
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

      // Parse options
      let rootPath: string | undefined;
      let maxDepth = Infinity;
      let showItems = false;

      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--root' || arg === '-r') {
          rootPath = args[++i];
        } else if (arg === '--depth' || arg === '-d') {
          maxDepth = parseInt(args[++i]) || Infinity;
        } else if (arg === '--items' || arg === '-i') {
          showItems = true;
        }
      }

      // Fetch all active collections
      const allCols = await db.select()
        .from(collections)
        .where(and(eq(collections.libraryId, library.id), eq(collections.deleted, false)))
        .orderBy(asc(collections.name))
        .all();

      if (allCols.length === 0) {
        console.log('   No collections found.');
        return;
      }

      // Build item counts per collection if requested
      const itemCounts = new Map<string, number>();
      if (showItems) {
        const allItems = await db.select({ collectionKeys: items.collectionKeys })
          .from(items)
          .where(and(
            eq(items.libraryId, library.id),
            eq(items.deleted, false),
            notLike(items.rawJson, '%"parentItem":%')
          ))
          .all();
        for (const item of allItems) {
          const keys: string[] = (() => { try { return JSON.parse(item.collectionKeys || '[]'); } catch { return []; } })();
          for (const k of keys) {
            itemCounts.set(k, (itemCounts.get(k) || 0) + 1);
          }
        }
      }

      // Build tree structure
      const childrenOf = new Map<string | null, typeof allCols>();
      for (const col of allCols) {
        const parentKey = col.parentKey || null;
        if (!childrenOf.has(parentKey)) childrenOf.set(parentKey, []);
        childrenOf.get(parentKey)!.push(col);
      }

      // Resolve root if specified
      let rootKey: string | null = null;
      if (rootPath) {
        const resolved = await resolveCollectionPath(db, library.id, rootPath);
        if (!resolved) {
          console.log(`${symbols.error} Collection not found: ${rootPath}`);
          return;
        }
        rootKey = resolved.key;
        console.log(`\nCollection tree: ${resolved.path}\n`);
      } else {
        console.log(`\nCollection tree:\n`);
      }

      // Recursive tree printer
      const printTree = (parentKey: string | null, prefix: string, depth: number) => {
        if (depth >= maxDepth) return;
        const children = childrenOf.get(parentKey) || [];
        children.forEach((col, idx) => {
          const isLast = idx === children.length - 1;
          const connector = isLast ? '└── ' : '├── ';
          const countStr = showItems ? ` (${itemCounts.get(col.key) || 0})` : '';
          console.log(`${prefix}${connector}${col.name} [${col.key}]${countStr}`);
          const childPrefix = prefix + (isLast ? '    ' : '│   ');
          printTree(col.key, childPrefix, depth + 1);
        });
      };

      printTree(rootKey, '', 0);

      // Summary
      const totalShown = rootKey
        ? (function countAll(key: string | null): number {
            const ch = childrenOf.get(key) || [];
            return ch.length + ch.reduce((sum, c) => sum + countAll(c.key), 0);
          })(rootKey)
        : allCols.length;
      console.log(`\n${totalShown} collection${totalShown !== 1 ? 's' : ''} total`);
    }
  },

];
