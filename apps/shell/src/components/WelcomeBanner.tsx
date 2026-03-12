import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { isEnglish } from '../i18n.js';
import { formatRelativeTime } from '../utils/formatTime.js';
import { loadDbInfo } from '../utils/dbInfo.js';

const ZOTERO_COLOR = 'rgb(204,51,51)';
const VERSION = '1.0.0';
const NARROW_THRESHOLD = 60;

const LOGO_LINES = [
  '▐█████▌',
  '   ▟█▘ ',
  ' ▟█▘   ',
  '▐█████▌',
];

function shortenPath(p: string, maxLen: number): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  let s = p;
  if (home && s.startsWith(home)) {
    s = '~' + s.slice(home.length);
  }
  if (s.length > maxLen) {
    s = '…' + s.slice(s.length - maxLen + 1);
  }
  return s;
}

/**
 * Render one row: │ leftContent │ rightContent │
 * leftContent is padded to leftW (center), rightContent to rightW (left).
 * Each cell is rendered as a single <Text> with proper padding.
 */
function Row({ left, right, leftW, rightW }: {
  left: React.ReactNode;
  right: React.ReactNode;
  leftW: number;
  rightW: number;
}) {
  return (
    <Box>
      <Text color={ZOTERO_COLOR}>│</Text>
      <Box width={leftW} justifyContent="center">
        {left}
      </Box>
      <Text color={ZOTERO_COLOR}>│</Text>
      <Box width={rightW}>
        {right}
      </Box>
      <Text color={ZOTERO_COLOR}>│</Text>
    </Box>
  );
}

export function WelcomeBanner() {
  const { stdout } = useStdout();
  const termWidth = stdout.columns || 80;
  const width = Math.max(NARROW_THRESHOLD, Math.floor(termWidth * 0.8));

  if (termWidth < NARROW_THRESHOLD) {
    return (
      <Box flexDirection="column">
        <Text color={ZOTERO_COLOR} bold>Zotero Shell v{VERSION}</Text>
        <Text color="gray">
          {isEnglish ? 'Type "help" for commands' : '输入 "help" 查看可用命令'}
        </Text>
      </Box>
    );
  }

  const info = loadDbInfo();
  const dbLabel = info.dbConnected ? 'connected' : 'disconnected';
  const dbColor = info.dbConnected ? 'green' : 'red';
  const syncLabel = info.lastSyncDate ? formatRelativeTime(info.lastSyncDate) : 'never';

  // Layout
  const innerWidth = width - 2;
  const leftW = Math.floor(innerWidth * 0.45);
  const rightW = innerWidth - leftW - 1;
  const cwdText = shortenPath(info.cwd, leftW - 4);
  const separator = '─'.repeat(rightW - 2);

  // Borders
  const title = ` Zotero Shell v${VERSION} `;
  const topPrefix = `╭───${title}`;
  const topBorder = `${topPrefix}${'─'.repeat(Math.max(0, width - topPrefix.length - 1))}╮`;
  const bottomBorder = `╰${'─'.repeat(width - 2)}╯`;

  // Empty row helper
  const emptyLeft = <Text>{' '.repeat(leftW)}</Text>;
  const emptyRight = <Text>{' '.repeat(rightW)}</Text>;

  return (
    <Box justifyContent="center" width={termWidth}>
    <Box flexDirection="column">
      <Text color={ZOTERO_COLOR}>{topBorder}</Text>

      {/* Empty row */}
      <Row leftW={leftW} rightW={rightW} left={emptyLeft} right={emptyRight} />

      {/* Welcome text */}
      <Row leftW={leftW} rightW={rightW}
        left={
          <Text>
            {isEnglish ? 'Welcome to ' : '欢迎使用 '}
            <Text color={ZOTERO_COLOR} bold>Zotero Shell</Text>
            !
          </Text>
        }
        right={<Text bold> {isEnglish ? 'Getting started' : '快速开始'}</Text>}
      />

      {/* Empty + tip */}
      <Row leftW={leftW} rightW={rightW}
        left={emptyLeft}
        right={<Text color="gray"> {isEnglish ? 'Run help to see available commands' : '运行 help 查看可用命令'}</Text>}
      />

      {/* Logo line 1 + separator */}
      <Row leftW={leftW} rightW={rightW}
        left={<Text color={ZOTERO_COLOR}>{LOGO_LINES[0]}</Text>}
        right={<Text color={ZOTERO_COLOR}> {separator}</Text>}
      />

      {/* Logo line 2 + shortcut title */}
      <Row leftW={leftW} rightW={rightW}
        left={<Text color={ZOTERO_COLOR}>{LOGO_LINES[1]}</Text>}
        right={<Text bold> {isEnglish ? 'Shortcuts' : '快捷键'}</Text>}
      />

      {/* Logo line 3 + Tab */}
      <Row leftW={leftW} rightW={rightW}
        left={<Text color={ZOTERO_COLOR}>{LOGO_LINES[2]}</Text>}
        right={<Text> <Text color="gray">Tab</Text>{'        '}{isEnglish ? 'Autocomplete' : '自动补全'}</Text>}
      />

      {/* Logo line 4 + ↑↓ */}
      <Row leftW={leftW} rightW={rightW}
        left={<Text color={ZOTERO_COLOR}>{LOGO_LINES[3]}</Text>}
        right={<Text> <Text color="gray">↑/↓</Text>{'        '}{isEnglish ? 'History' : '历史命令'}</Text>}
      />

      {/* Empty + Ctrl+C */}
      <Row leftW={leftW} rightW={rightW}
        left={emptyLeft}
        right={<Text> <Text color="gray">Ctrl+C×2</Text>{'    '}{isEnglish ? 'Exit' : '退出'}</Text>}
      />

      {/* Status info */}
      <Row leftW={leftW} rightW={rightW}
        left={
          <Text>
            <Text color={dbColor}>{dbLabel}</Text>
            <Text color="gray"> · </Text>
            <Text>{info.itemCount} items</Text>
            <Text color="gray"> · sync:</Text>
            <Text>{syncLabel}</Text>
          </Text>
        }
        right={emptyRight}
      />

      {/* CWD */}
      <Row leftW={leftW} rightW={rightW}
        left={<Text color="gray">{cwdText}</Text>}
        right={emptyRight}
      />

      {/* Empty row */}
      <Row leftW={leftW} rightW={rightW} left={emptyLeft} right={emptyRight} />

      <Text color={ZOTERO_COLOR}>{bottomBorder}</Text>
    </Box>
    </Box>
  );
}
