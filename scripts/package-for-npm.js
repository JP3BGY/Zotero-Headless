#!/usr/bin/env node
/**
 * NPM Package Builder for Zotero-Headless
 * 
 * This script bundles the CLI using esbuild (via cli-bundle) and creates
 * an npm-publishable package.
 * 
 * Usage:
 *   node scripts/package-for-npm.js [version]
 * 
 * The version argument is optional. If not provided, it will be auto-generated.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, copyFileSync, readFileSync, cpSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const cliBundleDir = join(rootDir, 'apps/cli-bundle');
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

// Run cli-bundle to create the bundle
console.log('📦 Running cli-bundle...');
try {
  execSync('node bundle.js', {
    cwd: cliBundleDir,
    stdio: 'inherit'
  });
} catch (error) {
  console.error('❌ Bundling failed:', error.message);
  process.exit(1);
}

// Copy the bundled file from cli-bundle/dist
const bundleOutputDir = join(cliBundleDir, 'dist');
const bundleFile = join(bundleOutputDir, 'zotero.js');

if (!existsSync(bundleFile)) {
  console.error('❌ Bundle file not found:', bundleFile);
  process.exit(1);
}

// Copy bundle to dist-package as index.js and ensure shebang is on first line
const bundleContent = readFileSync(bundleFile, 'utf-8');
const indexPath = join(distDir, 'index.js');

// Ensure shebang is on the first line
if (bundleContent.startsWith('#!/usr/bin/env node')) {
  // Shebang is already first, just copy
  writeFileSync(indexPath, bundleContent);
} else {
  // Add shebang at the very beginning
  writeFileSync(indexPath, '#!/usr/bin/env node\n' + bundleContent);
}
console.log('✅ Bundle copied to dist-package/index.js with shebang');

// Copy shell files
console.log('📦 Copying shell files...');
const shellSrcDir = join(rootDir, 'apps', 'shell');
const shellDistDir = join(distDir, 'apps', 'shell');

if (existsSync(shellSrcDir)) {
  mkdirSync(shellDistDir, { recursive: true });
  
  // Copy package.json
  copyFileSync(
    join(shellSrcDir, 'package.json'),
    join(shellDistDir, 'package.json')
  );
  
  // Copy dist files
  const shellDistSrc = join(shellSrcDir, 'dist');
  const shellDistTarget = join(shellDistDir, 'dist');
  if (existsSync(shellDistSrc)) {
    mkdirSync(shellDistTarget, { recursive: true });
    cpSync(shellDistSrc, shellDistTarget, { recursive: true });
    console.log('✅ Shell files copied');
  } else {
    console.log('⚠️ Shell dist not found, trying to build...');
    try {
      execSync('pnpm build', { cwd: shellSrcDir, stdio: 'inherit' });
      if (existsSync(shellDistSrc)) {
        mkdirSync(shellDistTarget, { recursive: true });
        cpSync(shellDistSrc, shellDistTarget, { recursive: true });
        console.log('✅ Shell files copied after build');
      }
    } catch (e) {
      console.error('❌ Failed to build shell:', e.message);
    }
  }
} else {
  console.log('⚠️ Shell source not found, skipping');
}

// Create package.json
console.log('📝 Creating package.json...');
const packageJson = {
  name: 'zotero-headless',
  version: version,
  description: 'Zotero Web API sync client - CLI tool for syncing Zotero libraries without desktop app',
  bin: {
    zotero: './index.js',
    'zotero-sh': './apps/shell/dist/index.js'
  },
  engines: {
    node: '>=18.0.0'
  },
  dependencies: {
    'better-sqlite3': '^11.9.1',
    'sql.js': '^1.14.0',
    'ink': '^5.0.0',
    'ink-text-input': '^6.0.0',
    'react': '^18.2.0'
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
