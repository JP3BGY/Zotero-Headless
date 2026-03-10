import React, { createContext, useContext, useReducer, useCallback, useRef } from 'react';
import type { OutputLine, CommandSuggestion, ItemKeySuggestion } from '../types.js';

export interface ShellState {
  mode: 'idle' | 'executing';
  input: string;
  inputKey: number;
  lines: OutputLine[];
  scrollOffset: number;
  suggestions: CommandSuggestion[];
  itemKeySuggestions: ItemKeySuggestion[];
}

export type ShellAction =
  | { type: 'SET_INPUT'; value: string }
  | { type: 'ADD_LINE'; lineType: OutputLine['type']; content: string }
  | { type: 'CLEAR_LINES' }
  | { type: 'SET_MODE'; mode: ShellState['mode'] }
  | { type: 'SCROLL'; delta: number; maxOffset: number }
  | { type: 'SET_SUGGESTIONS'; suggestions: CommandSuggestion[] }
  | { type: 'SET_ITEM_SUGGESTIONS'; suggestions: ItemKeySuggestion[] }
  | { type: 'RESET_INPUT' };

let lineIdCounter = 0;

function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case 'SET_INPUT':
      return { ...state, input: action.value };

    case 'ADD_LINE':
      return {
        ...state,
        lines: [...state.lines, {
          id: lineIdCounter++,
          type: action.lineType,
          content: action.content,
        }],
        scrollOffset: 0,
      };

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
