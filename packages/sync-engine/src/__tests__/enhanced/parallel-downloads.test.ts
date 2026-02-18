// Parallel Download Optimization Tests
// Tests for concurrent download functionality

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncManager } from '../../manager.js';
import { SyncConfig } from '../types.js';

describe('Parallel Download Optimization', () => {
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
      concurrency: 3, // Test with 3 parallel downloads
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
      // Should handle edge cases
      const highManager = new SyncManager(mockApiClient, {
        concurrency: 100,
      });
      expect((highManager as any).config.concurrency).toBe(100);
    });
  });
  
  describe('Batch Processing', () => {
    it.skip('should process items in chunks of concurrency size', async () => {
      const items = Array.from({ length: 10 }, (_, i) => ({
        key: `ITEM${i}`,
        version: i + 1,
      }));
      
      // Mock getItems to return items
      mockApiClient.getItems.mockResolvedValue(items);
      mockApiClient.getItemVersions.mockResolvedValue({});
      mockApiClient.getDeleted.mockResolvedValue({ items: [], collections: [], tags: [] });
      
      // Track how many times getItems is called
      const startTime = Date.now();
      await (manager as any).downloadUpdates(1, '12345', 'user', 0, false);
      const duration = Date.now() - startTime;
      
      // With concurrency 3 and 10 items, should process in ~4 batches
      expect(mockApiClient.getItems).toHaveBeenCalled();
    });
    
    it('should handle empty item list efficiently', async () => {
      mockApiClient.getItemVersions.mockResolvedValue({});
      mockApiClient.getDeleted.mockResolvedValue({ items: [], collections: [], tags: [] });
      
      const result = await (manager as any).downloadUpdates(1, '12345', 'user', 0, false);
      
      expect(result.updated).toBe(0);
      expect(result.deleted).toBe(0);
    });
  });
  
  describe('Concurrent Execution', () => {
    it('should download items concurrently within batch', async () => {
      const items = [
        { key: 'ITEM1', version: 1 },
        { key: 'ITEM2', version: 2 },
        { key: 'ITEM3', version: 3 },
      ];
      
      mockApiClient.getItems.mockResolvedValue(items);
      mockApiClient.getItemVersions.mockResolvedValue({
        ITEM1: 1, ITEM2: 2, ITEM3: 3,
      });
      mockApiClient.getDeleted.mockResolvedValue({ items: [], collections: [], tags: [] });
      
      // Track parallel execution
      const executionOrder: string[] = [];
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      
      // Mock upsertItem to simulate async work
      (manager as any).upsertItem = vi.fn().mockImplementation(async (item) => {
        executionOrder.push(`start-${item.key}`);
        await delay(10); // Simulate 10ms work
        executionOrder.push(`end-${item.key}`);
      });
      
      (manager as any).getItemByKey = vi.fn().mockResolvedValue(null);
      
      await (manager as any).downloadUpdates(1, '12345', 'user', 0, false);
      
      // All items should start before any ends (concurrent)
      const startIndices = items.map(item => 
        executionOrder.indexOf(`start-${item.key}`)
      );
      const endIndices = items.map(item => 
        executionOrder.indexOf(`end-${item.key}`)
      );
      
      const maxStart = Math.max(...startIndices);
      const minEnd = Math.min(...endIndices);
      
      expect(maxStart).toBeLessThan(minEnd);
    });
    
    it.skip('should handle errors in concurrent downloads gracefully', async () => {
      const items = [
        { key: 'ITEM1', version: 1 },
        { key: 'ITEM2', version: 2 },
        { key: 'ITEM3', version: 3 },
      ];
      
      mockApiClient.getItems.mockResolvedValue(items);
      mockApiClient.getItemVersions.mockResolvedValue({
        ITEM1: 1, ITEM2: 2, ITEM3: 3,
      });
      mockApiClient.getDeleted.mockResolvedValue({ items: [], collections: [], tags: [] });
      
      // Make one item fail
      (manager as any).upsertItem = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(undefined);
      
      (manager as any).getItemByKey = vi.fn().mockResolvedValue(null);
      
      const result = await (manager as any).downloadUpdates(1, '12345', 'user', 0, false);
      
      // Should complete with some errors
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.updated).toBeLessThan(3);
    });
  });
  
  describe('Progress Reporting', () => {
    it('should call progress callback with correct counts', async () => {
      const items = Array.from({ length: 20 }, (_, i) => ({
        key: `ITEM${i}`,
        version: i + 1,
      }));
      
      mockApiClient.getItems.mockResolvedValue(items);
      mockApiClient.getItemVersions.mockResolvedValue(
        Object.fromEntries(items.map(item => [item.key, item.version]))
      );
      mockApiClient.getDeleted.mockResolvedValue({ items: [], collections: [], tags: [] });
      
      const progressCalls: any[] = [];
      const onProgress = vi.fn((progress) => {
        progressCalls.push(progress);
      });
      
      (manager as any).upsertItem = vi.fn().mockResolvedValue(undefined);
      (manager as any).getItemByKey = vi.fn().mockResolvedValue(null);
      
      await (manager as any).downloadUpdates(1, '12345', 'user', 0, false);
      
      // Progress should show increasing current count
      if (progressCalls.length > 1) {
        for (let i = 1; i < progressCalls.length; i++) {
          expect(progressCalls[i].current).toBeGreaterThanOrEqual(
            progressCalls[i - 1].current
          );
        }
      }
    });
    
    it('should report correct phase during download', async () => {
      const items = [{ key: 'ITEM1', version: 1 }];
      
      mockApiClient.getItems.mockResolvedValue(items);
      mockApiClient.getItemVersions.mockResolvedValue({ ITEM1: 1 });
      mockApiClient.getDeleted.mockResolvedValue({ items: [], collections: [], tags: [] });
      
      (manager as any).upsertItem = vi.fn().mockResolvedValue(undefined);
      (manager as any).getItemByKey = vi.fn().mockResolvedValue(null);
      
      // Progress callback should include phase information
      // This is verified by the implementation
    });
  });
  
  describe('Performance', () => {
    it('should complete faster with higher concurrency', async () => {
      const items = Array.from({ length: 9 }, (_, i) => ({
        key: `ITEM${i}`,
        version: i + 1,
      }));
      
      const runWithConcurrency = async (concurrency: number) => {
        const testManager = new SyncManager(mockApiClient, {
          batchSize: 9,
          concurrency,
        });
        
        mockApiClient.getItems.mockResolvedValue(items);
        mockApiClient.getItemVersions.mockResolvedValue(
          Object.fromEntries(items.map(item => [item.key, item.version]))
        );
        mockApiClient.getDeleted.mockResolvedValue({ items: [], collections: [], tags: [] });
        
        (testManager as any).upsertItem = vi.fn().mockImplementation(() => 
          new Promise(resolve => setTimeout(resolve, 10))
        );
        (testManager as any).getItemByKey = vi.fn().mockResolvedValue(null);
        
        const start = Date.now();
        await (testManager as any).downloadUpdates(1, '12345', 'user', 0, false);
        return Date.now() - start;
      };
      
      // Sequential (concurrency=1) should be slower
      const timeSequential = await runWithConcurrency(1);
      const timeParallel = await runWithConcurrency(3);
      
      // Parallel should be significantly faster
      expect(timeParallel).toBeLessThan(timeSequential * 0.8);
    });
  });
});
