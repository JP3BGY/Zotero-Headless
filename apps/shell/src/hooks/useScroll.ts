import { useEffect, useRef } from 'react';
import { useStdout } from 'ink';

const HEADER_HEIGHT = 2;      // welcome + subtitle
const INPUT_HEIGHT = 1;       // input prompt
const PROMPT_DIVIDERS = 2;    // divider above + below prompt
const STATUS_BAR_HEIGHT = 1;  // status bar below prompt
const COMPLETION_HEIGHT = 3;  // completion area

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
  const outputDividerHeight = lineCount > 0 ? 1 : 0;
  const outputHeight = Math.max(1,
    totalHeight - HEADER_HEIGHT - outputDividerHeight - PROMPT_DIVIDERS - INPUT_HEIGHT - STATUS_BAR_HEIGHT - COMPLETION_HEIGHT
  );
  const maxScrollOffset = Math.max(0, lineCount - outputHeight);

  return { outputHeight, maxScrollOffset, totalHeight };
}
