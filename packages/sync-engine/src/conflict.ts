// Sync Engine - Conflict Resolver
// Implements three-way merge for sync, matching official Zotero's _reconcileChanges (syncLocal.js:1622).

export interface ThreeWayMerge<T> {
  base: T;      // pristine - last synced data (from sync cache)
  local: T;      // local modified
  remote: T;     // remote latest
}

export interface FieldConflict {
  field: string;
  local: unknown;
  remote: unknown;
}

export type ConflictResolution<T> =
  | { type: 'resolved'; data: T; localChanged: boolean }
  | { type: 'conflict'; conflicts: FieldConflict[]; data: T; localChanged: boolean };

// Fields that should always take the remote value during sync
const SYNC_IGNORE_FIELDS = new Set([
  'dateAdded', 'dateModified', 'mtime', 'md5',
  'library', 'links', 'meta', 'version', 'key',
]);

// Fields that are arrays of set-like members (merged via union)
const SET_ARRAY_FIELDS = new Set(['collections', 'tags']);

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

    const localChanged = this._hasLocalChanges(base, local, resolved);

    if (conflicts.length > 0) {
      return { type: 'conflict', conflicts, data: resolved, localChanged };
    }

    return { type: 'resolved', data: resolved, localChanged };
  }

  /**
   * Sync-specific three-way merge with special handling for:
   * - Ignored fields (always take remote)
   * - Set-array fields like tags/collections (union merge)
   * - Creators array (structural comparison)
   *
   * Mirrors official Zotero's _reconcileChanges (syncLocal.js:1622)
   */
  resolveForSync(
    base: Record<string, unknown>,
    local: Record<string, unknown>,
    remote: Record<string, unknown>
  ): ConflictResolution<Record<string, unknown>> {
    const conflicts: FieldConflict[] = [];
    const resolved: Record<string, unknown> = {};
    const localChangedFields = new Set<string>();

    const allFields = new Set([
      ...Object.keys(base),
      ...Object.keys(local),
      ...Object.keys(remote),
    ]);

    for (const field of allFields) {
      const baseVal = base[field];
      const localVal = local[field];
      const remoteVal = remote[field];

      // Always take remote for ignored fields
      if (SYNC_IGNORE_FIELDS.has(field)) {
        resolved[field] = remoteVal;
        continue;
      }

      const localNorm = JSON.stringify(localVal);
      const remoteNorm = JSON.stringify(remoteVal);
      const baseNorm = JSON.stringify(baseVal);

      if (localNorm === remoteNorm) {
        resolved[field] = localVal;
        continue;
      }

      if (localNorm === baseNorm) {
        // Only remote changed — accept remote
        resolved[field] = remoteVal;
        continue;
      }

      if (remoteNorm === baseNorm) {
        // Only local changed — keep local
        resolved[field] = localVal;
        localChangedFields.add(field);
        continue;
      }

      // Both changed differently — attempt smart merge for array fields
      if (SET_ARRAY_FIELDS.has(field)) {
        resolved[field] = this._mergeSetArray(field, baseVal, localVal, remoteVal);
        // Check if local additions are preserved
        if (JSON.stringify(resolved[field]) !== remoteNorm) {
          localChangedFields.add(field);
        }
        continue;
      }

      if (field === 'creators') {
        // Creators: if content is same but reordered, no conflict
        if (this._creatorsEqual(localVal, remoteVal)) {
          resolved[field] = remoteVal;
          continue;
        }
      }

      // True conflict
      conflicts.push({ field, local: localVal, remote: remoteVal });
      resolved[field] = localVal; // Default to local (preserve user edits)
      localChangedFields.add(field);
    }

    const localChanged = localChangedFields.size > 0;

    if (conflicts.length > 0) {
      return { type: 'conflict', conflicts, data: resolved, localChanged };
    }

    return { type: 'resolved', data: resolved, localChanged };
  }

  /**
   * Two-way reconciliation when no cache is available.
   * More conservative: field changes become conflicts, set members are additive only.
   * Mirrors official Zotero's _reconcileChangesWithoutCache (syncLocal.js:1777).
   */
  resolveWithoutCache(
    local: Record<string, unknown>,
    remote: Record<string, unknown>
  ): ConflictResolution<Record<string, unknown>> {
    const conflicts: FieldConflict[] = [];
    const resolved: Record<string, unknown> = {};
    const localChangedFields = new Set<string>();

    const allFields = new Set([
      ...Object.keys(local),
      ...Object.keys(remote),
    ]);

    for (const field of allFields) {
      const localVal = local[field];
      const remoteVal = remote[field];

      if (SYNC_IGNORE_FIELDS.has(field)) {
        resolved[field] = remoteVal;
        continue;
      }

      const localNorm = JSON.stringify(localVal);
      const remoteNorm = JSON.stringify(remoteVal);

      if (localNorm === remoteNorm) {
        resolved[field] = localVal;
        continue;
      }

      // For set-array fields, merge additively (union both sides, no removals)
      if (SET_ARRAY_FIELDS.has(field)) {
        resolved[field] = this._mergeSetArrayAdditive(field, localVal, remoteVal);
        if (JSON.stringify(resolved[field]) !== remoteNorm) {
          localChangedFields.add(field);
        }
        continue;
      }

      // Without cache, scalar field differences are conflicts
      conflicts.push({ field, local: localVal, remote: remoteVal });
      resolved[field] = localVal;
      localChangedFields.add(field);
    }

    const localChanged = localChangedFields.size > 0;

    if (conflicts.length > 0) {
      return { type: 'conflict', conflicts, data: resolved, localChanged };
    }

    return { type: 'resolved', data: resolved, localChanged };
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

  /**
   * Merge a set-array field (tags or collections) using three-way logic.
   * Items added locally or remotely are kept. Items removed by both are removed.
   * Items removed by only one side are kept (conservative).
   */
  private _mergeSetArray(field: string, baseVal: unknown, localVal: unknown, remoteVal: unknown): unknown[] {
    const baseSet = this._toStringSet(field, baseVal);
    const localSet = this._toStringSet(field, localVal);
    const remoteSet = this._toStringSet(field, remoteVal);

    // Start with base, then apply additions/removals from each side
    const result = new Map<string, unknown>();

    // Add everything from base
    for (const [key, val] of baseSet) result.set(key, val);

    // Add local additions
    for (const [key, val] of localSet) {
      if (!baseSet.has(key)) result.set(key, val);
    }

    // Add remote additions
    for (const [key, val] of remoteSet) {
      if (!baseSet.has(key)) result.set(key, val);
    }

    // Handle removals: only remove if both sides removed it
    for (const [key] of baseSet) {
      const inLocal = localSet.has(key);
      const inRemote = remoteSet.has(key);
      if (!inLocal && !inRemote) {
        result.delete(key); // Both removed — remove
      }
      // If only one side removed, keep it (conservative)
    }

    return Array.from(result.values());
  }

  /**
   * Additive-only merge for set-array fields when no cache is available.
   * Union of both sides — never remove anything.
   */
  private _mergeSetArrayAdditive(_field: string, localVal: unknown, remoteVal: unknown): unknown[] {
    const localArr = Array.isArray(localVal) ? localVal : [];
    const remoteArr = Array.isArray(remoteVal) ? remoteVal : [];
    const seen = new Set<string>();
    const result: unknown[] = [];

    for (const item of [...localArr, ...remoteArr]) {
      const key = JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }
    return result;
  }

  /**
   * Convert an array field value to a Map<serializedKey, originalValue> for set operations.
   */
  private _toStringSet(field: string, val: unknown): Map<string, unknown> {
    const arr = Array.isArray(val) ? val : [];
    const map = new Map<string, unknown>();
    for (const item of arr) {
      // For tags: key by tag name; for collections: key by the string value
      if (field === 'tags' && typeof item === 'object' && item !== null && 'tag' in item) {
        map.set((item as { tag: string }).tag, item);
      } else {
        map.set(JSON.stringify(item), item);
      }
    }
    return map;
  }

  /**
   * Check if two creator arrays are equivalent (same creators, possibly different order).
   */
  private _creatorsEqual(a: unknown, b: unknown): boolean {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    // Compare element-by-element in order — creator order is semantically meaningful
    // (first author vs second author). Matches official Zotero's positional comparison.
    return a.every((c, i) => JSON.stringify(c) === JSON.stringify(b[i]));
  }

  /**
   * Check if local state has changes that differ from the resolved state.
   */
  private _hasLocalChanges(
    base: Record<string, unknown>,
    local: Record<string, unknown>,
    resolved: Record<string, unknown>
  ): boolean {
    for (const field of Object.keys(local)) {
      if (SYNC_IGNORE_FIELDS.has(field)) continue;
      const localNorm = JSON.stringify(local[field]);
      const baseNorm = JSON.stringify(base[field]);
      if (localNorm !== baseNorm) {
        // Local changed this field — check if resolved preserved it
        const resolvedNorm = JSON.stringify(resolved[field]);
        if (resolvedNorm !== localNorm) {
          // Resolved didn't fully preserve local change
          return true;
        }
      }
    }
    return false;
  }
}

// Export singleton
export const conflictResolver = new ConflictResolver();
