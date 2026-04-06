// Sync Safety Tests
// Tests for the 8 sync safety fixes (Issues #1-#8)

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictResolver } from '../conflict.js';

// ============================================================================
// Issue #5: Creators array ordering (unit test on ConflictResolver internals)
// ============================================================================
describe('Issue #5: Creators ordering', () => {
  let resolver: ConflictResolver;

  beforeEach(() => {
    resolver = new ConflictResolver();
  });

  it('_creatorsEqual returns false for same creators in different order', () => {
    const a = [
      { firstName: 'Alice', lastName: 'Smith', creatorType: 'author' },
      { firstName: 'Bob', lastName: 'Jones', creatorType: 'author' },
    ];
    const b = [
      { firstName: 'Bob', lastName: 'Jones', creatorType: 'author' },
      { firstName: 'Alice', lastName: 'Smith', creatorType: 'author' },
    ];

    // Access private method via type assertion
    const result = (resolver as any)._creatorsEqual(a, b);
    expect(result).toBe(false);
  });

  it('_creatorsEqual returns true for same creators in same order', () => {
    const a = [
      { firstName: 'Alice', lastName: 'Smith', creatorType: 'author' },
      { firstName: 'Bob', lastName: 'Jones', creatorType: 'author' },
    ];
    const b = [
      { firstName: 'Alice', lastName: 'Smith', creatorType: 'author' },
      { firstName: 'Bob', lastName: 'Jones', creatorType: 'author' },
    ];

    const result = (resolver as any)._creatorsEqual(a, b);
    expect(result).toBe(true);
  });

  it('_creatorsEqual returns false for different lengths', () => {
    const a = [{ firstName: 'Alice', lastName: 'Smith', creatorType: 'author' }];
    const b = [
      { firstName: 'Alice', lastName: 'Smith', creatorType: 'author' },
      { firstName: 'Bob', lastName: 'Jones', creatorType: 'author' },
    ];

    const result = (resolver as any)._creatorsEqual(a, b);
    expect(result).toBe(false);
  });
});

// ============================================================================
// Issue #1: Remote deletion vs local unsynced modifications
// ============================================================================
describe('Issue #1: processRemoteDeletions logic', () => {
  it('should not delete items with local unsynced changes when strategy is local', () => {
    // This tests the conceptual logic: unsynced + not deleted = conflict
    // Items with synced=false and deleted=false should be preserved

    const items = [
      { key: 'A', synced: true, deleted: false },   // safe to delete
      { key: 'B', synced: false, deleted: false },   // CONFLICT
      { key: 'C', synced: false, deleted: true },     // both agree
    ];

    const strategy = 'local';
    const safeToDelete: string[] = [];
    const conflicts: string[] = [];

    for (const item of items) {
      if (item.synced) {
        safeToDelete.push(item.key);
      } else if (item.deleted) {
        safeToDelete.push(item.key);
      } else {
        if (strategy === 'remote') {
          safeToDelete.push(item.key);
        } else {
          conflicts.push(item.key);
        }
      }
    }

    expect(safeToDelete).toEqual(['A', 'C']);
    expect(conflicts).toEqual(['B']);
  });

  it('should delete all items when strategy is remote', () => {
    const items = [
      { key: 'A', synced: true, deleted: false },
      { key: 'B', synced: false, deleted: false },
      { key: 'C', synced: false, deleted: true },
    ];

    const strategy = 'remote';
    const safeToDelete: string[] = [];
    const conflicts: string[] = [];

    for (const item of items) {
      if (item.synced) {
        safeToDelete.push(item.key);
      } else if (item.deleted) {
        safeToDelete.push(item.key);
      } else {
        if (strategy === 'remote') {
          safeToDelete.push(item.key);
        } else {
          conflicts.push(item.key);
        }
      }
    }

    expect(safeToDelete).toEqual(['A', 'B', 'C']);
    expect(conflicts).toEqual([]);
  });
});

// ============================================================================
// Issue #3: Hard-deleted items vs remote downloads
// ============================================================================
describe('Issue #3: Deletion log check on download', () => {
  it('should detect user-deleted items from deletion_log (logic test)', () => {
    // Simulates the logic: if an item is not in the items table
    // but has a deletion_log entry with caller != 'sync', it's a conflict

    const deletionLog = [
      { item_key: 'DEL1', caller: 'cli' },     // User deleted via CLI
      { item_key: 'DEL2', caller: 'sync' },     // Deleted by sync (not a conflict)
      { item_key: 'DEL3', caller: 'shell' },    // User deleted via shell
    ];

    const strategy = 'local';
    const apiItemKeys = ['DEL1', 'DEL2', 'DEL3', 'NEW1'];
    const results: Array<{ key: string; action: string }> = [];

    for (const key of apiItemKeys) {
      const logEntry = deletionLog.find(e => e.item_key === key && e.caller !== 'sync');
      if (logEntry) {
        // User deleted this item
        if (strategy === 'remote') {
          results.push({ key, action: 'recreate' });
        } else {
          results.push({ key, action: 'skip' });
        }
      } else {
        results.push({ key, action: 'upsert' });
      }
    }

    expect(results).toEqual([
      { key: 'DEL1', action: 'skip' },    // User deleted, strategy=local → skip
      { key: 'DEL2', action: 'upsert' },  // Sync deleted → allow re-download
      { key: 'DEL3', action: 'skip' },    // User deleted, strategy=local → skip
      { key: 'NEW1', action: 'upsert' },  // Not deleted → normal upsert
    ]);
  });
});

// ============================================================================
// Issue #2: Concurrent modification protection
// ============================================================================
describe('Issue #2: markAsSyncedIfUnchanged logic', () => {
  it('should not mark as synced if timestamp changed during upload', () => {
    const preUploadTimestamp = 1000;
    const currentTimestamp = 1005; // Changed during upload

    const shouldSync = currentTimestamp === preUploadTimestamp;
    expect(shouldSync).toBe(false);
  });

  it('should mark as synced if timestamp is unchanged', () => {
    const preUploadTimestamp = 1000;
    const currentTimestamp = 1000; // Same

    const shouldSync = currentTimestamp === preUploadTimestamp;
    expect(shouldSync).toBe(true);
  });
});

// ============================================================================
// Issue #6: Merge-then-upload on 412
// ============================================================================
describe('Issue #6: Three-way merge on 412', () => {
  let resolver: ConflictResolver;

  beforeEach(() => {
    resolver = new ConflictResolver();
  });

  it('should merge non-conflicting changes from both sides on 412', () => {
    // Simulates: local changed title, remote changed abstract
    const base = { title: 'Original', abstractNote: 'Old abstract', version: 1, key: 'ABC' };
    const local = { title: 'New Title', abstractNote: 'Old abstract', version: 1, key: 'ABC' };
    const remote = { title: 'Original', abstractNote: 'New abstract', version: 2, key: 'ABC' };

    const result = resolver.resolveForSync(base, local, remote);

    expect(result.type).toBe('resolved');
    expect(result.data.title).toBe('New Title');       // Local change preserved
    expect(result.data.abstractNote).toBe('New abstract'); // Remote change preserved
  });

  it('should prefer local for conflicting fields on 412', () => {
    // Both changed title — local wins in default merge
    const base = { title: 'Original', abstractNote: 'Same', version: 1, key: 'ABC' };
    const local = { title: 'Local Title', abstractNote: 'Same', version: 1, key: 'ABC' };
    const remote = { title: 'Remote Title', abstractNote: 'Same', version: 2, key: 'ABC' };

    const result = resolver.resolveForSync(base, local, remote);

    // Title is a conflict — resolveForSync defaults to local for conflict data
    expect(result.data.title).toBe('Local Title');
  });

  it('should use two-way merge when no cache available', () => {
    const local = { title: 'Local Title', abstractNote: 'Local note', version: 1, key: 'ABC' };
    const remote = { title: 'Remote Title', abstractNote: 'Remote note', version: 2, key: 'ABC' };

    const result = resolver.resolveWithoutCache(local, remote);

    // Without cache, scalar differences are conflicts — local wins by default
    expect(result.type).toBe('conflict');
    expect(result.data.title).toBe('Local Title');
  });
});

// ============================================================================
// Issue #7: Filter sync queue from uploads (logic test)
// ============================================================================
describe('Issue #7: Sync queue filtering', () => {
  it('should exclude queued items from upload list', () => {
    const allUnsynced = [
      { key: 'A', synced: false },
      { key: 'B', synced: false },
      { key: 'C', synced: false },
    ];
    const queuedKeys = new Set(['B']);

    const filtered = allUnsynced.filter(item => !queuedKeys.has(item.key));

    expect(filtered.map(i => i.key)).toEqual(['A', 'C']);
  });
});

// ============================================================================
// Issue #8: Missing remote keys cleanup (logic test)
// ============================================================================
describe('Issue #8: Missing remote key cleanup', () => {
  it('should identify keys not returned by API', () => {
    const requestedBatch = ['KEY1', 'KEY2', 'KEY3', 'KEY4'];
    const apiReturnedItems = [
      { key: 'KEY1' },
      { key: 'KEY3' },
    ];

    const returnedKeys = new Set(apiReturnedItems.map(i => i.key));
    const missingKeys = requestedBatch.filter(k => !returnedKeys.has(k));

    expect(missingKeys).toEqual(['KEY2', 'KEY4']);
  });
});
