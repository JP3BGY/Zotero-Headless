#!/usr/bin/env node
/**
 * NPM Package Builder for Zotero-Headless
 * 
 * This script bundles the CLI and all workspace dependencies into a single
 * npm-publishable package using esbuild.
 * 
 * Usage:
 *   node scripts/package-for-npm.js [version]
 * 
 * The version argument is optional. If not provided, it will be auto-generated.
 */

import * as esbuild from 'esbuild';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
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

// Create esbuild plugin to resolve workspace packages
const workspacePlugin = {
  name: 'workspace-resolver',
  setup(build) {
    // Read pnpm-workspace.yaml to get workspace package locations
    const workspaceYaml = readFileSync(join(rootDir, 'pnpm-workspace.yaml'), 'utf8');
    const workspacePatterns = workspaceYaml
      .split('\n')
      .filter(line => line.includes('- '))
      .map(line => line.split('- ')[1].trim());
    
    // Build a map of package names to their paths
    const packageMap = new Map();
    
    for (const pattern of workspacePatterns) {
      const basePath = pattern.replace('/*', '');
      const fullBasePath = join(rootDir, basePath);
      
      if (existsSync(fullBasePath)) {
        const dirs = readdirSync(fullBasePath, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory())
          .map(dirent => dirent.name);
        
        for (const dir of dirs) {
          const packageJsonPath = join(fullBasePath, dir, 'package.json');
          if (existsSync(packageJsonPath)) {
            const pkgJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
            if (pkgJson.name) {
              packageMap.set(pkgJson.name, join(fullBasePath, dir, 'dist', 'index.js'));
            }
          }
        }
      }
    }
    
    // Intercept workspace package imports
    build.onResolve({ filter: /^@zotero-headless\// }, args => {
      const resolvedPath = packageMap.get(args.path);
      if (resolvedPath) {
        return { path: resolvedPath };
      }
      return null;
    });
  }
};

// Bundle CLI with esbuild
console.log('📦 Bundling CLI with esbuild...');

try {
  await esbuild.build({
    entryPoints: [join(rootDir, 'apps/cli/src/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    outfile: join(distDir, 'index.js'),
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
  
  console.log('✅ Bundle created successfully');
} catch (error) {
  console.error('❌ Bundling failed:', error.message);
  process.exit(1);
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

// Create tarball (using Node.js tar for reliability)
console.log('📦 Creating package...');
const tarballName = `zotero-headless-${version}.tgz`;

// Create a temporary staging directory
const stagingDir = join(rootDir, 'staging-package');
if (existsSync(stagingDir)) {
  rmSync(stagingDir, { recursive: true });
}
mkdirSync(stagingDir, { recursive: true });

// Copy all files to staging directory
try {
  execSync(`cp -r ${distDir}/* ${stagingDir}/`, {
    cwd: rootDir,
    stdio: 'pipe'
  });

  // Create tarball using Node.js native tar (more reliable)
  const tar = await import('tar');
  await tar.create({
    file: join(rootDir, tarballName),
    cwd: stagingDir,
    sync: true,
    gzip: true
  }, ['.']);

  // Clean up staging directory
  rmSync(stagingDir, { recursive: true });

  console.log('✅ Package built successfully!');
  console.log(`📦 ${tarballName}`);
  console.log('');
  console.log('To install locally:');
  console.log(`  npm install -g ./${tarballName}`);
  console.log('');
  console.log('To test:');
  console.log('  zotero help');
} catch (error) {
  console.error('❌ Failed to create package:', error.message);
  if (error.stderr) {
    console.error('stderr:', error.stderr.toString());
  }
  if (error.stdout) {
    console.error('stdout:', error.stdout.toString());
  }
  process.exit(1);
}
