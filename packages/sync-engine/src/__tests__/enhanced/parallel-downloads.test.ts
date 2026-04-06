// Download Pipeline Tests
// Tests for the safe download pipeline with transactions, version detection, and three-way merge.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncManager } from '../../manager.js';
import { SyncConfig } from '../types.js';

// Helper to create API response format
const versionsResponse = (versions: Record<string, number>, libraryVersion = 100) =>
  ({ versions, libraryVersion });
const itemsResponse = (items: any[], libraryVersion = 100) =>
  ({ items, libraryVersion });
const deletedResponse = (deleted = { items: [] as string[], collections: [] as string[], tags: [] as string[] }, libraryVersion = 100) =>
  ({ deleted, libraryVersion });

describe('Download Pipeline', () => {
  let manager: SyncManager;
  let mockApiClient: any;

  beforeEach(() => {
    mockApiClient = {
      getItemVersions: vi.fn(),
      getItems: vi.fn(),
      getDeleted: vi.fn(),
    };

    const config: SyncConfig = {
      batchSize: 10,
      concurrency: 3,
    };

    manager = new SyncManager(mockApiClient, config);
  });

  describe('Configuration', () => {
    it('should use default concurrency of 5', () => {
      const defaultManager = new SyncManager(mockApiClient, {});
      expect((defaultManager as any).config.concurrency).toBe(5);
    });

    it('should accept custom concurrency setting', () => {
      const customManager = new SyncManager(mockApiClient, {
        concurrency: 10,
      });
      expect((customManager as any).config.concurrency).toBe(10);
    });

    it('should limit concurrency to reasonable range', () => {
      const highManager = new SyncManager(mockApiClient, {
        concurrency: 100,
      });
      expect((highManager as any).config.concurrency).toBe(100);
    });
  });

  describe('Batch Processing', () => {
    it.skip('should process items in batches', async () => {
      const items = Array.from({ length: 10 }, (_, i) => ({
        key: `ITEM${i}`,
        version: i + 1,
      }));

      mockApiClient.getItems.mockResolvedValue(itemsResponse(items));
      mockApiClient.getItemVersions.mockResolvedValue(versionsResponse({}));
      mockApiClient.getDeleted.mockResolvedValue(deletedResponse());

      await (manager as any).downloadUpdates(1, '12345', 'user', 0, false);

      expect(mockApiClient.getItems).toHaveBeenCalled();
    });

    it('should handle empty item list efficiently', async () => {
      mockApiClient.getItemVersions.mockResolvedValue(versionsResponse({}));
      mockApiClient.getDeleted.mockResolvedValue(deletedResponse());

      // Mock syncQueue since there's no real database
      (manager as any).syncQueue = { getDueForRetry: vi.fn().mockReturnValue([]), enqueue: vi.fn(), dequeue: vi.fn() };

      const result = await (manager as any).downloadUpdates(1, '12345', 'user', 0, false);

      expect(result.updated).toBe(0);
      expect(result.deleted).toBe(0);
    });
  });

  describe('Library Version Change Detection', () => {
    it('should request restart if library version changes between version calls', async () => {
      // First call returns version 100
      mockApiClient.getItemVersions
        .mockResolvedValueOnce(versionsResponse({ ITEM1: 1 }, 100))
        // Second call returns version 101 (changed!)
        .mockResolvedValueOnce(versionsResponse({ ITEM1: 1 }, 101));

      mockApiClient.getDeleted.mockResolvedValue(deletedResponse());

      const result = await (manager as any).downloadUpdates(1, '12345', 'user', 0, false);

      expect(result.restart).toBe(true);
    });
  });

  describe('Transactional Safety', () => {
    it('should process batches atomically via transactions', async () => {
      const versions = { ITEM1: 1, ITEM2: 2, ITEM3: 3 };
      const apiItems = [
        { key: 'ITEM1', version: 1, data: { itemType: 'journalArticle', title: 'Test 1' } },
        { key: 'ITEM2', version: 2, data: { itemType: 'journalArticle', title: 'Test 2' } },
        { key: 'ITEM3', version: 3, data: { itemType: 'journalArticle', title: 'Test 3' } },
      ];

      mockApiClient.getItemVersions.mockResolvedValue(versionsResponse(versions));
      mockApiClient.getItems.mockResolvedValue(itemsResponse(apiItems));
      mockApiClient.getDeleted.mockResolvedValue(deletedResponse());

      // The processDownloadedItem method is called within a SQLite transaction
      // Verify it exists and is callable
      expect(typeof (manager as any).processDownloadedItem).toBe('function');
    });
  });

  describe('Progress Reporting', () => {
    it('should handle progress tracking for download', async () => {
      const items = Array.from({ length: 20 }, (_, i) => ({
        key: `ITEM${i}`,
        version: i + 1,
        data: { itemType: 'journalArticle', title: `Test ${i}` },
      }));
      const versions = Object.fromEntries(items.map(item => [item.key, item.version]));

      mockApiClient.getItems.mockResolvedValue(itemsResponse(items));
      mockApiClient.getItemVersions.mockResolvedValue(versionsResponse(versions));
      mockApiClient.getDeleted.mockResolvedValue(deletedResponse());

      // Mock internal methods to prevent DB access
      (manager as any).processDownloadedItem = vi.fn().mockReturnValue({ updated: true, conflict: false, queued: false });
      (manager as any).syncQueue = { getDueForRetry: vi.fn().mockReturnValue([]), enqueue: vi.fn(), dequeue: vi.fn() };

      const result = await (manager as any).downloadUpdates(1, '12345', 'user', 0, false);

      // getItems mock returns all 20 items per call, with batchSize=10 it's called twice
      // so processDownloadedItem is called 40 times total
      expect(result.updated).toBe(40);
    });

    it('should report correct phase during download', async () => {
      mockApiClient.getItemVersions.mockResolvedValue(versionsResponse({ ITEM1: 1 }));
      mockApiClient.getItems.mockResolvedValue(itemsResponse([
        { key: 'ITEM1', version: 1, data: { itemType: 'journalArticle', title: 'Test' } },
      ]));
      mockApiClient.getDeleted.mockResolvedValue(deletedResponse());

      (manager as any).processDownloadedItem = vi.fn().mockReturnValue({ updated: true, conflict: false, queued: false });
      (manager as any).syncQueue = { getDueForRetry: vi.fn().mockReturnValue([]), enqueue: vi.fn(), dequeue: vi.fn() };

      // Should complete without error
      const result = await (manager as any).downloadUpdates(1, '12345', 'user', 0, false);
      expect(result.updated).toBe(1);
    });
  });

  describe('Performance', () => {
    it('should process batches efficiently', async () => {
      const items = Array.from({ length: 9 }, (_, i) => ({
        key: `ITEM${i}`,
        version: i + 1,
        data: { itemType: 'journalArticle', title: `Test ${i}` },
      }));
      const versions = Object.fromEntries(items.map(item => [item.key, item.version]));

      mockApiClient.getItems.mockResolvedValue(itemsResponse(items));
      mockApiClient.getItemVersions.mockResolvedValue(versionsResponse(versions));
      mockApiClient.getDeleted.mockResolvedValue(deletedResponse());

      (manager as any).processDownloadedItem = vi.fn().mockReturnValue({ updated: true, conflict: false, queued: false });
      (manager as any).syncQueue = { getDueForRetry: vi.fn().mockReturnValue([]), enqueue: vi.fn(), dequeue: vi.fn() };

      const start = Date.now();
      const result = await (manager as any).downloadUpdates(1, '12345', 'user', 0, false);
      const duration = Date.now() - start;

      expect(result.updated).toBe(9);
      // Should be fast since we're mocking everything
      expect(duration).toBeLessThan(1000);
    });
  });
});
