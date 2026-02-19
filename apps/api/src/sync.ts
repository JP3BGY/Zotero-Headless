/**
 * 同步 API
 * 
 * 提供与 Zotero 服务器的同步功能
 */

import type {
  SyncOptions,
  SyncResult,
  SyncStatus,
  Conflict,
  ConflictStrategy,
  SyncProgress
} from './types.js';
import { SyncError, ZoteroError } from './types.js';

// 延迟加载模块
let syncModule: any;
let dbModule: any;
let apiModule: any;

async function initModules() {
  if (!syncModule) {
    syncModule = await import('@zotero-headless/sync-engine');
  }
  if (!dbModule) {
    dbModule = await import('@zotero-headless/database');
  }
  if (!apiModule) {
    apiModule = await import('@zotero-headless/api');
  }
}

/**
 * 获取同步状态
 */
export async function getSyncStatus(): Promise<SyncStatus> {
  await initModules();
  const { getDatabase, items } = dbModule;
  const db = getDatabase();
  
  // 本地项目数
  const localCount = await db.select({ count: sql<number>`COUNT(*)` })
    .from(items)
    .where(isNull(items.deleted))
    .get();
  
  // 待上传数（version 为 0 或标记为修改）
  const pendingCount = await db.select({ count: sql<number>`COUNT(*)` })
    .from(items)
    .where(sql`${items.version} = 0 OR ${items.synced} = 0`)
    .get();
  
  // 冲突数（简化实现，实际需要专门的冲突表）
  const conflictCount = 0; // TODO: 从冲突表查询
  
  return {
    lastSync: null, // TODO: 从配置读取
    localItemCount: localCount?.count ?? 0,
    remoteItemCount: null,
    pendingUploads: pendingCount?.count ?? 0,
    conflicts: conflictCount,
    isSyncing: false
  };
}

/**
 * 执行同步
 */
export async function sync(options: SyncOptions = {}): Promise<SyncResult> {
  await initModules();
  const { syncManager } = syncModule;
  
  const result: SyncResult = {
    success: false,
    downloaded: 0,
    uploaded: 0,
    deleted: 0,
    conflicts: [],
    errors: []
  };
  
  try {
    // 报告进度
    if (options.onProgress) {
      options.onProgress({
        phase: 'download',
        current: 0,
        total: 100,
        message: 'Starting sync...'
      });
    }
    
    // 执行同步
    // 注意：当前的 syncManager 可能需要重构以支持程序化调用
    // 这里提供 API 接口定义，实际实现需要适配
    const syncResult = await syncManager.sync({
      dryRun: options.dryRun,
      // conflictStrategy 需要添加到 syncManager
    });
    
    result.success = true;
    result.downloaded = syncResult.downloaded || 0;
    result.uploaded = syncResult.uploaded || 0;
    result.deleted = syncResult.deleted || 0;
    result.dryRun = options.dryRun;
    
    // 处理冲突
    if (syncResult.conflicts) {
      result.conflicts = syncResult.conflicts;
      
      // 根据策略自动解决冲突
      if (options.conflictStrategy && options.conflictStrategy !== 'ask') {
        for (const conflict of result.conflicts) {
          try {
            await resolveConflict(conflict, options.conflictStrategy);
          } catch (e) {
            result.errors.push({
              itemKey: conflict.itemKey,
              operation: 'upload',
              error: `Failed to resolve conflict: ${e}`,
              recoverable: true
            });
          }
        }
      }
    }
    
    if (options.onProgress) {
      options.onProgress({
        phase: 'complete',
        current: 100,
        total: 100,
        message: 'Sync complete'
      });
    }
    
  } catch (error) {
    result.success = false;
    result.errors.push({
      itemKey: '',
      operation: 'download',
      error: error instanceof Error ? error.message : String(error),
      recoverable: false
    });
    
    throw new SyncError(
      `Sync failed: ${error instanceof Error ? error.message : String(error)}`,
      'sync'
    );
  }
  
  return result;
}

/**
 * 获取冲突列表
 */
export async function getConflicts(): Promise<Conflict[]> {
  await initModules();
  // TODO: 从冲突表或同步结果中读取
  return [];
}

/**
 * 解决单个冲突
 */
export async function resolveConflict(
  conflict: Conflict,
  strategy: ConflictStrategy
): Promise<void> {
  await initModules();
  const { getDatabase, items } = dbModule;
  const db = getDatabase();
  
  if (strategy === 'ask') {
    throw new ZoteroError(
      'Cannot use "ask" strategy in programmatic API',
      'INVALID_STRATEGY'
    );
  }
  
  const item = await db.select()
    .from(items)
    .where(eq(items.key, conflict.itemKey))
    .get();
  
  if (!item) {
    throw new ZoteroError(
      `Item ${conflict.itemKey} not found`,
      'ITEM_NOT_FOUND'
    );
  }
  
  let newValue: any;
  let newVersion: number;
  
  switch (strategy) {
    case 'keep-local':
      // 保留本地值，增加版本号
      newValue = conflict.localValue;
      newVersion = item.version + 1;
      break;
      
    case 'keep-remote':
      // 使用远程值
      newValue = conflict.remoteValue;
      newVersion = item.version; // 远程版本
      break;
      
    case 'merge':
      // 合并值（简化实现：优先使用本地值）
      newValue = conflict.mergedValue ?? conflict.localValue;
      newVersion = item.version + 1;
      break;
      
    default:
      throw new ZoteroError(
        `Unknown strategy: ${strategy}`,
        'INVALID_STRATEGY'
      );
  }
  
  // 更新项目
  await db.update(items)
    .set({
      [conflict.field]: newValue,
      version: newVersion,
      dateModified: Math.floor(Date.now() / 1000)
    })
    .where(eq(items.key, conflict.itemKey))
    .run();
}

/**
 * 批量解决冲突
 */
export async function resolveAllConflicts(
  strategy: ConflictStrategy
): Promise<{ resolved: number; failed: number }> {
  const conflicts = await getConflicts();
  let resolved = 0;
  let failed = 0;
  
  for (const conflict of conflicts) {
    try {
      await resolveConflict(conflict, strategy);
      resolved++;
    } catch {
      failed++;
    }
  }
  
  return { resolved, failed };
}

// 导入需要的函数
import { eq, isNull, sql } from 'drizzle-orm';
