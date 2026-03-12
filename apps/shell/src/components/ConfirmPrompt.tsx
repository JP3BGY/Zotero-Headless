import React from 'react';
import { Box, Text, useInput } from 'ink';
import { useShellState } from '../hooks/useShellState.js';
import { isEnglish } from '../i18n.js';

export function ConfirmPrompt() {
  const { state, dispatch } = useShellState();
  const { confirmMessage, confirmCallback, confirmCancelCallback } = state;

  useInput((input, key) => {
    if (state.mode !== 'confirming') return;

    if (input === 'y' || input === 'Y') {
      dispatch({ type: 'CLEAR_CONFIRM' });
      confirmCallback?.();
    } else if (input === 'n' || input === 'N' || key.escape) {
      dispatch({ type: 'CLEAR_CONFIRM' });
      confirmCancelCallback?.();
    }
  });

  if (state.mode !== 'confirming' || !confirmMessage) return null;

  return (
    <Box>
      <Text color="yellow">⚠ {confirmMessage}</Text>
      <Text color="gray"> ({isEnglish ? 'y/N' : 'y/N'})</Text>
    </Box>
  );
}
