import { useRef, useCallback } from 'react';

class HistoryManager {
  private history: string[] = [];
  private index = -1;

  add(command: string) {
    if (command.trim() && this.history[this.history.length - 1] !== command) {
      this.history.push(command);
    }
    this.index = this.history.length;
  }

  previous(): string | null {
    if (this.index > 0) {
      this.index--;
      return this.history[this.index];
    }
    return null;
  }

  next(): string | null {
    if (this.index < this.history.length - 1) {
      this.index++;
      return this.history[this.index];
    }
    this.index = this.history.length;
    return null;
  }
}

export function useHistory() {
  const manager = useRef(new HistoryManager());

  const add = useCallback((command: string) => {
    manager.current.add(command);
  }, []);

  const previous = useCallback((): string | null => {
    return manager.current.previous();
  }, []);

  const next = useCallback((): string | null => {
    return manager.current.next();
  }, []);

  return { add, previous, next };
}
