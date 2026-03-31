import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { useShellState } from '../hooks/useShellState.js';
import { useElapsedTime } from '../hooks/useElapsedTime.js';
import { POINTER } from '../constants/figures.js';

export function InputPrompt({ onInputChange }: { onInputChange: (value: string) => void }) {
  const { state, dispatch } = useShellState();
  const { mode, input, inputKey, executingCommand, executingStartTime } = state;
  const isExecuting = mode === 'executing';
  const elapsed = useElapsedTime(isExecuting ? executingStartTime : null);

  return (
    <Box>
      <Text color="cyan">{POINTER} </Text>
      {isExecuting ? (
        <Box>
          <Text color="cyan"><Spinner type="dots" /></Text>
          <Text color="gray" dimColor> {executingCommand ?? '...'}</Text>
          <Text color="gray" dimColor> [{elapsed}s]</Text>
        </Box>
      ) : (
        <TextInput
          key={inputKey}
          value={input}
          onChange={(value) => {
            dispatch({ type: 'SET_INPUT', value });
            onInputChange(value);
          }}
        />
      )}
    </Box>
  );
}
