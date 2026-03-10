import React from 'react';
import { Box, Text } from 'ink';
import type { OutputLine as OutputLineType } from '../types.js';

const colorMap: Record<OutputLineType['type'], string | undefined> = {
  input: 'cyan',
  output: undefined,
  error: 'red',
  info: 'yellow',
};

export const OutputLineItem = React.memo(function OutputLineItem({ line }: { line: OutputLineType }) {
  return (
    <Box>
      <Text color={colorMap[line.type]}>{line.content}</Text>
    </Box>
  );
});
