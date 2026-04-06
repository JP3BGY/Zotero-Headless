// @ts-nocheck
// Database Schema - Drizzle ORM
// See Zotero-Headless-Complete-Design.md Section 3

import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// Helper to create text columns with proper typing
const textCol = (name: string) => text(name) as any;

// ============ Libraries 表 ============
export const libraries = sqliteTable('libraries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  
  // Zotero 标识
  zoteroId: textCol('zotero_id').notNull(),     // API 中的用户/组 ID
  type: textCol('type').notNull(),              // 'user' | 'group'
  name: textCol('name'),
  
  // 同步状态
  version: integer('version').notNull().default(0),
  lastSyncAt: integer('last_sync_at', {  }),
  
  // 原始数据
  rawJson: textCol('raw_json'),
}, (table) => ({
  uniqueZotero: { columns: [table.zoteroId, table.type], unique: true },
})) as any;

// ============ Items 表 ============
export const items = sqliteTable('items', {
  // 主键组合
  key: textCol('key').notNull(),
  libraryId: integer('library_id').notNull(),
  
  // 元数据
  version: integer('version').notNull().default(0),
  synced: integer('synced', { mode: 'boolean' }).notNull().default(false),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
  deletedAt: integer('deleted_at'),  // Timestamp when item was moved to trash (null = not trashed)
  createdAt: integer('created_at', {  }).notNull(),
  updatedAt: integer('updated_at', {  }).notNull(),
  
  // 核心字段（Agent 最常用）
  itemType: textCol('item_type').notNull(),
  title: textCol('title'),
  publicationDate: textCol('publication_date'),
  abstract: textCol('abstract'),
  
  // 标识字段
  doi: textCol('doi'),
  url: textCol('url'),
  isbn: textCol('isbn'),
  issn: textCol('issn'),
  
  // 出版信息
  publisher: textCol('publisher'),
  journal: textCol('journal'),
  volume: textCol('volume'),
  issue: textCol('issue'),
  pages: textCol('pages'),
  
  // JSON 字段
  creators: textCol('creators').default('[]'),
  collectionKeys: textCol('collection_keys').default('[]'),
  tags: textCol('tags').default('[]'),
  extra: textCol('extra').default('{}'),
  
  // 完整原始数据
  rawJson: textCol('raw_json').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.key, table.libraryId] }),
  versionIdx: index('items_version_idx').on(table.libraryId, table.version),
  titleIdx: index('items_title_idx').on(table.title),
  typeIdx: index('items_type_idx').on(table.itemType),
  updatedIdx: index('items_updated_idx').on(table.updatedAt),
  libraryIdx: index('items_library_idx').on(table.libraryId),
})) as any;

// ============ Collections 表 ============
export const collections = sqliteTable('collections', {
  key: textCol('key').notNull(),
  libraryId: integer('library_id').notNull(),

  name: textCol('name').notNull(),
  parentKey: textCol('parent_key'),
  version: integer('version').notNull().default(0),
  synced: integer('synced', { mode: 'boolean' }).notNull().default(true),

  createdAt: integer('created_at', {  }).notNull(),
  updatedAt: integer('updated_at', {  }).notNull(),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),

  rawJson: textCol('raw_json').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.key, table.libraryId] }),
  parentIdx: index('collections_parent_idx').on(table.parentKey),
  libraryIdx: index('collections_library_idx').on(table.libraryId),
})) as any;

// ============ Item Tags 表（高效查询） ============
export const itemTags = sqliteTable('item_tags', {
  itemKey: textCol('item_key').notNull(),
  libraryId: integer('library_id').notNull(),
  tag: textCol('tag').notNull(),
  tagType: integer('tag_type').default(0),
  createdAt: integer('created_at', {  }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.itemKey, table.tag] }),
  tagIdx: index('tags_library_tag_idx').on(table.libraryId, table.tag),
})) as any;

// ============ Attachments 表 ============
export const attachments = sqliteTable('attachments', {
  key: textCol('key').notNull(),
  parentItemKey: textCol('parent_item_key').notNull(),
  libraryId: integer('library_id').notNull(),
  
  filename: textCol('filename'),
  contentType: textCol('content_type'),
  fileType: textCol('file_type'),
  path: textCol('path'),
  url: textCol('url'),
  
  version: integer('version').notNull().default(0),
  createdAt: integer('created_at', {  }).notNull(),
  updatedAt: integer('updated_at', {  }).notNull(),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
  size: integer('size'),
  md5: textCol('md5'),
  
  // WebDAV sync fields
  webdavSynced: integer('webdav_synced', { mode: 'boolean' }).notNull().default(false),
  webdavPath: textCol('webdav_path'),
  webdavSyncedAt: integer('webdav_synced_at'),
  
  rawJson: textCol('raw_json').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.key, table.libraryId] }),
  parentIdx: index('attachments_parent_idx').on(table.parentItemKey),
  libraryIdx: index('attachments_library_idx').on(table.libraryId),
})) as any;

// ============ Sync Logs 表 ============
export const syncLogs = sqliteTable('sync_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  libraryId: integer('library_id').notNull(),
  
  startedAt: integer('started_at', {  }).notNull(),
  completedAt: integer('completed_at', {  }),
  status: textCol('status').notNull(),
  
  remoteVersion: integer('remote_version'),
  localVersion: integer('local_version'),
  itemsUpdated: integer('items_updated').default(0),
  itemsDeleted: integer('items_deleted').default(0),
  errorMessage: textCol('error_message'),
});

// ============ WebDAV Config 表 ============
export const webdavConfig = sqliteTable('webdav_config', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  url: textCol('url').notNull(),
  username: textCol('username').notNull(),
  password: textCol('password').notNull(),
  basePath: textCol('base_path').notNull().default('/zotero'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  autoSync: integer('auto_sync', { mode: 'boolean' }).notNull().default(false),
  lastSyncAt: integer('last_sync_at', {  }),
  lastError: textCol('last_error'),
  createdAt: integer('created_at', {  }).notNull(),
  updatedAt: integer('updated_at', {  }).notNull(),
});

// ============ Deletion Log 表（审计日志） ============
export const deletionLog = sqliteTable('deletion_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemKey: textCol('item_key').notNull(),
  libraryId: integer('library_id').notNull(),
  title: textCol('title'),
  itemType: textCol('item_type'),
  operationType: textCol('operation_type').notNull(), // 'soft' | 'hard'
  caller: textCol('caller').notNull(),                // 'cli' | 'shell' | 'agent' | 'sync'
  rawJsonSnapshot: textCol('raw_json_snapshot'),       // Full item data for recovery
  deletedAt: integer('deleted_at').notNull(),          // Timestamp of this delete operation
});

// ============ Content Cache 表 ============
export const contentCache = sqliteTable('content_cache', {
  attachmentKey: textCol('attachment_key').notNull(),
  libraryId: integer('library_id').notNull(),
  fileMd5: textCol('file_md5').notNull(),
  content: textCol('content').notNull(),
  format: textCol('format').notNull().default('text'),
  extractedAt: integer('extracted_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.attachmentKey, table.libraryId] }),
})) as any;

// ============ Classification Log 表 ============
export const classificationLog = sqliteTable('classification_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemKey: textCol('item_key').notNull(),
  libraryId: integer('library_id').notNull(),
  itemTitle: textCol('item_title'),
  recommendedCollectionKey: textCol('recommended_collection_key').notNull(),
  recommendedCollectionName: textCol('recommended_collection_name'),
  chosenCollectionKey: textCol('chosen_collection_key'),
  chosenCollectionName: textCol('chosen_collection_name'),
  score: integer('score'),
  strategyScoresJson: textCol('strategy_scores_json'),
  weightsJson: textCol('weights_json'),
  source: textCol('source').notNull(),
  isCorrection: integer('is_correction', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
}) as any;

// ============ Sync Cache 表（三路合并所需的对象快照） ============
export const syncCache = sqliteTable('sync_cache', {
  libraryId: integer('library_id').notNull(),
  key: textCol('key').notNull(),
  objectType: textCol('object_type').notNull(),  // 'item' | 'collection'
  version: integer('version').notNull(),
  data: textCol('data').notNull(),               // JSON snapshot at this version
}, (table) => ({
  pk: primaryKey({ columns: [table.libraryId, table.key, table.objectType, table.version] }),
  lookupIdx: index('sync_cache_lookup_idx').on(table.libraryId, table.key, table.objectType),
})) as any;

// ============ Sync Queue 表（失败对象重试队列） ============
export const syncQueue = sqliteTable('sync_queue', {
  libraryId: integer('library_id').notNull(),
  key: textCol('key').notNull(),
  objectType: textCol('object_type').notNull(),  // 'item' | 'collection'
  lastCheck: integer('last_check').notNull().default(0),  // Unix timestamp of last attempt
  tries: integer('tries').notNull().default(0),           // Number of retry attempts
}, (table) => ({
  pk: primaryKey({ columns: [table.libraryId, table.key, table.objectType] }),
})) as any;

// ============ Synced Settings 表 ============
export const syncedSettings = sqliteTable('synced_settings', {
  setting: textCol('setting').notNull(),
  libraryId: integer('library_id').notNull(),
  value: textCol('value').notNull(),  // JSON-encoded value
  version: integer('version').notNull().default(0),
  synced: integer('synced', { mode: 'boolean' }).notNull().default(false),
}, (table) => ({
  pk: primaryKey({ columns: [table.setting, table.libraryId] }),
})) as any;

// ============ Saved Searches 表 ============
export const savedSearches = sqliteTable('saved_searches', {
  key: textCol('key').notNull(),
  libraryId: integer('library_id').notNull(),
  name: textCol('name').notNull(),
  version: integer('version').notNull().default(0),
  synced: integer('synced', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
  rawJson: textCol('raw_json').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.key, table.libraryId] }),
  libraryIdx: index('saved_searches_library_idx').on(table.libraryId),
})) as any;

// ============ Saved Search Conditions 表 ============
export const savedSearchConditions = sqliteTable('saved_search_conditions', {
  searchKey: textCol('search_key').notNull(),
  libraryId: integer('library_id').notNull(),
  conditionIndex: integer('condition_index').notNull(),
  condition: textCol('condition').notNull(),
  operator: textCol('operator').notNull(),
  value: textCol('value'),
  required: integer('required', { mode: 'boolean' }).notNull().default(false),
}, (table) => ({
  pk: primaryKey({ columns: [table.searchKey, table.libraryId, table.conditionIndex] }),
})) as any;

// ============ Fulltext Sync State 表 ============
export const fulltextSyncState = sqliteTable('fulltext_sync_state', {
  attachmentKey: textCol('attachment_key').notNull(),
  libraryId: integer('library_id').notNull(),
  version: integer('version').notNull().default(0),
  synced: integer('synced', { mode: 'boolean' }).notNull().default(false),
  indexedPages: integer('indexed_pages'),
  totalPages: integer('total_pages'),
  indexedChars: integer('indexed_chars'),
  totalChars: integer('total_chars'),
}, (table) => ({
  pk: primaryKey({ columns: [table.attachmentKey, table.libraryId] }),
})) as any;

// ============ Relations ============
export const librariesRelations = relations(libraries, ({ many }) => ({
  items: many(items),
  collections: many(collections),
})) as any;

export const itemsRelations = relations(items, ({ many }) => ({
  tags: many(itemTags),
})) as any;

export const itemTagsRelations = relations(itemTags, ({ one }) => ({
  item: one(items, {
    fields: [itemTags.itemKey],
    references: [items.key],
  }),
})) as any;

// ============ Type Exports ============
export type Library = typeof libraries.$inferSelect;
export type NewLibrary = typeof libraries.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type Collection = typeof collections.$inferSelect;
export type NewCollection = typeof collections.$inferInsert;
export type ItemTag = typeof itemTags.$inferSelect;
export type NewItemTag = typeof itemTags.$inferInsert;
export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;
export type SyncLog = typeof syncLogs.$inferSelect;
export type NewSyncLog = typeof syncLogs.$inferInsert;
export type WebDAVConfig = typeof webdavConfig.$inferSelect;
export type NewWebDAVConfig = typeof webdavConfig.$inferInsert;
export type DeletionLog = typeof deletionLog.$inferSelect;
export type NewDeletionLog = typeof deletionLog.$inferInsert;
export type ContentCache = typeof contentCache.$inferSelect;
export type NewContentCache = typeof contentCache.$inferInsert;
export type ClassificationLog = typeof classificationLog.$inferSelect;
export type NewClassificationLog = typeof classificationLog.$inferInsert;
export type SyncCacheEntry = typeof syncCache.$inferSelect;
export type NewSyncCacheEntry = typeof syncCache.$inferInsert;
export type SyncQueueEntry = typeof syncQueue.$inferSelect;
export type NewSyncQueueEntry = typeof syncQueue.$inferInsert;
export type SyncedSetting = typeof syncedSettings.$inferSelect;
export type NewSyncedSetting = typeof syncedSettings.$inferInsert;
export type SavedSearch = typeof savedSearches.$inferSelect;
export type NewSavedSearch = typeof savedSearches.$inferInsert;
export type SavedSearchCondition = typeof savedSearchConditions.$inferSelect;
export type NewSavedSearchCondition = typeof savedSearchConditions.$inferInsert;
export type FulltextSyncState = typeof fulltextSyncState.$inferSelect;
export type NewFulltextSyncState = typeof fulltextSyncState.$inferInsert;
