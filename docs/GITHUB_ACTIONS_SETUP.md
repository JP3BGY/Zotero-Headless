# GitHub Actions Docker 构建配置

## 快速启用

### 步骤 1: 在 GitHub 上创建工作流

1. 打开 GitHub 仓库页面
2. 点击 **Actions** 标签
3. 点击 **"set up a workflow yourself"**
4. 复制下面的配置到编辑器中

### 步骤 2: 创建工作流文件

文件名: `.github/workflows/docker-build.yml`

```yaml
name: Build and Push Docker Image

on:
  # Manual trigger
  workflow_dispatch:
    inputs:
      tag:
        description: 'Image tag (e.g., latest, v1.0.0)'
        required: true
        default: 'latest'
  
  # Trigger on push to master branch
  push:
    branches: [master, main]
    paths-ignore:
      - '**.md'
      - 'docs/**'

  # Trigger on tag push
  push:
    tags:
      - 'v*'

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
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=branch
            type=ref,event=pr
            type=semver,pattern={{version}}
            type=raw,value=latest,enable={{is_default_branch}}
            type=raw,value=${{ github.event.inputs.tag }},enable=${{ github.event.inputs.tag != '' }}

      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          platforms: linux/amd64,linux/arm64

      - name: Output image info
        run: |
          echo "✅ Image built and pushed successfully!"
          echo "Image: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}"
```

5. 点击 **"Start commit"** → **"Commit new file"**

### 步骤 3: 配置仓库权限

1. 仓库页面 → **Settings** → **Actions** → **General**
2. 滚动到 **"Workflow permissions"**
3. 选择 **"Read and write permissions"**
4. 点击 **Save**

### 步骤 4: 手动触发构建

1. 进入 **Actions** 标签
2. 点击左侧 **"Build and Push Docker Image"**
3. 点击 **"Run workflow"**
4. 选择分支（通常是 `master`）
5. 可选：输入标签（默认 `latest`）
6. 点击 **"Run workflow"**

---

## 自动触发条件

配置完成后，以下操作会自动触发构建：

| 操作 | 触发结果 |
|------|----------|
| 推送代码到 `master` | 构建 `latest` 标签 |
| 推送标签 `v1.0.0` | 构建 `v1.0.0`, `v1.0`, `v1`, `latest` |
| 手动点击 "Run workflow" | 构建指定标签 |

---

## 查看镜像

构建完成后，镜像会出现在：

**GitHub → 你的仓库 → Packages**

或者访问：
```
https://github.com/altairwei?tab=packages&repo_name=Zotero-Headless
```

镜像地址格式：
```
ghcr.io/altairwei/zotero-headless:latest
ghcr.io/altairwei/zotero-headless:v1.0.0
```

---

## 使用镜像

```bash
# 登录（需要 GitHub Token）
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# 拉取镜像
docker pull ghcr.io/altairwei/zotero-headless:latest

# 运行
docker run ghcr.io/altairwei/zotero-headless sync
```

完整使用说明见: [DOCKER.md](DOCKER.md)

---

## 故障排除

### 问题: "denied: permission_denied"

**解决**: 检查仓库 Settings → Actions → General → Workflow permissions 是否设置为 "Read and write"

### 问题: "unauthorized"

**解决**: 确保已使用有权限的 GitHub Token 登录

```bash
docker login ghcr.io -u YOUR_GITHUB_USERNAME
# 输入 Personal Access Token（需要有 read:packages 和 write:packages 权限）
```

### 问题: 构建失败

**检查**:
1. Dockerfile 是否存在
2. 代码是否能正常构建（`pnpm build`）
3. 查看 Actions 日志中的具体错误
