// Resolver orchestration: builds ordered resolver list and checks item eligibility
// Reference: Zotero Desktop attachments.js getFileResolvers (line 1274) and canFindFileForItem (line 1249)

import { resolveDOI } from './doi-resolver.js';
import { resolveOA } from './oa-resolver.js';
import { resolveURL } from './url-resolver.js';
import { resolveCustom } from './custom-resolver.js';
import type { Resolver, BuildResolverOptions } from './types.js';
import { ALLOWED_MIME_TYPES } from '../file-validator.js';

export type { UrlResolverEntry, Resolver, CustomResolverConfig, FindResult, FullTextFinderOptions, BuildResolverOptions } from './types.js';

// Item types that should NOT be processed for full text finding
const EXCLUDED_ITEM_TYPES = new Set(['attachment', 'note', 'annotation']);

/**
 * Check if an item is eligible for full text finding.
 * Requirements:
 * - Is a regular item (not attachment/note/annotation)
 * - Has DOI or URL
 * - Does not already have a PDF/EPUB attachment
 */
export function canFindFileForItem(
  item: { itemType: string; doi?: string | null; url?: string | null },
  existingAttachmentContentTypes: string[],
): boolean {
  // Must be a regular item type
  if (EXCLUDED_ITEM_TYPES.has(item.itemType)) return false;

  // Must have DOI or URL
  if (!item.doi && !item.url) return false;

  // Must not already have a full-text attachment
  const hasFullText = existingAttachmentContentTypes.some(
    ct => ALLOWED_MIME_TYPES.includes(ct as any),
  );
  if (hasFullText) return false;

  return true;
}

/**
 * Build an ordered array of resolvers for a given item.
 * Default method order: doi, oa, url, custom
 * Each resolver is either a static UrlResolverEntry[] or an async lazy function.
 */
export function buildResolvers(
  item: { doi?: string | null; url?: string | null },
  options: BuildResolverOptions = {},
): Resolver[] {
  const methods = options.methods || ['doi', 'oa', 'url', 'custom'];
  const resolvers: Resolver[] = [];

  for (const method of methods) {
    switch (method) {
      case 'doi': {
        if (item.doi) {
          const entries = resolveDOI(item.doi);
          if (entries.length > 0) resolvers.push(entries);
        }
        break;
      }
      case 'oa': {
        if (item.doi) {
          const fn = resolveOA(item.doi);
          if (fn) resolvers.push(fn);
        }
        break;
      }
      case 'url': {
        if (item.url) {
          const entries = resolveURL(item.url);
          if (entries.length > 0) resolvers.push(entries);
        }
        break;
      }
      case 'custom': {
        if (item.doi && options.customResolvers?.length) {
          const fns = resolveCustom(item.doi, options.customResolvers);
          resolvers.push(...fns);
        }
        break;
      }
    }
  }

  return resolvers;
}
