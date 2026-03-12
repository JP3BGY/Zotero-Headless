---
name: test-tui
description: Test the Zotero Shell TUI (Ink/React) by creating minimal reproduction scripts and verifying rendering behavior. Use when debugging TUI display issues, Static component behavior, or output rendering.
user-invocable: true
allowed-tools: Read, Write, Bash, Grep, Glob, Edit
argument-hint: [description of what to test]
---

# Testing the Zotero Shell TUI

You are testing the Zotero Shell TUI, which is built with **React + Ink v5**. Ink manages terminal output — it owns stdout and re-renders a managed viewport each frame. This makes traditional testing (piping stdin, capturing stdout) unreliable.

## Key Constraints

1. **Ink requires a TTY**: `echo "cmd" | node shell.mjs` fails with "Raw mode is not supported". Ink's `useInput` needs a real terminal.
2. **expect/pseudo-TTY is unreliable**: Ink's `useInput` doesn't reliably process key events from expect scripts. Characters may appear in the TextInput field without triggering `return` key handlers.
3. **Ink clears the screen**: When `outputHeight >= stdout.rows`, Ink uses `ansiEscapes.clearTerminal` which wipes scrollback. Pseudo-TTYs from expect often have small default sizes (24 rows), triggering this path even when the dynamic area is small.

## Testing Strategy: Minimal Reproduction Scripts

Instead of testing the full shell interactively, create **minimal reproduction scripts** that exercise the specific Ink behavior in question. Run them from within the `apps/shell` directory so that `react` and `ink` resolve correctly.

### Template

```typescript
// File: apps/shell/test_xxx.mjs (temporary, delete after use)
import React, { useState, useEffect } from 'react';
import { render, Static, Box, Text } from 'ink';

function App() {
  const [items, setItems] = useState([/* initial state */]);

  useEffect(() => {
    // Simulate state changes over time with setTimeout
    setTimeout(() => setItems(p => [...p, newItem]), delayMs);
    // ...
    setTimeout(() => process.exit(0), finalDelayMs);
  }, []);

  return React.createElement(Box, { flexDirection: 'column' },
    // Components under test
  );
}

render(React.createElement(App));
```

### Running

```bash
cd apps/shell && npx tsx test_xxx.mjs 2>&1; rm -f test_xxx.mjs
```

**Important**: Must run from `apps/shell/` so that `react`, `ink`, and other dependencies resolve correctly via the package's `node_modules`.

## Common Test Scenarios

### 1. Testing `<Static>` (scrollback output)

Ink's `<Static>` renders items once and pushes them into terminal scrollback above the dynamic area.

**How it works internally** (from `ink/build/components/Static.js`):
```js
const [index, setIndex] = useState(0);
const itemsToRender = useMemo(() => items.slice(index), [items, index]);
useLayoutEffect(() => setIndex(items.length), [items.length]);
```

- It expects a **growing array** — pass the full cumulative array, NOT just deltas
- It uses `items.length` change to detect new items — mutating items without changing length won't trigger re-render
- Items are frozen once rendered — animations (blinking, spinners) don't work inside `<Static>`

**Test script**:
```javascript
function App() {
  const [items, setItems] = useState(['Line 1', 'Line 2']);
  useEffect(() => {
    setTimeout(() => setItems(p => [...p, 'New line']), 500);
    setTimeout(() => process.exit(0), 1500);
  }, []);
  return React.createElement(Box, { flexDirection: 'column' },
    React.createElement(Static, { items },
      (item, idx) => React.createElement(Box, { key: idx },
        React.createElement(Text, null, item)
      )
    ),
    React.createElement(Text, { color: 'cyan' }, '> prompt')
  );
}
```

**Expected**: Each item appears once above `> prompt`. No duplication.

### 2. Testing dynamic vs static transition (duplication bug)

When output is rendered dynamically (non-Static) during command execution, and then moved to `<Static>` after completion, **duplication occurs** if the dynamic output overflows the terminal viewport. The terminal emulator pushes overflowed dynamic lines into scrollback, then `<Static>` writes them again.

**Fix pattern**: Feed ALL output lines to `<Static>` immediately. Never render the same content in both dynamic and `<Static>` areas.

### 3. Testing screen clearing (`clearTerminal` path)

From `ink/build/ink.js`:
```js
if (outputHeight >= this.options.stdout.rows) {
    this.options.stdout.write(ansiEscapes.clearTerminal + this.fullStaticOutput + output);
}
```

- `outputHeight` only counts NON-static elements (confirmed in `renderer.js`: `skipStaticElements: true`)
- When triggered, Ink clears the entire terminal and rewrites `fullStaticOutput + output`
- Static output is preserved (re-rendered) but terminal scrollback is lost

**Test**: Keep the dynamic area small (< 10 rows). Dividers + prompt + status + completions should fit.

### 4. Testing `console.log` inside Ink apps

Calling `console.log` directly in an Ink app bypasses Ink's rendering. Ink intercepts console via `patchConsole` and routes it through `writeToStdout`, which clears the dynamic area, writes the data, then re-renders.

**Never use `originalLog.apply(console, args)`** in captured console handlers — it writes directly to stdout, causing output to appear outside the TUI in unpredictable positions.

## Ink Renderer Architecture (Reference)

```
Terminal output:
┌─────────────────────────────┐
│ <Static> output (scrollback)│  ← Written once via stdout.write(), stays in terminal buffer
│ ...                         │
│ ...                         │
├─────────────────────────────┤
│ Dynamic area (re-rendered)  │  ← Managed by log-update, rewritten each frame
│ Divider                     │
│ InputPrompt                 │
│ Divider                     │
│ StatusBar                   │
│ CompletionList              │
└─────────────────────────────┘
```

- `renderer.js` splits rendering: static items get `internal_static: true` and are written separately
- The `onRender` method in `ink.js` writes static output via `stdout.write()` (permanent) and dynamic output via `log-update` (overwritable)
- `outputHeight` = height of dynamic area only (static is excluded)

## Task

$ARGUMENTS

Create a minimal test script in `apps/shell/test_xxx.mjs`, run it, verify the behavior, report findings, and clean up the test file.
