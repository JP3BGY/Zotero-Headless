import React, { useState, useEffect } from 'react';
import { render, Static, Box, Text } from 'ink';

function App() {
  const [items, setItems] = useState([
    { key: 0, text: 'Welcome' },
    { key: 1, text: 'Type help' },
  ]);

  useEffect(() => {
    setTimeout(() => setItems(p => [...p, { key: 2, text: '⏺ ls' }]), 300);
    setTimeout(() => setItems(p => [...p, { key: 3, text: 'Item 1' }]), 600);
    setTimeout(() => setItems(p => [...p, { key: 4, text: 'Item 2' }]), 900);
    setTimeout(() => setItems(p => [...p, { key: 5, text: 'Item 3' }]), 1200);
    // Simulate END_COMMAND: mutate existing item (status change)
    setTimeout(() => {
      setItems(p => p.map(i => i.key === 2 ? { ...i, text: '✔ ls' } : i));
    }, 1500);
    setTimeout(() => setItems(p => [...p, { key: 6, text: '⏺ sync' }]), 1800);
    setTimeout(() => setItems(p => [...p, { key: 7, text: 'Syncing...' }]), 2100);
    setTimeout(() => process.exit(0), 3000);
  }, []);

  return React.createElement(Box, { flexDirection: 'column' },
    React.createElement(Static, { items },
      (item) => React.createElement(Box, { key: item.key },
        React.createElement(Text, null, item.text)
      )
    ),
    React.createElement(Text, { color: 'cyan' }, '> prompt')
  );
}

render(React.createElement(App));
