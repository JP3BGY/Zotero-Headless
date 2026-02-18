#!/usr/bin/env node
// Postinstall script for global npm install from git
// This script runs after npm install to build the project

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Check if we're in a global npm install context
const isGlobalInstall = process.env.npm_config_global === 'true' || 
                        process.cwd().includes('node_modules') === false;

if (!isGlobalInstall) {
  // Local development install, skip
  process.exit(0);
}

console.log('🔧 Setting up zotero-headless...');

try {
  // Check if pnpm is available
  let pnpmCmd = 'pnpm';
  try {
    execSync('pnpm --version', { stdio: 'ignore' });
  } catch {
    // Try npx pnpm
    pnpmCmd = 'npx pnpm';
    try {
      execSync('npx pnpm --version', { stdio: 'ignore' });
    } catch {
      console.error('❌ pnpm is required but not found.');
      console.log('   Please install pnpm: npm install -g pnpm');
      process.exit(1);
    }
  }

  // Install dependencies
  console.log('📦 Installing dependencies...');
  execSync(`${pnpmCmd} install`, { 
    cwd: rootDir, 
    stdio: 'inherit'
  });

  // Build project
  console.log('🔨 Building project...');
  execSync(`${pnpmCmd} run build`, { 
    cwd: rootDir, 
    stdio: 'inherit' 
  });

  console.log('✅ Setup complete!');
  console.log('');
  console.log('Usage: zotero <command>');
  console.log('   Ex: zotero sync');
  console.log('');

} catch (error) {
  console.error('❌ Setup failed:', error.message);
  process.exit(1);
}
