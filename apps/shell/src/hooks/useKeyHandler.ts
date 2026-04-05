import { useCallback, useRef } from 'react';
import { useInput, useApp } from 'ink';
import { useShellState } from './useShellState.js';
import { useHistory } from './useHistory.js';
import { useCompletions } from './useCompletions.js';
import { useKeybindings } from './useKeybindings.js';
import { executeCommand, executeVfsCommand, destroyVfsSession, highlightSearchResult, parseCommand } from '../commands.js';
import { configManager, appConfig } from '@zotero-headless/core';
import { t } from '../i18n.js';
import type { OutputLine } from '../types.js';
import type { LogLevel } from '../types.js';

const DELETE_COMMANDS = ['delete', 'rm', 'del', 'remove'];
const CTRL_C_WINDOW = 2000; // ms
const FLUSH_INTERVAL = 16; // ~1 frame, batch output lines to avoid Ink Static blank-line issue

export function useKeyHandler() {
  const { exit } = useApp();
  const { state, dispatch, addLine, addLines } = useShellState();
  const lastCtrlCTime = useRef(0);
  const history = useHistory();
  const completions = useCompletions();
  const kb = useKeybindings();

  // Confirm callbacks stored in refs — always current, no stale closures.
  const confirmRef = useRef<(() => void) | null>(null);
  const confirmCancelRef = useRef<(() => void) | null>(null);

  const doExit = useCallback(() => {
    addLine('info', t.goodbye);
    dispatch({ type: 'SET_MODE', mode: 'exiting' });
    setTimeout(() => exit(), 100);
  }, [addLine, dispatch, exit]);

  const runCliCommand = useCallback(async (parsedCmd: string, args: string[], originalInput: string) => {
    dispatch({ type: 'START_COMMAND', command: originalInput });

    let hasRealtimeOutput = false;
    let success = true;

    // Buffer output lines and flush in batches (~1 frame interval).
    // Ink's Static component swallows whitespace-only items during progressive
    // rendering (one item per state update). Batching ensures blank lines are
    // added alongside adjacent content in a single dispatch.
    const buffer: Array<{ type: OutputLine['type']; content: string; logLevel?: LogLevel }> = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushBuffer = () => {
      flushTimer = null;
      if (buffer.length > 0) {
        hasRealtimeOutput = true;
        addLines(buffer.splice(0));
      }
    };

    try {
      const result = await executeCommand(parsedCmd, args, (chunk: string, logLevel: LogLevel) => {
        buffer.push({ type: 'output', content: chunk, logLevel });
        if (!flushTimer) {
          flushTimer = setTimeout(flushBuffer, FLUSH_INTERVAL);
        }
      });

      // Flush any remaining buffered lines
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      flushBuffer();

      success = result.exitCode === 0;

      if (result.exitCode !== 0 && result.stderr) {
        addLine('error', result.stderr, 'error');
      } else if (!hasRealtimeOutput) {
        if ((parsedCmd === 'search' || parsedCmd === 'f' || parsedCmd === 'find') && args.length > 0) {
          const highlighted = highlightSearchResult(result.stdout, args);
          addLine(
            result.exitCode === 0 ? 'output' : 'error',
            highlighted || result.stderr || t.noResult,
          );
        } else if (result.stdout || result.stderr) {
          addLine(
            result.exitCode === 0 ? 'output' : 'error',
            result.stdout || result.stderr || t.commandDone,
          );
        }
      }
    } catch (error) {
      success = false;
      const errorMsg = error instanceof Error ? error.message : String(error);
      addLine('error', t.networkError(errorMsg), 'error');
    } finally {
      // Auto-collapse if collapseOutput is enabled and log level is not debug
      const shouldCollapse = configManager.get('display')?.collapseOutput === true
        && appConfig.log.level !== 'debug';
      dispatch({ type: 'END_COMMAND', success, autoCollapse: shouldCollapse });
      dispatch({ type: 'RESET_INPUT' });
    }
  }, [dispatch, addLine, addLines]);

  const runVfsCommand = useCallback(async (command: string) => {
    dispatch({ type: 'START_VFS_COMMAND', command });

    try {
      const result = await executeVfsCommand(command);

      // Display output
      if (result.stdout) {
        const lines = result.stdout.split('\n');
        addLines(lines.map(line => ({ type: 'output' as const, content: line })));
      }
      if (result.exitCode !== 0 && result.stderr) {
        addLine('error', result.stderr, 'error');
      }

      // Update cwd (may have changed via cd)
      dispatch({ type: 'SET_VFS_CWD', cwd: result.cwd });
      dispatch({ type: 'END_VFS_COMMAND', success: result.exitCode === 0 });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      addLine('error', errorMsg, 'error');
      dispatch({ type: 'END_VFS_COMMAND', success: false });
    } finally {
      dispatch({ type: 'RESET_INPUT' });
    }
  }, [dispatch, addLine, addLines]);

  const handleExecute = useCallback(async (cmd: string) => {
    // Handle pending confirmation — read callbacks from refs (always current)
    if (state.pendingConfirm) {
      const trimmed = cmd.trim().toLowerCase();
      const onConfirm = confirmRef.current;
      const onCancel = confirmCancelRef.current;

      // Clear refs and state first
      confirmRef.current = null;
      confirmCancelRef.current = null;
      dispatch({ type: 'CLEAR_CONFIRM' });
      dispatch({ type: 'RESET_INPUT' });

      if (trimmed === 'y' || trimmed === 'yes') {
        onConfirm?.();
      } else {
        onCancel?.();
      }
      return;
    }

    // VFS mode — route all input through ZoteroShell
    if (state.mode === 'vfs') {
      if (!cmd.trim()) return;
      history.add(cmd);

      const trimmed = cmd.trim();
      // 'exit' or 'quit' leaves VFS mode, returns to CLI mode
      if (trimmed === 'exit' || trimmed === 'quit') {
        destroyVfsSession();
        dispatch({ type: 'EXIT_VFS' });
        addLine('info', 'Exited VFS mode.');
        dispatch({ type: 'RESET_INPUT' });
        return;
      }
      if (trimmed === 'clear' || trimmed === 'cls') {
        dispatch({ type: 'CLEAR_LINES' });
        return;
      }

      await runVfsCommand(trimmed);
      return;
    }

    if (!cmd.trim() || state.mode !== 'idle') return;

    history.add(cmd);
    const { cmd: parsedCmd, args } = parseCommand(cmd);

    // Builtin commands (no group tracking needed)
    if (parsedCmd === 'clear' || parsedCmd === 'cls') {
      dispatch({ type: 'CLEAR_LINES' });
      return;
    }
    if (parsedCmd === 'exit' || parsedCmd === 'quit' || parsedCmd === 'q') {
      doExit();
      return;
    }
    if (parsedCmd === 'help') {
      addLine('info', t.help);
      dispatch({ type: 'RESET_INPUT' });
      return;
    }
    if (parsedCmd === '/config' || parsedCmd === 'config' || parsedCmd === 'cfg') {
      dispatch({ type: 'ENTER_CONFIG' });
      dispatch({ type: 'RESET_INPUT' });
      return;
    }

    // Enter VFS mode
    if (parsedCmd === 'bash' || parsedCmd === 'vfs') {
      dispatch({ type: 'ENTER_VFS' });
      addLine('info', 'Entering VFS mode. Use ls, cat, grep, etc. Type "exit" to return.');
      dispatch({ type: 'RESET_INPUT' });
      return;
    }

    // Delete commands — show question in output, respond via normal input
    if (DELETE_COMMANDS.includes(parsedCmd) && args.length > 0) {
      const target = args[0];
      const msg = t.confirmDelete?.(target) ??
        `Delete item "${target}"? This cannot be undone.`;

      // Store callbacks in refs (immune to stale closures)
      confirmRef.current = () => { runCliCommand(parsedCmd, args, cmd); };
      confirmCancelRef.current = () => {
        addLine('info', t.cancelled ?? 'Cancelled.');
      };

      addLine('info', msg);
      dispatch({ type: 'SET_CONFIRM', message: msg });
      dispatch({ type: 'RESET_INPUT' });
      return;
    }

    // Regular CLI command
    await runCliCommand(parsedCmd, args, cmd);
  }, [state.mode, state.pendingConfirm, dispatch, history, addLine, addLines, doExit, runCliCommand, runVfsCommand]);

  const handleTab = useCallback(() => {
    if (state.pendingConfirm) return; // Skip completions during confirmation

    const { input } = state;
    const parts = input.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase() || '';
    const lastToken = parts[parts.length - 1] || '';

    if (lastToken.startsWith('-') && cmd) {
      const comps = completions.getOptionCompletions(input);
      if (comps.length === 1) {
        const completed = input.replace(/\S+$/, comps[0].name);
        dispatch({ type: 'SET_INPUT', value: completed + ' ' });
        dispatch({ type: 'RESET_INPUT' });
        dispatch({ type: 'SET_INPUT', value: completed + ' ' });
      } else if (comps.length > 0) {
        dispatch({ type: 'SET_SUGGESTIONS', suggestions: comps });
      }
    } else if (completions.needsItemKey(cmd) && parts.length >= 2) {
      const arg = parts[1] || '';
      completions.getItemCompletions(arg).then(items => {
        if (items.length === 1) {
          dispatch({ type: 'SET_INPUT', value: `${cmd} ${items[0].key}` });
          dispatch({ type: 'SET_ITEM_SUGGESTIONS', suggestions: [] });
        } else if (items.length > 0) {
          dispatch({ type: 'SET_ITEM_SUGGESTIONS', suggestions: items });
        }
      });
    } else {
      const comps = completions.getCommandCompletions(input);
      if (comps.length === 1) {
        dispatch({ type: 'SET_INPUT', value: comps[0].name + ' ' });
        dispatch({ type: 'SET_SUGGESTIONS', suggestions: [] });
      } else if (comps.length > 0) {
        dispatch({ type: 'SET_SUGGESTIONS', suggestions: comps });
      }
    }
  }, [state.input, state.pendingConfirm, completions, dispatch]);

  const updateSuggestions = useCallback((value: string) => {
    if (state.pendingConfirm) return; // Skip suggestions during confirmation

    const result = completions.getSuggestionsForInput(value);
    if (!result) {
      dispatch({ type: 'SET_SUGGESTIONS', suggestions: [] });
      dispatch({ type: 'SET_ITEM_SUGGESTIONS', suggestions: [] });
      return;
    }

    if (result.type === 'itemKey' && result.asyncFn) {
      result.asyncFn().then(items => {
        dispatch({ type: 'SET_ITEM_SUGGESTIONS', suggestions: items });
      });
    } else if (result.sync) {
      if (result.type === 'option' || result.type === 'command') {
        dispatch({ type: 'SET_SUGGESTIONS', suggestions: result.sync });
      }
    }
  }, [state.pendingConfirm, completions, dispatch]);

  const handleCtrlC = useCallback(() => {
    const now = Date.now();
    const isDoublePress = now - lastCtrlCTime.current < CTRL_C_WINDOW;

    if (isDoublePress) {
      doExit();
      return;
    }

    lastCtrlCTime.current = now;

    if (state.mode === 'vfs-executing') {
      // Cancel running VFS command
      dispatch({ type: 'END_VFS_COMMAND', success: false });
      dispatch({ type: 'RESET_INPUT' });
      addLine('info', t.ctrlCHint);
    } else if (state.mode === 'vfs') {
      if (state.input.trim()) {
        // Clear current input
        dispatch({ type: 'RESET_INPUT' });
        addLine('info', t.ctrlCHint);
      } else {
        // Exit VFS mode
        destroyVfsSession();
        dispatch({ type: 'EXIT_VFS' });
        addLine('info', 'Exited VFS mode.');
        dispatch({ type: 'RESET_INPUT' });
      }
    } else if (state.mode === 'executing') {
      // Cancel running command
      dispatch({ type: 'END_COMMAND', success: false });
      dispatch({ type: 'RESET_INPUT' });
      addLine('info', t.ctrlCHint);
    } else if (state.pendingConfirm) {
      // Cancel pending confirmation
      const onCancel = confirmCancelRef.current;
      confirmRef.current = null;
      confirmCancelRef.current = null;
      dispatch({ type: 'CLEAR_CONFIRM' });
      dispatch({ type: 'RESET_INPUT' });
      onCancel?.();
      addLine('info', t.ctrlCHint);
    } else if (state.mode === 'config') {
      dispatch({ type: 'EXIT_CONFIG' });
      addLine('info', t.ctrlCHint);
    } else if (state.input.trim()) {
      // Clear current input
      dispatch({ type: 'RESET_INPUT' });
      addLine('info', t.ctrlCHint);
    } else {
      addLine('info', t.ctrlCHint);
    }
  }, [state.mode, state.input, state.pendingConfirm, dispatch, addLine, doExit]);

  useInput((input, key) => {
    // Ctrl+C: handle in all modes
    if (input === 'c' && key.ctrl) {
      handleCtrlC();
      return;
    }

    // Config mode is handled by ConfigPanel component; executing modes block input
    if (state.mode === 'executing' || state.mode === 'vfs-executing' || state.mode === 'config') return;

    if (kb.match('submit', input, key)) {
      handleExecute(state.input);
      return;
    }

    if (kb.match('clear', input, key)) {
      dispatch({ type: 'CLEAR_LINES' });
      return;
    }

    if (kb.match('exit', input, key)) {
      doExit();
      return;
    }

    if (kb.match('historyUp', input, key)) {
      const prev = history.previous();
      if (prev !== null) dispatch({ type: 'SET_INPUT', value: prev });
      return;
    }

    if (kb.match('historyDown', input, key)) {
      const next = history.next();
      dispatch({ type: 'SET_INPUT', value: next ?? '' });
      return;
    }

    if (kb.match('complete', input, key)) {
      handleTab();
      return;
    }
  });

  return { updateSuggestions };
}
