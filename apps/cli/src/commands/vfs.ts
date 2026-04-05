// @ts-nocheck

import type { Command } from '../types.js';
import { symbols } from '@zotero-headless/core';

export const vfsCommands: Command[] = [
  {
    name: 'vfs',
    aliases: ['fs'],
    description: 'Explore your Zotero library via a virtual filesystem shell',
    options: [
      { name: '--library', alias: '-l', description: 'Library ID to use', value: '<id>' },
    ],
    examples: [
      'zotero vfs                              # Interactive VFS shell',
      'zotero vfs "ls /collections/"           # One-shot: list collections',
      'zotero vfs "cat /items/ABC123/metadata.json"  # Read item metadata',
      'zotero vfs "grep neural /items/"        # Search items',
      'zotero vfs "tree /collections/ML/"      # Show collection tree',
    ],
    execute: async (args: string[]) => {
      // Parse options
      let libraryId: number | undefined;
      const remainingArgs: string[] = [];

      for (let i = 0; i < args.length; i++) {
        if ((args[i] === '--library' || args[i] === '-l') && args[i + 1]) {
          libraryId = parseInt(args[++i], 10);
        } else {
          remainingArgs.push(args[i]);
        }
      }

      const { createSession } = await import('@zotero-headless/virtual-fs');
      const session = createSession({ libraryId });

      // One-shot mode: command provided as argument
      if (remainingArgs.length > 0) {
        const command = remainingArgs.join(' ');
        const result = await session.execute(command);

        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);

        session.destroy();
        if (result.exitCode !== 0) {
          process.exitCode = result.exitCode;
        }
        return;
      }

      // Interactive mode
      console.log(`${symbols.success} Zotero Virtual Filesystem Shell`);
      console.log(`  Type shell commands to explore your library. Type "exit" to quit.`);
      console.log(`  Try: ls /collections/`);
      console.log('');

      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `zotero-vfs:${session.getCwd()}$ `,
      });

      rl.prompt();

      rl.on('line', async (line: string) => {
        const cmd = line.trim();
        if (!cmd) {
          rl.prompt();
          return;
        }

        if (cmd === 'exit' || cmd === 'quit') {
          session.destroy();
          rl.close();
          return;
        }

        const result = await session.execute(cmd);

        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);

        // Update prompt with current cwd
        rl.setPrompt(`zotero-vfs:${session.getCwd()}$ `);
        rl.prompt();
      });

      rl.on('close', () => {
        session.destroy();
        console.log('');
      });
    },
  },
];
