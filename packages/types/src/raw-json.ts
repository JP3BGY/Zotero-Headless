// Centralized rawJson parsing utilities
// Prevents the recurring bug of accessing raw.field instead of raw.data.field

// ============ Types ============

export interface ZoteroItemData {
  key?: string;
  version?: number;
  itemType?: string;
  title?: string;
  creators?: Array<{
    firstName?: string;
    lastName?: string;
    name?: string;
    creatorType?: string;
  }>;
  tags?: Array<{ tag: string; type?: number } | string>;
  collections?: string[];
  relations?: Record<string, string | string[]>;
  related?: string[];
  parentItem?: string;
  deleted?: boolean | number;

  // Common bibliographic fields
  date?: string;
  abstractNote?: string;
  DOI?: string;
  url?: string;
  ISBN?: string;
  ISSN?: string;
  publicationTitle?: string;
  journalAbbreviation?: string;
  publisher?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  language?: string;
  accessDate?: string;
  rights?: string;
  extra?: string;
  shortTitle?: string;
  place?: string;
  series?: string;
  seriesTitle?: string;
  seriesText?: string;

  // Note fields
  note?: string;

  // Attachment fields
  linkMode?: string;
  contentType?: string;
  charset?: string;
  filename?: string;
  path?: string;

  // Annotation fields
  annotationType?: string;
  annotationText?: string;
  annotationComment?: string;
  annotationColor?: string;
  annotationPageLabel?: string;
  annotationPosition?: string;
  annotationSortIndex?: string;

  // Search fields
  conditions?: Array<{
    condition?: string;
    operator?: string;
    value?: string;
  }>;

  // Allow additional fields
  [key: string]: unknown;
}

export interface ZoteroApiResponse {
  key?: string;
  version?: number;
  library?: Record<string, unknown>;
  links?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  data: ZoteroItemData;
}

export type RawJsonContent = ZoteroApiResponse | { data: ZoteroItemData };

// ============ Functions ============

/**
 * Parse rawJson string and return the .data layer (actual item fields).
 * This is the primary accessor — use it for all read-only access to item fields.
 *
 * Handles both API envelope format ({ key, version, data: {...} })
 * and bare data format ({ itemType, title, ... }).
 */
export function parseItemData(rawJson: string | null | undefined): ZoteroItemData {
  if (!rawJson) return {};
  try {
    const parsed = JSON.parse(rawJson);
    return parsed.data ?? parsed;
  } catch {
    return {};
  }
}

/**
 * Parse rawJson string and return the full envelope (for re-serialization).
 * Use this when you need to mutate and write back while preserving the envelope structure.
 */
export function parseRawJson(rawJson: string | null | undefined): RawJsonContent {
  if (!rawJson) return { data: {} };
  try {
    const parsed = JSON.parse(rawJson);
    // Ensure there's always a .data wrapper
    if (!parsed.data) {
      return { data: parsed };
    }
    return parsed;
  } catch {
    return { data: {} };
  }
}

/**
 * Parse rawJson, apply an updater function to .data, and re-serialize.
 * Use this for all mutation operations — it preserves the envelope structure.
 */
export function updateItemData(
  rawJson: string | null | undefined,
  updater: (data: ZoteroItemData) => void,
): string {
  const envelope = parseRawJson(rawJson);
  updater(envelope.data);
  return JSON.stringify(envelope);
}

/**
 * Extract denormalized DB columns from a ZoteroItemData object.
 * Maps Zotero API field names to the items table column values.
 */
export function extractDenormalizedColumns(data: ZoteroItemData): Record<string, unknown> {
  const cols: Record<string, unknown> = {};

  if (data.title !== undefined) cols.title = data.title;
  if (data.itemType !== undefined) cols.itemType = data.itemType;
  if (data.date !== undefined) cols.publicationDate = data.date;
  if (data.abstractNote !== undefined) cols.abstract = data.abstractNote;
  if (data.DOI !== undefined) cols.doi = data.DOI;
  if (data.url !== undefined) cols.url = data.url;
  if (data.ISBN !== undefined) cols.isbn = data.ISBN;
  if (data.ISSN !== undefined) cols.issn = data.ISSN;
  if (data.publisher !== undefined) cols.publisher = data.publisher;
  if (data.publicationTitle !== undefined) cols.journal = data.publicationTitle;
  if (data.volume !== undefined) cols.volume = data.volume;
  if (data.issue !== undefined) cols.issue = data.issue;
  if (data.pages !== undefined) cols.pages = data.pages;
  if (data.creators !== undefined) cols.creators = JSON.stringify(data.creators);
  if (data.collections !== undefined) cols.collectionKeys = JSON.stringify(data.collections);
  if (data.tags !== undefined) cols.tags = JSON.stringify(data.tags);
  if (data.extra !== undefined) cols.extra = typeof data.extra === 'string' ? data.extra : JSON.stringify(data.extra);

  return cols;
}
