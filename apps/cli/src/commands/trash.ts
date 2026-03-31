// @ts-nocheck

import type { Command } from '../types.js';
import { isShellMode } from '../types.js';
import { initModules, getDb, getItems, getLibraries, getAttachments, getLogDeletion } from '../modules.js';
import { formatDate, displayTitle } from '../utils.js';
import { symbols } from '@zotero-headless/core';
import { t } from '../i18n.js';
import { isInteractive, createPrompt } from '../conflict-resolver.js';
import { eq, and, desc, count } from 'drizzle-orm';

// Alias-to-subcommand mapping for backward compatibility
const TRASH_ALIAS_MAP: Record<string, string> = {
  'trash:list': 'list',
  'trash:view': 'list',
  'trashed': 'list',
  'deleted-items': 'list',
  'trash:empty': 'empty',
  'trash:clear': 'empty',
  'empty-trash': 'empty',
  'restore': 'restore',
  'undelete': 'restore',
  'untrash': 'restore',
};

async function executeTrashList(args: string[]) {
  await initModules();

  const db = getDb()();
  const items = getItems();
  const libraries = getLibraries();
  const library = await db.select().from(libraries).get();

  if (!library) {
    console.log(`${symbols.error} No library found. Run "sync" first.`);
    return;
  }

  // Count trashed items
  const countResult = await db.select({ count: count() })
    .from(items)
    .where(and(
      eq(items.libraryId, library.id),
      eq(items.deleted, true)
    ));
  const trashCount = countResult[0]?.count || 0;

  if (args.includes('--count') || args.includes('-c')) {
    console.log(`Trash: ${trashCount} item(s)`);
    return;
  }

  // Get items in trash (deleted = true)
  const trashedItems = await db.select()
    .from(items)
    .where(and(
      eq(items.libraryId, library.id),
      eq(items.deleted, true)
    ))
    .orderBy(desc(items.deletedAt));

  if (trashedItems.length === 0) {
    console.log('Trash is empty.');
    return;
  }

  console.log(`\nItems in trash (${trashedItems.length}):\n`);
  for (const item of trashedItems) {
    const deletedAt = item.deletedAt ? formatDate(item.deletedAt) : 'unknown';
    console.log(`  [${item.key}] ${displayTitle(item)}`);
    console.log(`      Type: ${item.itemType} | Deleted: ${deletedAt}`);
  }
  console.log('\nTo restore: zotero trash restore <key>');
  console.log('To empty: zotero trash empty');
}

async function executeTrashRestore(args: string[]) {
  await initModules();

  const db = getDb()();
  const items = getItems();
  const libraries = getLibraries();
  const library = await db.select().from(libraries).get();

  if (!library) {
    console.log(`${symbols.error} No library found. Run "sync" first.`);
    return;
  }

  const restoreAll = args.includes('--all') || args.includes('-a');

  if (restoreAll) {
    // Restore all items
    const trashedItems = await db.select()
      .from(items)
      .where(and(
        eq(items.libraryId, library.id),
        eq(items.deleted, true)
      ));

    if (trashedItems.length === 0) {
      console.log('No items to restore.');
      return;
    }

    console.log(`Restoring ${trashedItems.length} item(s) from trash...`);
    for (const item of trashedItems) {
      await db.update(items)
        .set({
          deleted: false,
          deletedAt: null,
          version: item.version + 1,
          synced: false
        })
        .where(eq(items.key, item.key));
    }
    console.log(`${symbols.success} Restored ${trashedItems.length} item(s) from trash`);
    return;
  }

  // Restore single item
  const key = args.find(arg => !arg.startsWith('-'));
  if (!key) {
    console.log('Usage: zotero trash restore <key>');
    console.log('       zotero trash restore --all');
    return;
  }

  const item = await db.select()
    .from(items)
    .where(and(eq(items.key, key), eq(items.libraryId, library.id)))
    .get();

  if (!item) {
    console.log(`${symbols.error} Item ${key} not found`);
    return;
  }

  if (!item.deleted) {
    console.log(`${symbols.info} Item ${key} is not in trash`);
    return;
  }

  await db.update(items)
    .set({
      deleted: false,
      deletedAt: null,
      version: item.version + 1,
      synced: false
    })
    .where(eq(items.key, key));

  console.log(`${symbols.success} Restored item ${key} from trash`);
}

async function executeTrashEmpty(args: string[]) {
  await initModules();

  if (!isShellMode()) {
    console.log(`${symbols.warning} ${t('commands.delete.shellOnly')}`);
    console.log('   Use "zotero shell" to access shell mode.');
    return;
  }

  const db = getDb()();
  const items = getItems();
  const libraries = getLibraries();
  const attachmentsTable = getAttachments();
  const logDeletion = getLogDeletion();
  const library = await db.select().from(libraries).get();

  if (!library) {
    console.log(`${symbols.error} No library found.`);
    return;
  }

  const skipConfirm = args.includes('--yes') || args.includes('-y');
  const dryRun = args.includes('--dry-run') || args.includes('-n');

  const trashedItems = await db.select()
    .from(items)
    .where(and(
      eq(items.libraryId, library.id),
      eq(items.deleted, true)
    ));

  if (trashedItems.length === 0) {
    console.log('Trash is already empty.');
    return;
  }

  if (dryRun) {
    console.log(`Would permanently delete ${trashedItems.length} item(s):`);
    for (const item of trashedItems) {
      console.log(`  [${item.key}] ${displayTitle(item)}`);
    }
    return;
  }

  if (!skipConfirm && !isShellMode() && isInteractive()) {
    const rl = createPrompt();
    const answer = await new Promise<string>((resolve) => {
      rl.question(
        `Permanently delete ${trashedItems.length} item(s)? This cannot be undone (y/N): `,
        (ans) => resolve(ans)
      );
      rl.close();

      if (!['y', 'yes'].includes(answer.trim().toLowerCase())) {
        console.log('Cancelled.');
        return;
      }
    });
  }

  // Permanently delete items
  console.log(`Permanently deleting ${trashedItems.length} item(s)...`);
  for (const item of trashedItems) {
    // Log deletion before permanent delete
    if (logDeletion) {
      await logDeletion.logDeletion({
        itemKey: item.key,
        libraryId: library.id,
        title: item.title,
        itemType: item.itemType,
        operationType: 'hard',
        caller: 'cli',
        rawJsonSnapshot: item.rawJson
      });
    }

    await db.delete(items)
      .where(eq(items.key, item.key));

    // Also delete attachments
    await db.delete(attachmentsTable)
      .where(eq(attachmentsTable.parentItemKey, item.key));
  }

  console.log(`${symbols.success} Emptied trash: ${trashedItems.length} item(s) permanently deleted`);
}

export const trashCommands: Command[] = [
  {
    name: 'trash',
    aliases: [
      'trash:list', 'trash:view', 'trashed', 'deleted-items',
      'trash:empty', 'trash:clear', 'empty-trash',
      'restore', 'undelete', 'untrash',
    ],
    description: 'Trash management. Subcommands: list (default), empty, restore',
    options: [
      { name: '--list', alias: '-l', description: 'List items in trash' },
      { name: '--count', alias: '-c', description: 'Show trash item count' },
      { name: '--all', alias: '-a', description: 'Restore all items (with restore subcommand)' },
      { name: '--yes', alias: '-y', description: 'Skip confirmation (with empty subcommand)' },
      { name: '--dry-run', alias: '-n', description: 'Preview action without executing' },
    ],
    examples: [
      'zotero trash',
      'zotero trash list',
      'zotero trash empty',
      'zotero trash empty --dry-run',
      'zotero trash restore ABCD1234',
      'zotero trash restore --all',
    ],
    execute: async (args, invokedAs) => {
      // Resolve subcommand from alias or first arg
      let subcommand = TRASH_ALIAS_MAP[invokedAs || ''];
      let subArgs: string[];

      if (subcommand) {
        subArgs = args;
      } else {
        const validSubs = ['list', 'empty', 'restore'];
        if (validSubs.includes(args[0])) {
          subcommand = args[0];
          subArgs = args.slice(1);
        } else {
          // Default: list
          subcommand = 'list';
          subArgs = args;
        }
      }

      switch (subcommand) {
        case 'list':
          return executeTrashList(subArgs);
        case 'empty':
          return executeTrashEmpty(subArgs);
        case 'restore':
          return executeTrashRestore(subArgs);
      }
    }
  },
];
