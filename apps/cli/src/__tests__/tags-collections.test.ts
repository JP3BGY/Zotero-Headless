// CLI Tags and Collections Management Tests

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('CLI Tags Command', () => {
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

  it('should accept --list option', async () => {
    const { main } = await import('../index.js');
    process.argv = ['node', 'cli', 'tags', '--list'];

    try {
      await main();
    } catch (e) {
      // Expected if no library configured
    }

    // Should not error on argument parsing
    expect(mockConsoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Unknown')
    );
  });

  it('should accept tags alias', async () => {
    const { main } = await import('../index.js');
    process.argv = ['node', 'cli', 'tag', '--list'];

    try {
      await main();
    } catch (e) {}

    expect(mockConsoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Unknown')
    );
  });

  it('should accept -l shorthand', async () => {
    const { main } = await import('../index.js');
    process.argv = ['node', 'cli', 'tags', '-l'];

    try {
      await main();
    } catch (e) {}

    expect(mockConsoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Unknown')
    );
  });

  it('should accept --add option format', async () => {
    const { main } = await import('../index.js');
    process.argv = ['node', 'cli', 'tags', '--add', 'ABCD1234', 'test-tag'];

    try {
      await main();
    } catch (e) {}

    // Should not error on argument parsing
    expect(mockConsoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Unknown')
    );
  });

  it('should accept --remove option format', async () => {
    const { main } = await import('../index.js');
    process.argv = ['node', 'cli', 'tags', '--remove', 'ABCD1234', 'old-tag'];

    try {
      await main();
    } catch (e) {}

    expect(mockConsoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Unknown')
    );
  });

  it('should accept --item option format', async () => {
    const { main } = await import('../index.js');
    process.argv = ['node', 'cli', 'tags', '--item', 'ABCD1234'];

    try {
      await main();
    } catch (e) {}

    expect(mockConsoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Unknown')
    );
  });

  it('should accept --delete option format', async () => {
    const { main } = await import('../index.js');
    process.argv = ['node', 'cli', 'tags', '--delete', 'unused-tag'];

    try {
      await main();
    } catch (e) {}

    expect(mockConsoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Unknown')
    );
  });
});

describe('CLI Collections Command', () => {
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

  it('should accept --list option', async () => {
    const { main } = await import('../index.js');
    process.argv = ['node', 'cli', 'collections', '--list'];

    try {
      await main();
    } catch (e) {}

    expect(mockConsoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Unknown')
    );
  });

  it('should accept collections alias', async () => {
    const { main } = await import('../index.js');
    process.argv = ['node', 'cli', 'col', '--list'];

    try {
      await main();
    } catch (e) {}

    expect(mockConsoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Unknown')
    );
  });

  it('should accept -l shorthand', async () => {
    const { main } = await import('../index.js');
    process.argv = ['node', 'cli', 'collections', '-l'];

    try {
      await main();
    } catch (e) {}

    expect(mockConsoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Unknown')
    );
  });

  it('should accept --create option', async () => {
    const { main } = await import('../index.js');
    process.argv = ['node', 'cli', 'collections', '--create', 'My Collection'];

    try {
      await main();
    } catch (e) {}

    expect(mockConsoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Unknown')
    );
  });

  it('should accept --create with --parent option', async () => {
    const { main } = await import('../index.js');
    process.argv = ['node', 'cli', 'collections', '--create', 'Subfolder', '--parent=ABCD1234'];

    try {
      await main();
    } catch (e) {}

    expect(mockConsoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Unknown')
    );
  });

  it('should accept --add-item option format', async () => {
    const { main } = await import('../index.js');
    process.argv = ['node', 'cli', 'collections', '--add-item', 'ABCD1234', 'WXYZ5678'];

    try {
      await main();
    } catch (e) {}

    expect(mockConsoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Unknown')
    );
  });

  it('should accept --remove-item option format', async () => {
    const { main } = await import('../index.js');
    process.argv = ['node', 'cli', 'collections', '--remove-item', 'ABCD1234', 'WXYZ5678'];

    try {
      await main();
    } catch (e) {}

    expect(mockConsoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Unknown')
    );
  });

  it('should accept --delete option format', async () => {
    const { main } = await import('../index.js');
    process.argv = ['node', 'cli', 'collections', '--delete', 'ABCD1234'];

    try {
      await main();
    } catch (e) {}

    expect(mockConsoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Unknown')
    );
  });

  it('should accept folder alias', async () => {
    const { main } = await import('../index.js');
    process.argv = ['node', 'cli', 'folder', '--list'];

    try {
      await main();
    } catch (e) {}

    expect(mockConsoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Unknown')
    );
  });
});