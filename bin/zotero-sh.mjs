#!/usr/bin/env node
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Prefer bundle if available, otherwise fall back to tsc dist output
const bundlePath = join(__dirname, '..', 'apps', 'shell', 'bundle', 'shell.mjs');
const distPath = join(__dirname, '..', 'apps', 'shell', 'dist', 'index.js');
const shellPath = existsSync(bundlePath) ? bundlePath : distPath;

const child = spawn('node', [shellPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: false
});

child.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
