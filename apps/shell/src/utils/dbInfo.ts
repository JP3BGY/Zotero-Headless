import { appConfig } from '@zotero-headless/core';
import { getRawSQLite } from '@zotero-headless/database';

export interface DbInfo {
  userId: string;
  itemCount: number;
  libraryCount: number;
  dbConnected: boolean;
  lastSyncDate: Date | null;
  cwd: string;
}

export function loadDbInfo(): DbInfo {
  const info: DbInfo = {
    userId: appConfig.zotero.userId || '?',
    itemCount: 0,
    libraryCount: 0,
    dbConnected: false,
    lastSyncDate: null,
    cwd: process.cwd(),
  };

  try {
    const db = getRawSQLite({ quiet: true });
    if (!db) return info;
    info.dbConnected = true;

    const libRow = db.prepare('SELECT COUNT(*) as cnt FROM libraries').get() as any;
    info.libraryCount = libRow?.cnt ?? 0;

    const itemRow = db.prepare('SELECT COUNT(*) as cnt FROM items WHERE deleted = 0').get() as any;
    info.itemCount = itemRow?.cnt ?? 0;

    const syncRow = db.prepare(
      "SELECT completed_at FROM sync_logs WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1"
    ).get() as any;
    if (syncRow?.completed_at) {
      info.lastSyncDate = new Date(syncRow.completed_at * 1000);
    }
  } catch {
    // DB not ready yet
  }

  return info;
}
