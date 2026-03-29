# Zotero-Headless 用户指南

> Zotero Web API 同步客户端 — 在无头环境中管理文献库

## 目录

1. [简介](#简介)
2. [安装与配置](#安装与配置)
3. [快速开始](#快速开始)
4. [命令参考](#命令参考)
5. [交互式 Shell](#交互式-shell)
6. [故障排除](#故障排除)
7. [高级用法](#高级用法)
8. [常见问题](#常见问题)

---

## 简介

**Zotero-Headless** 是一个 CLI 工具，可在服务器、Docker 容器、WSL 等无头环境中通过 Zotero Web API 管理文献库，无需运行桌面客户端。

**主要功能**：双向增量同步、WebDAV 附件管理、DOI/ISBN/arXiv 等标识符导入、BibTeX/RIS/CSL 等 700+ 格式互转、PDF 全文查找、CSL 引用生成、重复检测与合并、Markdown 笔记编辑、交互式 Shell、中英文界面。

---

## 安装与配置

### 前置要求

- Node.js >= 18.0.0
- pnpm
- Zotero 账户 + API Key

### 获取 API Key

1. 访问 [Zotero Settings > Keys](https://www.zotero.org/settings/keys)
2. 点击 "Create new key"，勾选所需库权限
3. 复制生成的密钥（只显示一次）

### 安装

```bash
git clone https://github.com/altairwei/Zotero-Headless.git
cd Zotero-Headless
pnpm install
pnpm run build
```

### 配置

创建 `~/.config/zotero-headless/.env`：

```env
ZOTERO_API_KEY=your-api-key-here
ZOTERO_USER_ID=1234567
```

```bash
chmod 600 ~/.config/zotero-headless/.env
```

`.env` 文件加载优先级（后找到的优先）：

1. `ZOTERO_ENV_PATH` 环境变量指定的路径
2. 当前工作目录下的 `.env`
3. 可执行文件所在目录的 `.env`
4. `~/.config/zotero-headless/.env`（推荐）
5. `~/.zotero-headless.env`

验证配置：

```bash
zotero verify
```

### 用户偏好 (~/.zoterrc)

通过 YAML 文件配置用户偏好：

```bash
zotero config --init    # 创建默认配置文件
zotero config --show    # 查看当前配置
```

```yaml
editor: vim                     # 笔记编辑器
language: zh                    # 界面语言 (zh/en)
sync:
  autoSync: false               # 启动时自动同步
  syncInterval: 30              # 自动同步间隔（分钟）
display:
  defaultLimit: 20              # 列表默认显示条数
  showAttachments: true         # 显示附件数量
download:
  defaultDir: ~/Downloads/zotero
```

---

## 快速开始

```bash
# 首次同步
zotero sync

# 查看文献列表
zotero ls                              # 列出文献
zotero ls -t book                      # 按类型过滤
zotero ls --tree                       # 树形视图（含笔记、附件层级）

# 搜索
zotero grep "machine learning"         # 全文搜索
zotero grep "张" -f author             # 按作者搜索

# 添加文献
zotero add byid "10.1038/nature23477"  # 通过 DOI 添加
zotero add journalArticle "标题" "作者" # 手动添加

# 更新 / 删除
zotero update ABCD1234 title "新标题"  # 修改字段
zotero enrich ABCD1234                 # 通过 DOI/ISBN 补全缺失字段
zotero rm ABCD1234                     # 移至回收站

# 导入 / 导出
zotero import refs.bib -c "my-collection"  # 从 BibTeX 导入
zotero export -f bibtex -o library.bib     # 导出为 BibTeX

# 附件
zotero webdav config https://dav.example.com/dav user pass
zotero webdav sync                     # 同步附件
zotero attachment find --all           # 自动查找全文 PDF

# 笔记
zotero note add ABCD1234 "笔记内容，支持 **Markdown**"
zotero note edit NOTE5678              # 用外部编辑器编辑

# 统计
zotero stats
```

---

## 命令参考

### 全局选项

| 选项 | 说明 |
|------|------|
| `--lang=en\|zh` | 设置界面语言（默认中文） |
| `--help` | 显示帮助信息 |
| `--version` | 显示版本号 |

### 同步

| 命令 | 别名 | 说明 |
|------|------|------|
| `sync` | `s`, `pull`, `fetch` | 双向同步 |
| `sync --full-sync` | `-f` | 完整同步（忽略版本号） |
| `sync --groups` | `-g` | 同步所有群组库 |
| `sync --group=<ID>` | `-G` | 同步指定群组 |
| `sync --quiet` | `-q` | 静默模式 |
| `sync --interactive` | `-i` | 交互式冲突解决 |
| `sync upload` | `su` | 仅上传本地修改 |

### 浏览与搜索

| 命令 | 别名 | 说明 |
|------|------|------|
| `list` | `ls`, `ll`, `la` | 列出文献 |
| `list --type <type>` | `-t` | 按类型过滤 |
| `list --dir <path\|key>` | `-d` | 按集合过滤 |
| `list --tree` | `-T` | 树形视图（父子层级） |
| `list --annotations` | `-A` | 树形视图中包含批注 |
| `list --all` | `-a` | 包含子条目（笔记、附件） |
| `list --unsynced` | `-u` | 仅未同步项 |
| `list --deleted` | `-D` | 仅已删除项 |
| `list --since <date>` | `-s` | 指定日期后修改的项 |
| `list --sort <field>` | | 排序（title\|date\|updated\|type） |
| `list --limit <N>` | `-l` | 限制数量 |
| `list --page <N>` | `-p` | 分页（1-based） |
| `list --compact` | `-c` | 紧凑输出 |
| `list unsynced` | `lsu` | 列出未同步文献 |
| `get <key>` | `show`, `cat`, `view` | 查看条目详情 |
| `search <query>` | `find`, `grep`, `f` | 搜索文献 |
| `search --field <field>` | `-f` | 搜索字段（title\|author\|tags\|note\|all） |
| `stats` | `st`, `info`, `df` | 库统计信息 |
| `tree` | `tr` | 树形显示集合层级 |
| `tree --root <path\|key>` | `-r` | 从指定集合开始 |
| `tree --depth <N>` | `-d` | 限制显示深度 |
| `tree --items` | `-i` | 显示每个集合的条目数 |

### 添加与导入

| 命令 | 别名 | 说明 |
|------|------|------|
| `add <type> <title> [authors...]` | `a`, `new`, `touch`, `create` | 手动添加文献 |
| `add byid <identifier>` | `add-by-id`, `addby` | 通过标识符添加（见下方） |
| `add byid <id> -a <file>` | | 添加时附带附件 |
| `import <file>` | `imp`, `in` | 从文件导入 |
| `import --collection <key\|path>` | `-c` | 导入到指定集合 |
| `import --tag <tag>` | `-t` | 为导入条目打标签（可重复） |
| `import --skip-duplicates` | | 跳过已有 DOI/ISBN 的条目 |
| `import --dry-run` | `-n` | 预览导入内容 |

**`add byid` 支持的标识符**：

| 类型 | 示例 |
|------|------|
| DOI | `10.1038/nature23477` 或 `https://doi.org/...` |
| arXiv | `1706.03762` 或 `https://arxiv.org/abs/...` |
| ISBN | `978-0-13-110362-7`（10 位或 13 位） |
| PMID | `27626369` 或 `https://pubmed.ncbi.nlm.nih.gov/...` |
| ADS | `2019ApJ...883..149A` |
| URL | 任意网页（通过 Zotero Translator 解析） |
| 微信 | `https://mp.weixin.qq.com/s/...`（自动生成快照） |

支持逗号或换行分隔批量添加。`import` 支持 BibTeX、RIS、CSL JSON、Zotero RDF 等 700+ 格式。

### 更新与删除

| 命令 | 别名 | 说明 |
|------|------|------|
| `update <key> <field> <value>` | `u`, `edit`, `set`, `mod` | 更新字段（仅本地） |
| `update byid <key>` | `enrich`, `updateby` | 通过 DOI/ISBN 补全缺失字段 |
| `update byid --all` | | 批量补全所有条目 |
| `update byid --dry-run` | `-n` | 预览将补全的字段 |
| `update byid --overwrite` | | 覆盖已有字段 |
| `delete <key>` | `rm`, `del`, `d` | 移至回收站 |
| `delete --force` | `-f` | 永久删除（仅 Shell 模式） |
| `delete --dry-run` | `-n` | 预览删除 |

> `update` 和 `delete` 仅修改本地数据库，需运行 `sync` 同步到远程。

### 回收站

| 命令 | 别名 | 说明 |
|------|------|------|
| `trash` | `trash:list` | 列出回收站中的条目 |
| `trash restore <key>` | `undelete`, `untrash` | 恢复条目 |
| `trash restore --all` | | 恢复所有条目 |
| `trash empty` | `trash:clear`, `empty-trash` | 清空回收站 |
| `trash empty --dry-run` | `-n` | 预览将永久删除的内容 |

### 集合与标签

| 命令 | 别名 | 说明 |
|------|------|------|
| `collections --list` | `col`, `folder` | 列出所有集合 |
| `collections --create <name>` | `-c` | 创建新集合 |
| `collections --parent <key>` | `-p` | 指定父集合 |
| `collections --add-item <col> <item>` | | 添加条目到集合 |
| `collections --remove-item <col> <item>` | | 从集合移除条目 |
| `collections --delete <key>` | `-d` | 删除集合 |
| `mv <item> <collection>` | `move` | 移动条目到集合 |
| `mv <col> <parent-col>` | | 调整集合层级 |
| `mv <item> /` | | 从所有集合移除 |
| `mv --add` | `-a` | 添加到集合（保留现有） |
| `tags --list` | `tag`, `t` | 列出所有标签 |
| `tags --add <key> <tags...>` | | 为条目添加标签 |
| `tags --remove <key> <tags...>` | | 移除条目标签 |
| `tags --item <key>` | `-i` | 查看条目的标签 |
| `tags --delete <tag>` | `-d` | 从库中删除标签 |

### 笔记

| 命令 | 说明 |
|------|------|
| `note add <parent-key> [content]` | 为条目添加笔记（支持 Markdown） |
| `note edit <note-key> [content]` | 编辑笔记；不指定内容则打开 `$EDITOR` |
| `note show <note-key>` | 查看笔记（Markdown 格式输出） |
| `note list <parent-key>` | 列出条目的所有笔记 |

笔记以 ProseMirror 兼容 HTML 存储，与 Zotero 桌面客户端完全兼容。输入时使用 Markdown，系统自动转换。

别名：`n`, `notes`

### 批注

| 命令 | 别名 | 说明 |
|------|------|------|
| `annotations <key>` | `annot`, `highlights`, `hl` | 查看 PDF 批注 |
| `annotations --color <color>` | `-c` | 按颜色过滤 |
| `annotations --type <type>` | `-t` | 按类型过滤（highlight/note/image/underline） |
| `annotations --format <fmt>` | `-f` | 输出格式（text/json/markdown） |

### 附件

| 命令 | 别名 | 说明 |
|------|------|------|
| `attachment list` | `att`, `files`, `docs` | 列出附件 |
| `attachment list --item <key>` | | 列出指定条目的附件 |
| `attachment download <key>` | `attdl`, `down` | 从 WebDAV 下载 |
| `attachment open <key>` | `atto` | 用系统默认程序打开 |
| `attachment dedup` | `attdedup` | 检测重复附件 |
| `attachment dedup --delete` | `-d` | 删除重复（保留首个） |
| `attachment find <key>` | `findpdf` | 查找全文 PDF |
| `attachment find --all` | `-a` | 为所有缺少 PDF 的条目查找 |
| `attachment find --methods <list>` | `-m` | 查找方式（doi,oa,url,custom） |
| `attachment find --dry-run` | `-n` | 预览模式 |

### WebDAV

| 命令 | 别名 | 说明 |
|------|------|------|
| `webdav config <url> <user> <pass>` | `wdc` | 配置 WebDAV 服务器 |
| `webdav sync` | `wds` | 同步附件 |
| `webdav sync --download` | `-d` | 仅下载 |
| `webdav sync --upload` | `-u` | 仅上传 |
| `webdav sync --repair` | `-r` | 修复缺失的 .prop 文件 |
| `webdav status` | `wdst` | 查看连接状态 |
| `webdav scan` | `wdscan` | 扫描远程附件 |

附件目录固定为 `/zotero`（与 Zotero 桌面客户端一致）。

配置示例：
```bash
# 坚果云
zotero webdav config https://dav.jianguoyun.com/dav/zotero user pass

# NextCloud
zotero webdav config https://cloud.example.com/remote.php/dav/files/user/zotero user pass
```

### 导出与引用

| 命令 | 别名 | 说明 |
|------|------|------|
| `export` | `e`, `out`, `save` | 导出文献 |
| `export --format <fmt>` | `-f` | 格式（bibtex/ris/csv/json） |
| `export --output <path>` | `-o` | 输出到文件 |
| `cite` | `citation`, `bib` | 生成引用（基于 CSL） |
| `cite --item <key>` | `-i` | 指定条目 |
| `cite --style <style>` | `-s` | 引用风格（apa/vancouver/harvard） |
| `cite --format <fmt>` | `-f` | 输出格式（text/html/bibtex） |
| `cite --lang <locale>` | | 语言（en-US/zh-CN） |

### 批量操作

| 命令 | 别名 | 说明 |
|------|------|------|
| `batch --tag <keys...> <tags...>` | `bulk` | 批量添加标签 |
| `batch --untag <keys...> <tags...>` | | 批量移除标签 |
| `batch --add-to-collection <col> <keys...>` | | 批量添加到集合 |
| `batch --remove-from-collection <col> <keys...>` | | 批量从集合移除 |
| `batch --delete <keys...>` | `-d` | 批量移至回收站 |
| `batch --export <fmt> <path> <keys...>` | | 批量导出 |

### 作者管理

| 命令 | 别名 | 说明 |
|------|------|------|
| `creators --list <key>` | `author`, `authors` | 列出条目的作者 |
| `creators --add <key> <first> <last> [type]` | | 添加作者 |
| `creators --remove <key> <index>` | | 按索引删除作者 |
| `creators --set-primary <key> <index>` | | 设置主要作者 |

### 重复检测

使用多阶段匹配算法（ISBN → DOI → 标题+作者归一化）。

| 命令 | 别名 | 说明 |
|------|------|------|
| `duplicates` | `dupes`, `find-duplicates` | 检测重复条目 |
| `duplicates --merge <N>` | `-m` | 合并指定分组（保留最旧） |
| `duplicates --delete` | `-d` | 合并后删除重复 |
| `duplicates --dry-run` | `-n` | 预览模式 |

### 关联条目

| 命令 | 别名 | 说明 |
|------|------|------|
| `related --list <key>` | `rel` | 列出关联条目 |
| `related --add <key> <related-key>` | | 添加关联 |
| `related --remove <key> <related-key>` | | 移除关联 |

### 保存的搜索

| 命令 | 别名 | 说明 |
|------|------|------|
| `searches --list` | `saved-searches` | 列出保存的搜索 |
| `searches --run <key>` | `-r` | 运行保存的搜索 |
| `searches --delete <key>` | `-d` | 删除保存的搜索 |

### 群组库

| 命令 | 别名 | 说明 |
|------|------|------|
| `groups` | `g`, `team`, `org` | 列出所有群组 |
| `groups --sync <id>` | `-s` | 同步指定群组 |

### 工具

| 命令 | 别名 | 说明 |
|------|------|------|
| `verify` | `v`, `check`, `ping` | 验证 API Key |
| `config` | `cfg`, `conf` | 管理配置 |
| `config --init` | | 创建默认配置文件 |
| `config --show` | | 显示当前配置 |
| `config --get <key>` | `-g` | 获取配置值 |
| `config --set <key=value>` | `-s` | 设置配置值 |
| `config --list` | `-l` | 列出所有配置 |
| `history` | `hist`, `recent` | 查看命令历史 |
| `history --clear` | `-c` | 清除历史 |
| `help` | `h`, `?` | 显示帮助 |
| `shell` | `sh`, `repl`, `i` | 启动交互式 Shell |

### 别名速查表

熟悉 Unix 命令的用户可以直接使用这些别名：

```bash
zotero s              # sync
zotero ls             # list
zotero ll             # list (详细)
zotero cat <key>      # get
zotero grep <word>    # search
zotero rm <key>       # delete
zotero mv <k> <col>   # move
zotero a <type>       # add
zotero u <key>        # update
zotero e              # export
zotero n              # note
zotero st             # stats
zotero v              # verify
zotero tr             # tree
zotero col            # collections
zotero hl <key>       # annotations
zotero bib            # cite
zotero imp <file>     # import
zotero dupes          # duplicates
zotero findpdf <key>  # attachment find
```

---

## 交互式 Shell

Shell 模式提供 REPL 交互体验，支持命令补全、历史记录、状态栏等。

```bash
zotero shell              # 启动 Shell
zotero shell --lang=en    # 英文界面
```

| 特性 | 说明 |
|------|------|
| 命令补全 | Tab 键补全命令名和 Item Key（模糊匹配，60s 缓存） |
| 历史记录 | ↑/↓ 浏览，跨会话持久化 |
| 状态栏 | 底部显示 User ID、数据库状态、库/条目数量、最近同步时间 |
| 欢迎界面 | 启动时显示版本和快捷键提示 |
| 实时输出 | Spinner 动画 + 计时显示 |
| 配置面板 | 交互式配置管理 |
| 永久删除 | 仅 Shell 模式下允许 `--force` / `--permanent` |
| 快捷键 | 通过 `~/.zoterrc` 自定义绑定 |

| 快捷键 | 功能 |
|--------|------|
| `Tab` | 自动补全 |
| `↑` / `↓` | 浏览历史 |
| `Ctrl+C` ×2 | 退出 Shell（单击取消当前操作） |
| `PageUp` / `PageDown` | 滚动输出历史 |

---

## 故障排除

| 错误 | 原因 | 解决 |
|------|------|------|
| Configuration error: Invalid input | 未找到 API Key | 创建 `~/.config/zotero-headless/.env` 并填入 `ZOTERO_API_KEY` 和 `ZOTERO_USER_ID` |
| No library found | 未执行过同步 | `zotero sync` |
| Conflict detected | 本地与远程同时修改 | `zotero sync --interactive` 或 `zotero sync --full-sync` |
| Rate limit exceeded | 请求过频 | 系统自动重试，等待即可 |
| SQLite database locked | 另一进程占用 | 关闭其他使用该数据库的程序 |

```bash
# 调试模式
DEBUG=zotero:* zotero sync

# 重置数据库（下次同步重新下载）
rm ~/.config/zotero-headless/data/zotero.sqlite
zotero sync
```

---

## 高级用法

### Docker 部署

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY . .
RUN npm install && npm run build
ENV ZOTERO_API_KEY=your-key
ENV ZOTERO_USER_ID=1234567
CMD ["zotero", "sync"]
```

### 定时同步

```bash
# crontab -e
0 3 * * * /usr/local/bin/zotero sync >> /var/log/zotero.log 2>&1
```

### Bash 补全

```bash
# 临时启用
source completions/zotero-completion.bash

# 永久启用
sudo cp completions/zotero-completion.bash /etc/bash_completion.d/
```

### 项目结构

```
Zotero-Headless/
├── apps/
│   ├── cli/                # CLI 命令行入口
│   ├── shell/              # 交互式 Shell TUI (Ink + React)
│   └── agent-api/          # 程序化 API（供 AI Agent 使用）
├── packages/
│   ├── api/                # Zotero Web API 客户端
│   ├── core/               # 核心配置与工具
│   ├── database/           # SQLite 数据库层 (Drizzle ORM)
│   ├── sync-engine/        # 双向同步引擎
│   ├── attachment-manager/  # 附件管理
│   ├── translator/         # Zotero Translator 框架（格式转换与导入）
│   ├── webdav-client/      # WebDAV 客户端
│   └── types/              # TypeScript 类型定义
├── scripts/                # 构建与打包脚本
└── docs/                   # 文档
```

### 运行测试

```bash
pnpm test
pnpm run test:watch
pnpm test --filter @zotero-headless/sync-engine
```

---

## 常见问题

**Q: 与 Zotero 桌面客户端会冲突吗？**
不会。Zotero-Headless 通过 Web API 操作，与桌面客户端互不干扰，可同时使用。

**Q: 支持哪些库类型？**
个人库和群组库均支持，群组库需要 API Key 具有对应权限。

**Q: 大量文献（>10000 条）怎么办？**
系统自动分批处理（每批 50 条，5 并发），无需额外配置。

**Q: 数据存储在哪？**
默认在 `~/.config/zotero-headless/data/zotero.sqlite`（SQLite）。

**Q: WebDAV 支持哪些服务？**
坚果云、NextCloud/ownCloud，以及任何标准 WebDAV 服务。

**Q: 如何切换语言？**
`zotero --lang=en sync` 或设置环境变量 `export LANG=en_US.UTF-8`。

---

*最后更新：2026-03-29*
