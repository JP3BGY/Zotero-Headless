import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { TextInput } from './TextInput.js';
import { useShellState } from '../hooks/useShellState.js';
import { useElapsedTime } from '../hooks/useElapsedTime.js';
import { POINTER } from '../constants/figures.js';

export function InputPrompt({ onInputChange }: { onInputChange: (value: string) => void }) {
  const { state, dispatch } = useShellState();
  const { mode, input, executingCommand, executingStartTime, pendingConfirm, vfsCwd } = state;
  const isExecuting = mode === 'executing' || mode === 'vfs-executing';
  const isVfs = mode === 'vfs' || mode === 'vfs-executing';
  const elapsed = useElapsedTime(isExecuting ? executingStartTime : null);

  // Shorten cwd for display: show last 2 segments max
  const shortCwd = isVfs
    ? (vfsCwd === '/' ? '/' : vfsCwd.split('/').filter(Boolean).slice(-2).join('/'))
    : null;

  return (
    <Box>
      {pendingConfirm && <Text color="yellow">(y/N) </Text>}
      {isVfs ? (
        <Text color="green">zotero-vfs:{shortCwd}$ </Text>
      ) : (
        <Text color="cyan">{POINTER} </Text>
      )}
      {isExecuting ? (
        <Box>
          <Text color="cyan"><Spinner type="dots" /></Text>
          <Text color="gray" dimColor> {executingCommand ?? '...'}</Text>
          <Text color="gray" dimColor> [{elapsed}s]</Text>
        </Box>
      ) : (
        <TextInput
          value={input}
          onChange={(value) => {
            dispatch({ type: 'SET_INPUT', value });
            onInputChange(value);
          }}
          isActive={mode === 'idle' || mode === 'vfs'}
        />
      )}
    </Box>
  );
}
