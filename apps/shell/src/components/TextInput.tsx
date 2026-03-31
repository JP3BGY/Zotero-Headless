import React from 'react';
import { Text } from 'ink';
import { useTextInput, type UseTextInputOptions } from '../hooks/useTextInput.js';

type TextInputProps = Omit<UseTextInputOptions, 'showCursor'> & {
  showCursor?: boolean;
};

/**
 * Custom TextInput component — drop-in replacement for ink-text-input.
 *
 * Uses our own useTextInput hook which properly supports `isActive`
 * and avoids conflicts with other useInput handlers (useKeyHandler,
 * ConfirmPrompt, ConfigPanel).
 */
export function TextInput({
  value,
  onChange,
  isActive = true,
  showCursor = true,
  placeholder = '',
}: TextInputProps) {
  const { renderedValue } = useTextInput({
    value,
    onChange,
    isActive,
    showCursor,
    placeholder,
  });

  return <Text>{renderedValue}</Text>;
}
