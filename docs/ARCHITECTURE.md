# Zotero-Headless 架构设计

**状态**: 已实施并验证  
**最后更新**: 2026-02-20

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                     Interface Layer                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │    CLI      │  │    Shell    │  │   WebDAV Client     │  │
│  │  (命令行)   │  │ (交互式)    │  │   (文件同步)        │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
└─────────┼────────────────┼────────────────────┼─────────────┘
          │                │                    │
          └────────────────┴────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                      Core Layer                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Sync Engine │  │  Conflict   │  │  State Machine      │  │
│  │             │  │  Resolver   │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │
        ┌──────────────────┴──────────────────┐
        │                                     │
┌───────▼────────┐                   ┌──────▼────────┐
│  Zotero API    │                   │   Database    │
│  Client        │                   │   Layer       │
└────────────────┘                   └───────────────┘
```

## 关键决策记录

### 决策 1: 使用 SQLite 作为本地缓存

**状态**: ✅ 已实施  
**日期**: 2026-02-15  
**背景**: 需要本地离线访问和快速查询

**选择**: SQLite + Drizzle ORM

**理由**:
- 零配置、单文件存储
- 完整的 SQL 支持
- Drizzle 提供类型安全
- 适合无头环境部署

**替代方案**: JSON 文件、LevelDB（放弃原因：查询能力弱）

### 决策 2: 简化数据库 Schema

**状态**: ✅ 已实施  
**日期**: 2026-02-15  
**背景**: Zotero 原始 schema 过于复杂，包含 50+ 表

**决策**: 只保留 4 个核心表

```
libraries    - 库信息
items        - 文献条目（json 字段存储可变属性）
collections  - 集合/文件夹
creators     - 作者信息（单独表因为多对多关系）
```

**理由**:
- 80/20 原则：20% 的字段满足 80% 的使用场景
- 降低维护复杂度
- 提高查询性能

**权衡**: 放弃复杂字段（relations, tags 单独表等）

### 决策 3: 同步策略 - 版本号优先

**状态**: ✅ 已实施  
**日期**: 2026-02-15  
**背景**: 需要处理本地与远程的冲突

**决策**: 三向合并算法

1. 比较本地版本号 vs 远程版本号
2. 如果本地版本号 < 远程：远程有更新
3. 如果本地版本号 > 远程：本地有未同步修改
4. 如果都有更新：标记为冲突

**代码位置**: `packages/sync-engine/src/manager.ts`

### 决策 4: WebDAV 文件结构兼容 Zotero Desktop

**状态**: ✅ 已实施  
**日期**: 2026-02-18  
**背景**: 需要与 Zotero Desktop 的 WebDAV 同步兼容

**决策**: 严格遵循 Zotero Desktop 的 WebDAV 结构

```
/zotero/
  ├── <item_key>.zip       # 附件 ZIP 包
  └── <item_key>.prop      # XML 格式的属性文件
```

**关键细节**:
- 所有文件必须 ZIP 压缩（即使是 PDF）
- .prop 文件使用 XML 格式（非 INI）
- MD5 是 ZIP 文件的 MD5（非原始文件）

**教训**: 最初自行设计了错误结构，后发现必须参考 Zotero Desktop 实际代码

### 决策 5: 并行下载优化

**状态**: ✅ 已实施  
**日期**: 2026-02-18  
**背景**: 大库同步时串行下载太慢

**决策**: 使用 Promise.all 实现并发下载

```typescript
const concurrency = this.config.concurrency ?? 5;
for (let j = 0; j < apiItems.length; j += concurrency) {
  const chunk = apiItems.slice(j, j + concurrency);
  await Promise.all(chunk.map(async (apiItem) => {
    // Process in parallel
  }));
}
```

**默认并发数**: 5（平衡速度和 API 限流）

### 决策 6: i18n 国际化实现

**状态**: ✅ 已实施  
**日期**: 2026-02-18  
**背景**: 需要支持中英文切换

**决策**: 简单的翻译函数 + 对象存储

```typescript
// i18n.ts
const translations = { en: {...}, zh: {...} };
export function t(key: string, ...args: any[]): string {
  // 支持参数插值
}
```

**语言检测优先级**:
1. CLI 参数 `--lang`
2. 环境变量 `LANG`
3. 默认中文

### 决策 7: Shell 交互模式架构

**状态**: ✅ 已实施  
**日期**: 2026-02-20  
**背景**: 需要更友好的交互式体验

**决策**: 独立的 Shell 模块，与 CLI 通过模块导入集成

**架构设计**:
```
CLI (spawn) → Shell Process (独立 TUI)
                ↓
           import CLI commands
                ↓
         direct function calls
```

**关键点**:
- Shell 作为独立进程启动（需要接管终端）
- Shell 通过模块导入直接调用 CLI 命令（非 spawn）
- 使用 Ink（React for Terminal）构建 TUI
- 劫持 console.log 捕获命令输出

**布局策略**:
- 欢迎消息/快捷键提示固定在顶部
- 输出历史区域可滚动
- 输入行固定位置
- 补全列表固定 3 行显示在最底部

**补全实现**:
- 命令补全：直接匹配 CLI commands 数组
- Item Key 补全：查询本地 SQLite 缓存（60s TTL）
- 模糊匹配：前缀匹配 + 限制显示数量

## 技术栈

| 层级 | 技术 | 理由 |
|------|------|------|
| 语言 | TypeScript | 类型安全 |
| ORM | Drizzle | 轻量、类型安全 |
| 数据库 | SQLite | 零配置、单文件 |
| CLI | Commander.js | 成熟、功能完善 |
| TUI | Ink + React | 声明式终端 UI |
| HTTP | Axios | 稳定、拦截器支持 |
| 测试 | Vitest | 快速、ESM 支持 |
| 构建编排 | Turborepo | 增量构建、依赖感知 |
| 打包 | tsup (esbuild) | 零配置、极速打包 |

## 代码约定

### 代码注释原则

**只写"为什么"，不写"是什么"**:

```typescript
// ✅ 好的注释 - 解释决策原因
// 使用秒级时间戳因为 Zotero API 返回的是秒级
const timestamp = Math.floor(Date.now() / 1000);

// ❌ 差的注释 - 只是重复代码
// 获取当前时间戳
const timestamp = Math.floor(Date.now() / 1000);
```

### 目录结构约定

- `apps/` - 可执行应用（cli、shell、agent-api）
- `packages/` - 可复用库（api、core、database、sync-engine 等）
- `scripts/` - 构建与打包脚本
- `docs/` - 文档（只有规范和指南，无临时文件）
- `tsconfig.base.json` - 所有包共享的 TypeScript 基础配置
- 每个包独立管理依赖，tsconfig 通过 `extends` 继承基础配置

## 性能考虑

### 数据库优化
- 在 `items.libraryId` 和 `items.key` 上创建复合索引
- 使用 `LIMIT` 分页查询

### 同步优化
- 批量处理（默认 50 条/批）
- 并行下载（默认 5 并发）
- 增量同步（基于版本号）

### 内存优化
- 使用生成器处理大结果集
- 避免加载整个库到内存

## 构建与打包系统

### 构建流程

```
pnpm build     →  Turborepo 按依赖顺序 tsc 编译所有包
pnpm bundle    →  tsup 打包 CLI 和 Shell 为单文件
pnpm package   →  收集 bundle 产物 + 生成 package.json → .tgz
```

### tsconfig 继承

所有包的 `tsconfig.json` 通过 `extends: "../../tsconfig.base.json"` 继承共享配置，只覆盖 `outDir`、`rootDir` 等包级选项。

### tsup 打包

用 [tsup](https://tsup.egoist.dev/)（基于 esbuild）将 monorepo 代码打包为可分发的单文件：

| 应用 | 入口 | 产物 | 格式 | 说明 |
|------|------|------|------|------|
| CLI | `apps/cli/src/index.ts` | `apps/cli/bundle/zotero.cjs` | CJS | 内联所有 `@zotero-headless/*`，外置 `better-sqlite3`/`sql.js` |
| Shell | `apps/shell/src/index.tsx` | `apps/shell/bundle/shell.mjs` | ESM | 内联所有 `@zotero-headless/*`，外置 ink/react/native 模块 |

配置文件为各自目录下的 `tsup.config.ts`。

### Turborepo 任务

| 任务 | 依赖 | 产物 |
|------|------|------|
| `build` | `^build`（先构建依赖包） | `dist/**` |
| `bundle` | `build` | `bundle/**` |
| `typecheck` | `^build` | — |
| `test` | `build` | — |

### 打包脚本

`scripts/package-for-npm.js` 负责：
1. 运行 `turbo bundle`
2. 将 CLI 和 Shell 的 bundle 产物复制到 `dist-package/`
3. 从 workspace 各 `package.json` 提取外部依赖版本（不硬编码）
4. 生成发布用 `package.json`（含 `bin` 入口）
5. 打包为 `.tgz`

## 扩展点

### 添加新的标识符类型

参考 `packages/identifier/` 包，实现：
1. `IdentifierParser` 添加正则匹配
2. 实现对应的 `Fetcher` 类
3. 添加到服务路由

### 添加新的导出格式

参考 `export` 命令，实现：
1. 转换器函数
2. 添加到 CLI 命令

## 已知限制

1. **简化 Schema** - 不支持 Zotero 的所有字段类型
2. **单向附件同步** - WebDAV 只支持上传，不支持下载
3. **无实时同步** - 需要手动触发同步命令

## 相关文档

- [USER_GUIDE.md](USER_GUIDE.md) - 使用指南
- [ZOTERO_API_FIELDS.md](ZOTERO_API_FIELDS.md) - API 字段映射
- [IMPORTANT-WORK-PRINCIPLES.md](IMPORTANT-WORK-PRINCIPLES.md) - 开发原则
