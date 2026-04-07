/**
 * Payload Builder for Zotero API
 * 
 * Ensures all required fields are present and properly formatted
 * before sending to Zotero API.
 * 
 * CRITICAL FIELDS (must never be removed):
 * - key: 8-character Zotero-compatible key
 * - version: Item version (0 for new items)
 * - itemType: Type of item (book, journalArticle, etc.)
 */

import { parseRawJson } from '@zotero-headless/types';
import type { Item } from '@zotero-headless/types';

export interface CreatePayload {
  key: string;
  version: number;
  itemType: string;
  [key: string]: unknown;
}

export class PayloadBuilder {
  // Fields that are absolutely required for API calls
  private static readonly CRITICAL_FIELDS = ['key', 'version', 'itemType'] as const;
  
  // Fields that must NOT be sent to the API (server-managed / read-only metadata).
  // Everything else from rawJson is passed through as-is, since rawJson
  // originates from the API and contains valid item-type-specific fields.
  private static readonly EXCLUDED_FIELDS = new Set([
    'dateAdded', 'dateModified',  // server-managed timestamps
    'library', 'links', 'meta',  // server-assigned metadata
  ]);
  
  /**
   * Build payload for creating a new item
   * 
   * @param item Local item data
   * @returns Payload ready for API
   * @throws Error if critical fields are missing
   */
  static buildCreatePayload(item: Item): CreatePayload {
    const envelope = parseRawJson(item.rawJson);
    let data: Record<string, any> = envelope.data;
    
    // Ensure key is set from item
    if (!data.key && item.key) {
      data.key = item.key;
    }
    
    // Ensure version is set (0 for new items)
    if (data.version === undefined || data.version === null) {
      data.version = item.version ?? 0;
    }
    
    // Parse creators if needed
    if (typeof data.creators === 'string') {
      try {
        data.creators = JSON.parse(data.creators);
      } catch {
        data.creators = [];
      }
    }
    
    // Parse tags if needed (stored as JSON string in DB, needs to be array for API)
    if (typeof data.tags === 'string') {
      try {
        data.tags = JSON.parse(data.tags);
      } catch {
        data.tags = [];
      }
    }
    // Ensure tags is always an array
    if (!Array.isArray(data.tags)) {
      data.tags = [];
    }
    
    // Map publicationDate to date (Zotero API uses 'date')
    if (data.publicationDate) {
      data.date = data.publicationDate;
      delete data.publicationDate;
    }
    
    // Clean unknown fields while preserving critical fields
    this.cleanFields(data);
    
    // Validate critical fields
    this.validateCriticalFields(data, item.key);
    
    // Validate key format
    this.validateKeyFormat(data.key as string);
    
    return data as CreatePayload;
  }
  
  /**
   * Remove unknown fields while preserving critical fields
   */
  private static cleanFields(data: Record<string, unknown>): void {
    for (const field of Object.keys(data)) {
      if (this.EXCLUDED_FIELDS.has(field)) {
        delete data[field];
      }
    }
  }
  
  /**
   * Validate that all critical fields are present
   */
  private static validateCriticalFields(
    data: Record<string, unknown>, 
    originalKey: string
  ): void {
    const missing: string[] = [];
    
    for (const field of this.CRITICAL_FIELDS) {
      if (!(field in data) || data[field] === undefined || data[field] === null) {
        missing.push(field);
      }
    }
    
    if (missing.length > 0) {
      const error = new Error(
        `PayloadBuilder: Missing critical fields [${missing.join(', ')}] for item ${originalKey}. ` +
        `Available fields: [${Object.keys(data).join(', ')}]`
      );
      error.name = 'PayloadValidationError';
      throw error;
    }
  }
  
  /**
   * Validate key format matches Zotero requirements
   */
  private static validateKeyFormat(key: string): void {
    const keyPattern = /^[23456789ABCDEFGHIJKLMNPQRSTUVWXYZ]{8}$/;
    if (!keyPattern.test(key)) {
      console.warn(`PayloadBuilder: Key format may be invalid: ${key}`);
      console.warn(`  Expected: 8 chars from [23456789ABCDEFGHIJKLMNPQRSTUVWXYZ]`);
    }
  }
  
  /**
   * Build payload for updating an existing item (full mode fallback)
   */
  static buildUpdatePayload(item: Item): Record<string, unknown> {
    const payload = this.buildCreatePayload(item);

    // For updates, we might not need to send all fields
    // But we always need key and version for identification
    return payload;
  }

  /**
   * Build a PATCH payload by computing diff between cached (base) and current data.
   * Only includes fields that changed from the cached version.
   *
   * Mirrors official Zotero's dataObjectUtilities.patch() (dataObjectUtilities.js:114-159).
   *
   * @param item Current local item
   * @param cachedData The cached API data object (from sync_cache, parsed)
   * @returns Minimal payload with only changed fields + version
   */
  static buildPatchPayload(item: Item, cachedData: Record<string, unknown>): Record<string, unknown> {
    const envelope = parseRawJson(item.rawJson);
    const current: Record<string, any> = { ...envelope.data };
    const base = cachedData;

    // Always include version
    const patch: Record<string, unknown> = {
      version: item.version,
    };

    // Fields to skip comparison on (server-managed or identity fields)
    const SKIP_FIELDS = new Set([
      'key', 'version', 'dateModified', 'dateAdded', 'library', 'links', 'meta',
    ]);

    // Parse serialized fields
    if (typeof current.creators === 'string') {
      try { current.creators = JSON.parse(current.creators); } catch { current.creators = []; }
    }
    if (typeof current.tags === 'string') {
      try { current.tags = JSON.parse(current.tags); } catch { current.tags = []; }
    }

    // Map field name differences
    if (current.publicationDate) {
      current.date = current.publicationDate;
      delete current.publicationDate;
    }

    // Include only changed fields
    for (const field of Object.keys(current)) {
      if (SKIP_FIELDS.has(field)) continue;
      if (this._fieldChanged(field, base[field], current[field])) {
        patch[field] = current[field];
      }
    }

    // Handle removed fields (present in base but not in current)
    for (const field of Object.keys(base)) {
      if (SKIP_FIELDS.has(field) || field in current) continue;
      switch (field) {
        case 'collections':
          break; // Don't need to explicitly clear
        case 'deleted':
        case 'parentItem':
        case 'inPublications':
          if (base[field]) patch[field] = false;
          break;
        default:
          if (base[field] !== '' && base[field] != null) {
            patch[field] = '';
          }
      }
    }

    return patch;
  }

  /**
   * Compare two field values for equality.
   * Handles arrays and objects with deep JSON comparison.
   */
  private static _fieldChanged(field: string, val1: unknown, val2: unknown): boolean {
    if (val1 === val2) return false;
    if (val1 == null && val2 == null) return false;
    if (Array.isArray(val1) || Array.isArray(val2) || typeof val1 === 'object' || typeof val2 === 'object') {
      return JSON.stringify(val1) !== JSON.stringify(val2);
    }
    return val1 !== val2;
  }
}
