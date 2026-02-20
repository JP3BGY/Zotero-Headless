import { spawn } from 'child_process';
import { Readable } from 'stream';
import { dirname, join } from 'path';

// 缓存 zotero 可执行文件路径
let zoteroPath: string | null = null;

/**
 * 查找 zotero 可执行文件
 * 尝试多种方式：直接命令、node_modules/.bin、相对路径
 */
function findZoteroExecutable(): string {
  if (zoteroPath) return zoteroPath;
  
  const { execSync } = require('child_process');
  const { existsSync } = require('fs');
  
  // 尝试 1: 使用 which/where 查找
  try {
    if (process.platform === 'win32') {
      const result = execSync('where zotero', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      const path = result.trim().split('\n')[0];
      if (path) {
        zoteroPath = path;
        return zoteroPath;
      }
    } else {
      const result = execSync('which zotero', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      const path = result.trim();
      if (path) {
        zoteroPath = path;
        return zoteroPath;
      }
    }
  } catch {
    // 忽略错误，继续尝试
  }
  
  // 尝试 2: 从 shell 的位置推断
  // shell 在 node_modules/zotero-headless/apps/shell/dist/index.js
  // zotero CLI 应该在 node_modules/zotero-headless/index.js
  // 或者 node_modules/.bin/zotero
  try {
    // 尝试 node_modules/.bin/zotero
    const binPath = join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'zotero.cmd' : 'zotero');
    if (existsSync(binPath)) {
      zoteroPath = binPath;
      return zoteroPath;
    }
  } catch {
    // 忽略错误
  }
  
  // 默认回退到 'zotero'，让系统自己找
  zoteroPath = 'zotero';
  return zoteroPath;
}

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
  
  // 查找 zotero 可执行文件
  const zoteroExe = findZoteroExecutable();
  
  // 构建 spawn 参数
  let spawnCmd: string;
  let spawnArgs: string[];
  
  if (zoteroExe === 'zotero') {
    // 没有找到 zotero 命令，尝试通过 node 运行 CLI
    const { existsSync } = require('fs');
    let cliPath: string | null = null;
    
    // 尝试从 shell 路径推断
    const shellDir = dirname(__filename);
    const possiblePaths = [
      join(shellDir, '..', '..', 'index.js'),  // shell 在 apps/shell/dist/
      join(shellDir, '..', '..', '..', 'zotero-headless', 'index.js'),
      join(process.cwd(), 'node_modules', 'zotero-headless', 'index.js'),
    ];
    
    for (const path of possiblePaths) {
      if (existsSync(path)) {
        cliPath = path;
        break;
      }
    }
    
    if (!cliPath) {
      throw new Error('Cannot find zotero CLI. Please ensure zotero-headless is properly installed.');
    }
    
    spawnCmd = process.execPath;
    spawnArgs = [cliPath, actualCmd, ...args];
  } else {
    // 直接使用找到的 zotero 命令
    spawnCmd = zoteroExe;
    spawnArgs = [actualCmd, ...args];
  }
  
  return new Promise((resolve, reject) => {
    const child = spawn(spawnCmd, spawnArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32' && !zoteroExe.endsWith('.cmd'),
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
