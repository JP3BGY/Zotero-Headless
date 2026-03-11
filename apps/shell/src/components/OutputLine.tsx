import React from 'react';
import { Box, Text } from 'ink';
import { symbols } from '@zotero-headless/core';
import type { OutputLine as OutputLineType } from '../types.js';

const STATUS_SYMBOLS = {
  pending: symbols.pending,
  success: symbols.success,
  error: symbols.error,
} as const;

export const OutputLineItem = React.memo(function OutputLineItem({ line }: { line: OutputLineType }) {
  // Input lines show step indicators
  if (line.type === 'input' && line.status) {
    const icon = STATUS_SYMBOLS[line.status];
    const textDim = line.status === 'pending';
    return (
      <Box>
        <Text>{icon} </Text>
        <Text dimColor={textDim} bold={line.status === 'success'}>{line.content}</Text>
      </Box>
    );
  }

  // Regular output lines
  const colorMap: Record<OutputLineType['type'], string | undefined> = {
    input: 'cyan',
    output: undefined,
    error: 'red',
    info: 'yellow',
  };

  return (
    <Box>
      <Text color={colorMap[line.type]}>{line.content}</Text>
    </Box>
  );
});
