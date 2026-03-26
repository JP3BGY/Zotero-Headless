// @ts-nocheck

import type { Command } from '../types.js';
import { symbols } from '@zotero-headless/core';
import { getLanguage } from '../i18n.js';

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
      const { fileURLToPath } = await import('url');
      const { dirname, join } = await import('path');
      const { existsSync } = await import('fs');

      // Parse --lang argument
      let lang: string | undefined;
      const langArg = args.find(arg => arg.startsWith('--lang='));
      if (langArg) {
        lang = langArg.split('=')[1];
      }

      // Find shell path - try multiple locations
      let shellPath: string | null = null;

      // Try 1: Shell bundle next to CLI entry point (npm package layout)
      try {
        const __dirname = dirname(fileURLToPath(import.meta.url));
        // Try .mjs first (ESM bundle), then .js fallback
        for (const name of ['shell.mjs', 'shell.js']) {
          const bundlePath = join(__dirname, name);
          if (existsSync(bundlePath)) {
            shellPath = bundlePath;
            break;
          }
        }
      } catch {
        // ignore
      }

      // Try 2: Relative to CLI entry point (__dirname)
      if (!shellPath) {
        try {
          const __dirname = dirname(fileURLToPath(import.meta.url));
          const relativePath = join(__dirname, 'apps', 'shell', 'dist', 'index.js');
          if (existsSync(relativePath)) {
            shellPath = relativePath;
          }
        } catch {
          // ignore
        }
      }

      // Try 3: NODE_PATH environment variable
      if (!shellPath) {
        const nodePath = process.env.NODE_PATH;
        if (nodePath) {
          const nodeModulesPath = join(nodePath, '@zotero-headless', 'shell', 'dist', 'index.js');
          if (existsSync(nodeModulesPath)) {
            shellPath = nodeModulesPath;
          }
        }
      }

      // Try 4: In global node_modules (if installed with -g)
      if (!shellPath) {
        const globalPath = process.execPath;
        const globalDir = dirname(globalPath);
        const globalShellPath = join(globalDir, '..', 'lib', 'node_modules', '@zotero-headless', 'shell', 'dist', 'index.js');
        if (existsSync(globalShellPath)) {
          shellPath = globalShellPath;
        }
      }

      // Try 5: In node_modules (development or npm link)
      if (!shellPath) {
        try {
          shellPath = require.resolve('@zotero-headless/shell');
        } catch {
          // ignore
        }
      }

      // Try 6: Relative to current working directory (development)
      if (!shellPath) {
        const devPath = join(process.cwd(), 'apps', 'shell', 'dist', 'index.js');
        if (existsSync(devPath)) {
          shellPath = devPath;
        }
      }

      if (!shellPath) {
        console.error(`${symbols.error} Cannot find shell.`);
        console.log('');
        console.log('Try reinstalling: npm install -g zotero-headless');
        return;
      }

      try {
        const child = spawn('node', [shellPath], {
          stdio: 'inherit',
          shell: false,
          env: {
            ...process.env,
            ZOTERO_LANG: lang || getLanguage()
          }
        });

        child.on('exit', (code) => {
          process.exitCode = code ?? 0;
        });
      } catch (error) {
        console.error(`${symbols.error} Failed to start shell:`, error);
      }
    }
  },
];
