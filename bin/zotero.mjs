#!/usr/bin/env node
// Cross-platform CLI entry point for zotero-headless
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import the actual CLI
const cliPath = join(__dirname, '../apps/cli/dist/index.js');
await import(cliPath);
