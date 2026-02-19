/**
 * Zotero-Headless API
 * 
 * 程序化 API 入口
 * 为 AI Agent 和人类 CLI 提供统一的接口
 */

// 类型定义
export * from './types.js';

// 文献管理
export {
  listItems,
  searchItems,
  getItem,
  getItemOrThrow,
  deleteItem,
  batchDelete,
  restoreItem
} from './items.js';

// 同步
export {
  sync,
  getSyncStatus,
  getConflicts,
  resolveConflict,
  resolveAllConflicts
} from './sync.js';

// 配置
export {
  getConfig,
  setConfig,
  validateApiKey,
  initConfig
} from './config.js';

// 版本
export const VERSION = '1.0.0';
