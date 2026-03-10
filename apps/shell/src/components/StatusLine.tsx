import React from 'react';
import { Box, Text, Spacer } from 'ink';
import { t } from '../i18n.js';

export function StatusLine() {
  return (
    <Box>
      <Text color="yellow" bold>{t.welcome}</Text>
      <Spacer />
      <Text color="gray">{t.shortcuts}</Text>
    </Box>
  );
}
