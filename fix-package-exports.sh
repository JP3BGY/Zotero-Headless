#!/bin/bash

# 修复所有包的 package.json 文件，确保导出正确的 dist 路径

# database 包
cat > packages/database/package.json << 'EOF'
{
  "name": "@zotero-headless/database",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit",
    "lint": "echo 'No lint configured'"
  },
  "dependencies": {
    "better-sqlite3": "^11.9.1",
    "drizzle-orm": "^0.30.10"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.5.0",
    "@types/node": "^25.2.3",
    "typescript": "^5.3.0"
  }
}
EOF

# api 包
cat > packages/api/package.json << 'EOF'
{
  "name": "@zotero-headless/api",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit",
    "lint": "echo 'No lint configured'"
  },
  "dependencies": {
    "@zotero-headless/core": "workspace:*",
    "@zotero-headless/types": "workspace:*",
    "axios": "^1.13.5"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
EOF

# core 包
cat > packages/core/package.json << 'EOF'
{
  "name": "@zotero-headless/core",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit",
    "lint": "echo 'No lint configured'"
  },
  "dependencies": {
    "@zotero-headless/types": "workspace:*",
    "dotenv": "^17.3.1",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
EOF

# types 包
cat > packages/types/package.json << 'EOF'
{
  "name": "@zotero-headless/types",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit",
    "lint": "echo 'No lint configured'"
  },
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
EOF

# sync-engine 包 - 已经修复

# CLI 包
cat > apps/cli/package.json << 'EOF'
{
  "name": "@zotero-headless/cli",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "bin": {
    "zotero-headless": "./dist/index.js"
  },
  "exports": {
    ".": {
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit",
    "lint": "echo 'No lint configured'"
  },
  "dependencies": {
    "@zotero-headless/api": "workspace:*",
    "@zotero-headless/core": "workspace:*",
    "@zotero-headless/database": "workspace:*",
    "@zotero-headless/sync-engine": "workspace:*",
    "@zotero-headless/types": "workspace:*",
    "commander": "^14.0.3"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
EOF

echo "Package.json 文件已更新！"
echo "运行 'pnpm install' 生效..."
pnpm install