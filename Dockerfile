# Zotero-Headless Docker Image
# Multi-stage build for smaller final image

FROM node:20-alpine AS builder

# Install pnpm
RUN npm install -g pnpm@8.12.0

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/cli/package.json ./apps/cli/
COPY packages/api/package.json ./packages/api/
COPY packages/core/package.json ./packages/core/
COPY packages/database/package.json ./packages/database/
COPY packages/sync-engine/package.json ./packages/sync-engine/
COPY packages/types/package.json ./packages/types/
COPY packages/attachment-manager/package.json ./packages/attachment-manager/
COPY packages/webdav-client/package.json ./packages/webdav-client/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build project
RUN pnpm build

# Production stage
FROM node:20-alpine AS production

# Install SQLite dependencies
RUN apk add --no-cache sqlite-libs

# Create non-root user
RUN addgroup -g 1001 -S zotero && \
    adduser -S zotero -u 1001

# Set working directory
WORKDIR /app

# Copy built files from builder
COPY --from=builder --chown=zotero:zotero /app/apps/cli/dist ./apps/cli/dist
COPY --from=builder --chown=zotero:zotero /app/packages ./packages
COPY --from=builder --chown=zotero:zotero /app/node_modules ./node_modules
COPY --from=builder --chown=zotero:zotero /app/package.json ./

# Create data directory
RUN mkdir -p /data && chown -zotero:zotero /data

# Switch to non-root user
USER zotero

# Set environment
ENV NODE_ENV=production
ENV DATABASE_PATH=/data/zotero.sqlite

# Entry point
ENTRYPOINT ["node", "/app/apps/cli/dist/index.js"]

# Default command
CMD ["--help"]
