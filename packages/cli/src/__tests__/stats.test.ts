// Tests for stats command
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { performStats } from '../commands/stats.js';

describe('Stats Command', () => {
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

  it('should display library statistics', async () => {
    await performStats({});
    
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining('统计')
    );
  });

  it('should show detailed stats', async () => {
    await performStats({ detailed: true });
    
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining('详细')
    );
  });
});