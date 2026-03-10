import { useEffect, useRef } from 'react';
import { useStdout } from 'ink';

const HEADER_HEIGHT = 2;   // welcome message
const HINTS_HEIGHT = 1;    // shortcut hints
const INPUT_HEIGHT = 1;    // input prompt
const COMPLETION_HEIGHT = 3; // completion area

export function useTerminalLayout(lineCount: number) {
  const { stdout } = useStdout();
  const heightRef = useRef(stdout.rows || 24);

  useEffect(() => {
    const updateHeight = () => {
      heightRef.current = stdout.rows || 24;
    };
    updateHeight();
    stdout.on('resize', updateHeight);
    return () => { stdout.off('resize', updateHeight); };
  }, [stdout]);

  const totalHeight = heightRef.current - 3; // ink overhead
  const dividerHeight = lineCount > 0 ? 1 : 0;
  const outputHeight = Math.max(1,
    totalHeight - HEADER_HEIGHT - HINTS_HEIGHT - dividerHeight - INPUT_HEIGHT - COMPLETION_HEIGHT
  );
  const maxScrollOffset = Math.max(0, lineCount - outputHeight);

  return { outputHeight, maxScrollOffset, totalHeight };
}
