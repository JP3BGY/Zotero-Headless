# 设计决策记录 (Design Decisions)

本文档用于创建 GitHub Issues 记录项目关键设计决策。

---

## Issue #1: SQLite 作为本地缓存存储

**标题**: [Design] 使用 SQLite + Drizzle ORM 作为本地缓存

**标签**: `design-decision`, `architecture`, `database`

**内容**:

```markdown
## 决策

使用 SQLite 作为 Zotero-Headless 的本地缓存存储，配合 Drizzle ORM 进行数据库操作。

## 背景

需要一种方式在无头环境中本地存储和快速查询 Zotero 文献库。

## 考虑的选项

1. **SQLite** ✅ 已选择
   - 零配置、单文件存储
   - 完整的 SQL 查询能力
   - 适合无头环境部署

2. **JSON 文件** ❌ 放弃
   - 查询性能差
   - 大数据量时内存占用高
   - 无索引支持

3. **LevelDB** ❌ 放弃
   - 查询能力弱（仅 key-value）
   - 需要额外适配层

## 实施细节

- 使用 Drizzle ORM 提供类型安全
- 数据库路径可配置（默认：`~/.config/zotero-headless/data/zotero.sqlite`）
- 使用 WAL 模式提高并发性能

## 后果

✅ 优点:
- 零配置部署
- 单文件便于备份和迁移
- SQL 查询灵活

⚠️ 限制:
- 不适合多进程并发写入
- 大数据量时需要定期优化（VACUUM）

## 相关代码

- `packages/database/src/schema.ts` - Schema 定义
- `packages/database/src/connection.ts` - 连接管理

## 决策日期

2026-02-15
```

---

## Issue #2: 简化数据库 Schema

**标题**: [Design] 简化数据库 Schema - 从 50+ 表到 4 个核心表

**标签**: `design-decision`, `database`, `schema`

**内容**:

```markdown
## 决策

将 Zotero 原始的 50+ 表 schema 简化为 4 个核心表。

## 背景

Zotero 原始 schema 极其复杂，包含：
- items 主表
- itemData 扩展属性表
- itemTags 标签关联表
- itemAttachments 附件关联表
- itemNotes 笔记关联表
- creators 作者表
- collections 集合表
- ... 等等

维护完整的 schema 成本过高。

## 简化后的 Schema

```sql
libraries    - 库信息（id, type, name, version）
items        - 文献条目（json 字段存储可变属性）
collections  - 集合/文件夹
creators     - 作者信息（单独表因为多对多关系）
```

## 80/20 分析

- 保留的字段满足 80% 的使用场景
- 放弃复杂字段（relations, tags 单独表等）
- rawJson 字段保留原始数据，便于调试

## 后果

✅ 优点:
- 大幅降低维护复杂度
- 查询性能提升
- 代码更简洁

⚠️ 限制:
- 不支持某些高级 Zotero 功能
- 部分字段查询需要 JSON 提取

## 决策日期

2026-02-15
```

---

## Issue #3: 同步冲突解决策略

**标题**: [Design] 三向合并算法处理同步冲突

**标签**: `design-decision`, `sync`, `conflict-resolution`

**内容**:

```markdown
## 决策

使用版本号比较的三向合并算法处理同步冲突。

## 算法逻辑

1. 比较本地版本号 vs 远程版本号
2. 如果本地版本号 < 远程：远程有更新 → 下载
3. 如果本地版本号 > 远程：本地有未同步修改 → 上传
4. 如果都有更新：标记为冲突

## 冲突处理选项

- **自动策略** (`--conflict-strategy`):
  - `local` - 优先使用本地版本
  - `remote` - 优先使用远程版本

- **交互模式** (`--interactive`):
  - 逐条提示用户选择
  - 支持批量选择（所有剩余使用本地/远程）

## 代码实现

`packages/sync-engine/src/manager.ts`:

```typescript
if (localVersion === remoteVersion) {
  // 无变化
} else if (localVersion < remoteVersion) {
  // 远程有更新
} else if (localVersion > remoteVersion) {
  // 本地有修改
} else {
  // 冲突
}
```

## 后果

✅ 优点:
- 算法简单可靠
- 易于理解和调试

⚠️ 限制:
- 无法自动合并同一字段的修改
- 需要用户介入解决冲突

## 决策日期

2026-02-15
```

---

## Issue #4: WebDAV 兼容性设计

**标题**: [Design] WebDAV 文件结构严格兼容 Zotero Desktop

**标签**: `design-decision`, `webdav`, `attachment`

**内容**:

```markdown
## 决策

WebDAV 文件结构必须与 Zotero Desktop 100% 兼容。

## 文件结构

```
/zotero/
  ├── <item_key>.zip       # 附件 ZIP 包
  └── <item_key>.prop      # XML 格式的属性文件
```

## 关键规范

1. **所有文件必须 ZIP 压缩**（即使是 PDF）
2. **.prop 文件使用 XML 格式**（非 INI）
3. **MD5 是 ZIP 文件的 MD5**（非原始文件）
4. **路径固定在 `/zotero/`**（非可配置）

## XML .prop 格式

```xml
<properties version="1">
  <mtime>1234567890000</mtime>
  <hash>abc123...</hash>
</properties>
```

## 教训

最初自行设计了错误结构：
- ❌ `/storage/<itemKey>/<filename>`
- ❌ INI 格式的 .prop 文件
- ❌ 原始文件的 MD5

后发现必须参考 Zotero Desktop 实际代码才修正。

## 相关代码

- `packages/webdav-client/src/client.ts`
- `packages/attachment-manager/src/manager.ts`

## 决策日期

2026-02-18
```

---

## Issue #5: 并行下载优化

**标题**: [Design] Promise.all 实现并行下载加速大库同步

**标签**: `design-decision`, `performance`, `sync`

**内容**:

```markdown
## 决策

使用 Promise.all 实现并发下载，默认并发数为 5。

## 实现

```typescript
const concurrency = this.config.concurrency ?? 5;
for (let j = 0; j < apiItems.length; j += concurrency) {
  const chunk = apiItems.slice(j, j + concurrency);
  await Promise.all(chunk.map(async (apiItem) => {
    // Process in parallel
  }));
}
```

## 配置

- 默认并发数: 5
- 可配置范围: 1-10
- 配置项: `SyncConfig.concurrency`

## 为什么选择 5？

- Zotero API 限速 35 次/分钟
- 5 并发可以在限速内最大化吞吐量
- 平衡速度和 API 友好性

## 性能提升

实测 1000 个项目的库：
- 串行下载: ~5 分钟
- 5 并发下载: ~1.5 分钟
- 提升约 3 倍

## 相关代码

`packages/sync-engine/src/manager.ts`:
- `downloadItemsParallel()`
- `sync()` 方法中的并发控制

## 决策日期

2026-02-18
```

---

## Issue #6: i18n 国际化实现

**标题**: [Design] 简单翻译函数实现 CLI 多语言支持

**标签**: `design-decision`, `i18n`, `cli`

**内容**:

```markdown
## 决策

使用简单的翻译函数 + 对象存储实现国际化，支持英文和中文。

## 实现

```typescript
// i18n.ts
const translations = { en: {...}, zh: {...} };

export function t(key: string, ...args: any[]): string {
  const value = getNestedValue(translations[currentLang], key);
  return typeof value === 'function' ? value(...args) : value;
}
```

## 语言检测优先级

1. CLI 参数 `--lang=en|zh`
2. 环境变量 `LANG`
3. 默认中文

## 为什么不使用 i18next？

- 项目规模小，不需要完整 i18n 框架
- 减少依赖
- 简单函数足够使用

## 使用示例

```typescript
// 简单翻译
t('commands.sync.starting')
// → "🔄 开始双向同步..." (zh)

// 带参数
t('commands.sync.stats', 10, 2)
// → "📊 同步统计：更新 10 个，错误 2 个" (zh)
```

## 相关代码

- `apps/cli/src/i18n.ts`
- `apps/cli/src/index.ts` (语言切换逻辑)

## 决策日期

2026-02-18
```

---

## 如何创建这些 Issues

1. 访问 GitHub 仓库
2. 点击 "Issues" → "New issue"
3. 使用上述标题和内容创建 Issue
4. 添加相应标签
5. 创建后可在 PR 中引用：`Fixes #1`
