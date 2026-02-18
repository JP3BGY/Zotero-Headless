// @ts-nocheck
import { Identifier, MetadataResult } from '../types.js';
import { BaseFetcher } from './base-fetcher.js';
import { DataConverter } from '../converter.js';

/**
 * ISBN 元数据获取器
 * 使用 Open Library API 获取 ISBN 对应的图书元数据
 */
export class ISBNFetcher extends BaseFetcher {
  private readonly OPEN_LIBRARY_API = 'https://openlibrary.org/api/books';
  private readonly GOOGLE_BOOKS_API = 'https://www.googleapis.com/books/v1/volumes';

  /**
   * 获取 ISBN 元数据
   */
  async fetchMetadata(identifier: Identifier): Promise<MetadataResult> {
    const isbn = identifier.normalized;
    
    console.log(`   📡 正在查询 Open Library: ${isbn}`);
    
    let data, source;

    // 尝试 Open Library API
    try {
      data = await this.fetchFromOpenLibrary(isbn);
      source = 'openlibrary';
    } catch (error) {
      console.log(`   ⚠️ Open Library 查询失败，尝试 Google Books...`);
      
      // 回退到 Google Books API
      try {
        data = await this.fetchFromGoogleBooks(isbn);
        source = 'googlebooks';
      } catch (fallbackError) {
        throw new Error(`ISBN ${isbn} 获取失败: ${(error as Error).message}`);
      }
    }

    // 转换为 Zotero 数据格式
    const item = source === 'openlibrary' 
      ? DataConverter.fromOpenLibrary(data, isbn)
      : this.convertGoogleBooks(data, isbn);
    
    return {
      identifier,
      data,
      item,
      source,
      timestamp: Date.now(),
    };
  }

  /**
   * 从 Open Library API 获取数据
   */
  private async fetchFromOpenLibrary(isbn: string): Promise<any> {
    const url = `${this.OPEN_LIBRARY_API}?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
    
    const response = await this.fetch(url);

    if (!response.ok) {
      throw new Error(`Open Library API 错误: ${response.status}`);
    }

    const result = await response.json();
    const key = `ISBN:${isbn}`;
    
    if (!result[key]) {
      throw new Error(`未找到 ISBN: ${isbn}`);
    }
    
    return result[key];
  }

  /**
   * 从 Google Books API 获取数据
   */
  private async fetchFromGoogleBooks(isbn: string): Promise<any> {
    const url = `${this.GOOGLE_BOOKS_API}?q=isbn:${isbn}`;
    
    const response = await this.fetch(url);

    if (!response.ok) {
      throw new Error(`Google Books API 错误: ${response.status}`);
    }

    const result = await response.json();
    
    if (!result.items || result.items.length === 0) {
      throw new Error(`未找到 ISBN: ${isbn}`);
    }
    
    return result.items[0].volumeInfo;
  }

  /**
   * 转换 Google Books 数据格式
   */
  private convertGoogleBooks(data: any, isbn: string): any {
    const creators = (data.authors || []).map((name: string) => {
      const parts = name.split(' ');
      const lastName = parts.pop() || '';
      const firstName = parts.join(' ');
      return {
        creatorType: 'author',
        firstName,
        lastName,
      };
    });

    return {
      itemType: 'book',
      title: data.title || '',
      ISBN: isbn,
      url: data.infoLink || '',
      publicationDate: data.publishedDate || '',
      abstract: data.description || '',
      edition: data.edition || null,
      publisher: data.publisher || null,
      place: null,
      numberOfPages: data.pageCount || null,
      isbn,
      issn: null,
      doi: null,
      creators: JSON.stringify(creators),
      tags: JSON.stringify((data.categories || []).map((c: string) => ({ tag: c }))),
      extra: JSON.stringify({}),
      collectionKeys: JSON.stringify([]),
    };
  }
}
