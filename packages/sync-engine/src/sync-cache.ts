// Sync Cache Manager
// Stores JSON snapshots of objects at their last-synced version for three-way merge.
// Mirrors official Zotero's syncCache table (syncLocal.js getCacheObject/saveCacheObject).

import { getRawSQLite } from '@zotero-headless/database';

export class SyncCacheManager {
  /**
   * Save a single object snapshot to the cache.
   * The JSON should be the full API response envelope (key, version, data, ...).
   */
  save(objectType: string, libraryId: number, json: { key: string; version: number; [k: string]: unknown }): void {
    if (!json.key || !json.version) return;
    const sqlite = getRawSQLite();
    sqlite.prepare(`
      INSERT OR REPLACE INTO sync_cache (library_id, key, object_type, version, data)
      VALUES (?, ?, ?, ?, ?)
    `).run(libraryId, json.key, objectType, json.version, JSON.stringify(json));
  }

  /**
   * Save multiple object snapshots in a single transaction.
   */
  saveBatch(objectType: string, libraryId: number, jsonArray: Array<{ key: string; version: number; [k: string]: unknown }>): void {
    if (jsonArray.length === 0) return;
    const sqlite = getRawSQLite();
    const stmt = sqlite.prepare(`
      INSERT OR REPLACE INTO sync_cache (library_id, key, object_type, version, data)
      VALUES (?, ?, ?, ?, ?)
    `);
    const runBatch = sqlite.transaction((items: typeof jsonArray) => {
      for (const json of items) {
        if (!json.key || !json.version) continue;
        stmt.run(libraryId, json.key, objectType, json.version, JSON.stringify(json));
      }
    });
    runBatch(jsonArray);
  }

  /**
   * Get the cached snapshot for a specific object at a specific version.
   * Returns the parsed JSON object, or null if not found.
   */
  get(objectType: string, libraryId: number, key: string, version: number): Record<string, unknown> | null {
    const sqlite = getRawSQLite();
    const row = sqlite.prepare(`
      SELECT data FROM sync_cache
      WHERE library_id = ? AND key = ? AND object_type = ? AND version = ?
    `).get(libraryId, key, objectType, version) as { data: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.data);
    } catch {
      return null;
    }
  }

  /**
   * Get the latest cached version for an object (any version).
   * Useful when the exact version is unknown.
   */
  getLatest(objectType: string, libraryId: number, key: string): Record<string, unknown> | null {
    const sqlite = getRawSQLite();
    const row = sqlite.prepare(`
      SELECT data FROM sync_cache
      WHERE library_id = ? AND key = ? AND object_type = ?
      ORDER BY version DESC LIMIT 1
    `).get(libraryId, key, objectType) as { data: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.data);
    } catch {
      return null;
    }
  }

  /**
   * Delete all but the latest version for each object in a library.
   * Call periodically to prevent unbounded cache growth.
   */
  purgeOldVersions(objectType: string, libraryId: number): number {
    const sqlite = getRawSQLite();
    const result = sqlite.prepare(`
      DELETE FROM sync_cache
      WHERE library_id = ? AND object_type = ? AND rowid NOT IN (
        SELECT rowid FROM sync_cache sc2
        WHERE sc2.library_id = sync_cache.library_id
          AND sc2.key = sync_cache.key
          AND sc2.object_type = sync_cache.object_type
        ORDER BY sc2.version DESC LIMIT 1
      )
    `).run(libraryId, objectType);
    return result.changes;
  }

  /**
   * Clear all cached data for a library (used during full sync / reset).
   */
  clearForLibrary(libraryId: number): void {
    const sqlite = getRawSQLite();
    sqlite.prepare('DELETE FROM sync_cache WHERE library_id = ?').run(libraryId);
  }

  /**
   * Clear all cached data (for testing or complete reset).
   */
  clearAll(): void {
    const sqlite = getRawSQLite();
    sqlite.prepare('DELETE FROM sync_cache').run();
  }
}
