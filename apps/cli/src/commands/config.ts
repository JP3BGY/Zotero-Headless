// @ts-nocheck

import type { Command } from '../types.js';
import { symbols } from '@zotero-headless/core';

export const configCommands: Command[] = [
  {
    name: 'config',
    aliases: ['cfg', 'conf'],
    description: 'Configure zotero CLI settings',
    options: [
      { name: '--get', alias: '-g', description: 'Get config value', value: '<key>' },
      { name: '--set', alias: '-s', description: 'Set config value', value: '<key=value>' },
      { name: '--list', alias: '-l', description: 'List all config' },
    ],
    examples: [
      'zotero config --get apiKey',
      'zotero config -s "defaultLimit=50"',
    ],
    execute: async (args) => {
      const { configManager } = await import('@zotero-headless/core');

      if (args[0] === '--init') {
        configManager.init();
        console.log(`${symbols.success} Config file created at ~/.zoterrc`);
        return;
      }

      if (args[0] === '--show') {
        console.log('Current config:');
        console.log(JSON.stringify(configManager.getAll(), null, 2));
        return;
      }

      console.log('Usage:');
      console.log('  zotero config --init   Create default config');
      console.log('  zotero config --show    Show current config');
    }
  },
];
