import React from 'react';
import { Box } from 'ink';
import { Header, ShortcutHints, Divider } from './components/Header.js';
import { OutputArea } from './components/OutputArea.js';
import { InputPrompt } from './components/InputPrompt.js';
import { CompletionList } from './components/CompletionList.js';
import { ShellContext, useShellReducer } from './hooks/useShellState.js';
import { useKeyHandler } from './hooks/useKeyHandler.js';

function ShellUI() {
  const { state } = React.useContext(ShellContext)!;
  const { updateSuggestions } = useKeyHandler();

  return (
    <Box flexDirection="column" height="100%">
      <Header />
      <ShortcutHints />
      {state.lines.length > 0 && <Divider />}
      <OutputArea />
      <InputPrompt onInputChange={updateSuggestions} />
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
