# Zotero-Headless

Zotero Web API 同步客户端（CLI + 交互式 Shell），可在无桌面客户端环境下管理文献库。

> 适用于服务器、容器、WSL、远程开发机等场景。

## 主要能力

- 🔄 **双向同步**：本地 SQLite 与 Zotero 云端增量同步
- ⚔️ **冲突处理**：支持交互式冲突解决（`sync --interactive`）
- 👥 **群组库支持**：列出并同步 Group Library
- 📎 **附件管理**：本地附件、WebDAV 同步、下载、去重
- 📝 **笔记管理**：Markdown 输入/输出，支持外部编辑器
- 🧠 **标识符导入**：通过 DOI / ISBN / PMID / arXiv / 微信文章 URL 导入
- 🌍 **中英文界面**：`--lang=zh|en`
- 🖥️ **交互式 Shell**：命令补全、历史、Item Key 补全
- 🤖 **Agent API**：提供给上层 Agent 的程序化接口（`apps/agent-api`）

---

## 快速开始

### 1) 安装依赖

```bash
pnpm install
```

### 2) 配置环境变量

复制并编辑 `.env`：

```bash
cp .env.example .env
```

最少需要：

```env
ZOTERO_API_KEY=your_api_key_here
ZOTERO_USER_ID=your_user_id_here
```

### 3) 构建

```bash
pnpm build
```

### 4) 首次验证与同步

```bash
# 验证 API 凭证
pnpm --filter @zotero-headless/cli exec zotero verify

# 执行同步
pnpm --filter @zotero-headless/cli exec zotero sync
```

### 5) 启动交互式 Shell

```bash
pnpm --filter @zotero-headless/cli exec zotero shell
```

---

## 常用命令

> 以 `zotero` 为入口（构建后可通过 CLI 包执行）。

### 同步与状态

```bash
zotero sync
zotero sync --full-sync
zotero sync --interactive
zotero sync --groups
zotero sync --group=12345
zotero verify
zotero stats
```

### 文献管理

```bash
zotero list
zotero ls -t book
zotero search "machine learning"
zotero get ABCD1234
zotero add journalArticle "Title" "Author"
zotero add-by-id "10.1038/nature23477"
zotero update ABCD1234 title "New Title"
zotero delete ABCD1234
```

### 笔记与附件

```bash
zotero note add ABCD1234 "这是笔记"
zotero note edit NOTE5678
zotero note show NOTE5678
zotero note list ABCD1234

zotero attachments
zotero attachment-download XYZ789
zotero attachment-open XYZ789
zotero attachment-dedup --delete
```

### WebDAV

```bash
zotero webdav:config https://dav.example.com user pass
zotero webdav:status
zotero webdav:sync
zotero webdav:scan
```

### 交互式 Shell

```bash
zotero shell
zotero shell --lang=en
```

---

## 项目结构（基于当前源码）

```text
zotero-headless/
├── apps/
│   ├── cli/           # 主 CLI（命令定义与执行）
│   ├── shell/         # Ink + React 交互式 Shell
│   ├── agent-api/     # 给 Agent/自动化调用的 API
│   └── cli-bundle/    # CLI 打包脚本
├── packages/
│   ├── api/               # Zotero Web API 客户端
│   ├── core/              # 配置、历史等核心模块
│   ├── database/          # SQLite/Drizzle 数据层
│   ├── sync-engine/       # 同步引擎
│   ├── attachment-manager/# 附件管理
│   ├── webdav-client/     # WebDAV 客户端
│   └── types/             # 共享类型定义
├── docs/                  # 用户与开发文档
└── completions/           # Shell 补全脚本
```

---

## 开发命令

```bash
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

---

## 文档导航

- 用户指南：[`docs/USER_GUIDE.md`](docs/USER_GUIDE.md)
- 安装部署：[`docs/INSTALL.md`](docs/INSTALL.md)
- Docker：[`docs/DOCKER.md`](docs/DOCKER.md)
- 架构设计：[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- 架构决策：[`docs/ARCHITECTURE_DECISIONS.md`](docs/ARCHITECTURE_DECISIONS.md)
- API 字段映射：[`docs/ZOTERO_API_FIELDS.md`](docs/ZOTERO_API_FIELDS.md)

---

## 备注

- 当前仓库为 monorepo（workspace: `apps/*`, `packages/*`）。
- CLI 命令较多，建议通过 `zotero help` / `zotero help <command>` 查看实时参数。
- 若用于生产环境，建议将 `.env` 放在受控路径并设置严格权限。

## License

MIT
