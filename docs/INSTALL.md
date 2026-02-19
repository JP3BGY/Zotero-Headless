# 构建与安装指南

本文档包含从源代码构建和安装 Zotero-Headless 的完整指南。

---

## 目录

- [GitHub Actions 自动构建](#github-actions-自动构建)
  - [构建 npm 包](#构建-npm-包)
  - [构建 Docker 镜像](#构建-docker-镜像)
- [手动安装](#手动安装)
  - [从 npm 安装](#从-npm-安装)
  - [Windows 安装](#windows-安装)
- [配置](#配置)
- [故障排除](#故障排除)

---

## GitHub Actions 自动构建

### 构建 npm 包

#### 步骤 1: 启用工作流

1. 打开 GitHub 仓库页面 → **Actions** 标签
2. 点击 **"set up a workflow yourself"**
3. 创建文件 `.github/workflows/build-package.yml`：

```yaml
name: Build and Package

on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Version tag (e.g., 1.0.0)'
        required: true
        default: '1.0.0'
  
  push:
    branches: [master, main]
    paths-ignore:
      - '**.md'
      - 'docs/**'

jobs:
  build-and-package:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - uses: pnpm/action-setup@v2
        with:
          version: 8.12.0

      - name: Build
        run: |
          pnpm install
          pnpm build

      - name: Package
        run: |
          VERSION=${{ steps.get_version.outputs.VERSION }}
          mkdir -p dist-package
          cp -r apps/cli/dist dist-package/
          tar -czf zotero-headless-${VERSION}.tgz dist-package/

      - uses: actions/upload-artifact@v4
        with:
          name: zotero-headless-${{ steps.get_version.outputs.VERSION }}
          path: zotero-headless-*.tgz
          retention-days: 30
```

#### 步骤 2: 触发构建

- **自动**: 推送到 `master` 分支时触发
- **手动**: Actions → "Build and Package" → "Run workflow"

#### 步骤 3: 下载安装

```bash
# 下载 .tgz 文件后安装
npm install -g ./zotero-headless-1.0.0.tgz

# 验证
zotero --version
zotero sync
```

---

### 构建 Docker 镜像

#### 步骤 1: 启用工作流

创建 `.github/workflows/docker-build.yml`：

```yaml
name: Build and Push Docker Image

on:
  workflow_dispatch:
    inputs:
      tag:
        description: 'Image tag'
        required: true
        default: 'latest'
  push:
    branches: [master, main]
    tags: ['v*']

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
      
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}

      - uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          platforms: linux/amd64,linux/arm64
```

#### 步骤 2: 配置权限

仓库 → Settings → Actions → General → Workflow permissions → **Read and write**

#### 步骤 3: 使用镜像

```bash
# 登录
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# 拉取运行
docker pull ghcr.io/altairwei/zotero-headless:latest
docker run ghcr.io/altairwei/zotero-headless sync
```

---

## 手动安装

### 从 npm 安装

#### 快速安装（推荐）

```bash
# 全局安装
npm install -g git+https://github.com/altairwei/Zotero-Headless.git

# 或使用 pnpm
pnpm add -g git+https://github.com/altairwei/Zotero-Headless.git
```

#### 预构建包安装

无需编译，直接使用 GitHub Actions 构建的包：

```bash
# 1. 从 GitHub Actions 下载 zotero-headless-x.x.x.tgz
# 2. 安装
npm install -g ./zotero-headless-1.0.0.tgz

# 3. 验证
zotero --version
```

**优点**：
- ✅ 无需克隆仓库
- ✅ 无需本地编译
- ✅ 离线安装
- ✅ 版本管理

---

### Windows 安装

#### 快速安装（一行命令）

```powershell
# PowerShell (管理员)
npm install -g git+https://github.com/altairwei/Zotero-Headless.git
```

#### 前提条件

1. **Node.js** (≥18.0.0)：https://nodejs.org/
2. **Git**：https://git-scm.com/download/win

验证安装：
```powershell
node --version  # v18.x.x
npm --version   # 9.x.x
```

#### PowerShell 配置

```powershell
# 创建配置目录
mkdir -p "$env:USERPROFILE\.config\zotero-headless"

# 创建 .env 文件
notepad "$env:USERPROFILE\.config\zotero-headless\.env"
```

.env 内容：
```env
ZOTERO_API_KEY=your-api-key
ZOTERO_USER_ID=1234567
```

#### Windows 常用命令

```powershell
# 同步
zotero sync

# 列出文献
zotero ls
zotero ls -t book    # 只显示书籍

# 搜索
zotero grep "machine learning"

# 查看详情
zotero cat ABCD1234

# 更新
npm update -g git+https://github.com/altairwei/Zotero-Headless.git

# 卸载
npm uninstall -g zotero-headless
```

---

## 配置

### 创建配置文件

**Linux/macOS**：
```bash
mkdir -p ~/.config/zotero-headless
cat > ~/.config/zotero-headless/.env << 'EOF'
ZOTERO_API_KEY=your-api-key
ZOTERO_USER_ID=your-user-id
EOF
```

**Windows (PowerShell)**：
```powershell
mkdir -Force "$env:USERPROFILE\.config\zotero-headless"
@"
ZOTERO_API_KEY=your-api-key
ZOTERO_USER_ID=your-user-id
"@ | Out-File "$env:USERPROFILE\.config\zotero-headless\.env"
```

### 验证配置

```bash
zotero verify
```

---

## 故障排除

### 构建问题

| 问题 | 解决 |
|------|------|
| "git is not recognized" | 安装 Git for Windows |
| "pnpm is not recognized" | `npm install -g pnpm` |
| "node-gyp rebuild fails" | `npm install -g windows-build-tools` |
| "permission denied" | Linux/macOS: `chmod +x $(npm root -g)/zotero-headless/dist/index.js` |

### GitHub Actions 问题

| 问题 | 解决 |
|------|------|
| "denied: permission_denied" | Settings → Actions → Workflow permissions → Read and write |
| "unauthorized" | 使用有权限的 GitHub Token 登录 |
| 构建失败 | 检查 Dockerfile 和代码是否能正常构建 |

### 配置问题

| 问题 | 解决 |
|------|------|
| "Cannot find module" | 重新安装依赖：`cd $(npm root -g)/zotero-headless && npm install` |
| "Configuration error" | 检查 `~/.config/zotero-headless/.env` 文件是否存在 |

---

## 命令别名对照

| 完整命令 | 别名 | 示例 |
|---------|------|------|
| `zotero sync` | `s` | `zotero s` |
| `zotero list` | `ls`, `ll` | `zotero ls` |
| `zotero search` | `find`, `grep`, `f` | `zotero grep "keyword"` |
| `zotero get` | `show`, `cat`, `view` | `zotero cat ABCD1234` |
| `zotero stats` | `st`, `info`, `df` | `zotero df` |
| `zotero verify` | `v`, `check`, `ping` | `zotero ping` |
| `zotero groups` | `g`, `team` | `zotero g` |
| `zotero attachments` | `att`, `files` | `zotero att` |

---

**完整使用文档**: [USER_GUIDE.md](USER_GUIDE.md)  
**Docker 部署**: [DOCKER.md](DOCKER.md)
