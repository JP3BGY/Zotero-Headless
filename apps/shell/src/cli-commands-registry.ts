/**
 * CLI Commands Registry
 *
 * Adapts all Zotero CLI commands into just-bash custom commands.
 * Handles alias conflicts: CLI aliases that collide with bash built-ins
 * or VFS custom commands (ls, cat, find, stat, rm, mv, touch) are skipped.
 */

import { commands, type Command as CliCommand } from '@zotero-headless/cli';
import type { Command as BashCommand } from 'just-bash';
import { adaptCliCommand } from './cli-command-adapter.js';
import { shellHelpCommand } from './shell-help-command.js';

/**
 * CLI aliases that conflict with just-bash built-in commands or VFS custom
 * overrides. These are NOT registered — users use the canonical CLI name instead.
 *
 * Rationale:
 *   ls/ll/la/lsu → VFS custom ls (shows item titles)
 *   cat/view     → bash built-in cat (reads virtual files)
 *   find         → bash built-in find
 *   stat/df      → bash built-in stat
 *   rm/del/remove→ bash built-in rm
 *   mv           → bash built-in mv
 *   touch        → bash built-in touch
 *   set          → bash built-in (shell variable assignment)
 *   file/files   → bash built-in file
 *   env          → bash built-in env
 *   echo         → bash built-in echo
 *   history      → bash built-in history
 *   help         → overridden by shell-help-command
 *   clear/cls    → handled by TUI directly
 *   config/cfg   → handled by TUI directly
 */
const CONFLICTING_NAMES = new Set([
  // bash built-ins / VFS overrides
  'ls', 'll', 'la', 'lsu',
  'cat', 'view',
  'find', 'grep',
  'stat', 'df',
  'rm', 'del', 'remove',
  'mv',
  'touch',
  'set',
  'file', 'files',
  'env',
  'echo',
  'history',
  'help',
  // TUI-only commands
  'clear', 'cls',
  'config', 'cfg',
]);

let _cachedCommands: BashCommand[] | null = null;

/**
 * Build and return the array of just-bash custom commands
 * adapted from CLI commands. Cached after first call.
 */
export function getCliCustomCommands(): BashCommand[] {
  if (_cachedCommands) return _cachedCommands;

  const result: BashCommand[] = [];

  // Register unified help command (overrides bash built-in help)
  result.push(shellHelpCommand);

  for (const cmd of commands) {
    // Register canonical name (unless it conflicts)
    if (!CONFLICTING_NAMES.has(cmd.name)) {
      result.push(adaptCliCommand(cmd, cmd.name));
    }

    // Register non-conflicting aliases
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        if (!CONFLICTING_NAMES.has(alias)) {
          result.push(adaptCliCommand(cmd, alias));
        }
      }
    }
  }

  _cachedCommands = result;
  return result;
}
