// @ts-nocheck
import { Identifier, MetadataResult } from '../types';
import { BaseFetcher } from './base-fetcher';
import { DataConverter } from '../converter';

/**
 * arXiv 元数据获取器
 * 使用 arXiv API 获取预印本元数据
 */
export class ArXivFetcher extends BaseFetcher {
  private readonly ARXIV_API = 'https://export.arxiv.org/api/query';

  /**
   * 获取 arXiv 元数据
   */
  async fetchMetadata(identifier: Identifier): Promise<MetadataResult> {
    const arxivId = identifier.normalized;
    
    console.log(`   📡 正在查询 arXiv: ${arxivId}`);
    
    const data = await this.fetchFromArXiv(arxivId);

    // 转换为 Zotero 数据格式
    const item = DataConverter.fromArXiv(data, arxivId);
    
    return {
      identifier,
      data,
      item,
      source: 'arxiv',
      timestamp: Date.now(),
    };
  }

  /**
   * 从 arXiv API 获取数据
   */
  private async fetchFromArXiv(arxivId: string): Promise<any> {
    const url = `${this.ARXIV_API}?id_list=${arxivId}`;
    
    const response = await this.fetch(url);

    if (!response.ok) {
      throw new Error(`arXiv API 错误: ${response.status}`);
    }

    const text = await response.text();
    
    // 使用简单的字符串解析代替 DOMParser（兼容 Node.js）
    const entryMatch = text.match(/<entry>([\s\S]*?)<\/entry>/);
    if (!entryMatch) {
      throw new Error(`未找到 arXiv: ${arxivId}`);
    }
    
    const entry = entryMatch[1];
    
    // 提取数据的辅助函数
    const getText = (tag: string): string => {
      const match = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return match ? match[1].replace(/<[^>]+>/g, '').trim() : '';
    };
    
    const getId = (): string => {
      const match = entry.match(/<id>([^\s]+)<\/id>/);
      return match ? match[1] : '';
    };
    
    const getAuthors = (): Array<{ given: string; family: string }> => {
      const authorMatches = entry.matchAll(/<author>[\s\S]*?<name>([^\n]+)<\/name>[\s\S]*?<\/author>/g);
      const authors = [];
      for (const match of authorMatches) {
        const name = match[1].trim();
        const parts = name.split(' ');
        const lastName = parts.pop() || '';
        const given = parts.join(' ');
        authors.push({ given, family: lastName });
      }
      return authors;
    };
    
    const getCategories = (): string[] => {
      const matches = entry.matchAll(/<category[^>]+term="([^"]+)"[^>]*\/>/g);
      const categories = [];
      for (const match of matches) {
        categories.push(match[1]);
      }
      return categories;
    };
    
    return {
      id: getId(),
      title: getText('title'),
      summary: getText('summary'),
      published: getText('published'),
      updated: getText('updated'),
      authors: getAuthors(),
      categories: getCategories(),
    };
  }
}
