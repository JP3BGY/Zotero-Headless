/**
 * 文献管理 API
 * 
 * 提供对 Zotero 文献的增删改查操作
 * 所有函数都是纯函数，不依赖全局状态
 */

import { eq, like, desc, asc, and, isNull, sql, inArray } from 'drizzle-orm';
import type { 
  Item, 
  ListOptions, 
  ListResult, 
  SearchOptions, 
  SearchResult,
  DeleteOptions,
  BatchOptions,
  BatchResult 
} from './types.js';
import { ItemNotFoundError, ValidationError, BATCH_DELETE_LIMIT } from './types.js';

// 延迟加载数据库模块
let dbModule: any;
async function getDb() {
  if (!dbModule) {
    dbModule = await import('@zotero-headless/database');
  }
  return dbModule;
}

/**
 * 列出文献
 */
export async function listItems(options: ListOptions = {}): Promise<ListResult> {
  const { getDatabase, items } = await getDb();
  const db = getDatabase();
  
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  
  // 构建查询条件
  const conditions = [];
  
  if (!options.includeTrashed) {
    conditions.push(isNull(items.deleted));
  }
  
  if (options.itemType) {
    conditions.push(eq(items.itemType, options.itemType));
  }
  
  if (options.collection) {
    conditions.push(sql`${items.collections} LIKE ${`%${options.collection}%`}`);
  }
  
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  
  // 获取总数
  const countResult = await db.select({ count: sql<number>`COUNT(*)` })
    .from(items)
    .where(whereClause)
    .get();
  const total = countResult?.count ?? 0;
  
  // 构建排序
  let orderBy;
  switch (options.sortBy) {
    case 'date':
      orderBy = options.sortDirection === 'desc' ? desc(items.date) : asc(items.date);
      break;
    case 'dateAdded':
      orderBy = options.sortDirection === 'desc' ? desc(items.dateAdded) : asc(items.dateAdded);
      break;
    case 'dateModified':
      orderBy = options.sortDirection === 'desc' ? desc(items.dateModified) : asc(items.dateModified);
      break;
    default:
      orderBy = options.sortDirection === 'desc' ? desc(items.title) : asc(items.title);
  }
  
  // 获取数据
  const results = await db.select()
    .from(items)
    .where(whereClause)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset)
    .all();
  
  return {
    items: results.map(normalizeItem),
    total,
    hasMore: offset + results.length < total
  };
}

/**
 * 搜索文献
 */
export async function searchItems(
  query: string, 
  options: SearchOptions = {}
): Promise<SearchResult> {
  const { getDatabase, items } = await getDb();
  const db = getDatabase();
  
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;
  
  // 构建搜索条件
  const searchPattern = `%${query}%`;
  const searchCondition = or(
    like(items.title, searchPattern),
    like(items.abstractNote, searchPattern),
    like(items.extra, searchPattern)
  );
  
  // 其他条件
  const conditions = [searchCondition];
  
  if (options.itemType) {
    conditions.push(eq(items.itemType, options.itemType));
  }
  
  if (options.tags?.length) {
    // 标签搜索（简化实现）
    conditions.push(sql`${items.tags} LIKE ${`%${options.tags[0]}%`}`);
  }
  
  const whereClause = and(...conditions);
  
  // 获取总数
  const countResult = await db.select({ count: sql<number>`COUNT(*)` })
    .from(items)
    .where(whereClause)
    .get();
  const total = countResult?.count ?? 0;
  
  // 排序
  let orderBy;
  switch (options.sortBy) {
    case 'date':
      orderBy = options.sortDirection === 'desc' ? desc(items.date) : asc(items.date);
      break;
    default:
      orderBy = desc(items.dateAdded);
  }
  
  // 获取结果
  const results = await db.select()
    .from(items)
    .where(whereClause)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset)
    .all();
  
  return {
    items: results.map(normalizeItem),
    total,
    query,
    options,
    hasMore: offset + results.length < total
  };
}

/**
 * 获取单个文献
 */
export async function getItem(key: string): Promise<Item | null> {
  const { getDatabase, items } = await getDb();
  const db = getDatabase();
  
  const result = await db.select()
    .from(items)
    .where(eq(items.key, key))
    .get();
  
  return result ? normalizeItem(result) : null;
}

/**
 * 获取单个文献（不存在则抛出错误）
 */
export async function getItemOrThrow(key: string): Promise<Item> {
  const item = await getItem(key);
  if (!item) {
    throw new ItemNotFoundError(key);
  }
  return item;
}

/**
 * 删除文献
 */
export async function deleteItem(
  key: string,
  options: DeleteOptions = {}
): Promise<void> {
  const { getDatabase, items } = await getDb();
  const db = getDatabase();

  // Agent API 安全限制：不允许永久删除
  if (options.permanent) {
    console.warn('Warning: permanent delete is not allowed via agent API. Moving to trash instead.');
  }

  // 检查项目是否存在
  const existing = await getItem(key);
  if (!existing) {
    throw new ItemNotFoundError(key);
  }

  // 始终软删除（移到回收站）
  await db.update(items)
    .set({
      deleted: true,
      dateModified: Math.floor(Date.now() / 1000)
    })
    .where(eq(items.key, key))
    .run();
}

/**
 * 批量删除
 */
export async function batchDelete(
  keys: string[],
  options: DeleteOptions & BatchOptions = {}
): Promise<BatchResult> {
  // Agent API 安全限制：批量删除数量上限
  if (keys.length > BATCH_DELETE_LIMIT) {
    throw new ValidationError(
      `Batch delete limit exceeded: ${keys.length} items requested, maximum is ${BATCH_DELETE_LIMIT}. Delete in smaller batches.`,
      'keys'
    );
  }

  const succeeded: string[] = [];
  const failed: Array<{ key: string; error: string }> = [];
  
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    
    try {
      await deleteItem(key, options);
      succeeded.push(key);
      
      if (options.onProgress) {
        options.onProgress({
          current: i + 1,
          total: keys.length,
          currentItem: key,
          succeeded: succeeded.length,
          failed: failed.length
        });
      }
    } catch (error) {
      failed.push({ 
        key, 
        error: error instanceof Error ? error.message : String(error) 
      });
      
      if (!options.continueOnError) {
        break;
      }
    }
  }
  
  return { succeeded, failed, total: keys.length };
}

/**
 * 从回收站恢复
 */
export async function restoreItem(key: string): Promise<void> {
  const { getDatabase, items } = await getDb();
  const db = getDatabase();
  
  const existing = await getItem(key);
  if (!existing) {
    throw new ItemNotFoundError(key);
  }
  
  if (!existing.deleted) {
    throw new ValidationError('Item is not in trash', 'deleted');
  }
  
  await db.update(items)
    .set({ 
      deleted: false,
      dateModified: Math.floor(Date.now() / 1000)
    })
    .where(eq(items.key, key))
    .run();
}

// ============ 辅助函数 ============

function normalizeItem(raw: any): Item {
  return {
    key: raw.key,
    version: raw.version,
    itemType: raw.itemType,
    title: raw.title ?? undefined,
    creators: parseJson(raw.creators),
    abstractNote: raw.abstractNote ?? undefined,
    date: raw.date ?? undefined,
    url: raw.url ?? undefined,
    DOI: raw.DOI ?? undefined,
    accessDate: raw.accessDate ?? undefined,
    libraryCatalog: raw.libraryCatalog ?? undefined,
    callNumber: raw.callNumber ?? undefined,
    rights: raw.rights ?? undefined,
    extra: raw.extra ?? undefined,
    tags: parseJson(raw.tags),
    collections: parseJson(raw.collections),
    relations: parseJson(raw.relations),
    parentItem: raw.parentItem ?? undefined,
    note: raw.note ?? undefined,
    deleted: raw.deleted === 1 || raw.deleted === true,
  };
}

function parseJson(value: any): any {
  if (!value) return undefined;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

// 简化版的 or 函数（drizzle 的 or 可能不可用）
function or(...conditions: any[]) {
  return sql`(${conditions.join(' OR ')})`;
}
