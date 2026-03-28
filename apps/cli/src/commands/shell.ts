// @ts-nocheck

import type { Command } from '../types.js';
import { symbols } from '@zotero-headless/core';
import { getLanguage } from '../i18n.js';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Locate the shell entry point.
 *
 * Layout A — monorepo dev (tsc output):
 *   apps/cli/dist/commands/shell.js  ← this file (__dirname)
 *   apps/shell/dist/index.js         ← target
 *
 * Layout B — npm package (bundle):
 *   dist/index.js   (cli)
 *   dist/shell.mjs  (shell bundle)
 */
function findShellPath(): string | null {
  const candidates = [
    // Monorepo: from apps/cli/dist/commands/ → apps/shell/dist/index.js
    resolve(__dirname, '..', '..', '..', 'shell', 'dist', 'index.js'),
    // Bundle layout: shell.mjs next to CLI entry (dist/)
    join(__dirname, '..', 'shell.mjs'),
    join(__dirname, '..', 'shell.js'),
  ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export const shellCommands: Command[] = [
  {
    name: 'shell',
    aliases: ['sh', 'repl', 'interactive', 'i'],
    description: 'Start interactive shell. Use --lang=en or --lang=zh to set language.',
    options: [
      { name: '--lang', description: 'Set language (en|zh)', value: '<lang>' },
    ],
    examples: [
      'zotero shell',
    ],
    execute: async (args: string[]) => {
      const { spawn } = await import('child_process');

      // Parse --lang argument
      let lang: string | undefined;
      const langArg = args.find(arg => arg.startsWith('--lang='));
      if (langArg) {
        lang = langArg.split('=')[1];
      }

      const shellPath = findShellPath();
      if (!shellPath) {
        console.error(`${symbols.error} Cannot find shell.`);
        console.log('');
        console.log('Try reinstalling: npm install -g zotero-headless');
        return;
      }

      try {
        const child = spawn('node', [shellPath], {
          stdio: 'inherit',
          env: {
            ...process.env,
            ZOTERO_LANG: lang || getLanguage()
          }
        });

        await new Promise<void>((resolve) => {
          child.on('exit', (code) => {
            process.exitCode = code ?? 0;
            resolve();
          });
        });
      } catch (error) {
        console.error(`${symbols.error} Failed to start shell:`, error);
      }
    }
  },
];
