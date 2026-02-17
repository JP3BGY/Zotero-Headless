// @ts-nocheck
/**
 * 标识符类型定义
 */
export type IdentifierType = 'doi' | 'isbn' | 'pmid' | 'arxiv' | 'ads' | 'url';

/**
 * 标识符接口
 */
export interface Identifier {
  type: IdentifierType;
  value: string;
  normalized: string;
  confidence: number;  // 识别置信度（0-1）
}

/**
 * 元数据获取结果
 */
export interface MetadataResult {
  identifier: Identifier;
  data: any;           // 原始 API 响应
  item: Partial<ZoteroItem>;  // 转换后的 Zotero 数据
  source: string;      // 数据来源（如 'crossref', 'worldcat'）
  timestamp: number;   // 获取时间戳
  error?: string;      // 错误信息（如有）
}

/**
 * Zotero 项目数据结构
 */
export interface ZoteroItem {
  key: string;
  libraryId: number;
  version: number;
  synced: boolean;
  deleted: boolean;
  createdAt: number;
  updatedAt: number;
  itemType: string;
  title: string | null;
  publicationDate: string | null;
  abstract: string | null;
  doi: string | null;
  url: string | null;
  isbn: string | null;
  publisher: string | null;
  journal: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  creators: string;  // JSON string
  tags: string;      // JSON string
  extra: string;     // JSON string
  collectionKeys: string;  // JSON string
  rawJson: string;   // JSON string
}

/**
 * 获取器配置
 */
export interface FetcherConfig {
  maxConcurrent: number;      // 最大并发请求数
  timeout: number;            // 请求超时时间（毫秒）
  retries: number;            // 重试次数
  cacheTTL: number;          // 缓存时间（毫秒）
  email?: string;             // CrossRef 要求的邮箱
  worldcatKey?: string;       // WorldCat API Key
  googleBooksKey?: string;    // Google Books API Key
}

/**
 * 作者/创作者结构
 */
export interface Creator {
  creatorType: string;
  firstName: string;
  lastName: string;
}
