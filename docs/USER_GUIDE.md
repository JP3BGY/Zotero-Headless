# Zotero-Headless 用户指南

> Zotero Web API 同步客户端 - 无需桌面客户端即可实现文献库同步

## 目录

1. [简介](#简介)
2. [功能特性](#功能特性)
3. [安装指南](#安装指南)
4. [快速开始](#快速开始)
5. [配置说明](#配置说明)
6. [命令参考](#命令参考)
7. [笔记功能](#笔记功能)
8. [故障排除](#故障排除)
9. [高级用法](#高级用法)

---

## 简介

**Zotero-Headless** 是一个 Node.js CLI 工具，让你可以在**无头环境**（服务器、Docker容器、WSL等）中直接与 Zotero 云端同步文献库，无需运行 Zotero 桌面客户端。

### 适用场景

- 📡 **服务器同步**：在 VPS/服务器上定期自动同步文献
- 🐳 **Docker 部署**：容器化部署到任意平台
- 💻 **WSL/Linux**：在 Linux 子系统使用 Zotero
- 🔄 **双向同步**：本地修改与云端自动合并
- ⚡ **快速访问**：无需启动桌面客户端即可查询文献
- 🌐 **多语言支持**：中英文界面切换
- 📎 **附件同步**：WebDAV 文件同步支持

---

## 功能特性

| 功能 | 状态 | 说明 |
|------|------|------|
| 双向同步 | ✅ | 自动检测并合并本地/远程变化 |
| 并行下载 | ✅ | 支持 5 个并发连接加速同步 |
| 冲突解决 | ✅ | 交互式/自动模式处理编辑冲突 |
| 智能重试 | ✅ | 指数退避处理网络错误和限流 |
| 本地缓存 | ✅ | SQLite 数据库存储 |
| CLI 命令 | ✅ | 列表、搜索、统计、过滤等 |
| 增量同步 | ✅ | 只同步自上次以来的变化 |
| **文献添加** | ✅ | 通过 DOI/arXiv/ISBN/PMID 自动获取元数据 |
| **群组库** | ✅ | 支持同步 Zotero Groups |
| **WebDAV** | ✅ | 附件文件同步到 WebDAV |
| **笔记功能** | ✅ | Markdown 编辑、外部编辑器支持 |
| **配置文件** | ✅ | `~/.zoterrc` 用户偏好设置 |
| **历史记录** | ✅ | 追踪最近使用的条目和命令 |
| **自动补全** | ✅ | bash/zsh 命令补全支持 |
| **i18n** | ✅ | 中英文界面切换 |

---

## 安装指南

### 前置要求

- **Node.js** >= 18.0.0
- **npm** 或 **pnpm**
- Zotero 账户 + API Key

### 步骤 1：获取 Zotero API Key

1. 登录 [Zotero](https://www.zotero.org/settings/keys)
2. 点击 **"Create new key"**
3. 设置密钥描述（如 "Zotero-Headless"）
4. 勾选需要访问的库（通常勾选整个库）
5. 点击 **Save**
6. **复制生成的密钥**（格式：`xxxxx-xxxxx-xxxxx`）

> ⚠️ 密钥只会显示一次，请妥善保存！

### 步骤 2：克隆并安装

```bash
# 克隆仓库
git clone https://github.com/altairwei/Zotero-Headless.git
cd Zotero-Headless

# 安装 pnpm (如果未安装)
npm install -g pnpm

# 安装依赖
pnpm install

# 构建项目
pnpm run build
```

### 步骤 3：配置环境变量

创建配置文件：

```bash
# 创建配置目录
mkdir -p ~/.config/zotero-headless

# 创建 .env 文件
cat > ~/.config/zotero-headless/.env << 'EOF'
# Zotero API Key (从步骤1获取)
ZOTERO_API_KEY=your-api-key-here

# Zotero 用户ID (数字格式)
ZOTERO_USER_ID=1234567

# 可选：自定义数据库路径
# DATABASE_PATH=/custom/path/to/zotero.sqlite
EOF

# 设置权限（保护 API Key）
chmod 600 ~/.config/zotero-headless/.env
```

填入你的凭证后保存。

### 快速验证

```bash
# 验证 API Key
pnpm run start -- verify

# 或使用构建后的 CLI
node dist/index.js verify
```

---

## 快速开始

### 1. 首次同步

```bash
zotero sync
```

输出示例：

```
🔄 开始双向同步...

🔑 验证 API key...
   登录用户: your-username
📊 版本 - 本地: 0, 远程: 100
✅ 同步完成：更新 50 个，删除 0 个
```

### 2. 查看文献列表 (list / ls / ll)

```bash
zotero list              # 完整命令
zotero ls                # 短别名
zotero ll                # 详细列表（类似 ls -l）
zotero ls -t book        # 只显示书籍
zotero ls -u             # 显示未同步项
```

### 3. 搜索文献 (search / find / grep / f)

```bash
zotero search "machine learning"    # 完整命令
zotero find "machine learning"      # 别名
zotero grep "machine learning"      # 类似 Unix grep
zotero f "machine learning"         # 最短形式
zotero grep "张" -f author          # 按作者搜索
```

### 4. 查看统计 (stats / st / info / df)

```bash
zotero stats             # 完整命令
zotero st                # 短别名
zotero info              # 类似 Unix info
zotero df                # 类似 Unix df（磁盘使用情况）
```

### 5. 添加文献 (add / a / new / touch)

```bash
zotero add journalArticle "论文标题" "作者名"      # 完整命令
zotero a journalArticle "论文标题" "作者名"        # 短别名
zotero new journalArticle "论文标题"               # 类似 Unix 风格
zotero touch journalArticle "论文标题"             # 类似 Unix touch
zotero add-by-id "10.1038/nature23477"            # 通过标识符添加
```

### 6. 更新文献 (update / u / edit / set)

```bash
zotero update ABCD1234 title "新标题"     # 完整命令
zotero u ABCD1234 title "新标题"          # 短别名
zotero edit ABCD1234 title "新标题"       # 类似 Unix 风格
zotero set ABCD1234 title "新标题"        # 类似设置变量
```

### 7. 删除文献 (delete / rm / del / d / trash)

```bash
zotero delete ABCD1234              # 移至回收站（完整命令）
zotero rm ABCD1234                  # Unix 风格删除
zotero rm ABCD1234 -f               # 强制永久删除（类似 rm -f）
zotero rm ABCD1234 -p               # --permanent 短形式
zotero del ABCD1234                 # del 别名
zotero trash ABCD1234               # trash 别名
```

### 8. 附件同步 (WebDAV)

```bash
zotero webdav:config https://dav.example.com/dav user pass
zotero webdav:sync
```

---

## 配置说明

### 语言设置

```bash
# 使用中文（默认）
zotero sync

# 使用英文
zotero --lang=en sync

# 通过环境变量
export LANG=en_US.UTF-8
zotero sync
```

### 配置文件加载优先级

Zotero-Headless 会按以下优先级加载 `.env` 文件（后面的覆盖前面的）：

```
1. ZOTERO_ENV_PATH 环境变量指定的路径
2. 当前工作目录下的 .env
3. 可执行文件所在目录的 .env
4. ~/.config/zotero-headless/.env  （推荐）
5. ~/.zotero-headless.env
```

**最佳实践**：将配置放在 `~/.config/zotero-headless/.env`，这样无论在哪里运行命令都能正确加载。

### ⚠️ 故障排除

**问题**：运行 `zotero` 命令时提示 "Configuration error: expected string, received undefined"

**原因**：全局安装后，CLI 无法找到 .env 配置文件

**解决方案**：

1. **检查配置文件是否存在**：
   ```bash
   ls -la ~/.config/zotero-headless/.env
   ```

2. **如果是符号链接且指向旧路径**（项目移动后常见）：
   ```bash
   # 删除旧链接
   rm -f ~/.config/zotero-headless/.env
   
   # 创建新链接（指向当前项目位置）
   ln -s /home/altairwei/.openclaw/workspace/zotero-headless/.env ~/.config/zotero-headless/.env
   ```

3. **或者直接复制配置文件**：
   ```bash
   cp /home/altairwei/.openclaw/workspace/zotero-headless/.env ~/.config/zotero-headless/.env
   ```

### 配置示例

创建 `~/.config/zotero-headless/.env`：

```env
# Zotero API Key (从 https://www.zotero.org/settings/keys 获取)
ZOTERO_API_KEY=your-api-key-here

# Zotero 用户ID (数字格式)
ZOTERO_USER_ID=1234567

# 可选：数据库路径
# 默认：~/.config/zotero-headless/data/zotero.sqlite
# DATABASE_PATH=/custom/path/to/zotero.sqlite

# 可选：日志级别 (debug, info, warn, error)
LOG_LEVEL=info
```

### 数据库路径配置

| 配置方式 | 示例 | 效果 |
|---------|------|------|
| **默认**（推荐） | 不设置 `DATABASE_PATH` | `~/.config/zotero-headless/data/zotero.sqlite` |
| **绝对路径** | `DATABASE_PATH=/data/zotero.db` | 直接使用该路径 |
| **相对路径** | `DATABASE_PATH=./data/db.sqlite` | 相对于当前工作目录 |

> 💡 **提示**：使用默认路径，数据库会自动存放在配置目录下，便于管理和备份。

---

## 用户配置文件 (~/.zoterrc)

Zotero-Headless 支持通过 `~/.zoterrc` 文件配置用户偏好设置。

### 初始化配置文件

```bash
# 创建默认配置文件
zotero config --init

# 查看当前配置
zotero config --show
```

### 配置示例

编辑 `~/.zoterrc`：

```yaml
# 默认编辑器（用于 note edit）
editor: vim

# 默认语言
language: zh

# 同步设置
sync:
  autoSync: false       # 启动时自动同步
  syncInterval: 30      # 自动同步间隔（分钟）

# 显示设置
display:
  defaultLimit: 20      # 列表默认显示数量
  showAttachments: true # 显示附件数量

# 下载设置
download:
  defaultDir: ~/Downloads/zotero  # 附件下载目录

# 快捷方式
shortcuts:
  papers: "journalArticle tag:paper"
  unread: "itemType:book tag:unread"
```

### 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `editor` | string | `nano` | 外部编辑器（vim/nano/code等） |
| `language` | string | `zh` | 界面语言（zh/en） |
| `sync.autoSync` | boolean | `false` | 启动时自动同步 |
| `sync.syncInterval` | number | `30` | 自动同步间隔（分钟） |
| `display.defaultLimit` | number | `20` | 列表默认显示条目数 |
| `display.showAttachments` | boolean | `true` | 显示附件数量 |
| `download.defaultDir` | string | `~/.local/share/...` | 附件下载目录 |
| `shortcuts` | object | `{}` | 自定义快捷查询 |

---

## 历史记录功能

Zotero-Headless 自动追踪最近使用的条目和命令。

### 查看历史

```bash
# 显示最近 10 条历史
zotero history

# 显示最近 20 条历史
zotero history 20

# 显示别名
zotero hist
zotero recent
```

输出示例：
```
📜 Recent history (5):

  📄 [ABC123] (2024-01-15)
  📄 [DEF456] (2024-01-14)
  🔍 [machine learning] (2024-01-14)
  ⚡ [sync] (2024-01-13)
```

### 清除历史

```bash
zotero history --clear
```

历史记录存储在：`~/.local/share/zotero-headless/history.json`

---

## 自动补全

### Bash 补全

安装 bash 补全脚本：

```bash
# 方式 1：临时启用（当前会话）
source completions/zotero-completion.bash

# 方式 2：永久启用
# 将补全脚本复制到系统目录
sudo cp completions/zotero-completion.bash /etc/bash_completion.d/

# 或添加到 ~/.bashrc
echo 'source ~/.openclaw/workspace/zotero-headless/completions/zotero-completion.bash' >> ~/.bashrc
```

补全功能支持：
- 主命令补全（sync, list, search...）
- 子命令补全（note add/edit/show...）
- 选项补全（--type, --limit...）
- 历史记录中的条目 key 补全

### 使用示例

```bash
zotero <Tab><Tab>
# 显示所有可用命令

zotero note <Tab><Tab>
# 显示子命令：add, edit, show, list

zotero show <Tab><Tab>
# 从历史记录补全条目 key

zotero list -<Tab><Tab>
# 显示可用选项：--type, --limit, --unsynced...
```

---

## 命令参考

### 全局选项

| 选项 | 说明 |
|------|------|
| `--lang=en` | 设置语言为英文 |
| `--lang=zh` | 设置语言为中文（默认） |
| `--help`, `-h` | 显示帮助信息 |

### 同步命令

| 命令 | 别名 | 说明 |
|------|------|------|
| `zotero sync` | `s`, `pull`, `fetch`, `refresh` | 双向同步 |
| `zotero sync --full-sync` | `-f` | 完整同步（忽略版本号） |
| `zotero sync --groups` | `-g` | 同步所有群组库 |
| `zotero sync --group=ID` | `-G<ID>` | 同步指定群组 |
| `zotero sync --quiet` | `-q` | 静默模式（无进度条） |
| `zotero sync --interactive` | `-i` | 交互式冲突解决 |
| `zotero sync:upload` | `su` | 仅上传本地修改 |
| `zotero sync:download` | `sd` | 仅下载远程修改 |

### 群组库命令

| 命令 | 别名 | 说明 |
|------|------|------|
| `zotero groups` | `g`, `team`, `org` | 列出所有群组 |
| `zotero sync --groups` | `s -g` | 同步所有群组库 |
| `zotero sync --group=12345` | `s -G12345` | 同步指定群组 |

### 查看命令

| 命令 | 别名 | 说明 |
|------|------|------|
| `zotero list` | `ls`, `ll` | 列出文献（ll=详细） |
| `zotero list --limit 50` | `-l 50` | 限制显示数量 |
| `zotero list --type book` | `-t book` | 按类型过滤 |
| `zotero list --unsynced` | `-u` | 列出未同步项 |
| `zotero list --deleted` | `-d` | 列出已删除项 |
| `zotero list --since 2024-01-01` | `-s 2024-01-01` | 显示指定日期后修改的项 |
| `zotero list --sort title` | `-S title` | 按字段排序 |
| `zotero list --order desc` | `-o desc` | 降序排列 |
| `zotero list:unsynced` | `lsu` | 列出未同步文献 |
| `zotero get <key>` | `show`, `cat`, `view` | 查看单条文献详情 |
| `zotero stats` | `st`, `info`, `status`, `df` | 库统计信息 |
| `zotero attachments` | `att`, `files`, `docs` | 列出附件 |
| `zotero attachments --item ABCD1234` | | 查看指定项的附件 |

### 搜索命令

| 命令 | 别名 | 说明 |
|------|------|------|
| `zotero search <query>` | `find`, `grep`, `f` | 搜索标题 |
| `zotero search "词" --field author` | `-f author` | 按作者搜索 |
| `zotero search "词" --field tags` | `-f tags` | 按标签搜索 |
| `zotero search "词" --unsynced` | `-u` | 在未同步项中搜索 |
| `zotero search "词" --since 2024-01-01` | `-s 2024-01-01` | 搜索指定日期后的项 |

### 管理命令

| 命令 | 别名 | 说明 | 同步需求 |
|------|------|------|----------|
| `zotero add-by-id <id>` | `add` | 通过 DOI/arXiv/ISBN/PMID 添加 | 自动同步 |
| `zotero add <类型> <标题>` | `a`, `new`, `touch` | 手动添加新文献 | 自动同步 |
| `zotero update <key> <字段> <值>` | `u`, `edit`, `set` | 更新文献（仅本地） | 需运行 `sync` |
| `zotero delete <key>` | `rm`, `del`, `d`, `trash` | 删除/移至回收站 | 需运行 `sync` |
| `zotero delete <key> --permanent` | `rm -p` | 永久删除 | 需运行 `sync` |
| `zotero delete <key> --force` | `rm -f` | 强制删除（同 --permanent） | 需运行 `sync` |

### add-by-id 命令

通过学术标识符自动获取元数据：

```bash
# DOI
zotero add-by-id "10.1038/nature23477"
zotero add-by-id "https://doi.org/10.1038/nature23477"

# arXiv
zotero add-by-id "1706.03762"

# ISBN
zotero add-by-id "978-0-13-110362-7"

# PMID
zotero add-by-id "27626369"

# 批量添加
zotero add-by-id "10.1038/nature23477, 1706.03762"
```

**支持的标识符**：
- DOI: `10.1038/nature123` 或 `https://doi.org/...`
- arXiv: `1706.03762` 或 `https://arxiv.org/abs/...`
- ISBN: `978-0-13-110362-7`
- PMID: `27626369`

### WebDAV 附件同步

| 命令 | 说明 |
|------|------|
| `zotero webdav:config <url> <user> <pass>` | 配置 WebDAV 服务器 |
| `zotero webdav:sync` | 同步所有附件到 WebDAV |
| `zotero webdav:status` | 查看 WebDAV 配置状态 |
| `zotero webdav:scan` | 扫描 WebDAV 上的附件 |

**配置示例**：

```bash
# 坚果云
zotero webdav:config https://dav.jianguoyun.com/dav/zotero user pass

# NextCloud
zotero webdav:config https://cloud.example.com/remote.php/dav/files/user/zotero user pass

# 同步附件
zotero webdav:sync
```

### 导出命令

| 命令 | 说明 |
|------|------|
| `zotero export` | 导出为 BibTeX |
| `zotero export bibtex [文件]` | 导出为 BibTeX |
| `zotero export ris [文件]` | 导出为 RIS |
| `zotero export csv [文件]` | 导出为 CSV |
| `zotero export json [文件]` | 导出为 JSON |

### 工具命令

| 命令 | 说明 |
|------|------|
| `zotero verify` | 验证 API Key 有效性 |
| `zotero --help` | 显示帮助信息 |
| `zotero --version` | 显示版本 |

### 命令选项示例

```bash
# 查看帮助
zotero --help
zotero sync --help

# 静默模式
zotero sync --quiet

# 完整同步（忽略版本差异）
zotero sync --full-sync
zotero sync -f

# 交互式冲突解决
zotero sync --interactive

# 同步群组库
zotero sync --groups

# 过滤显示
zotero list --type journalArticle --sort title --limit 20

# 搜索作者
zotero search "Smith" --field author --limit 10
```

### 添加/更新/删除示例

```bash
# 添加文献（直接同步到远程）
zotero add journalArticle "深度学习综述" "张三" "李四"
zotero add book "书籍标题" "作者名"

# 更新文献（仅本地修改，需运行 sync 上传）
zotero update ABCD1234 title "新标题"
zotero update ABCD1234 abstract "新的摘要"

# 删除文献（仅本地标记，需运行 sync 上传）
zotero delete ABCD1234              # 标记为移至回收站
zotero delete ABCD1234 --permanent  # 标记为永久删除

# 同步到远程
zotero sync
```

> ⚠️ **重要**：`update` 和 `delete` 命令只修改本地数据库，需要运行 `zotero sync` 才能将更改同步到远程。这样可以避免直接操作远程导致的版本冲突。

---

## 别名速查表

如果你熟悉 Unix/Linux 命令，这些别名会让你上手更快：

| Unix 习惯 | Zotero 命令 | 示例 |
|-----------|-------------|------|
| `ls` / `ll` | `list` | `zotero ls`, `zotero ll` |
| `rm` | `delete` | `zotero rm ABCD1234` |
| `rm -f` | `delete --force` | `zotero rm -f ABCD1234` |
| `cat` | `get` | `zotero cat ABCD1234` |
| `grep` | `search` | `zotero grep "keyword"` |
| `touch` | `add` | `zotero touch journalArticle "Title"` |
| `df` | `stats` | `zotero df` |
| `ping` | `verify` | `zotero ping` |

### 最常用短命令

```bash
zotero s              # sync
zotero ls             # list
zotero ll             # list detailed
zotero rm <key>      # delete
zotero cat <key>     # get/show
zotero grep <word>   # search
zotero a <type>      # add
zotero u <key>       # update
zotero st             # stats
zotero v              # verify
```

---

## 笔记功能

Zotero-Headless 支持完整的笔记管理功能，包括 Markdown 编辑、外部编辑器支持，以及与 Zotero ProseMirror 编辑器的兼容。

### 笔记命令概览

| 命令 | 说明 |
|------|------|
| `zotero note add <parent-key> [content]` | 为条目添加笔记 |
| `zotero note edit <note-key> [content]` | 编辑笔记（支持外部编辑器） |
| `zotero note show <note-key>` | 查看笔记（Markdown 格式） |
| `zotero note list <parent-key>` | 列出条目的所有笔记 |

### 添加笔记

```bash
# 直接添加 Markdown 内容
zotero note add ABCD1234 "这是笔记内容，支持 **粗体** 和 *斜体*"

# 多行内容
zotero note add ABCD1234 "## 关键发现
- 发现1
- 发现2"

# 查看添加的笔记 Key
# 输出：✅ Note added successfully!
#       Key: NOTE5678
```

### 编辑笔记

#### 方式一：直接编辑
```bash
zotero note edit NOTE5678 "更新后的内容"
```

#### 方式二：外部编辑器（推荐）
```bash
# 不指定内容，自动打开 $EDITOR
zotero note edit NOTE5678

# 在编辑器中编辑，保存后关闭即更新
```

**自定义编辑器：**
```bash
# 临时指定编辑器
EDITOR=vim zotero note edit NOTE5678
EDITOR="code --wait" zotero note edit NOTE5678

# 永久设置（添加到 ~/.bashrc 或 ~/.zshrc）
export EDITOR=vim
```

**支持的编辑器：**
- `vim`, `nvim`
- `nano`
- `emacs`
- `code` / `code --wait` (VS Code)
- `subl -w` (Sublime Text)
- 任何支持命令行调用的编辑器

### 查看笔记

```bash
# 以 Markdown 格式查看
zotero note show NOTE5678

# 输出示例：
# 📝 Note: NOTE5678
#    Parent: ABCD1234
#    Updated: 2026-02-19
#    Synced: ✅
# ────────────────────────────────────────────────────────────
# 这是笔记内容，支持 **粗体** 和 *斜体*
# ────────────────────────────────────────────────────────────
```

### 列出笔记

```bash
# 查看某个条目的所有笔记
zotero note list ABCD1234

# 输出示例：
# 📝 Notes for ABCD1234 (2):
#
#   ✅ [NOTE5678] 这是笔记预览...
#   🔄 [NOTE9999] 另一个笔记...
```

### Markdown 支持

笔记功能完整支持 Markdown 语法：

| Markdown | 渲染效果 |
|----------|----------|
| `# 标题` | 一级标题 |
| `## 标题` | 二级标题 |
| `**粗体**` | **粗体** |
| `*斜体*` | *斜体* |
| `` `代码` `` | 行内代码 |
| ```` ```代码块``` ```` | 代码块 |
| `- 列表项` | 无序列表 |
| `1. 列表项` | 有序列表 |
| `> 引用` | 引用块 |
| `[链接](url)` | 链接 |
| `![图片](url)` | 图片 |
| `~~删除线~~` | ~~删除线~~ |

### 与 Zotero 桌面客户端兼容

笔记内容使用 **ProseMirror 兼容的 HTML 格式**存储，确保与 Zotero 桌面客户端的笔记编辑器完全兼容。

**ProseMirror Schema 支持：**
- ✅ 段落、标题（h1-h6）
- ✅ 粗体、斜体、下划线、删除线
- ✅ 有序/无序列表
- ✅ 代码块、行内代码
- ✅ 引用块
- ✅ 表格
- ✅ 图片（支持附件关联）
- ✅ 数学公式（$...$ 和 $$...$$）
- ✅ Zotero 特有元素（引用、高亮、批注）

### 同步说明

笔记操作遵循与其他功能一致的同步策略：

1. **本地操作**：所有笔记编辑都在本地数据库进行
2. **标记 unsynced**：修改后自动标记为未同步
3. **统一同步**：运行 `zotero sync` 上传到云端

```bash
# 添加/编辑笔记
zotero note add ABCD1234 "新笔记"
zotero note edit NOTE5678 "更新内容"

# 同步到远程
zotero sync
```

### 批量添加笔记与附件

结合 `add` 命令的附件功能：

```bash
# 添加文献时同时添加附件和笔记
zotero add book "书籍标题" "作者" -a /path/to/file.pdf
zotero note add <new-item-key> "阅读笔记..."
```

---

## 附件管理

Zotero-Headless 支持完整的附件管理功能，包括 WebDAV 同步、本地下载、重复检测等。

### 附件命令概览

| 命令 | 说明 |
|------|------|
| `zotero attachments list` | 列出附件 |
| `zotero attachment-download <key>` | 从 WebDAV 下载附件 |
| `zotero attachment-open <key>` | 用系统默认程序打开附件 |
| `zotero attachment-dedup` | 检测并删除重复附件 |

### 列出附件

```bash
# 列出所有附件
zotero attachments list

# 列出特定条目的附件
zotero attachments list --item ABC123

# 限制数量
zotero attachments list --limit 10
```

输出示例：
```
📎 Attachments (3):

  ☁️ 📄 [XYZ789] paper.pdf
      Title: Research Paper
      Size: 1.5 MB
      WebDAV: /zotero/XYZ789.zip

  📁 📄 [ABC456] data.xlsx
      Title: Dataset
      Size: 256 KB
      Local: /home/user/.local/...
```

### 下载附件

从 WebDAV 下载附件到本地：

```bash
# 下载单个附件
zotero attachment-download XYZ789

# 输出：
# 📥 Downloading attachment XYZ789...
# ✅ Downloaded to /home/user/.local/share/zotero-headless/attachments/paper.pdf
```

下载的附件默认保存到：`~/.local/share/zotero-headless/attachments/`

### 打开附件

用系统默认程序打开附件：

```bash
# 打开 PDF（使用系统默认的 PDF 阅读器）
zotero attachment-open XYZ789

# 输出：
# 📂 Opening attachment XYZ789...
# ✅ Opened with default application
```

支持的文件类型：
- PDF → 默认 PDF 阅读器
- 图片 → 默认图片查看器
- 文档 → 默认办公软件
- 其他 → 系统默认关联程序

### 检测重复附件

扫描并清理重复附件：

```bash
# 扫描重复
zotero attachment-dedup

# 输出示例：
# 🔍 Scanning for duplicate attachments...
# Found 2 duplicate groups:
#
#   📦 Hash: A1B2C3D4... (1024 KB)
#      ✅ [KEY1] file1.pdf
#      ❌ [KEY2] file2.pdf
#
# 💡 Use --delete to remove duplicates

# 删除重复（保留第一个）
zotero attachment-dedup --delete

# 输出：
# 🗑️  Removing duplicates...
# 🎉 Removed 1 duplicate attachments
```

### WebDAV 配置

附件下载需要配置 WebDAV：

```bash
# 配置 WebDAV
zotero webdav:config https://dav.example.com/dav user password

# 测试连接
zotero webdav:status

# 同步所有附件到本地
zotero webdav:sync
```

---

## 故障排除

### 常见错误

#### 1. "Configuration error: zotero.apiKey: Invalid input"

**原因**：未找到 Zotero API Key

**解决**：
1. 创建 `~/.config/zotero-headless/.env` 文件
2. 添加 `ZOTERO_API_KEY=your-api-key`
3. 确保文件包含 `ZOTERO_USER_ID=your-user-id`

> 检查配置是否正确加载：`zotero verify`

#### 2. "No library found"

**原因**：尚未执行过同步

**解决**：
```bash
zotero sync
```

#### 3. "Conflict detected"

**原因**：本地和远程同时修改了同一项目

**解决**：
```bash
# 查看未同步项目
zotero list:unsynced

# 交互式解决冲突
zotero sync --interactive

# 或强制使用远程版本
zotero sync --full-sync
```

#### 4. "Rate limit exceeded"

**原因**：请求过于频繁（Zotero 限制 35次/分钟）

**解决**：
- 系统会自动重试，等待后重试
- 使用 `--quiet` 模式减少输出

#### 5. "SQLite database locked"

**原因**：另一个进程正在使用数据库

**解决**：
- 关闭其他使用该数据库的程序
- 检查是否有残留进程

#### 6. 配置未生效

**原因**：环境变量或配置文件未正确加载

**解决**：
```bash
# 检查当前配置路径
zotero verify

# 确认 .env 文件位置
cat ~/.config/zotero-headless/.env

# 如果在不同目录运行，确保 ~/.config/zotero-headless/.env 存在
```

### 调试模式

```bash
# 显示详细日志
DEBUG=zotero:* zotero sync
```

### 重置数据库

```bash
# 删除本地数据库（下次同步会重新下载）
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

### 定时同步 (cron)

```bash
# 每天凌晨 3 点自动同步
crontab -e

# 添加行：
0 3 * * * /usr/local/bin/zotero sync >> /var/log/zotero.log 2>&1
```

### 与其他工具集成

```bash
# 导出为 BibTeX
zotero export --format bibtex > library.bib

# 搜索并导出
zotero search "keyword" | zotero export --format bibtex
```

---

## 开发指南

### 运行测试

```bash
# 运行所有测试
npm test

# 监听模式
npm run test:watch

# 运行特定测试
npm test -- packages/sync-engine
```

### 项目结构

```
Zotero-Headless/
├── apps/cli/              # CLI 入口
├── packages/
│   ├── api/              # Zotero API 客户端
│   ├── core/             # 核心配置
│   ├── database/         # SQLite 数据库层
│   ├── sync-engine/      # 同步引擎
│   ├── attachment-manager/  # 附件管理
│   ├── webdav-client/    # WebDAV 客户端
│   └── types/            # TypeScript 类型
└── tests/                # 测试套件
```

---

## 常见问题 (FAQ)

### Q: Zotero-Headless 和 Zotero 桌面客户端会冲突吗？

**不会**。Zotero-Headless 只使用 Web API，不会干扰桌面客户端。两者可以同时使用。

### Q: 支持哪些 Zotero 库类型？

- ✅ 个人库 (User Library)
- ✅ 群组库 (Group Library) - 需要相应的 API Key 权限

### Q: 如何处理大量文献（>10000条）？

系统会自动分批处理（默认每批50条），并使用并行下载加速：

```bash
# 查看并发设置
zotero sync
# 输出：使用 5 个并行连接下载...
```

### Q: 数据存储在哪里？

默认存储在 `~/.config/zotero-headless/data/zotero.sqlite`（SQLite 格式）。

### Q: WebDAV 同步支持哪些服务？

- ✅ 坚果云 (jianguoyun.com)
- ✅ NextCloud / ownCloud
- ✅ 任何支持 WebDAV 协议的存储服务

### Q: 如何切换语言？

```bash
# 英文
zotero --lang=en sync

# 中文（默认）
zotero sync

# 环境变量
export LANG=en_US.UTF-8
```

---

## 获取帮助

- 📖 文档：[GitHub Wiki](https://github.com/altairwei/Zotero-Headless/wiki)
- 🐛 问题反馈：[GitHub Issues](https://github.com/altairwei/Zotero-Headless/issues)
- 💬 讨论：[GitHub Discussions](https://github.com/altairwei/Zotero-Headless/discussions)

---

## 许可证

MIT License - See [LICENSE](LICENSE)

---

*最后更新：2026-02-18*
