import React from 'react';
import { Box, Text } from 'ink';
import type { OutputLine as OutputLineType } from '../types.js';
import { WelcomeBanner } from './WelcomeBanner.js';
import { BULLET, TICK, CROSS, INFO } from '../constants/figures.js';

const STATUS_SYMBOLS: Record<string, { symbol: string; color: string }> = {
  pending: { symbol: BULLET, color: 'blue' },
  success: { symbol: TICK, color: 'green' },
  error: { symbol: CROSS, color: 'red' },
};

export const OutputLineItem = React.memo(function OutputLineItem({ line }: { line: OutputLineType }) {
  // Welcome banner
  if (line.type === 'welcome') {
    return <WelcomeBanner />;
  }

  // Input lines: ✔/✘/● command (bold, colored by status)
  if (line.type === 'input') {
    const st = line.status && STATUS_SYMBOLS[line.status];
    const symbol = st ? st.symbol : BULLET;
    const color = st ? st.color : 'cyan';
    return (
      <Box>
        <Text color={color}>{symbol} </Text>
        <Text bold>{line.content}</Text>
      </Box>
    );
  }

  // Info lines: ℹ message (standalone hints, goodbye, help, etc.)
  if (line.type === 'info') {
    return (
      <Box>
        <Text color="blue">{INFO} </Text>
        <Text>{line.content}</Text>
      </Box>
    );
  }

  // Error lines: ✘ message
  if (line.type === 'error') {
    return (
      <Box>
        <Text color="red">{CROSS} </Text>
        <Text color="red">{line.content}</Text>
      </Box>
    );
  }

  // Output lines: indented to align with prefixed lines above
  return (
    <Box>
      <Text>{"  "}{line.content}</Text>
    </Box>
  );
});
