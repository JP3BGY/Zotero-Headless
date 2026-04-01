import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import AdmZip from 'adm-zip';
import { getDatabase, attachments } from '@zotero-headless/database';
import { eq, and } from 'drizzle-orm';
import { attachmentManager } from '@zotero-headless/attachment-manager';
import type { ExtractedContent, ExtractionOptions, RenderedPage, RenderOptions, AnnotationRegion, RenderedAnnotation } from './types.js';
import { EXTENSION_TO_MIME, SUPPORTED_MIME_TYPES } from './types.js';
import { getCachedContent, setCachedContent } from './cache.js';

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

/**
 * Detect if a file is a ZIP archive by checking magic bytes.
 */
function isZipFile(filePath: string): boolean {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(4);
  fs.readSync(fd, buf, 0, 4, 0);
  fs.closeSync(fd);
  return buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

/**
 * Extract the first real file from a ZIP archive to a temp directory.
 * Returns the path to the extracted file.
 */
function extractFromZip(zipPath: string): string {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries().filter(e => !e.isDirectory && !e.entryName.startsWith('__MACOSX'));

  if (entries.length === 0) {
    throw new Error('ZIP archive is empty');
  }

  const entry = entries[0];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zotero-extract-'));
  const extractedPath = path.join(tmpDir, entry.entryName);

  // Ensure parent directory exists
  const parentDir = path.dirname(extractedPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  fs.writeFileSync(extractedPath, entry.getData());
  return extractedPath;
}

/**
 * Compute MD5 hash of a file.
 */
function fileMd5(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Determine MIME type from the attachment record or file extension.
 */
function resolveMimeType(contentType: string | null | undefined, filePath: string): string | null {
  if (contentType && SUPPORTED_MIME_TYPES.has(contentType)) {
    return contentType;
  }
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_TO_MIME[ext] ?? null;
}

export class ContentExtractor {
  /**
   * Resolve an attachment key to a local file path.
   * Downloads from WebDAV if needed, extracts from ZIP if needed.
   * Returns the resolved path and a cleanup function for temp files.
   */
  private async resolveFile(attachmentKey: string): Promise<{
    attachment: any;
    filePath: string;
    cleanup: () => void;
  }> {
    const db = getDatabase();

    const attachment = (db as any)
      .select()
      .from(attachments)
      .where(eq(attachments.key, attachmentKey))
      .get();

    if (!attachment) {
      throw new Error(`Attachment not found: ${attachmentKey}`);
    }

    let filePath = attachment.path as string | null;

    if (!filePath || !fs.existsSync(filePath)) {
      if (attachment.webdavPath) {
        const result = await attachmentManager.downloadFromWebDAV(attachmentKey);
        if (!result.success || !result.localPath) {
          throw new Error(`File not available locally and WebDAV download failed: ${result.error}`);
        }
        filePath = result.localPath;
      } else {
        throw new Error(`No local file or WebDAV path for attachment ${attachmentKey}`);
      }
    }

    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(`File too large (${Math.round(stat.size / 1024 / 1024)}MB). Maximum is ${MAX_FILE_SIZE / 1024 / 1024}MB.`);
    }

    let actualFilePath = filePath;
    let tmpDir: string | null = null;

    if (isZipFile(filePath)) {
      actualFilePath = extractFromZip(filePath);
      tmpDir = path.dirname(actualFilePath);
    }

    const cleanup = () => {
      if (tmpDir) {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    };

    return { attachment, filePath: actualFilePath, cleanup };
  }

  /**
   * Extract text/markdown content from an attachment.
   */
  async extract(attachmentKey: string, options?: ExtractionOptions): Promise<ExtractedContent> {
    const { attachment, filePath, cleanup } = await this.resolveFile(attachmentKey);

    try {
      const md5 = fileMd5(filePath);
      const libraryId = attachment.libraryId as number;

      if (!options?.noCache) {
        const cached = getCachedContent(attachmentKey, libraryId, md5);
        if (cached) {
          let text = cached.content;
          if (options?.maxLength && text.length > options.maxLength) {
            text = text.slice(0, options.maxLength);
          }
          return {
            text,
            format: cached.format as 'markdown' | 'text',
          };
        }
      }

      const mimeType = resolveMimeType(attachment.contentType, filePath);
      if (!mimeType) {
        throw new Error(
          `Unsupported file format: ${attachment.contentType || path.extname(filePath)}`,
        );
      }

      const result = await this.dispatchExtractor(mimeType, filePath, options);

      setCachedContent({
        attachmentKey,
        libraryId,
        fileMd5: md5,
        content: result.text,
        format: result.format,
        extractedAt: Math.floor(Date.now() / 1000),
      });

      return result;
    } finally {
      cleanup();
    }
  }

  /**
   * Render attachment pages as images (PNG/JPEG).
   * Currently supports PDF files only.
   */
  async renderPages(attachmentKey: string, options?: RenderOptions): Promise<RenderedPage[]> {
    const { attachment, filePath, cleanup } = await this.resolveFile(attachmentKey);

    try {
      const mimeType = resolveMimeType(attachment.contentType, filePath);

      if (mimeType !== 'application/pdf') {
        throw new Error(
          `Page rendering is only supported for PDF files, got: ${mimeType || 'unknown'}`,
        );
      }

      const { renderPdfPages } = await import('./extractors/pdf-render.js');
      return await renderPdfPages(filePath, options);
    } finally {
      cleanup();
    }
  }

  /**
   * Render an annotation region from a PDF attachment.
   * Takes the annotationPosition data (pageIndex + rects) and crops
   * the corresponding area from the rendered PDF page.
   */
  async renderAnnotationRegion(
    attachmentKey: string,
    region: AnnotationRegion,
    options?: { scale?: number; imageFormat?: 'png' | 'jpeg'; quality?: number },
  ): Promise<RenderedAnnotation> {
    const { attachment, filePath, cleanup } = await this.resolveFile(attachmentKey);

    try {
      const mimeType = resolveMimeType(attachment.contentType, filePath);
      if (mimeType !== 'application/pdf') {
        throw new Error(
          `Annotation region rendering is only supported for PDF files, got: ${mimeType || 'unknown'}`,
        );
      }

      const { renderAnnotationRegion } = await import('./extractors/pdf-render.js');
      return await renderAnnotationRegion(filePath, region, options);
    } finally {
      cleanup();
    }
  }

  private async dispatchExtractor(
    mimeType: string,
    filePath: string,
    options?: ExtractionOptions,
  ): Promise<ExtractedContent> {
    switch (mimeType) {
      case 'application/pdf': {
        const { extractPdf } = await import('./extractors/pdf.js');
        return extractPdf(filePath, options);
      }
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
        const { extractDocx } = await import('./extractors/docx.js');
        return extractDocx(filePath, options);
      }
      case 'application/msword': {
        const { extractDoc } = await import('./extractors/doc.js');
        return extractDoc(filePath, options);
      }
      case 'application/epub+zip': {
        const { extractEpub } = await import('./extractors/epub.js');
        return extractEpub(filePath, options);
      }
      case 'text/html': {
        const { extractHtml } = await import('./extractors/html.js');
        return extractHtml(filePath, options);
      }
      default:
        throw new Error(`No extractor available for MIME type: ${mimeType}`);
    }
  }
}
