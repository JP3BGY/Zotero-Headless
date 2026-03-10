import React from 'react';
import { Box, Text } from 'ink';
import { OutputLineItem } from './OutputLine.js';
import { OutputGroupView } from './OutputGroup.js';
import { useShellState } from '../hooks/useShellState.js';
import { useTerminalLayout } from '../hooks/useScroll.js';
import { t } from '../i18n.js';

export const OutputArea = React.memo(function OutputArea() {
  const { state, dispatch } = useShellState();
  const { lines, groups, scrollOffset } = state;
  const { outputHeight } = useTerminalLayout(lines.length);

  // Build display: for collapsed groups, show summary; for others, show lines
  const collapsedGroupIds = new Set(
    groups.filter(g => g.collapsed).map(g => g.id)
  );

  // Build visible items: mix of regular lines and collapsed group summaries
  const displayItems: Array<{ type: 'line'; line: typeof lines[0] } | { type: 'group'; group: typeof groups[0] }> = [];
  const seenCollapsedGroups = new Set<number>();

  for (const line of lines) {
    if (line.commandId !== undefined && collapsedGroupIds.has(line.commandId)) {
      if (!seenCollapsedGroups.has(line.commandId)) {
        seenCollapsedGroups.add(line.commandId);
        const group = groups.find(g => g.id === line.commandId)!;
        displayItems.push({ type: 'group', group });
      }
      // Skip individual lines of collapsed groups
    } else {
      displayItems.push({ type: 'line', line });
    }
  }

  const visibleItems = displayItems.slice(
    Math.max(0, displayItems.length - outputHeight - scrollOffset),
    displayItems.length - scrollOffset,
  );

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {visibleItems.map((item, idx) => {
        if (item.type === 'group') {
          return (
            <OutputGroupView
              key={`g-${item.group.id}`}
              group={item.group}
              onToggle={() => dispatch({ type: 'TOGGLE_GROUP', groupId: item.group.id })}
            />
          );
        }
        return <OutputLineItem key={item.line.id} line={item.line} />;
      })}
      {scrollOffset > 0 && (
        <Text color="gray">{t.scrollHint}</Text>
      )}
    </Box>
  );
});
