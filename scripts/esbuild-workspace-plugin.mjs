/**
 * esbuild plugin: resolve @zotero-headless/* workspace packages to monorepo source.
 *
 * Why this is needed:
 *   pnpm uses a content-addressable store (.pnpm/) with symlinks. When esbuild
 *   bundles code that transitively imports a workspace package (e.g. CLI importing
 *   attachment-manager), it follows pnpm's symlinks into the store, where only
 *   package.json exists — dist/ is not there. This plugin short-circuits resolution
 *   to point directly at the real package directory under packages/ or apps/.
 */
import { existsSync, readFileSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function resolveEntry(pkgDir) {
  const pkgJsonPath = join(pkgDir, 'package.json');
  if (!existsSync(pkgJsonPath)) return null;

  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));

  // Try exports["."] first (modern), then main (legacy)
  let entry = pkg.main || 'dist/index.js';
  if (pkg.exports) {
    const root = pkg.exports['.'];
    if (typeof root === 'string') entry = root;
    else if (root?.import) entry = root.import;
    else if (root?.default) entry = root.default;
  }

  const entryPath = resolve(pkgDir, entry);
  return existsSync(entryPath) ? entryPath : null;
}

/** @type {import('esbuild').Plugin} */
export const workspaceResolvePlugin = {
  name: 'workspace-resolve',
  setup(build) {
    build.onResolve({ filter: /^@zotero-headless\// }, (args) => {
      const pkgName = args.path.replace('@zotero-headless/', '');

      for (const base of ['packages', 'apps']) {
        const pkgDir = resolve(rootDir, base, pkgName);
        const resolved = resolveEntry(pkgDir);
        if (resolved) return { path: resolved };
      }

      // Let esbuild try its default resolution as fallback
      return undefined;
    });
  },
};
