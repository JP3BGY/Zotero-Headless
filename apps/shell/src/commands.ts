import { commands, type Command, setShellMode } from '@zotero-headless/cli';
import { getRawSQLite } from '@zotero-headless/database';
import { ZoteroShell } from '@zotero-headless/virtual-fs';

import { getCliCustomCommands } from './cli-commands-registry.js';
import type { ItemKeySuggestion, PathSuggestion } from './types.js';

// Enable shell mode so permanent delete is available
setShellMode(true);

// Re-export for backward compatibility
export type ItemInfo = ItemKeySuggestion;

// ============ Shell Session (unified just-bash engine) ============

let shellSession: ZoteroShell | null = null;

/**
 * Get or create the shell session (lazy, singleton).
 * Registers both VFS commands (ls, cat, grep) and adapted CLI commands (sync, search, etc.).
 */
function getShellSession(): ZoteroShell {
  if (!shellSession) {
    shellSession = new ZoteroShell({
      customCommands: getCliCustomCommands(),
    });
  }
  return shellSession;
}

/**
 * Execute a command through the unified shell engine.
 * All input — filesystem commands (ls, cd, cat) and Zotero commands (sync, search) —
 * is routed through just-bash.
 */
export async function executeShellCommand(
  command: string,
): Promise<{ stdout: string; stderr: string; exitCode: number; cwd: string }> {
  const shell = getShellSession();
  try {
    const result = await shell.execute(command);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      cwd: shell.getCwd(),
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      stdout: '',
      stderr: errorMsg,
      exitCode: 1,
      cwd: shell.getCwd(),
    };
  }
}

/**
 * Destroy the shell session (called on exit).
 */
export function destroyShellSession(): void {
  if (shellSession) {
    shellSession.destroy();
    shellSession = null;
  }
}

// ============ Command Parsing ============

/**
 * Parse a command string into first token + remaining args.
 * Used by the TUI to detect built-in commands (clear, exit, config, delete).
 */
export function parseCommand(input: string): { cmd: string; args: string[] } {
  const parts = input.trim().split(/\s+/);
  return {
    cmd: parts[0]?.toLowerCase() || '',
    args: parts.slice(1)
  };
}

/**
 * Shell-aware tokenization: split input into tokens respecting quotes and backslash escapes.
 * Returns { tokens, lastToken, lastTokenStart } where lastToken is the raw (still-escaped)
 * final token and lastTokenStart is its character offset in the input.
 *
 * Used for tab completion to correctly identify the token being completed,
 * even when it contains quoted spaces.
 */
export function tokenizeInput(input: string): {
  tokens: string[];
  lastToken: string;
  lastTokenStart: number;
} {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let tokenStart = 0;
  let i = 0;

  for (; i < input.length; i++) {
    const ch = input[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\' && !inSingle) {
      escaped = true;
      current += ch; // Keep the backslash in the raw token
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }

    if (/\s/.test(ch) && !inSingle && !inDouble) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      tokenStart = i + 1;
      continue;
    }

    if (!current) {
      tokenStart = i;
    }
    current += ch;
  }

  if (current) {
    tokens.push(current);
  }

  // Detect trailing space → empty last token
  const hasTrailingSpace = input.length > 0 && /\s/.test(input[input.length - 1]) && !inSingle && !inDouble;

  return {
    tokens,
    lastToken: hasTrailingSpace ? '' : (current || ''),
    lastTokenStart: hasTrailingSpace ? input.length : tokenStart,
  };
}

// ============ Completions ============

// Canonical commands that need an Item Key argument (for tab completion)
const ITEM_KEY_CANONICAL = new Set([
  'delete', 'get', 'update', 'note', 'attachment', 'export',
]);

/**
 * Check if a command needs an Item Key argument (for tab completion).
 * Resolves aliases to canonical names so `show`, `edit`, `e`, `n`, etc. all trigger item completions.
 */
export function needsItemKey(cmd: string): boolean {
  if (ITEM_KEY_CANONICAL.has(cmd)) return true;
  // Resolve alias to canonical name
  const command = commands.find((c: Command) =>
    c.aliases?.includes(cmd)
  );
  return command ? ITEM_KEY_CANONICAL.has(command.name) : false;
}

/**
 * Get descriptions for all available commands (used for tab completion display).
 */
export function getCommandDescriptions(): Map<string, string> {
  const descriptions = new Map<string, string>();

  // TUI-only commands
  descriptions.set('exit', 'Exit shell');
  descriptions.set('quit', 'Exit shell');
  descriptions.set('q', 'Exit shell');
  descriptions.set('clear', 'Clear screen');
  descriptions.set('cls', 'Clear screen');
  descriptions.set('config', 'Configuration panel');
  descriptions.set('/config', 'Configuration panel');

  // Bash built-in / VFS commands
  descriptions.set('ls', 'List directory contents');
  descriptions.set('cd', 'Change directory');
  descriptions.set('pwd', 'Print working directory');
  descriptions.set('cat', 'Read file or show item summary');
  descriptions.set('grep', 'Search file contents');
  descriptions.set('find', 'Find files by name');
  descriptions.set('tree', 'Display directory tree (depth-limited)');
  descriptions.set('head', 'Show first lines of file');
  descriptions.set('tail', 'Show last lines of file');
  descriptions.set('wc', 'Count lines/words/bytes');
  descriptions.set('stat', 'Display file status');
  descriptions.set('echo', 'Print text');
  descriptions.set('du', 'Estimate file space usage');

  // CLI commands (canonical names + non-conflicting aliases)
  commands.forEach((cmd: Command) => {
    const shortDesc = cmd.description.split('.')[0];
    if (!descriptions.has(cmd.name)) {
      descriptions.set(cmd.name, shortDesc);
    }
    cmd.aliases?.forEach((alias: string) => {
      if (!descriptions.has(alias)) {
        descriptions.set(alias, shortDesc);
      }
    });
  });

  return descriptions;
}

/**
 * Get all available command names (used for tab completion).
 */
export function getAvailableCommands(): string[] {
  const commandNames = new Set<string>();

  // CLI commands + aliases
  commands.forEach((cmd: Command) => {
    commandNames.add(cmd.name);
    cmd.aliases?.forEach((alias: string) => {
      commandNames.add(alias);
    });
  });

  // Bash built-ins / VFS commands
  const bashBuiltins = [
    'ls', 'cd', 'pwd', 'cat', 'grep', 'find', 'tree', 'head', 'tail',
    'wc', 'stat', 'echo', 'du', 'sort', 'uniq', 'sed', 'awk', 'jq',
  ];
  bashBuiltins.forEach(cmd => commandNames.add(cmd));

  // TUI-only commands
  const tuiCommands = [
    'help', 'exit', 'quit', 'q', 'clear', 'cls', 'config', '/config',
  ];
  tuiCommands.forEach(cmd => commandNames.add(cmd));

  return Array.from(commandNames);
}

/**
 * Get option completions for a command (for -flag tab completion).
 */
export function getCommandOptions(cmd: string): { name: string; description: string }[] {
  // Find matching CLI command
  const command = commands.find((c: Command) =>
    c.name === cmd || c.aliases?.includes(cmd)
  );

  if (!command || !command.options) {
    return [];
  }

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

// ============ Item Key Completions (DB-backed) ============

let cachedItems: ItemInfo[] = [];
let lastCacheTime = 0;
const CACHE_TTL = 60000;

/**
 * Load items from database for tab completion (cached 60s).
 */
export async function getItemsForCompletion(): Promise<ItemInfo[]> {
  const now = Date.now();
  if (cachedItems.length > 0 && (now - lastCacheTime) < CACHE_TTL) {
    return cachedItems;
  }

  try {
    const db = getRawSQLite({ quiet: true });
    if (!db) return cachedItems;

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
      title: item.title || '(untitled)',
      itemType: item.itemType
    }));

    lastCacheTime = now;
    return cachedItems;
  } catch {
    return cachedItems;
  }
}

/**
 * Get item key completions matching a prefix.
 */
export async function getItemKeyCompletions(
  prefix: string,
  limit: number = 8
): Promise<ItemInfo[]> {
  const items = await getItemsForCompletion();
  const lowerPrefix = prefix.toLowerCase();

  const matches = items.filter(item =>
    item.key.toLowerCase().includes(lowerPrefix) ||
    item.title.toLowerCase().includes(lowerPrefix)
  );

  return matches.slice(0, limit);
}

// ============ Path Completions (VFS-backed) ============

/** Shell characters that need escaping in unquoted arguments */
const SHELL_SPECIAL = /[ \t'"\\()&|;><$!`#{}[\]*?~]/;

/** Escape a filename for safe use in shell arguments */
function shellEscape(name: string): string {
  if (!SHELL_SPECIAL.test(name)) return name;
  // Wrap in single quotes; escape existing single quotes as '\''
  return "'" + name.replace(/'/g, "'\\''") + "'";
}

/** Unescape a shell-escaped token back to a raw path */
export function shellUnescape(token: string): string {
  // Strip surrounding quotes
  if ((token.startsWith("'") && token.endsWith("'")) ||
      (token.startsWith('"') && token.endsWith('"'))) {
    return token.slice(1, -1);
  }
  // Handle partial quotes (user is mid-typing inside quotes)
  if (token.startsWith("'")) return token.slice(1);
  if (token.startsWith('"')) return token.slice(1);
  // Handle backslash escapes
  return token.replace(/\\(.)/g, '$1');
}

/**
 * Get path completions for a partial path string.
 *
 * The partial may contain shell escapes (quotes, backslashes).
 * Returns fullPath values that are properly shell-escaped.
 *
 * Examples:
 *   partial="/coll"                → "collections/"
 *   partial="/collections/Ma"      → "Machine-Learning/"
 *   partial="'/collections/My "    → "'My Collection/'"
 */
export async function getPathCompletions(
  partial: string,
  cwd: string,
  limit: number = 12,
): Promise<PathSuggestion[]> {
  const shell = getShellSession();
  const fs = shell.getFs();

  // Unescape the partial so we can query the filesystem with raw names
  const raw = shellUnescape(partial);

  // Split into directory part and prefix part
  const lastSlash = raw.lastIndexOf('/');
  let dirPart: string;
  let prefix: string;
  let dirPrefix: string; // The raw directory prefix to reconstruct fullPath

  if (lastSlash === -1) {
    dirPart = cwd;
    prefix = raw;
    dirPrefix = '';
  } else {
    const rawDir = raw.slice(0, lastSlash + 1);
    dirPart = rawDir.startsWith('/') ? rawDir : fs.resolvePath(cwd, rawDir);
    prefix = raw.slice(lastSlash + 1);
    dirPrefix = rawDir;
  }

  try {
    // Use readdirWithFileTypes to avoid N individual stat() calls
    const entries = await fs.readdirWithFileTypes(dirPart);
    const lowerPrefix = prefix.toLowerCase();

    const results: PathSuggestion[] = [];
    for (const entry of entries) {
      if (lowerPrefix && !entry.name.toLowerCase().startsWith(lowerPrefix)) continue;

      const isDir = entry.isDirectory;
      const suffix = isDir ? '/' : '';
      const escapedName = shellEscape(entry.name);
      const escapedWithSuffix = SHELL_SPECIAL.test(entry.name)
        ? escapedName + suffix
        : entry.name + suffix;

      const needsEscapeDir = SHELL_SPECIAL.test(dirPrefix.replace(/\//g, ''));
      const fullPath = dirPrefix
        ? (needsEscapeDir ? shellEscape(dirPrefix) : dirPrefix) + escapedWithSuffix
        : escapedWithSuffix;

      results.push({
        name: entry.name + suffix,
        isDirectory: isDir,
        fullPath,
      });

      if (results.length >= limit) break;
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * Get the current shell cwd (for path completion context).
 */
export function getShellCwd(): string {
  return getShellSession().getCwd();
}
