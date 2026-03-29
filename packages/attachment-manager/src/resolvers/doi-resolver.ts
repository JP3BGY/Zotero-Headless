// DOI resolver: constructs https://doi.org/{doi} URL
// Reference: Zotero Desktop attachments.js:1288-1296

import type { UrlResolverEntry } from './types.js';

/**
 * Build resolver entries for DOI-based resolution.
 * The DOI URL redirects to the publisher page, which may serve a PDF directly.
 */
export function resolveDOI(doi: string): UrlResolverEntry[] {
  if (!doi) return [];

  const cleanDoi = doi.replace(/^https?:\/\/doi\.org\//i, '').trim();
  if (!cleanDoi) return [];

  return [{
    pageURL: `https://doi.org/${encodeURI(cleanDoi)}`,
    accessMethod: 'doi',
  }];
}
