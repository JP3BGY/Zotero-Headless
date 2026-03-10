import React from 'react';
import { Box, Text } from 'ink';
import { useShellState } from '../hooks/useShellState.js';
import { t } from '../i18n.js';

export const CompletionList = React.memo(function CompletionList() {
  const { state } = useShellState();
  const { suggestions, itemKeySuggestions, mode } = state;
  const isExecuting = mode === 'executing';

  return (
    <Box flexDirection="column" height={3} overflow="hidden">
      {suggestions.length > 0 && !isExecuting && (
        <>
          {suggestions.slice(0, 3).map((suggestion) => (
            <Box key={suggestion.name}>
              <Text color="gray">  </Text>
              <Text color="green" bold>{suggestion.name.padEnd(12)}</Text>
              <Text color="gray">{suggestion.description.substring(0, 50)}</Text>
              {suggestion.description.length > 50 && <Text color="gray">...</Text>}
            </Box>
          ))}
          {suggestions.length > 3 && (
            <Box>
              <Text color="gray">  {t.moreMatches(suggestions.length - 3)}</Text>
            </Box>
          )}
        </>
      )}
      {itemKeySuggestions.length > 0 && !isExecuting && (
        <>
          {itemKeySuggestions.slice(0, 3).map((item) => (
            <Box key={item.key}>
              <Text color="gray">  </Text>
              <Text color="cyan" bold>{item.key.padEnd(12)}</Text>
              <Text color="white">{item.title.substring(0, 40)}</Text>
              {item.title.length > 40 && <Text color="gray">...</Text>}
              <Text color="gray"> ({item.itemType})</Text>
            </Box>
          ))}
          {itemKeySuggestions.length > 3 && (
            <Box>
              <Text color="gray">  {t.moreMatches(itemKeySuggestions.length - 3)}</Text>
            </Box>
          )}
        </>
      )}
    </Box>
  );
});
