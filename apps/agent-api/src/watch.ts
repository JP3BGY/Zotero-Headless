/**
 * Watch API — 基于轮询的变更监听
 *
 * 通过定期查询 updatedAt 字段检测 items 表变更，
 * 适合 Agent 持续监控文献库变化。
 */

import { sql, and, eq, isNull } from 'drizzle-orm';
import type { Item, ChangeEvent } from './types.js';

// ============ 类型定义 ============

export interface WatchOptions {
  /** Polling interval in milliseconds. Default 5000 (5s). Min 1000. */
  intervalMs?: number;
  /** Item types to watch. If omitted, watches all types. */
  itemTypes?: string[];
  /** Include trash events. Default false. */
  includeTrashed?: boolean;
}

export type ChangeCallback = (events: ChangeEvent[]) => void;

export interface WatchHandle {
  /** Stop watching */
  stop(): void;
  /** Whether the watcher is currently active */
  readonly active: boolean;
}

// ============ 延迟加载 ============

let dbModule: any;
async function getDb() {
  if (!dbModule) {
    dbModule = await import('@zotero-headless/database');
  }
  return dbModule;
}

// ============ 实现 ============

/**
 * 监听文献库变更
 *
 * 基于轮询 updatedAt 字段实现。每次 tick 查询自上次轮询以来
 * 发生变更的 items，并分类为 create/update/delete 事件。
 */
export function watchChanges(
  callback: ChangeCallback,
  options?: WatchOptions,
): WatchHandle {
  const intervalMs = Math.max(options?.intervalMs ?? 5000, 1000);
  let lastPollTime = Math.floor(Date.now() / 1000);
  let timer: ReturnType<typeof setInterval> | null = null;
  let isActive = true;

  const poll = async () => {
    try {
      const { getDatabase, items } = await getDb();
      const db = getDatabase();

      // Build conditions
      const conditions: any[] = [
        sql`${items.updatedAt} > ${lastPollTime}`,
      ];

      if (options?.itemTypes?.length) {
        const types = options.itemTypes;
        conditions.push(
          sql`${items.itemType} IN (${sql.join(types.map(t => sql`${t}`), sql`, `)})`
        );
      }

      if (!options?.includeTrashed) {
        // Include recently trashed items so we can detect delete events,
        // but exclude items that were already trashed before our last poll
        // We need items where updatedAt > lastPollTime regardless of deleted status
      }

      const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

      const rows = db.select()
        .from(items)
        .where(whereClause)
        .all();

      if (rows.length > 0) {
        const events: ChangeEvent[] = rows.map((row: any) => {
          let type: ChangeEvent['type'];

          if (row.deleted) {
            type = 'delete';
          } else if (row.version === 0 && row.createdAt === row.updatedAt) {
            type = 'create';
          } else {
            type = 'update';
          }

          const item: Item = {
            key: row.key,
            version: row.version,
            itemType: row.itemType,
            title: row.title ?? undefined,
            deleted: row.deleted === 1 || row.deleted === true,
          };

          return {
            type,
            itemKey: row.key,
            item,
            timestamp: new Date(row.updatedAt * 1000),
          };
        });

        callback(events);
      }

      lastPollTime = Math.floor(Date.now() / 1000);
    } catch {
      // Silently ignore polling errors to keep the watcher alive
    }
  };

  // Start polling
  timer = setInterval(poll, intervalMs);

  return {
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      isActive = false;
    },
    get active() {
      return isActive;
    },
  };
}
