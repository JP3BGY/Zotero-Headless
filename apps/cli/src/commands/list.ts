// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getDb, getItems, getLibraries, getCollections } from '../modules.js';
import { symbols } from '@zotero-headless/core';
import { eq, and, like, notLike, notInArray, desc, asc, count, isNull, sql } from 'drizzle-orm';
import { parseItemData } from '@zotero-headless/types';
import { formatDate, resolveCollectionPath, displayTitle } from '../utils.js';

export const listCommands: Command[] = [
  {
    name: 'list',
    aliases: ['ls', 'll', 'la', 'list:unsynced', 'lsu'],
    description: 'List items in the library',
    options: [
      { name: '--type', alias: '-t', description: 'Filter by item type', value: '<type>' },
      { name: '--dir', alias: '-d', description: 'Filter by collection path or key', value: '<path|key>' },
      { name: '--unsynced', alias: '-u', description: 'Show only unsynced items' },
      { name: '--deleted', alias: '-D', description: 'Show deleted items' },
      { name: '--since', alias: '-s', description: 'Show items updated since date', value: '<YYYY-MM-DD>' },
      { name: '--until', alias: '-e', description: 'Show items updated until date', value: '<YYYY-MM-DD>' },
      { name: '--sort', description: 'Sort by field (title|date|updated|type)', value: '<field>' },
      { name: '--order', description: 'Sort order (asc|desc)', value: '<order>' },
      { name: '--limit', alias: '-l', description: 'Limit number of results', value: '<N>' },
      { name: '--offset', alias: '-o', description: 'Offset for pagination', value: '<N>' },
      { name: '--compact', alias: '-c', description: 'Compact output format' },
      { name: '--all', alias: '-a', description: 'Show all items including child items (notes, attachments)' },
      { name: '--tree', alias: '-T', description: 'Show items in tree view with parent-child hierarchy (implies --all)' },
      { name: '--annotations', alias: '-A', description: 'Include annotations in tree view (hidden by default)' },
    ],
    examples: [
      'zotero list',
      'zotero ls ABC12345      # list children of item',
      'zotero ls -t book',
      'zotero ls -d /Genetics/Promotor',
      'zotero ls -d ABCD1234',
      'zotero la',
      'zotero ll --sort title',
    ],
    execute: async (args, invokedAs) => {
      // Handle 'unsynced' subcommand (also via list:unsynced / lsu aliases)
      const isUnsyncedAlias = invokedAs === 'list:unsynced' || invokedAs === 'lsu';
      if (isUnsyncedAlias || args[0] === 'unsynced') {
        await initModules();
        const db = getDb()();
        const items = getItems();
        const libraries = getLibraries();
        const library = await db.select().from(libraries).get();
        if (!library) {
          console.log(`${symbols.error} No library found. Run "sync" first.`);
          return;
        }
        const results = await db.select({
            key: items.key,
            title: items.title,
            itemType: items.itemType,
            rawJson: items.rawJson,
            synced: items.synced,
          })
          .from(items)
          .where(and(
            eq(items.libraryId, library.id),
            eq(items.synced, false)
          ))
          .all();
        console.log(`\nUnsynced items (${results.length}):\n`);
        if (results.length === 0) {
          console.log('   All items are synced!');
        } else {
          results.forEach(item => {
            console.log(`  [${item.key}] ${displayTitle(item)}`);
          });
        }
        return;
      }

      const isDetailed = invokedAs === 'll';  // Check if invoked as 'll'
      const isCompact = invokedAs === 'la';   // Check if invoked as 'la'
      await initModules();
      const db = getDb()();
      const items = getItems();
      const libraries = getLibraries();

      // Parse options
      const { configManager } = await import('@zotero-headless/core');
      const configLimit = configManager.get('display')?.defaultLimit || 20;

      const options: {
        type?: string;
        dir?: string;
        unsynced?: boolean;
        deleted?: boolean;
        since?: string;
        until?: string;
        sort?: 'title' | 'date' | 'updated' | 'type';
        order?: 'asc' | 'desc';
        limit: number;
        offset: number;
        compact?: boolean;
        all?: boolean;
        tree?: boolean;
        annotations?: boolean;
      } = { limit: configLimit, offset: 0 };

      const positionalArgs: string[] = [];

      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--type' || arg === '-t') {
          options.type = args[++i];
        } else if (arg === '--dir' || arg === '-d') {
          options.dir = args[++i];
        } else if (arg === '--unsynced' || arg === '-u') {
          options.unsynced = true;
        } else if (arg === '--deleted' || arg === '-D') {
          options.deleted = true;
        } else if (arg === '--since' || arg === '-s') {
          options.since = args[++i];
        } else if (arg === '--until' || arg === '-e') {
          options.until = args[++i];
        } else if (arg === '--sort') {
          options.sort = args[++i] as any;
        } else if (arg === '--order') {
          options.order = args[++i] as any;
        } else if (arg === '--limit' || arg === '-l') {
          options.limit = parseInt(args[++i]) || 20;
        } else if (arg === '--offset' || arg === '-o') {
          options.offset = parseInt(args[++i]) || 0;
        } else if (arg === '--compact' || arg === '-c') {
          options.compact = true;
        } else if (arg === '--all' || arg === '-a') {
          options.all = true;
        } else if (arg === '--tree' || arg === '-T') {
          options.tree = true;
          options.all = true;  // --tree implies --all
        } else if (arg === '--annotations' || arg === '-A') {
          options.annotations = true;
        } else if (!arg.startsWith('-')) {
          positionalArgs.push(arg);
        }
      }

      // Positional arg: if it looks like a key (non-numeric), list children of that item
      let parentItemKey: string | undefined;
      if (positionalArgs.length > 0 && isNaN(Number(positionalArgs[0]))) {
        parentItemKey = positionalArgs[0];
      } else {
        // Backward compatibility: positional args as limit/offset
        if (positionalArgs.length > 0) options.limit = parseInt(positionalArgs[0]) || 20;
        if (positionalArgs.length > 1) options.offset = parseInt(positionalArgs[1]) || 0;
      }

      // Determine output mode: compact if --compact, -c, or invoked as 'la'
      const useCompact = options.compact || isCompact;

      const library = await db.select().from(libraries).get();
      if (!library) {
        console.log(`${symbols.error} No library found. Run "sync" first.`);
        return;
      }

      // Validate parent item key if listing children
      let parentItemTitle: string | undefined;
      if (parentItemKey) {
        const parentItem = await db.select({ key: items.key, title: items.title })
          .from(items)
          .where(and(eq(items.key, parentItemKey), eq(items.libraryId, library.id)))
          .get();
        if (!parentItem) {
          console.log(`${symbols.error} Item ${parentItemKey} not found.`);
          return;
        }
        parentItemTitle = parentItem.title || '(no title)';
      }

      // Resolve collection filter
      let collectionInfo: { key: string; name: string; path: string } | null = null;
      if (options.dir) {
        collectionInfo = await resolveCollectionPath(db, library.id, options.dir);
        if (!collectionInfo) {
          console.log(`${symbols.error} Collection not found: ${options.dir}`);
          return;
        }
      }

      // Build where conditions
      let whereConditions: any = eq(items.libraryId, library.id);

      if (parentItemKey) {
        // List children of the specified item
        whereConditions = and(whereConditions, like(items.rawJson, `%"parentItem":"${parentItemKey}"%`));
      }
      if (collectionInfo) {
        whereConditions = and(whereConditions, like(items.collectionKeys, `%"${collectionInfo.key}"%`));
      }
      if (options.type) {
        whereConditions = and(whereConditions, eq(items.itemType, options.type));
      }
      if (options.unsynced) {
        whereConditions = and(whereConditions, eq(items.synced, false));
      }
      if (options.deleted) {
        whereConditions = and(whereConditions, eq(items.deleted, true));
      } else {
        // By default, hide deleted items
        whereConditions = and(whereConditions, eq(items.deleted, false));
      }
      if (!parentItemKey && !options.all) {
        // By default, show only top-level items (exclude child notes and attachments)
        // Skip this filter when listing children of a specific item
        whereConditions = and(whereConditions, notLike(items.rawJson, '%"parentItem":%'));
      }
      if (options.tree && !options.annotations) {
        // Tree view: exclude annotations by default (too many), use --annotations to include
        whereConditions = and(whereConditions, sql`${items.itemType} != 'annotation'`);
      }
      if (options.since) {
        const sinceDate = new Date(options.since).getTime();
        if (!isNaN(sinceDate)) {
          whereConditions = and(whereConditions, desc(items.updatedAt) >= sinceDate);
        }
      }
      if (options.until) {
        const untilDate = new Date(options.until).getTime();
        if (!isNaN(untilDate)) {
          whereConditions = and(whereConditions, desc(items.updatedAt) <= untilDate);
        }
      }

      // Build order by
      let orderByColumn = items.updatedAt;
      if (options.sort === 'title') orderByColumn = items.title;
      else if (options.sort === 'date') orderByColumn = items.publicationDate;
      else if (options.sort === 'type') orderByColumn = items.itemType;

      const orderDirection = options.order === 'asc' ? asc : desc;

      // Build subqueries for child counts (children are in items table with parentItem in rawJson)
      // Use raw SQL column names for outer table references to avoid Drizzle parameterization issues
      const attachmentCountSubquery = sql<number>`(
        SELECT COUNT(*) FROM items AS child
        WHERE child.item_type = 'attachment'
        AND child.library_id = items.library_id
        AND child.raw_json LIKE '%"parentItem":"' || items.key || '"%'
        AND (child.deleted IS NULL OR child.deleted = 0)
      )`.as('attachmentCount');

      const noteCountSubquery = sql<number>`(
        SELECT COUNT(*) FROM items AS child
        WHERE child.item_type = 'note'
        AND child.library_id = items.library_id
        AND child.raw_json LIKE '%"parentItem":"' || items.key || '"%'
        AND (child.deleted IS NULL OR child.deleted = 0)
      )`.as('noteCount');

      // Annotations are grandchildren: item → attachment → annotation
      const annotationCountSubquery = sql<number>`(
        SELECT COUNT(*) FROM items AS ann
        WHERE ann.item_type = 'annotation'
        AND ann.library_id = items.library_id
        AND (ann.deleted IS NULL OR ann.deleted = 0)
        AND ann.raw_json LIKE '%"parentItem":"%'
        AND EXISTS (
          SELECT 1 FROM items AS att
          WHERE att.item_type = 'attachment'
          AND att.library_id = items.library_id
          AND att.raw_json LIKE '%"parentItem":"' || items.key || '"%'
          AND ann.raw_json LIKE '%"parentItem":"' || att.key || '"%'
        )
      )`.as('annotationCount');

      const selectFields: Record<string, any> = {
        key: items.key,
        title: items.title,
        itemType: items.itemType,
        updatedAt: items.updatedAt,
        synced: items.synced,
        deleted: items.deleted,
        creators: items.creators,
        tags: items.tags,
        collectionKeys: items.collectionKeys,
        attachmentCount: attachmentCountSubquery,
        noteCount: noteCountSubquery,
        annotationCount: annotationCountSubquery,
        rawJson: items.rawJson,
      };

      const results = await db.select(selectFields)
        .from(items)
        .where(whereConditions)
        .orderBy(orderDirection(orderByColumn))
        .limit(options.limit)
        .offset(options.offset)
        .all();

      // Build filter description
      const filters: string[] = [];
      if (collectionInfo) filters.push(`dir:${collectionInfo.path}`);
      if (options.type) filters.push(`type:${options.type}`);
      if (options.unsynced) filters.push('unsynced');
      if (options.deleted) filters.push('deleted');
      if (options.tree) filters.push('tree');
      else if (options.all) filters.push('all');
      if (options.since) filters.push(`since:${options.since}`);
      if (options.until) filters.push(`until:${options.until}`);
      if (options.sort) filters.push(`sort:${options.sort}(${options.order || 'desc'})`);

      const filterDesc = filters.length > 0 ? ` (filtered: ${filters.join(', ')})` : '';
      if (parentItemKey) {
        console.log(`\nChildren of [${parentItemKey}] ${parentItemTitle} (${results.length} shown)${filterDesc}:\n`);
      } else {
        console.log(`\nItems (${results.length} shown)${filterDesc}:\n`);
      }

      if (results.length === 0) {
        console.log('   No items match the criteria.');
        return;
      }

      if (options.tree) {
        // Tree view: group items by parent-child hierarchy
        // 1. Build a map of key -> item and parentKey -> children
        const itemMap = new Map<string, typeof results[0]>();
        const childrenMap = new Map<string, typeof results>();
        const topLevel: typeof results = [];
        const orphans: typeof results = [];

        for (const item of results) {
          itemMap.set(item.key, item);
        }

        for (const item of results) {
          const data = parseItemData(item.rawJson);
          const parentKey = data.parentItem as string | undefined;
          if (!parentKey) {
            topLevel.push(item);
          } else if (itemMap.has(parentKey)) {
            if (!childrenMap.has(parentKey)) childrenMap.set(parentKey, []);
            childrenMap.get(parentKey)!.push(item);
          } else {
            orphans.push(item);
          }
        }

        // 2. Render tree
        const renderItem = (item: typeof results[0], prefix: string, isLast: boolean, isRoot: boolean) => {
          const connector = isRoot ? '' : (isLast ? '└── ' : '├── ');
          const syncIcon = item.synced ? symbols.success : '●';
          const delTag = item.deleted ? ' (deleted)' : '';
          const indent = isRoot ? '' : (isLast ? '    ' : '│   ');

          if (item.itemType === 'annotation') {
            const data = parseItemData(item.rawJson);
            const color = data.annotationColor ? ` ${data.annotationColor}` : '';
            const type = data.annotationType || 'highlight';
            console.log(`${prefix}${connector}${syncIcon} [${item.key}] ${displayTitle(item, 55)}${delTag}`);
            console.log(`${prefix}${indent}      ${type}${color} | ${formatDate(item.updatedAt)}`);
          } else {
            console.log(`${prefix}${connector}${syncIcon} [${item.key}] ${displayTitle(item, 55)}${delTag}`);
            console.log(`${prefix}${indent}      ${item.itemType} | ${formatDate(item.updatedAt)}`);
          }

          const children = childrenMap.get(item.key) || [];
          for (let i = 0; i < children.length; i++) {
            const childPrefix = prefix + (isRoot ? '' : (isLast ? '    ' : '│   '));
            renderItem(children[i], childPrefix, i === children.length - 1, false);
          }
        };

        for (const item of topLevel) {
          renderItem(item, '  ', false, true);
          console.log();
        }

        // 3. Show orphaned child items (parentItem not in result set)
        if (orphans.length > 0) {
          console.log(`  ── Orphaned items (parent not found) ──\n`);
          for (const item of orphans) {
            const data = parseItemData(item.rawJson);
            const syncIcon = item.synced ? symbols.success : '●';
            const delTag = item.deleted ? ' (deleted)' : '';
            console.log(`  ${symbols.warning} [${item.key}] ${displayTitle(item, 55)}${delTag}`);
            console.log(`        ${item.itemType} | parent: ${data.parentItem} (missing) | ${formatDate(item.updatedAt)}`);
            console.log();
          }
        }

        // 4. Summary
        const childCount = results.length - topLevel.length - orphans.length;
        console.log(`Total: ${topLevel.length} top-level, ${childCount} children, ${orphans.length} orphaned`);
        return;
      }

      if (useCompact) {
        // Compact mode: similar to ls -alF
        // Format: [sync][type] [attachments] [date] [title]
        // Indicators: / = has attachments, * = unsynced, X = deleted
        const formatCompactDate = (timestamp: number) => {
          const d = new Date(timestamp * 1000);
          const now = new Date();
          const isCurrentYear = d.getFullYear() === now.getFullYear();

          if (isCurrentYear) {
            // Same year: show "Mon DD HH:MM"
            return d.toLocaleDateString('en-US', {
              month: 'short',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit'
            }).replace(',', '');
          } else {
            // Different year: show "Mon DD  YYYY"
            return d.toLocaleDateString('en-US', {
              month: 'short',
              day: '2-digit',
              year: 'numeric'
            });
          }
        };

        results.forEach(item => {
          const syncIndicator = item.synced ? '\u2713' : '*';
          const delIndicator = item.deleted ? 'X' : ' ';
          const attCount = Number(item.attachmentCount) || 0;
          const attIndicator = attCount > 0 ? '/' : ' ';
          const attDisplay = attCount > 0 ? String(attCount).padStart(2, ' ') : '  ';

          const dateStr = formatCompactDate(item.updatedAt);
          const titleStr = displayTitle(item, 50).padEnd(50, ' ');
          const typeStr = item.itemType.padEnd(12, ' ');

          // Format: [S][D][A] [#] [date] [type] [title]
          // S = sync status, D = deleted, A = has attachments
          console.log(`${syncIndicator}${delIndicator}${attIndicator} ${attDisplay} ${dateStr}  ${typeStr}  ${titleStr}`);
        });

        // Print legend
        console.log(`\nLegend: [Sync][Del][Att] [#Att] [Date] [Type] [Title]`);
        console.log(`  Sync: \u2713=synced *=unsynced`);
        console.log(`  Del:  X=deleted  =active`);
        console.log(`  Att:  /=has attachments  =none`);
      } else if (isDetailed) {
        // Detailed mode (ll)
        results.forEach(item => {
          const syncStatus = item.synced ? symbols.success : '';
          const delStatus = item.deleted ? ' (deleted)' : '';
          console.log(`  ${syncStatus} [${item.key}] ${displayTitle(item)}${delStatus}`);

          // Line 2: type, date, key
          const meta: string[] = [];
          meta.push(`Type: ${item.itemType}`);
          meta.push(`Updated: ${formatDate(item.updatedAt)}`);
          meta.push(`Key: ${item.key}`);
          console.log(`      ${meta.join(' | ')}`);

          // Line 3: children, tags, creators
          const details: string[] = [];

          const attCount = Number(item.attachmentCount) || 0;
          const noteCount = Number(item.noteCount) || 0;
          const annCount = Number(item.annotationCount) || 0;
          if (attCount > 0) details.push(`${attCount} attachment${attCount > 1 ? 's' : ''}`);
          if (noteCount > 0) details.push(`${noteCount} note${noteCount > 1 ? 's' : ''}`);
          if (annCount > 0) details.push(`${annCount} annotation${annCount > 1 ? 's' : ''}`);

          const tagList: any[] = (() => { try { return JSON.parse(item.tags || '[]'); } catch { return []; } })();
          if (tagList.length > 0) {
            const tagNames = tagList.slice(0, 3).map((t: any) => t.tag || t).join(', ');
            const more = tagList.length > 3 ? ` +${tagList.length - 3}` : '';
            details.push(`Tags: ${tagNames}${more}`);
          }

          const creatorList: any[] = (() => { try { return JSON.parse(item.creators || '[]'); } catch { return []; } })();
          if (creatorList.length > 0) {
            const names = creatorList.slice(0, 2).map((c: any) => c.lastName || c.name || 'Unknown');
            const more = creatorList.length > 2 ? ` +${creatorList.length - 2}` : '';
            details.push(`Authors: ${names.join(', ')}${more}`);
          }

          const colList: any[] = (() => { try { return JSON.parse(item.collectionKeys || '[]'); } catch { return []; } })();
          if (colList.length > 0) {
            details.push(`${colList.length} collection${colList.length > 1 ? 's' : ''}`);
          }

          if (details.length > 0) {
            console.log(`      ${details.join(' | ')}`);
          }

          console.log();
        });
      } else {
        // Standard mode (ls)
        results.forEach(item => {
          const syncStatus = item.synced ? symbols.success : '';
          const delStatus = item.deleted ? ' (deleted)' : '';
          console.log(`  ${syncStatus} [${item.key}] ${displayTitle(item)}${delStatus}`);

          // Build metadata segments for the second line
          const meta: string[] = [];
          meta.push(item.itemType);
          meta.push(formatDate(item.updatedAt));

          const attCount = Number(item.attachmentCount) || 0;
          const noteCount = Number(item.noteCount) || 0;
          const annCount = Number(item.annotationCount) || 0;
          if (attCount > 0 || noteCount > 0 || annCount > 0) {
            const children: string[] = [];
            if (attCount > 0) children.push(`${attCount} attachment${attCount > 1 ? 's' : ''}`);
            if (noteCount > 0) children.push(`${noteCount} note${noteCount > 1 ? 's' : ''}`);
            if (annCount > 0) children.push(`${annCount} annotation${annCount > 1 ? 's' : ''}`);
            meta.push(children.join(', '));
          }

          const tagList: any[] = (() => { try { return JSON.parse(item.tags || '[]'); } catch { return []; } })();
          if (tagList.length > 0) {
            meta.push(`${tagList.length} tag${tagList.length > 1 ? 's' : ''}`);
          }

          const creatorList: any[] = (() => { try { return JSON.parse(item.creators || '[]'); } catch { return []; } })();
          if (creatorList.length > 0) {
            const first = creatorList[0];
            const name = first.lastName || first.name || 'Unknown';
            const authorStr = creatorList.length > 1 ? `${name} et al.` : name;
            meta.push(authorStr);
          }

          console.log(`      ${meta.join(' | ')}`);
          console.log();
        });
      }
    }
  },

];
