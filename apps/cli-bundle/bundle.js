#!/usr/bin/env node
// Bundle CLI for distribution as single executable

import * as esbuild from 'esbuild';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readdirSync, readFileSync } from 'fs';
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

// Create esbuild plugin to resolve workspace packages
const workspacePlugin = {
  name: 'workspace-resolver',
  setup(build) {
    // Read pnpm-workspace.yaml to get workspace package locations
    const workspaceYaml = readFileSync(join(rootDir, 'pnpm-workspace.yaml'), 'utf8');
    
    // Parse YAML - look for lines with dash and value
    const workspacePatterns = [];
    for (const line of workspaceYaml.split('\n')) {
      const trimmed = line.trim();
      // Match patterns like "  - 'apps/*'" or "- 'packages/*'"
      const match = trimmed.match(/^[-*]\s*['"]([^'"]+)['"]/);
      if (match) {
        workspacePatterns.push(match[1]);
      }
    }
    
    console.log('📦 Parsed workspace patterns:', workspacePatterns);
    
    // Build a map of package names to their paths
    const packageMap = new Map();
    
    for (const pattern of workspacePatterns) {
      const basePath = pattern.replace('/*', '');
      const fullBasePath = join(rootDir, basePath);
      
      console.log(`🔍 Checking workspace pattern: ${pattern} -> ${fullBasePath}`);
      
      if (existsSync(fullBasePath)) {
        const dirs = readdirSync(fullBasePath, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory())
          .map(dirent => dirent.name);
        
        console.log(`  Found directories: ${dirs.join(', ')}`);
        
        for (const dir of dirs) {
          const packageJsonPath = join(fullBasePath, dir, 'package.json');
          if (existsSync(packageJsonPath)) {
            const pkgJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
            if (pkgJson.name) {
              // Point to the source entry point instead of dist
              const entryPoint = pkgJson.exports?.['.']?.import || 
                                pkgJson.exports?.['.']?.require ||
                                pkgJson.main || 
                                'dist/index.js';
              packageMap.set(pkgJson.name, join(fullBasePath, dir, entryPoint));
              console.log(`  ✓ Found package: ${pkgJson.name} -> ${entryPoint}`);
            }
          }
        }
      } else {
        console.log(`  ⚠ Path does not exist: ${fullBasePath}`);
      }
    }
    
    console.log('📦 Resolved workspace packages:');
    for (const [name, path] of packageMap) {
      console.log(`  - ${name} -> ${path}`);
    }
    
    // Intercept workspace package imports
    build.onResolve({ filter: /^@zotero-headless\// }, args => {
      const resolvedPath = packageMap.get(args.path);
      if (resolvedPath) {
        console.log(`🔗 Resolving ${args.path} to ${resolvedPath}`);
        return { path: resolvedPath };
      }
      console.error(`❌ Could not resolve ${args.path}`);
      return null;
    });
  }
};

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
  plugins: [workspacePlugin],
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
