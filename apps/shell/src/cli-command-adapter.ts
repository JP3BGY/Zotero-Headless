/**
 * CLI-to-bash Command Adapter
 *
 * Wraps Zotero CLI commands (which output via console.log and return void)
 * into just-bash custom commands (which return { stdout, stderr, exitCode }).
 */

import type { Command as CliCommand } from '@zotero-headless/cli';
import type { Command as BashCommand, ExecResult } from 'just-bash';

/**
 * Sentinel error thrown when a CLI command calls process.exit().
 * Caught by the adapter to convert into an exitCode.
 */
class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
    this.name = 'ProcessExitError';
  }
}

/**
 * Adapt a CLI command into a just-bash custom command.
 *
 * @param cliCmd - The CLI command to wrap
 * @param registeredName - The name/alias under which this command is registered.
 *   Passed as `invokedAs` to the CLI command's execute function so it can
 *   branch on how it was invoked (e.g., `ll` vs `list`).
 */
export function adaptCliCommand(cliCmd: CliCommand, registeredName: string): BashCommand {
  return {
    name: registeredName,
    trusted: true,
    async execute(args: string[]): Promise<ExecResult> {
      let stdout = '';
      let stderr = '';
      let exitCode = 0;

      // Save originals
      const origLog = console.log;
      const origError = console.error;
      const origWarn = console.warn;
      const origDebug = console.debug;
      const origExit = process.exit;

      try {
        // Patch console methods → accumulate stdout/stderr
        console.log = (...a: any[]) => {
          stdout += a.map(String).join(' ') + '\n';
        };
        console.error = (...a: any[]) => {
          stderr += a.map(String).join(' ') + '\n';
        };
        console.warn = (...a: any[]) => {
          stdout += a.map(String).join(' ') + '\n';
        };
        console.debug = (...a: any[]) => {
          stdout += a.map(String).join(' ') + '\n';
        };

        // Patch process.exit → throw sentinel
        process.exit = ((code?: number) => {
          throw new ProcessExitError(code ?? 0);
        }) as never;

        await cliCmd.execute(args, registeredName);
      } catch (err) {
        if (err instanceof ProcessExitError) {
          exitCode = err.code;
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          stderr += msg + '\n';
          exitCode = 1;
        }
      } finally {
        // Restore originals
        console.log = origLog;
        console.error = origError;
        console.warn = origWarn;
        console.debug = origDebug;
        process.exit = origExit;
      }

      return {
        stdout: stdout.trimEnd() ? stdout : '',
        stderr: stderr.trimEnd() ? stderr : '',
        exitCode,
      };
    },
  };
}
