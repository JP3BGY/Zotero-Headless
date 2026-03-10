import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL = 80;

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

export const Spinner = React.memo(function Spinner({
  command,
  startTime,
}: {
  command: string;
  startTime: number;
}) {
  const [frame, setFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(prev => (prev + 1) % SPINNER_FRAMES.length);
      setElapsed(Date.now() - startTime);
    }, SPINNER_INTERVAL);
    return () => clearInterval(timer);
  }, [startTime]);

  return (
    <Box>
      <Text color="cyan">{SPINNER_FRAMES[frame]} </Text>
      <Text color="gray">{command}</Text>
      <Text color="gray" dimColor> ({formatElapsed(elapsed)})</Text>
    </Box>
  );
});
