import { useMemo } from 'react';
import { configManager } from '@zotero-headless/core';
import type { Key } from 'ink';

type Action = 'submit' | 'historyUp' | 'historyDown' | 'scrollUp' | 'scrollDown' | 'complete' | 'clear' | 'exit';

const DEFAULTS: Record<Action, string> = {
  submit: 'enter',
  historyUp: 'up',
  historyDown: 'down',
  scrollUp: 'pageup',
  scrollDown: 'pagedown',
  complete: 'tab',
  clear: 'ctrl+l',
  exit: 'ctrl+d',
};

function matchBinding(binding: string, input: string, key: Key): boolean {
  const b = binding.toLowerCase();

  if (b.startsWith('ctrl+')) {
    const ch = b.slice(5);
    return key.ctrl && input === ch;
  }

  switch (b) {
    case 'enter': case 'return': return key.return;
    case 'up': return key.upArrow;
    case 'down': return key.downArrow;
    case 'left': return key.leftArrow;
    case 'right': return key.rightArrow;
    case 'tab': return key.tab;
    case 'escape': case 'esc': return key.escape;
    case 'backspace': return key.backspace;
    case 'delete': return key.delete;
    case 'pageup': return key.pageUp;
    case 'pagedown': return key.pageDown;
    default: return input === b;
  }
}

export function useKeybindings() {
  const bindings = useMemo(() => {
    const userBindings = configManager.get('keybindings') || {};
    return { ...DEFAULTS, ...userBindings } as Record<Action, string>;
  }, []);

  return {
    match: (action: Action, input: string, key: Key) =>
      matchBinding(bindings[action], input, key),
  };
}
