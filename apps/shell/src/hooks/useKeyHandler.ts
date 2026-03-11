import { useCallback } from 'react';
import { useInput, useApp } from 'ink';
import { useShellState } from './useShellState.js';
import { useHistory } from './useHistory.js';
import { useCompletions } from './useCompletions.js';
import { useTerminalLayout } from './useScroll.js';
import { useKeybindings } from './useKeybindings.js';
import { executeCommand, highlightSearchResult, parseCommand } from '../commands.js';
import { t } from '../i18n.js';

const DELETE_COMMANDS = ['delete', 'rm', 'del', 'remove'];

export function useKeyHandler() {
  const { exit } = useApp();
  const { state, dispatch, addLine } = useShellState();
  const history = useHistory();
  const completions = useCompletions();
  const { maxScrollOffset } = useTerminalLayout(state.lines.length);
  const kb = useKeybindings();

  const runCliCommand = useCallback(async (parsedCmd: string, args: string[], originalInput: string) => {
    dispatch({ type: 'START_COMMAND', command: originalInput });

    let hasRealtimeOutput = false;
    let success = true;

    try {
      const result = await executeCommand(parsedCmd, args, (chunk) => {
        if (chunk && chunk.trim()) {
          hasRealtimeOutput = true;
          addLine('output', chunk);
        }
      });

      success = result.exitCode === 0;

      if (result.exitCode !== 0 && result.stderr) {
        addLine('error', result.stderr);
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
      addLine('error', t.networkError(errorMsg));
    } finally {
      dispatch({ type: 'END_COMMAND', success });
      dispatch({ type: 'RESET_INPUT' });
    }
  }, [dispatch, addLine]);

  const handleExecute = useCallback(async (cmd: string) => {
    if (!cmd.trim() || state.mode !== 'idle') return;

    history.add(cmd);
    const { cmd: parsedCmd, args } = parseCommand(cmd);

    // Builtin commands (no group tracking needed)
    if (parsedCmd === 'clear' || parsedCmd === 'cls') {
      dispatch({ type: 'CLEAR_LINES' });
      return;
    }
    if (parsedCmd === 'exit' || parsedCmd === 'quit' || parsedCmd === 'q') {
      addLine('info', t.goodbye);
      setTimeout(() => exit(), 500);
      return;
    }
    if (parsedCmd === 'help') {
      addLine('info', t.help);
      dispatch({ type: 'RESET_INPUT' });
      return;
    }

    // Delete commands need confirmation
    if (DELETE_COMMANDS.includes(parsedCmd) && args.length > 0) {
      const target = args[0];
      const msg = t.confirmDelete?.(target) ??
        `Delete item "${target}"? This cannot be undone.`;
      dispatch({
        type: 'SET_CONFIRM',
        message: msg,
        onConfirm: () => { runCliCommand(parsedCmd, args, cmd); },
        onCancel: () => {
          addLine('info', t.cancelled ?? 'Cancelled.');
          dispatch({ type: 'RESET_INPUT' });
        },
      });
      return;
    }

    // Regular CLI command
    await runCliCommand(parsedCmd, args, cmd);
  }, [state.mode, dispatch, history, addLine, exit, runCliCommand]);

  const handleTab = useCallback(() => {
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
  }, [state.input, completions, dispatch]);

  const updateSuggestions = useCallback((value: string) => {
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
  }, [completions, dispatch]);

  useInput((input, key) => {
    // Confirming mode is handled by ConfirmPrompt component
    if (state.mode === 'executing' || state.mode === 'confirming') return;

    if (kb.match('submit', input, key)) {
      handleExecute(state.input);
      return;
    }

    if (kb.match('clear', input, key)) {
      dispatch({ type: 'CLEAR_LINES' });
      return;
    }

    if (kb.match('exit', input, key)) {
      addLine('info', t.goodbye);
      setTimeout(() => exit(), 500);
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

    if (kb.match('scrollUp', input, key)) {
      dispatch({ type: 'SCROLL', delta: 5, maxOffset: maxScrollOffset });
      return;
    }

    if (kb.match('scrollDown', input, key)) {
      dispatch({ type: 'SCROLL', delta: -5, maxOffset: maxScrollOffset });
      return;
    }

    if (kb.match('complete', input, key)) {
      handleTab();
      return;
    }
  });

  return { updateSuggestions };
}
