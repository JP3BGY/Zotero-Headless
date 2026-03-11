import React, { createContext, useContext, useReducer, useCallback } from 'react';
import type { OutputLine, CommandSuggestion, ItemKeySuggestion } from '../types.js';

export interface ShellState {
  mode: 'idle' | 'executing' | 'confirming' | 'config';
  input: string;
  inputKey: number;
  lines: OutputLine[];
  scrollOffset: number;
  suggestions: CommandSuggestion[];
  itemKeySuggestions: ItemKeySuggestion[];
  // Executing command info (for spinner)
  executingCommand: string | null;
  executingStartTime: number | null;
  // ID of the input line for the currently executing command
  currentInputLineId: number | null;
  // Confirm prompt
  confirmMessage: string | null;
  confirmCallback: (() => void) | null;
  confirmCancelCallback: (() => void) | null;
}

export type ShellAction =
  | { type: 'SET_INPUT'; value: string }
  | { type: 'ADD_LINE'; lineType: OutputLine['type']; content: string }
  | { type: 'CLEAR_LINES' }
  | { type: 'SET_MODE'; mode: ShellState['mode'] }
  | { type: 'SCROLL'; delta: number; maxOffset: number }
  | { type: 'SET_SUGGESTIONS'; suggestions: CommandSuggestion[] }
  | { type: 'SET_ITEM_SUGGESTIONS'; suggestions: ItemKeySuggestion[] }
  | { type: 'RESET_INPUT' }
  | { type: 'START_COMMAND'; command: string }
  | { type: 'END_COMMAND'; success: boolean }
  | { type: 'SET_CONFIRM'; message: string; onConfirm: () => void; onCancel: () => void }
  | { type: 'CLEAR_CONFIRM' }
  | { type: 'ENTER_CONFIG' }
  | { type: 'EXIT_CONFIG' };

let lineIdCounter = 0;

function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case 'SET_INPUT':
      return { ...state, input: action.value };

    case 'ADD_LINE': {
      const line: OutputLine = {
        id: lineIdCounter++,
        type: action.lineType,
        content: action.content,
      };
      return { ...state, lines: [...state.lines, line], scrollOffset: 0 };
    }

    case 'CLEAR_LINES':
      return {
        ...state,
        lines: [],
        input: '',
        suggestions: [],
        itemKeySuggestions: [],
      };

    case 'SET_MODE':
      return { ...state, mode: action.mode };

    case 'SCROLL':
      return {
        ...state,
        scrollOffset: Math.max(0, Math.min(
          state.scrollOffset + action.delta,
          action.maxOffset,
        )),
      };

    case 'SET_SUGGESTIONS':
      return { ...state, suggestions: action.suggestions, itemKeySuggestions: [] };

    case 'SET_ITEM_SUGGESTIONS':
      return { ...state, itemKeySuggestions: action.suggestions, suggestions: [] };

    case 'RESET_INPUT':
      return {
        ...state,
        input: '',
        inputKey: state.inputKey + 1,
        suggestions: [],
        itemKeySuggestions: [],
      };

    case 'START_COMMAND': {
      const inputLineId = lineIdCounter++;
      const inputLine: OutputLine = {
        id: inputLineId,
        type: 'input',
        content: action.command,
        status: 'pending',
      };
      return {
        ...state,
        mode: 'executing',
        executingCommand: action.command,
        executingStartTime: Date.now(),
        currentInputLineId: inputLineId,
        lines: [...state.lines, inputLine],
        scrollOffset: 0,
      };
    }

    case 'END_COMMAND': {
      const finalStatus = action.success ? 'success' as const : 'error' as const;
      const lines = state.currentInputLineId !== null
        ? state.lines.map(l =>
            l.id === state.currentInputLineId ? { ...l, status: finalStatus } : l
          )
        : state.lines;
      return {
        ...state,
        mode: 'idle',
        executingCommand: null,
        executingStartTime: null,
        currentInputLineId: null,
        lines,
      };
    }

    case 'SET_CONFIRM':
      return {
        ...state,
        mode: 'confirming',
        confirmMessage: action.message,
        confirmCallback: action.onConfirm,
        confirmCancelCallback: action.onCancel,
      };

    case 'CLEAR_CONFIRM':
      return {
        ...state,
        mode: 'idle',
        confirmMessage: null,
        confirmCallback: null,
        confirmCancelCallback: null,
      };

    case 'ENTER_CONFIG':
      return { ...state, mode: 'config' };

    case 'EXIT_CONFIG':
      return { ...state, mode: 'idle' };

    default:
      return state;
  }
}

export function createInitialState(): ShellState {
  return {
    mode: 'idle',
    input: '',
    inputKey: 0,
    lines: [],
    scrollOffset: 0,
    suggestions: [],
    itemKeySuggestions: [],
    executingCommand: null,
    executingStartTime: null,
    currentInputLineId: null,
    confirmMessage: null,
    confirmCallback: null,
    confirmCancelCallback: null,
  };
}

type ShellContextValue = {
  state: ShellState;
  dispatch: React.Dispatch<ShellAction>;
  addLine: (type: OutputLine['type'], content: string) => void;
};

const ShellContext = createContext<ShellContextValue | null>(null);

export function useShellState(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShellState must be used within ShellProvider');
  return ctx;
}

export function useShellReducer() {
  const [state, dispatch] = useReducer(shellReducer, undefined, createInitialState);
  const addLine = useCallback((type: OutputLine['type'], content: string) => {
    dispatch({ type: 'ADD_LINE', lineType: type, content });
  }, []);
  return { state, dispatch, addLine };
}

export { ShellContext };
