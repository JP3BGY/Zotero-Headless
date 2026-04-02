/**
 * Batch Operations API
 *
 * 提供批量创建、更新、标签、分类等操作
 * 支持并发控制和进度回调
 */

import { eq, and } from 'drizzle-orm';
import type {
  BatchOptions,
  BatchResult,
  CreateItemInput,
  UpdateItemInput,
  Tag,
} from './types.js';
import { ZoteroError, BatchLimitError, ItemNotFoundError } from './errors.js';
import { createItem, updateItem, getItem } from './items.js';
import { parseItemData, updateItemData, extractDenormalizedColumns } from '@zotero-headless/types';

// ============ 安全限制 ============

export const BATCH_CREATE_LIMIT = 50;
export const BATCH_UPDATE_LIMIT = 50;
export const BATCH_TAG_LIMIT = 100;
export const BATCH_COLLECTION_LIMIT = 100;

// ============ 延迟加载 ============

let dbModule: any;
async function getDb() {
  if (!dbModule) {
    dbModule = await import('@zotero-headless/database');
  }
  return dbModule;
}

// ============ 并发控制 ============

async function runWithConcurrency<T>(
  items: T[],
  fn: (item: T, index: number) => Promise<void>,
  concurrency: number,
): Promise<void> {
  const clampedConcurrency = Math.min(Math.max(concurrency, 1), 5);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      await fn(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from(
    { length: Math.min(clampedConcurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
}

// ============ 通用批量执行器 ============

interface BatchEntry {
  key: string;
}

async function executeBatch<T extends BatchEntry>(
  entries: T[],
  limit: number,
  entityType: string,
  fn: (entry: T) => Promise<string>,
  options: BatchOptions = {},
): Promise<BatchResult> {
  if (entries.length > limit) {
    throw new BatchLimitError(entries.length, limit, entityType);
  }

  const succeeded: string[] = [];
  const failed: BatchResult['failed'] = [];
  const concurrency = options.concurrency ?? 1;

  const processEntry = async (entry: T, i: number) => {
    try {
      const key = await fn(entry);
      succeeded.push(key);
    } catch (error) {
      const failEntry: BatchResult['failed'][number] = {
        key: entry.key,
        error: error instanceof Error ? error.message : String(error),
      };
      if (error instanceof ZoteroError) {
        failEntry.code = error.code;
        failEntry.recoverable = error.recoverable;
        failEntry.suggestion = error.suggestion;
      }
      failed.push(failEntry);

      if (!options.continueOnError) {
        throw error; // break out of runWithConcurrency
      }
    }

    if (options.onProgress) {
      const current = succeeded.length + failed.length;
      options.onProgress({
        current,
        total: entries.length,
        currentItem: entry.key,
        succeeded: succeeded.length,
        failed: failed.length,
        percentage: Math.round((current / entries.length) * 100),
      });
    }
  };

  if (concurrency <= 1) {
    // Sequential execution with early break support
    for (let i = 0; i < entries.length; i++) {
      try {
        await processEntry(entries[i], i);
      } catch {
        if (!options.continueOnError) break;
      }
    }
  } else {
    try {
      await runWithConcurrency(entries, processEntry, concurrency);
    } catch {
      // Early break from continueOnError=false
    }
  }

  return { succeeded, failed, total: entries.length };
}

// ============ 批量操作 ============

/**
 * 批量创建文献
 */
export async function batchCreate(
  inputs: CreateItemInput[],
  options?: BatchOptions,
): Promise<BatchResult> {
  const entries = inputs.map((input, i) => ({
    key: `__pending_${i}`,
    input,
  }));

  if (entries.length > BATCH_CREATE_LIMIT) {
    throw new BatchLimitError(entries.length, BATCH_CREATE_LIMIT);
  }

  const succeeded: string[] = [];
  const failed: BatchResult['failed'] = [];
  const concurrency = options?.concurrency ?? 1;

  const processEntry = async (entry: typeof entries[number], _i: number) => {
    try {
      const result = await createItem(entry.input);
      entry.key = result.key; // Update key for progress reporting
      succeeded.push(result.key);
    } catch (error) {
      const failEntry: BatchResult['failed'][number] = {
        key: entry.input.title ?? entry.input.itemType,
        error: error instanceof Error ? error.message : String(error),
      };
      if (error instanceof ZoteroError) {
        failEntry.code = error.code;
        failEntry.recoverable = error.recoverable;
        failEntry.suggestion = error.suggestion;
      }
      failed.push(failEntry);

      if (!options?.continueOnError) {
        throw error;
      }
    }

    if (options?.onProgress) {
      const current = succeeded.length + failed.length;
      options.onProgress({
        current,
        total: entries.length,
        currentItem: entry.key,
        succeeded: succeeded.length,
        failed: failed.length,
        percentage: Math.round((current / entries.length) * 100),
      });
    }
  };

  if (concurrency <= 1) {
    for (let i = 0; i < entries.length; i++) {
      try {
        await processEntry(entries[i], i);
      } catch {
        if (!options?.continueOnError) break;
      }
    }
  } else {
    try {
      await runWithConcurrency(entries, processEntry, concurrency);
    } catch {
      // Early break
    }
  }

  return { succeeded, failed, total: entries.length };
}

/**
 * 批量更新文献
 */
export async function batchUpdate(
  updates: Array<{ key: string; data: UpdateItemInput }>,
  options?: BatchOptions,
): Promise<BatchResult> {
  return executeBatch(
    updates,
    BATCH_UPDATE_LIMIT,
    'items',
    async (entry) => {
      await updateItem(entry.key, entry.data);
      return entry.key;
    },
    options,
  );
}

/**
 * 批量添加标签
 */
export async function batchTag(
  keys: string[],
  tags: Tag[],
  options?: BatchOptions,
): Promise<BatchResult> {
  const entries = keys.map(key => ({ key }));
  return executeBatch(
    entries,
    BATCH_TAG_LIMIT,
    'items',
    async (entry) => {
      const { getDatabase, items, libraries } = await getDb();
      const db = getDatabase();
      const library = await db.select().from(libraries).get();

      const item = await db.select()
        .from(items)
        .where(and(eq(items.key, entry.key), eq(items.libraryId, library.id)))
        .get();

      if (!item) {
        throw new ItemNotFoundError(entry.key);
      }

      const raw = parseItemData(item.rawJson);
      const itemTags: any[] = raw.tags || [];
      const existingTags = new Set(
        itemTags.map((t: any) =>
          (typeof t === 'string' ? t : t.tag || '').toLowerCase()
        ),
      );

      let addedCount = 0;
      for (const tag of tags) {
        if (!existingTags.has(tag.tag.toLowerCase())) {
          itemTags.push({ tag: tag.tag, type: tag.type ?? 0 });
          addedCount++;
        }
      }

      if (addedCount > 0) {
        const updatedRawJson = updateItemData(item.rawJson, (data: Record<string, unknown>) => {
          data.tags = itemTags;
        });
        await db.update(items)
          .set({
            rawJson: updatedRawJson,
            tags: JSON.stringify(itemTags),
            synced: false,
          })
          .where(eq(items.key, entry.key))
          .run();
      }

      return entry.key;
    },
    options,
  );
}

/**
 * 批量移除标签
 */
export async function batchUntag(
  keys: string[],
  tagNames: string[],
  options?: BatchOptions,
): Promise<BatchResult> {
  const tagsToRemove = new Set(tagNames.map(t => t.toLowerCase()));
  const entries = keys.map(key => ({ key }));

  return executeBatch(
    entries,
    BATCH_TAG_LIMIT,
    'items',
    async (entry) => {
      const { getDatabase, items, libraries } = await getDb();
      const db = getDatabase();
      const library = await db.select().from(libraries).get();

      const item = await db.select()
        .from(items)
        .where(and(eq(items.key, entry.key), eq(items.libraryId, library.id)))
        .get();

      if (!item) {
        throw new ItemNotFoundError(entry.key);
      }

      const raw = parseItemData(item.rawJson);
      const filteredTags = (raw.tags || []).filter((t: any) => {
        const tagName = (typeof t === 'string' ? t : t.tag || '').toLowerCase();
        return !tagsToRemove.has(tagName);
      });

      const updatedRawJson = updateItemData(item.rawJson, (data: Record<string, unknown>) => {
        data.tags = filteredTags;
      });
      await db.update(items)
        .set({
          rawJson: updatedRawJson,
          tags: JSON.stringify(filteredTags),
          synced: false,
        })
        .where(eq(items.key, entry.key))
        .run();

      return entry.key;
    },
    options,
  );
}

/**
 * 批量添加到集合
 */
export async function batchAddToCollection(
  keys: string[],
  collectionKey: string,
  options?: BatchOptions,
): Promise<BatchResult> {
  const entries = keys.map(key => ({ key }));
  return executeBatch(
    entries,
    BATCH_COLLECTION_LIMIT,
    'items',
    async (entry) => {
      const { getDatabase, items, libraries } = await getDb();
      const db = getDatabase();
      const library = await db.select().from(libraries).get();

      const item = await db.select()
        .from(items)
        .where(and(eq(items.key, entry.key), eq(items.libraryId, library.id)))
        .get();

      if (!item) {
        throw new ItemNotFoundError(entry.key);
      }

      const raw = parseItemData(item.rawJson);
      const colKeys: string[] = raw.collections || [];

      if (!colKeys.includes(collectionKey)) {
        colKeys.push(collectionKey);
        const updatedRawJson = updateItemData(item.rawJson, (data: Record<string, unknown>) => {
          data.collections = colKeys;
        });
        await db.update(items)
          .set({
            rawJson: updatedRawJson,
            collectionKeys: JSON.stringify(colKeys),
            synced: false,
          })
          .where(eq(items.key, entry.key))
          .run();
      }

      return entry.key;
    },
    options,
  );
}

/**
 * 批量从集合移除
 */
export async function batchRemoveFromCollection(
  keys: string[],
  collectionKey: string,
  options?: BatchOptions,
): Promise<BatchResult> {
  const entries = keys.map(key => ({ key }));
  return executeBatch(
    entries,
    BATCH_COLLECTION_LIMIT,
    'items',
    async (entry) => {
      const { getDatabase, items, libraries } = await getDb();
      const db = getDatabase();
      const library = await db.select().from(libraries).get();

      const item = await db.select()
        .from(items)
        .where(and(eq(items.key, entry.key), eq(items.libraryId, library.id)))
        .get();

      if (!item) {
        throw new ItemNotFoundError(entry.key);
      }

      const raw = parseItemData(item.rawJson);
      const colKeys: string[] = (raw.collections || []).filter(
        (k: string) => k !== collectionKey,
      );

      const updatedRawJson = updateItemData(item.rawJson, (data: Record<string, unknown>) => {
        data.collections = colKeys;
      });
      await db.update(items)
        .set({
          rawJson: updatedRawJson,
          collectionKeys: JSON.stringify(colKeys),
          synced: false,
        })
        .where(eq(items.key, entry.key))
        .run();

      return entry.key;
    },
    options,
  );
}
