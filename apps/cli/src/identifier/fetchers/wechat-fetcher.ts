// @ts-nocheck
/**
 * WeChat Article Fetcher
 * 
 * 基于 zotero-wxdown.js 的久经考验的实现
 * 处理微信公众号文章下载、元数据提取、图片 base64 嵌入
 */

import { BaseFetcher } from './base-fetcher.js';
import type { Identifier, MetadataResult, FetcherConfig, Creator } from '../types.js';

export class WeChatFetcher extends BaseFetcher {
  constructor(config: FetcherConfig) {
    super(config);
  }

  /**
   * 检查是否为微信文章 URL
   */
  static isWeChatURL(url: string): boolean {
    return url.includes('mp.weixin.qq.com');
  }

  /**
   * 获取元数据主入口
   */
  async fetchMetadata(identifier: Identifier): Promise<MetadataResult> {
    const url = identifier.normalized;
    
    console.log('📥 Fetching WeChat article...');
    
    // 1. 下载文章（使用微信特定的 headers）
    const html = await this.downloadArticle(url);
    
    // 检查文章有效性
    if (this.isInvalidArticle(html)) {
      throw new Error('Article URL is invalid or expired (参数错误). This usually means the link has expired or requires authentication.');
    }
    
    // 2. 解析元数据
    console.log('🔍 Parsing metadata...');
    const meta = this.parseMetadata(html, url);
    
    // 3. 提取内容
    console.log('📝 Extracting content...');
    const content = this.extractContent(html);
    if (!content) {
      throw new Error('Could not extract content from the article. The page structure may have changed.');
    }
    
    // 4. 处理图片（下载并转为 base64）
    console.log('🖼️  Processing images (this may take a while)...');
    const processedContent = await this.processImages(content);
    
    // 5. 生成完整 HTML
    const fullHtml = this.buildFullHtml(meta, processedContent, url);
    const contentHash = this.md5Hash(fullHtml).substring(0, 16);
    
    // 6. 构造返回结果
    const creators: Creator[] = meta.articleAuthor 
      ? [{ creatorType: 'author', firstName: '', lastName: meta.articleAuthor }]
      : [{ creatorType: 'author', firstName: '', lastName: meta.wechatName }];
    
    return {
      identifier,
      data: meta,
      item: {
        itemType: 'webpage',
        title: meta.title,
        url: url,
        abstractNote: meta.description || 'Saved from WeChat',
        publicationDate: meta.date,
        websiteTitle: meta.wechatName,
        publisher: '微信公众平台',
        creators: JSON.stringify(creators),
        tags: JSON.stringify([{ tag: 'wechat' }]),
        extra: JSON.stringify({
          location: meta.location,
          isOriginal: meta.isOriginal,
        }),
      },
      source: 'wechat',
      timestamp: Date.now(),
      // 特殊字段：供 add-by-id 后续处理使用
      extra: {
        processedHtml: fullHtml,
        contentHash: contentHash,
        isWeChatArticle: true,
      }
    };
  }

  /**
   * 下载文章（使用微信特定的 headers）
   */
  private async downloadArticle(url: string): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Referer': 'https://mp.weixin.qq.com/',
          'Connection': 'keep-alive',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // 处理可能的 gzip 压缩
      const buffer = await response.arrayBuffer();
      let data: string;
      
      try {
        // 尝试使用 DecompressionStream 解压
        const ds = new DecompressionStream('gzip');
        const writer = ds.writable.getWriter();
        writer.write(buffer);
        writer.close();
        
        const reader = ds.readable.getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }
        data = new TextDecoder().decode(result);
      } catch {
        // 如果不是 gzip，直接解码
        data = new TextDecoder().decode(buffer);
      }
      
      return data;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 检查文章是否无效
   */
  private isInvalidArticle(html: string): boolean {
    return html.includes('参数错误') || 
           html.includes('invalid request') || 
           html.includes('access_token is invalid') || 
           html.length < 1000;
  }

  /**
   * 解析元数据
   */
  private parseMetadata(html: string, url: string): {
    title: string;
    description: string;
    date: string;
    wechatName: string;
    articleAuthor: string;
    location: string;
    isOriginal: string;
  } {
    // 提取所有 script 内容
    const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let allScripts = '';
    let match;
    while ((match = scriptRegex.exec(html)) !== null) {
      allScripts += match[1] + '\n';
    }
    allScripts = allScripts.replace(/__biz/g, '__BIZ');
    
    // 从 JS 变量提取
    const extractVar = (field: string): string | null => {
      const regex = new RegExp(`(?:var\\s+)?${field.replace(/\./g, '\\.')}\\s*=\\s*["']([^"']+)["']`);
      const m = allScripts.match(regex);
      return m?.[1] || null;
    };
    
    const title = extractVar('msg_title') || 
                  this.extractFromMeta(html, 'og:title') ||
                  this.extractFromHtml(html, 'activity-name') ||
                  'Untitled';
    
    const description = extractVar('msg_desc') || 
                        this.extractFromMeta(html, 'og:description') ||
                        '';
    
    const rawDate = extractVar('createTime') || this.extractPublishTime(html);
    const date = this.formatDate(rawDate);
    
    // 公众号名称（多种模式尝试）
    const wechatName = this.extractJsName(html) || 
                       extractVar('nickname') || 
                       'Unknown';
    
    // 文章作者（优先 js_author_name_text，然后 js_author_name）
    const articleAuthor = this.extractFromHtml(html, 'js_author_name_text') ||
                          this.extractFromHtml(html, 'js_author_name') ||
                          '';
    
    // IP 属地
    const location = this.extractFromHtml(html, 'js_ip_wording') ||
                     extractVar('city') ||
                     extractVar('provinceName') ||
                     '';
    
    // 原创标识
    const isOriginal = this.extractFromHtml(html, 'copyright_logo') || '';
    
    return {
      title,
      description,
      date,
      wechatName,
      articleAuthor,
      location,
      isOriginal,
    };
  }

  /**
   * 从 meta 标签提取
   */
  private extractFromMeta(html: string, property: string): string | null {
    const regex = new RegExp(`<meta[^>]*property="${property}"[^>]*content="([^"]*)"`, 'i');
    const match = html.match(regex);
    return match?.[1] || null;
  }

  /**
   * 从 HTML 元素提取
   */
  private extractFromHtml(html: string, id: string): string | null {
    const regex = new RegExp(`id="${id}"[^>]*>([^<]+)<`, 'i');
    const match = html.match(regex);
    return match?.[1]?.trim() || null;
  }

  /**
   * 提取公众号名称
   */
  private extractJsName(html: string): string | null {
    const patterns = [
      /id="js_name"[^>]*>([^<]+)<\/a>/i,
      /class="profile_nickname"[^>]*>([^<]+)</i,
      /id="js_name"[^>]*>([^<]+)</i,
      /class="nickname"[^>]*>([^<]+)</i,
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
    return null;
  }

  /**
   * 提取发布时间
   */
  private extractPublishTime(html: string): string | null {
    const match = html.match(/id="publish_time"[^>]*>([^<]+)<\/em>/i);
    return match?.[1]?.trim() || null;
  }

  /**
   * 格式化日期
   */
  private formatDate(dateStr: string | null): string {
    if (!dateStr) return new Date().toISOString().split('T')[0];
    
    try {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        return d.toISOString().split('T')[0];
      }
    } catch {}
    
    return dateStr;
  }

  /**
   * 提取文章内容
   */
  private extractContent(html: string): string | null {
    // 多模式匹配（容错）
    const patterns = [
      /<div[^>]*id="js_content"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i,
      /<div[^>]*id="js_content"[^>]*>([\s\S]*?)<script/i,
      /<div[^>]*id=["']js_content["'][^>]*>([\s\S]*?)<\/div>(?:\s*<\/div>)?/i,
      /<div[^>]*class=["']rich_media_content[^"']*["'][^>]*>([\s\S]*?)<\/div>(?:\s*<\/div>)?/i,
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return match[1];
    }
    
    return null;
  }

  /**
   * 处理图片（下载并转为 base64）
   */
  private async processImages(content: string): Promise<string> {
    const images = this.extractImageUrls(content);
    console.log(`   Found ${images.length} images`);
    
    if (images.length === 0) return content;
    
    let processedContent = content;
    let successCount = 0;
    
    for (let i = 0; i < images.length; i++) {
      const url = images[i];
      console.log(`   [${i + 1}/${images.length}] Downloading: ${url.substring(0, 60)}...`);
      
      const base64 = await this.downloadImageToBase64(url);
      if (base64) {
        // 替换 data-src 和 src
        const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        processedContent = processedContent.replace(
          new RegExp(`data-src="${escaped}"`, 'g'), 
          `src="${base64}"`
        );
        processedContent = processedContent.replace(
          new RegExp(`src="${escaped}"`, 'g'), 
          `src="${base64}"`
        );
        successCount++;
      }
    }
    
    console.log(`   ✓ Successfully embedded ${successCount}/${images.length} images`);
    return processedContent;
  }

  /**
   * 提取图片 URL
   */
  private extractImageUrls(content: string): string[] {
    const images: string[] = [];
    
    // Pattern 1: data-src (懒加载，优先)
    const dataSrcRegex = /data-src="([^"]+)"/g;
    let match;
    while ((match = dataSrcRegex.exec(content)) !== null) {
      images.push(match[1]);
    }
    
    // Pattern 2: src
    const srcRegex = /src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|gif|webp))"/gi;
    while ((match = srcRegex.exec(content)) !== null) {
      if (!images.includes(match[1])) {
        images.push(match[1]);
      }
    }
    
    return images;
  }

  /**
   * 下载图片并转为 base64
   */
  private async downloadImageToBase64(url: string): Promise<string | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
          'Referer': 'https://mp.weixin.qq.com/',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) return null;
      
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength === 0) return null;
      
      // 检测图片格式
      let ext = 'png';
      if (url.includes('wx_fmt=')) {
        ext = url.match(/wx_fmt=([^&]+)/)?.[1] || 'png';
      } else if (url.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i)) {
        ext = url.match(/\.(jpg|jpeg|png|gif|webp)/i)?.[1] || 'png';
      }
      
      // webp 转为 png 提高兼容性
      if (ext === 'webp') ext = 'png';
      
      const base64 = Buffer.from(buffer).toString('base64');
      return `data:image/${ext};base64,${base64}`;
    } catch (err) {
      return null;
    }
  }

  /**
   * 生成完整 HTML
   */
  private buildFullHtml(
    meta: { title: string; wechatName: string; date: string; location: string; isOriginal: string; articleAuthor: string },
    content: string,
    url: string
  ): string {
    const metaParts = [meta.wechatName, meta.date];
    if (meta.location) metaParts.push(meta.location);
    const metaLine = metaParts.join(' ');
    
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="format-detection" content="telephone=no">
    <title>${meta.title}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; text-size-adjust: 100%; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            line-height: 1.8;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px 16px;
            color: #333;
            background: #fff;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            overflow-x: hidden;
            word-wrap: break-word;
            word-break: break-word;
        }
        h1 { font-size: 24px; margin-bottom: 20px; line-height: 1.4; }
        h2 { font-size: 20px; margin-top: 30px; margin-bottom: 15px; line-height: 1.4; }
        p { margin-bottom: 16px; line-height: 1.8; }
        img {
            max-width: 100%;
            width: auto;
            height: auto;
            display: block;
            margin: 20px 0;
            border: 0;
            -ms-interpolation-mode: bicubic;
            vertical-align: middle;
        }
        .rich_media_meta_list {
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 1px solid #eee;
            font-size: 14px;
            color: #576b95;
            line-height: 1.6;
        }
        .rich_media_meta { display: inline-block; vertical-align: middle; margin-right: 8px; }
        .rich_media_meta_nickname { margin-right: 12px; }
        .rich_media_meta_nickname a { color: #576b95; text-decoration: none; }
        .rich_media_meta_text { color: #888; font-style: normal; }
        .rich_media_meta.appmsg_title_tag {
            background-color: #07c160;
            color: #fff;
            padding: 2px 6px;
            border-radius: 2px;
            font-size: 12px;
            margin-right: 8px;
        }
        .meta {
            color: #576b95;
            font-size: 14px;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 1px solid #eee;
        }
        .source {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #eee;
            font-size: 14px;
            color: #999;
        }
        ul, ol { margin: 16px 0; padding-left: 24px; }
        li { margin-bottom: 8px; }
        a { color: #0366d6; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .content { min-height: 100px; }
        .content * { max-width: 100%; }
    </style>
</head>
<body>
    <h1>${meta.title}</h1>
    <div id="meta_content" class="rich_media_meta_list">
        ${meta.isOriginal ? `<span class="rich_media_meta appmsg_title_tag">${meta.isOriginal}</span>` : ''}
        ${meta.articleAuthor ? `<span class="rich_media_meta rich_media_meta_text">${meta.articleAuthor}</span>` : ''}
        <span class="rich_media_meta rich_media_meta_nickname" id="profileBt">
            <a href="javascript:void(0);" id="js_name">${meta.wechatName}</a>
        </span>
        <span id="meta_content_hide_info">
            <em id="publish_time" class="rich_media_meta rich_media_meta_text">${meta.date}</em>
            ${meta.location ? `<em id="js_ip_wording_wrp" class="rich_media_meta rich_media_meta_text" style="display: inline-block;" aria-label="${meta.location}"><span aria-hidden="true" id="js_ip_wording">${meta.location}</span></em>` : ''}
        </span>
    </div>
    <div class="meta" style="display: none;">${metaLine}</div>
    <div class="content">
        ${content}
    </div>
    <div class="source">
        <p>原文链接: <a href="${url}" target="_blank">${url}</a></p>
        <p>保存时间: ${new Date().toLocaleString('zh-CN')}</p>
    </div>
</body>
</html>`;
  }

  /**
   * MD5 哈希
   */
  private md5Hash(data: string): string {
    // 简单实现，实际使用 crypto 模块
    const crypto = require('crypto');
    return crypto.createHash('md5').update(data).digest('hex');
  }
}
