// Custom JSON-mode resolver for user-configured PDF sources
// Reference: Zotero Desktop attachments.js:1325-1466 (JSON mode only)

import type { UrlResolverEntry, CustomResolverConfig } from './types.js';

/**
 * Extract a value from a nested object using a dot-path selector.
 * Supports: "field", "field.nested", "field[0]", "field[0].url"
 */
function getByPath(obj: any, selector: string): any {
  if (!obj || !selector) return undefined;

  const parts = selector.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;

  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }

  return current;
}

/**
 * Build a lazy resolver from custom resolver configurations.
 * Only supports JSON mode (HTML mode requires DOM parsing).
 */
export function resolveCustom(
  doi: string,
  configs: CustomResolverConfig[],
): (() => Promise<UrlResolverEntry[]>)[] {
  if (!doi || !configs || configs.length === 0) return [];

  const cleanDoi = doi.replace(/^https?:\/\/doi\.org\//i, '').trim();
  if (!cleanDoi) return [];

  return configs
    .filter(config => config.mode === 'json' && config.url?.includes('{doi}'))
    .map(config => {
      return async (): Promise<UrlResolverEntry[]> => {
        try {
          const requestUrl = config.url.replace('{doi}', encodeURIComponent(cleanDoi));
          const method = (config.method || 'GET').toUpperCase();

          const fetchOptions: RequestInit = {
            method,
            headers: { 'Accept': 'application/json' },
          };

          if (method === 'POST') {
            fetchOptions.headers = {
              ...fetchOptions.headers,
              'Content-Type': 'application/json',
            };
            fetchOptions.body = JSON.stringify({ doi: cleanDoi });
          }

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);
          fetchOptions.signal = controller.signal;

          const response = await fetch(requestUrl, fetchOptions);
          clearTimeout(timeoutId);

          if (!response.ok) return [];

          const json = await response.json();
          const selected = getByPath(json, config.selector);

          if (!selected) return [];

          // Normalize to array
          const items = Array.isArray(selected) ? selected : [selected];

          return items
            .map(item => {
              if (typeof item === 'string') {
                return { url: item, accessMethod: `custom:${config.name}` } as UrlResolverEntry;
              }
              if (typeof item === 'object' && item !== null) {
                const entry: UrlResolverEntry = { accessMethod: `custom:${config.name}` };
                if (config.mappings) {
                  if (config.mappings.url && item[config.mappings.url]) {
                    entry.url = item[config.mappings.url];
                  }
                  if (config.mappings.pageURL && item[config.mappings.pageURL]) {
                    entry.pageURL = item[config.mappings.pageURL];
                  }
                } else {
                  // Default: try common field names
                  entry.url = item.url || item.download_url || item.pdf_url;
                  entry.pageURL = item.pageURL || item.page_url;
                }
                if (entry.url || entry.pageURL) return entry;
              }
              return null;
            })
            .filter((e): e is UrlResolverEntry => e !== null);
        } catch {
          return [];
        }
      };
    });
}
