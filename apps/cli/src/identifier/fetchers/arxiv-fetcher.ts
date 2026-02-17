// @ts-nocheck
import { Identifier, MetadataResult } from '../../types';
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
    
    // 解析 XML 响应
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, 'text/xml');
    
    const entry = xml.querySelector('entry');
    if (!entry) {
      throw new Error(`未找到 arXiv: ${arxivId}`);
    }
    
    // 提取数据
    const getText = (tag: string): string => {
      const el = entry.querySelector(tag);
      return el?.textContent || '';
    };
    
    const getAuthors = (): Array<{ given: string; family: string }> => {
      const authors = entry.querySelectorAll('author');
      return Array.from(authors).map(a => ({
        given: a.querySelector('name')?.textContent?.split(' ').slice(0, -1).join(' ') || '',
        family: a.querySelector('name')?.textContent?.split(' ').slice(-1)[0] || '',
      }));
    };
    
    const getCategories = (): string[] => {
      const cats = entry.querySelectorAll('category');
      return Array.from(cats).map(c => c.getAttribute('term') || '');
    };
    
    return {
      id: getText('id'),
      title: getText('title').replace(/\n/g, ' ').trim(),
      summary: getText('summary').replace(/\n/g, ' ').trim(),
      published: getText('published'),
      updated: getText('updated'),
      authors: getAuthors(),
      categories: getCategories(),
    };
  }
}
