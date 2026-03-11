// @ts-nocheck
import { config } from 'dotenv';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { symbols } from './symbols.js';

// 查找 .env 文件的优先级顺序（由高到低）：
// 1. ZOTERO_ENV_PATH 环境变量指定的路径
// 2. 当前工作目录下的 .env
// 3. 可执行文件所在目录的 .env（全局安装时）
// 4. 用户主目录下的 ~/.config/zotero-headless/.env
// 5. 用户主目录下的 ~/.zotero-headless.env

/**
 * 查找所有可能的 .env 文件路径（按优先级排序）
 * @internal 导出用于测试
 */
export function findAllEnvFiles(): string[] {
  const envFiles: string[] = [];

  // 1. 环境变量指定
  if (process.env.ZOTERO_ENV_PATH && fs.existsSync(process.env.ZOTERO_ENV_PATH)) {
    envFiles.push(process.env.ZOTERO_ENV_PATH);
  }

  // 2. 当前工作目录
  const cwdEnv = path.join(process.cwd(), '.env');
  if (fs.existsSync(cwdEnv)) {
    envFiles.push(cwdEnv);
  }

  // 3. 可执行文件所在目录（用于全局安装）
  const execDir = path.dirname(process.argv[1]);
  const execEnv = path.join(execDir, '.env');
  if (fs.existsSync(execEnv)) {
    envFiles.push(execEnv);
  }

  // 4. 用户主目录下的配置目录
  const homeConfigDir = path.join(os.homedir(), '.config', 'zotero-headless');
  const homeConfigEnv = path.join(homeConfigDir, '.env');
  if (fs.existsSync(homeConfigEnv)) {
    envFiles.push(homeConfigEnv);
  }

  // 5. 用户主目录下的隐藏文件
  const homeEnv = path.join(os.homedir(), '.zotero-headless.env');
  if (fs.existsSync(homeEnv)) {
    envFiles.push(homeEnv);
  }

  return envFiles;
}

/**
 * 检查 .env 文件是否包含 Zotero 配置
 * @internal 导出用于测试
 */
export function hasZoteroConfig(envPath: string): boolean {
  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    return content.includes('ZOTERO_API_KEY') && content.includes('ZOTERO_USER_ID');
  } catch {
    return false;
  }
}

/**
 * 加载所有 .env 文件，按优先级合并配置
 * 后面的配置会覆盖前面的，但只加载包含 Zotero 配置的文件
 *
 * 特殊情况：如果设置了 ZOTERO_ENV_PATH，只加载该文件（最高优先级）
 */
function loadAllEnvFiles(): string[] {
  // 特殊处理：如果设置了 ZOTERO_ENV_PATH，只加载该文件
  if (process.env.ZOTERO_ENV_PATH && fs.existsSync(process.env.ZOTERO_ENV_PATH)) {
    config({ path: process.env.ZOTERO_ENV_PATH });
    return [process.env.ZOTERO_ENV_PATH];
  }

  const allEnvFiles = findAllEnvFiles();
  const loadedFiles: string[] = [];

  // 按优先级顺序加载，后面的覆盖前面的
  for (const envPath of allEnvFiles) {
    // 优先加载明确包含 Zotero 配置的文件
    // 或者在没有找到任何 Zotero 配置时加载所有
    config({ path: envPath, override: true });
    loadedFiles.push(envPath);
  }

  // 如果当前还没有 ZOTERO_API_KEY，尝试专门查找包含 Zotero 配置的文件
  if (!process.env.ZOTERO_API_KEY) {
    const zoteroConfigFile = allEnvFiles.find(hasZoteroConfig);
    if (zoteroConfigFile && !loadedFiles.includes(zoteroConfigFile)) {
      config({ path: zoteroConfigFile, override: true });
      loadedFiles.push(zoteroConfigFile);
    }
  }

  return loadedFiles;
}

const loadedEnvFiles = loadAllEnvFiles();

/**
 * 获取默认数据库路径
 * 默认存放在 ~/.config/zotero-headless/data/zotero.sqlite
 */
function getDefaultDatabasePath(): string {
  return path.join(os.homedir(), '.config', 'zotero-headless', 'data', 'zotero.sqlite');
}

/**
 * 解析数据库路径
 * - 如果配置了绝对路径，直接使用
 * - 如果配置了相对路径，相对于用户主目录（而不是当前工作目录）
 * - 如果没有配置，使用默认路径（固定为 ~/.config/zotero-headless/data/zotero.sqlite）
 * 
 * 注意：避免使用相对于 CWD 的路径，因为会导致数据库位置随工作目录变化
 */
function resolveDatabasePath(configPath: string | undefined): string {
  if (!configPath) {
    // 使用默认路径 - 始终是绝对路径
    return getDefaultDatabasePath();
  }

  // 如果是绝对路径，直接使用
  if (path.isAbsolute(configPath)) {
    return configPath;
  }

  // 如果是相对路径，相对于用户主目录（而不是当前工作目录）
  // 这样可以确保数据库位置固定，不随 CWD 变化
  return path.join(os.homedir(), configPath);
}

// 获取默认数据目录
function getDefaultDataDir(): string {
  return path.join(os.homedir(), '.config', 'zotero-headless');
}

// 配置验证 Schema
const ConfigSchema = z.object({
  zotero: z.object({
    apiKey: z.string().min(1, 'ZOTERO_API_KEY is required'),
    userId: z.string().min(1, 'ZOTERO_USER_ID is required'),
  }),
  database: z.object({
    path: z.string().default(getDefaultDatabasePath()),
  }),
  dataDir: z.string().default(getDefaultDataDir()),
  log: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * 加载并验证配置
 */
export function loadConfig(): Config {
  const dataDir = process.env.DATA_DIR || getDefaultDataDir();
  
  const rawConfig = {
    zotero: {
      apiKey: process.env.ZOTERO_API_KEY,
      userId: process.env.ZOTERO_USER_ID,
    },
    database: {
      path: resolveDatabasePath(process.env.DATABASE_PATH),
    },
    dataDir: dataDir,
    log: {
      level: process.env.LOG_LEVEL,
    },
  };

  const result = ConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    console.error(`${symbols.error} Configuration error:`);
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
    console.error(`Searched paths: ${loadedEnvFiles.join(', ') || 'none found'}`);
    process.exit(1);
  }

  return result.data;
}

// 导出单例配置
export const appConfig = loadConfig();
