/**
 * 附件内容 API
 *
 * 提供读取附件文本/Markdown 内容的能力
 */

import { eq } from 'drizzle-orm';
import type {
  AttachmentContent,
  GetAttachmentContentOptions,
  AttachmentInfo,
  RenderAttachmentPagesOptions,
  RenderedAttachmentPage,
} from './types.js';

const DEFAULT_CONTENT_LIMIT = 100_000; // ~25k tokens

// 延迟加载模块
let dbModule: any;
async function getDb() {
  if (!dbModule) {
    dbModule = await import('@zotero-headless/database');
  }
  return dbModule;
}

let extractorModule: any;
async function getExtractor() {
  if (!extractorModule) {
    extractorModule = await import('@zotero-headless/content-extractor');
  }
  return extractorModule;
}

/**
 * 获取附件的文本/Markdown 内容
 *
 * 支持 PDF、DOCX、DOC、EPUB、HTML 格式。
 * 结果会被缓存，后续调用直接返回缓存内容（除非文件 MD5 发生变化）。
 */
export async function getAttachmentContent(
  key: string,
  options?: GetAttachmentContentOptions,
): Promise<AttachmentContent> {
  const { getDatabase, attachments } = await getDb();
  const db = getDatabase();
  const { ContentExtractor } = await getExtractor();

  // Get attachment metadata
  const attachment = (db as any)
    .select()
    .from(attachments)
    .where(eq(attachments.key, key))
    .get();

  if (!attachment) {
    throw new Error(`Attachment not found: ${key}`);
  }

  // Extract content
  const extractor = new ContentExtractor();
  const result = await extractor.extract(key, {
    format: options?.format,
    noCache: options?.noCache,
  });

  // Apply pagination
  const fullContent = result.text;
  const totalLength = fullContent.length;
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? DEFAULT_CONTENT_LIMIT;

  const content = fullContent.slice(offset, offset + limit);
  const truncated = offset + limit < totalLength;

  return {
    key,
    filename: attachment.filename ?? '',
    contentType: attachment.contentType ?? '',
    format: result.format,
    content,
    totalLength,
    offset,
    limit,
    truncated,
    extractedAt: Math.floor(Date.now() / 1000),
    cached: !options?.noCache,
  };
}

/**
 * 渲染 PDF 附件的页面为图片
 *
 * 使用 PDFium (Chrome 的 PDF 引擎) 进行高质量渲染。
 * 返回 Base64 编码的图片数据，可直接用于视觉模型。
 */
export async function renderAttachmentPages(
  key: string,
  options?: RenderAttachmentPagesOptions,
): Promise<RenderedAttachmentPage[]> {
  const { ContentExtractor } = await getExtractor();

  const extractor = new ContentExtractor();
  const pages = await extractor.renderPages(key, {
    scale: options?.scale,
    pages: options?.pages,
    imageFormat: options?.imageFormat,
    quality: options?.quality,
  });

  return pages.map((page: any) => ({
    pageNumber: page.pageNumber,
    width: page.width,
    height: page.height,
    imageFormat: page.imageFormat,
    dataBase64: page.data.toString('base64'),
  }));
}

/**
 * 获取 image 类型注释的渲染图片
 *
 * 解析注释的 annotationPosition，定位到父 PDF 附件，
 * 使用 PDFium 渲染对应页面并裁剪出注释区域。
 * 返回 Base64 编码的 PNG/JPEG 图片。
 */
export async function getAnnotationImage(
  annotationKey: string,
  options?: { scale?: number; imageFormat?: 'png' | 'jpeg' },
): Promise<RenderedAttachmentPage> {
  const { getDatabase, items } = await getDb();
  const db = getDatabase();
  const { ContentExtractor } = await getExtractor();
  const { parseItemData } = await import('@zotero-headless/types');

  // 1. Find the annotation item
  const annotItem = (db as any)
    .select()
    .from(items)
    .where(eq(items.key, annotationKey))
    .get();

  if (!annotItem) {
    throw new Error(`Annotation not found: ${annotationKey}`);
  }

  const data = parseItemData(annotItem.rawJson);
  if (data.itemType !== 'annotation') {
    throw new Error(`Item ${annotationKey} is not an annotation (type: ${data.itemType})`);
  }

  // 2. Parse annotationPosition
  let position: any;
  if (data.annotationPosition) {
    try {
      position = typeof data.annotationPosition === 'string'
        ? JSON.parse(data.annotationPosition)
        : data.annotationPosition;
    } catch {
      throw new Error('Failed to parse annotationPosition');
    }
  }

  if (!position || !position.rects || position.rects.length === 0) {
    throw new Error('Annotation has no position data (rects) for rendering');
  }

  // 3. Find the parent attachment
  const parentKey = data.parentItem;
  if (!parentKey) {
    throw new Error('Annotation has no parentItem reference');
  }

  // 4. Render the annotation region
  const extractor = new ContentExtractor();
  const result = await extractor.renderAnnotationRegion(parentKey, {
    pageIndex: position.pageIndex ?? 0,
    rects: position.rects,
    width: position.width,
    height: position.height,
  }, {
    scale: options?.scale,
    imageFormat: options?.imageFormat,
  });

  return {
    pageNumber: (position.pageIndex ?? 0) + 1,
    width: result.width,
    height: result.height,
    imageFormat: result.imageFormat,
    dataBase64: result.data.toString('base64'),
  };
}

/**
 * 列出某个 item 的所有附件，或列出所有附件
 */
export async function listAttachments(itemKey?: string): Promise<AttachmentInfo[]> {
  const { getDatabase, attachments } = await getDb();
  const db = getDatabase();

  let rows: any[];
  if (itemKey) {
    rows = (db as any)
      .select()
      .from(attachments)
      .where(eq(attachments.parentItemKey, itemKey))
      .all();
  } else {
    rows = (db as any).select().from(attachments).all();
  }

  return rows.map((row: any) => ({
    key: row.key,
    parentItemKey: row.parentItemKey,
    filename: row.filename,
    contentType: row.contentType,
    url: row.url,
    localPath: row.path,
    webdavSynced: !!row.webdavSynced,
  }));
}
