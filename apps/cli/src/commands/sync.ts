// @ts-nocheck

import { symbols } from '@zotero-headless/core';
import { eq } from 'drizzle-orm';
import { Command } from '../types.js';
import { initModules, getSyncManager, getDb, getItems } from '../modules.js';
import { ProgressBar } from '../progress-bar.js';
import { resolveConflictsInteractive, isInteractive, ConflictItem } from '../conflict-resolver.js';
import { t } from '../i18n.js';

export const syncCommands: Command[] = [
  {
    name: 'sync',
    aliases: ['s', 'pull', 'fetch', 'refresh'],
    description: 'Synchronize library with Zotero servers',
    options: [
      { name: '--full-sync', alias: '-f', description: 'Perform a full sync (ignore version cache)' },
      { name: '--groups', alias: '-g', description: 'Sync all group libraries' },
      { name: '--group', alias: '-G', description: 'Sync specific group library', value: '<id>' },
      { name: '--quiet', alias: '-q', description: 'Quiet mode (no progress bar)' },
      { name: '--interactive', alias: '-i', description: 'Interactive conflict resolution' },
    ],
    examples: [
      'zotero sync',
      'zotero sync -f',
      'zotero sync -g',
      'zotero sync -G12345',
    ],
    execute: async (args) => {
      await initModules();
      const fullSync = args.includes('--full-sync') || args.includes('-f');
      const syncGroups = args.includes('--groups') || args.includes('-g');
      const quiet = args.includes('--quiet') || args.includes('-q');
      const interactive = args.includes('--interactive') || args.includes('-i');
      const groupArg = args.find(arg => arg.startsWith('--group='))?.split('=')[1] ||
                       args.find(arg => arg.startsWith('-G'))?.substring(2);

      if (!quiet) {
        console.log(t('commands.sync.starting'));
        if (fullSync) {
          console.log(t('commands.sync.fullSync'));
        }
        if (syncGroups) {
          console.log(t('commands.sync.groupSync'));
        }
        if (groupArg) {
          console.log(t('commands.sync.groupSingle', groupArg));
        }
        console.log('');
      }

      // Create progress bar if not quiet
      let progressBar: ProgressBar | null = null;

      const result = await getSyncManager().sync({
        fullSync,
        syncAll: syncGroups,
        groupId: groupArg,
        onProgress: quiet ? undefined : (progress) => {
          if (progress.total > 0) {
            if (!progressBar) {
              progressBar = new ProgressBar({
                total: progress.total,
                label: progress.phase
              });
            }
            progressBar.update(progress.current, progress.phase);

            if (progress.phase === 'complete') {
              progressBar.complete();
              progressBar = null;
            }
          }
        }
      });

      // Handle conflicts interactively if requested
      if (result.conflicts && result.conflicts.length > 0) {
        if (interactive && isInteractive()) {
          console.log(`\n!  ${result.conflicts.length} ${t('conflict.title')}`);

          // Get database connection
          const db = getDb()();
          const items = getItems();

          // Get item details for conflicts
          const conflictItems: ConflictItem[] = [];
          for (const key of result.conflicts) {
            const item = await db.select()
              .from(items)
              .where(eq(items.key, key))
              .get();
            if (item) {
              conflictItems.push({
                key,
                title: item.title || undefined,
                localVersion: item.version,
                remoteVersion: item.version + 1
              });
            }
          }

          // Interactive resolution
          const resolutions = await resolveConflictsInteractive(conflictItems);

          // Apply resolutions
          let resolvedCount = 0;
          for (const [key, resolution] of resolutions) {
            if (resolution === 'remote') {
              // Use remote: clear deleted flag, reset version to re-download on next sync
              console.log(`   ${t('conflict.remote')}: ${key}`);
              await db.update(items)
                .set({ deleted: 0, version: 0, synced: 0 })
                .where(eq(items.key, key))
                .run();
              resolvedCount++;
            } else if (resolution === 'local') {
              // Use local: remove from DB (will be recreated if needed)
              console.log(`   ${t('conflict.local')}: ${key}`);
              await db.delete(items)
                .where(eq(items.key, key))
                .run();
              resolvedCount++;
            }
          }

          console.log(`\n${symbols.success} ${t('common.success')}: ${resolvedCount}`);
        } else if (!quiet) {
          console.log(`\n!  ${result.conflicts.length} conflicts detected.`);
          console.log('   Run with --interactive (-i) to resolve manually');
          console.log('   Or use --conflict-strategy=remote|local for auto-resolution');
        }
      }

      if (result.success) {
        if (!quiet) {
          console.log(`\n${symbols.success} Sync completed successfully!`);
          console.log(`   Items updated: ${result.updated}`);
          console.log(`   Items deleted: ${result.deleted}`);
        }
      } else {
        console.log(`\n!  Sync completed with issues:`);
        result.errors.forEach(e => console.log(`   Error: ${e}`));
        if (result.conflicts && result.conflicts.length > 0 && !interactive) {
          console.log(`   Conflicts: ${result.conflicts.length}`);
          result.conflicts.forEach(c => console.log(`     - ${c}`));
        }
        throw new Error(`Sync completed with ${result.errors.length} errors`);
      }
    }
  },
  {
    name: 'sync:upload',
    aliases: ['su'],
    description: 'Upload local changes only',
    options: [
      { name: '--force', alias: '-f', description: 'Force upload even if unchanged' },
    ],
    examples: [
      'zotero sync:upload',
      'zotero sync:upload -f',
    ],
    execute: async () => {
      console.log('This would upload local changes...');
      // Implementation for upload-only would go here
    }
  },
];
