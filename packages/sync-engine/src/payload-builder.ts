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
  
  // Fields allowed by Zotero API
  private static readonly ALLOWED_FIELDS = new Set([
    'key', 'version', 'itemType', 'title', 'creators', 'abstractNote', 
    'date', 'url', 'DOI', 'accessDate', 'libraryCatalog', 'callNumber', 
    'rights', 'placeholder', 'note', 'parentItem', 'tags', 
    'collections', 'relations'
  ]);
  
  /**
   * Build payload for creating a new item
   * 
   * @param item Local item data
   * @returns Payload ready for API
   * @throws Error if critical fields are missing
   */
  static buildCreatePayload(item: Item): CreatePayload {
    const rawData = JSON.parse(item.rawJson || '{}');
    let data = rawData.data || {};
    
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
      // NEVER delete critical fields
      if (this.CRITICAL_FIELDS.includes(field as typeof this.CRITICAL_FIELDS[number])) {
        continue;
      }
      
      // Delete unknown fields
      if (!this.ALLOWED_FIELDS.has(field)) {
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
   * Build payload for updating an existing item
   */
  static buildUpdatePayload(item: Item): Record<string, unknown> {
    const payload = this.buildCreatePayload(item);
    
    // For updates, we might not need to send all fields
    // But we always need key and version for identification
    return payload;
  }
}
