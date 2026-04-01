/**
 * Content Extractor Types
 */

export interface ExtractedContent {
  text: string;
  format: 'markdown' | 'text';
  metadata?: {
    pageCount?: number;
    title?: string;
    author?: string;
  };
}

export interface ExtractionOptions {
  /** Preferred output format */
  format?: 'markdown' | 'text';
  /** Max characters to extract (0 = unlimited) */
  maxLength?: number;
  /** Force re-extraction, bypassing cache */
  noCache?: boolean;
}

export interface RenderOptions {
  /** Scale factor for rendering (default: 2 for ~144 DPI) */
  scale?: number;
  /** Specific pages to render (1-indexed). If omitted, renders all pages. */
  pages?: number[];
  /** Output image format (default: 'png') */
  imageFormat?: 'png' | 'jpeg';
  /** JPEG quality 1-100 (default: 85, only used for jpeg) */
  quality?: number;
}

export interface RenderedPage {
  /** 1-indexed page number */
  pageNumber: number;
  width: number;
  height: number;
  imageFormat: 'png' | 'jpeg';
  /** Raw image data (PNG or JPEG) */
  data: Buffer;
}

export interface AnnotationRegion {
  /** 0-indexed page number */
  pageIndex: number;
  /** PDF coordinate rect: [left, bottom, right, top] */
  rects: number[][];
  /** Annotation area width in PDF points (for image annotations) */
  width?: number;
  /** Annotation area height in PDF points (for image annotations) */
  height?: number;
}

export interface RenderedAnnotation {
  width: number;
  height: number;
  imageFormat: 'png' | 'jpeg';
  data: Buffer;
}

export type SupportedMimeType =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'application/msword'
  | 'application/epub+zip'
  | 'text/html';

export const SUPPORTED_MIME_TYPES: Set<string> = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/epub+zip',
  'text/html',
]);

export const MIME_TO_EXTENSION: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/msword': '.doc',
  'application/epub+zip': '.epub',
  'text/html': '.html',
};

export const EXTENSION_TO_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.epub': 'application/epub+zip',
  '.html': 'text/html',
  '.htm': 'text/html',
};
