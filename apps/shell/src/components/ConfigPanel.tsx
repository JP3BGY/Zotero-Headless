import React, { useState, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { configManager, type ZoteroConfig, appConfig, updateEnvConfig } from '@zotero-headless/core';
import { useShellState } from '../hooks/useShellState.js';
import { t } from '../i18n.js';

interface ConfigItem {
  key: string;
  value: string;
  type: 'string' | 'boolean' | 'number' | 'enum';
  editable: boolean;
  enumValues?: string[];
  configPath: { section: keyof ZoteroConfig; field?: string } | null;
  source: 'env' | 'zoterrc';
  masked?: boolean;          // show masked value in list, edit raw value
  rawValue?: string;         // the actual unmasked value for editing
}

type ConfigView = 'list' | 'editing';

// Chrome: title(1) + marginBottom(1) + hint(1) + marginTop(1) + shell chrome (~8)
const CONFIG_CHROME_HEIGHT = 12;

function maskApiKey(key: string): string {
  if (!key || key.length < 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

function truncateValue(val: string, maxLen: number): string {
  if (val.length <= maxLen) return val;
  return val.slice(0, maxLen - 2) + '..';
}

function buildConfigItems(): ConfigItem[] {
  const cfg = configManager.getAll();
  const items: ConfigItem[] = [];

  // Env-based settings (editable, restart required)
  items.push({
    key: 'zotero.apiKey',
    value: maskApiKey(appConfig.zotero.apiKey),
    rawValue: appConfig.zotero.apiKey,
    masked: true,
    type: 'string',
    editable: true,
    configPath: null,
    source: 'env',
  });
  items.push({
    key: 'zotero.userId',
    value: appConfig.zotero.userId,
    type: 'string',
    editable: true,
    configPath: null,
    source: 'env',
  });
  items.push({
    key: 'database.path',
    value: appConfig.database.path,
    type: 'string',
    editable: true,
    configPath: null,
    source: 'env',
  });
  items.push({
    key: 'log.level',
    value: appConfig.log.level,
    type: 'enum',
    editable: true,
    enumValues: ['debug', 'info', 'warn', 'error'],
    configPath: null,
    source: 'env',
  });

  // Editable zoterrc settings
  items.push({
    key: 'editor',
    value: cfg.editor || 'nano',
    type: 'string',
    editable: true,
    configPath: { section: 'editor' },
    source: 'zoterrc',
  });
  items.push({
    key: 'language',
    value: cfg.language || 'zh',
    type: 'enum',
    editable: true,
    enumValues: ['en', 'zh'],
    configPath: { section: 'language' },
    source: 'zoterrc',
  });
  items.push({
    key: 'sync.autoSync',
    value: String(cfg.sync?.autoSync ?? false),
    type: 'boolean',
    editable: true,
    configPath: { section: 'sync', field: 'autoSync' },
    source: 'zoterrc',
  });
  items.push({
    key: 'sync.syncInterval',
    value: String(cfg.sync?.syncInterval ?? 30),
    type: 'number',
    editable: true,
    configPath: { section: 'sync', field: 'syncInterval' },
    source: 'zoterrc',
  });
  items.push({
    key: 'display.defaultLimit',
    value: String(cfg.display?.defaultLimit ?? 20),
    type: 'number',
    editable: true,
    configPath: { section: 'display', field: 'defaultLimit' },
    source: 'zoterrc',
  });
  items.push({
    key: 'display.showAttachments',
    value: String(cfg.display?.showAttachments ?? true),
    type: 'boolean',
    editable: true,
    configPath: { section: 'display', field: 'showAttachments' },
    source: 'zoterrc',
  });
  items.push({
    key: 'display.collapseOutput',
    value: String(cfg.display?.collapseOutput ?? true),
    type: 'boolean',
    editable: true,
    configPath: { section: 'display', field: 'collapseOutput' },
    source: 'zoterrc',
  });
  items.push({
    key: 'download.defaultDir',
    value: cfg.download?.defaultDir || '~/.local/share/zotero-headless/downloads',
    type: 'string',
    editable: true,
    configPath: { section: 'download', field: 'defaultDir' },
    source: 'zoterrc',
  });

  // Keybindings
  const kb = cfg.keybindings || {};
  const kbKeys = ['submit', 'historyUp', 'historyDown', 'scrollUp', 'scrollDown', 'complete', 'clear', 'exit'] as const;
  for (const k of kbKeys) {
    items.push({
      key: `keybindings.${k}`,
      value: kb[k] || '',
      type: 'string',
      editable: true,
      configPath: { section: 'keybindings', field: k },
      source: 'zoterrc',
    });
  }

  return items;
}

/** Returns true if the change requires a restart. */
function saveConfigItem(item: ConfigItem, newValue: string): boolean {
  if (item.source === 'env') {
    updateEnvConfig(item.key, newValue);
    return true;
  }

  if (!item.configPath) return false;
  const { section, field } = item.configPath;

  if (!field) {
    configManager.set(section, newValue as any);
  } else {
    const current = configManager.get(section) as Record<string, any> | undefined;
    const updated = { ...current };

    if (item.type === 'boolean') {
      updated[field] = newValue === 'true';
    } else if (item.type === 'number') {
      updated[field] = Number(newValue);
    } else {
      updated[field] = newValue;
    }

    configManager.set(section, updated as any);
  }
  return false;
}

export function ConfigPanel() {
  const { dispatch } = useShellState();
  const { stdout } = useStdout();
  const [items, setItems] = useState<ConfigItem[]>(() => buildConfigItems());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [view, setView] = useState<ConfigView>('list');
  const [editValue, setEditValue] = useState('');
  const [scrollOffset, setScrollOffset] = useState(0);
  const [needsRestart, setNeedsRestart] = useState(false);

  const maxKeyLen = useMemo(() => Math.max(...items.map(i => i.key.length)), [items]);

  // Calculate visible viewport: fixed row count so layout never shifts
  const termHeight = stdout.rows || 24;
  const viewportHeight = Math.max(3, termHeight - CONFIG_CHROME_HEIGHT);
  const totalItems = items.length;
  const needsScroll = totalItems > viewportHeight;

  // Auto-adjust scroll offset to keep selected item in view
  const adjustedOffset = useMemo(() => {
    let offset = scrollOffset;
    if (selectedIndex < offset) {
      offset = selectedIndex;
    }
    if (selectedIndex >= offset + viewportHeight) {
      offset = selectedIndex - viewportHeight + 1;
    }
    const maxOffset = Math.max(0, totalItems - viewportHeight);
    return Math.max(0, Math.min(offset, maxOffset));
  }, [selectedIndex, scrollOffset, viewportHeight, totalItems]);

  if (adjustedOffset !== scrollOffset) {
    setScrollOffset(adjustedOffset);
  }

  // How many items are hidden above/below the viewport window
  const hiddenAbove = adjustedOffset;
  const hiddenBelow = Math.max(0, totalItems - adjustedOffset - viewportHeight);

  // Build the rows to render — always exactly `viewportHeight` rows.
  // When items overflow, the first/last row becomes a scroll indicator
  // replacing the item that would have been there.
  type Row =
    | { kind: 'item'; item: ConfigItem; realIndex: number }
    | { kind: 'scrollUp'; count: number }
    | { kind: 'scrollDown'; count: number };

  const rows: Row[] = [];
  for (let i = 0; i < viewportHeight && adjustedOffset + i < totalItems; i++) {
    const realIdx = adjustedOffset + i;
    if (hiddenAbove > 0 && i === 0) {
      rows.push({ kind: 'scrollUp', count: hiddenAbove });
    } else if (hiddenBelow > 0 && i === viewportHeight - 1) {
      rows.push({ kind: 'scrollDown', count: hiddenBelow });
    } else {
      rows.push({ kind: 'item', item: items[realIdx], realIndex: realIdx });
    }
  }

  useInput((input, key) => {
    if (view === 'editing') {
      if (key.escape) {
        setView('list');
        return;
      }
      if (key.return) {
        const item = items[selectedIndex];
        const compareValue = item?.masked ? item.rawValue : item?.value;
        if (item && editValue !== compareValue) {
          const restart = saveConfigItem(item, editValue);
          if (restart) setNeedsRestart(true);
          setItems(buildConfigItems());
        }
        setView('list');
        return;
      }
      return;
    }

    // List view
    if (key.escape) {
      dispatch({ type: 'EXIT_CONFIG' });
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex(i => Math.min(items.length - 1, i + 1));
      return;
    }

    if (key.return) {
      const item = items[selectedIndex];
      if (!item || !item.editable) return;

      if (item.type === 'boolean') {
        const newVal = item.value === 'true' ? 'false' : 'true';
        const restart = saveConfigItem(item, newVal);
        if (restart) setNeedsRestart(true);
        setItems(buildConfigItems());
      } else if (item.type === 'enum' && item.enumValues) {
        const currentIdx = item.enumValues.indexOf(item.value);
        const nextIdx = (currentIdx + 1) % item.enumValues.length;
        const restart = saveConfigItem(item, item.enumValues[nextIdx]);
        if (restart) setNeedsRestart(true);
        setItems(buildConfigItems());
      } else {
        // For masked items (apiKey), edit the raw value
        setEditValue(item.masked ? (item.rawValue ?? item.value) : item.value);
        setView('editing');
      }
      return;
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {t.configTitle}
          {needsScroll ? <Text color="gray">{` (${selectedIndex + 1}/${totalItems})`}</Text> : ''}
        </Text>
      </Box>

      {rows.map((row, i) => {
        if (row.kind === 'scrollUp') {
          return (
            <Box key="__scroll_up">
              <Text color="gray">{`  ▲ ${row.count} more above`}</Text>
            </Box>
          );
        }
        if (row.kind === 'scrollDown') {
          return (
            <Box key="__scroll_down">
              <Text color="gray">{`  ▼ ${row.count} more below`}</Text>
            </Box>
          );
        }

        const { item, realIndex } = row;
        const isSelected = realIndex === selectedIndex;
        const isEditing = view === 'editing' && isSelected;
        const prefix = isSelected ? '> ' : '  ';
        const keyPadded = item.key.padEnd(maxKeyLen + 2);

        return (
          <Box key={item.key}>
            <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
              {prefix}
              {keyPadded}
            </Text>
            {isEditing ? (
              <TextInput
                value={editValue}
                onChange={setEditValue}
              />
            ) : (
              <Text color={isSelected ? 'white' : undefined}>
                {truncateValue(item.value, 40)}
                {item.source === 'env' ? <Text color="gray">{` (${t.configRestartTag})`}</Text> : ''}
              </Text>
            )}
          </Box>
        );
      })}

      <Box marginTop={1} flexDirection="column">
        <Text color="gray">{t.configHint}</Text>
        {needsRestart && (
          <Text color="yellow">{t.configRestartHint}</Text>
        )}
      </Box>
    </Box>
  );
}
