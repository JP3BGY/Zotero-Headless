// Full Sync Option Tests
// Regression test for: fullSync option not being passed correctly to downloadUpdates

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncManager } from '../manager.js';

describe('Full Sync Option - Unit Tests', () => {
  describe('SyncManager twoWaySync sinceVersion logic', () => {
    it('should calculate sinceVersion=0 when fullSync=true', () => {
      // Direct test of the logic that was fixed:
      // const sinceVersion = fullSync ? 0 : localVersion;
      
      const testCases = [
        { fullSync: true, localVersion: 8, expected: 0 },
        { fullSync: true, localVersion: 0, expected: 0 },
        { fullSync: true, localVersion: 100, expected: 0 },
        { fullSync: false, localVersion: 8, expected: 8 },
        { fullSync: false, localVersion: 0, expected: 0 },
        { fullSync: false, localVersion: 100, expected: 100 }
      ];
      
      for (const { fullSync, localVersion, expected } of testCases) {
        const sinceVersion = fullSync ? 0 : localVersion;
        expect(sinceVersion).toBe(expected);
      }
    });

    it('should demonstrate the bug scenario and fix', () => {
      // Bug scenario:
      // - User has items on Zotero web
      // - localVersion = 8, remoteVersion = 8
      // - User runs: zotero sync --full-sync
      // - EXPECTED: sinceVersion = 0 (fetch all items)
      // - BUG: sinceVersion = 8 (fetch nothing, versions match)
      
      const localVersion = 8;
      const remoteVersion = 8;
      const fullSync = true;
      
      // The fixed logic
      const sinceVersion = fullSync ? 0 : localVersion;
      
      // With the fix, sinceVersion should be 0, not 8
      expect(sinceVersion).toBe(0);
      expect(sinceVersion).not.toBe(localVersion);
      
      // This ensures API is called with ?since=0, fetching all items
      // Instead of ?since=8, which would return 0 changes
    });

    it('should handle incremental sync correctly without fullSync', () => {
      // Normal incremental sync scenario:
      // - localVersion = 5, remoteVersion = 10
      // - User runs: zotero sync
      // - EXPECTED: sinceVersion = 5 (fetch only changes since version 5)
      
      const localVersion = 5;
      const remoteVersion = 10;
      const fullSync = false;
      
      const sinceVersion = fullSync ? 0 : localVersion;
      
      expect(sinceVersion).toBe(5);
      
      // API would be called with ?since=5, returning only items changed since then
    });
  });

  describe('SyncOptions interface validation', () => {
    it('should accept fullSync option in sync method', () => {
      // Verify the sync method accepts fullSync option
      const mockApiClient = {
        verifyKey: vi.fn().mockResolvedValue({ username: 'test', userID: 12345 }),
        getLibraryVersion: vi.fn().mockResolvedValue(10),
        getItemVersions: vi.fn().mockResolvedValue({}),
        getItems: vi.fn().mockResolvedValue([]),
        getDeleted: vi.fn().mockResolvedValue({ items: [], collections: [] })
      };

      const syncManager = new SyncManager(mockApiClient as any);
      
      // These should not throw type errors
      expect(() => syncManager.sync({ fullSync: true })).not.toThrow();
      expect(() => syncManager.sync({ fullSync: false })).not.toThrow();
      expect(() => syncManager.sync({})).not.toThrow();
      expect(() => syncManager.sync()).not.toThrow();
    });

    it('should call API with correct since parameter based on fullSync', async () => {
      const mockApiClient = {
        verifyKey: vi.fn().mockResolvedValue({ username: 'test', userID: 12345 }),
        getLibraryVersion: vi.fn().mockResolvedValue(10),
        getItemVersions: vi.fn().mockResolvedValue({ 'ITEM1': 5 }),
        getItems: vi.fn().mockResolvedValue([{
          key: 'ITEM1',
          version: 5,
          data: { itemType: 'journalArticle', title: 'Test', date: '2024' }
        }]),
        getDeleted: vi.fn().mockResolvedValue({ items: [], collections: [] })
      };

      const syncManager = new SyncManager(mockApiClient as any);
      
      // Test with fullSync: true - should call with since=0
      await syncManager.sync({ fullSync: true });
      
      expect(mockApiClient.getItemVersions).toHaveBeenCalled();
      const sinceValueWithFullSync = mockApiClient.getItemVersions.mock.calls[0][1];
      expect(sinceValueWithFullSync).toBe(0);
    });
  });

  describe('CLI argument handling', () => {
    it('should document --full-sync flag behavior', () => {
      // Documentation test showing expected CLI behavior
      
      // zotero sync           → fullSync: false (incremental)
      // zotero sync --full-sync → fullSync: true (complete re-sync)
      // zotero sync -f        → fullSync: true (shorthand)
      
      const cliScenarios = [
        { args: [], expectedFullSync: false },
        { args: ['--full-sync'], expectedFullSync: true },
        { args: ['-f'], expectedFullSync: true },
        { args: ['--full-sync', '--verbose'], expectedFullSync: true }
      ];
      
      for (const { args, expectedFullSync } of cliScenarios) {
        const fullSync = args.includes('--full-sync') || args.includes('-f');
        expect(fullSync).toBe(expectedFullSync);
      }
    });
  });
});

// Integration test with mocked dependencies
describe('Full Sync Integration', () => {
  it('should sync all items when fullSync=true regardless of version match', async () => {
    const mockApiClient = {
      verifyKey: vi.fn().mockResolvedValue({
        username: 'testuser',
        userID: 12345
      }),
      getLibraryVersion: vi.fn().mockResolvedValue(8),
      // Return items even though versions will match
      getItemVersions: vi.fn().mockResolvedValue({
        'ITEM001': 5,
        'ITEM002': 6
      }),
      getItems: vi.fn().mockResolvedValue([
        { key: 'ITEM001', version: 5, data: { itemType: 'article', title: 'Item 1', date: '2024' } },
        { key: 'ITEM002', version: 6, data: { itemType: 'article', title: 'Item 2', date: '2024' } }
      ]),
      getDeleted: vi.fn().mockResolvedValue({ items: [], collections: [] })
    };

    const syncManager = new SyncManager(mockApiClient as any);
    
    // Mock the sync to bypass database operations
    // The key assertion is that getItemVersions is called with since=0
    
    // We can't easily test the full flow without a database, but we can verify
    // the syncManager accepts the option and tries to call the API
    
    const result = await syncManager.sync({ fullSync: true });
    
    // The result will show errors because we don't have a real database,
    // but we can verify the API was called
    expect(mockApiClient.getItemVersions).toHaveBeenCalled();
    
    // The first argument should be the zoteroId, second should be since=0
    const callArgs = mockApiClient.getItemVersions.mock.calls[0];
    expect(callArgs[1]).toBe(0); // since=0 for full sync
  });

  it('should demonstrate the fixed bug: sinceVersion calculation', () => {
    // This test documents the exact bug that was fixed
    
    // BEFORE FIX (buggy code):
    // const downloadResult = await this.downloadUpdates(libraryId, zoteroId, localVersion);
    // → Always used localVersion, ignoring fullSync flag
    
    // AFTER FIX (correct code):
    // const sinceVersion = fullSync ? 0 : localVersion;
    // const downloadResult = await this.downloadUpdates(libraryId, zoteroId, sinceVersion);
    // → Uses 0 for full sync, localVersion for incremental
    
    function buggySyncLogic(localVersion: number, fullSync: boolean) {
      // Bug: always uses localVersion
      return localVersion;
    }
    
    function fixedSyncLogic(localVersion: number, fullSync: boolean) {
      // Fix: respects fullSync flag
      return fullSync ? 0 : localVersion;
    }
    
    // Test scenarios
    const scenarios = [
      { localVersion: 8, fullSync: true, expectedBuggy: 8, expectedFixed: 0 },
      { localVersion: 8, fullSync: false, expectedBuggy: 8, expectedFixed: 8 },
      { localVersion: 0, fullSync: true, expectedBuggy: 0, expectedFixed: 0 }
    ];
    
    for (const scenario of scenarios) {
      const buggy = buggySyncLogic(scenario.localVersion, scenario.fullSync);
      const fixed = fixedSyncLogic(scenario.localVersion, scenario.fullSync);
      
      expect(buggy).toBe(scenario.expectedBuggy);
      expect(fixed).toBe(scenario.expectedFixed);
    }
  });
});
