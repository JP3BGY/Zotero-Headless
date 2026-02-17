// @ts-nocheck
import { Identifier, MetadataResult, FetcherConfig } from './types';
import { DOIFetcher } from './fetchers/doi-fetcher';
import { ISBNFetcher } from './fetchers/isbn-fetcher';
import { PMIDFetcher } from './fetchers/pmid-fetcher';
import { ArXivFetcher } from './fetchers/arxiv-fetcher';

/**
 * 元数据获取器主类
 * 负责根据标识符类型路由到对应的获取器
 */
export class MetadataFetcher {
  private config: FetcherConfig;
  private doiFetcher: DOIFetcher;
  private isbnFetcher: ISBNFetcher;
  private pmidFetcher: PMIDFetcher;
  private arxivFetcher: ArXivFetcher;

  constructor(config: FetcherConfig) {
    this.config = config;
    this.doiFetcher = new DOIFetcher(config);
    this.isbnFetcher = new ISBNFetcher(config);
    this.pmidFetcher = new PMIDFetcher(config);
    this.arxivFetcher = new ArXivFetcher(config);
  }

  /**
   * 获取单个标识符的元数据
   */
  async fetch(identifier: Identifier): Promise<MetadataResult> {
    switch (identifier.type) {
      case 'doi':
        return this.doiFetcher.fetchMetadata(identifier);
      case 'isbn':
        return this.isbnFetcher.fetchMetadata(identifier);
      case 'pmid':
        return this.pmidFetcher.fetchMetadata(identifier);
      case 'arxiv':
        return this.arxivFetcher.fetchMetadata(identifier);
      case 'ads':
        throw new Error('ADS Bibcode 暂不支持');
      case 'url':
        throw new Error('URL 解析暂不支持');
      default:
        throw new Error(`不支持的标识符类型: ${identifier.type}`);
    }
  }

  /**
   * 批量获取多个标识符的元数据
   */
  async fetchBatch(identifiers: Identifier[]): Promise<MetadataResult[]> {
    const results: MetadataResult[] = [];
    
    // 分批处理以控制并发
    const batchSize = this.config.maxConcurrent;
    
    for (let i = 0; i < identifiers.length; i += batchSize) {
      const batch = identifiers.slice(i, i + batchSize);
      
      console.log(`\n📦 处理第 ${Math.floor(i / batchSize) + 1} 批 (${batch.length} 个)...`);
      
      const batchPromises = batch.map(async (identifier) => {
        try {
          const result = await this.fetch(identifier);
          console.log(`   ✅ ${identifier.type.toUpperCase()}: ${identifier.value}`);
          return result;
        } catch (error) {
          console.log(`   ❌ ${identifier.type.toUpperCase()}: ${identifier.value} - ${(error as Error).message}`);
          return {
            identifier,
            data: null,
            item: null,
            source: 'error',
            timestamp: Date.now(),
            error: (error as Error).message,
          } as MetadataResult;
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }
    
    return results;
  }
}
