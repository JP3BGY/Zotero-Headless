// @ts-nocheck
import { config } from 'dotenv';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// 查找 .env 文件的优先级顺序：
// 1. ZOTERO_ENV_PATH 环境变量指定的路径
// 2. 当前工作目录下的 .env
// 3. 可执行文件所在目录的 .env（全局安装时）
// 4. 用户主目录下的 ~/.config/zotero-headless/.env
// 5. 用户主目录下的 ~/.zotero-headless.env

function findEnvFile(): string | undefined {
  // 1. 环境变量指定
  if (process.env.ZOTERO_ENV_PATH && fs.existsSync(process.env.ZOTERO_ENV_PATH)) {
    return process.env.ZOTERO_ENV_PATH;
  }

  // 2. 当前工作目录
  const cwdEnv = path.join(process.cwd(), '.env');
  if (fs.existsSync(cwdEnv)) {
    return cwdEnv;
  }

  // 3. 可执行文件所在目录（用于全局安装）
  // __dirname 指向 dist 目录，向上找到项目根目录
  const execDir = path.dirname(process.argv[1]);
  const execEnv = path.join(execDir, '.env');
  if (fs.existsSync(execEnv)) {
    return execEnv;
  }

  // 4. 用户主目录下的配置目录
  const homeConfigDir = path.join(os.homedir(), '.config', 'zotero-headless');
  const homeConfigEnv = path.join(homeConfigDir, '.env');
  if (fs.existsSync(homeConfigEnv)) {
    return homeConfigEnv;
  }

  // 5. 用户主目录下的隐藏文件
  const homeEnv = path.join(os.homedir(), '.zotero-headless.env');
  if (fs.existsSync(homeEnv)) {
    return homeEnv;
  }

  // 找不到任何 .env 文件，返回默认路径（用于错误提示）
  return cwdEnv;
}

const envPath = findEnvFile();
if (envPath && fs.existsSync(envPath)) {
  config({ path: envPath });
}

// 配置验证 Schema
const ConfigSchema = z.object({
  zotero: z.object({
    apiKey: z.string().min(1, 'ZOTERO_API_KEY is required'),
    userId: z.string().min(1, 'ZOTERO_USER_ID is required'),
  }),
  database: z.object({
    path: z.string().default('./data/zotero.sqlite'),
  }),
  log: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * 加载并验证配置
 */
export function loadConfig(): Config {
  const rawConfig = {
    zotero: {
      apiKey: process.env.ZOTERO_API_KEY,
      userId: process.env.ZOTERO_USER_ID,
    },
    database: {
      path: process.env.DATABASE_PATH,
    },
    log: {
      level: process.env.LOG_LEVEL,
    },
  };

  const result = ConfigSchema.safeParse(rawConfig);
  
  if (!result.success) {
    console.error('❌ Configuration error:');
    // Handle different Zod error formats
    const errors = result.error.errors || result.error.issues || [];
    if (errors.length > 0) {
      errors.forEach((error: any) => {
        const path = error.path?.join('.') || 'unknown';
        console.error(`  - ${path}: ${error.message}`);
      });
    } else {
      console.error('  - Invalid configuration (check environment variables)');
      console.error(`  Raw error: ${result.error}`);
    }
    console.error('\nPlease create a .env file based on .env.example');
    console.error(`Looking for .env at: ${envPath}`);
    process.exit(1);
  }

  return result.data;
}

// 导出单例配置
export const appConfig = loadConfig();
