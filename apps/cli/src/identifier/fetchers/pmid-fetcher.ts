// @ts-nocheck
import { Identifier, MetadataResult } from './types';
import { BaseFetcher } from './base-fetcher';
import { DataConverter } from '../converter';

/**
 * PubMed (PMID) 元数据获取器
 * 使用 NCBI E-utilities API 获取 PubMed 文章元数据
 */
export class PMIDFetcher extends BaseFetcher {
  private readonly PUBMED_API = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi';

  /**
   * 获取 PubMed 元数据
   */
  async fetchMetadata(identifier: Identifier): Promise<MetadataResult> {
    const pmid = identifier.normalized;
    
    console.log(`   📡 正在查询 PubMed: ${pmid}`);
    
    const data = await this.fetchFromPubMed(pmid);

    // 转换为 Zotero 数据格式
    const item = DataConverter.fromPubMed(data, pmid);
    
    return {
      identifier,
      data,
      item,
      source: 'pubmed',
      timestamp: Date.now(),
    };
  }

  /**
   * 从 PubMed API 获取数据
   */
  private async fetchFromPubMed(pmid: string): Promise<any> {
    const url = `${this.PUBMED_API}?db=pubmed&id=${pmid}&retmode=json`;
    
    const response = await this.fetch(url);

    if (!response.ok) {
      throw new Error(`PubMed API 错误: ${response.status}`);
    }

    const result = await response.json();
    
    if (!result.result || !result.result[pmid]) {
      throw new Error(`未找到 PMID: ${pmid}`);
    }
    
    return result.result[pmid];
  }
}
