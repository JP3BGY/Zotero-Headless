import React, { useState, useEffect, useContext } from 'react';
import { Box, Text, Spacer } from 'ink';
import { formatRelativeTime } from '../utils/formatTime.js';
import { loadDbInfo, type DbInfo } from '../utils/dbInfo.js';
import { ShellContext } from '../hooks/useShellState.js';

export function StatusBar({ refreshKey }: { refreshKey?: number } = {}) {
  const ctx = useContext(ShellContext);
  const cwd = ctx?.state.cwd ?? '/';
  const [info, setInfo] = useState<DbInfo>(() => loadDbInfo());

  useEffect(() => {
    const timer = setInterval(() => {
      setInfo(loadDbInfo());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setInfo(loadDbInfo());
  }, [refreshKey]);

  const dbStatus = info.dbConnected ? 'connected' : 'disconnected';
  const dbColor = info.dbConnected ? 'green' : 'red';
  const syncText = info.lastSyncDate ? formatRelativeTime(info.lastSyncDate) : 'never';

  return (
    <Box paddingX={1}>
      <Text color="gray">cwd:</Text>
      <Text color="white">{cwd}</Text>
      <Text color="gray">  db:</Text>
      <Text color={dbColor}>{dbStatus}</Text>
      <Text color="gray">  items:</Text>
      <Text color="white">{info.itemCount}</Text>
      <Text color="gray">  sync:</Text>
      <Text color="white">{syncText}</Text>
      <Spacer />
      <Text color="gray">{`Tab=complete, ↑↓=history, Ctrl+C=cancel/exit`}</Text>
    </Box>
  );
}
