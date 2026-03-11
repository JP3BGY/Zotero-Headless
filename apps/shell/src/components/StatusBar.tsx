import React, { useState, useEffect } from 'react';
import { Box, Text, Spacer } from 'ink';
import { appConfig } from '@zotero-headless/core';
import { getRawSQLite } from '@zotero-headless/database';

interface StatusInfo {
  userId: string;
  libraryCount: number;
  itemCount: number;
  lastSync: string | null;
  dbConnected: boolean;
}

function loadStatusInfo(): StatusInfo {
  const info: StatusInfo = {
    userId: appConfig.zotero.userId || '?',
    libraryCount: 0,
    itemCount: 0,
    lastSync: null,
    dbConnected: false,
  };

  try {
    const db = getRawSQLite();
    if (!db) return info;
    info.dbConnected = true;

    const libRow = db.prepare('SELECT COUNT(*) as cnt FROM libraries').get() as any;
    info.libraryCount = libRow?.cnt ?? 0;

    const itemRow = db.prepare('SELECT COUNT(*) as cnt FROM items WHERE deleted = 0').get() as any;
    info.itemCount = itemRow?.cnt ?? 0;

    const syncRow = db.prepare(
      "SELECT completed_at FROM sync_logs WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1"
    ).get() as any;
    if (syncRow?.completed_at) {
      const d = new Date(syncRow.completed_at * 1000);
      info.lastSync = formatRelativeTime(d);
    }
  } catch {
    // DB not ready yet
  }

  return info;
}

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function StatusBar({ refreshKey }: { refreshKey?: number } = {}) {
  const [info, setInfo] = useState<StatusInfo>(() => loadStatusInfo());

  useEffect(() => {
    // Refresh status every 30s
    const timer = setInterval(() => {
      setInfo(loadStatusInfo());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  // Refresh when refreshKey changes (e.g. after command completes)
  useEffect(() => {
    setInfo(loadStatusInfo());
  }, [refreshKey]);

  const dbStatus = info.dbConnected ? 'connected' : 'disconnected';
  const dbColor = info.dbConnected ? 'green' : 'red';
  const syncText = info.lastSync ?? 'never';

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
