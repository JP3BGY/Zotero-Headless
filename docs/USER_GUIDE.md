# Zotero-Headless 用户指南

> Zotero Web API 同步客户端 - 无需桌面客户端即可实现文献库同步

## 目录

1. [简介](#简介)
2. [功能特性](#功能特性)
3. [安装指南](#安装指南)
4. [快速开始](#快速开始)
5. [配置说明](#配置说明)
6. [命令参考](#命令参考)
7. [故障排除](#故障排除)
8. [高级用法](#高级用法)

---

## 简介

**Zotero-Headless** 是一个 Node.js CLI 工具，让你可以在**无头环境**（服务器、Docker容器、WSL等）中直接与 Zotero 云端同步文献库，无需运行 Zotero 桌面客户端。

### 适用场景

- 📡 **服务器同步**：在 VPS/服务器上定期自动同步文献
- 🐳 **Docker 部署**：容器化部署到任意平台
- 💻 **WSL/Linux**：在 Linux 子系统使用 Zotero
- 🔄 **双向同步**：本地修改与云端自动合并
- ⚡ **快速访问**：无需启动桌面客户端即可查询文献

---

## 功能特性

| 功能 | 状态 | 说明 |
|------|------|------|
| 双向同步 | ✅ | 自动检测并合并本地/远程变化 |
| 冲突解决 | ✅ | 三向合并算法处理编辑冲突 |
| 智能重试 | ✅ | 指数退避处理网络错误和限流 |
| 本地缓存 | ✅ | SQLite 数据库存储 |
| CLI 命令 | ✅ | 列表、搜索、统计等 |
| 增量同步 | ✅ | 只同步自上次以来的变化 |

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

创建 `.env` 文件：

```bash
# 复制示例配置
cp .env.example .env

# 编辑配置
nano .env
```

填入你的凭证：

```env
# Zotero API Key (从步骤1获取)
ZOTERO_API_KEY=your-api-key-here

# Zotero 用户ID (数字格式)
ZOTERO_USER_ID=1234567
```

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
🔄 Starting two-way sync...

🔑 Verifying API key...
   Logged in as: your-username
📊 Versions - Local: 0, Remote: 100
✅ Sync complete: 50 updated, 0 deleted
```

### 2. 查看文献列表

```bash
zotero list
```

### 3. 搜索文献

```bash
zotero search machine learning
```

### 4. 查看统计

```bash
zotero stats
```

---

## 配置说明

### 配置文件优先级

```
CLI参数 > 环境变量 > 配置文件 > 默认值
```

### 配置文件位置

1. **用户主目录**：~/.zotero-headless.json
2. **项目目录**：./.zotero-headless.json
3. **环境变量**：ZOTERO_API_KEY, ZOTERO_USER_ID

### 配置选项

```json
{
  "apiKey": "your-api-key",
  "userId": "1234567",
  "sync": {
    "batchSize": 50,
    "maxRetries": 3,
    "conflictStrategy": "local"
  },
  "database": {
    "path": "./.zotero-headless.db"
  }
}
```

### 冲突解决策略

| 策略 | 说明 |
|------|------|
| `local` | 优先使用本地版本（默认） |
| `remote` | 优先使用远程版本 |
| `manual` | 手动解决冲突 |

---

## 命令参考

### 同步命令

| 命令 | 别名 | 说明 |
|------|------|------|
| `zotero sync` | `zotero s` | 双向同步 |
| `zotero sync:upload` | `zotero su` | 仅上传本地修改 |
| `zotero sync:download` | `zotero sd` | 仅下载远程修改 |

### 查看命令

| 命令 | 别名 | 说明 |
|------|------|------|
| `zotero list` | `zotero ls` | 列出文献 |
| `zotero list:unsynced` | `zotero lsu` | 列出未同步文献 |
| `zotero get <key>` | `zotero show <key>` | 查看单条文献 |
| `zotero stats` | `zotero st` | 库统计信息 |

### 搜索命令

| 命令 | 别名 | 说明 |
|------|------|------|
| `zotero search <query>` | `zotero find <query>` | 按标题搜索 |

### 工具命令

| 命令 | 说明 |
|------|------|
| `zotero verify` | 验证 API Key 有效性 |
| `zotero --help` | 显示帮助信息 |
| `zotero --version` | 显示版本 |

### 命令选项

```bash
# 查看帮助
zotero --help
zotero sync --help

# 干运行模式（不实际执行）
zotero sync --dry-run

# 完整同步（忽略版本差异）
zotero sync --full
```

---

## 故障排除

### 常见错误

#### 1. "Invalid API key"

**原因**：API Key 错误或已失效

**解决**：
1. 访问 https://www.zotero.org/settings/keys
2. 验证密钥是否有效
3. 检查 `.env` 文件中的密钥是否正确

#### 2. "Rate limit exceeded"

**原因**：请求过于频繁（Zotero 限制 35次/分钟）

**解决**：
- 系统会自动重试，等待后重试

#### 3. "No library found"

**原因**：尚未执行过同步

**解决**：
```bash
zotero sync
```

#### 4. "SQLite database locked"

**原因**：另一个进程正在使用数据库

**解决**：
- 关闭其他使用该数据库的程序
- 检查是否有残留进程

### 调试模式

```bash
# 显示详细日志
DEBUG=zotero:* zotero sync
```

### 重置数据库

```bash
# 删除本地数据库（下次同步会重新下载）
rm .zotero-headless.db
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
├── apps/cli/           # CLI 入口
├── packages/
│   ├── api/           # Zotero API 客户端
│   ├── core/          # 核心配置
│   ├── database/      # SQLite 数据库层
│   ├── sync-engine/   # 同步引擎
│   └── types/         # TypeScript 类型
└── tests/             # 测试套件
```

---

## 常见问题 (FAQ)

### Q: Zotero-Headless 和 Zotero 桌面客户端会冲突吗？

**不会**。Zotero-Headless 只使用 Web API，不会干扰桌面客户端。两者可以同时使用。

### Q: 支持哪些 Zotero 库类型？

- ✅ 个人库 (User Library)
- ✅ 小组库 (Group Library) - 需要相应的 API Key 权限

### Q: 如何处理大量文献（>10000条）？

系统会自动分批处理（默认每批50条）。可以调整配置：

```json
{
  "sync": {
    "batchSize": 100
  }
}
```

### Q: 数据存储在哪里？

默认存储在当前目录的 `.zotero-headless.db` 文件中（SQLite 格式）。

---

## 获取帮助

- 📖 文档：[GitHub Wiki](https://github.com/altairwei/Zotero-Headless/wiki)
- 🐛 问题反馈：[GitHub Issues](https://github.com/altairwei/Zotero-Headless/issues)
- 💬 讨论：[GitHub Discussions](https://github.com/altairwei/Zotero-Headless/discussions)

---

## 许可证

MIT License - See [LICENSE](LICENSE)

---

*最后更新：2026-02-15*
