/**
 * Custom Commands for the Zotero Virtual Filesystem
 *
 * Overrides built-in just-bash commands with database-optimized versions:
 * - grep: Uses FTS5 for recursive content search
 * - ls: Shows item titles alongside keys
 */

import { defineCommand, type ExecResult, type CommandContext } from 'just-bash';
import { parseItemData } from '@zotero-headless/types';
import { resolvePath, getItemVirtualEntries } from './path-resolver.js';
import { getCollectionTree } from './cache.js';
import type { ResolvedPath } from './types.js';

// ============ DB Helpers ============

let _dbModule: any;
async function getDb() {
  if (!_dbModule) {
    _dbModule = await import('@zotero-headless/database');
  }
  return _dbModule;
}

let _drizzleModule: any;
async function getDrizzle() {
  if (!_drizzleModule) {
    _drizzleModule = await import('drizzle-orm');
  }
  return _drizzleModule;
}

// ============ Custom ls ============

/**
 * Custom ls that shows item titles alongside keys.
 *
 * For item-listing directories (/items/, /collections/<name>/, /tags/<tag>/, etc.),
 * the output includes:
 *   <key>   <title>
 * For other directories, falls back to standard readdir listing.
 */
export const customLs = defineCommand('ls', async (args: string[], ctx: CommandContext): Promise<ExecResult> => {
  // Parse flags
  let longFormat = false;
  let showAll = false;
  let recursive = false;
  let onePerLine = false;
  const paths: string[] = [];

  for (const arg of args) {
    if (arg.startsWith('-') && !arg.startsWith('--')) {
      for (const ch of arg.slice(1)) {
        if (ch === 'l') longFormat = true;
        else if (ch === 'a') showAll = true;
        else if (ch === 'R') recursive = true;
        else if (ch === '1') onePerLine = true;
      }
    } else if (arg === '--all') {
      showAll = true;
    } else if (arg === '--long') {
      longFormat = true;
    } else {
      paths.push(arg);
    }
  }

  if (paths.length === 0) {
    paths.push(ctx.cwd);
  }

  const lines: string[] = [];
  const multiplePaths = paths.length > 1;

  for (const rawPath of paths) {
    const absPath = rawPath.startsWith('/') ? rawPath : ctx.fs.resolvePath(ctx.cwd, rawPath);
    const resolved = await resolvePath(absPath);

    if (!resolved) {
      return { stdout: '', stderr: `ls: cannot access '${rawPath}': No such file or directory\n`, exitCode: 2 };
    }

    if (multiplePaths) {
      lines.push(`${rawPath}:`);
    }

    // Check if this is a directory that lists items
    if (isItemListingDir(resolved)) {
      const entries = await getItemListingEntries(resolved, longFormat);
      lines.push(...entries);
    } else {
      // Use standard readdir for non-item directories
      try {
        const entries = await ctx.fs.readdir(absPath);
        if (longFormat) {
          for (const name of entries) {
            const fullPath = ctx.fs.resolvePath(absPath, name);
            try {
              const s = await ctx.fs.stat(fullPath);
              const typeChar = s.isDirectory ? 'd' : '-';
              const sizeStr = String(s.size).padStart(8);
              const dateStr = formatLsDate(s.mtime);
              const suffix = s.isDirectory ? '/' : '';
              lines.push(`${typeChar}rw-r--r--  ${sizeStr}  ${dateStr}  ${name}${suffix}`);
            } catch {
              lines.push(`?---------         ?  ?             ${name}`);
            }
          }
        } else {
          for (const name of entries) {
            const fullPath = ctx.fs.resolvePath(absPath, name);
            try {
              const s = await ctx.fs.stat(fullPath);
              lines.push(s.isDirectory ? `${name}/` : name);
            } catch {
              lines.push(name);
            }
          }
        }
      } catch (e: any) {
        return { stdout: '', stderr: `ls: ${e.message}\n`, exitCode: 2 };
      }
    }

    if (multiplePaths) {
      lines.push('');
    }
  }

  return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
});

/** ResolvedPath types that list items and have libraryId */
type ItemListingPath = Extract<ResolvedPath,
  | { type: 'items-dir' }
  | { type: 'collection' }
  | { type: 'tag' }
  | { type: 'item-type' }
  | { type: 'unfiled-dir' }
>;

function isItemListingDir(resolved: ResolvedPath): resolved is ItemListingPath {
  return ['items-dir', 'collection', 'tag', 'item-type', 'unfiled-dir'].includes(resolved.type);
}


async function getItemListingEntries(resolved: ItemListingPath, longFormat: boolean): Promise<string[]> {
  const { getDatabase, items, collections: collectionsTable } = await getDb();
  const { eq, and, like, sql } = await getDrizzle();
  const db = getDatabase();
  const lines: string[] = [];
  const MAX_ITEMS = 200;

  // For collections, first list subcollections
  if (resolved.type === 'collection') {
    const tree = await getCollectionTree(resolved.libraryId);
    const children = tree.byParent.get(resolved.collectionKey) ?? [];
    for (const child of children) {
      if (longFormat) {
        lines.push(`drw-r--r--         0  ${padR(child.key, 10)}  ${child.sanitizedName}/`);
      } else {
        lines.push(`${child.sanitizedName}/`);
      }
    }
  }

  // Build query for items
  const conditions: any[] = [
    eq(items.libraryId, resolved.libraryId),
    eq(items.deleted, false),
  ];

  switch (resolved.type) {
    case 'collection':
      conditions.push(like(items.collectionKeys, `%${resolved.collectionKey}%`));
      break;
    case 'tag': {
      // Get item keys with this tag via itemTags table
      const { itemTags } = await getDb();
      const taggedKeys = (db as any).select({ itemKey: itemTags.itemKey }).from(itemTags)
        .where(and(eq(itemTags.libraryId, resolved.libraryId), eq(itemTags.tag, resolved.tag)))
        .limit(MAX_ITEMS).all() as any[];
      if (taggedKeys.length === 0) return lines;
      // Filter by tagged keys using IN clause
      const keys = taggedKeys.map((t: any) => t.itemKey);
      conditions.push(sql`${items.key} IN (${sql.join(keys.map((k: string) => sql`${k}`), sql`, `)})`);
      break;
    }
    case 'item-type':
      conditions.push(eq(items.itemType, resolved.itemType));
      break;
    case 'unfiled-dir':
      conditions.push(sql`(${items.collectionKeys} IS NULL OR ${items.collectionKeys} = '[]')`);
      break;
    // items-dir: no additional filter
  }

  const rows = (db as any).select().from(items)
    .where(and(...conditions))
    .limit(MAX_ITEMS)
    .all() as any[];

  // Filter out child item types
  const topLevel = rows.filter((r: any) => !['note', 'annotation', 'attachment'].includes(r.itemType));

  // Count total for truncation message
  let totalCount = topLevel.length;
  if (topLevel.length === MAX_ITEMS) {
    // There may be more — do a count query
    const countResult = (db as any).select({ count: sql`COUNT(*)` }).from(items)
      .where(and(...conditions)).get() as any;
    totalCount = countResult?.count ?? MAX_ITEMS;
  }

  for (const item of topLevel) {
    const title = getDisplayTitle(item);
    if (longFormat) {
      const typeStr = padR(item.itemType ?? '?', 18);
      const dateStr = formatLsDate(unixToDate(item.updatedAt));
      lines.push(`-rw-r--r--  ${typeStr}  ${dateStr}  ${item.key}  ${title}`);
    } else {
      lines.push(`${item.key}  ${title}`);
    }
  }

  if (totalCount > topLevel.length) {
    lines.push(`  ... (showing ${topLevel.length} of ${totalCount} items)`);
  }

  return lines;
}

// ============ Custom grep (FTS5-optimized) ============

/**
 * Custom grep that uses FTS5 for recursive searches.
 *
 * For `grep -r PATTERN /items/` or similar item-listing paths,
 * queries the FTS5 index first, then does precise matching.
 * For single-file greps, reads the file directly.
 */
export const customGrep = defineCommand('grep', async (args: string[], ctx: CommandContext): Promise<ExecResult> => {
  // Parse grep arguments
  let recursive = false;
  let ignoreCase = false;
  let lineNumbers = false;
  let countOnly = false;
  let invertMatch = false;
  let filesWithMatches = false;
  let fixedStrings = false;
  let maxCount = Infinity;
  const patterns: string[] = [];
  const paths: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-r' || arg === '-R' || arg === '--recursive') {
      recursive = true;
    } else if (arg === '-i' || arg === '--ignore-case') {
      ignoreCase = true;
    } else if (arg === '-n' || arg === '--line-number') {
      lineNumbers = true;
    } else if (arg === '-c' || arg === '--count') {
      countOnly = true;
    } else if (arg === '-v' || arg === '--invert-match') {
      invertMatch = true;
    } else if (arg === '-l' || arg === '--files-with-matches') {
      filesWithMatches = true;
    } else if (arg === '-F' || arg === '--fixed-strings') {
      fixedStrings = true;
    } else if (arg === '-m' || arg === '--max-count') {
      maxCount = parseInt(args[++i] ?? '0', 10);
    } else if (arg === '-e' || arg === '--regexp') {
      patterns.push(args[++i] ?? '');
    } else if (arg.startsWith('-')) {
      // Handle combined flags like -rn, -ri
      for (const ch of arg.slice(1)) {
        if (ch === 'r' || ch === 'R') recursive = true;
        else if (ch === 'i') ignoreCase = true;
        else if (ch === 'n') lineNumbers = true;
        else if (ch === 'c') countOnly = true;
        else if (ch === 'v') invertMatch = true;
        else if (ch === 'l') filesWithMatches = true;
        else if (ch === 'F') fixedStrings = true;
      }
    } else if (patterns.length === 0) {
      patterns.push(arg);
    } else {
      paths.push(arg);
    }
  }

  if (patterns.length === 0) {
    return { stdout: '', stderr: 'grep: missing pattern\n', exitCode: 2 };
  }

  const pattern = patterns[0];
  const regexFlags = ignoreCase ? 'gi' : 'g';
  let regex: RegExp;
  try {
    regex = fixedStrings
      ? new RegExp(escapeRegex(pattern), regexFlags)
      : new RegExp(pattern, regexFlags);
  } catch (e: any) {
    return { stdout: '', stderr: `grep: invalid regex: ${e.message}\n`, exitCode: 2 };
  }

  // If no paths and stdin is available, grep stdin
  if (paths.length === 0 && ctx.stdin) {
    const result = grepContent(ctx.stdin, regex, invertMatch, lineNumbers, countOnly, maxCount, '');
    return { stdout: result, stderr: '', exitCode: result ? 0 : 1 };
  }

  // Default path
  if (paths.length === 0) {
    paths.push(ctx.cwd);
  }

  // Check if we can use FTS5 optimization
  for (const rawPath of paths) {
    const absPath = rawPath.startsWith('/') ? rawPath : ctx.fs.resolvePath(ctx.cwd, rawPath);
    const resolved = await resolvePath(absPath);

    if (resolved && recursive && canUseFts(resolved)) {
      // FTS5-optimized path
      return ftsGrep(resolved, pattern, regex, {
        ignoreCase, lineNumbers, countOnly, invertMatch, filesWithMatches, maxCount,
      });
    }
  }

  // Fallback: standard file-by-file grep
  const lines: string[] = [];
  let hasMatch = false;

  for (const rawPath of paths) {
    const absPath = rawPath.startsWith('/') ? rawPath : ctx.fs.resolvePath(ctx.cwd, rawPath);

    try {
      const stat = await ctx.fs.stat(absPath);
      if (stat.isDirectory) {
        if (recursive) {
          const matches = await grepRecursive(ctx, absPath, regex, invertMatch, lineNumbers, countOnly, filesWithMatches, maxCount);
          if (matches) { lines.push(matches); hasMatch = true; }
        } else {
          lines.push(`grep: ${rawPath}: Is a directory`);
        }
      } else {
        const content = await ctx.fs.readFile(absPath);
        const result = grepContent(content, regex, invertMatch, lineNumbers, countOnly, maxCount, absPath);
        if (result) {
          if (filesWithMatches) {
            lines.push(absPath);
            hasMatch = true;
          } else {
            lines.push(result);
            hasMatch = true;
          }
        }
      }
    } catch (e: any) {
      lines.push(`grep: ${rawPath}: ${e.message}`);
    }
  }

  const stdout = lines.length > 0 ? lines.join('\n') + '\n' : '';
  return { stdout, stderr: '', exitCode: hasMatch ? 0 : 1 };
});

function canUseFts(resolved: ResolvedPath): resolved is ItemListingPath {
  return ['items-dir', 'collection', 'tag', 'item-type', 'unfiled-dir'].includes(resolved.type);
}

/**
 * FTS5-optimized grep: queries the full-text index, then does precise matching.
 */
async function ftsGrep(
  resolved: ItemListingPath,
  pattern: string,
  regex: RegExp,
  opts: {
    ignoreCase: boolean;
    lineNumbers: boolean;
    countOnly: boolean;
    invertMatch: boolean;
    filesWithMatches: boolean;
    maxCount: number;
  },
): Promise<ExecResult> {
  const { getRawSQLite, getDatabase, items, attachments } = await getDb();
  const { eq, and, like, sql: sqlTag } = await getDrizzle();
  const db = getDatabase();

  let hasMatch = false;
  const lines: string[] = [];

  // Step 1: Search item metadata (title, abstract) using SQL LIKE
  const metadataConditions: any[] = [
    eq(items.libraryId, resolved.libraryId),
    eq(items.deleted, false),
  ];

  // Add scope filter
  if (resolved.type === 'collection') {
    metadataConditions.push(like(items.collectionKeys, `%${resolved.collectionKey}%`));
  }

  const likePattern = `%${pattern}%`;
  const metaRows = (db as any).select().from(items)
    .where(and(
      ...metadataConditions,
      sqlTag`(${items.title} LIKE ${likePattern} OR ${items.abstract} LIKE ${likePattern})`,
    ))
    .limit(100)
    .all() as any[];

  for (const item of metaRows) {
    if (['note', 'annotation', 'attachment'].includes(item.itemType)) continue;
    const title = item.title ?? '';
    const abstract = item.abstract ?? '';

    if (regex.test(title)) {
      const path = `/items/${item.key}/metadata.json`;
      if (opts.filesWithMatches) {
        lines.push(path);
      } else {
        lines.push(`${path}:  "title": "${title}"`);
      }
      hasMatch = true;
    }

    regex.lastIndex = 0;
    if (abstract && regex.test(abstract)) {
      const path = `/items/${item.key}/abstract.txt`;
      if (opts.filesWithMatches) {
        lines.push(path);
      } else {
        // Show a snippet
        const snippet = getMatchSnippet(abstract, regex);
        lines.push(`${path}:  ${snippet}`);
      }
      hasMatch = true;
    }
    regex.lastIndex = 0;
  }

  // Step 2: Search attachment content via FTS5
  try {
    const sqlite = getRawSQLite({ quiet: true });

    // Build FTS5 query — for simple patterns, use phrase matching
    const ftsQuery = pattern
      .replace(/['"]/g, '') // strip quotes
      .replace(/\s+/g, ' ')
      .trim();

    if (ftsQuery) {
      const ftsRows = sqlite.prepare(`
        SELECT attachment_key, parent_item_key, library_id,
               snippet(content_fts, 0, '>>>', '<<<', '...', 30) as snippet
        FROM content_fts
        WHERE content_fts MATCH ?
        AND library_id = ?
        ORDER BY rank
        LIMIT 50
      `).all(`"${ftsQuery}"`, resolved.libraryId) as any[];

      for (const row of ftsRows) {
        // Look up the attachment filename
        const att = (db as any).select().from(attachments)
          .where(and(eq(attachments.key, row.attachment_key), eq(attachments.libraryId, row.library_id)))
          .get();

        const filename = att?.filename ?? row.attachment_key;
        const parentKey = row.parent_item_key ?? att?.parentItemKey ?? '?';
        const path = `/items/${parentKey}/attachments/${filename}`;

        if (opts.filesWithMatches) {
          lines.push(path);
        } else {
          lines.push(`${path}:  ${row.snippet}`);
        }
        hasMatch = true;
      }
    }
  } catch {
    // FTS5 not available or not populated — skip silently
  }

  if (!hasMatch) {
    return { stdout: '', stderr: '', exitCode: 1 };
  }

  return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
}

async function grepRecursive(
  ctx: CommandContext,
  dirPath: string,
  regex: RegExp,
  invertMatch: boolean,
  lineNumbers: boolean,
  countOnly: boolean,
  filesWithMatches: boolean,
  maxCount: number,
  depth = 0,
): Promise<string> {
  if (depth > 10) return ''; // Safety limit

  const lines: string[] = [];
  try {
    const entries = await ctx.fs.readdir(dirPath);
    for (const name of entries) {
      const fullPath = ctx.fs.resolvePath(dirPath, name);
      try {
        const stat = await ctx.fs.stat(fullPath);
        if (stat.isDirectory) {
          const sub = await grepRecursive(ctx, fullPath, regex, invertMatch, lineNumbers, countOnly, filesWithMatches, maxCount, depth + 1);
          if (sub) lines.push(sub);
        } else {
          const content = await ctx.fs.readFile(fullPath);
          if (filesWithMatches) {
            regex.lastIndex = 0;
            if (regex.test(content)) lines.push(fullPath);
          } else {
            const result = grepContent(content, regex, invertMatch, lineNumbers, countOnly, maxCount, fullPath);
            if (result) lines.push(result);
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }
  } catch {
    // Skip dirs that can't be listed
  }
  return lines.join('\n');
}

// ============ Helpers ============

function grepContent(
  content: string,
  regex: RegExp,
  invertMatch: boolean,
  lineNumbers: boolean,
  countOnly: boolean,
  maxCount: number,
  filePath: string,
): string {
  const contentLines = content.split('\n');
  const matches: string[] = [];
  let count = 0;
  const prefix = filePath ? `${filePath}:` : '';

  for (let i = 0; i < contentLines.length && count < maxCount; i++) {
    regex.lastIndex = 0;
    const matched = regex.test(contentLines[i]);
    if (matched !== invertMatch) {
      count++;
      if (!countOnly) {
        const lineNum = lineNumbers ? `${i + 1}:` : '';
        matches.push(`${prefix}${lineNum}${contentLines[i]}`);
      }
    }
  }

  if (countOnly) {
    return count > 0 ? `${prefix}${count}` : '';
  }
  return matches.join('\n');
}

function getMatchSnippet(text: string, regex: RegExp): string {
  regex.lastIndex = 0;
  const match = regex.exec(text);
  if (!match) return text.slice(0, 80);

  const start = Math.max(0, match.index - 30);
  const end = Math.min(text.length, match.index + match[0].length + 30);
  let snippet = text.slice(start, end).replace(/\n/g, ' ');
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';
  return snippet;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getDisplayTitle(item: any): string {
  if (item.title && item.title.trim()) {
    return item.title.length > 80 ? item.title.slice(0, 77) + '...' : item.title;
  }
  if (item.itemType === 'note' && item.rawJson) {
    const data = parseItemData(item.rawJson);
    const html = data.note ?? '';
    const plain = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    return plain ? (plain.length > 60 ? plain.slice(0, 57) + '...' : plain) : '(empty note)';
  }
  if (item.itemType === 'annotation' && item.rawJson) {
    const data = parseItemData(item.rawJson);
    const text = (data.annotationText ?? data.annotationComment ?? '').replace(/\n/g, ' ').trim();
    return text ? (text.length > 60 ? text.slice(0, 57) + '...' : text) : '(empty annotation)';
  }
  return '(no title)';
}

function formatLsDate(date: Date): string {
  if (!date || date.getTime() === 0) return '            ';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = months[date.getMonth()];
  const d = String(date.getDate()).padStart(2, ' ');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${m} ${d} ${h}:${min}`;
}

function unixToDate(ts: number | null | undefined): Date {
  if (!ts) return new Date(0);
  return new Date(ts * 1000);
}

function padR(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}
