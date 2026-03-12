import React from 'react';
import { Box, Text, Static } from 'ink';
import { OutputLineItem } from './OutputLine.js';
import { useShellState } from '../hooks/useShellState.js';
import { useVisibleLines, type VisibleLine } from '../hooks/useVisibleLines.js';
import { t } from '../i18n.js';

function RenderVisibleLine({ vl, isGroupStart }: { vl: VisibleLine; isGroupStart: boolean }) {
  if (vl.kind === 'collapsed') {
    return (
      <Box>
        <Text color="gray" dimColor>{t.collapsedLines(vl.collapsedCount!)}</Text>
      </Box>
    );
  }
  // Add a blank line before command groups to visually separate them
  if (isGroupStart) {
    return (
      <Box flexDirection="column">
        <Text>{' '}</Text>
        <OutputLineItem line={vl.line!} />
      </Box>
    );
  }
  return <OutputLineItem line={vl.line!} />;
}

export const OutputArea = React.memo(function OutputArea() {
  const { state } = useShellState();
  const visibleLines = useVisibleLines(state);

  // Determine which lines are group starts (input lines preceded by other content)
  const isGroupStart = (vl: VisibleLine, idx: number): boolean => {
    if (vl.kind !== 'line' || vl.line?.type !== 'input') return false;
    return idx > 0;
  };

  // ALL lines go through <Static> — Ink's Static internally tracks how many items
  // have been rendered and only renders the new ones (items.slice(prevLength)).
  // This prevents duplication caused by long output overflowing the terminal viewport
  // in a dynamic rendering area.
  return (
    <Static items={visibleLines}>
      {(vl, idx) => (
        <Box key={vl.key}>
          <RenderVisibleLine vl={vl} isGroupStart={isGroupStart(vl, idx)} />
        </Box>
      )}
    </Static>
  );
});
