# Zotero-Headless

Zotero Web API 同步客户端 - 无需桌面客户端即可实现文献库同步

## 快速开始

```bash
# 安装
pnpm install

# 配置
cp .env.example .env
# 编辑 .env，填入 ZOTERO_API_KEY 和 ZOTERO_USER_ID

# 构建
pnpm build

# 首次同步
pnpm start sync

# 启动交互式 shell（推荐日常使用）
pnpm start shell
```

## 常用命令

```bash
# 交互式 Shell（带命令补全）
zotero shell

# 同步
zotero sync

# 列出文献
zotero list

# 搜索
zotero search "关键词"

# 添加文献
zotero add-by-id "10.1038/nature23477"
```

## 文档导航

| 文档 | 说明 | 目标读者 |
|------|------|----------|
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | 用户指南、命令参考、功能详解 | 👤 使用者 |
| [docs/INSTALL.md](docs/INSTALL.md) | 安装指南（npm/Docker/GitHub Actions）| 👤 使用者 |
| [docs/DOCKER.md](docs/DOCKER.md) | Docker 部署指南 | 👤 使用者 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 架构设计 | 👨‍💻 开发者 |
| [docs/ARCHITECTURE_DECISIONS.md](docs/ARCHITECTURE_DECISIONS.md) | 架构决策记录 | 👨‍💻 开发者 |
| [docs/ZOTERO_API_FIELDS.md](docs/ZOTERO_API_FIELDS.md) | API 字段映射 | 👨‍💻 开发者 |
| [docs/IMPORTANT-WORK-PRINCIPLES.md](docs/IMPORTANT-WORK-PRINCIPLES.md) | 开发工作原则 | 🤝 贡献者 |
| [docs/GITHUB_ISSUES_TEMPLATE.md](docs/GITHUB_ISSUES_TEMPLATE.md) | Issue 模板 | 🤝 贡献者 |

## 项目结构

```
zotero-headless/
├── apps/
│   ├── cli/              # CLI 入口
│   └── shell/            # 交互式 Shell (REPL)
├── packages/
│   ├── api/              # Zotero API 客户端
│   ├── core/             # 核心配置
│   ├── database/         # SQLite 数据库
│   ├── sync-engine/      # 同步引擎
│   ├── attachment-manager/  # 附件管理
│   └── webdav-client/    # WebDAV 客户端
└── docs/                 # 文档
```

## 核心功能

- **双向同步** - 本地 SQLite 与 Zotero 云端自动同步
- **交互式 Shell** - REPL 模式，支持命令补全和历史记录
- **群组库支持** - 同步 Zotero Groups
- **附件同步** - WebDAV 文件同步
- **多语言** - 中英文界面切换
- **增量同步** - 只同步变化的部分

## 相关链接

- [Zotero Web API v3 文档](https://www.zotero.org/support/dev/web_api/v3/start)
- [Zotero 同步协议](https://www.zotero.org/support/dev/web_api/v3/syncing)

## License

MIT
