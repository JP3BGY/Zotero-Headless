import React from 'react';
import { Box, Text } from 'ink';
import { StatusLine } from './components/StatusLine.js';
import { Divider } from './components/Header.js';
import { OutputArea } from './components/OutputArea.js';
import { InputPrompt } from './components/InputPrompt.js';
import { CompletionList } from './components/CompletionList.js';
import { ConfirmPrompt } from './components/ConfirmPrompt.js';
import { StatusBar } from './components/StatusBar.js';
import { ShellContext, useShellReducer } from './hooks/useShellState.js';
import { useKeyHandler } from './hooks/useKeyHandler.js';
import { t } from './i18n.js';

function ShellUI() {
  const { state } = React.useContext(ShellContext)!;
  const { updateSuggestions } = useKeyHandler();

  return (
    <Box flexDirection="column" height="100%">
      <StatusLine />
      <Text color="gray">{t.subtitle}</Text>
      {state.lines.length > 0 && <Divider />}
      <OutputArea />
      <Divider />
      {state.mode === 'confirming' ? (
        <ConfirmPrompt />
      ) : (
        <InputPrompt onInputChange={updateSuggestions} />
      )}
      <Divider />
      <StatusBar refreshKey={state.inputKey} />
      <CompletionList />
    </Box>
  );
}

export function ZoteroShell() {
  const { state, dispatch, addLine } = useShellReducer();

  return (
    <ShellContext.Provider value={{ state, dispatch, addLine }}>
      <ShellUI />
    </ShellContext.Provider>
  );
}
