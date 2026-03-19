/**
 * 文献管理 API
 * 
 * 提供对 Zotero 文献的增删改查操作
 * 所有函数都是纯函数，不依赖全局状态
 */

import { eq, like, desc, asc, and, isNull, sql, inArray } from 'drizzle-orm';
import type {
  Item,
  Annotation,
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
  const { getDatabase, items, logDeletion } = await getDb();
  const db = getDatabase();

  // Agent API 安全限制：不允许永久删除
  if (options.permanent) {
    console.warn('Warning: permanent delete is not allowed via agent API. Moving to trash instead.');
  }

  // Query raw DB record to get libraryId and rawJson for audit log
  const rawRecord = await db.select()
    .from(items)
    .where(eq(items.key, key))
    .get();

  if (!rawRecord) {
    throw new ItemNotFoundError(key);
  }

  // Log deletion before performing it
  await logDeletion({
    itemKey: key,
    libraryId: rawRecord.libraryId ?? 0,
    title: rawRecord.title,
    itemType: rawRecord.itemType,
    operationType: 'soft',
    caller: 'agent',
    rawJsonSnapshot: rawRecord.rawJson,
  });

  // 始终软删除（移到回收站）
  const now = Math.floor(Date.now() / 1000);
  await db.update(items)
    .set({
      deleted: true,
      deletedAt: now,
      updatedAt: now,
      synced: false,
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
      deletedAt: null,
      updatedAt: Math.floor(Date.now() / 1000),
      synced: false,
    })
    .where(eq(items.key, key))
    .run();
}

/**
 * 获取文献的标注/批注
 * 支持传入文献 key 或 PDF 附件 key
 */
export async function getAnnotations(
  itemKey: string,
  options?: { color?: string; type?: string }
): Promise<Annotation[]> {
  const { getDatabase, items } = await getDb();
  const db = getDatabase();

  // Find the item
  const item = await db.select()
    .from(items)
    .where(eq(items.key, itemKey))
    .get();

  if (!item) {
    throw new ItemNotFoundError(itemKey);
  }

  // Determine attachment keys to search
  let attachmentKeys: string[] = [];
  const rawData = JSON.parse(item.rawJson || '{}');
  const data = rawData.data || rawData;

  if (item.itemType === 'attachment') {
    attachmentKeys = [itemKey];
  } else {
    // Find PDF attachment children
    const children = await db.select()
      .from(items)
      .where(and(
        eq(items.itemType, 'attachment'),
        eq(items.deleted, false),
        like(items.rawJson, `%"parentItem":"${itemKey}"%`)
      ))
      .all();
    attachmentKeys = children.map((c: any) => c.key);
  }

  if (attachmentKeys.length === 0) {
    return [];
  }

  // Find all annotation items for these attachments
  const allAnnotations: any[] = [];
  for (const attKey of attachmentKeys) {
    const annots = await db.select()
      .from(items)
      .where(and(
        eq(items.itemType, 'annotation'),
        eq(items.deleted, false),
        like(items.rawJson, `%"parentItem":"${attKey}"%`)
      ))
      .all();
    allAnnotations.push(...annots);
  }

  // Parse and filter annotations
  let result: Annotation[] = allAnnotations.map((row: any) => {
    const raw = JSON.parse(row.rawJson || '{}');
    const d = raw.data || raw;
    return {
      key: row.key,
      parentAttachmentKey: d.parentItem || '',
      annotationType: d.annotationType || 'highlight',
      annotationText: d.annotationText || undefined,
      annotationComment: d.annotationComment || undefined,
      annotationColor: d.annotationColor || undefined,
      annotationPageLabel: d.annotationPageLabel || undefined,
      annotationSortIndex: d.annotationSortIndex || undefined,
      tags: d.tags || undefined,
    };
  });

  // Apply filters
  if (options?.color) {
    const colorFilter = options.color.toLowerCase();
    result = result.filter(a => a.annotationColor?.toLowerCase().includes(colorFilter));
  }
  if (options?.type) {
    const typeFilter = options.type.toLowerCase();
    result = result.filter(a => a.annotationType.toLowerCase() === typeFilter);
  }

  // Sort by annotationSortIndex (natural page order)
  result.sort((a, b) => (a.annotationSortIndex || '').localeCompare(b.annotationSortIndex || ''));

  return result;
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
