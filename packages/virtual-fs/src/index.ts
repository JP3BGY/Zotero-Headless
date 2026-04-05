/**
 * @zotero-headless/virtual-fs
 *
 * Virtual filesystem for exploring Zotero libraries with shell commands.
 * Maps collections → directories, items → subdirectories with metadata.json,
 * abstract.txt, notes/, attachments/, annotations/.
 *
 * Two usage modes:
 * 1. Stateful session (cwd persists across calls) — for interactive use
 * 2. One-shot execution — for single-command tool calls
 */

export { ZoteroFs } from './zotero-fs.js';
export { ZoteroShell } from './zotero-shell.js';
export type { ZoteroShellOptions } from './zotero-shell.js';
export type { CommandResult, VfsSession, VfsOptions } from './types.js';
export type { CustomCommand } from 'just-bash';

import { ZoteroShell, type ZoteroShellOptions } from './zotero-shell.js';
import type { CommandResult, VfsSession, VfsOptions } from './types.js';

// ============ Session API ============

/**
 * Create a stateful VFS session where cwd persists across calls.
 *
 * @example
 * ```typescript
 * const session = createSession();
 * await session.execute('ls /collections/');
 * await session.execute('cd /collections/Machine-Learning/');
 * const result = await session.execute('ls');
 * session.destroy();
 * ```
 */
export function createSession(options?: VfsOptions): VfsSession {
  const shell = new ZoteroShell({
    libraryId: options?.libraryId,
    cwd: options?.cwd,
    outputLimit: options?.outputLimit,
  });

  return {
    execute: (command: string) => shell.execute(command),
    getCwd: () => shell.getCwd(),
    destroy: () => shell.destroy(),
  };
}

// ============ One-Shot API ============

/**
 * Execute a single command against the virtual filesystem.
 * Each call creates a fresh shell instance (no shared state).
 *
 * @example
 * ```typescript
 * const result = await executeCommand('ls /collections/');
 * console.log(result.stdout);
 *
 * const result2 = await executeCommand('cat /items/ABC123/metadata.json');
 * ```
 */
export async function executeCommand(
  command: string,
  options?: VfsOptions,
): Promise<CommandResult> {
  const shell = new ZoteroShell({
    libraryId: options?.libraryId,
    cwd: options?.cwd ?? '/',
    outputLimit: options?.outputLimit,
  });

  try {
    return await shell.execute(command);
  } finally {
    shell.destroy();
  }
}

// ============ Tool Definition ============

/**
 * Tool definition for AI agent framework integration.
 * Use this when registering the VFS as a tool in agent systems.
 *
 * @example
 * ```typescript
 * // Register with an agent framework
 * agent.registerTool(TOOL_DEFINITION, async ({ command }) => {
 *   const result = await session.execute(command);
 *   return result.stdout || result.stderr;
 * });
 * ```
 */
export const TOOL_DEFINITION = {
  name: 'zotero_shell',
  description:
    'Execute shell commands against a read-only virtual filesystem that maps your ' +
    'Zotero reference library. The filesystem structure is:\n' +
    '  /collections/<name>/  — Collection hierarchy (nested subcollections + items)\n' +
    '  /items/<key>/         — All items (flat listing)\n' +
    '  /tags/<name>/         — Items grouped by tag\n' +
    '  /types/<type>/        — Items grouped by type (journalArticle, book, etc.)\n' +
    '  /unfiled/             — Items not in any collection\n\n' +
    'Each item directory contains:\n' +
    '  metadata.json   — Structured bibliographic metadata\n' +
    '  abstract.txt    — Paper abstract\n' +
    '  notes/          — Attached notes as Markdown (.md)\n' +
    '  attachments/    — PDF/document content (extracted text)\n' +
    '  annotations/    — PDF annotations (.txt)\n\n' +
    'Supported commands: ls, cat, grep, find, tree, stat, head, tail, wc, du, pwd, cd, echo, and more.\n' +
    'The filesystem is read-only — write operations will return an error.',
  parameters: {
    type: 'object' as const,
    properties: {
      command: {
        type: 'string' as const,
        description:
          'Shell command to execute. Examples:\n' +
          '  ls /collections/\n' +
          '  cat /items/ABC123/metadata.json\n' +
          '  grep -r "neural network" /items/\n' +
          '  find /collections/ -name "*.json"\n' +
          '  tree /collections/Machine-Learning/',
      },
    },
    required: ['command'],
  },
} as const;
