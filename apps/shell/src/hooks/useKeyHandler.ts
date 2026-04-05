import { useCallback, useRef } from 'react';
import { useInput, useApp } from 'ink';
import { useShellState } from './useShellState.js';
import { useHistory } from './useHistory.js';
import { useCompletions } from './useCompletions.js';
import { useKeybindings } from './useKeybindings.js';
import { executeShellCommand, parseCommand, tokenizeInput, shellUnescape } from '../commands.js';
import { configManager, appConfig } from '@zotero-headless/core';
import { t } from '../i18n.js';
import type { OutputLine } from '../types.js';

const DELETE_COMMANDS = ['delete'];
const CTRL_C_WINDOW = 2000; // ms

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

  /**
   * Single unified command runner — all input goes through just-bash.
   */
  const runCommand = useCallback(async (command: string) => {
    dispatch({ type: 'START_COMMAND', command });

    let success = true;

    try {
      const result = await executeShellCommand(command);

      // Display stdout
      if (result.stdout) {
        const lines = result.stdout.split('\n');
        addLines(lines.map(line => ({ type: 'output' as const, content: line })));
      }

      // Display stderr (always — may contain warnings on success, errors on failure)
      if (result.stderr) {
        const errType = result.exitCode !== 0 ? 'error' as const : 'info' as const;
        const errLevel = result.exitCode !== 0 ? 'error' as const : 'warn' as const;
        addLine(errType, result.stderr, errLevel);
      }

      // If command failed with no output at all, show a generic message
      if (result.exitCode !== 0 && !result.stdout && !result.stderr) {
        addLine('error', `Command failed with exit code ${result.exitCode}`, 'error');
      }

      success = result.exitCode === 0;

      // Update cwd (may have changed via cd)
      dispatch({ type: 'SET_CWD', cwd: result.cwd });
    } catch (error) {
      success = false;
      const errorMsg = error instanceof Error ? error.message : String(error);
      addLine('error', errorMsg, 'error');
    } finally {
      const shouldCollapse = configManager.get('display')?.collapseOutput === true
        && appConfig.log.level !== 'debug';
      dispatch({ type: 'END_COMMAND', success, autoCollapse: shouldCollapse });
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

    if (!cmd.trim() || state.mode !== 'idle') return;

    history.add(cmd);
    const trimmed = cmd.trim();
    const { cmd: parsedCmd, args } = parseCommand(trimmed);

    // TUI-only commands (handled locally, never reach just-bash)
    if (parsedCmd === 'clear' || parsedCmd === 'cls') {
      dispatch({ type: 'CLEAR_LINES' });
      return;
    }
    if (parsedCmd === 'exit' || parsedCmd === 'quit' || parsedCmd === 'q') {
      doExit();
      return;
    }
    if (parsedCmd === 'help') {
      // Route to just-bash help command (registered as custom command)
      await runCommand(trimmed);
      return;
    }
    if (parsedCmd === '/config' || parsedCmd === 'config' || parsedCmd === 'cfg') {
      dispatch({ type: 'ENTER_CONFIG' });
      dispatch({ type: 'RESET_INPUT' });
      return;
    }

    // Delete confirmation — intercept at TUI level, then route through bash
    if (DELETE_COMMANDS.includes(parsedCmd) && args.length > 0) {
      const target = args[0];
      const msg = t.confirmDelete?.(target) ??
        `Delete item "${target}"? This cannot be undone.`;

      // On confirm: send "delete <args> --yes" through bash to skip CLI's own prompt
      confirmRef.current = () => {
        const confirmCmd = args.includes('--yes') || args.includes('-y')
          ? trimmed
          : `${trimmed} --yes`;
        runCommand(confirmCmd);
      };
      confirmCancelRef.current = () => {
        addLine('info', t.cancelled ?? 'Cancelled.');
      };

      addLine('info', msg);
      dispatch({ type: 'SET_CONFIRM', message: msg });
      dispatch({ type: 'RESET_INPUT' });
      return;
    }

    // Everything else — route through just-bash
    await runCommand(trimmed);
  }, [state.mode, state.pendingConfirm, dispatch, history, addLine, doExit, runCommand]);

  const handleTab = useCallback(() => {
    if (state.pendingConfirm) return;

    const { input } = state;
    const { tokens, lastToken, lastTokenStart } = tokenizeInput(input);
    const cmd = tokens[0]?.toLowerCase() || '';
    const effectivePartCount = lastToken === '' ? tokens.length + 1 : tokens.length;
    // Unescaped version of the token for matching against filesystem / commands
    const rawLastToken = shellUnescape(lastToken);

    // 1. Option completion: --flag / -f
    if (rawLastToken.startsWith('-') && cmd) {
      const comps = completions.getOptionCompletions(input);
      if (comps.length === 1) {
        const completed = input.slice(0, lastTokenStart) + comps[0].name + ' ';
        dispatch({ type: 'SET_INPUT', value: completed });
        dispatch({ type: 'RESET_INPUT' });
        dispatch({ type: 'SET_INPUT', value: completed });
      } else if (comps.length > 0) {
        dispatch({ type: 'SET_SUGGESTIONS', suggestions: comps });
      }
      return;
    }

    // 2. Path completion: second+ argument that looks like a path
    if (effectivePartCount >= 2 && completions.isPathToken(cmd, rawLastToken, effectivePartCount - 1)) {
      completions.getPathSuggestions(lastToken).then(paths => {
        if (paths.length === 1) {
          const suffix = paths[0].isDirectory ? '' : ' ';
          dispatch({ type: 'SET_INPUT', value: input.slice(0, lastTokenStart) + paths[0].fullPath + suffix });
          dispatch({ type: 'SET_SUGGESTIONS', suggestions: [] });
        } else if (paths.length > 0) {
          dispatch({
            type: 'SET_SUGGESTIONS',
            suggestions: paths.map(p => ({
              name: p.name,
              description: p.isDirectory ? 'directory' : 'file',
            })),
          });
        }
      });
      return;
    }

    // 3. Item key completion: commands that need item keys
    if (completions.needsItemKey(cmd) && effectivePartCount >= 2) {
      completions.getItemCompletions(rawLastToken).then(items => {
        if (items.length === 1) {
          dispatch({ type: 'SET_INPUT', value: input.slice(0, lastTokenStart) + items[0].key + ' ' });
          dispatch({ type: 'SET_ITEM_SUGGESTIONS', suggestions: [] });
        } else if (items.length > 0) {
          dispatch({ type: 'SET_ITEM_SUGGESTIONS', suggestions: items });
        }
      });
      return;
    }

    // 4. Command name completion
    const comps = completions.getCommandCompletions(input);
    if (comps.length === 1) {
      dispatch({ type: 'SET_INPUT', value: comps[0].name + ' ' });
      dispatch({ type: 'SET_SUGGESTIONS', suggestions: [] });
    } else if (comps.length > 0) {
      dispatch({ type: 'SET_SUGGESTIONS', suggestions: comps });
    }
  }, [state.input, state.pendingConfirm, completions, dispatch]);

  const updateSuggestions = useCallback((value: string) => {
    if (state.pendingConfirm) return;

    const result = completions.getSuggestionsForInput(value);
    if (!result) {
      dispatch({ type: 'SET_SUGGESTIONS', suggestions: [] });
      dispatch({ type: 'SET_ITEM_SUGGESTIONS', suggestions: [] });
      return;
    }

    if (result.type === 'path' && result.asyncFn) {
      result.asyncFn().then(paths => {
        const pathSuggestions = (paths as import('../types.js').PathSuggestion[]);
        dispatch({
          type: 'SET_SUGGESTIONS',
          suggestions: pathSuggestions.map(p => ({
            name: p.name,
            description: p.isDirectory ? 'directory' : 'file',
          })),
        });
      });
    } else if (result.type === 'itemKey' && result.asyncFn) {
      result.asyncFn().then(items => {
        dispatch({ type: 'SET_ITEM_SUGGESTIONS', suggestions: items as import('../types.js').ItemKeySuggestion[] });
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

    if (state.mode === 'executing') {
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

    // Config mode is handled by ConfigPanel component; executing blocks input
    if (state.mode === 'executing' || state.mode === 'config') return;

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
