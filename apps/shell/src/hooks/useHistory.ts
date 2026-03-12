import { useRef, useCallback } from 'react';
import { historyManager } from '@zotero-headless/core';

export function useHistory() {
  // Load previous shell commands on first render
  const commands = useRef<string[]>(historyManager.getRecentCommands(500));
  const index = useRef<number>(commands.current.length);

  const add = useCallback((command: string) => {
    if (!command.trim()) return;
    // Persist to disk
    historyManager.record({ type: 'shell_command', command });
    // Update in-memory list
    const list = commands.current;
    if (list[list.length - 1] !== command) {
      list.push(command);
    }
    index.current = list.length;
  }, []);

  const previous = useCallback((): string | null => {
    if (index.current > 0) {
      index.current--;
      return commands.current[index.current];
    }
    return null;
  }, []);

  const next = useCallback((): string | null => {
    if (index.current < commands.current.length - 1) {
      index.current++;
      return commands.current[index.current];
    }
    index.current = commands.current.length;
    return null;
  }, []);

  return { add, previous, next };
}
