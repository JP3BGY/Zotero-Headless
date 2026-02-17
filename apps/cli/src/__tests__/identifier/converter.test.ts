/**
 * 数据转换器单元测试
 * 测试各种 API 数据转换为 Zotero 格式
 */

import { describe, it, expect } from 'vitest';
import { DataConverter } from '../identifier/converter';

describe('DataConverter', () => {
  describe('fromCrossRef', () => {
    it('应该正确转换 CrossRef 期刊文章数据', () => {
      const crossrefData = {
        type: 'journal-article',
        title: ['Test Journal Article'],
        DOI: '10.1007/s11263-019-01228-7',
        URL: 'https://doi.org/10.1007/s11263-019-01228-7',
        published: { 'date-parts': [[2020, 1, 15]] },
        abstract: '<p>Test abstract</p>',
        volume: '123',
        issue: '4',
        page: '456-789',
        'container-title': ['International Journal of Computer Vision'],
        publisher: 'Springer',
        author: [
          { given: 'John', family: 'Doe' },
          { given: 'Jane', family: 'Smith' }
        ],
        ISBN: ['978-3-642-15515-4'],
        ISSN: ['1234-5678']
      };

      const result = DataConverter.fromCrossRef(crossrefData, '10.1007/s11263-019-01228-7');

      expect(result.itemType).toBe('journalArticle');
      expect(result.title).toBe('Test Journal Article');
      expect(result.DOI).toBe('10.1007/s11263-019-01228-7');
      expect(result.journal).toBe('International Journal of Computer Vision');
      expect(result.publisher).toBe('Springer');
      expect(result.volume).toBe('123');
      expect(result.issue).toBe('4');
      expect(result.pages).toBe('456-789');
    });

    it('应该正确映射论文类型', () => {
      const testCases = [
        { type: 'journal-article', expected: 'journalArticle' },
        { type: 'proceedings-article', expected: 'conferencePaper' },
        { type: 'book-chapter', expected: 'bookSection' },
        { type: 'book', expected: 'book' },
        { type: 'report', expected: 'report' },
        { type: 'dataset', expected: 'dataset' },
        { type: 'unknown-type', expected: 'journalArticle' },
      ];

      testCases.forEach(({ type, expected }) => {
        const result = DataConverter.fromCrossRef({ type, title: ['Test'] }, '10.1000/test');
        expect(result.itemType).toBe(expected);
      });
    });

    it('应该正确处理缺失字段', () => {
      const result = DataConverter.fromCrossRef({}, '10.1000/test');

      expect(result.title).toBe('');
      expect(result.itemType).toBe('journalArticle');
      expect(result.DOI).toBe('10.1000/test');
      expect(result.abstract).toBe('');
    });

    it('应该清理 HTML 标签', () => {
      const result = DataConverter.fromCrossRef({
        abstract: '<p>Test <b>bold</b> and <i>italic</i></p>',
        title: ['Test']
      }, '10.1000/test');

      expect(result.abstract).toBe('Test bold and italic');
    });
  });

  describe('fromOpenLibrary', () => {
    it('应该正确转换 Open Library 图书数据', () => {
      const olData = {
        title: 'Test Book',
        authors: [{ name: 'John Doe' }],
        publishers: [{ name: 'Test Publisher' }],
        publish_date: '2020',
        number_of_pages: 300,
        url: ['https://openlibrary.org/book/OL123'],
        isbn_13: ['978-3-642-15515-4'],
      };

      const result = DataConverter.fromOpenLibrary(olData, '9783642155154');

      expect(result.itemType).toBe('book');
      expect(result.title).toBe('Test Book');
      expect(result.ISBN).toBe('978-3-642-15515-4');
      expect(result.publisher).toBe('Test Publisher');
      expect(result.numberOfPages).toBe(300);
    });

    it('应该处理作者字符串格式', () => {
      const result = DataConverter.fromOpenLibrary({
        title: 'Test Book',
        authors: ['Doe, John', 'Smith, Jane'],
      }, '9783642155154');

      const creators = JSON.parse(result.creators);
      expect(creators).toHaveLength(2);
      expect(creators[0].lastName).toBe('Doe');
      expect(creators[0].firstName).toBe('John');
    });
  });

  describe('fromPubMed', () => {
    it('应该正确转换 PubMed 数据', () => {
      const pubmedData = {
        title: 'Test PubMed Article',
        pubdate: '2020/01/15',
        source: 'Nature',
        authors: {
          author: [
            { forename: 'John', lastname: 'Doe' }
          ]
        },
        elocationid: 'doi: 10.1038/test',
      };

      const result = DataConverter.fromPubMed(pubmedData, '12345678');

      expect(result.itemType).toBe('journalArticle');
      expect(result.title).toBe('Test PubMed Article');
      expect(result.journal).toBe('Nature');
      expect(result.publicationDate).toBe('2020');
    });
  });

  describe('fromArXiv', () => {
    it('应该正确转换 arXiv 数据', () => {
      const arxivData = {
        id: 'http://arxiv.org/abs/2101.12345',
        title: 'Test arXiv Paper',
        summary: 'Test abstract',
        published: '2021-01-15T00:00:00Z',
        authors: [
          { given: 'John', family: 'Doe' }
        ],
        categories: ['cs.AI', 'cs.LG'],
      };

      const result = DataConverter.fromArXiv(arxivData, '2101.12345');

      expect(result.itemType).toBe('preprint');
      expect(result.title).toBe('Test arXiv Paper');
      expect(result.journal).toBe('arXiv');
      expect(result.publisher).toBe('arXiv');
    });
  });
});
