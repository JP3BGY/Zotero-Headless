import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { useShellState } from '../hooks/useShellState.js';
import { t } from '../i18n.js';

export function InputPrompt({ onInputChange }: { onInputChange: (value: string) => void }) {
  const { state, dispatch } = useShellState();
  const { mode, input, inputKey } = state;
  const isExecuting = mode === 'executing';

  return (
    <Box>
      <Text color={isExecuting ? "gray" : "cyan"}>
        {isExecuting ? "⏳ " : "> "}
      </Text>
      {!isExecuting && (
        <TextInput
          key={inputKey}
          value={input}
          onChange={(value) => {
            dispatch({ type: 'SET_INPUT', value });
            onInputChange(value);
          }}
        />
      )}
      {isExecuting && <Text color="gray">{t.executing}</Text>}
    </Box>
  );
}
