// 命令执行模块 - 将 shell 命令转发到 zotero CLI
import { execSync } from 'child_process';

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
 * 执行 zotero 命令
 */
export async function executeCommand(cmd: string, args: string[]): Promise<string> {
  // 转换命令别名
  const actualCmd = COMMAND_ALIASES[cmd] || cmd;
  
  // 构建完整命令
  const fullCommand = ['zotero', actualCmd, ...args].join(' ');
  
  try {
    // 执行命令并捕获输出
    const result = execSync(fullCommand, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60000, // 60秒超时
    });
    
    return result.trim();
  } catch (error: any) {
    if (error.stdout) {
      return error.stdout.toString().trim();
    }
    if (error.stderr) {
      return `❌ ${error.stderr.toString().trim()}`;
    }
    return `❌ 命令执行失败: ${error.message}`;
  }
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
