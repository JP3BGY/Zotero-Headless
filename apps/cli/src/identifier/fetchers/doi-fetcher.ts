// @ts-nocheck
import { Identifier, MetadataResult } from './types';
import { BaseFetcher } from './base-fetcher';
import { DataConverter } from '../converter';

/**
 * DOI 元数据获取器
 * 使用 CrossRef API 获取 DOI 对应的文献元数据
 */
export class DOIFetcher extends BaseFetcher {
  private readonly CROSSREF_API = 'https://api.crossref.org/works';
  private readonly DATACITE_API = 'https://api.datacite.org/dois';

  /**
   * 获取 DOI 元数据
   */
  async fetchMetadata(identifier: Identifier): Promise<MetadataResult> {
    const doi = identifier.normalized;
    
    console.log(`   📡 正在查询 CrossRef: ${doi}`);
    
    // 尝试 CrossRef API（主服务）
    let data, source;
    try {
      data = await this.fetchFromCrossRef(doi);
      source = 'crossref';
    } catch (error) {
      console.log(`   ⚠️ CrossRef 查询失败，尝试 DataCite...`);
      // 回退到 DataCite API
      try {
        data = await this.fetchFromDataCite(doi);
        source = 'datacite';
      } catch (fallbackError) {
        throw new Error(`DOI ${doi} 获取失败: ${(error as Error).message}`);
      }
    }

    // 转换为 Zotero 数据格式
    const item = DataConverter.fromCrossRef(data, doi);
    
    return {
      identifier,
      data,
      item,
      source,
      timestamp: Date.now(),
    };
  }

  /**
   * 从 CrossRef API 获取数据
   */
  private async fetchFromCrossRef(doi: string): Promise<any> {
    const url = `${this.CROSSREF_API}/${encodeURIComponent(doi)}`;
    
    const response = await this.fetchWithRetry(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': `zotero-headless/1.0 (mailto:${this.config.email || 'anonymous@example.com'})`,
      },
    });

    if (!response.ok) {
      throw new Error(`CrossRef API 错误: ${response.status}`);
    }

    const result = await response.json();
    return result.message;  // CrossRef 返回数据在 message 字段
  }

  /**
   * 从 DataCite API 获取数据
   */
  private async fetchFromDataCite(doi: string): Promise<any> {
    const url = `${this.DATACITE_API}/${encodeURIComponent(doi)}`;
    
    const response = await this.fetchWithRetry(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`DataCite API 错误: ${response.status}`);
    }

    const result = await response.json();
    const attrs = result.data.attributes;
    
    // 将 DataCite 格式转换为 CrossRef 兼容格式
    return {
      type: attrs.types?.citeproc || 'preprint',
      title: attrs.titles?.map((t: any) => t.title) || [],
      DOI: doi,
      URL: attrs.url || `https://doi.org/${doi}`,
      published: attrs.published || String(attrs.publicationYear || ''),
      abstract: attrs.descriptions?.find((d: any) => d.descriptionType === 'Abstract')?.description || '',
      volume: null,
      issue: null,
      page: null,
      'container-title': attrs.container?.title ? [attrs.container.title] : [],
      publisher: attrs.publisher || 'arXiv',
      author: attrs.creators?.map((c: any) => ({
        given: c.givenName || '',
        family: c.familyName || '',
      })) || [],
      ISBN: attrs.identifiers?.filter((i: any) => i.identifierType === 'ISBN').map((i: any) => i.identifier) || [],
      ISSN: attrs.identifiers?.filter((i: any) => i.identifierType === 'ISSN').map((i: any) => i.identifier) || [],
    };
  }
}
