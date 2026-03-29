// URL resolver: uses the item's URL field directly
// Reference: Zotero Desktop attachments.js:1298-1309

import type { UrlResolverEntry } from './types.js';

/**
 * Build resolver entries for direct URL resolution.
 * The item's URL field is used as a page URL to follow.
 */
export function resolveURL(url: string | null | undefined): UrlResolverEntry[] {
  if (!url) return [];

  const trimmed = url.trim();
  if (!trimmed || !trimmed.startsWith('http')) return [];

  return [{
    pageURL: trimmed,
    accessMethod: 'url',
  }];
}
