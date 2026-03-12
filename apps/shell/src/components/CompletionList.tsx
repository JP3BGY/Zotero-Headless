import React from 'react';
import { Box, Text } from 'ink';
import { useShellState } from '../hooks/useShellState.js';

export const CompletionList = React.memo(function CompletionList() {
  const { state } = useShellState();
  const { suggestions, itemKeySuggestions, mode } = state;
  const isExecuting = mode === 'executing';

  return (
    <Box flexDirection="column">
      {suggestions.length > 0 && !isExecuting && (
        <>
          {suggestions.map((suggestion) => (
            <Box key={suggestion.name}>
              <Text color="gray">  </Text>
              <Text color="green" bold>{suggestion.name.padEnd(12)}</Text>
              <Text color="gray">{suggestion.description}</Text>
            </Box>
          ))}
        </>
      )}
      {itemKeySuggestions.length > 0 && !isExecuting && (
        <>
          {itemKeySuggestions.map((item) => (
            <Box key={item.key}>
              <Text color="gray">  </Text>
              <Text color="cyan" bold>{item.key.padEnd(12)}</Text>
              <Text color="white">{item.title}</Text>
              <Text color="gray"> ({item.itemType})</Text>
            </Box>
          ))}
        </>
      )}
    </Box>
  );
});
