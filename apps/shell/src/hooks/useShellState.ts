import React, { createContext, useContext, useReducer, useCallback } from 'react';
import type { OutputLine, OutputGroup, CommandSuggestion, ItemKeySuggestion } from '../types.js';

export interface ShellState {
  mode: 'idle' | 'executing' | 'confirming';
  input: string;
  inputKey: number;
  lines: OutputLine[];
  groups: OutputGroup[];
  currentGroupId: number | null;
  scrollOffset: number;
  suggestions: CommandSuggestion[];
  itemKeySuggestions: ItemKeySuggestion[];
  // Executing command info (for spinner)
  executingCommand: string | null;
  executingStartTime: number | null;
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
  | { type: 'END_COMMAND'; exitCode: number }
  | { type: 'TOGGLE_GROUP'; groupId: number }
  | { type: 'SET_CONFIRM'; message: string; onConfirm: () => void; onCancel: () => void }
  | { type: 'CLEAR_CONFIRM' };

let lineIdCounter = 0;
let groupIdCounter = 0;

// Lines threshold for auto-collapsing finished groups
const COLLAPSE_THRESHOLD = 20;

function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case 'SET_INPUT':
      return { ...state, input: action.value };

    case 'ADD_LINE': {
      const line: OutputLine = {
        id: lineIdCounter++,
        type: action.lineType,
        content: action.content,
        commandId: state.currentGroupId ?? undefined,
      };

      // Also add to current group if one exists
      if (state.currentGroupId !== null) {
        const groups = state.groups.map(g =>
          g.id === state.currentGroupId
            ? { ...g, lines: [...g.lines, line] }
            : g
        );
        return { ...state, lines: [...state.lines, line], groups, scrollOffset: 0 };
      }

      return { ...state, lines: [...state.lines, line], scrollOffset: 0 };
    }

    case 'CLEAR_LINES':
      return {
        ...state,
        lines: [],
        groups: [],
        currentGroupId: null,
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
      const groupId = groupIdCounter++;
      const group: OutputGroup = {
        id: groupId,
        command: action.command,
        lines: [],
        collapsed: false,
        exitCode: 0,
        startTime: Date.now(),
      };
      return {
        ...state,
        mode: 'executing',
        currentGroupId: groupId,
        executingCommand: action.command,
        executingStartTime: Date.now(),
        groups: [...state.groups, group],
      };
    }

    case 'END_COMMAND': {
      const now = Date.now();
      // Auto-collapse groups with many lines (except current)
      const groups = state.groups.map(g => {
        if (g.id === state.currentGroupId) {
          const shouldCollapse = g.lines.length > COLLAPSE_THRESHOLD;
          return { ...g, exitCode: action.exitCode, endTime: now, collapsed: shouldCollapse };
        }
        return g;
      });
      return {
        ...state,
        mode: 'idle',
        currentGroupId: null,
        executingCommand: null,
        executingStartTime: null,
        groups,
      };
    }

    case 'TOGGLE_GROUP': {
      const groups = state.groups.map(g =>
        g.id === action.groupId ? { ...g, collapsed: !g.collapsed } : g
      );
      return { ...state, groups };
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
    groups: [],
    currentGroupId: null,
    scrollOffset: 0,
    suggestions: [],
    itemKeySuggestions: [],
    executingCommand: null,
    executingStartTime: null,
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
