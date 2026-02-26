// Tests for sync command
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { performSync } from '../commands/sync.js';

describe('Sync Command', () => {
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

  it('should perform sync operation', async () => {
    await performSync({});
    
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining('同步')
    );
  });

  it('should handle full sync option', async () => {
    await performSync({ full: true });
    
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining('完整')
    );
  });

  it('should show dry-run mode', async () => {
    await performSync({ dryRun: true });
    
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining('模拟')
    );
  });
});