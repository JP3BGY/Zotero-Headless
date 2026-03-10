import { useCallback, useRef } from 'react';
import {
  getAvailableCommands,
  getCommandDescriptions,
  getCommandOptions,
  getItemKeyCompletions,
  needsItemKey,
} from '../commands.js';
import type { CommandSuggestion, ItemKeySuggestion } from '../types.js';

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

  const getSuggestionsForInput = useCallback((value: string): {
    type: 'command' | 'option' | 'itemKey';
    sync?: CommandSuggestion[];
    asyncFn?: () => Promise<ItemKeySuggestion[]>;
  } | null => {
    if (!value) return null;

    const parts = value.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase() || '';
    const lastToken = parts[parts.length - 1] || '';

    if (lastToken.startsWith('-') && cmd) {
      return { type: 'option', sync: getOptionCompletions(value).slice(0, 8) };
    }

    if (needsItemKey(cmd) && parts.length >= 2) {
      const arg = parts[1] || '';
      return {
        type: 'itemKey',
        asyncFn: async () => (await getItemCompletions(arg)).slice(0, 8),
      };
    }

    return { type: 'command', sync: getCommandCompletions(value).slice(0, 8) };
  }, [getCommandCompletions, getOptionCompletions, getItemCompletions]);

  return {
    getCommandCompletions,
    getOptionCompletions,
    getItemCompletions,
    getSuggestionsForInput,
    needsItemKey,
  };
}
