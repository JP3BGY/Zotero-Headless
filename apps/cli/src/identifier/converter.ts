// @ts-nocheck
/**
 * 数据转换器
 * 将各种 API 返回的数据转换为 Zotero 数据格式
 */
import { Creator } from './types.js';

export class DataConverter {
  /**
   * 映射 CrossRef 论文类型到 Zotero 类型
   */
  static mapCrossRefType(crossrefType: string): string {
    const typeMap: Record<string, string> = {
      'journal-article': 'journalArticle',
      'proceedings-article': 'conferencePaper',
      'book-chapter': 'bookSection',
      'book': 'book',
      'report': 'report',
      'dataset': 'dataset',
      'standard': 'standard',
      'dissertation': 'thesis',
      'preprint': 'preprint',
      'posted-content': 'preprint',
    };
    return typeMap[crossrefType] || 'journalArticle';
  }

  /**
   * 将 CrossRef 数据转换为 Zotero 格式
   */
  static fromCrossRef(data: any, identifier: string): any {
    // 解析作者
    const creators: Creator[] = (data.author || []).map((author: any) => ({
      creatorType: 'author',
      firstName: author.given || '',
      lastName: author.family || '',
    }));

    // 解析日期
    const publicationDate = DataConverter.parseCrossRefDate(data);

    // 解析期刊名称
    const journal = data['container-title']?.[0] || '';

    // 清理摘要（CrossRef 使用 HTML 标签）
    const abstract = DataConverter.stripHTML(data.abstract || '');

    return {
      itemType: DataConverter.mapCrossRefType(data.type),
      title: data.title?.[0] || data.title || '',
      DOI: identifier,
      url: data.URL || `https://doi.org/${identifier}`,
      date: publicationDate,
      abstract,
      volume: data.volume || null,
      issue: data.issue || null,
      pages: data.page || null,
      journal,
      publisher: data.publisher || null,
      isbn: data.ISBN ? (Array.isArray(data.ISBN) ? data.ISBN[0] : data.ISBN) : null,
      issn: data.ISSN ? (Array.isArray(data.ISSN) ? data.ISSN[0] : data.ISSN) : null,
      doi: identifier,
      creators, // Keep as array for Zotero API compatibility
      tags: JSON.stringify([]),
      extra: JSON.stringify({}),
      collectionKeys: JSON.stringify([]),
    };
  }

  /**
   * 将 Open Library 数据转换为 Zotero 格式
   */
  static fromOpenLibrary(data: any, isbn: string): any {
    // 解析作者
    const creators: Creator[] = (data.authors || []).map((author: any) => {
      if (typeof author === 'string') {
        // 作者名可能是字符串格式 "Last, First"
        const parts = author.split(',').map((s: string) => s.trim());
        return {
          creatorType: 'author',
          firstName: parts[1] || '',
          lastName: parts[0] || author,
        };
      }
      return {
        creatorType: 'author',
        firstName: author.name?.split(' ').slice(0, -1).join(' ') || '',
        lastName: author.name?.split(' ').slice(-1)[0] || '',
      };
    });

    // 解析出版日期
    const publishDate = data.publish_date || '';
    const publicationDate = this.parsePublishDate(publishDate);

    // 获取 ISBN
    const isbn13 = data.isbn_13?.[0] || isbn;

    return {
      itemType: 'book',
      title: data.title || '',
      ISBN: isbn13,
      url: data.url?.[0] || '',
      date: publicationDate,
      abstract: data.notes || data.excerpts?.[0]?.text || '',
      edition: data.edition_name || null,
      publisher: data.publishers?.[0]?.name || null,
      place: data.publish_places?.[0]?.name || null,
      numberOfPages: data.number_of_pages || null,
      isbn: isbn13,
      issn: null,
      doi: null,
      creators: JSON.stringify(creators),
      tags: JSON.stringify([]),
      extra: JSON.stringify({}),
      collectionKeys: JSON.stringify([]),
    };
  }

  /**
   * 将 PubMed 数据转换为 Zotero 格式
   */
  static fromPubMed(data: any, pmid: string): any {
    // 解析作者
    const creators: Creator[] = (data.authors?.author || []).map((author: any) => ({
      creatorType: 'author',
      firstName: author.forename || '',
      lastName: author.lastname || '',
    }));

    // 解析日期
    const pubDate = data.pubdate || '';
    const publicationDate = this.parsePublishDate(pubDate);

    // 解析期刊
    const journal = data.source || '';

    return {
      itemType: 'journalArticle',
      title: data.title || '',
      DOI: data.elocationid?.replace('doi: ', '') || null,
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      date: publicationDate,
      abstract: data.abstract || '',
      volume: data.volume || null,
      issue: data.issue || null,
      pages: data.pages || null,
      journal,
      publisher: null,
      creators: JSON.stringify(creators),
      tags: JSON.stringify([]),
      extra: JSON.stringify({ pmid }),
      collectionKeys: JSON.stringify([]),
    };
  }

  /**
   * 将 arXiv 数据转换为 Zotero 格式
   */
  static fromArXiv(data: any, arxivId: string): any {
    // 解析作者
    const creators: Creator[] = (data.authors || []).map((author: any) => ({
      creatorType: 'author',
      firstName: author.given || '',
      lastName: author.family || '',
    }));

    // 解析日期
    const publicationDate = data.published?.split('T')[0] || '';

    // 确定论文类型
    let itemType = 'preprint';
    if (data.categories?.some((c: string) => c.startsWith('cs.'))) {
      // 计算机科学论文
      itemType = 'conferencePaper';
    }

    return {
      itemType,
      title: data.title || '',
      DOI: null,
      url: data.id || `https://arxiv.org/abs/${arxivId}`,
      date: publicationDate,
      abstract: data.summary || '',
      volume: null,
      issue: null,
      pages: null,
      journal: 'arXiv',
      publisher: 'arXiv',
      creators: JSON.stringify(creators),
      tags: JSON.stringify(data.categories?.map((c: string) => ({ tag: c })) || []),
      extra: JSON.stringify({ arxiv: arxivId }),
      collectionKeys: JSON.stringify([]),
    };
  }

  /**
   * 解析 CrossRef 日期格式
   */
  private static parseCrossRefDate(data: any): string {
    const dateParts = data.published?.['date-parts']?.[0] || 
                     data['published-print']?.['date-parts']?.[0] ||
                     data['published-online']?.['date-parts']?.[0];
    
    if (dateParts) {
      return dateParts.join('-');
    }
    return '';
  }

  /**
   * 解析出版日期字符串
   */
  private static parsePublishDate(dateStr: string): string {
    if (!dateStr) return '';
    
    // 尝试解析各种格式
    // YYYY
    if (/^\d{4}$/.test(dateStr)) {
      return dateStr;
    }
    // YYYY-MM
    if (/^\d{4}-\d{2}$/.test(dateStr)) {
      return dateStr;
    }
    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return dateStr;
    }
    // 其他格式：尝试提取年份
    const yearMatch = dateStr.match(/\d{4}/);
    return yearMatch ? yearMatch[0] : dateStr;
  }

  /**
   * 移除 HTML 标签
   */
  private static stripHTML(html: string): string {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .trim();
  }
}
