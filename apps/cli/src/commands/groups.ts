// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getSyncManager } from '../modules.js';
import { symbols } from '@zotero-headless/core';

export const groupsCommands: Command[] = [
  {
    name: 'groups',
    aliases: ['g', 'team', 'org'],
    description: 'List and sync group libraries. Aliases: g, team, org. Use --sync <group-id> to sync a group library',
    options: [
      { name: '--sync', alias: '-s', description: 'Sync specific group library', value: '<group-id>' },
    ],
    examples: [
      'zotero groups',
      'zotero groups --sync 12345',
    ],
    execute: async (args) => {
      await initModules();

      // Check for sync option
      const syncIndex = args.indexOf('--sync');
      if (syncIndex >= 0 && args[syncIndex + 1]) {
        const groupId = args[syncIndex + 1];
        console.log(`Syncing group library ${groupId}...\n`);

        try {
          const result = await getSyncManager().syncGroup(groupId);
          if (result.success) {
            console.log(`${symbols.success} Group library synced successfully!`);
            console.log(`   Downloaded: ${result.downloaded || 0}`);
            console.log(`   Updated: ${result.updated || 0}`);
          } else {
            console.log(`${symbols.error} Sync failed: ${result.error}`);
          }
        } catch (error: any) {
          console.log(`${symbols.error} Error: ${error.message}`);
        }
        return;
      }

      // List groups
      console.log('Fetching your groups...');
      const groups = await getSyncManager().getUserGroups();

      if (groups.length === 0) {
        console.log('   No groups found.');
        console.log('\nTo create a group, visit: https://www.zotero.org/groups/new');
        return;
      }

      console.log(`\nYour Groups (${groups.length}):\n`);
      groups.forEach(group => {
        const accessIcon = group.accessLevel === 'write' ? '✏️' : '👁️';
        const libraryIcon = group.isLibrary ? '' : '👥';
        console.log(`  ${libraryIcon} ${accessIcon} [${group.groupId}] ${group.name}`);
        console.log(`      Access: ${group.accessLevel}`);
        console.log(`      Sync: zotero groups --sync ${group.groupId}`);
        console.log('');
      });

      console.log('To sync a group library:');
      console.log('   zotero groups --sync <group-id>');
    }
  },
];
