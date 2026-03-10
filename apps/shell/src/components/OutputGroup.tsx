import React from 'react';
import { Box, Text } from 'ink';
import { OutputLineItem } from './OutputLine.js';
import type { OutputGroup as OutputGroupType } from '../types.js';

const lang = process.env.ZOTERO_LANG || 'zh';
const isEnglish = lang === 'en';

function formatDuration(startTime: number, endTime?: number): string {
  const ms = (endTime ?? Date.now()) - startTime;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const OutputGroupView = React.memo(function OutputGroupView({
  group,
  onToggle,
}: {
  group: OutputGroupType;
  onToggle: () => void;
}) {
  const lineCount = group.lines.length;
  const duration = formatDuration(group.startTime, group.endTime);
  const statusIcon = group.exitCode === 0 ? '✅' : '❌';

  if (group.collapsed) {
    return (
      <Box flexDirection="column">
        <Text color="cyan">{`> ${group.command}`}</Text>
        <Text color="gray">
          {`  ${statusIcon} ${lineCount} ${isEnglish ? 'lines' : '行'} (${duration})`}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {group.lines.map(line => (
        <OutputLineItem key={line.id} line={line} />
      ))}
    </Box>
  );
});
