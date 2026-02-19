import { spawn } from 'child_process';
import { Readable } from 'stream';

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
  
  return new Promise((resolve, reject) => {
    const child = spawn('zotero', [actualCmd, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    // 实时输出
    child.stdout?.on('data', (data) => {
      const str = data.toString();
      stdout += str;
      if (onOutput) {
        onOutput(str);
      }
    });

    child.stderr?.on('data', (data) => {
      const str = data.toString();
      stderr += str;
      if (onOutput) {
        onOutput(str);
      }
    });

    child.on('close', (code) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 0
      });
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
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
