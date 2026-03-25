# Zotero-Headless API 化设计

## 目标
- 将 CLI 核心逻辑提取为可编程 API
- 支持 Agent 友好的结构化输出
- 保持 CLI 向后兼容
- 预留 Agent 扩展接口

## 架构设计

```
apps/
  cli/              # 现有 CLI（人类界面）
    src/
      index.ts      # 命令行入口

  agent-api/        # 程序化 API（Agent 界面）  ← 已实现
    src/
      index.ts      # 统一导出
      types.ts      # 共享类型定义
      items.ts      # 文献管理 API
      sync.ts       # 同步 API
      config.ts     # 配置 API
```

## API 设计原则

### 1. 纯函数式接口
```typescript
// ✅ Agent 友好
const result = await searchItems({ query: "AI", limit: 10 });
// result: { items: [...], total: 100 }

// ❌ 阻塞式交互
const result = await searchItems("AI"); // 可能弹出选择框
```

### 2. 显式策略参数
```typescript
// Agent 可以程序化决策
await syncItems({ 
  conflictStrategy: 'keep-local' // 或 'keep-remote', 'merge', 'ask'
});

// CLI 人类版本可以用 'ask' 启动交互式提示
```

### 3. 结构化错误
```typescript
try {
  await deleteItem('INVALID-KEY');
} catch (e) {
  // Agent 可解析的错误
  console.log(e.code);     // 'ITEM_NOT_FOUND'
  console.log(e.itemKey);  // 'INVALID-KEY'
  console.log(e.suggestion); // 'Did you mean: ABCD1234?'
}
```

## 类型定义

```typescript
// types.ts
export interface Item {
  key: string;
  version: number;
  itemType: string;
  title?: string;
  creators?: Creator[];
  // ... 其他字段
}

export interface SearchResult {
  items: Item[];
  total: number;
  query: string;
  facets?: Facet[];  // 用于 Agent 进一步过滤
}

export interface Conflict {
  itemKey: string;
  field: string;
  localValue: any;
  remoteValue: any;
  mergedValue?: any;
}

export interface SyncOptions {
  libraryId?: string;
  conflictStrategy?: 'keep-local' | 'keep-remote' | 'merge' | 'ask';
  dryRun?: boolean;
  onProgress?: (progress: SyncProgress) => void;
}

export interface SyncProgress {
  phase: 'download' | 'upload' | 'resolve';
  current: number;
  total: number;
  currentItem?: string;
}
```

## API 列表

### 文献管理（已实现）
```typescript
export function listItems(options: ListOptions): Promise<Item[]>          // ✅ 已实现
export function searchItems(query: string, options?: SearchOptions): Promise<SearchResult>  // ✅ 已实现
export function getItem(key: string): Promise<Item | null>                // ✅ 已实现
export function getItemOrThrow(key: string): Promise<Item>                // ✅ 已实现
export function deleteItem(key: string, options?: DeleteOptions): Promise<void>  // ✅ 已实现
export function batchDelete(keys: string[], options?: BatchOptions): Promise<BatchResult>  // ✅ 已实现
export function restoreItem(key: string): Promise<void>                   // ✅ 已实现
export function getAnnotations(key: string): Promise<Annotation[]>        // ✅ 已实现
```

### 同步（已实现）
```typescript
export function sync(options?: SyncOptions): Promise<SyncResult>          // ✅ 已实现
export function getSyncStatus(): Promise<SyncStatus>                      // ✅ 已实现
export function getConflicts(): Promise<Conflict[]>                       // ✅ 已实现
export function resolveConflict(conflict: Conflict, strategy: ConflictStrategy): Promise<void>  // ✅ 已实现
export function resolveAllConflicts(strategy: ConflictStrategy): Promise<void>  // ✅ 已实现
```

### 配置（已实现）
```typescript
export function getConfig(): Promise<Config>                              // ✅ 已实现
export function setConfig(key: string, value: any): Promise<void>         // ✅ 已实现
export function validateApiKey(key: string): Promise<boolean>             // ✅ 已实现
export function initConfig(): Promise<void>                               // ✅ 已实现
```

### 未实现（计划中）
```typescript
// 文献创建与更新
export function createItem(data: Partial<Item>): Promise<Item>            // 🔲 计划中
export function updateItem(key: string, data: Partial<Item>): Promise<Item>  // 🔲 计划中
export function trashItem(key: string): Promise<void>                     // 🔲 计划中

// 智能搜索（带语义理解）
export function semanticSearch(query: string): Promise<SearchResult>      // 🔲 计划中

// 导出格式化
export function exportItems(keys: string[], format: 'json' | 'bibtex' | 'csv'): Promise<string>  // 🔲 计划中

// 观察模式（适合 Agent 持续监听）
export function watchChanges(callback: (change: ChangeEvent) => void): () => void  // 🔲 计划中
```

## 实现计划

1. ✅ **提取核心逻辑** - 已将核心逻辑提取到 `apps/agent-api/`
2. ✅ **定义类型** - 已创建 `types.ts` 共享类型定义
3. ✅ **实现 API 层** - 已实现 items/sync/config 三个模块
4. 🔲 **重构 CLI** - 让 CLI 调用 API 层（当前 CLI 仍为独立实现）
5. 🔲 **添加测试** - 确保 API 和 CLI 行为一致
6. 🔲 **Agent 示例** - 提供 Agent 使用示例

## 向后兼容

CLI 保持现有接口不变：
```bash
zotero ls
zotero search "AI"
zotero sync
```

但内部实现改为：
```typescript
// cli/src/commands/list.ts
import { listItems } from '@zotero-headless/api';

export async function listCommand(args: string[]) {
  const items = await listItems(parseOptions(args));
  console.table(items); // CLI 负责格式化输出
}
```
