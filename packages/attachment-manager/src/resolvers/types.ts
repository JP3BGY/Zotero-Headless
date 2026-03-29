// Shared types for full text resolvers

/**
 * A single URL entry returned by a resolver.
 * Either `url` (direct file) or `pageURL` (page to follow) or both.
 */
export interface UrlResolverEntry {
  url?: string;
  pageURL?: string;
  accessMethod: string;
  articleVersion?: string;
  referrer?: string;
}

/**
 * A resolver is either an array of entries or an async function that returns entries.
 */
export type Resolver = UrlResolverEntry[] | (() => Promise<UrlResolverEntry[]>);

/**
 * Custom resolver configuration (JSON mode only for headless).
 */
export interface CustomResolverConfig {
  name: string;
  method: 'GET' | 'POST';
  url: string;            // must contain {doi} placeholder
  mode: 'json';
  selector: string;       // dot-path to extract URL(s) from JSON response
  mappings?: {
    url?: string;
    pageURL?: string;
  };
}

/**
 * Options for building resolvers.
 */
export interface BuildResolverOptions {
  methods?: ('doi' | 'oa' | 'url' | 'custom')[];
  customResolvers?: CustomResolverConfig[];
}

/**
 * Result of full text finding for a single item.
 */
export interface FindResult {
  success: boolean;
  itemKey: string;
  attachmentKey?: string;
  filename?: string;
  url?: string;
  accessMethod?: string;
  mimeType?: string;
  fileSize?: number;
  error?: string;
}

/**
 * Options for batch full text finding.
 */
export interface FullTextFinderOptions {
  methods?: ('doi' | 'oa' | 'url' | 'custom')[];
  customResolvers?: CustomResolverConfig[];
  sameDomainRequestDelay?: number;
  maxConsecutiveDomainFailures?: number;
  onProgress?: (current: number, total: number, itemTitle: string) => void;
  onItemResult?: (itemKey: string, result: FindResult) => void;
  dryRun?: boolean;
}
