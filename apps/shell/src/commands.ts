// Import CLI commands using relative path for npm package compatibility
// In development: uses workspace link
// In npm package: CLI is at ../../../apps/cli/dist/index.js
import { commands, type Command } from '../../cli/dist/index.js';

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
    const result = await captureConsoleOutput(() => command.execute(args), onOutput);
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
 */
export function getAvailableCommands(): string[] {
  return [
    'help', 'exit', 'quit', 'q',
    'list', 'ls', 'll',
    'search', 'find', 'f',
    'sync', 's', 'pull', 'fetch',
    'add', 'a', 'new', 'touch',
    'delete', 'rm', 'del', 'remove',
    'get', 'cat', 'view', 'show',
    'stats', 'stat', 'info', 'df',
    'verify', 'v', 'check', 'ping',
    'note', 'n', 'notes',
    'attachments', 'att', 'files',
    'export', 'e', 'out', 'save',
    'update', 'u', 'edit', 'set',
    'webdav', 'wd',
    'config', 'cfg'
  ];
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
