/**
 * Path Resolver
 *
 * Resolves virtual filesystem paths to database query parameters.
 * Walks path segments one by one, consulting the DB to validate each segment.
 */

import type { ResolvedPath, CollectionNode } from './types.js';
import { getCollectionTree, getDefaultLibraryId, sanitizeName } from './cache.js';

let _libraryId: number | null = null;

/**
 * Set the library ID used for path resolution.
 */
export function setLibraryId(id: number): void {
  _libraryId = id;
}

/**
 * Get the current library ID, auto-detecting if needed.
 */
async function getLibraryId(): Promise<number> {
  if (_libraryId !== null) return _libraryId;
  _libraryId = await getDefaultLibraryId();
  return _libraryId;
}

/**
 * Root-level virtual directories
 */
const ROOT_ENTRIES = ['collections', 'items', 'tags', 'types', 'unfiled'];

/**
 * Virtual files within an item directory
 */
const ITEM_VIRTUAL_FILES = ['metadata.json', 'abstract.txt'];
const ITEM_VIRTUAL_DIRS = ['notes', 'attachments', 'annotations'];

/**
 * Resolve a virtual filesystem path to a ResolvedPath descriptor.
 * Returns null if the path doesn't map to any valid VFS entity.
 */
export async function resolvePath(path: string): Promise<ResolvedPath | null> {
  // Normalize path
  const normalized = normalizePath(path);
  const segments = normalized.split('/').filter(Boolean);

  if (segments.length === 0) {
    return { type: 'root' };
  }

  const libraryId = await getLibraryId();
  const firstSegment = segments[0];

  switch (firstSegment) {
    case 'collections':
      return resolveCollectionsPath(libraryId, segments.slice(1));
    case 'items':
      return resolveItemsPath(libraryId, segments.slice(1));
    case 'tags':
      return resolveTagsPath(libraryId, segments.slice(1));
    case 'types':
      return resolveTypesPath(libraryId, segments.slice(1));
    case 'unfiled':
      return resolveUnfiledPath(libraryId, segments.slice(1));
    default:
      return null;
  }
}

/**
 * Get all root-level directory names
 */
export function getRootEntries(): string[] {
  return [...ROOT_ENTRIES];
}

/**
 * Normalize a path: resolve '..' and '.', ensure leading '/'
 */
function normalizePath(path: string): string {
  const parts = path.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return '/' + resolved.join('/');
}

// ============ Collections Path Resolution ============

async function resolveCollectionsPath(libraryId: number, segments: string[]): Promise<ResolvedPath | null> {
  if (segments.length === 0) {
    return { type: 'collections-dir', libraryId };
  }

  const tree = await getCollectionTree(libraryId);

  // Walk the collection tree segment by segment
  let parentKey: string | null = null;
  let currentCollectionKey: string | null = null;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const siblings: CollectionNode[] = tree.byParent.get(parentKey) ?? [];

    // Try to match a collection at this level
    const matchedCollection: CollectionNode | undefined = siblings.find(
      (c: CollectionNode) => c.sanitizedName === segment || c.key === segment
    );

    if (matchedCollection) {
      currentCollectionKey = matchedCollection.key;
      parentKey = matchedCollection.key as string;

      // If this is the last segment, it's a collection directory
      if (i === segments.length - 1) {
        return { type: 'collection', libraryId, collectionKey: currentCollectionKey };
      }
      // Otherwise continue walking
      continue;
    }

    // If we're inside a collection, the segment might be an item key
    if (currentCollectionKey !== null) {
      return resolveItemInContext(libraryId, segment, segments.slice(i + 1), currentCollectionKey);
    }

    return null; // No match
  }

  return null;
}

// ============ Items Path Resolution ============

async function resolveItemsPath(libraryId: number, segments: string[]): Promise<ResolvedPath | null> {
  if (segments.length === 0) {
    return { type: 'items-dir', libraryId };
  }

  const itemKey = segments[0];
  return resolveItemInContext(libraryId, itemKey, segments.slice(1), null);
}

/**
 * Resolve an item and its children. Called from both /items/ and /collections/.../
 * @param collectionKey - if non-null, validate the item belongs to this collection
 */
async function resolveItemInContext(
  libraryId: number,
  itemKey: string,
  remainingSegments: string[],
  _collectionKey: string | null,
): Promise<ResolvedPath | null> {
  // Verify item exists
  const item = await getItemByKey(libraryId, itemKey);
  if (!item) return null;

  if (remainingSegments.length === 0) {
    return { type: 'item', libraryId, itemKey };
  }

  const next = remainingSegments[0];
  const rest = remainingSegments.slice(1);

  // Virtual files
  if (next === 'metadata.json' && rest.length === 0) {
    return { type: 'metadata-file', libraryId, itemKey };
  }
  if (next === 'abstract.txt' && rest.length === 0) {
    return { type: 'abstract-file', libraryId, itemKey };
  }

  // Virtual directories
  if (next === 'notes') {
    return resolveNotesPath(libraryId, itemKey, rest);
  }
  if (next === 'attachments') {
    return resolveAttachmentsPath(libraryId, itemKey, rest);
  }
  if (next === 'annotations') {
    return resolveAnnotationsPath(libraryId, itemKey, rest);
  }

  return null;
}

async function resolveNotesPath(libraryId: number, itemKey: string, segments: string[]): Promise<ResolvedPath | null> {
  if (segments.length === 0) {
    return { type: 'notes-dir', libraryId, itemKey };
  }
  if (segments.length === 1) {
    // Note key with .md extension
    const noteKey = segments[0].replace(/\.md$/, '');
    return { type: 'note-file', libraryId, noteKey };
  }
  return null;
}

async function resolveAttachmentsPath(libraryId: number, itemKey: string, segments: string[]): Promise<ResolvedPath | null> {
  if (segments.length === 0) {
    return { type: 'attachments-dir', libraryId, itemKey };
  }
  if (segments.length === 1) {
    const filename = segments[0];
    // Find attachment by filename
    const attachment = await getAttachmentByFilename(libraryId, itemKey, filename);
    if (!attachment) return null;
    return { type: 'attachment-file', libraryId, attachmentKey: attachment.key, filename };
  }
  return null;
}

async function resolveAnnotationsPath(libraryId: number, itemKey: string, segments: string[]): Promise<ResolvedPath | null> {
  if (segments.length === 0) {
    return { type: 'annotations-dir', libraryId, itemKey };
  }
  if (segments.length === 1) {
    const annotationKey = segments[0].replace(/\.txt$/, '');
    return { type: 'annotation-file', libraryId, annotationKey };
  }
  return null;
}

// ============ Tags Path Resolution ============

async function resolveTagsPath(libraryId: number, segments: string[]): Promise<ResolvedPath | null> {
  if (segments.length === 0) {
    return { type: 'tags-dir', libraryId };
  }
  if (segments.length === 1) {
    return { type: 'tag', libraryId, tag: decodeURIComponent(segments[0]) };
  }
  // tags/<tagName>/<itemKey>/...
  if (segments.length >= 2) {
    const itemKey = segments[1];
    return resolveItemInContext(libraryId, itemKey, segments.slice(2), null);
  }
  return null;
}

// ============ Types Path Resolution ============

async function resolveTypesPath(libraryId: number, segments: string[]): Promise<ResolvedPath | null> {
  if (segments.length === 0) {
    return { type: 'types-dir', libraryId };
  }
  if (segments.length === 1) {
    return { type: 'item-type', libraryId, itemType: segments[0] };
  }
  // types/<typeName>/<itemKey>/...
  if (segments.length >= 2) {
    const itemKey = segments[1];
    return resolveItemInContext(libraryId, itemKey, segments.slice(2), null);
  }
  return null;
}

// ============ Unfiled Path Resolution ============

async function resolveUnfiledPath(libraryId: number, segments: string[]): Promise<ResolvedPath | null> {
  if (segments.length === 0) {
    return { type: 'unfiled-dir', libraryId };
  }
  // unfiled/<itemKey>/...
  const itemKey = segments[0];
  return resolveItemInContext(libraryId, itemKey, segments.slice(1), null);
}

// ============ DB Helpers ============

async function getItemByKey(libraryId: number, key: string): Promise<any | null> {
  const { getDatabase, items } = await import('@zotero-headless/database');
  const { eq, and } = await import('drizzle-orm');
  const db = getDatabase();

  return (db as any)
    .select()
    .from(items)
    .where(and(eq(items.key, key), eq(items.libraryId, libraryId)))
    .get() ?? null;
}

async function getAttachmentByFilename(libraryId: number, parentItemKey: string, filename: string): Promise<any | null> {
  const { getDatabase, attachments } = await import('@zotero-headless/database');
  const { eq, and } = await import('drizzle-orm');
  const db = getDatabase();

  return (db as any)
    .select()
    .from(attachments)
    .where(and(
      eq(attachments.parentItemKey, parentItemKey),
      eq(attachments.libraryId, libraryId),
      eq(attachments.filename, filename),
    ))
    .get() ?? null;
}

/**
 * Get virtual entries (files and dirs) within an item directory.
 */
export function getItemVirtualEntries(): { files: string[]; dirs: string[] } {
  return {
    files: [...ITEM_VIRTUAL_FILES],
    dirs: [...ITEM_VIRTUAL_DIRS],
  };
}

export { sanitizeName };
