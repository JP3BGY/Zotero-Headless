// Tests for list command
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { performList } from '../commands/list.js';

describe('List Command', () => {
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

  it('should list items with default options', async () => {
    await performList({});
    
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining('显示')
    );
  });

  it('should respect limit option', async () => {
    await performList({ limit: '10' });
    
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining('10')
    );
  });

  it('should respect skip option', async () => {
    await performList({ skip: '5' });
    
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining('5')
    );
  });

  it('should filter by collection', async () => {
    await performList({ collection: 'My Papers' });
    
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining('My Papers')
    );
  });

  it('should filter by tag', async () => {
    await performList({ tag: 'important' });
    
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining('important')
    );
  });

  it('should output in json format', async () => {
    await performList({ format: 'json' });
    
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining('[')
    );
  });

  it('should output in csv format', async () => {
    await performList({ format: 'csv' });
    
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining('ID,Title')
    );
  });
});