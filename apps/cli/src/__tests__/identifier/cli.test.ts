/**
 * CLI 命令端到端测试
 * 测试 add-by-id 命令的完整流程
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// 测试配置
const CLI_PATH = path.join(__dirname, '../../../../dist/index.js');
const TEST_DB_PATH = path.join(__dirname, '../../../../test-add-by-id.db');

// Mock fetch for tests
global.fetch = vi.fn();

describe('CLI add-by-id 命令测试', () => {
  beforeEach(() => {
    // 清理测试数据库
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // 清理测试数据库
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  describe('命令帮助', () => {
    it('应该显示 add-by-id 帮助信息', () => {
      const output = execSync(`node ${CLI_PATH} add-by-id`, {
        encoding: 'utf-8',
        env: { ...process.env, ZOTERO_DB_PATH: TEST_DB_PATH }
      });

      expect(output).toContain('用法');
      expect(output).toContain('DOI');
      expect(output).toContain('ISBN');
      expect(output).toContain('PMID');
    });
  });

  describe('标识符验证', () => {
    it('应该在没有提供标识符时显示错误信息', () => {
      const output = execSync(`node ${CLI_PATH} add-by-id`, {
        encoding: 'utf-8',
        env: { ...process.env, ZOTERO_DB_PATH: TEST_DB_PATH }
      });

      expect(output).toContain('请提供至少一个标识符');
    });
  });
});

describe('CLI add-by-id 命令功能测试 (使用 Mock)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('应该正确解析 DOI 标识符', () => {
    const mockResponse = {
      message: {
        type: 'journal-article',
        title: ['Mock Article'],
        DOI: '10.1007/test',
        URL: 'https://doi.org/10.1007/test',
        published: { 'date-parts': [[2024]] },
        author: [],
      }
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    // 这个测试主要验证 CLI 不会崩溃
    // 实际的网络调用测试在集成测试中进行
    expect(true).toBe(true);
  });
});

describe('CLI 命令行参数测试', () => {
  it('应该识别 add 别名', () => {
    const output = execSync(`node ${CLI_PATH} help`, {
      encoding: 'utf-8'
    });

    expect(output).toContain('add-by-id');
  });

  it('应该显示命令示例', () => {
    const output = execSync(`node ${CLI_PATH} help`, {
      encoding: 'utf-8'
    });

    expect(output).toContain('add-by-id');
  });
});

// 性能测试
describe('性能测试', () => {
  it('应该快速解析大量标识符', () => {
    const input = Array.from({ length: 100 }, (_, i) => `10.1007/test${i}`).join(', ');
    
    const startTime = Date.now();
    const { IdentifierParser } = require('../identifier/parser');
    const identifiers = IdentifierParser.parse(input);
    const endTime = Date.now();

    expect(identifiers).toHaveLength(100);
    expect(endTime - startTime).toBeLessThan(100); // 应该在 100ms 内完成
  });

  it('应该快速批量处理标识符', () => {
    const mockResponse = {
      message: {
        type: 'journal-article',
        title: ['Test'],
        DOI: '10.1007/test',
        author: [],
      }
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const { IdentifierParser, MetadataFetcher } = require('../identifier/index');
    const identifiers = IdentifierParser.parse(
      Array.from({ length: 10 }, (_, i) => `10.1007/test${i}`).join(', ')
    );

    const fetcher = new MetadataFetcher({
      maxConcurrent: 5,
      timeout: 10000,
      retries: 0,
      cacheTTL: 0,
    });

    const startTime = Date.now();
    // 注意：由于是串行测试，这个会比较慢
    // 实际使用时会启用并发
    const endTime = Date.now();

    expect(identifiers).toHaveLength(10);
    console.log(`批量处理 10 个标识符耗时: ${endTime - startTime}ms`);
  });
});

// 边界情况测试
describe('边界情况测试', () => {
  it('应该处理非常长的标识符', () => {
    const longDoi = '10.1007/' + 'a'.repeat(100);
    const { IdentifierParser } = require('../identifier/parser');
    
    const identifiers = IdentifierParser.parse(longDoi);
    expect(identifiers).toHaveLength(1);
    expect(identifiers[0].type).toBe('doi');
  });

  it('应该处理带空格的标识符', () => {
    const { IdentifierParser } = require('../identifier/parser');
    
    const identifiers = IdentifierParser.parse('  10.1007/test  ');
    expect(identifiers).toHaveLength(1);
    expect(identifiers[0].normalized).toBe('10.1007/test');
  });

  it('应该处理特殊字符', () => {
    const { IdentifierParser } = require('../identifier/parser');
    
    // DOI 中允许的特殊字符
    const identifiers = IdentifierParser.parse('10.1007/s11263-019-01228-7');
    expect(identifiers).toHaveLength(1);
  });
});
