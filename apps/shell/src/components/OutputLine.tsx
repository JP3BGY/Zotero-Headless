import React from 'react';
import { Box, Text } from 'ink';
import type { OutputLine as OutputLineType } from '../types.js';
import { WelcomeBanner } from './WelcomeBanner.js';

const BULLET = '⏺';

const STATUS_COLORS: Record<string, string> = {
  pending: 'blue',
  success: 'green',
  error: 'red',
};

export const OutputLineItem = React.memo(function OutputLineItem({ line }: { line: OutputLineType }) {
  // Welcome banner
  if (line.type === 'welcome') {
    return <WelcomeBanner />;
  }

  // Input lines: ⏺ command (bold, colored)
  if (line.type === 'input') {
    return (
      <Box>
        <Text color={line.status ? STATUS_COLORS[line.status] ?? 'cyan' : 'cyan'}>{BULLET} </Text>
        <Text bold>{line.content}</Text>
      </Box>
    );
  }

  // Info lines: ⏺ message (standalone hints, goodbye, help, etc.)
  if (line.type === 'info') {
    return (
      <Box>
        <Text color="yellow">{BULLET} </Text>
        <Text color="yellow">{line.content}</Text>
      </Box>
    );
  }

  // Error lines
  if (line.type === 'error') {
    return (
      <Box>
        <Text color="red">{line.content}</Text>
      </Box>
    );
  }

  // Output lines: directly under the command, no extra indent
  return (
    <Box>
      <Text>{line.content}</Text>
    </Box>
  );
});
