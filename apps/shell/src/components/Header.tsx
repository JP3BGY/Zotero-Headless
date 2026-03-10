import React from 'react';
import { Box, Text } from 'ink';
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

export function Divider() {
  return (
    <Box>
      <Text color="gray">{''.padEnd(60, '─')}</Text>
    </Box>
  );
}
