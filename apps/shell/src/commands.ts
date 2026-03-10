import { commands, type Command } from '@zotero-headless/cli';
import { getRawSQLite } from '@zotero-headless/database';

import type { ItemKeySuggestion } from './types.js';

// Re-export for backward compatibility
export type ItemInfo = ItemKeySuggestion;

// 需要 Item Key 的命令列表
const ITEM_KEY_COMMANDS = [
  'rm', 'del', 'delete', 'remove',
  'get', 'cat', 'view', 'show',
  'update', 'u', 'edit', 'set',
  'note', 'n', 'notes',
  'attachments', 'att', 'files',
  'export', 'e', 'out', 'save'
];

// 缓存的 item 列表
let cachedItems: ItemInfo[] = [];
let lastCacheTime = 0;
const CACHE_TTL = 60000; // 60秒缓存

// 命令映射表
const COMMAND_ALIASES: Record<string, string> = {
  'ls': 'list',
  'll': 'list',
  'find': 'search',
  'f': 'search',
  'rm': 'delete',
  'del': 'delete',
  'remove': 'delete',
  'cat': 'get',
  'view': 'get',
  'info': 'stats',
  'stat': 'stats',
  'df': 'stats',
  's': 'sync',
  'pull': 'sync',
  'fetch': 'sync',
  'a': 'add',
  'new': 'add',
  'touch': 'add',
  'verify': 'verify',
  'v': 'verify',
  'check': 'verify',
  'ping': 'verify',
  'note': 'note',
  'n': 'note',
  'notes': 'note',
  'att': 'attachments',
  'files': 'attachments',
  'export': 'export',
  'e': 'export',
  'out': 'export',
  'save': 'export',
  'update': 'update',
  'u': 'update',
  'edit': 'update',
  'set': 'update',
  'webdav': 'webdav',
  'wd': 'webdav',
  'config': 'config',
  'cfg': 'config',
};

/**
 * 执行结果类型
 */
export interface ExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// 捕获 console 输出
function captureConsoleOutput(fn: () => Promise<void>, onOutput?: (data: string) => void): Promise<ExecuteResult> {
  const originalLog = console.log;
  const originalError = console.error;
  let stdout = '';
  let stderr = '';

  console.log = (...args: any[]) => {
    const line = args.map(a => String(a)).join(' ') + '\n';
    stdout += line;
    originalLog.apply(console, args);
    // 实时输出
    if (onOutput) {
      onOutput(line);
    }
  };

  console.error = (...args: any[]) => {
    const line = args.map(a => String(a)).join(' ') + '\n';
    stderr += line;
    originalError.apply(console, args);
    // 实时输出错误
    if (onOutput) {
      onOutput(line);
    }
  };

  return fn()
    .then(() => ({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 }))
    .catch((error) => {
      const errorMsg = error instanceof Error ? error.message : String(error);
      stderr += errorMsg + '\n';
      return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 1 };
    })
    .finally(() => {
      console.log = originalLog;
      console.error = originalError;
    });
}

/**
 * 异步执行 zotero 命令
 */
export async function executeCommand(
  cmd: string, 
  args: string[],
  onOutput?: (data: string) => void
): Promise<ExecuteResult> {
  // 转换命令别名
  const actualCmd = COMMAND_ALIASES[cmd] || cmd;
  
  // 找到对应的 CLI 命令
  const command = commands.find((c: Command) =>
    c.name === actualCmd || c.aliases?.includes(actualCmd)
  );
  
  if (!command) {
    return {
      stdout: '',
      stderr: `❌ Unknown command: ${cmd}`,
      exitCode: 1
    };
  }

  try {
    // 执行命令并捕获输出（实时输出通过 onOutput）
    // 传递原始命令名 cmd（如 'll', 'la'）以便命令区分输出格式
    const result = await captureConsoleOutput(() => command.execute(args, cmd), onOutput);
    return result;
  } catch (error) {
    // 捕获所有未处理的错误（包括网络错误）
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      stdout: '',
      stderr: `⚠️ 命令执行失败: ${errorMsg}`,
      exitCode: 1
    };
  }
}

/**
 * 获取命令描述信息（用于自动补全显示）
 */
export function getCommandDescriptions(): Map<string, string> {
  const descriptions = new Map<string, string>();
  
  // 内置命令
  descriptions.set('help', '显示帮助信息');
  descriptions.set('exit', '退出 shell');
  descriptions.set('quit', '退出 shell');
  descriptions.set('q', '退出 shell');
  descriptions.set('clear', '清除屏幕');
  descriptions.set('cls', '清除屏幕');
  
  // 从 CLI 命令中提取描述
  commands.forEach((cmd: Command) => {
    // 提取简短描述（第一句）
    const shortDesc = cmd.description.split('.')[0];
    descriptions.set(cmd.name, shortDesc);
    
    // 为别名添加相同的描述
    cmd.aliases?.forEach((alias: string) => {
      if (!descriptions.has(alias)) {
        descriptions.set(alias, shortDesc);
      }
    });
  });
  
  return descriptions;
}

/**
 * 获取可用命令列表（用于自动补全）
 * 动态从 CLI commands 数组获取，确保包含所有命令
 */
export function getAvailableCommands(): string[] {
  const commandNames = new Set<string>();
  
  // 从 CLI 命令中提取所有命令名和别名
  commands.forEach((cmd: Command) => {
    commandNames.add(cmd.name);
    cmd.aliases?.forEach((alias: string) => {
      commandNames.add(alias);
    });
  });
  
  // 添加 shell 内置命令
  const builtinCommands = [
    'help', 'exit', 'quit', 'q', 'clear', 'cls'
  ];
  builtinCommands.forEach(cmd => commandNames.add(cmd));
  
  return Array.from(commandNames);
}

/**
 * 解析命令字符串
 */
export function parseCommand(input: string): { cmd: string; args: string[] } {
  const parts = input.trim().split(/\s+/);
  return {
    cmd: parts[0]?.toLowerCase() || '',
    args: parts.slice(1)
  };
}

/**
 * 高亮搜索结果中的关键词
 */
export function highlightSearchResult(text: string, keywords: string[]): string {
  if (!keywords.length) return text;
  
  let result = text;
  for (const keyword of keywords) {
    if (!keyword) continue;
    // 使用 ANSI 转义序列高亮（在 Ink 中会显示为颜色）
    const regex = new RegExp(`(${escapeRegex(keyword)})`, 'gi');
    result = result.replace(regex, '\x1b[33m$1\x1b[0m'); // 黄色高亮
  }
  return result;
}

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 检查命令是否需要 Item Key 参数
 */
export function needsItemKey(cmd: string): boolean {
  const actualCmd = COMMAND_ALIASES[cmd] || cmd;
  return ITEM_KEY_COMMANDS.includes(actualCmd) || ITEM_KEY_COMMANDS.includes(cmd);
}

/**
 * 从数据库获取 Item 列表（带缓存）
 */
export async function getItemsForCompletion(): Promise<ItemInfo[]> {
  const now = Date.now();

  // 检查缓存是否有效
  if (cachedItems.length > 0 && (now - lastCacheTime) < CACHE_TTL) {
    return cachedItems;
  }

  try {
    const db = getRawSQLite();
    if (!db) {
      return cachedItems; // 返回旧缓存
    }

    // 使用原始 SQL 查询最近的 100 个 items
    const stmt = db.prepare(`
      SELECT key, title, item_type as itemType
      FROM items
      WHERE deleted = 0
      ORDER BY updated_at DESC
      LIMIT 100
    `);
    const result = stmt.all() as Array<{ key: string; title: string | null; itemType: string }>;

    cachedItems = result.map((item) => ({
      key: item.key,
      title: item.title || '(无标题)',
      itemType: item.itemType
    }));

    lastCacheTime = now;
    return cachedItems;
  } catch (error) {
    // 数据库查询失败，返回缓存或空数组
    console.error('Failed to load items:', error);
    return cachedItems;
  }
}

/**
 * 根据前缀匹配 Item Key
 */
export async function getItemKeyCompletions(
  prefix: string,
  limit: number = 8
): Promise<ItemInfo[]> {
  const items = await getItemsForCompletion();
  const lowerPrefix = prefix.toLowerCase();
  
  // 匹配 key 或 title 包含前缀的 items
  const matches = items.filter(item => 
    item.key.toLowerCase().includes(lowerPrefix) ||
    item.title.toLowerCase().includes(lowerPrefix)
  );
  
  return matches.slice(0, limit);
}

/**
 * 清除 Item 缓存（用于同步后刷新）
 */
export function clearItemCache(): void {
  cachedItems = [];
  lastCacheTime = 0;
}

/**
 * 获取命令的选项补全列表（带描述）
 */
export function getCommandOptions(cmd: string): { name: string; description: string }[] {
  // 转换命令别名
  const actualCmd = COMMAND_ALIASES[cmd] || cmd;
  
  // 找到对应的 CLI 命令
  const command = commands.find((c: Command) =>
    c.name === actualCmd || c.aliases?.includes(actualCmd)
  );
  
  if (!command || !command.options) {
    return [];
  }
  
  // 返回所有选项（包括长格式和短格式）及其描述
  const options: { name: string; description: string }[] = [];
  for (const opt of command.options) {
    const desc = opt.description + (opt.value ? ` (${opt.value})` : '');
    options.push({ name: opt.name, description: desc });
    if (opt.alias) {
      options.push({ name: opt.alias, description: desc });
    }
  }
  
  return options;
}
