// @ts-nocheck

import { and, eq } from 'drizzle-orm';
import { parseItemData } from '@zotero-headless/types';

/**
 * 格式化日期显示
 * 数据库统一使用秒级 Unix 时间戳
 */
export function formatDate(dateValue: any): string {
  if (!dateValue) return 'Unknown';

  try {
    let timestamp: number;

    // 如果是 Date 对象（Drizzle 转换后的）
    if (dateValue instanceof Date) {
      if (isNaN(dateValue.getTime())) {
        return 'Invalid date';
      }
      return dateValue.toISOString().split('T')[0];
    }

    // 如果是数字（应该是秒级时间戳）
    if (typeof dateValue === 'number') {
      timestamp = dateValue * 1000;  // 秒 -> 毫秒
    } else {
      // 尝试解析字符串
      const date = new Date(dateValue);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
      return 'Invalid date';
    }

    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      return 'Invalid date';
    }
    return date.toISOString().split('T')[0];
  } catch {
    return 'Invalid date';
  }
}

/**
 * 格式化完整日期时间
 * 数据库统一使用秒级 Unix 时间戳
 */
export function formatDateTime(dateValue: any): string {
  if (!dateValue) return 'Unknown';

  try {
    let timestamp: number;

    if (dateValue instanceof Date) {
      if (isNaN(dateValue.getTime())) {
        return 'Invalid date';
      }
      return dateValue.toISOString();
    }

    if (typeof dateValue === 'number') {
      timestamp = dateValue * 1000;  // 秒 -> 毫秒
    } else {
      const date = new Date(dateValue);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
      return 'Invalid date';
    }

    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      return 'Invalid date';
    }
    return date.toISOString();
  } catch {
    return 'Invalid date';
  }
}

/**
 * Generate a Zotero-compatible object key
 * Uses the same algorithm as Zotero Desktop:
 * - 8 characters from allowedKeyChars
 * - Excludes 0, 1, O to avoid visual confusion
 */
export function generateKey(): string {
  const allowedKeyChars = '23456789ABCDEFGHIJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 8 }, () =>
    allowedKeyChars.charAt(
      Math.floor(Math.random() * allowedKeyChars.length)
    )
  ).join('');
}

/**
 * Resolve a collection path (e.g. "/Genetics/Promotor") or key to a collection key.
 * Returns { key, name, path } or null if not found.
 */
export async function resolveCollectionPath(db: any, libraryId: number, pathOrKey: string): Promise<{ key: string; name: string; path: string } | null> {
  const { collections } = await import('@zotero-headless/database');
  const allCols = await db.select().from(collections)
    .where(and(eq(collections.libraryId, libraryId), eq(collections.deleted, false)))
    .all();

  // Build a lookup map by key
  const byKey = new Map<string, any>();
  for (const col of allCols) byKey.set(col.key, col);

  // Helper: build full path for a collection
  const buildPath = (col: any): string => {
    const parts: string[] = [col.name];
    let current = col;
    while (current.parentKey && byKey.has(current.parentKey)) {
      current = byKey.get(current.parentKey);
      parts.unshift(current.name);
    }
    return '/' + parts.join('/');
  };

  // If it doesn't start with '/', try as collection key first, then match by name
  if (!pathOrKey.startsWith('/')) {
    const col = byKey.get(pathOrKey);
    if (col) return { key: col.key, name: col.name, path: buildPath(col) };

    // Try exact name match
    const byName = allCols.filter(c => c.name === pathOrKey);
    if (byName.length === 1) return { key: byName[0].key, name: byName[0].name, path: buildPath(byName[0]) };

    // Try case-insensitive name match
    const needle = pathOrKey.toLowerCase();
    const byNameCI = allCols.filter(c => c.name.toLowerCase() === needle);
    if (byNameCI.length === 1) return { key: byNameCI[0].key, name: byNameCI[0].name, path: buildPath(byNameCI[0]) };

    // Multiple matches — return null with disambiguation handled by caller
    if (byName.length > 1 || byNameCI.length > 1) {
      // Store matches for the caller to display
      const matches = byName.length > 1 ? byName : byNameCI;
      const result: any = null;
      // We can't return multiple, so return null and let caller handle
      // But we can attach matches to a global for the caller
      (resolveCollectionPath as any)._ambiguousMatches = matches.map((c: any) => ({
        key: c.key, name: c.name, path: buildPath(c),
      }));
      return null;
    }

    return null;
  }

  // Resolve by path: split and walk the tree
  const segments = pathOrKey.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  let current: any = null;
  for (const segment of segments) {
    const parentKey = current ? current.key : null;
    const match = allCols.find(c =>
      c.name === segment && (c.parentKey ?? null) === parentKey
    );
    if (!match) return null;
    current = match;
  }

  return { key: current.key, name: current.name, path: buildPath(current) };
}

/**
 * Get MIME content type from filename
 */
export function getContentType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || '';
  const mimeTypes: Record<string, string> = {
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'txt': 'text/plain',
    'rtf': 'application/rtf',
    'html': 'text/html',
    'htm': 'text/html',
    'epub': 'application/epub+zip',
    'mobi': 'application/x-mobipocket-ebook',
    'zip': 'application/zip',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'mp4': 'video/mp4',
    'mp3': 'audio/mpeg',
    'json': 'application/json',
    'xml': 'application/xml',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Get a meaningful display title for any item type.
 * - Annotations: show annotationText or annotationComment content
 * - Notes: show first line of note content (stripped of HTML)
 * - Others: use item.title as-is
 *
 * @param item must have at least { title, itemType, rawJson }
 * @param maxLen max characters for the display string
 */
export function displayTitle(item: { title?: string | null; itemType?: string; rawJson?: string }, maxLen = 60): string {
  // If title is already set and meaningful, use it
  if (item.title && item.title.trim()) {
    return item.title.substring(0, maxLen);
  }

  // For annotations: extract annotation text/comment from rawJson
  if (item.itemType === 'annotation' && item.rawJson) {
    const data = parseItemData(item.rawJson);
    const text = (data.annotationText || data.annotationComment || '').replace(/\n/g, ' ').trim();
    if (text) return text.substring(0, maxLen);
    return `(empty ${data.annotationType || 'annotation'})`;
  }

  // For notes: extract first line of note HTML content from rawJson
  if (item.itemType === 'note' && item.rawJson) {
    const data = parseItemData(item.rawJson);
    const html = data.note || '';
    // Strip HTML tags and get first meaningful line
    const plain = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    if (plain) return plain.substring(0, maxLen);
    return '(empty note)';
  }

  return '(no title)';
}
