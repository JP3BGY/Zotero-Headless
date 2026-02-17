/**
 * 标识符解析器单元测试
 * 测试各种标识符类型的识别和解析
 */

import { describe, it, expect } from 'vitest';
import { IdentifierParser } from '../identifier/parser';

describe('IdentifierParser', () => {
  describe('DOI 识别', () => {
    it('应该识别标准 DOI 格式', () => {
      const identifiers = IdentifierParser.parse('10.1007/s11263-019-01228-7');
      expect(identifiers).toHaveLength(1);
      expect(identifiers[0].type).toBe('doi');
      expect(identifiers[0].normalized).toBe('10.1007/s11263-019-01228-7');
      expect(identifiers[0].confidence).toBeGreaterThan(0.8);
    });

    it('应该识别带 doi: 前缀的 DOI', () => {
      const identifiers = IdentifierParser.parse('doi:10.1007/s11263-019-01228-7');
      expect(identifiers).toHaveLength(1);
      expect(identifiers[0].type).toBe('doi');
      expect(identifiers[0].normalized).toBe('10.1007/s11263-019-01228-7');
    });

    it('应该识别 DOI 前缀不区分大小写', () => {
      const identifiers = IdentifierParser.parse('DOI:10.1007/s11263-019-01228-7');
      expect(identifiers).toHaveLength(1);
      expect(identifiers[0].type).toBe('doi');
    });

    it('应该识别不同 DOI 格式', () => {
      const dois = [
        '10.1000/xyz123',
        '10.1007/978-3-642-15515-4',
        '10.1038/nature12345',
        '10.1016/j.neuron.2020.01.001',
      ];

      dois.forEach(doi => {
        const identifiers = IdentifierParser.parse(doi);
        expect(identifiers).toHaveLength(1);
        expect(identifiers[0].type).toBe('doi');
      });
    });
  });

  describe('ISBN 识别', () => {
    it('应该识别 ISBN-13 格式', () => {
      const identifiers = IdentifierParser.parse('978-3-642-15515-4');
      expect(identifiers).toHaveLength(1);
      expect(identifiers[0].type).toBe('isbn');
      expect(identifiers[0].normalized).toBe('9783642155154');
    });

    it('应该识别 ISBN-10 格式', () => {
      const identifiers = IdentifierParser.parse('0-306-40615-2');
      expect(identifiers).toHaveLength(1);
      expect(identifiers[0].type).toBe('isbn');
    });

    it('应该识别带 ISBN 前缀的格式', () => {
      const identifiers = IdentifierParser.parse('ISBN 978-3-642-15515-4');
      expect(identifiers).toHaveLength(1);
      expect(identifiers[0].type).toBe('isbn');
      expect(identifiers[0].normalized).toBe('9783642155154');
    });

    it('应该识别无连字符的 ISBN', () => {
      const identifiers = IdentifierParser.parse('9783642155154');
      expect(identifiers).toHaveLength(1);
      expect(identifiers[0].type).toBe('isbn');
    });
  });

  describe('PMID 识别', () => {
    it('应该识别纯数字 PMID', () => {
      const identifiers = IdentifierParser.parse('12345678');
      expect(identifiers).toHaveLength(1);
      expect(identifiers[0].type).toBe('pmid');
    });

    it('应该识别长 PMID', () => {
      const identifiers = IdentifierParser.parse('36754827');
      expect(identifiers).toHaveLength(1);
      expect(identifiers[0].type).toBe('pmid');
    });

    it('不应该将短数字识别为 PMID', () => {
      // 短于 5 位的数字可能是其他类型
      const identifiers = IdentifierParser.parse('1234');
      expect(identifiers[0].type).not.toBe('pmid');
    });
  });

  describe('arXiv 识别', () => {
    it('应该识别新格式 arXiv ID', () => {
      const identifiers = IdentifierParser.parse('2101.12345');
      expect(identifiers).toHaveLength(1);
      expect(identifiers[0].type).toBe('arxiv');
    });

    it('应该识别带版本的 arXiv ID', () => {
      const identifiers = IdentifierParser.parse('2101.12345v2');
      expect(identifiers).toHaveLength(1);
      expect(identifiers[0].type).toBe('arxiv');
    });

    it('应该识别带 arXiv: 前缀的 ID', () => {
      const identifiers = IdentifierParser.parse('arXiv:2101.12345');
      expect(identifiers).toHaveLength(1);
      expect(identifiers[0].type).toBe('arxiv');
      expect(identifiers[0].normalized).toBe('2101.12345');
    });
  });

  describe('URL 识别', () => {
    it('应该识别有效的 URL', () => {
      const identifiers = IdentifierParser.parse('https://arxiv.org/abs/2101.12345');
      expect(identifiers).toHaveLength(1);
      expect(identifiers[0].type).toBe('url');
    });

    it('应该识别 HTTP URL', () => {
      const identifiers = IdentifierParser.parse('http://example.com/paper');
      expect(identifiers).toHaveLength(1);
      expect(identifiers[0].type).toBe('url');
    });
  });

  describe('批量处理', () => {
    it('应该处理逗号分隔的多个标识符', () => {
      const identifiers = IdentifierParser.parse('10.1007/s11263-019-01228-7, 978-3-642-15515-4');
      expect(identifiers).toHaveLength(2);
      expect(identifiers[0].type).toBe('doi');
      expect(identifiers[1].type).toBe('isbn');
    });

    it('应该处理换行分隔的多个标识符', () => {
      const input = `10.1007/s11263-019-01228-7
978-3-642-15515-4
12345678`;
      const identifiers = IdentifierParser.parse(input);
      expect(identifiers).toHaveLength(3);
    });

    it('应该处理制表符分隔的多个标识符', () => {
      const identifiers = IdentifierParser.parse('10.1007/s11263-019-01228-7\t978-3-642-15515-4');
      expect(identifiers).toHaveLength(2);
    });

    it('应该忽略空字符串', () => {
      const identifiers = IdentifierParser.parse('10.1007/s11263-019-01228-7,,  ,978-3-642-15515-4');
      expect(identifiers).toHaveLength(2);
    });
  });

  describe('错误处理', () => {
    it('应该在无法识别时抛出错误', () => {
      expect(() => {
        IdentifierParser.parse('invalid-identifier-format');
      }).toThrow();
    });

    it('应该处理空输入', () => {
      const identifiers = IdentifierParser.parse('');
      expect(identifiers).toHaveLength(0);
    });
  });
});
