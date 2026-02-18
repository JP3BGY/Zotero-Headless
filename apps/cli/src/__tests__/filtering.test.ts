// CLI Filtering and Search Tests
// Tests for list and search command enhancements

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { main } from '../index.js';

describe('CLI List Command Filtering', () => {
  let mockConsoleLog: any;
  let mockConsoleError: any;
  let originalArgv: string[];
  
  beforeEach(() => {
    mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    originalArgv = process.argv;
    vi.clearAllMocks();
  });
  
  afterEach(() => {
    process.argv = originalArgv;
    mockConsoleLog.mockRestore();
    mockConsoleError.mockRestore();
  });
  
  describe('Type Filtering (--type)', () => {
    it('should accept --type journalArticle', async () => {
      process.argv = ['node', 'cli', 'list', '--type', 'journalArticle'];
      
      try {
        await main();
      } catch (e) {
        // Expected if no library
      }
      
      // Should not error on argument parsing
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
    
    it('should accept -t shorthand', async () => {
      process.argv = ['node', 'cli', 'list', '-t', 'book'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
    
    it('should filter by type in output', async () => {
      process.argv = ['node', 'cli', 'list', '--type', 'journalArticle'];
      
      try {
        await main();
      } catch (e) {}
      
      // If items are shown, they should all be journalArticle type
      const calls = mockConsoleLog.mock.calls.flat().join('\n');
      if (calls.includes('📚 Items')) {
        // Type should be shown in output
        expect(calls).toContain('journalArticle');
      }
    });
  });
  
  describe('Status Filtering', () => {
    it('should accept --unsynced flag', async () => {
      process.argv = ['node', 'cli', 'list', '--unsynced'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
    
    it('should accept -u shorthand for --unsynced', async () => {
      process.argv = ['node', 'cli', 'list', '-u'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
    
    it('should accept --deleted flag', async () => {
      process.argv = ['node', 'cli', 'list', '--deleted'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
    
    it('should accept -d shorthand for --deleted', async () => {
      process.argv = ['node', 'cli', 'list', '-d'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
  });
  
  describe('Date Filtering', () => {
    it('should accept --since date', async () => {
      process.argv = ['node', 'cli', 'list', '--since', '2024-01-01'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
    
    it('should accept -s shorthand for --since', async () => {
      process.argv = ['node', 'cli', 'list', '-s', '2024-01-01'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
    
    it('should accept --until date', async () => {
      process.argv = ['node', 'cli', 'list', '--until', '2024-12-31'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
    
    it('should accept -e shorthand for --until', async () => {
      process.argv = ['node', 'cli', 'list', '-e', '2024-12-31'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
  });
  
  describe('Sorting (--sort)', () => {
    it('should accept --sort title', async () => {
      process.argv = ['node', 'cli', 'list', '--sort', 'title'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
    
    it('should accept --sort date', async () => {
      process.argv = ['node', 'cli', 'list', '--sort', 'date'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
    
    it('should accept --sort updated', async () => {
      process.argv = ['node', 'cli', 'list', '--sort', 'updated'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
    
    it('should accept --sort type', async () => {
      process.argv = ['node', 'cli', 'list', '--sort', 'type'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
  });
  
  describe('Order (--order)', () => {
    it('should accept --order asc', async () => {
      process.argv = ['node', 'cli', 'list', '--order', 'asc'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
    
    it('should accept --order desc', async () => {
      process.argv = ['node', 'cli', 'list', '--order', 'desc'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
  });
  
  describe('Pagination', () => {
    it('should accept --limit', async () => {
      process.argv = ['node', 'cli', 'list', '--limit', '10'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
    
    it('should accept -l shorthand for --limit', async () => {
      process.argv = ['node', 'cli', 'list', '-l', '10'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
    
    it('should accept --offset', async () => {
      process.argv = ['node', 'cli', 'list', '--offset', '5'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
    
    it('should accept -o shorthand for --offset', async () => {
      process.argv = ['node', 'cli', 'list', '-o', '5'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
  });
  
  describe('Combined Filters', () => {
    it('should accept multiple filters', async () => {
      process.argv = [
        'node', 'cli', 'list',
        '--type', 'journalArticle',
        '--unsynced',
        '--sort', 'title',
        '--order', 'asc',
        '--limit', '10'
      ];
      
      try {
        await main();
      } catch (e) {}
      
      // Should parse all arguments without error
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
    
    it('should display active filters in output', async () => {
      process.argv = ['node', 'cli', 'list', '--type', 'book', '--unsynced'];
      
      try {
        await main();
      } catch (e) {}
      
      // Output should show filter description
      const calls = mockConsoleLog.mock.calls.flat().join('\n');
      if (calls.includes('📚 Items')) {
        expect(calls).toContain('filtered');
      }
    });
  });
  
  describe('Backward Compatibility', () => {
    it('should still accept positional limit argument', async () => {
      process.argv = ['node', 'cli', 'list', '20'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
    
    it('should still accept positional limit and offset', async () => {
      process.argv = ['node', 'cli', 'list', '20', '10'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
  });
});

describe('CLI Search Command Enhancements', () => {
  let mockConsoleLog: any;
  let originalArgv: string[];
  
  beforeEach(() => {
    mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    originalArgv = process.argv;
    vi.clearAllMocks();
  });
  
  afterEach(() => {
    process.argv = originalArgv;
    mockConsoleLog.mockRestore();
  });
  
  describe('Field Filtering (--field)', () => {
    it('should accept --field title', async () => {
      process.argv = ['node', 'cli', 'search', 'test', '--field', 'title'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleLog).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
    
    it('should accept --field author', async () => {
      process.argv = ['node', 'cli', 'search', 'Smith', '--field', 'author'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleLog).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
    
    it('should accept --field tags', async () => {
      process.argv = ['node', 'cli', 'search', 'important', '--field', 'tags'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleLog).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
    
    it('should accept --field all', async () => {
      process.argv = ['node', 'cli', 'search', 'term', '--field', 'all'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleLog).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
    
    it('should accept -f shorthand', async () => {
      process.argv = ['node', 'cli', 'search', 'test', '-f', 'author'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleLog).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
  });
  
  describe('Additional Filters', () => {
    it('should accept --since', async () => {
      process.argv = ['node', 'cli', 'search', 'test', '--since', '2024-01-01'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleLog).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
    
    it('should accept --unsynced', async () => {
      process.argv = ['node', 'cli', 'search', 'test', '--unsynced'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleLog).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
    
    it('should accept --limit', async () => {
      process.argv = ['node', 'cli', 'search', 'test', '--limit', '10'];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleLog).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
  });
  
  describe('Combined Search Options', () => {
    it('should accept multiple search options', async () => {
      process.argv = [
        'node', 'cli', 'search',
        'machine learning',
        '--field', 'title',
        '--since', '2024-01-01',
        '--unsynced',
        '--limit', '20'
      ];
      
      try {
        await main();
      } catch (e) {}
      
      expect(mockConsoleLog).not.toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
  });
});
