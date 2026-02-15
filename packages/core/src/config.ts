import { config } from 'dotenv';
import { z } from 'zod';

// 加载 .env 文件
config();

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
    result.error.errors.forEach((error) => {
      console.error(`  - ${error.path.join('.')}: ${error.message}`);
    });
    console.error('\nPlease create a .env file based on .env.example');
    process.exit(1);
  }

  return result.data;
}

// 导出单例配置
export const appConfig = loadConfig();
