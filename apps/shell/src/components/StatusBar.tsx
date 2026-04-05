import React, { useState, useEffect, useContext } from 'react';
import { Box, Text, Spacer } from 'ink';
import { formatRelativeTime } from '../utils/formatTime.js';
import { loadDbInfo, type DbInfo } from '../utils/dbInfo.js';
import { ShellContext } from '../hooks/useShellState.js';

export function StatusBar({ refreshKey }: { refreshKey?: number } = {}) {
  const ctx = useContext(ShellContext);
  const isVfs = ctx?.state.mode === 'vfs' || ctx?.state.mode === 'vfs-executing';
  const vfsCwd = ctx?.state.vfsCwd ?? '/';
  const [info, setInfo] = useState<DbInfo>(() => loadDbInfo());

  useEffect(() => {
    // Refresh status every 30s
    const timer = setInterval(() => {
      setInfo(loadDbInfo());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  // Refresh when refreshKey changes (e.g. after command completes)
  useEffect(() => {
    setInfo(loadDbInfo());
  }, [refreshKey]);

  const dbStatus = info.dbConnected ? 'connected' : 'disconnected';
  const dbColor = info.dbConnected ? 'green' : 'red';
  const syncText = info.lastSyncDate ? formatRelativeTime(info.lastSyncDate) : 'never';

  if (isVfs) {
    return (
      <Box paddingX={1}>
        <Text color="green" bold>VFS</Text>
        <Text color="gray">  cwd:</Text>
        <Text color="white">{vfsCwd}</Text>
        <Text color="gray">  db:</Text>
        <Text color={dbColor}>{dbStatus}</Text>
        <Text color="gray">  items:</Text>
        <Text color="white">{info.itemCount}</Text>
        <Spacer />
        <Text color="gray">{`↑↓=history, Ctrl+C=exit VFS, "exit"=back to CLI`}</Text>
      </Box>
    );
  }

  return (
    <Box paddingX={1}>
      <Text color="gray">user:</Text>
      <Text color="white">{info.userId}</Text>
      <Text color="gray">  db:</Text>
      <Text color={dbColor}>{dbStatus}</Text>
      <Text color="gray">  libs:</Text>
      <Text color="white">{info.libraryCount}</Text>
      <Text color="gray">  items:</Text>
      <Text color="white">{info.itemCount}</Text>
      <Text color="gray">  sync:</Text>
      <Text color="white">{syncText}</Text>
      <Spacer />
      <Text color="gray">{`Tab=complete, ↑↓=history, Ctrl+C=exit`}</Text>
    </Box>
  );
}
