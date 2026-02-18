# 预构建包安装指南

使用 GitHub Actions 自动构建的 `.tgz` 包安装，无需本地编译。

## 安装步骤

### 1. 下载构建包

1. 打开 GitHub 仓库 → **Actions** 标签
2. 选择最新的 **"Build and Package"** 工作流运行
3. 下载 Artifacts 中的 `zotero-headless-x.x.x.tgz`

或者使用命令行下载（需要 GitHub CLI）：

```bash
# 安装 gh CLI: https://cli.github.com/

# 登录
git login

# 下载最新构建
git run download -R altairwei/Zotero-Headless -n "Build and Package"
```

### 2. 安装

```bash
# 全局安装
npm install -g ./zotero-headless-1.0.0.tgz

# 或使用 pnpm
pnpm add -g ./zotero-headless-1.0.0.tgz
```

### 3. 配置

创建配置文件：

```bash
# Linux/macOS
mkdir -p ~/.config/zotero-headless
cat > ~/.config/zotero-headless/.env << 'EOF'
ZOTERO_API_KEY=your-api-key
ZOTERO_USER_ID=your-user-id
EOF

# Windows (PowerShell)
mkdir -Force "$env:USERPROFILE\.config\zotero-headless"
@"
ZOTERO_API_KEY=your-api-key
ZOTERO_USER_ID=your-user-id
"@ | Out-File -FilePath "$env:USERPROFILE\.config\zotero-headless\.env" -Encoding utf8
```

### 4. 使用

```bash
zotero sync
zotero ls
zotero grep "keyword"
```

---

## 更新

```bash
# 1. 下载新版本的 .tgz 文件
# 2. 更新
npm install -g ./zotero-headless-NEW_VERSION.tgz
```

---

## 卸载

```bash
npm uninstall -g zotero-headless
```

---

## 故障排除

### 问题 1: "Cannot find module"

**原因**: 依赖未正确安装

**解决**:
```bash
# 重新安装依赖
cd $(npm root -g)/zotero-headless
npm install
```

### 问题 2: 权限错误 (Linux/macOS)

**解决**:
```bash
# 使用 npx 运行
npx zotero-headless sync

# 或修改权限
chmod +x $(npm root -g)/zotero-headless/dist/index.js
```

### 问题 3: Windows 上找不到命令

**解决**:
```powershell
# 检查 npm 全局路径
npm config get prefix

# 确保该路径在 PATH 环境变量中
# 或直接使用完整路径
& "$(npm root -g)\zotero-headless\dist\index.js" sync
```

---

## 手动触发构建

如果您有仓库访问权限，可以手动触发新构建：

1. 进入 **Actions** → **Build and Package**
2. 点击 **Run workflow**
3. 输入版本号（可选，默认使用日期+commit）
4. 点击 **Run workflow**
5. 等待构建完成，下载 Artifact

---

## 优点

✅ **无需克隆仓库** - 只下载单个 .tgz 文件  
✅ **无需本地编译** - 预构建，安装更快  
✅ **离线安装** - 下载后无需网络  
✅ **版本管理** - 可以保留多个版本  
✅ **私有安全** - 不发布到公开 registry

---

## 完整命令参考

```bash
# 下载
wget https://github.com/altairwei/Zotero-Headless/actions/runs/xxx/artifacts/zotero-headless-1.0.0.tgz

# 安装
npm install -g ./zotero-headless-1.0.0.tgz

# 验证
zotero --version
zotero verify

# 使用
zotero sync
zotero ls
zotero cat ITEM_KEY
```
