# Zotero-Headless 项目完善设计文档

**文档版本**: 1.0  
**目的**: 指导 Coding Agent 完整实施项目  
**最后更新**: 2026-02-15

---

## 一、项目概述

### 1.1 项目目标

Zotero-Headless 是一个基于 Node.js + TypeScript 的 Zotero Web API 同步客户端，无需 Zotero 桌面客户端即可实现完整的文献库同步、管理和离线访问。

**核心价值**：
- 绕过 Zotero API 限速和网速限制
- 本地 SQLite 实现快速批量查询
- Agent 可以直接操作本地数据库

### 1.2 核心功能

- 双向同步：与 Zotero 云服务器完整同步
- 离线支持：SQLite 本地持久化
- API 客户端：完整的 Zotero Web API v3
- 类型安全：完整 TypeScript 定义
- CLI 工具：同步和管理命令

### 1.3 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI Layer                            │
│                   (apps/cli - 命令行)                        │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                      Core Layer                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Sync Engine │  │  Conflict   │  │  State Machine      │ │
│  │             │  │  Resolver   │  │                     │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────┬───────────────────────────────┘
                              │
        ┌─────────────────────┴─────────────────────┐
        │                                           │
┌───────▼────────┐                         ┌──────▼────────┐
│  Zotero API    │                         │   Database    │
│  Client       │                         │   Layer       │
│  ┌──────────┐ │                         │  ┌──────────┐ │
│  │ Rate     │ │                         │  │Repository│ │
│  │ Limiter  │ │                         │  │ Schema   │ │
│  └──────────┘ │                         │  │ Migrate  │ │
└───────────────┘                         │  └──────────┘ │
                                          └──────────────┘
```

---

## 二、技术选型

### 2.1 技术栈

| 组件 | 技术选型 | 理由 |
|------|---------|------|
| 语言 | TypeScript | 强类型，对 Agent 最友好 |
| 数据库 | SQLite (better-sqlite3) | 轻量级、高性能 |
| ORM | Drizzle | 轻量级、类型安全 |
| 构建 | Turborepo | Monorepo 管理 |
| 包管理 | pnpm | 工作区支持好 |
| 验证 | Zod | 运行时验证 |

### 2.2 项目结构

```
zotero-headless/
├── apps/
│   └── cli/                    # CLI 应用
│       ├── src/
│       │   ├── commands/       # CLI 命令
│       │   ├── index.ts
│       │   └── cli.ts
│       └── package.json
│
├── packages/
│   ├── types/                  # 共享类型
│   │   ├── src/
│   │   │   ├── item.ts
│   │   │   ├── collection.ts
│   │   │   ├── sync.ts
│   │   │   └── index.ts
│   │   └── package.json
│
│   ├── api/                    # Zotero API 客户端
│   │   ├── src/
│   │   │   ├── client.ts
│   │   │   ├── types.ts
│   │   │   ├── rate-limiter.ts
│   │   │   └── index.ts
│   │   └── package.json
│
│   ├── database/               # 数据库层
│   │   ├── src/
│   │   │   ├── schema.ts       # Drizzle schema
│   │   │   ├── index.ts        # DB 实例
│   │   │   ├── migrations/     # 迁移脚本
│   │   │   └── index.ts
│   │   ├── drizzle.config.ts
│   │   └── package.json
│
│   └── sync-engine/            # 同步引擎
│       ├── src/
│       │   ├── manager.ts      # SyncManager
│       │   ├── state-machine.ts
│       │   ├── conflict.ts
│       │   ├── queue.ts
│       │   └── index.ts
│       └── package.json
│
├── tooling/
│   ├── eslint-config/
│   └── typescript-config/
│
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

---

## 三、数据库设计

### 3.1 设计原则

**核心决策：不追求完全兼容 Zotero Desktop，适度简化**

- 常用字段展开为列，次要字段 JSON 存储
- Agent 可以直接写 `SELECT title FROM items`，无需理解 EAV 模型

### 3.2 Schema 定义 (Drizzle ORM)

```typescript
// packages/database/src/schema.ts
import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// ============ Items 表 ============
export const items = sqliteTable('items', {
  // 主键组合
  key: text('key').notNull(),           // Zotero item key (8 chars)
  libraryId: integer('library_id').notNull(),
  
  // 元数据
  version: integer('version').notNull().default(0),
  synced: integer('synced', { mode: 'boolean' }).notNull().default(false),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  
  // 核心字段（Agent 最常用）
  itemType: text('item_type').notNull(),  // 'journalArticle', 'book'...
  title: text('title'),
  publicationDate: text('publication_date'),  // ISO 8601
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
  
  // JSON 字段（复杂但低频访问）
  creators: text('creators').default('[]'),    // JSON: [{lastName, firstName, creatorType}]
  collectionKeys: text('collection_keys').default('[]'), // JSON: ["key1", "key2"]
  tags: text('tags').default('[]'),            // JSON: [{tag, type}]
  extra: text('extra').default('{}'),
  
  // 完整原始数据（用于回填/调试）
  rawJson: text('raw_json').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.key, table.libraryId] }),
  versionIdx: index('items_version_idx').on(table.libraryId, table.version),
  titleIdx: index('items_title_idx').on(table.title),
  typeIdx: index('items_type_idx').on(table.itemType),
  updatedIdx: index('items_updated_idx').on(table.updatedAt),
}));

// ============ Collections 表 ============
export const collections = sqliteTable('collections', {
  key: text('key').notNull(),
  libraryId: integer('library_id').notNull(),
  
  name: text('name').notNull(),
  parentKey: text('parent_key'),     // NULL 表示根集合
  version: integer('version').notNull().default(0),
  
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
  
  rawJson: text('raw_json').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.key, table.libraryId] }),
  parentIdx: index('collections_parent_idx').on(table.parentKey),
}));

// ============ Libraries 表 ============
export const libraries = sqliteTable('libraries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  
  zoteroId: text('zotero_id').notNull(),    // API 中的用户/组 ID
  type: text('type').notNull(),             // 'user' | 'group'
  name: text('name'),
  
  version: integer('version').notNull().default(0),
  lastSyncAt: integer('last_sync_at', { mode: 'timestamp' }),
  
  rawJson: text('raw_json'),
}, (table) => ({
  uniqueZotero: { columns: [table.zoteroId, table.type], unique: true },
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

// ============ Sync Logs 表 ============
export const syncLogs = sqliteTable('sync_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  libraryId: integer('library_id').notNull(),
  
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  status: text('status').notNull(),       // 'success' | 'failed' | 'partial'
  
  remoteVersion: integer('remote_version'),
  localVersion: integer('local_version'),
  itemsUpdated: integer('items_updated').default(0),
  itemsDeleted: integer('items_deleted').default(0),
  errorMessage: text('error_message'),
});

// ============ Relations ============
export const itemsRelations = relations(items, ({ many }) => ({
  tags: many(itemTags),
}));

export const itemTagsRelations = relations(itemTags, ({ one }) => ({
  item: one(items, {
    fields: [itemTags.itemKey],
    references: [items.key],
  }),
}));
```

### 3.3 类型定义

```typescript
// packages/types/src/item.ts

// Item 类型定义
export interface Item {
  key: string;
  libraryId: number;
  version: number;
  synced: boolean;
  deleted: boolean;
  createdAt: Date;
  updatedAt: Date;
  
  // 核心字段
  itemType: string;
  title: string | null;
  publicationDate: string | null;
  abstract: string | null;
  
  // 标识字段
  doi: string | null;
  url: string | null;
  isbn: string | null;
  issn: string | null;
  
  // 出版信息
  publisher: string | null;
  journal: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  
  // JSON 字段
  creators: Creator[];
  collectionKeys: string[];
  tags: Tag[];
  extra: Record<string, unknown>;
  
  // 原始数据
  rawJson: string;
}

export interface Creator {
  lastName: string;
  firstName: string;
  creatorType: CreatorType;
  name?: string;  // 机构名
}

export type CreatorType = 
  | 'author' | 'editor' | 'translator' | 'contributor'
  | 'illustrator' | 'producer' | 'director';

export interface Tag {
  tag: string;
  type?: 0 | 1;
}

// Item 输入类型（创建/更新用）
export type ItemInput = Omit<Item, 'key' | 'version' | 'rawJson'> & {
  key?: string;
};

// 查询过滤器
export interface ItemFilter {
  libraryId: number;
  itemType?: string | string[];
  title?: string;
  creator?: string;
  tag?: string;
  sinceVersion?: number;
  deleted?: boolean;
  limit?: number;
  offset?: number;
}
```

---

## 四、Zotero API 客户端

### 4.1 核心类实现

```typescript
// packages/api/src/client.ts

export interface ZoteroAPIConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface WriteResponse {
  successful: Record<string, string>;
  unchanged: Record<string, unknown>;
  failed: Record<string, { code: string; message: string }>;
}

export class ZoteroAPIClient {
  private baseUrl = 'https://api.zotero.org';
  private apiKey: string;
  
  constructor(config: ZoteroAPIConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? this.baseUrl;
  }
  
  /**
   * 通用请求方法
   */
  private async request<T>(
    method: string,
    path: string,
    options: {
      params?: Record<string, string | number>;
      headers?: Record<string, string>;
      body?: unknown;
    } = {}
  ): Promise<{ data: T; version: number }> {
    const url = new URL(`${this.baseUrl}${path}`);
    
    if (options.params) {
      for (const [key, value] of Object.entries(options.params)) {
        url.searchParams.append(key, String(value));
      }
    }
    
    const headers: Record<string, string> = {
      'Zotero-API-Key': this.apiKey,
      'Zotero-API-Version': '3',
      ...options.headers,
    };
    
    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }
    
    const response = await fetch(url.toString(), {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Zotero API error: ${response.status} - ${error}`);
    }
    
    const version = Number(response.headers.get('Last-Modified-Version') ?? 0);
    
    if (response.status === 204) {
      return { data: undefined as T, version };
    }
    
    const data = await response.json() as T;
    return { data, version };
  }
  
  // ============ 库操作 ============
  
  /** 验证 API Key */
  async verifyKey(): Promise<{ userID: number; username: string; access: KeyAccess }> {
    const response = await this.request<KeyInfo>('GET', '/keys/current');
    return response.data;
  }
  
  /** 获取库版本 */
  async getLibraryVersion(libraryId: string | number): Promise<number> {
    const response = await this.request<unknown>('GET', `/users/${libraryId}`);
    return response.version;
  }
  
  // ============ Item 操作 ============
  
  /** 获取 Item 版本列表（增量同步用） */
  async getItemVersions(
    libraryId: string | number,
    since: number
  ): Promise<Record<string, number>> {
    const response = await this.request<Record<string, number>>(
      'GET',
      `/users/${libraryId}/items`,
      { params: { since, format: 'versions' } }
    );
    return response.data;
  }
  
  /** 批量获取 Items */
  async getItems(libraryId: string | number, itemKeys: string[]): Promise<ZoteroItem[]> {
    if (itemKeys.length === 0) return [];
    
    const response = await this.request<ZoteroItem[]>(
      'GET',
      `/users/${libraryId}/items`,
      { params: { itemKey: itemKeys.join(','), format: 'json' } }
    );
    return response.data;
  }
  
  /** 获取单个 Item */
  async getItem(libraryId: string | number, itemKey: string): Promise<ZoteroItem> {
    const response = await this.request<ZoteroItem>(
      'GET',
      `/users/${libraryId}/items/${itemKey}`
    );
    return response.data;
  }
  
  /** 创建 Item */
  async createItem(
    libraryId: string | number,
    items: Partial<ZoteroItem>[]
  ): Promise<WriteResponse> {
    const response = await this.request<WriteResponse>(
      'POST',
      `/users/${libraryId}/items`,
      { params: { format: 'json' }, body: items }
    );
    return response.data;
  }
  
  /** 更新 Item (PATCH) */
  async updateItem(
    libraryId: string | number,
    itemKey: string,
    data: Record<string, unknown>
  ): Promise<number> {
    const response = await this.request<unknown>(
      'PATCH',
      `/users/${libraryId}/items/${itemKey}`,
      { params: { format: 'json' }, body: data }
    );
    return response.version;
  }
  
  /** 删除 Item */
  async deleteItem(
    libraryId: string | number,
    itemKey: string,
    version: number
  ): Promise<void> {
    await this.request(
      'DELETE',
      `/users/${libraryId}/items/${itemKey}`,
      { headers: { 'If-Unmodified-Since-Version': String(version) } }
    );
  }
  
  // ============ 删除操作 ============
  
  /** 获取已删除对象 */
  async getDeleted(
    libraryId: string | number,
    since: number
  ): Promise<{ items: string[]; collections: string[]; tags: string[] }> {
    const response = await this.request<DeletedObjects>(
      'GET',
      `/users/${libraryId}/deleted`,
      { params: { since } }
    );
    return response.data;
  }
}
```

### 4.2 限流器

```typescript
// packages/api/src/rate-limiter.ts

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  
  constructor(
    private capacity: number = 10,
    private refillRate: number = 10
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }
  
  async acquire(): Promise<void> {
    this.refill();
    
    if (this.tokens >= 1) {
      this.tokens--;
      return;
    }
    
    const waitTime = (1 - this.tokens) * (1000 / this.refillRate);
    await new Promise(resolve => setTimeout(resolve, waitTime));
    return this.acquire();
  }
  
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}
```

---

## 五、同步引擎

### 5.1 同步管理器

```typescript
// packages/sync-engine/src/manager.ts

export interface SyncOptions {
  libraryId?: number;  // 不指定则同步所有
  fullSync?: boolean;
}

export interface SyncResult {
  success: boolean;
  updated: number;
  deleted: number;
  errors: string[];
}

export class SyncManager extends EventEmitter {
  constructor(
    private apiClient: ZoteroAPIClient,
    private db: Database,
    private config: SyncConfig
  ) {}
  
  /**
   * 主同步方法
   */
  async sync(options: SyncOptions = {}): Promise<SyncResult> {
    this.emit('sync:start', options);
    
    try {
      // 1. 验证 API Key
      const keyInfo = await this.apiClient.verifyKey();
      
      // 2. 获取要同步的库
      const libraries = options.libraryId
        ? [await this.getLibrary(options.libraryId)]
        : await this.getAllLibraries();
      
      let totalUpdated = 0;
      let totalDeleted = 0;
      const errors: string[] = [];
      
      // 3. 同步每个库
      for (const library of libraries) {
        const result = await this.syncLibrary(library, options.fullSync ?? false);
        totalUpdated += result.updated;
        totalDeleted += result.deleted;
        if (result.errors.length > 0) {
          errors.push(...result.errors);
        }
      }
      
      this.emit('sync:complete', { updated: totalUpdated, deleted: totalDeleted });
      
      return {
        success: errors.length === 0,
        updated: totalUpdated,
        deleted: totalDeleted,
        errors,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit('sync:error', error);
      return { success: false, updated: 0, deleted: 0, errors: [message] };
    }
  }
  
  /**
   * 同步单个库
   */
  private async syncLibrary(library: Library, fullSync: boolean): Promise<SyncResult> {
    const localVersion = library.version ?? 0;
    const remoteVersion = await this.apiClient.getLibraryVersion(String(library.zoteroId));
    
    // 版本一致，无需同步
    if (remoteVersion <= localVersion && !fullSync) {
      return { success: true, updated: 0, deleted: 0, errors: [] };
    }
    
    // 获取变更列表
    const versionMap = await this.apiClient.getItemVersions(String(library.zoteroId), localVersion);
    const changedKeys = Object.keys(versionMap);
    
    // 批量获取并更新
    let updated = 0;
    const errors: string[] = [];
    
    for (let i = 0; i < changedKeys.length; i += 50) {
      const batch = changedKeys.slice(i, i + 50);
      try {
        const items = await this.apiClient.getItems(String(library.zoteroId), batch);
        
        for (const item of items) {
          await this.upsertItem(item, library.id);
          updated++;
        }
      } catch (e) {
        errors.push(`Batch ${Math.floor(i / 50) + 1} failed: ${e}`);
      }
    }
    
    // 处理删除
    const deletedData = await this.apiClient.getDeleted(String(library.zoteroId), localVersion);
    const deleted = deletedData.items.length;
    
    if (deleted > 0) {
      await this.softDeleteItems(deletedData.items, library.id);
    }
    
    // 更新本地版本
    await this.updateLibraryVersion(library.id, remoteVersion);
    
    return { success: errors.length === 0, updated, deleted, errors };
  }
  
  /**
   * Upsert Item
   */
  private async upsertItem(apiItem: ZoteroItem, libraryId: number): Promise<void> {
    const data = apiItem.data;
    const now = new Date();
    
    await this.db.insert(items).onConflictDoUpdate({
      target: [items.key, items.libraryId],
      set: {
        version: apiItem.version,
        updatedAt: now,
        deleted: false,
        itemType: data.itemType,
        title: data.title ?? null,
        publicationDate: data.date ?? null,
        abstract: data.abstractNote ?? null,
        doi: data.DOI ?? null,
        url: data.url ?? null,
        isbn: data.ISBN ?? null,
        issn: data.ISSN ?? null,
        publisher: data.publisher ?? null,
        journal: data.publicationTitle ?? null,
        volume: data.volume ?? null,
        issue: data.issue ?? null,
        pages: data.pages ?? null,
        creators: JSON.stringify(data.creators ?? []),
        collectionKeys: JSON.stringify(data.collections ?? []),
        tags: JSON.stringify(data.tags ?? []),
        rawJson: JSON.stringify(apiItem),
        synced: true,
      },
    }).run();
  }
  
  /**
   * 软删除 Items
   */
  private async softDeleteItems(keys: string[], libraryId: number): Promise<void> {
    await this.db.update(items)
      .set({ deleted: true, updatedAt: new Date() })
      .where(and(
        eq(items.libraryId, libraryId),
        inArray(items.key, keys)
      )).run();
  }
  
  /**
   * 更新库版本
   */
  private async updateLibraryVersion(libraryId: number, version: number): Promise<void> {
    await this.db.update(libraries)
      .set({ version, lastSyncAt: new Date() })
      .where(eq(libraries.id, libraryId))
      .run();
  }
}
```

### 5.2 冲突解决

```typescript
// packages/sync-engine/src/conflict.ts

interface ThreeWayMerge<T> {
  base: T;      // pristine - 上次同步的数据
  local: T;      // 本地修改
  remote: T;     // 远程最新
}

interface FieldConflict {
  field: string;
  local: unknown;
  remote: unknown;
}

export class ConflictResolver {
  /**
   * 解决 Item 冲突
   */
  resolveItemConflict(merge: ThreeWayMerge<ItemData>): ConflictResolution {
    const conflicts: FieldConflict[] = [];
    const resolved: Record<string, unknown> = {};
    
    const allFields = new Set([
      ...Object.keys(merge.base),
      ...Object.keys(merge.local),
      ...Object.keys(merge.remote),
    ]);
    
    for (const field of allFields) {
      const baseVal = merge.base[field];
      const localVal = merge.local[field];
      const remoteVal = merge.remote[field];
      
      if (localVal === remoteVal) {
        resolved[field] = localVal;
      } else if (localVal === baseVal) {
        resolved[field] = remoteVal;  // 接受远程修改
      } else if (remoteVal === baseVal) {
        resolved[field] = localVal;  // 保留本地修改
      } else {
        conflicts.push({ field, local: localVal, remote: remoteVal });
      }
    }
    
    if (conflicts.length > 0) {
      return { type: 'conflict', conflicts, data: resolved };
    }
    
    return { type: 'resolved', data: resolved };
  }
}
```

---

## 六、Repository 实现

### 6.1 Item Repository

```typescript
// packages/database/src/repositories/item.repository.ts

export class ItemRepository {
  constructor(private db: Database) {}
  
  /**
   * 根据 key 查询
   */
  findByKey(key: string, libraryId: number): Item | null {
    const row = this.db.select().from(items)
      .where(and(eq(items.key, key), eq(items.libraryId, libraryId)))
      .get();
    
    return row ? this.parseRow(row) : null;
  }
  
  /**
   * 条件查询
   */
  findAll(filter: ItemFilter): { items: Item[]; total: number } {
    const conditions = [eq(items.libraryId, filter.libraryId)];
    
    if (filter.itemType) {
      if (Array.isArray(filter.itemType)) {
        conditions.push(inArray(items.itemType, filter.itemType));
      } else {
        conditions.push(eq(items.itemType, filter.itemType));
      }
    }
    
    if (filter.title) {
      conditions.push(like(items.title, `%${filter.title}%`));
    }
    
    if (filter.deleted !== undefined) {
      conditions.push(eq(items.deleted, filter.deleted));
    }
    
    // 查询总数
    const total = this.db.select({ count: count() })
      .from(items)
      .where(and(...conditions))
      .get()?.count ?? 0;
    
    // 查询数据
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;
    
    const rows = this.db.select()
      .from(items)
      .where(and(...conditions))
      .orderBy(desc(items.updatedAt))
      .limit(limit)
      .offset(offset)
      .all();
    
    return {
      items: rows.map(row => this.parseRow(row)),
      total,
    };
  }
  
  /**
   * 查找自指定版本以来修改的 items
   */
  findModifiedSince(libraryId: number, sinceVersion: number): Item[] {
    const rows = this.db.select()
      .from(items)
      .where(and(
        eq(items.libraryId, libraryId),
        gt(items.version, sinceVersion),
        eq(items.deleted, false)
      ))
      .orderBy(asc(items.updatedAt))
      .all();
    
    return rows.map(row => this.parseRow(row));
  }
  
  /**
   * 按作者查询（JSON 字段）
   */
  findByCreator(libraryId: number, creatorName: string): Item[] {
    const rows = this.db.select()
      .from(items)
      .where(and(
        eq(items.libraryId, libraryId),
        like(items.creators, `%"lastName":"${creatorName}"%`)
      ))
      .all();
    
    return rows.map(row => this.parseRow(row));
  }
  
  /**
   * 按标签查询（通过 itemTags 表）
   */
  findByTag(libraryId: number, tag: string): Item[] {
    const rows = this.db.select({ item: items })
      .from(items)
      .innerJoin(itemTags, eq(items.key, itemTags.itemKey))
      .where(and(
        eq(itemTags.libraryId, libraryId),
        eq(itemTags.tag, tag)
      ))
      .all();
    
    return rows.map(row => this.parseRow(row.item));
  }
  
  private parseRow(row: typeof items.$inferSelect): Item {
    return {
      ...row,
      creators: JSON.parse(row.creators),
      collectionKeys: JSON.parse(row.collectionKeys),
      tags: JSON.parse(row.tags),
      extra: JSON.parse(row.extra),
    };
  }
}
```

---

## 七、CLI 实现

### 7.1 命令结构

```typescript
// apps/cli/src/commands/sync.ts

export const syncCommand = {
  name: 'sync',
  description: 'Synchronize Zotero library',
  options: [
    {
      name: 'library',
      alias: 'l',
      description: 'Library ID to sync',
      type: 'number',
    },
    {
      name: 'full',
      alias: 'f',
      description: 'Full sync (ignore version)',
      type: 'boolean',
      default: false,
    },
  ],
  run: async (options: SyncOptions) => {
    const config = loadConfig();
    const apiClient = new ZoteroAPIClient({ apiKey: config.apiKey });
    const db = openDatabase(config.databasePath);
    
    const syncManager = new SyncManager(apiClient, db, config.sync);
    
    console.log('Starting sync...');
    const result = await syncManager.sync(options);
    
    if (result.success) {
      console.log(`Sync complete: ${result.updated} updated, ${result.deleted} deleted`);
    } else {
      console.error('Sync failed:', result.errors);
      process.exit(1);
    }
  },
};
```

### 7.2 命令列表

| 命令 | 说明 |
|------|------|
| `zotero sync` | 同步库 |
| `zotero list` | 列出 items |
| `zotero search <query>` | 搜索 |
| `zotero get <key>` | 获取单个 item |
| `zotero add` | 添加 item |
| `zotero update <key>` | 更新 item |
| `zotero delete <key>` | 删除 item |
| `zotero tags` | 列出所有标签 |

---

## 八、Coding Agent 指导

### 8.1 代码风格

```typescript
// ✅ 正确: 显式返回类型
function calculateVersion(data: ItemData): number {
  return data.version;
}

// ✅ 正确: 使用 readonly
interface Config {
  readonly apiKey: string;
  readonly baseURL: string;
}

// ✅ 正确: 使用类型守卫
function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

// ✅ 正确: 使用 Result 类型
type Result<T, E = Error> = 
  | { success: true; data: T }
  | { success: false; error: E };
```

### 8.2 模块组织

```typescript
// index.ts - 只导出公共 API
export { SyncManager } from './manager';
export type { SyncOptions, SyncResult } from './types';

// 内部实现放在单独文件
// manager.ts
import { Repository } from '../database';  // 内部依赖
```

### 8.3 实现提示

1. **数据库操作**
   - 始终使用事务处理批量操作
   - 使用 prepared statements 提高性能
   - 在查询中使用索引

2. **API 调用**
   - 所有网络请求都要处理超时
   - 使用限流器控制请求频率
   - 批量请求限制在 50 个对象

3. **同步逻辑**
   - 每次同步前检查 API key 权限
   - 保存 pristine 数据用于冲突解决
   - 使用指数退避处理重试

### 8.4 常见陷阱

| 陷阱 | 解决方案 |
|------|---------|
| 版本号不连续 | 版本号是单调递增但不是连续的，不要假设连续性 |
| 对象键 | 使用 Zotero 返回的键，不要自己生成 |
| 时区 | 所有时间戳使用 ISO 8601 格式 |
| 并发 | 始终考虑并发更新场景 |
| 内存 | 大库同步时使用流式处理，不要一次性加载 |

---

## 九、实施计划

### Phase 1: 基础架构 (2周)

- [ ] 初始化 Monorepo 结构
- [ ] 配置 TypeScript + ESLint + Prettier
- [ ] 设置 Turborepo
- [ ] 实现数据库 schema (Drizzle)
- [ ] 实现基础 API 客户端
- [ ] 实现基础 Repository
- [ ] 实现单向下载同步

### Phase 2: 双向同步 (2周)

- [ ] 实现上传功能
- [ ] 实现冲突检测
- [ ] 实现基础冲突解决
- [ ] 同步状态机
- [ ] 删除同步
- [ ] 错误处理和重试

### Phase 3: CLI 工具 (1周)

- [ ] sync 命令
- [ ] list 命令
- [ ] search 命令
- [ ] get/add/update/delete 命令

### Phase 4: 高级功能 (2周)

- [ ] 增量同步优化
- [ ] 大库性能优化
- [ ] 手动冲突解决
- [ ] 群组库支持

### Phase 5: 测试发布 (1周)

- [ ] 单元测试
- [ ] 集成测试
- [ ] API 文档
- [ ] 发布到 npm

---

## 十、附录

### 10.1 Zotero API 关键端点

```
GET  /keys/current                  - 验证 API key
GET  /users/{id}/groups            - 获取群组
GET  /{library}/items?since={v}&format=versions
GET  /{library}/items?itemKey=k1,k2
GET  /{library}/deleted?since={v}
POST /{library}/items              - 创建/更新
DELETE /{library}/items?itemKey=k1,k2
```

### 10.2 重要响应头

```
Last-Modified-Version: {version}
Zotero-API-Version: 3
```

### 10.3 重要请求头

```
Zotero-API-Key: {api_key}
If-Modified-Since-Version: {version}
If-Unmodified-Since-Version: {version}
```

---

**文档结束**

本设计文档旨在为 Coding Agent 提供清晰、可操作的指导。Agent 应按照实施计划逐步实现各个模块，确保代码质量和功能完整性。
