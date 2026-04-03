/**
 * Zotero-Headless API
 *
 * 程序化 API 入口
 * 为 AI Agent 和人类 CLI 提供统一的接口
 */

// 类型定义
export * from './types.js';

// 错误类型
export {
  ErrorCode,
  ZoteroError,
  ItemNotFoundError,
  ValidationError,
  BatchLimitError,
  SyncError,
  ConfigError,
  IdentifierNotFoundError,
  RateLimitError,
} from './errors.js';
export type { ErrorCodeType } from './errors.js';

// 文献管理
export {
  listItems,
  searchItems,
  getItem,
  getItemOrThrow,
  createItem,
  updateItem,
  deleteItem,
  batchDelete,
  restoreItem,
  getAnnotations,
} from './items.js';

// 通过标识符添加
export {
  addById,
  batchAddById,
} from './add-by-id.js';
export type {
  AddByIdOptions,
  AddByIdResult,
  BatchAddByIdOptions,
} from './add-by-id.js';

// 批量操作
export {
  batchCreate,
  batchUpdate,
  batchTag,
  batchUntag,
  batchAddToCollection,
  batchRemoveFromCollection,
  BATCH_CREATE_LIMIT,
  BATCH_UPDATE_LIMIT,
  BATCH_TAG_LIMIT,
  BATCH_COLLECTION_LIMIT,
} from './batch.js';

// 导出
export { exportItems } from './export.js';
export type { ExportItemsOptions, ExportResult } from './export.js';

// 同步
export {
  sync,
  getSyncStatus,
  getConflicts,
  resolveConflict,
  resolveAllConflicts,
} from './sync.js';

// 配置
export {
  getConfig,
  setConfig,
  validateApiKey,
  initConfig,
} from './config.js';

// 附件内容
export {
  getAttachmentContent,
  listAttachments,
  renderAttachmentPages,
  getAnnotationImage,
} from './attachments.js';

// 变更监听
export { watchChanges } from './watch.js';
export type { WatchOptions, WatchHandle, ChangeCallback } from './watch.js';

// 智能分类
export {
  classifyItem,
  classifyBatch,
  buildCollectionProfiles,
  exportTrainingData,
  trainWeights,
  invalidateProfileCache,
} from './classify.js';
export type {
  ClassifyOptions,
  ClassifyBatchOptions,
  ClassifyResult,
  ClassifyBatchResult,
  ClassifyRecommendation,
  CollectionProfile,
  ClassificationLogEntry,
  TrainResult,
} from './classify.js';

// 工作流引擎
export { createWorkflow } from './workflow.js';
export type {
  WorkflowStep,
  WorkflowOptions,
  WorkflowResult,
  StepResult,
  Workflow,
} from './workflow.js';

// 版本
export const VERSION = '1.0.0';
