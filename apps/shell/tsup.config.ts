import { defineConfig } from 'tsup';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export default defineConfig({
  entry: { shell: 'src/index.tsx' },
  outDir: 'bundle',
  format: 'esm',
  target: 'node18',
  platform: 'node',
  banner: {
    js: [
      "import { createRequire as __bundleCreateRequire } from 'module';",
      "const require = __bundleCreateRequire(import.meta.url);",
    ].join('\n'),
  },
  external: [
    'better-sqlite3',
    'sql.js',
    'ink',
    /^ink-.*/,
    'react',
    'react-devtools-core',
    'yoga-wasm-web',
  ],
  noExternal: [/^(?!better-sqlite3|sql\.js|ink|ink-.*|react|react-devtools-core|yoga-wasm-web).*/],
  outExtension: () => ({ js: '.mjs' }),
  splitting: false,
  clean: true,
  define: { 'process.env.BUNDLED': '"true"' },
  esbuildOptions(options) {
    options.jsx = 'transform';
    options.jsxFactory = 'React.createElement';
    options.jsxFragment = 'React.Fragment';
  },
  esbuildPlugins: [
    {
      name: 'strip-shebang',
      setup(build) {
        build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
          const fs = await import('fs');
          let contents = await fs.promises.readFile(args.path, 'utf8');
          if (contents.startsWith('#!')) {
            contents = contents.replace(/^#![^\n]*\n/, '');
          }
          const ext = args.path.split('.').pop()!;
          const loaderMap: Record<string, string> = {
            ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx',
            mts: 'ts', mjs: 'js', cts: 'ts', cjs: 'js',
          };
          return { contents, loader: (loaderMap[ext] || 'ts') as any };
        });
      },
    },
  ],
  async onSuccess() {
    // Post-process: add shebang and remove bundled main() calls
    const outputFile = join('bundle', 'shell.mjs');
    let content = readFileSync(outputFile, 'utf-8');

    // Remove require.main === module checks (CJS pattern that doesn't work in ESM)
    content = content.replace(
      /if\s*\(__require\.main\s*===\s*module\)\s*\{[^}]*\}/g,
      '/* require.main check removed for ESM bundle */'
    );

    // Remove import.meta.url main() auto-invocation from bundled CLI code
    content = content.replace(
      /if\s*\(\s*__import_meta_url\s*===\s*`file:\/\/\$\{process\.argv\[1\]\}`\s*\)\s*\{\s*main\(\);\s*\}/g,
      '/* main() call removed for ESM bundle */'
    );

    // Remove try-catch version with realpathSync
    content = content.replace(
      /try\s*\{\s*const\s+currentFile\s*=\s*realpathSync\(fileURLToPath\(import\.meta\.url\)\);[\s\S]*?const\s+entryFile\s*=\s*process\.argv\[1\]\s*\?\s*realpathSync\(process\.argv\[1\]\)\s*:\s*"";[\s\S]*?if\s*\(currentFile\s*===\s*entryFile\)\s*\{\s*main\(\);\s*\}\s*\}\s*catch\s*\{\s*\}/g,
      '/* main() call removed for ESM bundle */'
    );

    // Ensure shebang is at the very top
    content = '#!/usr/bin/env node\n' + content;

    writeFileSync(outputFile, content);
  },
});
