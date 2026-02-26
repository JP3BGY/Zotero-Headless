// Tests for search command
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { performSearch } from '../commands/search.js';

describe('Search Command', () => {
  let consoleLog: any;
  let consoleError: any;

  beforeEach(() => {
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLog.mockRestore();
    consoleError.mockRestore();
  });

  it('should search with query', async () => {
    await performSearch('machine learning', { limit: '10' });
    
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining('machine learning')
    );
  });

  it('should limit results', async () => {
    await performSearch('test', { limit: '5' });
    
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining('5')
    );
  });

  it('should filter by type', async () => {
    await performSearch('test', { limit: '10', field: 'title' });
    
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining('title')
    );
  });
});