#!/usr/bin/env node
// Bundle Shell for distribution as single file
// This bundles shell + CLI commands together so the npm package
// doesn't need to ship unbundled CLI dist files with all their dependencies.

import * as esbuild from 'esbuild';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '../..');
const outputDir = join(__dirname, 'bundle');

// Ensure output directory exists
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

console.log('🔨 Bundling Zotero-Headless Shell...');

// Create esbuild plugin to resolve workspace packages
const workspacePlugin = {
  name: 'workspace-resolver',
  setup(build) {
    const workspaceYaml = readFileSync(join(rootDir, 'pnpm-workspace.yaml'), 'utf8');
    
    const workspacePatterns = [];
    for (const line of workspaceYaml.split('\n')) {
      const trimmed = line.trim();
      const match = trimmed.match(/^[-*]\s*['"]([^'"]+)['"]/);
      if (match) {
        workspacePatterns.push(match[1]);
      }
    }
    
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
              const entryPoint = pkgJson.exports?.['.']?.import || 
                                pkgJson.exports?.['.']?.require ||
                                pkgJson.main || 
                                'dist/index.js';
              packageMap.set(pkgJson.name, join(fullBasePath, dir, entryPoint));
            }
          }
        }
      }
    }
    
    console.log('📦 Resolved workspace packages:');
    for (const [name, path] of packageMap) {
      console.log(`  - ${name} -> ${path}`);
    }
    
    // Resolve @zotero-headless/* workspace imports
    build.onResolve({ filter: /^@zotero-headless\// }, args => {
      const resolvedPath = packageMap.get(args.path);
      if (resolvedPath) {
        return { path: resolvedPath };
      }
      return null;
    });

    // Resolve relative CLI import from commands.ts
    // ../../cli/dist/index.js -> absolute path to cli dist
    build.onResolve({ filter: /\.\.\/\.\.\/cli\/dist\/index\.js$/ }, args => {
      const cliDist = join(rootDir, 'apps/cli/dist/index.js');
      if (existsSync(cliDist)) {
        return { path: cliDist };
      }
      // Fallback to source
      const cliSrc = join(rootDir, 'apps/cli/src/index.ts');
      if (existsSync(cliSrc)) {
        return { path: cliSrc };
      }
      return null;
    });
  }
};

// Handle import.meta.url for CJS output
const importMetaUrlPlugin = {
  name: 'import-meta-url',
  setup(build) {
    build.onLoad({ filter: /\.tsx?$/ }, async (args) => {
      const fs = await import('fs');
      let contents = await fs.promises.readFile(args.path, 'utf8');
      
      // Handle shebang
      let shebang = '';
      if (contents.startsWith('#!')) {
        const newlineIndex = contents.indexOf('\n');
        if (newlineIndex !== -1) {
          shebang = contents.substring(0, newlineIndex + 1);
          contents = contents.substring(newlineIndex + 1);
        }
      }
      
      if (contents.includes('import.meta.url')) {
        contents = contents.replace(/import\.meta\.url/g, '__import_meta_url');
        contents = `const __import_meta_url = require('url').pathToFileURL(__filename).toString();\n${contents}`;
      }
      
      if (shebang) {
        contents = shebang + contents;
      }
      
      return {
        contents,
        loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts',
      };
    });
  }
};

await esbuild.build({
  entryPoints: [join(__dirname, 'src/index.tsx')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: join(outputDir, 'shell.mjs'),
  format: 'esm',
  external: [
    // Native modules
    'better-sqlite3',
    'sql.js',
    // Ink/React - keep external so npm installs them
    'ink',
    'ink-text-input',
    'ink-select-input',
    'ink-spinner',
    'react',
    'react-devtools-core',
    'yoga-wasm-web',
  ],
  define: {
    'process.env.BUNDLED': '"true"',
  },
  plugins: [workspacePlugin],
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  banner: {
    js: [
      // Inject CJS compatibility for ESM bundle: create a require() function
      // so that bundled CJS code (and dynamic require calls) work correctly
      "import { createRequire as __bundleCreateRequire } from 'module';",
      "const require = __bundleCreateRequire(import.meta.url);",
    ].join('\n'),
  },
  minify: false,
  sourcemap: false,
});

// Post-process the bundle to fix ESM compatibility issues
const { readFileSync: readFS, writeFileSync: writeFS } = await import('fs');
const outputFile = join(outputDir, 'shell.mjs');
let content = readFS(outputFile, 'utf-8');

// 1. Remove any shebangs from source files (esbuild may preserve them)
//    But keep the banner lines (import createRequire, const require)
const lines = content.split('\n');
const cleanedLines = lines.filter(line => !line.startsWith('#!'));
content = cleanedLines.join('\n');

// 2. Fix CJS `require.main === module` checks that don't work in ESM
content = content.replace(/if\s*\(__require\.main\s*===\s*module\)\s*\{[^}]*\}/g, '/* require.main check removed for ESM bundle */');

// 3. Fix `import.meta.url === file://...` checks that would trigger main() in bundled code
// This removes the main() call when bundled (but keeps the function export)
content = content.replace(/if\s*\(\s*__import_meta_url\s*===\s*`file:\/\/\$\{process\.argv\[1\]\}`\s*\)\s*\{\s*main\(\);\s*\}/g, '/* main() call removed for ESM bundle */');

// 4. Also remove the try-catch version with realpathSync (used in newer CLI code)
// Match the pattern: try { const currentFile = realpathSync(fileURLToPath(import.meta.url)); ... if (currentFile === entryFile) { main(); } } catch { }
content = content.replace(/try\s*\{\s*const\s+currentFile\s*=\s*realpathSync\(fileURLToPath\(import\.meta\.url\)\);[\s\S]*?const\s+entryFile\s*=\s*process\.argv\[1\]\s*\?\s*realpathSync\(process\.argv\[1\]\)\s*:\s*"";[\s\S]*?if\s*\(currentFile\s*===\s*entryFile\)\s*\{\s*main\(\);\s*\}\s*\}\s*catch\s*\{\s*\}/g, '/* main() call removed for ESM bundle */');

// 3. Add single shebang at the very top
content = '#!/usr/bin/env node\n' + content;
writeFS(outputFile, content);

console.log('✅ Shell bundle complete! Output: apps/shell/bundle/shell.mjs');
