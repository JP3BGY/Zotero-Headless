// @ts-nocheck
import { Identifier, MetadataResult, FetcherConfig } from './types';
import { DataConverter } from '../converter';

/**
 * 基础获取器类
 * 提供通用的 HTTP 请求和错误处理功能
 */
export abstract class BaseFetcher {
  protected config: FetcherConfig;

  constructor(config: FetcherConfig) {
    this.config = config;
  }

  /**
   * 发起 HTTP 请求
   */
  protected async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 带重试的请求
   */
  protected async fetchWithRetry<T>(
    url: string, 
    options: RequestInit = {},
    parseFn?: (resp: Response) => Promise<T>
  ): Promise<T> {
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        const response = await this.fetch(url, options);
        
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error(`资源未找到: ${response.status}`);
          }
          if (response.status === 429) {
            // 速率限制，等待后重试
            const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
            console.log(`   ⏳ 速率限制，等待 ${retryAfter} 秒...`);
            await this.sleep(retryAfter * 1000);
            continue;
          }
          throw new Error(`API 错误: ${response.status} ${response.statusText}`);
        }

        if (parseFn) {
          return await parseFn(response);
        }
        return response as T;
      } catch (error) {
        lastError = error as Error;
        
        // 如果是网络错误或超时，等待后重试
        if (attempt < this.config.retries) {
          const delay = Math.pow(2, attempt) * 1000;  // 指数退避
          console.log(`   ⏳ 请求失败，${delay/1000} 秒后重试...`);
          await this.sleep(delay);
        }
      }
    }
    
    throw lastError || new Error('请求失败');
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 子类必须实现的获取方法
   */
  abstract fetchMetadata(identifier: Identifier): Promise<MetadataResult>;
}
