// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getZoteroApi } from '../modules.js';
import { symbols } from '@zotero-headless/core';

export const verifyCommands: Command[] = [
  {
    name: 'verify',
    aliases: ['v', 'check', 'test', 'ping'],
    description: 'Verify API key and connection. Aliases: v, check, test, ping',
    options: [
      { name: '--fix', description: 'Attempt to fix verification issues' },
      { name: '--verbose', alias: '-v', description: 'Show detailed output' },
    ],
    examples: [
      'zotero verify',
      'zotero verify --fix',
      'zotero v -v',
    ],
    execute: async () => {
      await initModules();
      console.log('Verifying API key...\n');
      try {
        const keyInfo = await getZoteroApi().verifyKey();
        console.log(`${symbols.success} API key is valid!`);
        console.log(`   Username: ${keyInfo.username}`);
        console.log(`   User ID: ${keyInfo.userID}`);
        console.log(`\n   Access:`);
        console.log(`     Library: ${keyInfo.access.user.library ? symbols.success : symbols.error}`);
        console.log(`     Files: ${keyInfo.access.user.files ? symbols.success : symbols.error}`);
        console.log(`     Notes: ${keyInfo.access.user.notes ? symbols.success : symbols.error}`);
        console.log(`     Write: ${keyInfo.access.user.write ? symbols.success : symbols.error}`);
      } catch (e) {
        console.log(`${symbols.error} API key verification failed!`);
        console.log(`   Error: ${e}`);
        process.exit(1);
      }
    }
  },
];
