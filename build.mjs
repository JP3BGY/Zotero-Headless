// Build script for standalone distribution
// Run: node build.mjs

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const isWatch = process.argv.includes('--watch');

// Ensure dist directory exists
if (!fs.existsSync('dist')) {
  fs.mkdirSync('dist');
}

// Copy package.json to dist
fs.copyFileSync('package-standalone.json', 'dist/package.json');

const buildOptions = {
  entryPoints: ['apps/cli/src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: 'dist/index.js',
  format: 'esm',
  sourcemap: true,
  external: [],
  banner: {
    js: '#!/usr/bin/env node',
  },
};

if (isWatch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(buildOptions);
  
  // Make executable
  fs.chmodSync('dist/index.js', '755');
  
  console.log('✅ Build complete!');
  console.log('Run: node dist/index.js --help');
}
