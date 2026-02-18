// Interactive Conflict Resolution Tests
// Tests for interactive conflict resolver

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  promptConflictResolution,
  resolveConflictsInteractive,
  createPrompt,
  isInteractive,
  ConflictItem,
} from '../../conflict-resolver.js';
import readline from 'readline';

describe('Interactive Conflict Resolution', () => {
  describe('isInteractive', () => {
    it('should return true when running in TTY', () => {
      // Mock TTY environment
      const originalIsTTY = process.stdin.isTTY;
      process.stdin.isTTY = true;
      process.stdout.isTTY = true;
      
      expect(isInteractive()).toBe(true);
      
      process.stdin.isTTY = originalIsTTY;
    });
    
    it('should return false when not in TTY', () => {
      const originalIsTTY = process.stdin.isTTY;
      process.stdin.isTTY = false;
      process.stdout.isTTY = false;
      
      expect(isInteractive()).toBe(false);
      
      process.stdin.isTTY = originalIsTTY;
    });
  });
  
  describe('createPrompt', () => {
    it('should create readline interface', () => {
      const rl = createPrompt();
      expect(rl).toBeDefined();
      expect(typeof rl.question).toBe('function');
      rl.close();
    });
  });
  
  describe('promptConflictResolution', () => {
    let mockRl: any;
    
    beforeEach(() => {
      mockRl = {
        question: vi.fn(),
        close: vi.fn(),
      };
    });
    
    const mockConflict: ConflictItem = {
      key: 'TEST1234',
      title: 'Test Paper Title',
      localVersion: 5,
      remoteVersion: 6,
      localModified: new Date('2024-01-15T10:30:00'),
      remoteModified: new Date('2024-01-16T14:20:00'),
    };
    
    it('should resolve to "remote" when user inputs "r"', async () => {
      mockRl.question.mockImplementation((prompt: string, callback: Function) => {
        callback('r');
      });
      
      const result = await promptConflictResolution(mockConflict, mockRl);
      expect(result).toBe('remote');
    });
    
    it('should resolve to "local" when user inputs "l"', async () => {
      mockRl.question.mockImplementation((prompt: string, callback: Function) => {
        callback('l');
      });
      
      const result = await promptConflictResolution(mockConflict, mockRl);
      expect(result).toBe('local');
    });
    
    it('should resolve to "skip" when user inputs "s"', async () => {
      mockRl.question.mockImplementation((prompt: string, callback: Function) => {
        callback('s');
      });
      
      const result = await promptConflictResolution(mockConflict, mockRl);
      expect(result).toBe('skip');
    });
    
    it('should resolve to "all-remote" when user inputs "R"', async () => {
      mockRl.question.mockImplementation((prompt: string, callback: Function) => {
        callback('R');
      });
      
      const result = await promptConflictResolution(mockConflict, mockRl);
      expect(result).toBe('all-remote');
    });
    
    it('should resolve to "all-local" when user inputs "L"', async () => {
      mockRl.question.mockImplementation((prompt: string, callback: Function) => {
        callback('L');
      });
      
      const result = await promptConflictResolution(mockConflict, mockRl);
      expect(result).toBe('all-local');
    });
    
    it('should default to "skip" for invalid input', async () => {
      mockRl.question.mockImplementation((prompt: string, callback: Function) => {
        callback('invalid');
      });
      
      const result = await promptConflictResolution(mockConflict, mockRl);
      expect(result).toBe('skip');
    });
    
    it('should handle empty input gracefully', async () => {
      mockRl.question.mockImplementation((prompt: string, callback: Function) => {
        callback('');
      });
      
      const result = await promptConflictResolution(mockConflict, mockRl);
      expect(result).toBe('skip');
    });
    
    it('should display conflict details in prompt', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      mockRl.question.mockImplementation((prompt: string, callback: Function) => {
        callback('r');
      });
      
      await promptConflictResolution(mockConflict, mockRl);
      
      // Verify conflict details are displayed
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(mockConflict.title!));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(mockConflict.key));
      
      consoleSpy.mockRestore();
    });
  });
  
  describe('resolveConflictsInteractive', () => {
    let mockRl: any;
    
    beforeEach(() => {
      mockRl = {
        question: vi.fn(),
        close: vi.fn(),
      };
    });
    
    const conflicts: ConflictItem[] = [
      { key: 'ITEM1', title: 'Paper 1', localVersion: 1, remoteVersion: 2 },
      { key: 'ITEM2', title: 'Paper 2', localVersion: 3, remoteVersion: 4 },
      { key: 'ITEM3', title: 'Paper 3', localVersion: 5, remoteVersion: 6 },
    ];
    
    it('should return empty map for empty conflicts list', async () => {
      const result = await resolveConflictsInteractive([]);
      expect(result.size).toBe(0);
    });
    
    it('should resolve all conflicts individually', async () => {
      let callCount = 0;
      mockRl.question.mockImplementation((prompt: string, callback: Function) => {
        const responses = ['r', 'l', 's'];
        callback(responses[callCount++]);
      });
      
      // Mock createPrompt to return our mock
      const originalCreatePrompt = createPrompt;
      vi.spyOn(require('../../conflict-resolver.js'), 'createPrompt')
        .mockReturnValue(mockRl);
      
      const result = await resolveConflictsInteractive(conflicts);
      
      expect(result.get('ITEM1')).toBe('remote');
      expect(result.get('ITEM2')).toBe('local');
      expect(result.get('ITEM3')).toBe('skip');
      
      expect(mockRl.close).toHaveBeenCalled();
    });
    
    it('should apply global strategy after "all-remote" selection', async () => {
      let callCount = 0;
      mockRl.question.mockImplementation((prompt: string, callback: Function) => {
        // First item: choose all-remote
        // Others should auto-resolve
        const responses = ['R'];
        callback(responses[callCount++] || 'r');
      });
      
      vi.spyOn(require('../../conflict-resolver.js'), 'createPrompt')
        .mockReturnValue(mockRl);
      
      const result = await resolveConflictsInteractive(conflicts);
      
      // All should be remote after global selection
      expect(result.get('ITEM1')).toBe('remote');
      expect(result.get('ITEM2')).toBe('remote');
      expect(result.get('ITEM3')).toBe('remote');
    });
    
    it('should apply global strategy after "all-local" selection', async () => {
      let callCount = 0;
      mockRl.question.mockImplementation((prompt: string, callback: Function) => {
        callback(callCount++ === 0 ? 'L' : 'l');
      });
      
      vi.spyOn(require('../../conflict-resolver.js'), 'createPrompt')
        .mockReturnValue(mockRl);
      
      const result = await resolveConflictsInteractive(conflicts);
      
      expect(result.get('ITEM1')).toBe('local');
      expect(result.get('ITEM2')).toBe('local');
      expect(result.get('ITEM3')).toBe('local');
    });
    
    it('should display conflict count at start', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      mockRl.question.mockImplementation((prompt: string, callback: Function) => {
        callback('r');
      });
      
      vi.spyOn(require('../../conflict-resolver.js'), 'createPrompt')
        .mockReturnValue(mockRl);
      
      await resolveConflictsInteractive(conflicts);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(`${conflicts.length} conflicts`)
      );
      
      consoleSpy.mockRestore();
    });
    
    it('should handle missing title gracefully', async () => {
      const conflictsNoTitle: ConflictItem[] = [
        { key: 'ITEM1', localVersion: 1, remoteVersion: 2 },
      ];
      
      mockRl.question.mockImplementation((prompt: string, callback: Function) => {
        callback('r');
      });
      
      vi.spyOn(require('../../conflict-resolver.js'), 'createPrompt')
        .mockReturnValue(mockRl);
      
      const result = await resolveConflictsInteractive(conflictsNoTitle);
      
      expect(result.get('ITEM1')).toBe('remote');
    });
  });
  
  describe('Integration with SyncManager', () => {
    it('should be importable by sync manager', () => {
      // Verify the module exports are correct
      expect(typeof promptConflictResolution).toBe('function');
      expect(typeof resolveConflictsInteractive).toBe('function');
      expect(typeof createPrompt).toBe('function');
      expect(typeof isInteractive).toBe('function');
    });
  });
});
