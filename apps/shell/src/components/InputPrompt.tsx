import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { useShellState } from '../hooks/useShellState.js';

export function InputPrompt({ onInputChange }: { onInputChange: (value: string) => void }) {
  const { state, dispatch } = useShellState();
  const { mode, input, inputKey } = state;
  const isExecuting = mode === 'executing';

  return (
    <Box>
      <Text color="cyan">{"> "}</Text>
      {isExecuting ? (
        <Text color="gray" dimColor>...</Text>
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
