# Zotero-Headless Complete Design: Add Item(s) by Identifier

## 📋 功能概述

Zotero Desktop 的 "Add Item(s) by Identifier" 功能允许用户通过多种标识符快速添加文献到库中。本文档提供了在 Zotero-Headless 中实现此功能的完整技术设计和实施方案。

### 支持的功能
- ✅ **多种标识符支持**: DOI, ISBN, PMID, arXiv, ADS, URL
- ✅ **批量处理**: 支持逗号、空格、换行分隔的批量输入
- ✅ **优雅降级**: 主服务失败时使用备用服务
- ✅ **本地缓存**: 减少重复 API 调用
- ✅ **实时进度**: 批量处理时显示进度反馈

### 支持的标识符类型
| 类型 | 示例 | 描述 |
|------|------|------|
| **DOI** | `10.1007/s11263-019-01228-7` | Digital Object Identifier（数字对象标识符） |
| **ISBN** | `978-3-642-15515-4` | International Standard Book Number（国际标准书号） |
| **PMID** | `1234567` | PubMed Identifier（PubMed 标识符） |
| **arXiv ID** | `2001.12345v2` | arXiv 预印本标识符 |
| **ADS Bibcode** | `2024ApJ...123..456S` | Astrophysics Data System 书目代码 |
| **URL** | `https://arxiv.org/abs/2001.12345` | 网页地址 |

## 🔍 Zotero Desktop 实现原理

### 技术调研总结
Zotero Desktop 通过以下方式实现标识符添加功能：

1. **标识符识别系统**
   - 使用正则表达式匹配各种标识符格式
   - 优先级解析（有些标识符可能匹配多个模式）
   - 支持多种分隔符（逗号、空格、换行）

2. **元数据获取服务架构**
   ```mermaid
   graph TD
       A[标识符输入] --> B[识别类型]
       B --> C{类型判断}
       C -->|DOI| D[CrossRef API]
       C -->|ISBN| E[WorldCat API]
       C -->|PMID| F[PubMed API]
       C -->|arXiv| G[arXiv API]
       C -->|ADS| H[ADS API]
       C -->|URL| I[网页爬取]
       D --> J[数据转换]
       E --> J
       F --> J
       G --> J
       H --> J
       I --> J
       J --> K[Zotero 数据格式]
       K --> L[写入数据库]
   ```

3. **外部 API 依赖**
   - **DOI**: CrossRef REST API, DataCite API
   - **ISBN**: WorldCat API, Open Library API, Google Books API
   - **PMID**: NCBI PubMed E-Utilities API
   - **arXiv**: arXiv.org API
   - **ADS**: NASA ADS API
   - **URL**: 通用网页翻译器

## 🏗️ zotero-headless 实现方案

### 架构设计

#### 模块架构
```
┌─────────────────────────────────────────────┐
│                CLI 层                        │
│    `zotero add-by-id <identifier>`          │
└─────────────────────────────────────────────┘
                    │
┌─────────────────────────────────────────────┐
│            标识符解析层                       │
│    - 输入分割和清理                          │
│    - 类型识别（正则匹配）                     │
│    - 批量处理支持                            │
└─────────────────────────────────────────────┘
                    │
┌─────────────────────────────────────────────┐
│           服务路由层                          │
│    - 根据类型路由到对应的获取器               │
│    - 并发控制和队列管理                      │
│    - 错误处理和重试机制                      │
└─────────────────────────────────────────────┘
                    │
┌─────────────────────────────────────────────┐
│          元数据获取层                         │
│    ├─ DOI Fetcher     │ CrossRef, DataCite   │
│    ├─ ISBN Fetcher    │ WorldCat, OpenLib    │
│    ├─ PMID Fetcher    │ PubMed API           │
│    ├─ arXiv Fetcher   │ arXiv API            │
│    ├─ ADS Fetcher     │ ADS API              │
│    └─ URL Fetcher     │ Readability, Cheerio │
└─────────────────────────────────────────────┘
                    │
┌─────────────────────────────────────────────┐
│           数据转换层                          │
│    - 标准化不同 API 响应                      │
│    - 转换为 Zotero 数据格式                   │
│    - 补充缺失字段                            │
└─────────────────────────────────────────────┘
                    │
┌─────────────────────────────────────────────┐
│           数据库层                            │
│    - 写入 SQLite 数据库                      │
│    - 标记为未同步                            │
│    - 生成唯一标识符                          │
└─────────────────────────────────────────────┘
```

### 详细模块设计

#### 1. `@zotero-headless/identifier` 包（新）

**职责**: 处理所有标识符相关逻辑

**文件结构**:
```
packages/identifier/
├── src/
│   ├── index.ts              # 主导出
│   ├── types.ts              # 类型定义
│   ├── parser.ts             # 标识符解析器
│   ├── converter.ts          # 数据转换器
│   └── fetchers/             # 各类型获取器
│       ├── index.ts
│       ├── base-fetcher.ts   # 基础获取器
│       ├── doi-fetcher.ts
│       ├── isbn-fetcher.ts
│       ├── pmid-fetcher.ts
│       ├── arxiv-fetcher.ts
│       ├── ads-fetcher.ts
│       └── url-fetcher.ts
├── __tests__/                # 测试文件
└── package.json
```

**核心类型定义**:
```typescript
export interface Identifier {
  type: 'doi' | 'isbn' | 'pmid' | 'arxiv' | 'ads' | 'url';
  value: string;
  normalized: string;
  confidence: number;  // 识别置信度（0-1）
}

export interface MetadataResult {
  identifier: Identifier;
  data: any;           // 原始 API 响应
  item: ZoteroItem;    // 转换后的 Zotero 数据
  source: string;      // 数据来源（如 'crossref', 'worldcat'）
  timestamp: number;   // 获取时间戳
  error?: string;      // 错误信息（如有）
}

export interface FetcherConfig {
  maxConcurrent: number;      // 最大并发请求数
  timeout: number;            // 请求超时时间（毫秒）
  retries: number;            // 重试次数
  cacheTTL: number;          // 缓存时间（毫秒）
}
```

#### 2. 标识符解析器实现

```typescript
export class IdentifierParser {
  // 正则表达式模式（优先级顺序）
  private static readonly PATTERNS = [
    { type: 'doi', regex: /^(doi:)?10\.\d{4,9}\/[^\s]+$/i },
    { type: 'isbn', regex: /^(?:ISBN(?:-1[03])?:?\s?)?(?=[0-9X]{10}$|(?=(?:[0-9]+[- ]){3})[- 0-9X]{13}$|97[89][0-9]{10}$|(?=(?:[0-9]+[- ]){4})[- 0-9]{17}$)(?:97[89][- ]?)?[0-9]{1,5}[- ]?[0-9]+[- ]?[0-9]+[- ]?[0-9X]$/ },
    { type: 'pmid', regex: /^\d+$/ },
    { type: 'arxiv', regex: /^\d{4}\.\d{4,5}(?:v\d+)?$|^arXiv:\d{4}\.\d{4,5}(?:v\d+)?$/i },
    { type: 'ads', regex: /^\d{4}[A-Za-z0-9&.]{5}\.[A-Za-z.]{4,}$/ },
  ];

  /**
   * 解析输入字符串，返回识别到的标识符列表
   */
  static parse(input: string): Identifier[] {
    // 1. 清理和分割输入
    const tokens = this.splitInput(input);
    
    // 2. 识别每个标识符
    return tokens.map(token => this.identifyToken(token));
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
    // 按优先级尝试匹配
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
    
    // 未识别：可能是 URL
    try {
      new URL(token);  // 验证是否为有效 URL
      return {
        type: 'url',
        value: token,
        normalized: token,
        confidence: 0.5,  // 中等置信度
      };
    } catch {
      throw new Error(`无法识别的标识符格式: ${token}`);
    }
  }

  /**
   * 标准化标识符
   */
  private static normalize(token: string, type: string): string {
    switch (type) {
      case 'doi':
        return token.replace(/^doi:/i, '');
      case 'isbn':
        return token.replace(/[-\s]/g, '').replace(/^ISBN/i, '');
      case 'arxiv':
        return token.replace(/^arXiv:/i, '');
      default:
        return token;
    }
  }
}
```

#### 3. DOI 获取器示例

```typescript
export class DOIFetcher extends BaseFetcher {
  private readonly CROSSREF_API = 'https://api.crossref.org/works';
  private readonly DATACITE_API = 'https://api.datacite.org/dois';

  async fetch(identifier: Identifier): Promise<MetadataResult> {
    const doi = identifier.normalized;
    
    // 尝试 CrossRef API（主服务）
    let data, source;
    try {
      data = await this.fetchFromCrossRef(doi);
      source = 'crossref';
    } catch (error) {
      // 回退到 DataCite API
      try {
        data = await this.fetchFromDataCite(doi);
        source = 'datacite';
      } catch (fallbackError) {
        throw new Error(`DOI ${doi} 获取失败: ${error.message}, ${fallbackError.message}`);
      }
    }

    // 转换为 Zotero 数据格式
    const item = this.convertToZoteroItem(data, doi);
    
    return {
      identifier,
      data,
      item,
      source,
      timestamp: Date.now(),
    };
  }

  private async fetchFromCrossRef(doi: string): Promise<any> {
    const url = `${this.CROSSREF_API}/${encodeURIComponent(doi)}`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': `zotero-headless/1.0 (mailto:${this.config.email || 'anonymous@example.com'})`,
      },
      timeout: this.config.timeout,
    });

    if (!response.ok) {
      throw new Error(`CrossRef API 错误: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    return result.message;  // CrossRef 返回数据在 message 字段
  }

  private convertToZoteroItem(data: any, doi: string): ZoteroItem {
    const authors = (data.author || []).map((author: any) => ({
      creatorType: 'author',
      firstName: author.given || '',
      lastName: author.family || '',
    }));

    return {
      itemType: this.mapItemType(data.type),
      title: data.title?.[0] || data.title || '',
      DOI: doi,
      url: data.URL || `https://doi.org/${doi}`,
      publicationDate: data.published?.['date-parts']?.[0]?.join('-') || '',
      abstract: data.abstract || '',
      volume: data.volume,
      issue: data.issue,
      pages: data.page,
      journal: data['container-title']?.[0],
      publisher: data.publisher,
      creators: JSON.stringify(authors),
      tags: JSON.stringify([]),
      extra: JSON.stringify({}),
      collectionKeys: JSON.stringify([]),
    };
  }

  private mapItemType(crossrefType: string): string {
    const typeMap: Record<string, string> = {
      'journal-article': 'journalArticle',
      'proceedings-article': 'conferencePaper',
      'book-chapter': 'bookSection',
      'book': 'book',
      'report': 'report',
      'dataset': 'dataset',
      'standard': 'standard',
    };
    return typeMap[crossrefType] || 'journalArticle';
  }
}
```

#### 4. ISBN 获取器实现

```typescript
export class ISBNFetcher extends BaseFetcher {
  private readonly WORLDCAT_API = 'https://worldcat.org/webservices/catalog/content/isbn';
  private readonly OPEN_LIBRARY_API = 'https://openlibrary.org/api/books';
  private readonly GOOGLE_BOOKS_API = 'https://www.googleapis.com/books/v1/volumes';

  async fetch(identifier: Identifier): Promise<MetadataResult> {
    const isbn = identifier.normalized;
    let data, source;

    // 尝试多个数据源（按优先级）
    const sources = [
      { name: 'worldcat', fetcher: () => this.fetchFromWorldCat(isbn) },
      { name: 'openlibrary', fetcher: () => this.fetchFromOpenLibrary(isbn) },
      { name: 'googlebooks', fetcher: () => this.fetchFromGoogleBooks(isbn) },
    ];

    for (const { name, fetcher } of sources) {
      try {
        data = await fetcher();
        source = name;
        break;
      } catch (error) {
        console.log(`ISBN ${isbn} 从 ${name} 获取失败: ${error.message}`);
      }
    }

    if (!data) {
      throw new Error(`ISBN ${isbn} 从所有源获取失败`);
    }

    const item = this.convertToZoteroItem(data, isbn);
    
    return {
      identifier,
      data,
      item,
      source,
      timestamp: Date.now(),
    };
  }

  private async fetchFromWorldCat(isbn: string): Promise<any> {
    const url = `${this.WORLDCAT_API}/${isbn}?wskey=${this.config.worldcatKey}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      timeout: this.config.timeout,
    });

    if (!response.ok) {
      throw new Error(`WorldCat API 错误: ${response.status}`);
    }

    const xml = await response.text();
    // 解析 WorldCat XML 响应
    return this.parseWorldCatXML(xml);
  }

  private convertToZoteroItem(data: any, isbn: string): ZoteroItem {
    const authors = (data.authors || []).map((author: string) => {
      const [lastName, firstName] = author.split(',').map(s => s.trim());
      return {
        creatorType: 'author',
        firstName: firstName || '',
        lastName: lastName || author,
      };
    });

    return {
      itemType: 'book',
      title: data.title || '',
      ISBN: isbn,
      url: data.url || '',
      publicationDate: data.publicationDate || '',
      abstract: data.description || '',
      edition: data.edition,
      publisher: data.publisher,
      place: data.place,
      numberOfPages: data.numberOfPages,
      creators: JSON.stringify(authors),
      tags: JSON.stringify([]),
      extra: JSON.stringify({}),
      collectionKeys: JSON.stringify([]),
    };
  }
}
```

### 5. CLI 命令实现

```typescript
// apps/cli/src/commands/add-by-id.ts
import { IdentifierParser, MetadataFetcher } from '@zotero-headless/identifier';

export const addByIdCommand = {
  name: 'add-by-id',
  aliases: ['add'],
  description: 'Add item(s) by identifier (DOI, ISBN, PMID, arXiv, ADS, URL)',
  execute: async (args: string[]) => {
    if (args.length === 0) {
      console.log(`
❌ 请提供至少一个标识符
   
用法: zotero add-by-id <identifier> [identifier2 ...]

示例:
  zotero add-by-id "10.1007/s11263-019-01228-7"
  zotero add-by-id "978-3-642-15515-4"
  zotero add-by-id "1234567, arXiv:2001.12345"
      `);
      return;
    }

    await initModules();
    const input = args.join(' ');
    
    try {
      console.log('🔍 正在解析标识符...');
      
      // 1. 解析标识符
      const identifiers = IdentifierParser.parse(input);
      console.log(`📝 找到 ${identifiers.length} 个标识符`);
      
      // 2. 显示识别结果
      identifiers.forEach((id, index) => {
        console.log(`   ${index + 1}. ${id.type.toUpperCase()}: ${id.value}`);
      });
      
      // 3. 配置获取器
      const fetcher = new MetadataFetcher({
        maxConcurrent: 5,
        timeout: 30000,
        retries: 3,
        cacheTTL: 3600000,
        email: process.env.CROSSREF_EMAIL,
        worldcatKey: process.env.WORLDCAT_API_KEY,
      });
      
      // 4. 获取元数据
      console.log('\n📦 正在获取元数据...');
      const results = await fetcher.fetchBatch(identifiers);
      
      // 5. 显示结果摘要
      const successCount = results.filter(r => !r.error).length;
      const failCount = results.filter(r => r.error).length;
      
      console.log(`\n📊 结果摘要:`);
      console.log(`   ✅ 成功: ${successCount}`);
      console.log(`   ❌ 失败: ${failCount}`);
      
      // 6. 写入数据库
      if (successCount > 0) {
        console.log('\n💾 写入本地数据库...');
        const db = getDatabase();
        const library = await db.select().from(libraries).get();
        
        if (!library) {
          console.log('❌ 未找到文献库。请先运行 "zotero sync"');
          return;
        }
        
        for (const result of results) {
          if (result.error) continue;
          
          const item = {
            ...result.item,
            key: this.generateKey(),
            libraryId: library.id,
            version: 0,
            synced: false,
            deleted: false,
            createdAt: Math.floor(Date.now() / 1000),
            updatedAt: Math.floor(Date.now() / 1000),
            rawJson: JSON.stringify({ data: result.item }),
          };
          
          await db.insert(items).values(item).run();
          console.log(`   📄 已添加: ${item.title?.substring(0, 50)}...`);
        }
        
        console.log(`\n🎉 成功添加 ${successCount} 个文献到本地数据库！`);
        console.log('💡 运行 "zotero sync" 上传到远程');
      }
      
      // 7. 显示失败详情
      if (failCount > 0) {
        console.log('\n⚠️ 失败的标识符:');
        results.filter(r => r.error).forEach((result, index) => {
          console.log(`   ${index + 1}. ${result.identifier.value}`);
          console.log(`     原因: ${result.error}`);
        });
      }
      
    } catch (error) {
      console.log(`❌ 添加失败: ${error.message}`);
      console.log('💡 请检查:');
      console.log('   1. 标识符格式是否正确');
      console.log('   2. 网络连接是否正常');
      console.log('   3. API 密钥配置是否正确');
    }
  },
  
  private generateKey(): string {
    // 生成 Zotero 格式的随机 key（8位大写字母和数字）
    return Array.from({ length: 8 }, () => 
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.charAt(
        Math.floor(Math.random() * 36)
      )
    ).join('');
  }
};
```

### 6. 配置和依赖

#### 依赖包
```json
{
  "dependencies": {
    "@zotero-headless/identifier": "^1.0.0",
    "@mozilla/readability": "^0.4.0",
    "isbn-utils": "^1.0.0",
    "arxiv-api": "^0.0.4",
    "node-fetch": "^3.0.0",
    "cheerio": "^1.0.0",
    "xml2js": "^0.6.2"
  }
}
```

#### 环境配置
```env
# 外部 API 配置
CROSSREF_EMAIL=your-email@example.com  # CrossRef 礼貌要求
WORLDCAT_API_KEY=your-worldcat-key
GOOGLE_BOOKS_API_KEY=your-google-books-key
OPEN_LIBRARY_API_ENABLED=true

# 性能配置
MAX_CONCURRENT_REQUESTS=5
REQUEST_TIMEOUT_MS=30000
CACHE_TTL_MS=3600000  # 1小时缓存
MAX_RETRIES=3

# 功能开关
ENABLE_DOI_LOOKUP=true
ENABLE_ISBN_LOOKUP=true
ENABLE_PMID_LOOKUP=true
ENABLE_ARXIV_LOOKUP=true
ENABLE_ADS_LOOKUP=false  # 默认关闭（天文专业功能）
ENABLE_URL_LOOKUP=true
```

### 7. 测试策略

#### 单元测试
```typescript
// packages/identifier/__tests__/parser.test.ts
describe('IdentifierParser', () => {
  test('should parse DOI correctly', () => {
    const identifiers = IdentifierParser.parse('10.1007/s11263-019-01228-7');
    expect(identifiers).toHaveLength(1);
    expect(identifiers[0].type).toBe('doi');
    expect(identifiers[0].normalized).toBe('10.1007/s11263-019-01228-7');
  });
  
  test('should handle batch input', () => {
    const identifiers = IdentifierParser.parse('10.1007/xyz, 978-3-642-15515-4');
    expect(identifiers).toHaveLength(2);
    expect(identifiers[0].type).toBe('doi');
    expect(identifiers[1].type).toBe('isbn');
  });
  
  test('should normalize identifiers', () => {
    const identifiers = IdentifierParser.parse('doi:10.1007/xyz');
    expect(identifiers[0].normalized).toBe('10.1007/xyz');
  });
});
```

#### 集成测试
```typescript
// packages/identifier/__tests__/fetchers/doi-fetcher.integration.test.ts
describe('DOIFetcher Integration', () => {
  let fetcher: DOIFetcher;
  
  beforeEach(() => {
    fetcher = new DOIFetcher({
      maxConcurrent: 1,
      timeout: 5000,
      retries: 0,
      cacheTTL: 0,
      email: 'test@example.com',
    });
  });
  
  test('should fetch metadata for valid DOI', async () => {
    const identifier = { type: 'doi', value: '10.1007/s11263-019-01228-7', normalized: '10.1007/s11263-019-01228-7', confidence: 0.9 };
    const result = await fetcher.fetch(identifier);
    
    expect(result).toBeDefined();
    expect(result.item).toBeDefined();
    expect(result.item.title).toBeDefined();
    expect(result.item.DOI).toBe('10.1007/s11263-019-01228-7');
    expect(result.source).toBe('crossref');
  }, 10000);
});
```

#### 端到端测试
```typescript
// apps/cli/__tests__/add-by-id.e2e.test.ts
describe('Add by Identifier E2E', () => {
  beforeEach(() => {
    // 清除测试数据库
    fs.unlinkSync(TEST_DB_PATH);
  });
  
  test('should add item by DOI', async () => {
    const { stdout, exitCode } = await execAsync('zotero add-by-id "10.1007/s11263-019-01228-7"', {
      env: { ...process.env, NODE_ENV: 'test' },
    });
    
    expect(exitCode).toBe(0);
    expect(stdout).toContain('成功添加');
    expect(stdout).toContain('运行 "zotero sync"');
  });
});
```

### 8. 性能优化

#### 并发控制
```typescript
export class BatchFetcher {
  private queue: Array<{ identifier: Identifier; resolve: Function; reject: Function }> = [];
  private activeCount = 0;
  
  async fetchBatch(identifiers: Identifier[], maxConcurrent: number = 5): Promise<MetadataResult[]> {
    const results: MetadataResult[] = [];
    
    // 分批处理
    for (let i = 0; i < identifiers.length; i += maxConcurrent) {
      const batch = identifiers.slice(i, i + maxConcurrent);
      const batchPromises = batch.map(id => this.fetchSingle(id));
      
      const batchResults = await Promise.allSettled(batchPromises);
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
          console.log(`   ✅ ${batch[index].value}`);
        } else {
          results.push({
            identifier: batch[index],
            data: null,
            item: null,
            source: 'error',
            timestamp: Date.now(),
            error: result.reason.message,
          });
          console.log(`   ❌ ${batch[index].value}: ${result.reason.message}`);
        }
      });
    }
    
    return results;
  }
}
```

#### 缓存机制
```typescript
export class CacheManager {
  private cache = new Map<string, { data: any; timestamp: number }>();
  
  async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number = 3600000
  ): Promise<T> {
    const cached = this.cache.get(key);
    
    // 检查缓存是否有效
    if (cached && Date.now() - cached.timestamp < ttl) {
      return cached.data;
    }
    
    // 获取新数据
    const data = await fetcher();
    this.cache.set(key, { data, timestamp: Date.now() });
    
    // 清理过期缓存
    this.cleanup();
    
    return data;
  }
  
  private cleanup() {
    const now = Date.now();
    for (const [key, { timestamp }] of this.cache.entries()) {
      if (now - timestamp > 86400000) { // 24小时
        this.cache.delete(key);
      }
    }
  }
}
```

### 9. 错误处理

#### 优雅降级策略
```typescript
export class ResilientFetcher {
  async fetchWithFallback(identifier: Identifier, sources: Array<{ name: string; fetcher: () => Promise<any> }>) {
    let lastError: Error;
    
    for (const { name, fetcher } of sources) {
      try {
        const data = await fetcher();
        return { data, source: name };
      } catch (error) {
        lastError = error;
        console.log(`⚠️ ${identifier.value} 从 ${name} 获取失败: ${error.message}`);
        // 继续尝试下一个源
      }
    }
    
    throw new Error(`所有源都失败: ${lastError.message}`);
  }
}
```

#### 用户友好的错误信息
```typescript
export function formatErrorMessage(error: Error, identifier: Identifier): string {
  const suggestions: Record<string, string> = {
    'network': '请检查网络连接并重试',
    'timeout': '请求超时，请稍后重试',
    'not_found': '标识符未找到，请检查是否正确',
    'invalid_format': '标识符格式不正确',
    'rate_limit': 'API 请求过于频繁，请稍后重试',
  };
  
  let suggestion = suggestions['network']; // 默认
  
  if (error.message.includes('timeout')) suggestion = suggestions['timeout'];
  else if (error.message.includes('404')) suggestion = suggestions['not_found'];
  else if (error.message.includes('rate limit')) suggestion = suggestions['rate_limit'];
  
  return `
❌ 无法获取 ${identifier.type.toUpperCase()}: ${identifier.value}

错误: ${error.message}

建议: ${suggestion}

可尝试:
  1. 手动验证标识符是否正确
  2. 访问 https://doi.org/${identifier.value} 检查 DOI
  3. 稍后重试
  `;
}
```

### 10. 监控和日志

#### 结构化日志
```typescript
export class Logger {
  static info(action: string, meta: any = {}) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      action,
      ...meta,
    }));
  }
  
  static error(action: string, error: Error, meta: any = {}) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      action,
      error: error.message,
      stack: error.stack,
      ...meta,
    }));
  }
  
  static performance(startTime: number, action: string, identifier: string) {
    const duration = Date.now() - startTime;
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'performance',
      action,
      identifier,
      duration,
    }));
  }
}
```

### 11. 实施路线图

#### 阶段 1: 基础功能（2-3周）
**目标**: 实现 DOI 和 ISBN 的基础支持
- [ ] 创建 `@zotero-headless/identifier` 包
- [ ] 实现标识符解析器
- [ ] 实现 DOI 获取器（CrossRef API）
- [ ] 实现 ISBN 获取器（WorldCat API）
- [ ] 基础 CLI 命令
- [ ] 单元测试框架

#### 阶段 2: 扩展支持（1-2周）
**目标**: 添加更多标识符类型
- [ ] 实现 PMID 获取器（PubMed API）
- [ ] 实现 arXiv 获取器（arXiv API）
- [ ] 实现 URL 获取器（Readability）
- [ ] 批量处理优化
- [ ] 集成测试

#### 阶段 3: 生产就绪（1-2周）
**目标**: 增强稳定性和用户体验
- [ ] 缓存机制
- [ ] 错误恢复和重试
- [ ] 进度指示器
- [ ] 性能监控
- [ ] 完整的文档

#### 阶段 4: 高级功能（后续）
**目标**: 添加高级特性
- [ ] ADS Bibcode 支持
- [ ] 插件系统（自定义标识符类型）
- [ ] 机器学习识别
- [ ] 浏览器扩展集成
- [ ] 离线模式

### 12. 风险评估和缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 外部 API 不可用 | 功能完全失效 | 实现多个备用源、添加离线模式 |
| 标识符识别错误 | 获取错误元数据 | 实现置信度评分、允许手动指定类型 |
| 性能问题 | 批量处理缓慢 | 实现并发限制、缓存机制、进度反馈 |
| 数据质量问题 | 元数据不完整 | 数据验证和清理、允许手动编辑补充 |
| API 速率限制 | 功能间歇性失效 | 实现请求队列、指数退避重试 |
| 网络问题 | 连接不稳定 | 自动重试、优雅降级、详细错误信息 |

### 13. 结论

"Add Item(s) by Identifier" 功能是 Zotero-Headless 的重要扩展，将极大提升用户体验。本设计文档提供了：

1. **完整的架构设计**: 模块化、可扩展的架构
2. **详细的技术实现**: 从标识符解析到数据库写入的完整流程
3. **全面的测试策略**: 单元测试、集成测试、端到端测试
4. **性能优化方案**: 缓存、并发、错误处理
5. **清晰的实施路线图**: 4个阶段逐步实现

实施此功能将使 Zotero-Headless 能够与 Zotero Desktop 的标识符添加功能相媲美，为用户提供无缝的文献添加体验。

---

**文档版本**: 1.0  
**最后更新**: 2026-02-17  
**状态**: Ready for Implementation