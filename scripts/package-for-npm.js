#!/usr/bin/env node
/**
 * NPM Package Builder for Zotero-Headless
 *
 * Collects pre-built bundles (from `turbo run bundle`) and creates
 * an npm-publishable tarball.
 *
 * Usage:
 *   node scripts/package-for-npm.js [version]
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, copyFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const distDir = join(rootDir, 'dist-package');

// Get version from argument or generate one
const version = process.argv[2] || `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${execSync('git rev-parse --short HEAD', { cwd: rootDir, encoding: 'utf8' }).trim()}`;

console.log(`Building npm package version: ${version}`);

// Clean up previous build
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true });
}
mkdirSync(distDir, { recursive: true });

// Run turbo bundle (builds everything in correct order)
console.log('Running turbo bundle...');
try {
  execSync('npx turbo run bundle --filter=@zotero-headless/cli --filter=@zotero-headless/shell --force', { cwd: rootDir, stdio: 'inherit' });
} catch (error) {
  console.error('Bundling failed:', error.message);
  process.exit(1);
}

// Verify bundle artifacts exist
const cliBundlePath = join(rootDir, 'apps/cli/bundle/zotero.cjs');
const shellBundlePath = join(rootDir, 'apps/shell/bundle/shell.mjs');

for (const [name, path] of [['CLI', cliBundlePath], ['Shell', shellBundlePath]]) {
  if (!existsSync(path)) {
    console.error(`${name} bundle not found: ${path}`);
    process.exit(1);
  }
}

// Copy bundles to dist-package
copyFileSync(cliBundlePath, join(distDir, 'index.js'));
copyFileSync(shellBundlePath, join(distDir, 'shell.mjs'));
console.log('Bundles copied to dist-package/');

// Derive external dependency versions from workspace package.json files
function readPkgDeps(pkgJsonPath) {
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  return { ...pkg.dependencies, ...pkg.devDependencies };
}

const shellDeps = readPkgDeps(join(rootDir, 'apps/shell/package.json'));
const cliDeps = readPkgDeps(join(rootDir, 'apps/cli/package.json'));
const dbDeps = readPkgDeps(join(rootDir, 'packages/database/package.json'));
const rootDeps = readPkgDeps(join(rootDir, 'package.json'));

// Only include external (non-workspace) dependencies that the bundles need at runtime
const externalDeps = {};
// CLI externals (native modules from database package or root)
for (const dep of ['better-sqlite3', 'sql.js']) {
  const ver = dbDeps[dep] || rootDeps[dep] || cliDeps[dep] || shellDeps[dep];
  if (ver) externalDeps[dep] = ver;
}
// Shell externals (ink, react)
for (const dep of ['ink', 'ink-text-input', 'ink-select-input', 'ink-spinner', 'react']) {
  const ver = shellDeps[dep];
  if (ver) externalDeps[dep] = ver;
}

// Create package.json
const packageJson = {
  name: 'zotero-headless',
  version,
  description: 'Zotero Web API sync client - CLI tool for syncing Zotero libraries without desktop app',
  bin: {
    zotero: './index.js',
    'zotero-sh': './shell.mjs',
  },
  engines: { node: '>=18.0.0' },
  dependencies: externalDeps,
  keywords: ['zotero', 'cli', 'sync', 'reference', 'bibliography'],
  author: '',
  license: 'MIT',
};

writeFileSync(join(distDir, 'package.json'), JSON.stringify(packageJson, null, 2));

// Create .npmignore
writeFileSync(join(distDir, '.npmignore'), 'src/\ntsconfig.json\n*.ts\n*.map');

// Create tarball
console.log('Creating package...');
const tarballName = `zotero-headless-${version}.tgz`;
const stagingDir = join(rootDir, 'staging-package');

if (existsSync(stagingDir)) {
  rmSync(stagingDir, { recursive: true });
}
mkdirSync(stagingDir, { recursive: true });

try {
  execSync(`cp -r ${distDir}/* ${stagingDir}/`, { cwd: rootDir, stdio: 'pipe' });

  const tar = await import('tar');
  await tar.create(
    { file: join(rootDir, tarballName), cwd: stagingDir, sync: true, gzip: true },
    ['.'],
  );

  rmSync(stagingDir, { recursive: true });

  console.log(`Package built: ${tarballName}`);
  console.log(`\nTo install: npm install -g ./${tarballName}`);
} catch (error) {
  console.error('Failed to create package:', error.message);
  process.exit(1);
}
