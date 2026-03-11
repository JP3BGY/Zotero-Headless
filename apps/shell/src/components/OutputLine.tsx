import React from 'react';
import { Box, Text } from 'ink';
import type { OutputLine as OutputLineType } from '../types.js';

// Status indicators inspired by Claude Code TUI
const STATUS_ICONS = {
  pending: '◼',
  success: '✔',
  error: '✘',
} as const;

const STATUS_COLORS = {
  pending: '#666666',
  success: '#00cc00',
  error: '#ff0000',
} as const;

export const OutputLineItem = React.memo(function OutputLineItem({ line }: { line: OutputLineType }) {
  // Input lines show step indicators
  if (line.type === 'input' && line.status) {
    const icon = STATUS_ICONS[line.status];
    const iconColor = STATUS_COLORS[line.status];
    const textDim = line.status === 'pending';
    return (
      <Box>
        <Text color={iconColor}>{icon} </Text>
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
