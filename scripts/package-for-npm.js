#!/usr/bin/env node
/**
 * NPM Package Builder for Zotero-Headless
 * 
 * This script bundles the CLI and all workspace dependencies into a single
 * npm-publishable package using tsup (Turborepo's recommended bundler).
 * 
 * Usage:
 *   node scripts/package-for-npm.js [version]
 * 
 * The version argument is optional. If not provided, it will be auto-generated.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const distDir = join(rootDir, 'dist-package');

// Get version from argument or generate one
const version = process.argv[2] || `${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${execSync('git rev-parse --short HEAD', { cwd: rootDir, encoding: 'utf8' }).trim()}`;

console.log(`📦 Building npm package version: ${version}`);

// Clean up previous build
if (existsSync(distDir)) {
  console.log('🧹 Cleaning previous build...');
  rmSync(distDir, { recursive: true });
}
mkdirSync(distDir, { recursive: true });

// Check if tsup is available in project
console.log('🔧 Checking for tsup...');
const tsupPath = join(rootDir, 'node_modules/.bin/tsup');
const hasTsup = existsSync(tsupPath);

if (!hasTsup) {
  console.log('📥 Installing tsup in project...');
  execSync('pnpm add -D -w tsup typescript', { 
    cwd: rootDir,
    stdio: 'inherit' 
  });
}

const tsupCmd = hasTsup ? tsupPath : 'npx tsup';

// Bundle CLI with all workspace dependencies
console.log('📦 Bundling CLI with tsup...');
const tsupCommand = [
  tsupCmd,
  join(rootDir, 'apps/cli/src/index.ts'),
  '--format esm',
  `--outDir ${distDir}`,
  '--platform node',
  '--target node18',
  '--external better-sqlite3',
  '--external sql.js',
  '--minify'
].join(' ');

try {
  execSync(tsupCommand, { 
    cwd: rootDir,
    stdio: 'inherit' 
  });
} catch (error) {
  console.error('❌ Bundling failed:', error.message);
  process.exit(1);
}

// Rename .mjs to .js for compatibility
console.log('📝 Renaming .mjs to .js...');
import { readdirSync, renameSync } from 'fs';
const files = readdirSync(distDir);
for (const file of files) {
  if (file.endsWith('.mjs')) {
    const newName = file.replace('.mjs', '.js');
    renameSync(join(distDir, file), join(distDir, newName));
    console.log(`  ${file} → ${newName}`);
  }
}

// Create package.json
console.log('📝 Creating package.json...');
const packageJson = {
  name: 'zotero-headless',
  version: version,
  description: 'Zotero Web API sync client - CLI tool for syncing Zotero libraries without desktop app',
  type: 'module',
  bin: {
    zotero: './index.js'
  },
  engines: {
    node: '>=18.0.0'
  },
  dependencies: {
    'better-sqlite3': '^11.9.1',
    'sql.js': '^1.14.0'
  },
  keywords: ['zotero', 'cli', 'sync', 'reference', 'bibliography'],
  author: '',
  license: 'MIT'
};

writeFileSync(
  join(distDir, 'package.json'),
  JSON.stringify(packageJson, null, 2)
);

// Create .npmignore
console.log('📝 Creating .npmignore...');
writeFileSync(
  join(distDir, '.npmignore'),
  `src/
tsconfig.json
*.ts
*.map
`.trim()
);

// Create tarball
console.log('📦 Creating tarball...');
const tarballName = `zotero-headless-${version}.tgz`;
try {
  execSync(`tar -czf ${tarballName} .`, {
    cwd: distDir,
    stdio: 'ignore'
  });
  
  // Move tarball to root
  const fs = await import('fs');
  fs.renameSync(
    join(distDir, tarballName),
    join(rootDir, tarballName)
  );
  
  console.log('✅ Package built successfully!');
  console.log(`📦 ${tarballName}`);
  console.log('');
  console.log('To install locally:');
  console.log(`  npm install -g ./${tarballName}`);
  console.log('');
  console.log('To test:');
  console.log('  zotero help');
} catch (error) {
  console.error('❌ Failed to create tarball:', error.message);
  process.exit(1);
}
