// Full Text Finder: discovers and downloads PDF/EPUB files for items
// Adapted from Zotero Desktop attachments.js addAvailableFiles/downloadFirstAvailableFile
// Headless-compatible: no browser engine, no DOM parsing, no CAPTCHA bypass

import { getDatabase, attachments, items, libraries } from '@zotero-headless/database';
import { parseItemData } from '@zotero-headless/types';
import { eq, and, or, notInArray, isNotNull } from 'drizzle-orm';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';

import { DomainRateLimiter } from './domain-rate-limiter.js';
import { sniffMimeType, isAllowedFileType, getExtensionForMimeType } from './file-validator.js';
import { buildResolvers, canFindFileForItem } from './resolvers/index.js';
import type { UrlResolverEntry, Resolver, FindResult, FullTextFinderOptions } from './resolvers/types.js';

const USER_AGENT = 'Mozilla/5.0 (compatible; zotero-headless/1.0)';
const MAX_REDIRECTS = 10;
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const DOWNLOAD_TIMEOUT = 30000; // 30s

// Zotero key generation (same as apps/cli/src/utils.ts)
const ALLOWED_KEY_CHARS = '23456789ABCDEFGHIJKLMNPQRSTUVWXYZ';
function generateKey(): string {
  return Array.from({ length: 8 }, () =>
    ALLOWED_KEY_CHARS.charAt(Math.floor(Math.random() * ALLOWED_KEY_CHARS.length))
  ).join('');
}

interface DownloadResult {
  url: string;
  mimeType: string;
  accessMethod: string;
  articleVersion?: string;
}

export interface BatchFindResult {
  found: number;
  failed: number;
  skipped: number;
  results: FindResult[];
}

export class FullTextFinder {
  private db: ReturnType<typeof getDatabase>;
  private rateLimiter: DomainRateLimiter;
  private storageDir: string;

  constructor(options?: { storageDir?: string; sameDomainRequestDelay?: number; maxConsecutiveDomainFailures?: number }) {
    this.db = getDatabase();
    this.rateLimiter = new DomainRateLimiter(
      options?.sameDomainRequestDelay ?? 1000,
      options?.maxConsecutiveDomainFailures ?? 5,
    );
    this.storageDir = options?.storageDir
      ?? path.join(os.homedir(), '.local', 'share', 'zotero-headless', 'attachments');
  }

  /**
   * Get items eligible for full text finding in a library.
   * Finds regular items with DOI/URL that don't already have PDF/EPUB attachments.
   */
  async getEligibleItems(libraryId: number, limit?: number): Promise<any[]> {
    // Get all non-deleted regular items with DOI or URL
    const candidateItems = await this.db.select()
      .from(items)
      .where(and(
        eq(items.libraryId, libraryId),
        eq(items.deleted, false),
        notInArray(items.itemType, ['attachment', 'note', 'annotation']),
        or(isNotNull(items.doi), isNotNull(items.url)),
      ))
      .all();

    // Get all non-deleted PDF/EPUB attachments
    const existingAttachments = await this.db.select({
      parentItemKey: attachments.parentItemKey,
      contentType: attachments.contentType,
    })
      .from(attachments)
      .where(and(
        eq(attachments.libraryId, libraryId),
        eq(attachments.deleted, false),
      ))
      .all();

    // Build set of parent keys that already have full-text attachments
    const parentKeysWithFullText = new Set<string>();
    for (const att of existingAttachments) {
      if (att.contentType === 'application/pdf' || att.contentType === 'application/epub+zip') {
        parentKeysWithFullText.add(att.parentItemKey);
      }
    }

    // Filter to eligible items
    const eligible = candidateItems.filter(item =>
      !parentKeysWithFullText.has(item.key)
      && canFindFileForItem(
        { itemType: item.itemType, doi: item.doi, url: item.url },
        [],
      )
    );

    return limit ? eligible.slice(0, limit) : eligible;
  }

  /**
   * Find and download full text for multiple items (batch).
   */
  async findForItems(
    itemRecords: any[],
    options: FullTextFinderOptions = {},
  ): Promise<BatchFindResult> {
    const results: FindResult[] = [];
    let found = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < itemRecords.length; i++) {
      const item = itemRecords[i];
      const title = item.title || item.key;

      options.onProgress?.(i + 1, itemRecords.length, title);

      const result = await this.findForItem(item, options);
      results.push(result);
      options.onItemResult?.(item.key, result);

      if (result.success) {
        found++;
      } else if (result.error === 'skipped') {
        skipped++;
      } else {
        failed++;
      }
    }

    return { found, failed, skipped, results };
  }

  /**
   * Find and download full text for a single item.
   */
  async findForItem(
    item: any,
    options: FullTextFinderOptions = {},
  ): Promise<FindResult> {
    const itemKey = item.key;

    try {
      // Build resolvers for this item
      const resolvers = buildResolvers(
        { doi: item.doi, url: item.url },
        {
          methods: options.methods,
          customResolvers: options.customResolvers,
        },
      );

      if (resolvers.length === 0) {
        return { success: false, itemKey, error: 'No resolvers available (missing DOI/URL)' };
      }

      if (options.dryRun) {
        const methods = resolvers.map(r => {
          if (typeof r === 'function') return 'async';
          return r[0]?.accessMethod || 'unknown';
        });
        return { success: false, itemKey, error: 'skipped', accessMethod: methods.join(',') };
      }

      // Create temp directory for download
      const tmpDir = path.join(os.tmpdir(), `zotero-ft-${generateKey()}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      const tmpFile = path.join(tmpDir, 'download.tmp');

      try {
        const downloadResult = await this.downloadFirstAvailableFile(resolvers, tmpFile);

        if (!downloadResult) {
          return { success: false, itemKey, error: 'No full text found from any resolver' };
        }

        // Generate final filename and move to storage
        const ext = getExtensionForMimeType(downloadResult.mimeType);
        const filename = this.generateFilename(item, ext);
        const finalPath = path.join(this.storageDir, filename);

        if (!fs.existsSync(this.storageDir)) {
          fs.mkdirSync(this.storageDir, { recursive: true });
        }

        fs.copyFileSync(tmpFile, finalPath);
        const stats = fs.statSync(finalPath);

        // Create attachment record
        const attKey = await this.createAttachmentRecord(
          item,
          finalPath,
          filename,
          downloadResult.url,
          downloadResult.mimeType,
          stats.size,
          downloadResult.articleVersion,
        );

        return {
          success: true,
          itemKey,
          attachmentKey: attKey,
          filename,
          url: downloadResult.url,
          accessMethod: downloadResult.accessMethod,
          mimeType: downloadResult.mimeType,
          fileSize: stats.size,
        };
      } finally {
        // Clean up temp directory
        try {
          if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
          if (fs.existsSync(tmpDir)) fs.rmdirSync(tmpDir);
        } catch { /* ignore cleanup errors */ }
      }
    } catch (error: any) {
      return { success: false, itemKey, error: error.message };
    }
  }

  /**
   * Core download loop: try resolvers in order, download first successful file.
   * Adapted from Zotero Desktop downloadFirstAvailableFile (line 1955).
   */
  private async downloadFirstAvailableFile(
    resolvers: Resolver[],
    destPath: string,
  ): Promise<DownloadResult | null> {
    const triedURLs = new Set<string>();

    for (const resolver of resolvers) {
      // Resolve lazy resolvers
      let entries: UrlResolverEntry[];
      if (typeof resolver === 'function') {
        try {
          entries = await resolver();
        } catch {
          continue;
        }
      } else {
        entries = resolver;
      }

      for (const entry of entries) {
        // Try direct URL first
        if (entry.url) {
          const normalizedUrl = this.normalizeURL(entry.url);
          if (triedURLs.has(normalizedUrl)) continue;
          triedURLs.add(normalizedUrl);

          try {
            await this.downloadFile(entry.url, destPath, { referrer: entry.referrer });
            return {
              url: entry.url,
              mimeType: sniffMimeType(fs.readFileSync(destPath)) || 'application/pdf',
              accessMethod: entry.accessMethod,
              articleVersion: entry.articleVersion,
            };
          } catch {
            // Direct URL failed, continue
          }
        }

        // Try pageURL (follow redirects, check Content-Type)
        if (entry.pageURL) {
          const normalizedPage = this.normalizeURL(entry.pageURL);
          if (triedURLs.has(normalizedPage)) continue;
          triedURLs.add(normalizedPage);

          try {
            const resolved = await this.resolvePageURL(entry.pageURL, triedURLs);
            if (resolved) {
              await this.downloadFile(resolved.url, destPath, { referrer: entry.pageURL });
              return {
                url: resolved.url,
                mimeType: resolved.mimeType,
                accessMethod: entry.accessMethod,
                articleVersion: entry.articleVersion,
              };
            }
          } catch {
            // Page resolution failed, continue
          }
        }
      }
    }

    return null;
  }

  /**
   * Download a file from a URL with rate limiting and file type validation.
   */
  private async downloadFile(
    url: string,
    destPath: string,
    options?: { referrer?: string },
  ): Promise<void> {
    await this.rateLimiter.waitForDomain(url);

    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      'Accept': 'application/pdf,application/epub+zip,*/*',
    };
    if (options?.referrer) {
      headers['Referer'] = options.referrer;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT);

    try {
      const response = await fetch(url, {
        headers,
        redirect: 'follow',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        this.rateLimiter.recordFailure(url);

        // Handle Retry-After on 429/503
        if (response.status === 429 || response.status === 503) {
          const retryAfter = response.headers.get('Retry-After');
          if (retryAfter) {
            this.rateLimiter.handleRetryAfter(url, retryAfter);
          }
        }

        throw new Error(`HTTP ${response.status} from ${url}`);
      }

      // Check Content-Length before downloading
      const contentLength = response.headers.get('Content-Length');
      if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE) {
        throw new Error(`File too large: ${contentLength} bytes`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      if (!isAllowedFileType(buffer)) {
        this.rateLimiter.recordFailure(url);
        throw new Error('Downloaded file is not a supported type (PDF/EPUB)');
      }

      fs.writeFileSync(destPath, buffer);
      this.rateLimiter.recordSuccess(url);
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Follow redirects for a pageURL, checking Content-Type at each hop for PDF/EPUB.
   * In headless mode we cannot parse HTML pages, but we can detect:
   * - Direct PDF/EPUB responses (by Content-Type header)
   * - HTTP redirects (301/302/303/307/308)
   * - Meta refresh redirects (via regex on HTML body)
   */
  private async resolvePageURL(
    pageURL: string,
    triedURLs: Set<string>,
  ): Promise<{ url: string; mimeType: string } | null> {
    let currentURL = pageURL;

    for (let i = 0; i < MAX_REDIRECTS; i++) {
      const normalized = this.normalizeURL(currentURL);
      if (triedURLs.has(normalized) && i > 0) return null;
      triedURLs.add(normalized);

      await this.rateLimiter.waitForDomain(currentURL);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT);

      try {
        // Use redirect: 'manual' to inspect each redirect hop
        const response = await fetch(currentURL, {
          headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/pdf,application/epub+zip,*/*',
          },
          redirect: 'manual',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        // Follow HTTP redirects
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('Location');
          if (!location) return null;
          currentURL = new URL(location, currentURL).href;
          this.rateLimiter.recordSuccess(currentURL);
          continue;
        }

        if (!response.ok) {
          this.rateLimiter.recordFailure(currentURL);
          return null;
        }

        const contentType = (response.headers.get('Content-Type') || '').toLowerCase();

        // Direct PDF or EPUB response
        if (contentType.includes('application/pdf')) {
          this.rateLimiter.recordSuccess(currentURL);
          return { url: currentURL, mimeType: 'application/pdf' };
        }
        if (contentType.includes('application/epub+zip')) {
          this.rateLimiter.recordSuccess(currentURL);
          return { url: currentURL, mimeType: 'application/epub+zip' };
        }

        // For HTML responses, check for meta refresh redirect
        if (contentType.includes('text/html')) {
          const text = await response.text();
          const metaRefreshMatch = text.match(
            /<meta[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["']?\d+;\s*url=([^"'\s>]+)/i
          );
          if (metaRefreshMatch) {
            currentURL = new URL(metaRefreshMatch[1], currentURL).href;
            this.rateLimiter.recordSuccess(currentURL);
            continue;
          }

          // Check for PDF link in Link header
          const linkHeader = response.headers.get('Link');
          if (linkHeader) {
            const pdfLinkMatch = linkHeader.match(/<([^>]+)>;\s*rel="alternate";\s*type="application\/pdf"/);
            if (pdfLinkMatch) {
              this.rateLimiter.recordSuccess(currentURL);
              return { url: new URL(pdfLinkMatch[1], currentURL).href, mimeType: 'application/pdf' };
            }
          }
        }

        // Cannot extract PDF from this page in headless mode
        this.rateLimiter.recordSuccess(currentURL);
        return null;
      } catch {
        clearTimeout(timeoutId);
        return null;
      }
    }

    return null; // max redirects exceeded
  }

  /**
   * Create attachment record in local database.
   * Inserts into both `items` and `attachments` tables.
   */
  private async createAttachmentRecord(
    parentItem: any,
    filePath: string,
    filename: string,
    sourceUrl: string,
    mimeType: string,
    fileSize: number,
    articleVersion?: string,
  ): Promise<string> {
    const attKey = generateKey();
    const now = Math.floor(Date.now() / 1000);
    const accessDate = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    // Determine title based on article version
    let title: string;
    if (articleVersion === 'acceptedVersion' || articleVersion === 'accepted') {
      title = 'Accepted Version';
    } else if (articleVersion === 'submittedVersion' || articleVersion === 'submitted') {
      title = 'Submitted Version';
    } else {
      title = 'Full Text';
    }

    // Compute MD5 hash
    const fileBuffer = fs.readFileSync(filePath);
    const md5 = crypto.createHash('md5').update(fileBuffer).digest('hex');

    const attRawJson = {
      data: {
        key: attKey,
        itemType: 'attachment',
        title,
        filename,
        contentType: mimeType,
        charset: '',
        parentItem: parentItem.key,
        linkMode: 'imported_url',
        url: sourceUrl,
        accessDate,
      },
    };

    // Insert into items table (attachment items are also items in Zotero)
    await this.db.insert(items).values({
      key: attKey,
      libraryId: parentItem.libraryId,
      version: 0,
      synced: false,
      deleted: false,
      createdAt: now,
      updatedAt: now,
      itemType: 'attachment',
      title,
      url: sourceUrl,
      rawJson: JSON.stringify(attRawJson),
    }).run();

    // Insert into attachments table
    await this.db.insert(attachments).values({
      key: attKey,
      parentItemKey: parentItem.key,
      libraryId: parentItem.libraryId,
      filename,
      contentType: mimeType,
      fileType: path.extname(filename).toLowerCase(),
      path: filePath,
      url: sourceUrl,
      version: 0,
      createdAt: now,
      updatedAt: now,
      deleted: false,
      size: fileSize,
      md5,
      webdavSynced: false,
      rawJson: JSON.stringify(attRawJson),
    }).run();

    return attKey;
  }

  /**
   * Generate a filename for a downloaded file based on item metadata.
   * Format: {FirstAuthor}_{Year}_{TruncatedTitle}.{ext}
   */
  private generateFilename(item: any, ext: string): string {
    const parts: string[] = [];

    // First author last name
    try {
      const creators = typeof item.creators === 'string'
        ? JSON.parse(item.creators)
        : item.creators;
      if (Array.isArray(creators) && creators.length > 0) {
        const first = creators[0];
        const name = first.lastName || first.name || '';
        if (name) parts.push(this.sanitizeFilename(name));
      }
    } catch { /* no creators */ }

    // Year from publication date
    if (item.publicationDate) {
      const yearMatch = String(item.publicationDate).match(/\d{4}/);
      if (yearMatch) parts.push(yearMatch[0]);
    }

    // Truncated title
    if (item.title) {
      const truncated = item.title.substring(0, 50).trim();
      parts.push(this.sanitizeFilename(truncated));
    }

    if (parts.length === 0) {
      parts.push(item.key);
    }

    const basename = parts.join('_');
    return `${basename}${ext}`;
  }

  /**
   * Sanitize a string for use in filenames.
   */
  private sanitizeFilename(str: string): string {
    return str
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 60);
  }

  /**
   * Normalize a URL for deduplication (remove most query params).
   */
  private normalizeURL(url: string): string {
    try {
      const parsed = new URL(url);
      // Keep only 'download' param (for Atypon), remove the rest
      const download = parsed.searchParams.get('download');
      parsed.search = '';
      if (download) parsed.searchParams.set('download', download);
      return parsed.href;
    } catch {
      return url;
    }
  }
}
