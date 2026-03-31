// @ts-nocheck

import { type Command, isShellMode } from '../types.js';
import { initModules, getDb, getItems, getLibraries, getLogDeletion, getZoteroApi } from '../modules.js';
import { symbols } from '@zotero-headless/core';
import { eq, and, like, count } from 'drizzle-orm';
import { isInteractive, createPrompt } from '../conflict-resolver.js';
import { t } from '../i18n.js';
import { updateItemData } from '@zotero-headless/types';
import { displayTitle } from '../utils.js';

export const deleteCommands: Command[] = [
  {
    name: 'delete',
    aliases: ['d', 'del', 'rm'],
    description: 'Delete (trash) an item. Aliases: rm, del, d. Options: -p/--permanent, -f/--force, -n/--dry-run',
    options: [
      { name: '--force', alias: '-f', description: 'Permanently delete - shell mode only' },
      { name: '--permanent', alias: '-p', description: 'Same as --force - shell mode only' },
      { name: '--yes', alias: '-y', description: 'Skip confirmation prompt' },
      { name: '--dry-run', alias: '-n', description: 'Show what would be deleted without executing' },
    ],
    examples: [
      'zotero delete ABC123',
      'zotero rm ABC123 -f',
      'zotero del ABC123 ABC124',
      'zotero delete ABC123 --dry-run',
    ],
    execute: async (args) => {
      await initModules();
      console.log(' Deleting item locally...\n');

      const key = args[0];
      let isPermanent = args.includes('--permanent') || args.includes('-p')
        || args.includes('--force') || args.includes('-f');
      const skipConfirm = args.includes('--yes') || args.includes('-y');
      const dryRun = args.includes('--dry-run') || args.includes('-n');

      // Restrict permanent delete to shell mode only
      if (isPermanent && !isShellMode()) {
        console.log(`${symbols.warning} ${t('commands.delete.shellOnly')}`);
        isPermanent = false;
      }

      if (!key) {
        console.log(`${symbols.error} Usage: zotero delete <key> [--permanent]`);
        console.log('   Example: zotero delete ABCD123');
        console.log('   Example: zotero delete ABCD123 --permanent (permanent delete)');
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

        // Confirmation prompt — skip in shell mode (shell handles its own
        // confirmation via Ink; readline would conflict with Ink's raw mode)
        if (!skipConfirm && !isShellMode()) {
          if (!isInteractive()) {
            console.log(`${symbols.error} ${t('commands.delete.nonInteractive')}`);
            process.exit(1);
          }

          const title = displayTitle(item);
          const promptMsg = isPermanent
            ? t('commands.delete.confirmPermanent', title, key)
            : t('commands.delete.confirmTrash', title, key);

          const rl = createPrompt();
          const answer = await new Promise<string>((resolve) => {
            rl.question(promptMsg, (ans) => resolve(ans));
          });
          rl.close();

          if (!['y', 'yes'].includes(answer.trim().toLowerCase())) {
            console.log(`${symbols.warning} ${t('commands.delete.cancelled')}`);
            return;
          }
        }

        if (dryRun) {

          // Count child attachments
          let childCount = 0;
          try {
            const result = await db.select({ count: count() })
              .from(getItems())
              .where(and(
                eq(getItems().libraryId, library.id),
                like(getItems().rawJson, `%"parentItem":"${key}"%`)
              ))
              .get();
            childCount = result?.count ?? 0;
          } catch (e) {
            // Ignore errors counting children
          }

          console.log(t('commands.delete.dryRunHeader'));
          console.log(`   ${t('fields.title')}:  ${item.title || t('common.unknown')}`);
          console.log(`   Key:       ${key}`);
          console.log(`   ${t('fields.type')}:  ${item.itemType}`);
          console.log(`   ${t('commands.delete.dryRunMode')}:  ${isPermanent ? t('commands.delete.dryRunPermanent') : t('commands.delete.dryRunTrash')}`);
          if (childCount > 0) {
            console.log(`   ${t('commands.delete.dryRunChildren', childCount)}`);
          }
          console.log(`\n${t('commands.delete.dryRunNoChanges')}`);
          return;
        }

        // Find child items (notes, attachments) of this item
        const childItems = await db.select()
          .from(getItems())
          .where(and(
            eq(getItems().libraryId, library.id),
            like(getItems().rawJson, `%"parentItem":"${key}"%`)
          ))
          .all();

        if (isPermanent) {
          // Check trash retention period
          if (item.deletedAt) {
            const { configManager } = await import('@zotero-headless/core');
            const retentionDays = configManager.get('delete')?.trashRetentionDays ?? 7;
            const retentionSeconds = retentionDays * 24 * 60 * 60;
            const now = Math.floor(Date.now() / 1000);
            const elapsed = now - item.deletedAt;
            if (elapsed < retentionSeconds) {
              const availableDate = new Date((item.deletedAt + retentionSeconds) * 1000).toLocaleDateString();
              console.log(`${symbols.error} Cannot permanently delete: item has been in trash for less than ${retentionDays} days.`);
              console.log(`   Permanent deletion available after: ${availableDate}`);
              console.log(`   Use "zotero restore ${key}" to recover from trash.`);
              process.exit(1);
            }
          }

          // Permanent delete: delete from remote API, then remove local DB rows
          console.log(`   Permanently deleting ${key}...`);

          // Delete from remote first (if item has been synced)
          if (item.version > 0) {
            const api = getZoteroApi();
            try {
              await api.deleteItem(library.zoteroId, key, item.version, library.type);
              console.log(`   ${symbols.success} Deleted ${key} from remote`);
            } catch (e: any) {
              if (e.message?.includes('404')) {
                console.log(`   Item ${key} already gone from remote`);
              } else {
                console.log(`${symbols.error} Failed to delete from remote: ${e.message}`);
                console.log(`   Use "zotero sync" to retry, or add --force to delete locally only.`);
                process.exit(1);
              }
            }
          }

          await getLogDeletion()({
            itemKey: key,
            libraryId: library.id,
            title: item.title,
            itemType: item.itemType,
            operationType: 'hard',
            caller: 'cli',
            rawJsonSnapshot: item.rawJson,
          });

          // Delete child items from local DB
          for (const child of childItems) {
            await db.delete(getItems())
              .where(and(eq(getItems().key, child.key), eq(getItems().libraryId, library.id)))
              .run();
          }

          // Delete the item itself from local DB
          await db.delete(getItems())
            .where(and(eq(getItems().key, key), eq(getItems().libraryId, library.id)))
            .run();

          console.log(`${symbols.success} Item permanently deleted!`);
          if (childItems.length > 0) {
            console.log(`   Also deleted ${childItems.length} child item(s).`);
          }
        } else {
          // Soft delete (move to trash): mark as deleted locally
          console.log(`   Moving ${key} to trash...`);

          const now = Math.floor(Date.now() / 1000);

          // Get current data and set deleted flag
          const updatedRawJson = updateItemData(item.rawJson, (data) => {
            data.deleted = true;
          });

          await getLogDeletion()({
            itemKey: key,
            libraryId: library.id,
            title: item.title,
            itemType: item.itemType,
            operationType: 'soft',
            caller: 'cli',
            rawJsonSnapshot: item.rawJson,
          });

          // Trash child items first
          for (const child of childItems) {
            const childUpdatedRawJson = updateItemData(child.rawJson, (data) => {
              data.deleted = true;
            });
            await db.update(getItems())
              .set({
                deleted: true,
                synced: false,
                updatedAt: now,
                deletedAt: now,
                rawJson: childUpdatedRawJson,
              })
              .where(and(eq(getItems().key, child.key), eq(getItems().libraryId, library.id)))
              .run();
          }

          // Update local item: mark as deleted and unsynced
          await db.update(getItems())
            .set({
              deleted: true,
              synced: false,
              updatedAt: now,
              deletedAt: now,
              rawJson: updatedRawJson
            })
            .where(and(eq(getItems().key, key), eq(getItems().libraryId, library.id)))
            .run();

          console.log(`${symbols.success} Item moved to trash locally!`);
          if (childItems.length > 0) {
            console.log(`   Also trashed ${childItems.length} child item(s).`);
          }
        }

        console.log(`\nRun "zotero sync" to sync deletion to remote.`);
      } catch (error) {
        console.log(`${symbols.error} Failed to delete item: ${error}`);
        process.exit(1);
      }
    }
  },
];
