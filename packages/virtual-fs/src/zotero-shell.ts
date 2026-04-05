/**
 * ZoteroShell
 *
 * Wraps just-bash's Bash class with ZoteroFs mounted as the virtual filesystem.
 * Provides stateful session management (cwd persists across calls).
 */

import { Bash, type BashExecResult, type CustomCommand } from 'just-bash';
import { ZoteroFs } from './zotero-fs.js';
import { customLs, customGrep, customCat, customTree } from './custom-commands.js';
import type { CommandResult } from './types.js';

const DEFAULT_OUTPUT_LIMIT = 200_000; // ~50k tokens

export interface ZoteroShellOptions {
  /** Specific library ID to use (auto-detected if omitted) */
  libraryId?: number;
  /** Initial working directory (default: '/') */
  cwd?: string;
  /** Maximum characters for command output (default: 200000) */
  outputLimit?: number;
  /** Additional custom commands to register alongside built-in VFS commands */
  customCommands?: CustomCommand[];
}

export class ZoteroShell {
  private bash: Bash;
  private outputLimit: number;
  private cwd: string;

  constructor(options?: ZoteroShellOptions) {
    const fs = new ZoteroFs({ libraryId: options?.libraryId });

    this.cwd = options?.cwd ?? '/';

    this.bash = new Bash({
      fs,
      cwd: this.cwd,
      env: {
        HOME: '/',
        USER: 'zotero',
        SHELL: '/bin/bash',
        TERM: 'xterm-256color',
        PS1: 'zotero-vfs$ ',
      },
      customCommands: [customLs, customGrep, customCat, customTree, ...(options?.customCommands ?? [])],
    });

    this.outputLimit = options?.outputLimit ?? DEFAULT_OUTPUT_LIMIT;
  }

  /**
   * Execute a shell command against the virtual filesystem.
   * Maintains cwd across calls (just-bash resets cwd per exec).
   */
  async execute(command: string): Promise<CommandResult> {
    let result: BashExecResult;

    try {
      // Append `; pwd` to capture final working directory after execution.
      // This handles cd, cd + other commands, pipes, etc.
      const wrappedCommand = `${command}; echo __VFS_CWD__; pwd`;
      result = await this.bash.exec(wrappedCommand, { cwd: this.cwd });
    } catch (err: any) {
      return {
        stdout: '',
        stderr: err.message ?? String(err),
        exitCode: 1,
      };
    }

    // Extract the final cwd from the sentinel-delimited output
    let stdout = result.stdout;
    const sentinelIndex = stdout.lastIndexOf('__VFS_CWD__\n');
    if (sentinelIndex !== -1) {
      const cwdPart = stdout.slice(sentinelIndex + '__VFS_CWD__\n'.length).trim();
      if (cwdPart) {
        this.cwd = cwdPart;
      }
      stdout = stdout.slice(0, sentinelIndex);
      // Remove trailing newline left before sentinel
      if (stdout.endsWith('\n')) {
        stdout = stdout.slice(0, -1);
      }
    }

    let stderr = result.stderr;

    // Truncate output if needed
    if (stdout.length > this.outputLimit) {
      stdout = stdout.slice(0, this.outputLimit) +
        `\n... (output truncated at ${this.outputLimit} characters)\n`;
    }

    return {
      stdout,
      stderr,
      exitCode: result.exitCode,
    };
  }

  /**
   * Get the current working directory.
   */
  getCwd(): string {
    return this.cwd;
  }

  /**
   * Get the underlying filesystem for direct queries (e.g. path completion).
   */
  getFs(): ZoteroFs {
    return this.bash.fs as ZoteroFs;
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    // No persistent resources to clean up currently
  }
}
