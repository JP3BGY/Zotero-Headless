// @ts-nocheck
import { Identifier, IdentifierType } from './types';

/**
 * 标识符解析器
 * 负责识别和解析各种类型的标识符
 */
export class IdentifierParser {
  // 正则表达式模式（优先级顺序）
  private static readonly PATTERNS: Array<{ type: IdentifierType; regex: RegExp }> = [
    // DOI: 10.xxxx/xxxxx 格式
    { 
      type: 'doi', 
      regex: /^(doi:)?10\.\d{4,9}\/[^\s]+$/i 
    },
    // ISBN: 10位或13位数字，可能包含连字符
    { 
      type: 'isbn', 
      regex: /^(?:ISBN(?:-1[03])?:?\s?)?(?=[0-9X]{10}$|(?=(?:[0-9]+[- ]){3})[- 0-9X]{13}$|97[89][0-9]{10}$|(?=(?:[0-9]+[- ]){4})[- 0-9]{17}$)(?:97[89][- ]?)?[0-9]{1,5}[- ]?[0-9]+[- ]?[0-9]+[- ]?[0-9X]$/i
    },
    // arXiv: 新格式 YYYY.NNNNN 或旧格式
    { 
      type: 'arxiv', 
      regex: /^\d{4}\.\d{4,5}(?:v\d+)?$|^arXiv:\d{4}\.\d{4,5}(?:v\d+)?$/i 
    },
    // ADS Bibcode: YYYYJJJJJ..XXX 格式
    { 
      type: 'ads', 
      regex: /^\d{4}[A-Za-z0-9&.]{5}\.[A-Za-z.]{4,}$/ 
    },
    // PMID: 纯数字（放在最后，因为其他类型也可能匹配数字）
    { 
      type: 'pmid', 
      regex: /^\d{5,}$/ 
    },
  ];

  /**
   * 解析输入字符串，返回识别到的标识符列表
   */
  static parse(input: string): Identifier[] {
    // 1. 清理和分割输入
    const tokens = this.splitInput(input);
    
    // 2. 识别每个标识符
    const results: Identifier[] = [];
    const errors: string[] = [];
    
    for (const token of tokens) {
      try {
        const identifier = this.identifyToken(token);
        results.push(identifier);
      } catch (error) {
        errors.push((error as Error).message);
      }
    }
    
    if (results.length === 0 && errors.length > 0) {
      throw new Error(errors.join('\n'));
    }
    
    return results;
  }

  /**
   * 分割输入字符串（支持多种分隔符）
   */
  private static splitInput(input: string): string[] {
    return input
      .split(/[,\n\r\t]+/)           // 按逗号、换行等分割
      .map(token => token.trim())     // 清理空格
      .filter(token => token.length > 0);  // 过滤空字符串
  }

  /**
   * 识别单个标识符
   */
  private static identifyToken(token: string): Identifier {
    // 按优先级尝试匹配
    for (const { type, regex } of this.PATTERNS) {
      if (regex.test(token)) {
        return {
          type,
          value: token,
          normalized: this.normalize(token, type),
          confidence: 0.9,  // 高置信度（精确匹配）
        };
      }
    }
    
    // 未识别：可能是 URL
    try {
      new URL(token);  // 验证是否为有效 URL
      return {
        type: 'url',
        value: token,
        normalized: token,
        confidence: 0.5,  // 中等置信度
      };
    } catch {
      throw new Error(`无法识别的标识符格式: ${token}`);
    }
  }

  /**
   * 标准化标识符
   */
  private static normalize(token: string, type: IdentifierType): string {
    switch (type) {
      case 'doi':
        return token.replace(/^doi:/i, '').trim();
      case 'isbn':
        return token.replace(/[-\s]/g, '').replace(/^ISBN(?:-1[03])?:?\s?/i, '');
      case 'arxiv':
        return token.replace(/^arXiv:/i, '').trim();
      default:
        return token.trim();
    }
  }
}
