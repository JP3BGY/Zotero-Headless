/**
 * 标识符获取器集成测试
 * 使用 Mock 测试各个获取器
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IdentifierParser, MetadataFetcher } from '../identifier/index';

// Mock fetch
global.fetch = vi.fn();

describe('MetadataFetcher 集成测试', () => {
  let fetcher: MetadataFetcher;

  beforeEach(() => {
    fetcher = new MetadataFetcher({
      maxConcurrent: 3,
      timeout: 5000,
      retries: 1,
      cacheTTL: 0,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('DOI 获取', () => {
    it('应该从 CrossRef API 获取 DOI 元数据', async () => {
      const mockCrossRefResponse = {
        message: {
          type: 'journal-article',
          title: ['Test Article'],
          DOI: '10.1007/s11263-019-01228-7',
          URL: 'https://doi.org/10.1007/s11263-019-01228-7',
          published: { 'date-parts': [[2020]] },
          author: [{ given: 'John', family: 'Doe' }],
        }
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockCrossRefResponse,
      } as Response);

      const identifiers = IdentifierParser.parse('10.1007/s11263-019-01228-7');
      const result = await fetcher.fetch(identifiers[0]);

      expect(result.identifier.type).toBe('doi');
      expect(result.item.title).toBe('Test Article');
      expect(result.source).toBe('crossref');
    });

    it('应该在 CrossRef 失败时回退到 DataCite', async () => {
      const mockDataCiteResponse = {
        data: {
          type: 'journal-article',
          title: ['DataCite Article'],
          DOI: '10.1007/test',
          author: [],
        }
      };

      // CrossRef 失败
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('CrossRef error'))
        // DataCite 成功
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockDataCiteResponse,
        } as Response);

      const identifiers = IdentifierParser.parse('10.1007/test');
      const result = await fetcher.fetch(identifiers[0]);

      expect(result.item.title).toBe('DataCite Article');
      expect(result.source).toBe('datacite');
    });
  });

  describe('ISBN 获取', () => {
    it('应该从 Open Library API 获取 ISBN 元数据', async () => {
      const mockOLResponse = {
        'ISBN:9783642155154': {
          title: 'Test Book',
          authors: [{ name: 'John Doe' }],
          publishers: [{ name: 'Test Publisher' }],
          publish_date: '2020',
        }
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockOLResponse,
      } as Response);

      const identifiers = IdentifierParser.parse('978-3-642-15515-4');
      const result = await fetcher.fetch(identifiers[0]);

      expect(result.identifier.type).toBe('isbn');
      expect(result.item.title).toBe('Test Book');
      expect(result.source).toBe('openlibrary');
    });
  });

  describe('批量获取', () => {
    it('应该批量获取多个标识符的元数据', async () => {
      const mockCrossRefResponse = {
        message: {
          type: 'journal-article',
          title: ['Article 1'],
          DOI: '10.1007/test1',
          author: [],
        }
      };

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValue({
          ok: true,
          json: async () => mockCrossRefResponse,
        } as Response);

      const identifiers = IdentifierParser.parse('10.1007/test1, 10.1007/test2');
      const results = await fetcher.fetchBatch(identifiers);

      expect(results).toHaveLength(2);
      expect(results.filter(r => !r.error)).toHaveLength(2);
    });

    it('应该正确处理部分失败', async () => {
      // 第一个成功，第二个失败
      const mockSuccessResponse = {
        message: { type: 'journal-article', title: ['Article 1'], DOI: '10.1007/test1', author: [] }
      };

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockSuccessResponse,
        } as Response)
        .mockRejectedValueOnce(new Error('Not found'));

      const identifiers = IdentifierParser.parse('10.1007/test1, 10.1007/invalid');
      const results = await fetcher.fetchBatch(identifiers);

      expect(results).toHaveLength(2);
      expect(results[0].error).toBeUndefined();
      expect(results[1].error).toBeDefined();
    });
  });

  describe('错误处理', () => {
    it('应该抛出未知标识符类型的错误', async () => {
      const identifiers = IdentifierParser.parse('invalid-format');
      await expect(fetcher.fetch(identifiers[0])).rejects.toThrow();
    });

    it('应该在所有源失败时抛出错误', async () => {
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockRejectedValue(new Error('Network error'));

      const identifiers = IdentifierParser.parse('10.1007/test');
      await expect(fetcher.fetch(identifiers[0])).rejects.toThrow();
    });
  });
});

describe('IdentifierParser + MetadataFetcher 完整流程', () => {
  let fetcher: MetadataFetcher;

  beforeEach(() => {
    fetcher = new MetadataFetcher({
      maxConcurrent: 3,
      timeout: 5000,
      retries: 1,
      cacheTTL: 0,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('应该完整处理 DOI 添加流程', async () => {
    const mockResponse = {
      message: {
        type: 'journal-article',
        title: ['Complete Test Article'],
        DOI: '10.1007/complete-test',
        URL: 'https://doi.org/10.1007/complete-test',
        published: { 'date-parts': [[2024]] },
        author: [
          { given: 'Alice', family: 'Wang' },
          { given: 'Bob', family: 'Li' }
        ],
        'container-title': ['Test Journal'],
        publisher: 'Test Publisher',
      }
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    // 完整流程：解析 -> 获取 -> 转换
    const identifiers = IdentifierParser.parse('10.1007/complete-test');
    expect(identifiers).toHaveLength(1);
    expect(identifiers[0].type).toBe('doi');

    const result = await fetcher.fetch(identifiers[0]);
    expect(result.item.title).toBe('Complete Test Article');
    expect(result.item.itemType).toBe('journalArticle');
    
    const creators = JSON.parse(result.item.creators);
    expect(creators).toHaveLength(2);
    expect(creators[0].firstName).toBe('Alice');
    expect(creators[0].lastName).toBe('Wang');
  });
});
