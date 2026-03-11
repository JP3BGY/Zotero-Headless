import React from 'react';
import { Box, Text } from 'ink';
import { OutputLineItem } from './OutputLine.js';
import { useShellState } from '../hooks/useShellState.js';
import { useTerminalLayout } from '../hooks/useScroll.js';
import { t } from '../i18n.js';

export const OutputArea = React.memo(function OutputArea() {
  const { state } = useShellState();
  const { lines, scrollOffset } = state;
  const { outputHeight } = useTerminalLayout(lines.length);

  const visibleLines = lines.slice(
    Math.max(0, lines.length - outputHeight - scrollOffset),
    lines.length - scrollOffset,
  );

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {visibleLines.map(line => (
        <OutputLineItem key={line.id} line={line} />
      ))}
      {scrollOffset > 0 && (
        <Text color="gray">{t.scrollHint}</Text>
      )}
    </Box>
  );
});
