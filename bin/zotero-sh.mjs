#!/usr/bin/env node
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shellPath = join(__dirname, '..', 'apps', 'shell', 'dist', 'index.js');

const child = spawn('node', [shellPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: false
});

child.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
