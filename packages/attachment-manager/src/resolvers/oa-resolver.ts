// Open Access resolver: queries Zotero's Unpaywall mirror API
// Reference: Zotero Desktop utilities_internal.js:1300-1339
// Endpoint: POST https://services.zotero.org/oa/search

import type { UrlResolverEntry } from './types.js';

const OA_SEARCH_URL = 'https://services.zotero.org/oa/search';
const MAX_URLS = 6;

/**
 * Query the Zotero Open Access API for PDF URLs.
 * Returns an async function (lazy resolver) that performs the API call when invoked.
 *
 * Note: This uses Zotero's private Unpaywall mirror API.
 */
export function resolveOA(doi: string): (() => Promise<UrlResolverEntry[]>) | null {
  if (!doi) return null;

  const cleanDoi = doi.replace(/^https?:\/\/doi\.org\//i, '').trim();
  if (!cleanDoi) return null;

  return async (): Promise<UrlResolverEntry[]> => {
    try {
      const response = await fetch(OA_SEARCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doi: cleanDoi }),
      });

      if (!response.ok) {
        return [];
      }

      const urls = await response.json() as Array<{
        url?: string;
        pageURL?: string;
        version?: string;
      }>;

      if (!Array.isArray(urls)) return [];

      return urls.slice(0, MAX_URLS).map(entry => ({
        url: entry.url,
        pageURL: entry.pageURL,
        articleVersion: entry.version,
        accessMethod: 'oa',
      }));
    } catch {
      return [];
    }
  };
}
