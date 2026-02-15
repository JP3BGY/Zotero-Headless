// Sync Engine - Conflict Resolver
// See Zotero-Headless-Complete-Design.md Section 5.2

export interface ThreeWayMerge<T> {
  base: T;      // pristine - last synced data
  local: T;      // local modified
  remote: T;     // remote latest
}

export interface FieldConflict {
  field: string;
  local: unknown;
  remote: unknown;
}

export type ConflictResolution<T> = 
  | { type: 'resolved'; data: T }
  | { type: 'conflict'; conflicts: FieldConflict[]; data: T };

/**
 * Conflict Resolver - implements three-way merge algorithm
 */
export class ConflictResolver {
  /**
   * Resolve item conflict using three-way merge
   * 
   * Algorithm:
   * 1. If local == remote, no conflict (use either)
   * 2. If local == base, accept remote
   * 3. If remote == base, keep local
   * 4. If all three differ, it's a conflict
   */
  resolveItemConflict(
    base: Record<string, unknown>,
    local: Record<string, unknown>,
    remote: Record<string, unknown>
  ): ConflictResolution<Record<string, unknown>> {
    const conflicts: FieldConflict[] = [];
    const resolved: Record<string, unknown> = {};
    
    // Get all unique fields
    const allFields = new Set([
      ...Object.keys(base),
      ...Object.keys(local),
      ...Object.keys(remote),
    ]);
    
    for (const field of allFields) {
      const baseVal = base[field];
      const localVal = local[field];
      const remoteVal = remote[field];
      
      // Normalize for comparison
      const localNorm = JSON.stringify(localVal);
      const remoteNorm = JSON.stringify(remoteVal);
      const baseNorm = JSON.stringify(baseVal);
      
      if (localNorm === remoteNorm) {
        // Both sides changed the same way or neither changed
        resolved[field] = localVal;
      } else if (localNorm === baseNorm) {
        // Only remote changed
        resolved[field] = remoteVal;
      } else if (remoteNorm === baseNorm) {
        // Only local changed
        resolved[field] = localVal;
      } else {
        // Both changed differently - conflict!
        conflicts.push({ field, local: localVal, remote: remoteVal });
        resolved[field] = localVal; // Default to local
      }
    }
    
    if (conflicts.length > 0) {
      return { type: 'conflict', conflicts, data: resolved };
    }
    
    return { type: 'resolved', data: resolved };
  }
  
  /**
   * Auto-resolve non-conflicting fields
   * Returns only conflicting fields for manual resolution
   */
  autoResolve(
    base: Record<string, unknown>,
    local: Record<string, unknown>,
    remote: Record<string, unknown>
  ): { resolved: Record<string, unknown>; conflicts: FieldConflict[] } {
    const result = this.resolveItemConflict(base, local, remote);
    
    if (result.type === 'resolved') {
      return { resolved: result.data, conflicts: [] };
    }
    
    return {
      resolved: result.data,
      conflicts: result.conflicts,
    };
  }
}

// Export singleton
export const conflictResolver = new ConflictResolver();
