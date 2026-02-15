# Zotero-Headless

Zotero-Headless 是一个基于 Node.js + TypeScript 的 Zotero Web API 同步客户端，无需 Zotero 桌面客户端即可实现完整的文献库同步、管理和离线访问。

## 快速开始

### 设计文档

**⚠️ 在开始编写代码之前，请务必先阅读设计文档：**

📄 **[Zotero-Headless-Complete-Design.md](./Zotero-Headless-Complete-Design.md)**

这份文档包含了项目的完整设计指导，专门为 Coding Agent 编写，确保项目能够顺利实施。

### 设计文档包含：

- 项目概述和架构
- 技术选型和项目结构
- 数据库设计（Drizzle ORM + 简化 schema）
- Zotero API 客户端实现
- 同步引擎设计
- Repository 实现
- CLI 命令设计
- Coding Agent 指导（代码风格、实现提示、常见陷阱）
- 5 阶段实施计划

## 项目结构

```
zotero-headless/
├── apps/
│   └── cli/                    # CLI 应用
├── packages/
│   ├── types/                  # 共享类型
│   ├── api/                    # Zotero API 客户端
│   ├── database/               # 数据库层
│   └── sync-engine/            # 同步引擎
├── Zotero-Headless-Complete-Design.md  # ⚠️ 必读设计文档
└── README.md
```

## 开始开发

1. **首先阅读设计文档** - 了解项目的架构和技术决策
2. **按照实施计划开发** - 参考设计文档中的 Phase 1-5
3. **遵循代码风格** - 参考设计文档中的 Agent 指导章节

## 相关文档

- [Zotero Web API v3 文档](https://www.zotero.org/support/dev/web_api/v3/start)
- [Zotero 同步协议](https://www.zotero.org/support/dev/web_api/v3/syncing)
