import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { zotero: 'src/index.ts' },
  outDir: 'bundle',
  format: 'cjs',
  target: 'node18',
  platform: 'node',
  banner: { js: '#!/usr/bin/env node' },
  external: ['better-sqlite3', 'sql.js'],
  noExternal: [/^(?!better-sqlite3|sql\.js).*/],
  splitting: false,
  clean: true,
  define: { 'process.env.BUNDLED': '"true"' },
  esbuildPlugins: [
    {
      // Strip shebangs from source files so only the banner shebang remains
      // and polyfill import.meta.url for CJS output
      name: 'cjs-compat',
      setup(build) {
        build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
          const fs = await import('fs');
          let contents = await fs.promises.readFile(args.path, 'utf8');

          // Strip shebang
          if (contents.startsWith('#!')) {
            contents = contents.replace(/^#![^\n]*\n/, '');
          }

          // Polyfill import.meta.url → CJS equivalent
          if (contents.includes('import.meta.url')) {
            contents = contents.replace(/import\.meta\.url/g, '__import_meta_url');
            contents = `const __import_meta_url = require('url').pathToFileURL(__filename).toString();\n${contents}`;
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
});
