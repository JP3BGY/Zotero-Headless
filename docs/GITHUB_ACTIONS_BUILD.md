# GitHub Actions 构建配置

## 快速启用预构建包

### 步骤 1: 在 GitHub 上创建工作流

1. 打开 GitHub 仓库页面
2. 点击 **Actions** 标签
3. 点击 **"set up a workflow yourself"**
4. 复制下面的配置到编辑器

### 步骤 2: 创建工作流文件

文件名: `.github/workflows/build-package.yml`

```yaml
name: Build and Package

on:
  # Manual trigger
  workflow_dispatch:
    inputs:
      version:
        description: 'Version tag (e.g., 1.0.0)'
        required: true
        default: '1.0.0'
  
  # Trigger on push to master
  push:
    branches: [master, main]
    paths-ignore:
      - '**.md'
      - 'docs/**'

jobs:
  build-and-package:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 8.12.0

      - name: Get version
        id: get_version
        run: |
          if [ "${{ github.event.inputs.version }}" != "" ]; then
            echo "VERSION=${{ github.event.inputs.version }}" >> $GITHUB_OUTPUT
          else
            echo "VERSION=$(date +%Y%m%d)-$(git rev-parse --short HEAD)" >> $GITHUB_OUTPUT
          fi

      - name: Install dependencies
        run: pnpm install

      - name: Build project
        run: pnpm build

      - name: Package for distribution
        run: |
          VERSION=${{ steps.get_version.outputs.VERSION }}
          mkdir -p dist-package
          
          # Copy built files
          cp -r apps/cli/dist dist-package/
          cp -r packages/*/dist dist-package/ 2>/dev/null || true
          
          # Copy necessary files
          cp package.json dist-package/
          cp README.md dist-package/ 2>/dev/null || true
          
          # Create package.json for distribution
          cat > dist-package/package.json << EOF
          {
            "name": "zotero-headless",
            "version": "$VERSION",
            "description": "Zotero Web API sync client",
            "bin": {
              "zotero": "./dist/index.js"
            },
            "engines": {
              "node": ">=18.0.0"
            },
            "dependencies": {
              "axios": "^1.13.5",
              "better-sqlite3": "^11.9.1",
              "commander": "^14.0.3",
              "dotenv": "^17.3.1",
              "drizzle-orm": "^0.30.10",
              "sql.js": "^1.14.0",
              "zod": "^4.3.6"
            }
          }
          EOF
          
          # Create tarball
          cd dist-package
          tar -czf ../zotero-headless-${VERSION}.tgz .
          cd ..
          
          echo "✅ Created zotero-headless-${VERSION}.tgz"

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: zotero-headless-${{ steps.get_version.outputs.VERSION }}
          path: zotero-headless-*.tgz
          retention-days: 30

      - name: Output package info
        run: |
          echo "✅ Build complete!"
          echo "Package: zotero-headless-${{ steps.get_version.outputs.VERSION }}.tgz"
          ls -lh zotero-headless-*.tgz
```

5. 点击 **"Start commit"** → **"Commit new file"**

### 步骤 3: 手动触发构建

1. 进入 **Actions** 标签
2. 点击左侧 **"Build and Package"**
3. 点击 **"Run workflow"**
4. 选择分支（`master`）
5. 可选：输入版本号（如 `1.0.0`）
6. 点击 **"Run workflow"**

### 步骤 4: 下载安装包

构建完成后：

1. 点击完成的 workflow 运行
2. 滚动到 **Artifacts** 部分
3. 下载 `zotero-headless-x.x.x.tgz`

### 步骤 5: 安装

```bash
# 全局安装
npm install -g ./zotero-headless-1.0.0.tgz

# 验证
zotero --version
zotero sync
```

---

## 自动触发

配置完成后，以下操作会自动触发构建：

| 操作 | 结果 |
|------|------|
| 推送代码到 `master` | 自动构建，版本为 `YYYYMMDD-shortsha` |
| 手动点击 "Run workflow" | 构建指定版本 |

---

## Windows 用户使用

### PowerShell 安装

```powershell
# 1. 下载 .tgz 文件到桌面
# 2. 安装
npm install -g "$env:USERPROFILE\Downloads\zotero-headless-1.0.0.tgz"

# 3. 配置
mkdir -Force "$env:USERPROFILE\.config\zotero-headless"
@"
ZOTERO_API_KEY=your-key
ZOTERO_USER_ID=your-id
"@ | Out-File "$env:USERPROFILE\.config\zotero-headless\.env"

# 4. 使用
zotero sync
zotero ls
```

---

## 优点

✅ **无需克隆仓库** - 只下载单个 .tgz (~10MB)  
✅ **无需本地编译** - 预构建，安装只需几秒  
✅ **离线可用** - 下载后无需网络  
✅ **私有安全** - 不发布到公开 registry  
✅ **版本控制** - 可保留多个版本，随时回滚

---

## 完整示例

```bash
# 1. 从 GitHub Actions 下载 zotero-headless-1.0.0.tgz

# 2. 安装
npm install -g ./zotero-headless-1.0.0.tgz

# 3. 配置 API key
export ZOTERO_API_KEY="your-key"
export ZOTERO_USER_ID="1234567"

# 4. 使用
zotero verify
zotero sync
zotero ls
zotero grep "machine learning"
```

---

更多详情: [PACKAGE_INSTALL.md](PACKAGE_INSTALL.md)
