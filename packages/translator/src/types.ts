/**
 * A translated item as returned by the Zotero translator framework.
 * Field names follow the Zotero API convention.
 */
export interface TranslatedItem {
  itemType: string;
  title?: string;
  creators?: Array<{
    firstName?: string;
    lastName?: string;
    name?: string;
    creatorType: string;
  }>;
  date?: string;
  DOI?: string;
  ISBN?: string;
  ISSN?: string;
  url?: string;
  abstractNote?: string;
  publicationTitle?: string;
  journalAbbreviation?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  place?: string;
  edition?: string;
  series?: string;
  seriesTitle?: string;
  language?: string;
  shortTitle?: string;
  rights?: string;
  extra?: string;
  numPages?: string;
  tags?: Array<{ tag: string; type?: number }>;
  notes?: Array<{ note: string; tags?: Array<{ tag: string }> }>;
  attachments?: Array<{
    title?: string;
    url?: string;
    mimeType?: string;
    snapshot?: boolean;
    path?: string;
  }>;
  collections?: string[];
  relations?: Record<string, string | string[]>;
  [key: string]: unknown;
}

/**
 * A collection from the Zotero translator framework (e.g. from Zotero RDF import).
 * Children reference items via their itemID or nested sub-collections.
 */
export interface TranslatedCollection {
  type: 'collection';
  name: string;
  children: Array<
    | { type: 'item'; id: string }
    | TranslatedCollection
  >;
}

/**
 * Result from an import operation, including both items and collections.
 */
export interface ImportResult {
  items: TranslatedItem[];
  collections: TranslatedCollection[];
}

export interface TranslatorEngineOptions {
  /** Path to the translators directory. Default: <repoRoot>/references/translators */
  translatorsDir?: string;
  /** Path to the translate framework. Default: <repoRoot>/references/zotero-connectors/src/translate */
  frameworkDir?: string;
  /** Enable debug logging from the translator framework. Default: false */
  debug?: boolean;
}
