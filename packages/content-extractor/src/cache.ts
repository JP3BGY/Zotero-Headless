import { getDatabase, getRawSQLite, contentCache, attachments } from '@zotero-headless/database';
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
 * Also updates the FTS5 index if available.
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

  // Update FTS5 index (best-effort)
  try {
    const sqlite = getRawSQLite({ quiet: true });

    // Look up parent item key
    const att = (db as any)
      .select({ parentItemKey: attachments.parentItemKey })
      .from(attachments)
      .where(and(
        eq(attachments.key, entry.attachmentKey),
        eq(attachments.libraryId, entry.libraryId),
      ))
      .get();

    const parentItemKey = att?.parentItemKey ?? '';

    // Delete old FTS entry and insert new one
    sqlite.prepare(
      `DELETE FROM content_fts WHERE attachment_key = ? AND library_id = ?`
    ).run(entry.attachmentKey, entry.libraryId);
    sqlite.prepare(
      `INSERT INTO content_fts (content, attachment_key, library_id, parent_item_key) VALUES (?, ?, ?, ?)`
    ).run(entry.content, entry.attachmentKey, entry.libraryId, parentItemKey);
  } catch {
    // FTS5 table may not exist yet — silently ignore
  }
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
