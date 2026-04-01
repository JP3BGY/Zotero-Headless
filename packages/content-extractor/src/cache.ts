import { getDatabase, contentCache } from '@zotero-headless/database';
import { eq, and } from 'drizzle-orm';

export interface CacheEntry {
  attachmentKey: string;
  libraryId: number;
  fileMd5: string;
  content: string;
  format: string;
  extractedAt: number;
}

/**
 * Get cached content if the file md5 still matches.
 * Returns null on cache miss or md5 mismatch.
 */
export function getCachedContent(
  attachmentKey: string,
  libraryId: number,
  currentMd5: string,
): CacheEntry | null {
  const db = getDatabase();
  const row = (db as any)
    .select()
    .from(contentCache)
    .where(and(
      eq(contentCache.attachmentKey, attachmentKey),
      eq(contentCache.libraryId, libraryId),
    ))
    .get();

  if (!row) return null;
  if (row.fileMd5 !== currentMd5) return null;

  return {
    attachmentKey: row.attachmentKey,
    libraryId: row.libraryId,
    fileMd5: row.fileMd5,
    content: row.content,
    format: row.format,
    extractedAt: row.extractedAt,
  };
}

/**
 * Upsert extracted content into the cache.
 */
export function setCachedContent(entry: CacheEntry): void {
  const db = getDatabase();

  // Delete existing entry first (upsert pattern)
  (db as any)
    .delete(contentCache)
    .where(and(
      eq(contentCache.attachmentKey, entry.attachmentKey),
      eq(contentCache.libraryId, entry.libraryId),
    ))
    .run();

  (db as any)
    .insert(contentCache)
    .values({
      attachmentKey: entry.attachmentKey,
      libraryId: entry.libraryId,
      fileMd5: entry.fileMd5,
      content: entry.content,
      format: entry.format,
      extractedAt: entry.extractedAt,
    })
    .run();
}

/**
 * Clear cache entries. If attachmentKey is provided, clears only that entry.
 * Otherwise clears all entries.
 */
export function clearCache(attachmentKey?: string, libraryId?: number): void {
  const db = getDatabase();

  if (attachmentKey && libraryId !== undefined) {
    (db as any)
      .delete(contentCache)
      .where(and(
        eq(contentCache.attachmentKey, attachmentKey),
        eq(contentCache.libraryId, libraryId),
      ))
      .run();
  } else {
    (db as any).delete(contentCache).run();
  }
}
