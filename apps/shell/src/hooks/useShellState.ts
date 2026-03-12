import React, { createContext, useContext, useReducer, useCallback } from 'react';
import type { OutputLine, CommandSuggestion, ItemKeySuggestion, LogLevel } from '../types.js';
import { t } from '../i18n.js';

export interface ShellState {
  mode: 'idle' | 'executing' | 'confirming' | 'config' | 'exiting';
  input: string;
  inputKey: number;
  lines: OutputLine[];
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
  // Collapsed command groups (set of groupIds)
  collapsedGroups: Record<number, true>;
}

export type ShellAction =
  | { type: 'SET_INPUT'; value: string }
  | { type: 'ADD_LINE'; lineType: OutputLine['type']; content: string; logLevel?: LogLevel }
  | { type: 'CLEAR_LINES' }
  | { type: 'SET_MODE'; mode: ShellState['mode'] }
  | { type: 'SET_SUGGESTIONS'; suggestions: CommandSuggestion[] }
  | { type: 'SET_ITEM_SUGGESTIONS'; suggestions: ItemKeySuggestion[] }
  | { type: 'RESET_INPUT' }
  | { type: 'START_COMMAND'; command: string }
  | { type: 'END_COMMAND'; success: boolean; autoCollapse?: boolean }
  | { type: 'SET_CONFIRM'; message: string; onConfirm: () => void; onCancel: () => void }
  | { type: 'CLEAR_CONFIRM' }
  | { type: 'ENTER_CONFIG' }
  | { type: 'EXIT_CONFIG' }
  | { type: 'TOGGLE_GROUP'; groupId: number }
  | { type: 'EXPAND_ALL' }
  | { type: 'COLLAPSE_ALL' };

let lineIdCounter = 0;

/** Derive default logLevel from line type */
function defaultLogLevel(lineType: OutputLine['type']): LogLevel {
  switch (lineType) {
    case 'error': return 'error';
    case 'info': return 'info';
    default: return 'info';
  }
}

function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case 'SET_INPUT':
      return { ...state, input: action.value };

    case 'ADD_LINE': {
      const line: OutputLine = {
        id: lineIdCounter++,
        type: action.lineType,
        content: action.content,
        logLevel: action.logLevel ?? defaultLogLevel(action.lineType),
        // Attach to current command group if executing
        groupId: state.currentInputLineId ?? undefined,
      };
      return { ...state, lines: [...state.lines, line] };
    }

    case 'CLEAR_LINES':
      return {
        ...state,
        lines: [],
        input: '',
        suggestions: [],
        itemKeySuggestions: [],
        collapsedGroups: {},
      };

    case 'SET_MODE':
      return { ...state, mode: action.mode };

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
        groupId: inputLineId,
        logLevel: 'info',
      };
      return {
        ...state,
        mode: 'executing',
        executingCommand: action.command,
        executingStartTime: Date.now(),
        currentInputLineId: inputLineId,
        lines: [...state.lines, inputLine],
      };
    }

    case 'END_COMMAND': {
      const finalStatus = action.success ? 'success' as const : 'error' as const;
      const lines = state.currentInputLineId !== null
        ? state.lines.map(l =>
            l.id === state.currentInputLineId ? { ...l, status: finalStatus } : l
          )
        : state.lines;

      // Auto-collapse the finished group if requested
      let collapsedGroups = state.collapsedGroups;
      if (action.autoCollapse && state.currentInputLineId !== null) {
        // Only collapse if the group has output lines
        const gid = state.currentInputLineId;
        const hasOutput = lines.some(
          l => l.groupId === gid && l.type !== 'input'
        );
        if (hasOutput) {
          collapsedGroups = { ...collapsedGroups, [gid]: true };
        }
      }

      return {
        ...state,
        mode: 'idle',
        executingCommand: null,
        executingStartTime: null,
        currentInputLineId: null,
        lines,
        collapsedGroups,
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

    case 'TOGGLE_GROUP': {
      const groups = { ...state.collapsedGroups };
      if (groups[action.groupId]) {
        delete groups[action.groupId];
      } else {
        groups[action.groupId] = true;
      }
      return { ...state, collapsedGroups: groups };
    }

    case 'EXPAND_ALL':
      return { ...state, collapsedGroups: {} };

    case 'COLLAPSE_ALL': {
      // Precompute which groupIds have non-input children in a single pass
      const groupsWithChildren = new Set<number>();
      for (const l of state.lines) {
        if (l.groupId != null && l.type !== 'input') {
          groupsWithChildren.add(l.groupId);
        }
      }

      const allGroups: Record<number, true> = {};
      const seen = new Set<number>();
      for (const line of state.lines) {
        if (line.type === 'input' && line.groupId != null && !seen.has(line.groupId)) {
          seen.add(line.groupId);
          if (groupsWithChildren.has(line.groupId)) {
            allGroups[line.groupId] = true;
          }
        }
      }
      return { ...state, collapsedGroups: allGroups };
    }

    default:
      return state;
  }
}

export function createInitialState(): ShellState {
  const welcomeLines: OutputLine[] = [
    { id: lineIdCounter++, type: 'welcome', content: '', logLevel: 'info' },
  ];

  return {
    mode: 'idle',
    input: '',
    inputKey: 0,
    lines: welcomeLines,
    suggestions: [],
    itemKeySuggestions: [],
    executingCommand: null,
    executingStartTime: null,
    currentInputLineId: null,
    confirmMessage: null,
    confirmCallback: null,
    confirmCancelCallback: null,
    collapsedGroups: {},
  };
}

type ShellContextValue = {
  state: ShellState;
  dispatch: React.Dispatch<ShellAction>;
  addLine: (type: OutputLine['type'], content: string, logLevel?: LogLevel) => void;
};

const ShellContext = createContext<ShellContextValue | null>(null);

export function useShellState(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShellState must be used within ShellProvider');
  return ctx;
}

export function useShellReducer() {
  const [state, dispatch] = useReducer(shellReducer, undefined, createInitialState);
  const addLine = useCallback((type: OutputLine['type'], content: string, logLevel?: LogLevel) => {
    dispatch({ type: 'ADD_LINE', lineType: type, content, logLevel });
  }, []);
  return { state, dispatch, addLine };
}

export { ShellContext };
