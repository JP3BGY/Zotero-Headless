# Docker 部署指南

使用 Docker 运行 Zotero-Headless，无需安装 Node.js 或克隆仓库。

## 快速开始

### 1. 登录 GitHub Container Registry

```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
```

> **获取 GITHUB_TOKEN**:  
> GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)  
> 勾选 `read:packages` 权限

### 2. 拉取镜像

```bash
docker pull ghcr.io/altairwei/zotero-headless:latest
```

### 3. 运行

```bash
# 查看帮助
docker run ghcr.io/altairwei/zotero-headless --help

# 验证 API Key
docker run -e ZOTERO_API_KEY=your-key -e ZOTERO_USER_ID=your-id ghcr.io/altairwei/zotero-headless verify

# 同步（带数据持久化）
docker run -v $(pwd)/zotero-data:/data \
  -e ZOTERO_API_KEY=your-key \
  -e ZOTERO_USER_ID=your-id \
  ghcr.io/altairwei/zotero-headless sync
```

---

## 使用 Docker Compose（推荐）

创建 `docker-compose.yml`:

```yaml
version: '3.8'

services:
  zotero:
    image: ghcr.io/altairwei/zotero-headless:latest
    container_name: zotero-headless
    volumes:
      - ./data:/data
      - ./.env:/app/.env:ro
    environment:
      - NODE_ENV=production
      - DATABASE_PATH=/data/zotero.sqlite
    # Override entrypoint to keep container running if needed
    # entrypoint: ["tail", "-f", "/dev/null"]
```

创建 `.env` 文件:

```env
ZOTERO_API_KEY=your-api-key-here
ZOTERO_USER_ID=your-user-id
```

运行:

```bash
# 同步
docker-compose run --rm zotero sync

# 列出文献
docker-compose run --rm zotero ls

# 搜索
docker-compose run --rm zotero grep "machine learning"

# 查看统计
docker-compose run --rm zotero stats
```

---

## 常用命令

```bash
# 同步
docker run --rm \
  -v $(pwd)/data:/data \
  -e ZOTERO_API_KEY=xxx \
  -e ZOTERO_USER_ID=xxx \
  ghcr.io/altairwei/zotero-headless sync

# 使用别名
docker run --rm \
  -v $(pwd)/data:/data \
  -e ZOTERO_API_KEY=xxx \
  -e ZOTERO_USER_ID=xxx \
  ghcr.io/altairwei/zotero-headless ls

# 交互式容器（用于调试）
docker run -it --rm \
  -v $(pwd)/data:/data \
  -e ZOTERO_API_KEY=xxx \
  -e ZOTERO_USER_ID=xxx \
  --entrypoint /bin/sh \
  ghcr.io/altariwei/zotero-headless
```

---

## 自动同步（Cron）

在主机上设置定时任务:

```bash
# 编辑 crontab
crontab -e

# 每天凌晨 3 点自动同步
0 3 * * * docker run --rm -v /path/to/data:/data -e ZOTERO_API_KEY=xxx -e ZOTERO_USER_ID=xxx ghcr.io/altairwei/zotero-headless sync >> /var/log/zotero-sync.log 2>&1
```

---

## 更新镜像

```bash
# 拉取最新版本
docker pull ghcr.io/altairwei/zotero-headless:latest

# 或者指定版本
docker pull ghcr.io/altairwei/zotero-headless:v1.0.0
```

---

## 构建自己的镜像

```bash
# 克隆仓库
git clone https://github.com/altairwei/Zotero-Headless.git
cd Zotero-Headless

# 构建镜像
docker build -t zotero-headless:local .

# 运行
docker run --rm zotero-headless:local --help
```

---

## 镜像标签说明

| 标签 | 说明 |
|------|------|
| `latest` | 最新构建（master分支） |
| `v1.0.0` | 特定版本 |
| `v1.0` | 最新 1.0.x 版本 |
| `v1` | 最新 1.x.x 版本 |
| `master` | master 分支最新构建 |

---

## 故障排除

### 问题 1: "unauthorized"

**原因**: 未登录或 Token 无效

**解决**:
```bash
docker logout ghcr.io
docker login ghcr.io -u USERNAME
# 输入 Personal Access Token
```

### 问题 2: "permission denied"

**原因**: 仓库为私有，Token 无权限

**解决**: 确保 Token 有 `read:packages` 权限

### 问题 3: 数据未持久化

**原因**: 未挂载卷

**解决**: 始终使用 `-v /host/path:/data` 挂载数据目录

---

## Windows 用户使用 Docker Desktop

### PowerShell

```powershell
# 设置变量
$env:ZOTERO_API_KEY = "your-key"
$env:ZOTERO_USER_ID = "your-id"

# 运行
docker run --rm `
  -v ${PWD}\data:/data `
  -e ZOTERO_API_KEY=$env:ZOTERO_API_KEY `
  -e ZOTERO_USER_ID=$env:ZOTERO_USER_ID `
  ghcr.io/altairwei/zotero-headless sync
```

### Command Prompt

```cmd
docker run --rm ^
  -v %cd%\data:/data ^
  -e ZOTERO_API_KEY=your-key ^
  -e ZOTERO_USER_ID=your-id ^
  ghcr.io/altairwei/zotero-headless sync
```

---

**注意**: 仓库保持私有，只有有权限的用户才能拉取镜像。
