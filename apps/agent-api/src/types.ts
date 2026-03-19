/**
 * Zotero-Headless API Types
 * 
 * 为 Agent 和人类 CLI 提供统一的类型定义
 */

// ============ 基础类型 ============

export interface Creator {
  creatorType: string;
  firstName?: string;
  lastName?: string;
  name?: string;
}

export interface Tag {
  tag: string;
  type?: number;
}

export interface Item {
  key: string;
  version: number;
  itemType: string;
  title?: string;
  creators?: Creator[];
  abstractNote?: string;
  date?: string;
  url?: string;
  DOI?: string;
  accessDate?: string;
  libraryCatalog?: string;
  callNumber?: string;
  rights?: string;
  extra?: string;
  tags?: Tag[];
  collections?: string[];
  relations?: Record<string, string>;
  parentItem?: string;
  note?: string;
  deleted?: boolean;
  // 类型特定的字段
  publicationTitle?: string;
  journalAbbreviation?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  series?: string;
  seriesNumber?: string;
  publisher?: string;
  place?: string;
  ISBN?: string;
  // ... 更多字段可根据需要添加
}

// ============ 搜索相关 ============

export interface SearchOptions {
  limit?: number;
  offset?: number;
  sortBy?: 'title' | 'date' | 'dateAdded' | 'dateModified';
  sortDirection?: 'asc' | 'desc';
  itemType?: string;
  collection?: string;
  tags?: string[];
}

export interface SearchResult {
  items: Item[];
  total: number;
  query: string;
  options: SearchOptions;
  hasMore: boolean;
}

// ============ 列表相关 ============

export interface ListOptions {
  limit?: number;
  offset?: number;
  sortBy?: 'title' | 'date' | 'dateAdded' | 'dateModified';
  sortDirection?: 'asc' | 'desc';
  itemType?: string;
  collection?: string;
  includeTrashed?: boolean;
}

export interface ListResult {
  items: Item[];
  total: number;
  hasMore: boolean;
}

// ============ 同步相关 ============

export type ConflictStrategy = 'keep-local' | 'keep-remote' | 'merge' | 'ask';

export interface SyncOptions {
  libraryId?: string;
  conflictStrategy?: ConflictStrategy;
  dryRun?: boolean;
  onProgress?: (progress: SyncProgress) => void;
}

export interface SyncProgress {
  phase: 'download' | 'upload' | 'resolve' | 'complete';
  current: number;
  total: number;
  currentItem?: string;
  message?: string;
}

export interface Conflict {
  itemKey: string;
  field: string;
  localValue: any;
  remoteValue: any;
  mergedValue?: any;
  itemType?: string;
  title?: string;
}

export interface SyncResult {
  success: boolean;
  downloaded: number;
  uploaded: number;
  deleted: number;
  conflicts: Conflict[];
  errors: SyncErrorInfo[];
  dryRun?: boolean;
}

export interface SyncErrorInfo {
  itemKey: string;
  operation: 'download' | 'upload' | 'delete';
  error: string;
  recoverable: boolean;
}

export interface SyncStatus {
  lastSync: Date | null;
  localItemCount: number;
  remoteItemCount: number | null;
  pendingUploads: number;
  conflicts: number;
  isSyncing: boolean;
}

// ============ 删除相关 ============

/** Maximum number of items that can be deleted in a single batch operation */
export const BATCH_DELETE_LIMIT = 10;

export interface DeleteOptions {
  /** @deprecated Permanent delete is no longer allowed via agent API. Always moves to trash. */
  permanent?: boolean;
}

// ============ Annotation 相关 ============

export interface Annotation {
  key: string;
  parentAttachmentKey: string;
  annotationType: string;  // 'highlight' | 'note' | 'image' | 'ink' | 'underline'
  annotationText?: string;
  annotationComment?: string;
  annotationColor?: string;
  annotationPageLabel?: string;
  annotationSortIndex?: string;
  tags?: Tag[];
}

// ============ 批量操作 ============

export interface BatchOptions {
  continueOnError?: boolean;
  onProgress?: (progress: BatchProgress) => void;
}

export interface BatchProgress {
  current: number;
  total: number;
  currentItem: string;
  succeeded: number;
  failed: number;
}

export interface BatchResult {
  succeeded: string[];
  failed: Array<{ key: string; error: string }>;
  total: number;
}

// ============ 导出相关 ============

export type ExportFormat = 'json' | 'bibtex' | 'ris' | 'csv' | 'csljson';

export interface ExportOptions {
  format: ExportFormat;
  includeNotes?: boolean;
  includeAttachments?: boolean;
}

// ============ 配置相关 ============

export interface Config {
  apiKey?: string;
  userId?: string;
  libraryId?: string;
  libraryType?: 'user' | 'group';
  syncMode?: 'full' | 'items-only';
  webdav?: WebDAVConfig;
}

export interface WebDAVConfig {
  enabled: boolean;
  url?: string;
  username?: string;
  password?: string;
}

// ============ 错误类型 ============

export class ZoteroError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'ZoteroError';
  }
}

export class ItemNotFoundError extends ZoteroError {
  constructor(public itemKey: string, suggestions?: string[]) {
    super(
      `Item not found: ${itemKey}`,
      'ITEM_NOT_FOUND',
      { itemKey, suggestions }
    );
  }
}

export class ValidationError extends ZoteroError {
  constructor(message: string, public field?: string) {
    super(message, 'VALIDATION_ERROR', { field });
  }
}

export class SyncError extends ZoteroError {
  constructor(message: string, public phase: string) {
    super(message, 'SYNC_ERROR', { phase });
  }
}

// ============ Agent 专用 ============

export interface ChangeEvent {
  type: 'create' | 'update' | 'delete';
  itemKey: string;
  item?: Item;
  timestamp: Date;
}

export interface SemanticSearchOptions extends SearchOptions {
  semantic?: boolean;  // 使用语义搜索而非关键词匹配
  relatedTo?: string;  // 查找与指定项目相关的文献
}

export interface SmartFilter {
  field: string;
  operator: 'eq' | 'contains' | 'gt' | 'lt' | 'between';
  value: any;
}

export interface Facet {
  field: string;
  values: Array<{ value: string; count: number }>;
}
