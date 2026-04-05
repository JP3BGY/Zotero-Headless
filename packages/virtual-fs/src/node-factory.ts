/**
 * Node Factory
 *
 * Converts database rows into virtual filesystem content.
 * Handles rendering metadata.json, abstract.txt, notes, annotations, etc.
 */

import { parseItemData } from '@zotero-headless/types';
import type { FsStat } from 'just-bash';

/** Directory entry with type information (mirrors just-bash DirentEntry) */
export interface DirentEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

const DIR_MODE = 0o755;
const FILE_MODE = 0o644;
const DEFAULT_DATE = new Date(0);

// ============ Stat Helpers ============

export function dirStat(mtime?: Date, size?: number): FsStat {
  return {
    isFile: false,
    isDirectory: true,
    isSymbolicLink: false,
    mode: DIR_MODE,
    size: size ?? 0,
    mtime: mtime ?? DEFAULT_DATE,
  };
}

export function fileStat(size: number, mtime?: Date): FsStat {
  return {
    isFile: true,
    isDirectory: false,
    isSymbolicLink: false,
    mode: FILE_MODE,
    size,
    mtime: mtime ?? DEFAULT_DATE,
  };
}

export function direntDir(name: string): DirentEntry {
  return { name, isFile: false, isDirectory: true, isSymbolicLink: false };
}

export function direntFile(name: string): DirentEntry {
  return { name, isFile: true, isDirectory: false, isSymbolicLink: false };
}

// ============ Date Helpers ============

/** Convert a Unix timestamp (seconds) to a Date object */
function tsToDate(ts: number | null | undefined): Date {
  if (!ts) return DEFAULT_DATE;
  return new Date(ts * 1000);
}

// ============ Content Rendering ============

/**
 * Render metadata.json content for an item.
 */
export function renderMetadataJson(item: any): string {
  const data = parseItemData(item.rawJson);

  const metadata: Record<string, unknown> = {
    key: item.key,
    itemType: item.itemType,
    title: item.title,
  };

  // Add creators
  if (data.creators && data.creators.length > 0) {
    metadata.creators = data.creators.map(c => {
      if (c.name) return { name: c.name, creatorType: c.creatorType };
      return { firstName: c.firstName, lastName: c.lastName, creatorType: c.creatorType };
    });
  }

  // Add common fields if present
  if (data.date) metadata.date = data.date;
  if (data.abstractNote) metadata.abstract = data.abstractNote;
  if (data.DOI) metadata.doi = data.DOI;
  if (data.url) metadata.url = data.url;
  if (data.ISBN) metadata.isbn = data.ISBN;
  if (data.ISSN) metadata.issn = data.ISSN;
  if (data.publicationTitle) metadata.journal = data.publicationTitle;
  if (data.publisher) metadata.publisher = data.publisher;
  if (data.volume) metadata.volume = data.volume;
  if (data.issue) metadata.issue = data.issue;
  if (data.pages) metadata.pages = data.pages;
  if (data.language) metadata.language = data.language;

  // Tags
  if (data.tags && data.tags.length > 0) {
    metadata.tags = data.tags.map(t => typeof t === 'string' ? t : t.tag);
  }

  // Collections
  if (data.collections && data.collections.length > 0) {
    metadata.collections = data.collections;
  }

  // Extra fields
  if (data.extra) metadata.extra = data.extra;

  return JSON.stringify(metadata, null, 2) + '\n';
}

/**
 * Render abstract.txt content for an item.
 */
export function renderAbstract(item: any): string {
  const data = parseItemData(item.rawJson);
  return (data.abstractNote ?? item.abstract ?? '') + '\n';
}

/**
 * Render note content as Markdown (strip HTML).
 */
export function renderNote(noteItem: any): string {
  const data = parseItemData(noteItem.rawJson);
  const html = data.note ?? '';
  // Simple HTML stripping (turndown would be better, but avoid the dependency for now)
  return stripHtml(html) + '\n';
}

/**
 * Render annotation content as text.
 */
export function renderAnnotation(annotationItem: any): string {
  const data = parseItemData(annotationItem.rawJson);
  const parts: string[] = [];

  if (data.annotationType) {
    parts.push(`[${data.annotationType}]`);
  }
  if (data.annotationPageLabel) {
    parts.push(`Page: ${data.annotationPageLabel}`);
  }
  if (data.annotationText) {
    parts.push('');
    parts.push(data.annotationText);
  }
  if (data.annotationComment) {
    parts.push('');
    parts.push(`Comment: ${data.annotationComment}`);
  }
  if (data.annotationColor) {
    parts.push('');
    parts.push(`Color: ${data.annotationColor}`);
  }

  return parts.join('\n') + '\n';
}

/**
 * Get stat for an item directory.
 */
export function itemDirStat(item: any): FsStat {
  return dirStat(tsToDate(item.updatedAt));
}

/**
 * Get stat for an item's metadata.json file.
 */
export function metadataFileStat(item: any): FsStat {
  const content = renderMetadataJson(item);
  return fileStat(Buffer.byteLength(content, 'utf-8'), tsToDate(item.updatedAt));
}

/**
 * Get stat for an item's abstract.txt file.
 */
export function abstractFileStat(item: any): FsStat {
  const content = renderAbstract(item);
  return fileStat(Buffer.byteLength(content, 'utf-8'), tsToDate(item.updatedAt));
}

// ============ Simple HTML Stripping ============

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
