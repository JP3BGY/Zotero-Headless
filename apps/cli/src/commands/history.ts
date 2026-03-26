// @ts-nocheck

import type { Command } from '../types.js';

export const historyCommands: Command[] = [
  {
    name: 'history',
    aliases: ['hist', 'h', 'recent'],
    description: 'Show recent items and commands',
    options: [
      { name: '--limit', alias: '-l', description: 'Number of entries', value: '<N>' },
      { name: '--clear', alias: '-c', description: 'Clear history' },
    ],
    examples: [
      'zotero history',
      'zotero history -l 20',
    ],
    execute: async (args) => {
      const { historyManager } = await import('@zotero-headless/core');

      if (args.includes('--clear')) {
        historyManager.clear();
        console.log(' History cleared');
        return;
      }

      const limit = parseInt(args.find(a => !a.startsWith('-')) || '10');
      const recent = historyManager.getRecent(limit);

      if (recent.length === 0) {
        console.log('📭 No history found');
        return;
      }

      console.log(`\n📜 Recent history (${recent.length}):\n`);
      recent.forEach((entry, i) => {
        const date = new Date(entry.timestamp).toLocaleDateString();
        const icon = entry.type === 'item' ? '' : entry.type === 'search' ? '' : '';
        console.log(`  ${icon} [${entry.key || entry.query || entry.command}] (${date})`);
      });
      console.log();
    }
  },
];
