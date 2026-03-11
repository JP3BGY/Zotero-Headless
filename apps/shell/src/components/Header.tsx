import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { t } from '../i18n.js';

export function Header() {
  return (
    <Box flexDirection="column">
      <Text color="yellow">{t.welcome}</Text>
      <Text color="gray">{t.subtitle}</Text>
    </Box>
  );
}

export function ShortcutHints() {
  return (
    <Box>
      <Text color="gray">{t.shortcuts}</Text>
    </Box>
  );
}

export function Divider({ title }: { title?: string } = {}) {
  const { stdout } = useStdout();
  const width = stdout.columns || 80;

  if (!title) {
    return (
      <Box>
        <Text color="gray">{'─'.repeat(width)}</Text>
      </Box>
    );
  }

  const padding = 1;
  const titleStr = ` ${title} `;
  const remaining = Math.max(0, width - titleStr.length - padding * 2);
  const left = Math.floor(remaining / 2);
  const right = remaining - left;

  return (
    <Box>
      <Text color="gray">{'─'.repeat(left)}</Text>
      <Text color="white">{titleStr}</Text>
      <Text color="gray">{'─'.repeat(right)}</Text>
    </Box>
  );
}
