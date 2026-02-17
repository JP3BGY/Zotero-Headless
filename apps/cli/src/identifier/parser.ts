// @ts-nocheck
import { Identifier, IdentifierType } from './types';

/**
 * 标识符解析器
 * 负责识别和解析各种类型的标识符，包括从 URL 中提取标识符
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

  // URL 中提取标识符的模式
  private static readonly URL_PATTERNS: Array<{ type: IdentifierType; regex: RegExp; extract: RegExp }> = [
    // DOI URL: https://doi.org/10.48550/arXiv.2307.02486 或 https://dx.doi.org/10.1007/xxx
    {
      type: 'doi',
      regex: /^https?:\/\/(?:dx\.)?doi\.org\//i,
      extract: /\/([^\/\s]+)$/,
    },
    // arXiv URL: https://arxiv.org/abs/2307.02486 或 https://arxiv.org/pdf/2307.02486
    {
      type: 'arxiv',
      regex: /^https?:\/\/arxiv\.org\/(?:abs|pdf|html)\//i,
      extract: /\/(?:abs|pdf|html)?\/([^\/\s]+)/i,
    },
    // arXiv DOI: https://doi.org/10.48550/arXiv.2307.02486
    {
      type: 'arxiv',
      regex: /^https?:\/\/doi\.org\/10\.\d{4,9}\/arXiv\./i,
      extract: /\/([^\/\s]+)$/i,
    },
    // PubMed URL: https://pubmed.ncbi.nlm.nih.gov/12345678/
    {
      type: 'pmid',
      regex: /^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+/i,
      extract: /\/(\d+)\/?$/,
    },
    // ISBN 查询 URL: https://openlibrary.org/isbn/9780123456789
    {
      type: 'isbn',
      regex: /^https?:\/\/openlibrary\.org\/isbn\/\d+/i,
      extract: /\/(\d+)$/i,
    },
    // WorldCat URL: https://www.worldcat.org/isbn/xxx
    {
      type: 'isbn',
      regex: /^https?:\/\/www\.worldcat\.org\/isbn\//i,
      extract: /\/([^\/\s]+)/i,
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
    // 首先尝试直接匹配标识符模式
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
    
    // 尝试从 URL 中提取标识符
    try {
      const url = new URL(token);
      
      // 尝试匹配 URL 模式
      for (const { type, regex, extract } of this.URL_PATTERNS) {
        if (regex.test(token)) {
          // 特殊处理 DOI URL：需要提取完整 DOI（从 doi.org/ 后面开始）
          if (type === 'doi') {
            // https://doi.org/10.48550/arXiv.2307.02486 -> 10.48550/arXiv.2307.02486
            // 支持 / 后包含更多路径的情况
            const doiMatch = token.match(/doi\.org\/([^\s]+)/i);
            if (doiMatch && doiMatch[1]) {
              return {
                type: 'doi',
                value: token,
                normalized: doiMatch[1],
                confidence: 0.85,
              };
            }
          }
          
          // 特殊处理 arXiv URL：https://arxiv.org/abs/2307.02486 -> 2307.02486
          if (type === 'arxiv') {
            const arxivMatch = token.match(/arxiv\.org\/(?:abs|pdf|html)\/([^\s]+)/i);
            if (arxivMatch && arxivMatch[1]) {
              return {
                type: 'arxiv',
                value: token,
                normalized: arxivMatch[1],
                confidence: 0.85,
              };
            }
          }
          
          // 其他 URL 模式的提取
          const match = token.match(extract);
          if (match && match[1]) {
            let extractedValue = match[1];
            
            // arXiv DOI 需要特殊处理
            if (type === 'arxiv' && extractedValue.startsWith('arXiv.')) {
              extractedValue = extractedValue.replace(/^arXiv\./i, '');
            }
            
            return {
              type,
              value: token,  // 保留原始 URL
              normalized: extractedValue,  // 提取的标识符
              confidence: 0.85,  // 较高置信度（从 URL 提取）
            };
          }
        }
      }
      
      // 如果是有效的 URL 但无法提取标识符，返回 URL 类型
      return {
        type: 'url',
        value: token,
        normalized: token,
        confidence: 0.5,  // 中等置信度
      };
    } catch {
      // 不是有效的 URL
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

  /**
   * 检测输入是否为 URL
   */
  static isURL(input: string): boolean {
    try {
      new URL(input);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 从 URL 中提取标识符（不抛出异常版本）
   */
  static extractFromURL(url: string): Identifier | null {
    try {
      return this.identifyToken(url);
    } catch {
      return null;
    }
  }
}
