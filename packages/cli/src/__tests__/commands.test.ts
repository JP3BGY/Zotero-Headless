// CLI Command Tests
// Test-driven development for command-line interface

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main } from '../index.js';
import { Command } from 'commander';

// Mock console for output testing
const mockConsoleLog = vi.fn();
const mockConsoleError = vi.fn();
const mockConsoleWarn = vi.fn();

// Mock process.exit
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error('process.exit called');
});

// Store original argv
const originalArgv = process.argv;

describe('CLI Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(mockConsoleLog);
    vi.spyOn(console, 'error').mockImplementation(mockConsoleError);
    vi.spyOn(console, 'warn').mockImplementation(mockConsoleWarn);
    
    // Reset argv for each test
    process.argv = originalArgv.slice();
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  describe('zotero sync', () => {
    it('should show help with --help flag', async () => {
      // Test setup
      process.argv = ['node', 'cli', 'sync', '--help'];
      
      try {
        await main();
      } catch (error) {
        // Expected - help usually calls process.exit
      }
      
      // Verify help output contains expected information
      const logs = mockConsoleLog.mock.calls.flat();
      const errorLogs = mockConsoleError.mock.calls.flat();
      const output = [...logs, ...errorLogs].join('\n');
      
      expect(output).toContain('Usage:');
      expect(output).toContain('sync');
      expect(output).toContain('Options:');
      expect(output).toContain('--full');
      expect(output).toContain('--dry-run');
    });
    
    it('should accept --dry-run flag', async () => {
      process.argv = ['node', 'cli', 'sync', '--dry-run'];
      
      await main();
      
      // Check that dry-run mode is acknowledged
      const output = mockConsoleLog.mock.calls.flat().join('\n');
      expect(output).toContain('干运行模式');
      expect(output).toContain('模拟');
    });
    
    it('should accept --full flag', async () => {
      process.argv = ['node', 'cli', 'sync', '--full'];
      
      await main();
      
      const output = mockConsoleLog.mock.calls.flat().join('\n');
      expect(output).toContain('完整同步模式');
    });
    
    it('should accept --since <version> for incremental sync', async () => {
      const testVersion = '12345';
      process.argv = ['node', 'cli', 'sync', '--since', testVersion];
      
      await main();
      
      const output = mockConsoleLog.mock.calls.flat().join('\n');
      expect(output).toContain(`增量同步从版本：${testVersion}`);
    });
    
    it('should accept --max-items <number> limit', async () => {
      process.argv = ['node', 'cli', 'sync', '--max-items', '100'];
      
      await main();
      
      const output = mockConsoleLog.mock.calls.flat().join('\n');
      expect(output).toContain('限制同步 100 个项目');
    });
    
    it('should show progress indicator during sync', async () => {
      process.argv = ['node', 'cli', 'sync'];
      
      await main();
      
      const output = mockConsoleLog.mock.calls.flat().join('\n');
      // Progress indication should be present
      expect(output).toContain('同步完成');
      expect(output).toContain('统计：');
    });
  });
  
  describe('zotero list', () => {
    it('should show help with --help flag', async () => {
      process.argv = ['node', 'cli', 'list', '--help'];
      
      try {
        await main();
      } catch (error) {
        // Expected
      }
      
      const logs = mockConsoleLog.mock.calls.flat();
      const errorLogs = mockConsoleError.mock.calls.flat();
      const output = [...logs, ...errorLogs].join('\n');
      
      expect(output).toContain('Usage:');
      expect(output).toContain('list');
      expect(output).toContain('Options:');
      expect(output).toContain('--limit');
      expect(output).toContain('--format');
    });
    
    it('should accept --limit option', async () => {
      process.argv = ['node', 'cli', 'list', '--limit', '5'];
      
      await main();
      
      const output = mockConsoleLog.mock.calls.flat().join('\n');
      expect(output).toContain('显示 5 个项目');
    });
    
    it('should accept --format json', async () => {
      process.argv = ['node', 'cli', 'list', '--format', 'json', '--limit', '2'];
      
      await main();
      
      const output = mockConsoleLog.mock.calls.flat().join('\n');
      // Should output JSON
      expect(output).toContain('[');
      expect(output).toContain(']');
    });
    
    it('should accept --format table (default)', async () => {
      process.argv = ['node', 'cli', 'list', '--limit', '2'];
      
      await main();
      
      const output = mockConsoleLog.mock.calls.flat().join('\n');
      expect(output).toContain('┌──');
      expect(output).toContain('│');
    });
    
    it('should accept --collection filter', async () => {
      const collectionName = '人工智能';
      process.argv = ['node', 'cli', 'list', '--collection', collectionName];
      
      await main();
      
      const output = mockConsoleLog.mock.calls.flat().join('\n');
      expect(output).toContain(`收藏夹：${collectionName}`);
    });
    
    it('should accept --tag filter', async () => {
      const tagName = '机器学习';
      process.argv = ['node', 'cli', 'list', '--tag', tagName];
      
      await main();
      
      const output = mockConsoleLog.mock.calls.flat().join('\n');
      expect(output).toContain(`标签：${tagName}`);
    });
  });
  
  describe('zotero search', () => {
    it('should show help with --help flag', async () => {
      process.argv = ['node', 'cli', 'search', '--help'];
      
      try {
        await main();
      } catch (error) {
        // Expected
      }
      
      const logs = mockConsoleLog.mock.calls.flat();
      const errorLogs = mockConsoleError.mock.calls.flat();
      const output = [...logs, ...errorLogs].join('\n');
      
      expect(output).toContain('Usage:');
      expect(output).toContain('search');
      expect(output).toContain('Options:');
      expect(output).toContain('--field');
      expect(output).toContain('--fuzzy');
    });
    
    it('should search with basic query', async () => {
      const query = '机器学习';
      process.argv = ['node', 'cli', 'search', query];
      
      await main();
      
      const output = mockConsoleLog.mock.calls.flat().join('\n');
      expect(output).toContain(`搜索："${query}"`);
      expect(output).toContain('相关结果');
    });
    
    it('should accept --field option', async () => {
      process.argv = ['node', 'cli', 'search', '人工智能', '--field', 'title'];
      
      await main();
      
      const output = mockConsoleLog.mock.calls.flat().join('\n');
      expect(output).toContain('字段：title');
    });
    
    it('should accept --fuzzy option', async () => {
      process.argv = ['node', 'cli', 'search', 'AI', '--fuzzy'];
      
      await main();
      
      const output = mockConsoleLog.mock.calls.flat().join('\n');
      expect(output).toContain('模糊匹配');
    });
    
    it('should accept --limit option', async () => {
      process.argv = ['node', 'cli', 'search', '量子计算', '--limit', '3'];
      
      await main();
      
      const output = mockConsoleLog.mock.calls.flat().join('\n');
      expect(output).toContain('最大结果：3');
    });
    
    it('should show search tips', async () => {
      process.argv = ['node', 'cli', 'search', '深度学习'];
      
      await main();
      
      const output = mockConsoleLog.mock.calls.flat().join('\n');
      expect(output).toContain('zotero get <ID>');
    });
  });
  
  describe('zotero stats', () => {
    it('should show help with --help flag', async () => {
      process.argv = ['node', 'cli', 'stats', '--help'];
      
      try {
        await main();
      } catch (error) {
        // Expected
      }
      
      const logs = mockConsoleLog.mock.calls.flat();
      const errorLogs = mockConsoleError.mock.calls.flat();
      const output = [...logs, ...errorLogs].join('\n');
      
      expect(output).toContain('Usage:');
      expect(output).toContain('stats');
      expect(output).toContain('Options:');
      expect(output).toContain('--detailed');
      expect(output).toContain('--format');
    });
    
    it('should show basic statistics', async () => {
      process.argv = ['node', 'cli', 'stats'];
      
      await main();
      
      const output = mockConsoleLog.mock.calls.flat().join('\n');
      expect(output).toContain('Zotero 文献库统计');
      expect(output).toContain('文献总数');
      expect(output).toContain('收藏夹数');
    });
    
    it('should accept --detailed option', async () => {
      process.argv = ['node', 'cli', 'stats', '--detailed'];
      
      await main();
      
      const output = mockConsoleLog.mock.calls.flat().join('\n');
      expect(output).toContain('按类型分布');
      expect(output).toContain('按年份分布');
    });
    
    it('should accept --format json', async () => {
      process.argv = ['node', 'cli', 'stats', '--format', 'json'];
      
      await main();
      
      const output = mockConsoleLog.mock.calls.flat().join('\n');
      expect(output).toContain('{');
      expect(output).toContain('}');
      expect(output).toContain('totalItems');
    });
    
    it('should show usage tips', async () => {
      process.argv = ['node', 'cli', 'stats'];
      
      await main();
      
      const output = mockConsoleLog.mock.calls.flat().join('\n');
      expect(output).toContain('使用 --detailed');
    });
  });
  
  describe('zotero get', () => {
    it('should show help with --help flag', async () => {
      process.argv = ['node', 'cli', 'get', '--help'];
      
      try {
        await main();
      } catch (error) {
        // Expected
      }
      
      const logs = mockConsoleLog.mock.calls.flat();
      const errorLogs = mockConsoleError.mock.calls.flat();
      const output = [...logs, ...errorLogs].join('\n');
      
      expect(output).toContain('Usage:');
      expect(output).toContain('get');
      expect(output).toContain('Options:');
      expect(output).toContain('--format');
      expect(output).toContain('--include-notes');
    });
    
    it('should get item by ID', async () => {
      const itemId = 'ABC123';
      process.argv = ['node', 'cli', 'get', itemId];
      
      await main();
      
      const output = mockConsoleLog.mock.calls.flat().join('\n');
      expect(output).toContain(`获取文献详情：${itemId}`);
      expect(output).toContain('标题');
      expect(output).toContain('作者');
    });
    
    it('should accept --format bibtex', async () => {
      process.argv = ['node', 'cli', 'get', 'DEF456', '--format', 'bibtex'];
      
      await main();
      
      const output = mockConsoleLog.mock.calls.flat().join('\n');
      expect(output).toContain('@article');
      expect(output).toContain('author');
      expect(output).toContain('title');
    });
    
    it('should accept --format json', async () => {
      process.argv = ['node', 'cli', 'get', 'GHI789', '--format', 'json'];
      
      await main();
      
      const output = mockConsoleLog.mock.calls.flat().join('\n');
      expect(output).toContain('"id":');
      expect(output).toContain('"title":');
    });
    
    it('should include notes with --include-notes', async () => {
      process.argv = ['node', 'cli', 'get', 'JKL012', '--include-notes'];
      
      await main();
      
      const output = mockConsoleLog.mock.calls.flat().join('\n');
      expect(output).toContain('笔记');
    });
    
    it('should include attachments with --include-attachments', async () => {
      process.argv = ['node', 'cli', 'get', 'MNO345', '--include-attachments'];
      
      await main();
      
      const output = mockConsoleLog.mock.calls.flat().join('\n');
      expect(output).toContain('附件');
    });
  });
  
  describe('zotero help', () => {
    it('should show help with help command', async () => {
      process.argv = ['node', 'cli', 'help'];
      
      try {
        await main();
      } catch (error) {
        // Expected
      }
      
      const logs = mockConsoleLog.mock.calls.flat();
      const errorLogs = mockConsoleError.mock.calls.flat();
      const output = [...logs, ...errorLogs].join('\n');
      
      expect(output).toContain('Usage:');
      expect(output).toContain('zotero');
      expect(output).toContain('Commands:');
      expect(output).toContain('sync');
      expect(output).toContain('list');
    });
  });
  
  describe('error handling', () => {
    it('should show error for unknown command', async () => {
      process.argv = ['node', 'cli', 'unknown-command'];
      
      try {
        await main();
      } catch (error) {
        // Expected
      }
      
      const errorOutput = mockConsoleError.mock.calls.flat().join('\n');
      expect(errorOutput).toContain('未知命令');
      expect(errorOutput).toContain('可用命令');
    });
    
    it('should handle config file not found gracefully', async () => {
      process.argv = ['node', 'cli', 'sync', '--config', 'nonexistent.env'];
      
      await main();
      
      const warnOutput = mockConsoleWarn.mock.calls.flat().join('\n');
      expect(warnOutput).toContain('Config file not found');
    });
  });
});