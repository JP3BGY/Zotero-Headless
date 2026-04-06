// Sync Queue Manager
// Tracks failed sync objects for retry with exponential backoff.
// Mirrors official Zotero's syncQueue table (syncLocal.js addObjectsToSyncQueue/getObjectsToTryFromSyncQueue).

import { getRawSQLite } from '@zotero-headless/database';

// Retry intervals in hours, matching official Zotero (syncLocal.js:31)
const RETRY_INTERVALS_HOURS = [0.5, 1, 4, 16, 16, 16, 16, 16, 16, 16, 64];

export class SyncQueueManager {
  /**
   * Add objects to the retry queue.
   * If `immediate` is true, sets lastCheck=0 so they'll be retried immediately.
   * Otherwise, sets lastCheck=now and increments tries.
   */
  enqueue(objectType: string, libraryId: number, keys: string[], immediate: boolean = false): void {
    if (keys.length === 0) return;
    const sqlite = getRawSQLite();
    const now = Math.floor(Date.now() / 1000);

    const upsert = sqlite.prepare(`
      INSERT INTO sync_queue (library_id, key, object_type, last_check, tries)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT (library_id, key, object_type)
      DO UPDATE SET last_check = ?, tries = tries + 1
    `);

    const runBatch = sqlite.transaction((keyList: string[]) => {
      for (const key of keyList) {
        const checkTime = immediate ? 0 : now;
        upsert.run(libraryId, key, objectType, checkTime, checkTime);
      }
    });
    runBatch(keys);
  }

  /**
   * Get all queued object keys for a library (regardless of retry timing).
   * Used for first-in-session sync or manual sync.
   */
  getAll(objectType: string, libraryId: number): string[] {
    const sqlite = getRawSQLite();
    const rows = sqlite.prepare(`
      SELECT key FROM sync_queue
      WHERE library_id = ? AND object_type = ?
    `).all(libraryId, objectType) as Array<{ key: string }>;
    return rows.map(r => r.key);
  }

  /**
   * Get object keys that are due for retry based on backoff intervals.
   * An object is due if: lastCheck + interval[tries] * 3600 <= now
   */
  getDueForRetry(objectType: string, libraryId: number): string[] {
    const sqlite = getRawSQLite();
    const now = Math.floor(Date.now() / 1000);
    const rows = sqlite.prepare(`
      SELECT key, last_check, tries FROM sync_queue
      WHERE library_id = ? AND object_type = ?
    `).all(libraryId, objectType) as Array<{ key: string; last_check: number; tries: number }>;

    return rows.filter(row => {
      const intervalIndex = Math.min(row.tries - 1, RETRY_INTERVALS_HOURS.length - 1);
      const intervalHours = intervalIndex >= 0 ? RETRY_INTERVALS_HOURS[intervalIndex] : 0;
      const nextCheck = row.last_check + intervalHours * 3600;
      return nextCheck <= now;
    }).map(r => r.key);
  }

  /**
   * Remove objects from the queue after successful processing.
   */
  dequeue(objectType: string, libraryId: number, keys: string[]): void {
    if (keys.length === 0) return;
    const sqlite = getRawSQLite();
    const stmt = sqlite.prepare(`
      DELETE FROM sync_queue
      WHERE library_id = ? AND key = ? AND object_type = ?
    `);
    const runBatch = sqlite.transaction((keyList: string[]) => {
      for (const key of keyList) {
        stmt.run(libraryId, key, objectType);
      }
    });
    runBatch(keys);
  }

  /**
   * Check if any objects are queued for a library.
   */
  hasQueued(libraryId: number): boolean {
    const sqlite = getRawSQLite();
    const row = sqlite.prepare(`
      SELECT 1 FROM sync_queue WHERE library_id = ? LIMIT 1
    `).get(libraryId);
    return !!row;
  }

  /**
   * Clear entire queue for a library (used during reset).
   */
  clearForLibrary(libraryId: number): void {
    const sqlite = getRawSQLite();
    sqlite.prepare('DELETE FROM sync_queue WHERE library_id = ?').run(libraryId);
  }

  /**
   * Clear all queued data (for testing or complete reset).
   */
  clearAll(): void {
    const sqlite = getRawSQLite();
    sqlite.prepare('DELETE FROM sync_queue').run();
  }
}
