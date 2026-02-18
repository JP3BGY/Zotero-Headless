#!/usr/bin/env node
// Bundle CLI for distribution as single executable

import * as esbuild from 'esbuild';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '../..');
const outputDir = join(__dirname, 'dist');

// Ensure output directory exists
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

console.log('🔨 Bundling Zotero-Headless CLI...');

// Bundle with esbuild
await esbuild.build({
  entryPoints: [join(rootDir, 'apps/cli/src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: join(outputDir, 'zotero.js'),
  format: 'esm',
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: [
    // Native modules that can't be bundled
    'better-sqlite3',
    'sql.js',
  ],
  define: {
    'process.env.BUNDLED': '"true"',
  },
  minify: true,
  sourcemap: false,
});

// Copy native modules to dist
console.log('📦 Copying native modules...');
const nativeModules = [
  'node_modules/better-sqlite3',
  'node_modules/sql.js',
];

for (const mod of nativeModules) {
  const srcPath = join(rootDir, mod);
  const destPath = join(outputDir, mod);
  if (existsSync(srcPath)) {
    try {
      execSync(`cp -r "${srcPath}" "${destPath}"`, { stdio: 'ignore' });
      console.log(`  ✓ ${mod}`);
    } catch (e) {
      console.log(`  ⚠ ${mod} (skipped)`);
    }
  }
}

// Create package.json for pkg
const pkgConfig = {
  name: 'zotero-headless',
  version: '1.0.0',
  bin: './zotero.js',
  pkg: {
    scripts: ['./zotero.js'],
    assets: [
      'node_modules/better-sqlite3/**/*',
      'node_modules/sql.js/**/*',
    ],
    targets: [
      'node18-linux-x64',
      'node18-linux-arm64',
      'node18-macos-x64',
      'node18-macos-arm64',
      'node18-win-x64',
    ],
    outputPath: './bin',
  },
};

writeFileSync(
  join(outputDir, 'package.json'),
  JSON.stringify(pkgConfig, null, 2)
);

console.log('✅ Bundle complete!');
console.log('');
console.log('To build executables:');
console.log('  cd apps/cli-bundle/dist');
console.log('  npx pkg .');
console.log('');
console.log('Or use GitHub Actions to build for all platforms.');
