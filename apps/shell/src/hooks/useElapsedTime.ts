import { useState, useEffect } from 'react';

/**
 * Returns elapsed seconds since `startTime`, updating every second.
 * Returns 0 if startTime is null.
 */
export function useElapsedTime(startTime: number | null): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (startTime === null) {
      setElapsed(0);
      return;
    }

    setElapsed(Math.floor((Date.now() - startTime) / 1000));

    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    return () => clearInterval(id);
  }, [startTime]);

  return elapsed;
}
