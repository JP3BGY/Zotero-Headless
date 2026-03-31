import { useState, useEffect, useRef } from 'react';
import { useInput } from 'ink';
import chalk from 'chalk';

export interface UseTextInputOptions {
  /** Controlled text value */
  value: string;
  /** Called when text changes */
  onChange: (value: string) => void;
  /** Whether this input is active (listens for keys). Default: true */
  isActive?: boolean;
  /** Show visual cursor indicator. Default: true */
  showCursor?: boolean;
  /** Placeholder text when empty */
  placeholder?: string;
}

export interface UseTextInputResult {
  /** Chalk-rendered string with cursor visual, for use inside <Text> */
  renderedValue: string;
  /** Current cursor position */
  cursorOffset: number;
}

/**
 * Custom text input hook replacing ink-text-input.
 *
 * Handles cursor movement, text editing (insert/delete), word navigation,
 * and Emacs-style shortcuts (Ctrl+A/E/K/U/W). Returns a chalk-rendered
 * string with cursor visualization.
 *
 * Keys handled by parent (useKeyHandler) are explicitly skipped:
 * upArrow, downArrow, return, tab, and all ctrl combos except our own.
 */
export function useTextInput({
  value,
  onChange,
  isActive = true,
  showCursor = true,
  placeholder = '',
}: UseTextInputOptions): UseTextInputResult {
  const [cursorOffset, setCursorOffset] = useState(value.length);

  // Track the last value we set via onChange to detect external changes
  // (history navigation, completion, RESET_INPUT).
  const lastInternalValue = useRef(value);

  // When value changes externally, move cursor to end.
  // When value changes from our own onChange, keep cursor where it is.
  useEffect(() => {
    if (value !== lastInternalValue.current) {
      setCursorOffset(value.length);
      lastInternalValue.current = value;
    }
  }, [value]);

  useInput((input, key) => {
    // Skip keys handled by useKeyHandler
    if (key.upArrow || key.downArrow || key.return || key.tab) {
      return;
    }

    let nextValue = value;
    let nextOffset = cursorOffset;

    // Arrow keys (check BEFORE ctrl to handle Ctrl+Arrow correctly)
    if (key.leftArrow) {
      if (key.ctrl || key.meta) {
        nextOffset = prevWordBoundary(value, cursorOffset);
      } else {
        nextOffset = Math.max(0, cursorOffset - 1);
      }
    } else if (key.rightArrow) {
      if (key.ctrl || key.meta) {
        nextOffset = nextWordBoundary(value, cursorOffset);
      } else {
        nextOffset = Math.min(value.length, cursorOffset + 1);
      }
    } else if (key.backspace || key.delete) {
      if (key.ctrl || key.meta) {
        // Delete word before cursor
        const wordStart = prevWordBoundary(value, cursorOffset);
        nextValue = value.slice(0, wordStart) + value.slice(cursorOffset);
        nextOffset = wordStart;
      } else if (cursorOffset > 0) {
        nextValue = value.slice(0, cursorOffset - 1) + value.slice(cursorOffset);
        nextOffset = cursorOffset - 1;
      }
    } else if (key.ctrl) {
      // Emacs-style line editing shortcuts
      switch (input) {
        case 'a': // Home
          nextOffset = 0;
          break;
        case 'e': // End
          nextOffset = value.length;
          break;
        case 'k': // Kill to end of line
          nextValue = value.slice(0, cursorOffset);
          break;
        case 'u': // Kill to start of line
          nextValue = value.slice(cursorOffset);
          nextOffset = 0;
          break;
        case 'w': { // Kill word before cursor
          const ws = prevWordBoundary(value, cursorOffset);
          nextValue = value.slice(0, ws) + value.slice(cursorOffset);
          nextOffset = ws;
          break;
        }
        default:
          // All other ctrl combos (ctrl+c, ctrl+l, ctrl+d, etc.):
          // skip here, let useKeyHandler handle them
          return;
      }
    } else if (key.escape) {
      return;
    } else if (input) {
      // Regular character input (including paste - Ink coalesces pasted text)
      nextValue = value.slice(0, cursorOffset) + input + value.slice(cursorOffset);
      nextOffset = cursorOffset + input.length;
    }

    nextOffset = clamp(nextOffset, 0, nextValue.length);
    setCursorOffset(nextOffset);

    if (nextValue !== value) {
      lastInternalValue.current = nextValue;
      onChange(nextValue);
    }
  }, { isActive });

  const renderedValue = renderWithCursor(
    value, cursorOffset, showCursor && isActive, placeholder,
  );

  return { renderedValue, cursorOffset };
}

function renderWithCursor(
  value: string,
  cursorOffset: number,
  showCursor: boolean,
  placeholder: string,
): string {
  if (!showCursor) {
    return value || (placeholder ? chalk.gray(placeholder) : '');
  }

  if (value.length === 0) {
    if (placeholder) {
      return chalk.inverse(placeholder[0] || ' ') + chalk.gray(placeholder.slice(1));
    }
    return chalk.inverse(' ');
  }

  let result = '';
  let i = 0;
  for (const char of value) {
    result += i === cursorOffset ? chalk.inverse(char) : char;
    i++;
  }
  if (cursorOffset >= value.length) {
    result += chalk.inverse(' ');
  }

  return result;
}

function prevWordBoundary(text: string, offset: number): number {
  if (offset === 0) return 0;
  let i = offset - 1;
  // Skip whitespace
  while (i > 0 && /\s/.test(text[i]!)) i--;
  // Skip word chars
  while (i > 0 && !/\s/.test(text[i - 1]!)) i--;
  return i;
}

function nextWordBoundary(text: string, offset: number): number {
  if (offset >= text.length) return text.length;
  let i = offset;
  // Skip word chars
  while (i < text.length && !/\s/.test(text[i]!)) i++;
  // Skip whitespace
  while (i < text.length && /\s/.test(text[i]!)) i++;
  return i;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
