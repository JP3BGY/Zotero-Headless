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
  lastSyncAt: integer('last_sync_at', { mode: 'timestamp' }),
  
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
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  
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
  
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
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
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
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
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
  size: integer('size'),
  md5: textCol('md5'),
  
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
  
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  status: textCol('status').notNull(),
  
  remoteVersion: integer('remote_version'),
  localVersion: integer('local_version'),
  itemsUpdated: integer('items_updated').default(0),
  itemsDeleted: integer('items_deleted').default(0),
  errorMessage: textCol('error_message'),
});

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
