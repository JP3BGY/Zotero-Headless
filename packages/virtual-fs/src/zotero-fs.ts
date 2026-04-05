/**
 * ZoteroFs — Virtual Filesystem Implementation
 *
 * Implements just-bash's IFileSystem interface backed by Zotero's SQLite database.
 * All file operations are translated to DB queries. Write operations throw EROFS.
 */

import type {
  IFileSystem,
  FsStat,
  BufferEncoding,
  FileContent,
  MkdirOptions,
  RmOptions,
  CpOptions,
} from 'just-bash';
import { resolvePath, getRootEntries, getItemVirtualEntries, setLibraryId } from './path-resolver.js';
import type { DirentEntry } from './node-factory.js';
import { getCollectionTree, getDefaultLibraryId } from './cache.js';
import {
  dirStat,
  fileStat,
  direntDir,
  direntFile,
  renderMetadataJson,
  renderAbstract,
  renderNote,
  renderAnnotation,
  itemDirStat,
  metadataFileStat,
  abstractFileStat,
} from './node-factory.js';
import { parseItemData } from '@zotero-headless/types';
import type { ResolvedPath } from './types.js';
import { getDb, getDrizzle } from './db-helpers.js';

const MAX_LIST_ITEMS = 200;

// ============ Read-only Error ============

class ReadOnlyError extends Error {
  constructor() {
    super('EROFS: read-only file system');
    this.name = 'ReadOnlyError';
  }
}

class NotFoundError extends Error {
  constructor(path: string) {
    super(`ENOENT: no such file or directory, '${path}'`);
    this.name = 'NotFoundError';
  }
}

class NotDirectoryError extends Error {
  constructor(path: string) {
    super(`ENOTDIR: not a directory, '${path}'`);
    this.name = 'NotDirectoryError';
  }
}

class IsDirectoryError extends Error {
  constructor(path: string) {
    super(`EISDIR: illegal operation on a directory, '${path}'`);
    this.name = 'IsDirectoryError';
  }
}

// ============ ZoteroFs Class ============

export class ZoteroFs implements IFileSystem {
  private libraryId: number | null;
  private initialized = false;

  /** Batch prefetch cache: item key → item row. Avoids N+1 queries when ls calls stat on each entry. */
  private itemCache = new Map<string, any>();
  private itemCacheTimestamp = 0;
  private static readonly ITEM_CACHE_TTL_MS = 30_000;

  constructor(options?: { libraryId?: number }) {
    this.libraryId = options?.libraryId ?? null;
  }

  /** Prefetch items into cache for batch access (called by readdir) */
  private prefetchItems(rows: any[]): void {
    this.itemCache.clear();
    for (const row of rows) {
      this.itemCache.set(row.key, row);
    }
    this.itemCacheTimestamp = Date.now();
  }

  /** Get a cached item row, or null if not cached / expired */
  private getCachedItem(key: string): any | null {
    if (Date.now() - this.itemCacheTimestamp > ZoteroFs.ITEM_CACHE_TTL_MS) {
      this.itemCache.clear();
      return null;
    }
    return this.itemCache.get(key) ?? null;
  }

  private async ensureInit(): Promise<number> {
    if (!this.initialized) {
      if (this.libraryId === null) {
        this.libraryId = await getDefaultLibraryId();
      }
      setLibraryId(this.libraryId);
      this.initialized = true;
    }
    return this.libraryId!;
  }

  // ============ Read Operations ============

  async readFile(path: string, _options?: { encoding?: BufferEncoding | null } | BufferEncoding): Promise<string> {
    await this.ensureInit();
    const resolved = await resolvePath(path);
    if (!resolved) throw new NotFoundError(path);

    return this.readFileContent(resolved, path);
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const content = await this.readFile(path);
    return new TextEncoder().encode(content);
  }

  async exists(path: string): Promise<boolean> {
    await this.ensureInit();
    const resolved = await resolvePath(path);
    return resolved !== null;
  }

  async stat(path: string): Promise<FsStat> {
    await this.ensureInit();
    const resolved = await resolvePath(path);
    if (!resolved) throw new NotFoundError(path);

    return this.getStat(resolved, path);
  }

  async readdir(path: string): Promise<string[]> {
    await this.ensureInit();
    const resolved = await resolvePath(path);
    if (!resolved) throw new NotFoundError(path);

    return this.listDirectory(resolved, path);
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    await this.ensureInit();
    const resolved = await resolvePath(path);
    if (!resolved) throw new NotFoundError(path);

    return this.listDirectoryWithTypes(resolved, path);
  }

  resolvePath(base: string, pathArg: string): string {
    if (pathArg.startsWith('/')) return pathArg;
    // Normalize base + relative path
    const parts = (base + '/' + pathArg).split('/');
    const resolved: string[] = [];
    for (const part of parts) {
      if (part === '' || part === '.') continue;
      if (part === '..') resolved.pop();
      else resolved.push(part);
    }
    return '/' + resolved.join('/');
  }

  getAllPaths(): string[] {
    // Not feasible for a database-backed FS — return empty.
    // just-bash will fall back to readdir-based glob matching.
    return [];
  }

  async lstat(path: string): Promise<FsStat> {
    // No symlinks in VFS
    return this.stat(path);
  }

  async realpath(path: string): Promise<string> {
    // No symlinks — just normalize
    const parts = path.split('/');
    const resolved: string[] = [];
    for (const part of parts) {
      if (part === '' || part === '.') continue;
      if (part === '..') resolved.pop();
      else resolved.push(part);
    }
    const normalized = '/' + resolved.join('/');

    // Verify it exists
    const res = await resolvePath(normalized);
    if (!res) throw new NotFoundError(path);
    return normalized;
  }

  async readlink(_path: string): Promise<string> {
    throw new Error('EINVAL: no symlinks in virtual filesystem');
  }

  // ============ Write Operations (all throw EROFS) ============

  async writeFile(_path: string, _content: FileContent, _options?: { encoding?: BufferEncoding } | BufferEncoding): Promise<void> {
    throw new ReadOnlyError();
  }

  async appendFile(_path: string, _content: FileContent, _options?: { encoding?: BufferEncoding } | BufferEncoding): Promise<void> {
    throw new ReadOnlyError();
  }

  async mkdir(_path: string, _options?: MkdirOptions): Promise<void> {
    throw new ReadOnlyError();
  }

  async rm(_path: string, _options?: RmOptions): Promise<void> {
    throw new ReadOnlyError();
  }

  async cp(_src: string, _dest: string, _options?: CpOptions): Promise<void> {
    throw new ReadOnlyError();
  }

  async mv(_src: string, _dest: string): Promise<void> {
    throw new ReadOnlyError();
  }

  async chmod(_path: string, _mode: number): Promise<void> {
    throw new ReadOnlyError();
  }

  async symlink(_target: string, _linkPath: string): Promise<void> {
    throw new ReadOnlyError();
  }

  async link(_existingPath: string, _newPath: string): Promise<void> {
    throw new ReadOnlyError();
  }

  async utimes(_path: string, _atime: Date, _mtime: Date): Promise<void> {
    throw new ReadOnlyError();
  }

  // ============ Internal: readFile dispatch ============

  /** Fetch item by key, using prefetch cache if available */
  private async fetchItem(libraryId: number, itemKey: string): Promise<any | null> {
    const cached = this.getCachedItem(itemKey);
    if (cached) return cached;

    const { getDatabase, items } = await getDb();
    const { eq, and } = await getDrizzle();
    const db = getDatabase();
    return (db as any).select().from(items)
      .where(and(eq(items.key, itemKey), eq(items.libraryId, libraryId)))
      .get() ?? null;
  }

  private async readFileContent(resolved: ResolvedPath, path: string): Promise<string> {
    const { getDatabase, items, attachments, contentCache } = await getDb();
    const { eq, and } = await getDrizzle();
    const db = getDatabase();

    switch (resolved.type) {
      case 'metadata-file': {
        const item = await this.fetchItem(resolved.libraryId, resolved.itemKey);
        if (!item) throw new NotFoundError(path);
        return renderMetadataJson(item);
      }

      case 'abstract-file': {
        const item = await this.fetchItem(resolved.libraryId, resolved.itemKey);
        if (!item) throw new NotFoundError(path);
        return renderAbstract(item);
      }

      case 'note-file': {
        const noteItem = (db as any).select().from(items)
          .where(and(eq(items.key, resolved.noteKey), eq(items.libraryId, resolved.libraryId)))
          .get();
        if (!noteItem) throw new NotFoundError(path);
        return renderNote(noteItem);
      }

      case 'attachment-file': {
        // Try content cache first
        const cached = (db as any).select().from(contentCache)
          .where(and(
            eq(contentCache.attachmentKey, resolved.attachmentKey),
            eq(contentCache.libraryId, resolved.libraryId),
          ))
          .get();

        if (cached) {
          return cached.content;
        }

        // Try extracting content
        try {
          const { ContentExtractor } = await import('@zotero-headless/content-extractor');
          const extractor = new ContentExtractor();
          const result = await extractor.extract(resolved.attachmentKey, {});
          return result.text;
        } catch {
          return `[Content extraction not available for this attachment]\n`;
        }
      }

      case 'annotation-file': {
        const annotItem = (db as any).select().from(items)
          .where(and(eq(items.key, resolved.annotationKey), eq(items.libraryId, resolved.libraryId)))
          .get();
        if (!annotItem) throw new NotFoundError(path);
        return renderAnnotation(annotItem);
      }

      default:
        throw new IsDirectoryError(path);
    }
  }

  // ============ Internal: stat dispatch ============

  private async getStat(resolved: ResolvedPath, path: string): Promise<FsStat> {
    const { getDatabase, items, attachments } = await getDb();
    const { eq, and, sql } = await getDrizzle();
    const db = getDatabase();

    switch (resolved.type) {
      case 'root':
      case 'collections-dir':
      case 'items-dir':
      case 'tags-dir':
      case 'types-dir':
      case 'unfiled-dir':
        return dirStat();

      case 'collection': {
        const tree = await getCollectionTree(resolved.libraryId);
        const col = tree.byKey.get(resolved.collectionKey);
        return dirStat(col ? new Date() : undefined);
      }

      case 'tag':
      case 'item-type':
        return dirStat();

      case 'item': {
        const item = await this.fetchItem(resolved.libraryId, resolved.itemKey);
        if (!item) throw new NotFoundError(path);
        return itemDirStat(item);
      }

      case 'metadata-file': {
        const item = await this.fetchItem(resolved.libraryId, resolved.itemKey);
        if (!item) throw new NotFoundError(path);
        return metadataFileStat(item);
      }

      case 'abstract-file': {
        const item = await this.fetchItem(resolved.libraryId, resolved.itemKey);
        if (!item) throw new NotFoundError(path);
        return abstractFileStat(item);
      }

      case 'notes-dir':
      case 'attachments-dir':
      case 'annotations-dir':
        return dirStat();

      case 'note-file': {
        const noteItem = (db as any).select().from(items)
          .where(and(eq(items.key, resolved.noteKey), eq(items.libraryId, resolved.libraryId)))
          .get();
        if (!noteItem) throw new NotFoundError(path);
        const content = renderNote(noteItem);
        return fileStat(Buffer.byteLength(content, 'utf-8'));
      }

      case 'attachment-file': {
        const att = (db as any).select().from(attachments)
          .where(and(eq(attachments.key, resolved.attachmentKey), eq(attachments.libraryId, resolved.libraryId)))
          .get();
        if (att) return fileStat(att.size ?? 0);
        // Fallback: check items table
        const attItem = (db as any).select().from(items)
          .where(and(eq(items.key, resolved.attachmentKey), eq(items.libraryId, resolved.libraryId)))
          .get();
        if (!attItem) throw new NotFoundError(path);
        return fileStat(0);
      }

      case 'annotation-file': {
        const annotItem = (db as any).select().from(items)
          .where(and(eq(items.key, resolved.annotationKey), eq(items.libraryId, resolved.libraryId)))
          .get();
        if (!annotItem) throw new NotFoundError(path);
        const content = renderAnnotation(annotItem);
        return fileStat(Buffer.byteLength(content, 'utf-8'));
      }

      default:
        throw new NotFoundError(path);
    }
  }

  // ============ Internal: readdir dispatch ============

  private async listDirectory(resolved: ResolvedPath, path: string): Promise<string[]> {
    const entries = await this.listDirectoryWithTypes(resolved, path);
    return entries.map(e => e.name);
  }

  private async listDirectoryWithTypes(resolved: ResolvedPath, path: string): Promise<DirentEntry[]> {
    const { getDatabase, items, attachments, itemTags } = await getDb();
    const { eq, and, sql, isNull, like } = await getDrizzle();
    const db = getDatabase();

    switch (resolved.type) {
      case 'root':
        return getRootEntries().map(direntDir);

      case 'collections-dir': {
        const tree = await getCollectionTree(resolved.libraryId);
        const rootCollections = tree.byParent.get(null) ?? [];
        return rootCollections.map(c => direntDir(c.sanitizedName));
      }

      case 'collection': {
        const tree = await getCollectionTree(resolved.libraryId);
        const children = tree.byParent.get(resolved.collectionKey) ?? [];
        const entries: DirentEntry[] = children.map(c => direntDir(c.sanitizedName));

        // Also list items in this collection
        const collItems = (db as any).select().from(items)
          .where(and(
            eq(items.libraryId, resolved.libraryId),
            eq(items.deleted, false),
            like(items.collectionKeys, `%${resolved.collectionKey}%`),
          ))
          .limit(MAX_LIST_ITEMS)
          .all() as any[];

        // Prefetch items for subsequent stat() calls
        this.prefetchItems(collItems);

        // Filter to top-level items (not notes, annotations, or attachments)
        for (const item of collItems) {
          if (['note', 'annotation', 'attachment'].includes(item.itemType)) continue;
          entries.push(direntDir(item.key));
        }
        return entries;
      }

      case 'items-dir': {
        const allItems = (db as any).select().from(items)
          .where(and(
            eq(items.libraryId, resolved.libraryId),
            eq(items.deleted, false),
          ))
          .limit(MAX_LIST_ITEMS)
          .all() as any[];

        // Prefetch items for subsequent stat() calls
        this.prefetchItems(allItems);

        return allItems
          .filter((item: any) => !['note', 'annotation', 'attachment'].includes(item.itemType))
          .map((item: any) => direntDir(item.key));
      }

      case 'item': {
        const { files, dirs } = getItemVirtualEntries();
        const entries: DirentEntry[] = [
          ...files.map(direntFile),
          ...dirs.map(direntDir),
        ];
        return entries;
      }

      case 'notes-dir': {
        const notes = (db as any).select().from(items)
          .where(and(
            eq(items.libraryId, resolved.libraryId),
            eq(items.itemType, 'note'),
            like(items.rawJson, `%"parentItem":"${resolved.itemKey}"%`),
          ))
          .all() as any[];

        return notes.map((n: any) => direntFile(`${n.key}.md`));
      }

      case 'attachments-dir': {
        // Query attachments table first
        const attsFromTable = (db as any).select().from(attachments)
          .where(and(
            eq(attachments.parentItemKey, resolved.itemKey),
            eq(attachments.libraryId, resolved.libraryId),
            eq(attachments.deleted, false),
          ))
          .all() as any[];

        const entries: DirentEntry[] = attsFromTable
          .filter((a: any) => a.filename)
          .map((a: any) => direntFile(a.filename));

        // Also check items table for attachment children not in attachments table
        const attKeysInTable = new Set(attsFromTable.map((a: any) => a.key));
        const attItems = (db as any).select().from(items)
          .where(and(
            eq(items.libraryId, resolved.libraryId),
            eq(items.itemType, 'attachment'),
            eq(items.deleted, false),
            like(items.rawJson, `%"parentItem":"${resolved.itemKey}"%`),
          ))
          .all() as any[];

        for (const attItem of attItems) {
          if (attKeysInTable.has(attItem.key)) continue;
          const data = parseItemData(attItem.rawJson);
          const filename = data.filename ?? data.title ?? attItem.key;
          if (filename) entries.push(direntFile(filename));
        }

        return entries;
      }

      case 'annotations-dir': {
        // Annotations are children of attachments, not the top-level item.
        // Find attachment keys, then batch-query annotations in a single IN clause.
        const attChildren = (db as any).select().from(items)
          .where(and(
            eq(items.libraryId, resolved.libraryId),
            eq(items.itemType, 'attachment'),
            like(items.rawJson, `%"parentItem":"${resolved.itemKey}"%`),
          ))
          .all() as any[];

        if (attChildren.length === 0) return [];

        const { getRawSQLite } = await getDb();
        const sqlite = getRawSQLite();
        const placeholders = attChildren.map(() => '?').join(',');
        const attKeys = attChildren.map((a: any) => `%"parentItem":"${a.key}"%`);
        const likeConditions = attKeys.map((_: string, i: number) => `raw_json LIKE ?${i + 2}`).join(' OR ');
        // Use raw SQL for dynamic IN/LIKE conditions
        const annotations = sqlite.prepare(`
          SELECT key FROM items
          WHERE library_id = ? AND item_type = 'annotation'
          AND (${attKeys.map(() => 'raw_json LIKE ?').join(' OR ')})
        `).all(resolved.libraryId, ...attKeys) as any[];

        return annotations.map((a: any) => direntFile(`${a.key}.txt`));
      }

      case 'tags-dir': {
        const tags = (db as any)
          .selectDistinct({ tag: itemTags.tag })
          .from(itemTags)
          .where(eq(itemTags.libraryId, resolved.libraryId))
          .limit(MAX_LIST_ITEMS)
          .all() as any[];

        return tags.map((t: any) => direntDir(t.tag));
      }

      case 'tag': {
        // Find items with this tag
        const taggedItemKeys = (db as any).select({ itemKey: itemTags.itemKey }).from(itemTags)
          .where(and(
            eq(itemTags.libraryId, resolved.libraryId),
            eq(itemTags.tag, resolved.tag),
          ))
          .limit(MAX_LIST_ITEMS)
          .all() as any[];

        return taggedItemKeys.map((t: any) => direntDir(t.itemKey));
      }

      case 'types-dir': {
        const types = (db as any)
          .selectDistinct({ itemType: items.itemType })
          .from(items)
          .where(and(
            eq(items.libraryId, resolved.libraryId),
            eq(items.deleted, false),
          ))
          .all() as any[];

        return types
          .filter((t: any) => !['note', 'annotation', 'attachment'].includes(t.itemType))
          .map((t: any) => direntDir(t.itemType));
      }

      case 'item-type': {
        const typeItems = (db as any).select().from(items)
          .where(and(
            eq(items.libraryId, resolved.libraryId),
            eq(items.itemType, resolved.itemType),
            eq(items.deleted, false),
          ))
          .limit(MAX_LIST_ITEMS)
          .all() as any[];

        return typeItems.map((item: any) => direntDir(item.key));
      }

      case 'unfiled-dir': {
        // Items not in any collection
        const unfiled = (db as any).select().from(items)
          .where(and(
            eq(items.libraryId, resolved.libraryId),
            eq(items.deleted, false),
            sql`(${items.collectionKeys} IS NULL OR ${items.collectionKeys} = '[]')`,
          ))
          .limit(MAX_LIST_ITEMS)
          .all() as any[];

        return unfiled
          .filter((item: any) => !['note', 'annotation', 'attachment'].includes(item.itemType))
          .map((item: any) => direntDir(item.key));
      }

      default:
        throw new NotDirectoryError(path);
    }
  }
}
