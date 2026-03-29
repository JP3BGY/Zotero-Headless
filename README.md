# Zotero-Headless

Zotero Web API 同步客户端（CLI + 交互式 Shell），可在无桌面客户端环境下管理文献库。

> 适用于服务器、容器、WSL、远程开发机等场景。

## 主要功能

- **双向同步** — 本地 SQLite 与 Zotero 云端增量同步，支持交互式冲突解决
- **标识符导入** — 通过 DOI / ISBN / PMID / arXiv / ADS / URL / 微信文章自动创建条目
- **格式互转** — 基于 Zotero Translator 框架，支持 BibTeX、RIS、CSL JSON 等 700+ 格式导入导出
- **附件管理** — WebDAV 附件同步、PDF 全文查找、重复附件检测
- **引用生成** — 基于 CSL 的引用格式化（APA、Vancouver、Harvard 等）
- **重复检测** — 多阶段匹配算法（ISBN → DOI → 标题+作者归一化）
- **笔记管理** — Markdown 输入，ProseMirror HTML 存储，兼容 Zotero 桌面
- **交互式 Shell** — 命令补全、历史记录、状态栏、Item Key 模糊匹配
- **群组库** — 列出并同步 Group Library
- **中英文界面** — `--lang=zh|en`
- **Agent API** — 程序化接口，供 AI Agent 调用（`apps/agent-api`）

---

## 快速开始

```bash
# 安装与构建
pnpm install && pnpm build

# 配置（二选一）
cp .env.example .env                          # 编辑填入 API Key 和 User ID
# 或
mkdir -p ~/.config/zotero-headless && cat > ~/.config/zotero-headless/.env <<EOF
ZOTERO_API_KEY=your-api-key
ZOTERO_USER_ID=1234567
EOF

# 验证与同步
zotero verify
zotero sync

# 启动交互式 Shell
zotero shell
```

> API Key 在 [Zotero Settings > Keys](https://www.zotero.org/settings/keys) 创建。

---

## 常用命令

```bash
# 同步
zotero sync                                # 增量同步
zotero sync -f                             # 完整同步
zotero sync -i                             # 交互式冲突解决

# 浏览
zotero ls                                  # 列出文献
zotero ls -t book -d "论文/2024"           # 按类型+集合过滤
zotero ls --tree                           # 树形视图（含笔记、附件层级）
zotero get ABCD1234                        # 查看详情

# 搜索
zotero grep "machine learning"             # 全文搜索
zotero grep "张" -f author                 # 按字段搜索

# 添加
zotero add byid "10.1038/nature23477"      # DOI / ISBN / arXiv / PMID
zotero add journalArticle "标题" "作者"     # 手动添加
zotero import refs.bib -c "my-collection"  # 从 BibTeX/RIS 导入

# 更新 / 删除
zotero update ABCD1234 title "新标题"      # 修改字段
zotero update byid ABCD1234                # 通过标识符补全缺失字段
zotero rm ABCD1234                         # 移至回收站

# 集合与标签
zotero mv ABCD1234 "论文/子集合"           # 移动条目到集合
zotero tags --add ABCD1234 tag1 tag2       # 添加标签

# 笔记
zotero note add ABCD1234 "支持 **Markdown**"
zotero note edit NOTE5678                  # 外部编辑器

# 附件
zotero webdav config https://dav.example.com/dav user pass
zotero webdav sync                         # 同步附件
zotero attachment find --all               # 全文 PDF 查找

# 导出与引用
zotero export -f bibtex -o library.bib
zotero cite -i ABCD1234 -s apa            # CSL 引用

# 其他
zotero duplicates                          # 重复检测
zotero annotations ABCD1234               # 查看 PDF 批注
zotero trash                               # 回收站
zotero stats                               # 库统计
```

完整命令参考见 [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md)。

---

## 项目结构

```
zotero-headless/
├── apps/
│   ├── cli/                # CLI 命令行入口
│   ├── shell/              # 交互式 Shell TUI (Ink + React)
│   └── agent-api/          # 程序化 API（供 AI Agent 使用）
├── packages/
│   ├── api/                # Zotero Web API 客户端
│   ├── core/               # 核心配置与工具
│   ├── database/           # SQLite 数据库层 (Drizzle ORM)
│   ├── sync-engine/        # 双向同步引擎
│   ├── attachment-manager/ # 附件管理
│   ├── translator/         # Zotero Translator 框架（格式转换与导入）
│   ├── webdav-client/      # WebDAV 客户端
│   └── types/              # TypeScript 类型定义
├── scripts/                # 构建与打包脚本
└── docs/                   # 文档
```

---

## 开发

```bash
pnpm build          # TypeScript 编译（所有包）
pnpm typecheck      # 类型检查
pnpm test           # 运行测试
pnpm lint           # 代码检查
pnpm bundle         # 用 tsup 打包 CLI 和 Shell
pnpm package        # 构建 npm 发布包（.tgz）
```

**构建系统**：pnpm workspace + Turborepo 编排。CLI 和 Shell 通过 [tsup](https://tsup.egoist.dev/)（基于 esbuild）打包为单文件。

---

## 文档

| 文档 | 说明 |
|------|------|
| [`USER_GUIDE.md`](docs/USER_GUIDE.md) | 用户指南（完整命令参考） |
| [`INSTALL.md`](docs/INSTALL.md) | 安装部署 |
| [`DOCKER.md`](docs/DOCKER.md) | Docker 部署 |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 架构设计 |
| [`API-DESIGN.md`](docs/API-DESIGN.md) | Agent API 设计 |
| [`ARCHITECTURE_DECISIONS.md`](docs/ARCHITECTURE_DECISIONS.md) | 架构决策记录 |
| [`ZOTERO_API_FIELDS.md`](docs/ZOTERO_API_FIELDS.md) | API 字段映射 |

---

## License

MIT
