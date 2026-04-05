import { useCallback, useRef } from 'react';
import {
  getAvailableCommands,
  getCommandDescriptions,
  getCommandOptions,
  getItemKeyCompletions,
  getPathCompletions,
  getShellCwd,
  needsItemKey,
  tokenizeInput,
  shellUnescape,
} from '../commands.js';
import type { CommandSuggestion, ItemKeySuggestion, PathSuggestion } from '../types.js';

const PATH_COMMANDS = new Set([
  'ls', 'cd', 'cat', 'tree', 'find', 'head', 'tail', 'stat',
  'wc', 'du', 'grep', 'mkdir', 'mv', 'cp', 'rm',
]);

export function useCompletions() {
  const descriptionsRef = useRef(getCommandDescriptions());

  const getCommandCompletions = useCallback((partial: string): CommandSuggestion[] => {
    const allCommands = getAvailableCommands();
    const matches = allCommands.filter(c => c.startsWith(partial.toLowerCase()));
    return matches.map(name => ({
      name,
      description: descriptionsRef.current.get(name) || '',
    }));
  }, []);

  const getOptionCompletions = useCallback((input: string): CommandSuggestion[] => {
    const parts = input.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase() || '';
    const lastToken = parts[parts.length - 1] || '';

    if (!cmd || !lastToken.startsWith('-')) return [];

    const options = getCommandOptions(cmd);
    const matches = options.filter(opt => opt.name.startsWith(lastToken));
    return matches.map(opt => ({
      name: opt.name,
      description: opt.description,
    }));
  }, []);

  const getItemCompletions = useCallback(async (prefix: string): Promise<ItemKeySuggestion[]> => {
    return getItemKeyCompletions(prefix);
  }, []);

  /**
   * Get filesystem path completions for the current token.
   */
  const getPathSuggestions = useCallback(async (partial: string): Promise<PathSuggestion[]> => {
    const cwd = getShellCwd();
    return getPathCompletions(partial, cwd);
  }, []);

  /**
   * Determine if the current token looks like a path argument
   * (contains '/' or the command typically takes path arguments).
   */
  const isPathToken = useCallback((cmd: string, token: string, partIndex: number): boolean => {
    if (token.startsWith('/') || token.startsWith('./') || token.startsWith('../')) return true;
    if (PATH_COMMANDS.has(cmd) && partIndex >= 1) return true;
    return false;
  }, []);

  const getSuggestionsForInput = useCallback((value: string): {
    type: 'command' | 'option' | 'itemKey' | 'path';
    sync?: CommandSuggestion[];
    asyncFn?: () => Promise<ItemKeySuggestion[] | PathSuggestion[]>;
  } | null => {
    if (!value) return null;

    const { tokens, lastToken } = tokenizeInput(value);
    const cmd = tokens[0]?.toLowerCase() || '';
    const rawLastToken = shellUnescape(lastToken);
    const effectivePartCount = lastToken === '' ? tokens.length + 1 : tokens.length;

    // Option completion: -flag
    if (rawLastToken.startsWith('-') && cmd) {
      return { type: 'option', sync: getOptionCompletions(value).slice(0, 8) };
    }

    // Path completion: show path suggestions when the token contains '/'
    // (inline suggestions while typing — don't fire on every keystroke,
    // only when the token explicitly looks like a path with '/')
    if (effectivePartCount >= 2 && rawLastToken.includes('/')) {
      return {
        type: 'path',
        asyncFn: async () => (await getPathSuggestions(lastToken)).slice(0, 12),
      };
    }

    // Item key completion: commands that take item keys
    if (needsItemKey(cmd) && effectivePartCount >= 2) {
      return {
        type: 'itemKey',
        asyncFn: async () => (await getItemCompletions(rawLastToken)).slice(0, 8),
      };
    }

    // Command name completion (only for first token)
    if (effectivePartCount <= 1) {
      return { type: 'command', sync: getCommandCompletions(value).slice(0, 8) };
    }

    return null;
  }, [getCommandCompletions, getOptionCompletions, getItemCompletions, getPathSuggestions]);

  return {
    getCommandCompletions,
    getOptionCompletions,
    getItemCompletions,
    getPathSuggestions,
    isPathToken,
    getSuggestionsForInput,
    needsItemKey,
  };
}
