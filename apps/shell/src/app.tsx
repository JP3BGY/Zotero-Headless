import React from 'react';
import { Box } from 'ink';
import { Divider } from './components/Header.js';
import { OutputArea } from './components/OutputArea.js';
import { InputPrompt } from './components/InputPrompt.js';
import { CompletionList } from './components/CompletionList.js';
import { ConfigPanel } from './components/ConfigPanel.js';
import { StatusBar } from './components/StatusBar.js';
import { ShellContext, useShellReducer } from './hooks/useShellState.js';
import { useKeyHandler } from './hooks/useKeyHandler.js';


function ShellUI() {
  const { state } = React.useContext(ShellContext)!;
  const { updateSuggestions } = useKeyHandler();

  // Keep OutputArea at the same tree position so <Static> preserves its
  // internal index and doesn't re-render already-committed items.
  // When exiting, omit the dynamic chrome so Ink's log-update erases it.
  const isExiting = state.mode === 'exiting';

  return (
    <Box flexDirection="column">
      <OutputArea />
      {!isExiting && (
        <>
          <Divider />
          {state.mode === 'config' ? (
            <ConfigPanel />
          ) : (
            <InputPrompt onInputChange={updateSuggestions} />
          )}
          <Divider />
          <StatusBar refreshKey={state.inputKey} />
          <CompletionList />
        </>
      )}
    </Box>
  );
}

export function ZoteroShell() {
  const { state, dispatch, addLine, addLines } = useShellReducer();

  return (
    <ShellContext.Provider value={{ state, dispatch, addLine, addLines }}>
      <ShellUI />
    </ShellContext.Provider>
  );
}
