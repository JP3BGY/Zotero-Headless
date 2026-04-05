import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { TextInput } from './TextInput.js';
import { useShellState } from '../hooks/useShellState.js';
import { useElapsedTime } from '../hooks/useElapsedTime.js';

export function InputPrompt({ onInputChange }: { onInputChange: (value: string) => void }) {
  const { state, dispatch } = useShellState();
  const { mode, input, executingCommand, executingStartTime, pendingConfirm, cwd } = state;
  const isExecuting = mode === 'executing';
  const elapsed = useElapsedTime(isExecuting ? executingStartTime : null);

  // Shorten cwd for display: show last 2 segments max
  const shortCwd = cwd === '/'
    ? '/'
    : cwd.split('/').filter(Boolean).slice(-2).join('/');

  return (
    <Box>
      {pendingConfirm && <Text color="yellow">(y/N) </Text>}
      <Text color="green">zotero:{shortCwd}$ </Text>
      {isExecuting ? (
        <Box>
          <Text color="cyan"><Spinner type="dots" /></Text>
          <Text color="gray" dimColor> {executingCommand ?? '...'}</Text>
          <Text color="gray" dimColor> [{elapsed}s]</Text>
        </Box>
      ) : (
        <TextInput
          value={input}
          onChange={(value) => {
            dispatch({ type: 'SET_INPUT', value });
            onInputChange(value);
          }}
          isActive={mode === 'idle'}
        />
      )}
    </Box>
  );
}
