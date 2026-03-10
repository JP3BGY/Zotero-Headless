import { useCallback } from 'react';
import { useInput, useApp } from 'ink';
import { useShellState } from './useShellState.js';
import { useHistory } from './useHistory.js';
import { useCompletions } from './useCompletions.js';
import { useTerminalLayout } from './useScroll.js';
import { executeCommand, highlightSearchResult, parseCommand } from '../commands.js';
import { t } from '../i18n.js';

export function useKeyHandler() {
  const { exit } = useApp();
  const { state, dispatch, addLine } = useShellState();
  const history = useHistory();
  const completions = useCompletions();
  const { maxScrollOffset } = useTerminalLayout(state.lines.length);

  const handleExecute = useCallback(async (cmd: string) => {
    if (!cmd.trim() || state.mode === 'executing') return;

    dispatch({ type: 'SET_MODE', mode: 'executing' });
    history.add(cmd);
    addLine('input', `> ${cmd}`);

    let hasRealtimeOutput = false;

    try {
      const { cmd: parsedCmd, args } = parseCommand(cmd);

      // Builtin commands
      if (parsedCmd === 'clear' || parsedCmd === 'cls') {
        dispatch({ type: 'CLEAR_LINES' });
        dispatch({ type: 'SET_MODE', mode: 'idle' });
        return;
      }
      if (parsedCmd === 'exit' || parsedCmd === 'quit' || parsedCmd === 'q') {
        addLine('info', t.goodbye);
        setTimeout(() => exit(), 500);
        dispatch({ type: 'SET_MODE', mode: 'idle' });
        return;
      }
      if (parsedCmd === 'help') {
        addLine('info', t.help);
        dispatch({ type: 'RESET_INPUT' });
        dispatch({ type: 'SET_MODE', mode: 'idle' });
        return;
      }

      // CLI command execution
      const result = await executeCommand(parsedCmd, args, (chunk) => {
        if (chunk && chunk.trim()) {
          hasRealtimeOutput = true;
          addLine('output', chunk);
        }
      });

      if (result.exitCode !== 0 && result.stderr) {
        addLine('error', result.stderr);
      } else if (!hasRealtimeOutput) {
        // Search highlight
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
      const errorMsg = error instanceof Error ? error.message : String(error);
      addLine('error', t.networkError(errorMsg));
    } finally {
      dispatch({ type: 'RESET_INPUT' });
      dispatch({ type: 'SET_MODE', mode: 'idle' });
    }
  }, [state.mode, dispatch, history, addLine, exit]);

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

  useInput((value, key) => {
    if (state.mode === 'executing') return;

    if (key.return) {
      handleExecute(state.input);
      return;
    }

    if (key.upArrow) {
      const prev = history.previous();
      if (prev !== null) dispatch({ type: 'SET_INPUT', value: prev });
      return;
    }

    if (key.downArrow) {
      const next = history.next();
      dispatch({ type: 'SET_INPUT', value: next ?? '' });
      return;
    }

    if (key.pageUp) {
      dispatch({ type: 'SCROLL', delta: 5, maxOffset: maxScrollOffset });
      return;
    }

    if (key.pageDown) {
      dispatch({ type: 'SCROLL', delta: -5, maxOffset: maxScrollOffset });
      return;
    }

    if (key.tab) {
      handleTab();
      return;
    }
  });

  return { updateSuggestions };
}
