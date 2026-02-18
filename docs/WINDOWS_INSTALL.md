# Windows 安装指南

## 快速安装（一行命令）

### 前提条件

1. **安装 Node.js** (≥18.0.0)
   - 下载地址：https://nodejs.org/ （选择 LTS 版本）
   - 安装时勾选 "Add to PATH"

2. **验证安装**
   ```powershell
   node --version  # 应显示 v18.x.x 或更高
   npm --version   # 应显示 9.x.x 或更高
   ```

### 安装 zotero-headless

```powershell
npm install -g git+https://github.com/altairwei/Zotero-Headless.git
```

安装过程会自动：
- 克隆 GitHub 仓库
- 安装 pnpm（如果未安装）
- 安装所有依赖
- 构建项目

### 更新到最新版本

```powershell
npm update -g git+https://github.com/altairwei/Zotero-Headless.git
```

### 卸载

```powershell
npm uninstall -g zotero-headless
```

---

## 配置

### 1. 创建配置文件

```powershell
# 创建配置目录
mkdir -p "$env:USERPROFILE\.config\zotero-headless"

# 创建 .env 文件
notepad "$env:USERPROFILE\.config\zotero-headless\.env"
```

### 2. 编辑 .env 文件

```env
# Zotero API Key (从 https://www.zotero.org/settings/keys 获取)
ZOTERO_API_KEY=your-api-key-here

# Zotero 用户ID (数字格式)
ZOTERO_USER_ID=1234567

# 可选：自定义数据库路径
# DATABASE_PATH=C:\Users\YourName\zotero-data\zotero.sqlite
```

### 3. 验证配置

```powershell
zotero verify
```

---

## 使用示例

```powershell
# 首次同步
zotero sync

# 列出文献（使用别名）
zotero ls
zotero ls -t book          # 只显示书籍
zotero ls -l 50            # 显示50条

# 搜索
zotero grep "machine learning"
zotero grep "作者名" -f author

# 查看详情
zotero cat ABCD1234

# 添加文献
zotero touch journalArticle "论文标题" "作者1" "作者2"

# 删除
zotero rm ABCD1234         # 移至回收站
zotero rm ABCD1234 -f      # 永久删除

# 查看统计
zotero df

# 显示帮助
zotero --help
```

---

## 故障排除

### 问题 1: "git is not recognized"

**原因**: Git 未安装或未加入 PATH

**解决**:
```powershell
# 安装 Git for Windows
# 下载地址：https://git-scm.com/download/win

# 或者使用 npm 安装 git
npm install -g git-clone
```

### 问题 2: "pnpm is not recognized"

**原因**: pnpm 未安装

**解决**:
```powershell
npm install -g pnpm
```

### 问题 3: "node-gyp rebuild fails"

**原因**: better-sqlite3 需要编译工具

**解决**:
```powershell
# 安装 Windows 构建工具
npm install -g windows-build-tools

# 或使用预编译版本（如果可用）
npm config set better-sqlite3-binary-host mirror
```

### 问题 4: 配置未生效

**检查**:
```powershell
# 查看配置文件是否存在
cat "$env:USERPROFILE\.config\zotero-headless\.env"

# 验证 API key
curl -H "Zotero-API-Key: your-key" https://api.zotero.org/users/your-user-id/items?limit=1
```

---

## 完整命令别名对照表

| 完整命令 | 别名 | 示例 |
|---------|------|------|
| `zotero sync` | `s` | `zotero s` |
| `zotero list` | `ls`, `ll` | `zotero ls` |
| `zotero search` | `find`, `grep`, `f` | `zotero grep "keyword"` |
| `zotero get` | `show`, `cat`, `view` | `zotero cat ABCD1234` |
| `zotero stats` | `st`, `info`, `df` | `zotero df` |
| `zotero verify` | `v`, `check`, `ping` | `zotero ping` |
| `zotero add` | `a`, `new`, `touch` | `zotero touch book "Title"` |
| `zotero update` | `u`, `edit`, `set` | `zotero u KEY title "New"` |
| `zotero delete` | `rm`, `del`, `d` | `zotero rm KEY -f` |
| `zotero export` | `e`, `out`, `save` | `zotero e bibtex` |
| `zotero groups` | `g`, `team` | `zotero g` |
| `zotero attachments` | `att`, `files` | `zotero att` |

---

## 更新日志

查看更新：
```powershell
# 查看本地版本
zotero --version

# 查看 GitHub 最新版本
git ls-remote --tags https://github.com/altairwei/Zotero-Headless.git
```

---

## 卸载

```powershell
npm uninstall -g zotero-headless

# 可选：删除配置和数据
Remove-Item -Recurse -Force "$env:USERPROFILE\.config\zotero-headless"
```

---

**提示**: 确保仓库为私有状态，这样只有通过 GitHub 访问权限的人才能安装。
