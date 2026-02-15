// Database Schema - Drizzle ORM
// See Zotero-Headless-Complete-Design.md Section 3

import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// ============ Libraries 表 ============
export const libraries = sqliteTable('libraries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  
  // Zotero 标识
  zoteroId: text('zotero_id').notNull(),     // API 中的用户/组 ID
  type: text('type').notNull(),              // 'user' | 'group'
  name: text('name'),
  
  // 同步状态
  version: integer('version').notNull().default(0),
  lastSyncAt: integer('last_sync_at', { mode: 'timestamp' }),
  
  // 原始数据
  rawJson: text('raw_json'),
}, (table) => ({
  uniqueZotero: { columns: [table.zoteroId, table.type], unique: true },
}));

// ============ Items 表 ============
export const items = sqliteTable('items', {
  // 主键组合
  key: text('key').notNull(),
  libraryId: integer('library_id').notNull(),
  
  // 元数据
  version: integer('version').notNull().default(0),
  synced: integer('synced', { mode: 'boolean' }).notNull().default(false),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  
  // 核心字段（Agent 最常用）
  itemType: text('item_type').notNull(),
  title: text('title'),
  publicationDate: text('publication_date'),
  abstract: text('abstract'),
  
  // 标识字段
  doi: text('doi'),
  url: text('url'),
  isbn: text('isbn'),
  issn: text('issn'),
  
  // 出版信息
  publisher: text('publisher'),
  journal: text('journal'),
  volume: text('volume'),
  issue: text('issue'),
  pages: text('pages'),
  
  // JSON 字段
  creators: text('creators').default('[]'),
  collectionKeys: text('collection_keys').default('[]'),
  tags: text('tags').default('[]'),
  extra: text('extra').default('{}'),
  
  // 完整原始数据
  rawJson: text('raw_json').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.key, table.libraryId] }),
  versionIdx: index('items_version_idx').on(table.libraryId, table.version),
  titleIdx: index('items_title_idx').on(table.title),
  typeIdx: index('items_type_idx').on(table.itemType),
  updatedIdx: index('items_updated_idx').on(table.updatedAt),
  libraryIdx: index('items_library_idx').on(table.libraryId),
}));

// ============ Collections 表 ============
export const collections = sqliteTable('collections', {
  key: text('key').notNull(),
  libraryId: integer('library_id').notNull(),
  
  name: text('name').notNull(),
  parentKey: text('parent_key'),
  version: integer('version').notNull().default(0),
  
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
  
  rawJson: text('raw_json').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.key, table.libraryId] }),
  parentIdx: index('collections_parent_idx').on(table.parentKey),
  libraryIdx: index('collections_library_idx').on(table.libraryId),
}));

// ============ Item Tags 表（高效查询） ============
export const itemTags = sqliteTable('item_tags', {
  itemKey: text('item_key').notNull(),
  libraryId: integer('library_id').notNull(),
  tag: text('tag').notNull(),
  tagType: integer('tag_type').default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.itemKey, table.tag] }),
  tagIdx: index('tags_library_tag_idx').on(table.libraryId, table.tag),
}));

// ============ Attachments 表 ============
export const attachments = sqliteTable('attachments', {
  key: text('key').notNull(),
  parentItemKey: text('parent_item_key').notNull(),
  libraryId: integer('library_id').notNull(),
  
  filename: text('filename'),
  contentType: text('content_type'),
  fileType: text('file_type'),
  path: text('path'),
  url: text('url'),
  
  version: integer('version').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
  size: integer('size'),
  md5: text('md5'),
  
  rawJson: text('raw_json').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.key, table.libraryId] }),
  parentIdx: index('attachments_parent_idx').on(table.parentItemKey),
  libraryIdx: index('attachments_library_idx').on(table.libraryId),
}));

// ============ Sync Logs 表 ============
export const syncLogs = sqliteTable('sync_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  libraryId: integer('library_id').notNull(),
  
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  status: text('status').notNull(),
  
  remoteVersion: integer('remote_version'),
  localVersion: integer('local_version'),
  itemsUpdated: integer('items_updated').default(0),
  itemsDeleted: integer('items_deleted').default(0),
  errorMessage: text('error_message'),
});

// ============ Relations ============
export const librariesRelations = relations(libraries, ({ many }) => ({
  items: many(items),
  collections: many(collections),
}));

export const itemsRelations = relations(items, ({ many }) => ({
  tags: many(itemTags),
}));

export const itemTagsRelations = relations(itemTags, ({ one }) => ({
  item: one(items, {
    fields: [itemTags.itemKey],
    references: [items.key],
  }),
}));

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
