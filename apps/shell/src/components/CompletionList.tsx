import React from 'react';
import { Box, Text } from 'ink';
import { useShellState } from '../hooks/useShellState.js';
import { POINTER_SMALL } from '../constants/figures.js';

export const CompletionList = React.memo(function CompletionList() {
  const { state } = useShellState();
  const { suggestions, itemKeySuggestions, mode } = state;
  const isExecuting = mode === 'executing';

  const nameWidth = suggestions.length > 0
    ? Math.max(...suggestions.map(s => s.name.length)) + 2
    : 0;
  const keyWidth = itemKeySuggestions.length > 0
    ? Math.max(...itemKeySuggestions.map(s => s.key.length)) + 2
    : 0;

  return (
    <Box flexDirection="column">
      {suggestions.length > 0 && !isExecuting && (
        <>
          {suggestions.map((suggestion) => (
            <Box key={suggestion.name}>
              <Text color="gray">  {POINTER_SMALL} </Text>
              <Text color="green" bold>{suggestion.name.padEnd(nameWidth)}</Text>
              <Text color="gray">{suggestion.description}</Text>
            </Box>
          ))}
        </>
      )}
      {itemKeySuggestions.length > 0 && !isExecuting && (
        <>
          {itemKeySuggestions.map((item) => (
            <Box key={item.key}>
              <Text color="gray">  {POINTER_SMALL} </Text>
              <Text color="cyan" bold>{item.key.padEnd(keyWidth)}</Text>
              <Text color="white">{item.title}</Text>
              <Text color="gray"> ({item.itemType})</Text>
            </Box>
          ))}
        </>
      )}
    </Box>
  );
});
