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
    remote: Record<string, unknown>,
    objectType: 'item' | 'collection' | 'search' = 'item'
  ): ConflictResolution<Record<string, unknown>> {
    // Auto-merge for non-items: collections/searches always take remote on conflict.
    // Mirrors official Zotero (syncLocal.js:1635: isAutoMergeType = objectType != 'item').
    const isAutoMergeType = objectType !== 'item';

    // Trash auto-merge: when both sides are in trash, auto-merge (take remote).
    // Mirrors official Zotero (syncLocal.js:1736-1741).
    if (objectType === 'item' && local.deleted && remote.deleted) {
      return { type: 'resolved', data: { ...remote }, localChanged: false };
    }

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

      // Relations: per-predicate, per-value union merge.
      // Mirrors official Zotero's _relationsDiff + property-member-add/remove (dataObjectUtilities.js:549-730).
      if (field === 'relations') {
        resolved[field] = this._mergeRelations(baseVal, localVal, remoteVal);
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

      // ISBN normalization: different hyphenation is not a real conflict
      // Mirrors official Zotero (syncLocal.js:1836-1851)
      if (field === 'ISBN' && typeof localVal === 'string' && typeof remoteVal === 'string'
          && this._normalizeISBN(localVal) === this._normalizeISBN(remoteVal)) {
        resolved[field] = remoteVal;
        continue;
      }

      // Note normalization: different HTML markup for same text is not a real conflict
      // Mirrors official Zotero (syncLocal.js:1853-1873)
      if (field === 'note' && typeof localVal === 'string' && typeof remoteVal === 'string'
          && this._normalizeNote(localVal) === this._normalizeNote(remoteVal)) {
        resolved[field] = remoteVal;
        continue;
      }

      // For auto-merge types (non-items) and trashed items, take remote on conflict.
      // Mirrors official Zotero (syncLocal.js:1736-1741).
      if (isAutoMergeType) {
        resolved[field] = remoteVal;
        continue;
      }

      // True conflict
      conflicts.push({ field, local: localVal, remote: remoteVal });
      resolved[field] = localVal; // Default to local (preserve user edits)
      localChangedFields.add(field);
    }

    // For auto-merge types, check if local changes matter. If all local-changed fields
    // were also changed remotely, there's nothing unique to re-upload.
    // Mirrors official Zotero (syncLocal.js:1754-1761).
    if (isAutoMergeType && localChangedFields.size > 0) {
      const remoteChangedFields = new Set<string>();
      for (const field of allFields) {
        if (SYNC_IGNORE_FIELDS.has(field)) continue;
        const baseNorm = JSON.stringify(base[field]);
        const remoteNorm = JSON.stringify(remote[field]);
        if (baseNorm !== remoteNorm) remoteChangedFields.add(field);
      }
      if ([...localChangedFields].every(f => remoteChangedFields.has(f))) {
        localChangedFields.clear();
      }
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
    remote: Record<string, unknown>,
    objectType: 'item' | 'collection' | 'search' = 'item'
  ): ConflictResolution<Record<string, unknown>> {
    const isAutoMergeType = objectType !== 'item';

    // Trash auto-merge: both in trash → take remote
    if (objectType === 'item' && local.deleted && remote.deleted) {
      return { type: 'resolved', data: { ...remote }, localChanged: false };
    }

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

      // Relations: additive union of both sides (no removals without cache)
      if (field === 'relations') {
        resolved[field] = this._mergeRelationsAdditive(localVal, remoteVal);
        if (JSON.stringify(resolved[field]) !== remoteNorm) {
          localChangedFields.add(field);
        }
        continue;
      }

      // ISBN normalization: different hyphenation is not a real conflict
      if (field === 'ISBN' && typeof localVal === 'string' && typeof remoteVal === 'string'
          && this._normalizeISBN(localVal) === this._normalizeISBN(remoteVal)) {
        resolved[field] = remoteVal;
        continue;
      }

      // Note normalization: different HTML markup for same text is not a real conflict
      if (field === 'note' && typeof localVal === 'string' && typeof remoteVal === 'string'
          && this._normalizeNote(localVal) === this._normalizeNote(remoteVal)) {
        resolved[field] = remoteVal;
        continue;
      }

      // For auto-merge types (non-items), take remote on conflict
      if (isAutoMergeType) {
        resolved[field] = remoteVal;
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
   * Normalize ISBN for comparison by removing hyphens and spaces.
   * Mirrors Zotero.Utilities.Internal.hyphenateISBN comparison (syncLocal.js:1836-1851).
   */
  private _normalizeISBN(isbn: string): string {
    return isbn.replace(/[-\s]/g, '').toUpperCase();
  }

  /**
   * Normalize note content by stripping HTML tags and normalizing whitespace.
   * Mirrors official Zotero's note comparison (syncLocal.js:1853-1873).
   */
  private _normalizeNote(note: string): string {
    return note
      .replace(/<[^>]*>/g, '')
      // Decode numeric entities (decimal and hex)
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      // Common named entities
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
      .replace(/&ldquo;/g, '\u201C').replace(/&rdquo;/g, '\u201D')
      .replace(/&lsquo;/g, '\u2018').replace(/&rsquo;/g, '\u2019')
      .replace(/&mdash;/g, '\u2014').replace(/&ndash;/g, '\u2013')
      .replace(/&hellip;/g, '\u2026')
      .replace(/\s+/g, ' ').trim();
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

    // Handle removals: apply single-side removals if the other side didn't modify.
    // Mirrors official Zotero changeset reconciliation (syncLocal.js:1718-1726).
    for (const [key] of baseSet) {
      const inLocal = localSet.has(key);
      const inRemote = remoteSet.has(key);
      if (!inLocal && !inRemote) {
        result.delete(key); // Both removed — remove
      } else if (!inLocal && inRemote) {
        // Local removed it. If remote didn't change it from base, apply the removal.
        const remoteStr = JSON.stringify(remoteSet.get(key));
        const baseStr = JSON.stringify(baseSet.get(key));
        if (remoteStr === baseStr) {
          result.delete(key);
        }
        // else: remote modified it — keep remote's version
      } else if (inLocal && !inRemote) {
        // Remote removed it. If local didn't change it from base, apply the removal.
        const localStr = JSON.stringify(localSet.get(key));
        const baseStr = JSON.stringify(baseSet.get(key));
        if (localStr === baseStr) {
          result.delete(key);
        }
        // else: local modified it — keep local's version
      }
    }

    // Tag type normalization: when same tag exists on both sides with different types,
    // normalize to type 0. Mirrors official Zotero (syncLocal.js:1660-1686).
    if (field === 'tags') {
      for (const [key, val] of result) {
        const localTag = localSet.get(key) as { tag: string; type?: number } | undefined;
        const remoteTag = remoteSet.get(key) as { tag: string; type?: number } | undefined;
        if (localTag && remoteTag && (localTag.type ?? 0) !== (remoteTag.type ?? 0)) {
          result.set(key, { tag: (val as { tag: string }).tag, type: 0 });
        }
      }
    }

    return Array.from(result.values());
  }

  /**
   * Additive-only merge for set-array fields when no cache is available.
   * Union of both sides — never remove anything.
   * For tags: dedup by tag name and normalize conflicting types to 0.
   */
  private _mergeSetArrayAdditive(field: string, localVal: unknown, remoteVal: unknown): unknown[] {
    const localArr = Array.isArray(localVal) ? localVal : [];
    const remoteArr = Array.isArray(remoteVal) ? remoteVal : [];

    if (field === 'tags') {
      const result = new Map<string, { tag: string; type?: number }>();
      for (const item of localArr) {
        const tagName = (item as { tag?: string })?.tag;
        if (tagName) result.set(tagName, item as { tag: string; type?: number });
      }
      for (const item of remoteArr) {
        const tagName = (item as { tag?: string })?.tag;
        if (tagName) {
          const existing = result.get(tagName);
          if (existing && (existing.type ?? 0) !== ((item as { type?: number }).type ?? 0)) {
            result.set(tagName, { tag: tagName, type: 0 });
          } else if (!existing) {
            result.set(tagName, item as { tag: string; type?: number });
          }
        }
      }
      return Array.from(result.values());
    }

    // Non-tag fields: original logic
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
   * Three-way merge for relations: {predicate: [uri, ...]} objects.
   * Per-predicate, per-value union with single-side removal support.
   * Mirrors official Zotero _relationsDiff + property-member-add/remove.
   */
  private _mergeRelations(base: unknown, local: unknown, remote: unknown): Record<string, string[]> {
    const baseRel = this._normalizeRelations(base);
    const localRel = this._normalizeRelations(local);
    const remoteRel = this._normalizeRelations(remote);

    const allPredicates = new Set([
      ...Object.keys(baseRel),
      ...Object.keys(localRel),
      ...Object.keys(remoteRel),
    ]);

    const result: Record<string, string[]> = {};

    for (const pred of allPredicates) {
      const baseVals = new Set(baseRel[pred] ?? []);
      const localVals = new Set(localRel[pred] ?? []);
      const remoteVals = new Set(remoteRel[pred] ?? []);

      const merged = new Set<string>();

      // Start with base values
      for (const v of baseVals) merged.add(v);

      // Add local additions (in local, not in base)
      for (const v of localVals) {
        if (!baseVals.has(v)) merged.add(v);
      }

      // Add remote additions (in remote, not in base)
      for (const v of remoteVals) {
        if (!baseVals.has(v)) merged.add(v);
      }

      // Apply removals: if one side removed and the other didn't add/change
      for (const v of baseVals) {
        const inLocal = localVals.has(v);
        const inRemote = remoteVals.has(v);
        if (!inLocal && !inRemote) {
          merged.delete(v); // Both removed
        } else if (!inLocal && inRemote) {
          // Local removed — apply if remote didn't add something new
          merged.delete(v);
        } else if (inLocal && !inRemote) {
          // Remote removed — apply if local didn't add something new
          merged.delete(v);
        }
      }

      if (merged.size > 0) {
        result[pred] = Array.from(merged);
      }
    }

    return result;
  }

  /**
   * Additive-only relations merge (no cache). Union of both sides, no removals.
   */
  private _mergeRelationsAdditive(local: unknown, remote: unknown): Record<string, string[]> {
    const localRel = this._normalizeRelations(local);
    const remoteRel = this._normalizeRelations(remote);

    const allPredicates = new Set([...Object.keys(localRel), ...Object.keys(remoteRel)]);
    const result: Record<string, string[]> = {};

    for (const pred of allPredicates) {
      const merged = new Set([...(localRel[pred] ?? []), ...(remoteRel[pred] ?? [])]);
      if (merged.size > 0) {
        result[pred] = Array.from(merged);
      }
    }

    return result;
  }

  /**
   * Normalize a relations value to {predicate: string[]} format.
   */
  private _normalizeRelations(val: unknown): Record<string, string[]> {
    if (!val || typeof val !== 'object') return {};
    const result: Record<string, string[]> = {};
    for (const [pred, uris] of Object.entries(val as Record<string, unknown>)) {
      if (typeof uris === 'string') {
        result[pred] = [uris];
      } else if (Array.isArray(uris)) {
        result[pred] = uris.filter(u => typeof u === 'string');
      }
    }
    return result;
  }

  /**
   * Check if two creator arrays are equivalent (same creators, possibly different order).
   */
  private _creatorsEqual(a: unknown, b: unknown): boolean {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    // Compare element-by-element in order — creator order is semantically meaningful
    // (first author vs second author). Matches official Zotero's positional comparison.
    // Uses explicit field comparison to avoid JSON key-order sensitivity.
    return a.every((c: any, i: number) => {
      const d = b[i] as any;
      if (!c || !d || typeof c !== 'object' || typeof d !== 'object') {
        return JSON.stringify(c) === JSON.stringify(d);
      }
      return (c.firstName ?? '') === (d.firstName ?? '')
        && (c.lastName ?? '') === (d.lastName ?? '')
        && (c.name ?? '') === (d.name ?? '')
        && (c.creatorType ?? 'author') === (d.creatorType ?? 'author');
    });
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
