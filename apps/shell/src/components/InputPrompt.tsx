import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { Spinner } from './Spinner.js';
import { useShellState } from '../hooks/useShellState.js';

export function InputPrompt({ onInputChange }: { onInputChange: (value: string) => void }) {
  const { state, dispatch } = useShellState();
  const { mode, input, inputKey, executingCommand, executingStartTime } = state;
  const isExecuting = mode === 'executing';

  if (isExecuting && executingCommand && executingStartTime) {
    return <Spinner command={executingCommand} startTime={executingStartTime} />;
  }

  return (
    <Box>
      <Text color="cyan">{"> "}</Text>
      <TextInput
        key={inputKey}
        value={input}
        onChange={(value) => {
          dispatch({ type: 'SET_INPUT', value });
          onInputChange(value);
        }}
      />
    </Box>
  );
}
