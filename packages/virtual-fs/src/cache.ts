/**
 * Caching utilities for the virtual filesystem
 */

import type { CachedCollectionTree, CollectionNode } from './types.js';

const COLLECTION_TREE_TTL_MS = 60_000; // 60 seconds

let cachedTree: CachedCollectionTree | null = null;

/**
 * Sanitize a name for use as a path segment.
 * Replaces '/' with '-', preserves spaces.
 */
export function sanitizeName(name: string): string {
  return name.replace(/\//g, '-');
}

/**
 * Build and cache the collection tree from database rows.
 * Returns cached version if still fresh.
 */
export async function getCollectionTree(libraryId: number): Promise<CachedCollectionTree> {
  if (cachedTree && Date.now() - cachedTree.timestamp < COLLECTION_TREE_TTL_MS) {
    return cachedTree;
  }

  const { getDatabase, collections } = await import('@zotero-headless/database');
  const { eq, and } = await import('drizzle-orm');
  const db = getDatabase();

  const rows = (db as any)
    .select()
    .from(collections)
    .where(and(eq(collections.libraryId, libraryId), eq(collections.deleted, false)))
    .all() as any[];

  const byKey = new Map<string, CollectionNode>();
  const byParent = new Map<string | null, CollectionNode[]>();
  const nodes: CollectionNode[] = [];

  for (const row of rows) {
    const node: CollectionNode = {
      key: row.key,
      name: row.name,
      parentKey: row.parentKey ?? null,
      libraryId: row.libraryId,
      sanitizedName: sanitizeName(row.name),
    };
    nodes.push(node);
    byKey.set(node.key, node);

    const parentKey = node.parentKey ?? null;
    if (!byParent.has(parentKey)) {
      byParent.set(parentKey, []);
    }
    byParent.get(parentKey)!.push(node);
  }

  // Handle name collisions at the same level by appending key
  for (const [, siblings] of byParent) {
    const nameCounts = new Map<string, number>();
    for (const node of siblings) {
      nameCounts.set(node.sanitizedName, (nameCounts.get(node.sanitizedName) ?? 0) + 1);
    }
    for (const node of siblings) {
      if (nameCounts.get(node.sanitizedName)! > 1) {
        node.sanitizedName = `${node.sanitizedName} [${node.key}]`;
      }
    }
  }

  cachedTree = { collections: nodes, byKey, byParent, timestamp: Date.now() };
  return cachedTree;
}

/**
 * Invalidate the collection tree cache.
 */
export function invalidateCollectionTreeCache(): void {
  cachedTree = null;
}

/**
 * Get the default library ID (first user library found).
 */
export async function getDefaultLibraryId(): Promise<number> {
  const { getDatabase, libraries } = await import('@zotero-headless/database');
  const db = getDatabase();

  const lib = (db as any)
    .select()
    .from(libraries)
    .limit(1)
    .get() as any;

  if (!lib) {
    throw new Error('No library found. Run "zotero sync" first.');
  }

  return lib.id;
}
