/**
 * Zotero-Headless API Types
 * 
 * 为 Agent 和人类 CLI 提供统一的类型定义
 */

// ============ 标识符类型（从共享包重导出）============
export type { IdentifierType, Identifier } from '@zotero-headless/types';

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

export interface AnnotationPosition {
  pageIndex: number;
  rects?: number[][];
  paths?: number[][];
  width?: number;
  height?: number;
}

export interface Annotation {
  key: string;
  parentAttachmentKey: string;
  annotationType: string;  // 'highlight' | 'note' | 'image' | 'ink' | 'underline' | 'text'
  annotationText?: string;
  annotationComment?: string;
  annotationColor?: string;
  annotationPageLabel?: string;
  annotationSortIndex?: string;
  annotationPosition?: AnnotationPosition;
  tags?: Tag[];
}

// ============ 批量操作 ============

export interface BatchOptions {
  continueOnError?: boolean;
  /** Max concurrent operations. Default 1 (sequential). Max 5. */
  concurrency?: number;
  /** If true, preview changes without writing to DB */
  dryRun?: boolean;
  onProgress?: (progress: BatchProgress) => void;
}

export interface BatchProgress {
  current: number;
  total: number;
  currentItem: string;
  succeeded: number;
  failed: number;
  /** Percentage 0-100 */
  percentage: number;
}

export interface BatchResult {
  succeeded: string[];
  failed: Array<{
    key: string;
    error: string;
    code?: string;
    recoverable?: boolean;
    suggestion?: string;
  }>;
  total: number;
}

// ============ 创建/更新相关 ============

export interface CreateItemInput {
  itemType: string;
  title?: string;
  creators?: Creator[];
  tags?: Tag[];
  collections?: string[];
  [key: string]: unknown;
}

export interface CreateItemOptions {
  /** If true, validate and build but skip DB insert */
  dryRun?: boolean;
}

export interface CreateItemResult {
  key: string;
  item: Item;
}

export interface UpdateItemInput {
  [key: string]: unknown;
}

export interface UpdateItemOptions {
  /** If true, compute changes but skip DB write */
  dryRun?: boolean;
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

// ============ 附件内容 ============

export interface AttachmentContent {
  key: string;
  filename: string;
  contentType: string;
  format: 'markdown' | 'text';
  content: string;
  totalLength: number;
  offset: number;
  limit: number;
  truncated: boolean;
  extractedAt: number;
  cached: boolean;
}

export interface GetAttachmentContentOptions {
  format?: 'markdown' | 'text';
  /** Character offset for pagination */
  offset?: number;
  /** Max characters to return (default: 100000) */
  limit?: number;
  /** Force re-extraction, bypassing cache */
  noCache?: boolean;
}

export interface AttachmentInfo {
  key: string;
  parentItemKey: string;
  filename: string | null;
  contentType: string | null;
  url: string | null;
  localPath: string | null;
  webdavSynced: boolean;
}

export interface RenderAttachmentPagesOptions {
  /** Scale factor for rendering (default: 2 for ~144 DPI) */
  scale?: number;
  /** Specific pages to render (1-indexed). If omitted, renders all pages. */
  pages?: number[];
  /** Output image format (default: 'png') */
  imageFormat?: 'png' | 'jpeg';
  /** JPEG quality 1-100 (default: 85) */
  quality?: number;
}

export interface RenderedAttachmentPage {
  pageNumber: number;
  width: number;
  height: number;
  imageFormat: 'png' | 'jpeg';
  /** Base64-encoded image data */
  dataBase64: string;
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
