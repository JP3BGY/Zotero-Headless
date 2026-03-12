import { useMemo } from 'react';
import type { OutputLine } from '../types.js';
import type { ShellState } from './useShellState.js';

export interface VisibleLine {
  kind: 'line' | 'collapsed';
  line?: OutputLine;
  /** For collapsed rows: the groupId and count of hidden lines */
  groupId?: number;
  collapsedCount?: number;
  /** Unique key for React rendering */
  key: number;
}

/**
 * Compute the visible lines after applying group collapsing.
 * Log-level metadata is preserved on lines for future use (coloring, etc.)
 * but does NOT filter lines from display — command results should always be visible.
 */
export function useVisibleLines(state: ShellState): VisibleLine[] {
  const { lines, collapsedGroups } = state;

  return useMemo(() => {
    // Precompute per-group counts of non-input lines in a single pass
    const groupCounts = new Map<number, number>();
    for (const line of lines) {
      if (line.groupId != null && line.type !== 'input') {
        groupCounts.set(line.groupId, (groupCounts.get(line.groupId) ?? 0) + 1);
      }
    }

    const result: VisibleLine[] = [];
    const emittedCollapsedGroups = new Set<number>();

    for (const line of lines) {
      // Input lines (group headers) are always visible
      if (line.type === 'input') {
        result.push({ kind: 'line', line, key: line.id });
        continue;
      }

      // Check if this line belongs to a collapsed group
      if (line.groupId != null && collapsedGroups[line.groupId]) {
        if (!emittedCollapsedGroups.has(line.groupId)) {
          emittedCollapsedGroups.add(line.groupId);
          const count = groupCounts.get(line.groupId) ?? 0;
          if (count > 0) {
            result.push({
              kind: 'collapsed',
              groupId: line.groupId,
              collapsedCount: count,
              key: -(line.groupId + 1),
            });
          }
        }
        continue;
      }

      result.push({ kind: 'line', line, key: line.id });
    }

    return result;
  }, [lines, collapsedGroups]);
}
