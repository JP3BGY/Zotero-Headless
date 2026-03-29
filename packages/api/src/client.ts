// Zotero API Client
// See Zotero-Headless-Complete-Design.md Section 4

import { appConfig } from '@zotero-headless/core';
import type { Library, Item, Collection, DeletedObjects } from '@zotero-headless/types';

// ============ Types ============

export interface ZoteroAPIConfig {
  apiKey?: string;
  baseUrl?: string;
}

export interface WriteResponse {
  successful: Record<string, string>;
  unchanged: Record<string, unknown>;
  failed: Record<string, { code: string; message: string }>;
}

export interface KeyAccess {
  user: { library: boolean; files: boolean; notes: boolean; write: boolean };
  groups: Record<string, { library: boolean; write: boolean }>;
}

export interface KeyInfo {
  userID: number;
  username: string;
  access: KeyAccess;
}

// Raw API response types (from Zotero)
export interface ZoteroItemResponse {
  key: string;
  version: number;
  library: { id: number; type: 'user' | 'group' };
  data: Record<string, unknown>;
  meta?: { parsedDate?: string; numChildren?: number };
}

export interface ZoteroCollectionResponse {
  key: string;
  version: number;
  library: { id: number; type: 'user' | 'group' };
  data: Record<string, unknown>;
}

// ============ Rate Limiter ============

class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private capacity: number = 10,
    private refillRate: number = 10
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens--;
      return;
    }

    const waitTime = (1 - this.tokens) * (1000 / this.refillRate);
    await new Promise(resolve => setTimeout(resolve, waitTime));
    return this.acquire();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

// ============ API Client ============

export class ZoteroAPIClient {
  private baseUrl = 'https://api.zotero.org';
  private apiKey: string;
  private rateLimiter: RateLimiter;

  constructor(config?: ZoteroAPIConfig) {
    this.apiKey = config?.apiKey ?? appConfig.zotero.apiKey;
    this.baseUrl = config?.baseUrl ?? this.baseUrl;
    this.rateLimiter = new RateLimiter();
  }

  /**
   * Generic request method
   */
  private async request<T>(
    method: string,
    path: string,
    options: {
      params?: Record<string, string | number | boolean>;
      headers?: Record<string, string>;
      body?: unknown;
    } = {}
  ): Promise<{ data: T; version: number }> {
    // Apply rate limiting
    await this.rateLimiter.acquire();

    const url = new URL(`${this.baseUrl}${path}`);

    if (options.params) {
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      }
    }

    console.log(`[API] ${method} ${url.toString()}`);

    const headers: Record<string, string> = {
      'Zotero-API-Key': this.apiKey,
      'Zotero-API-Version': '3',
      ...options.headers,
    };

    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url.toString(), {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    console.log(`[API] Response: ${response.status}`);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Zotero API error ${response.status}: ${error}`);
    }

    const version = Number(response.headers.get('Last-Modified-Version') ?? 0);

    if (response.status === 204) {
      return { data: undefined as T, version };
    }

    const data = await response.json() as T;
    return { data, version };
  }

  // ============ Key & Library Operations ============

  /** Verify API key and get key info */
  async verifyKey(): Promise<KeyInfo> {
    const response = await this.request<KeyInfo>('GET', '/keys/current');
    return response.data;
  }

  /** Get user's libraries (groups) */
  async getGroups(userId: string | number): Promise<Array<{ id: number; version: number }>> {
    const response = await this.request<Array<{ id: number; version: number }>>(
      'GET',
      `/users/${userId}/groups`,
      { params: { format: 'json' } }
    );
    return response.data;
  }

  /** Get group details */
  async getGroup(groupId: string | number): Promise<{
    id: number;
    name: string;
    owner: number;
    description?: string;
    type: 'Private' | 'PublicOpen' | 'PublicClosed';
  }> {
    const response = await this.request<{
      id: number;
      name: string;
      owner: number;
      description?: string;
      type: 'Private' | 'PublicOpen' | 'PublicClosed';
    }>('GET', `/groups/${groupId}`, { params: { format: 'json' } });
    return response.data;
  }

  /** Get library version (works for both user and group libraries) */
  async getLibraryVersion(
    libraryId: string | number,
    libraryType: 'user' | 'group' = 'user'
  ): Promise<number> {
    const path = libraryType === 'group' ? `/groups/${libraryId}/items` : `/users/${libraryId}/items`;
    const response = await this.request<unknown>('GET', path, { params: { limit: 1 } });
    return response.version;
  }

  // ============ Item Operations ============

  private getLibraryPath(libraryId: string | number, libraryType: 'user' | 'group' = 'user'): string {
    return libraryType === 'group' ? `/groups/${libraryId}` : `/users/${libraryId}`;
  }

  /** Get item versions for incremental sync */
  async getItemVersions(
    libraryId: string | number,
    since: number,
    libraryType: 'user' | 'group' = 'user'
  ): Promise<Record<string, number>> {
    const response = await this.request<Record<string, number>>(
      'GET',
      `${this.getLibraryPath(libraryId, libraryType)}/items`,
      { params: { since, format: 'versions', includeTrashed: true } }
    );
    return response.data;
  }

  /** Batch get items */
  async getItems(
    libraryId: string | number,
    itemKeys: string[],
    libraryType: 'user' | 'group' = 'user'
  ): Promise<ZoteroItemResponse[]> {
    if (itemKeys.length === 0) return [];

    const response = await this.request<ZoteroItemResponse[]>(
      'GET',
      `${this.getLibraryPath(libraryId, libraryType)}/items`,
      {
        params: {
          itemKey: itemKeys.join(','),
          format: 'json',
          includeTrashed: true
        }
      }
    );
    return response.data;
  }

  /** Get single item */
  async getItem(
    libraryId: string | number,
    itemKey: string,
    libraryType: 'user' | 'group' = 'user'
  ): Promise<ZoteroItemResponse> {
    const response = await this.request<ZoteroItemResponse>(
      'GET',
      `${this.getLibraryPath(libraryId, libraryType)}/items/${itemKey}`
    );
    return response.data;
  }

  /** Create items */
  async createItems(
    libraryId: string | number,
    items: Array<Record<string, unknown>>,
    libraryType: 'user' | 'group' = 'user'
  ): Promise<WriteResponse> {
    // Pre-flight validation: Ensure all items have required fields
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.key) {
        console.error(`🚨 API VALIDATION ERROR: Item at index ${i} is missing 'key' field`);
        console.error(`   Item data:`, JSON.stringify(item, null, 2));
        throw new Error(`BUG: Cannot create item without 'key' field. Index: ${i}`);
      }
      if (item.version === undefined || item.version === null) {
        console.error(`🚨 API VALIDATION ERROR: Item at index ${i} is missing 'version' field`);
        console.error(`   This is required for 'key'-based writes to work correctly`);
        throw new Error(`BUG: Cannot create item without 'version' field. Index: ${i}`);
      }
      if (!item.itemType) {
        console.error(`🚨 API VALIDATION ERROR: Item at index ${i} is missing 'itemType' field`);
        throw new Error(`BUG: Cannot create item without 'itemType' field. Index: ${i}`);
      }
    }
    
    console.log(`   Sending ${items.length} item(s) to API`);
    items.forEach((item, i) => {
      console.log(`      [${i}] key=${item.key}, type=${item.itemType}, version=${item.version}`);
    });
    
    const response = await this.request<WriteResponse>(
      'POST',
      `${this.getLibraryPath(libraryId, libraryType)}/items`,
      { params: { format: 'json' }, body: items }
    );
    return response.data;
  }

  /** Update item (PATCH) */
  async updateItem(
    libraryId: string | number,
    itemKey: string,
    data: Record<string, unknown>,
    version: number,
    libraryType: 'user' | 'group' = 'user'
  ): Promise<number> {
    const response = await this.request<unknown>(
      'PATCH',
      `${this.getLibraryPath(libraryId, libraryType)}/items/${itemKey}`,
      {
        params: { format: 'json' },
        body: data,
        headers: { 'If-Unmodified-Since-Version': String(version) }
      }
    );
    return response.version;
  }

  /** Delete item */
  async deleteItem(
    libraryId: string | number,
    itemKey: string,
    version: number,
    libraryType: 'user' | 'group' = 'user'
  ): Promise<void> {
    await this.request(
      'DELETE',
      `${this.getLibraryPath(libraryId, libraryType)}/items/${itemKey}`,
      { headers: { 'If-Unmodified-Since-Version': String(version) } }
    );
  }

  // ============ Deleted Items Operations ============

  /** Get deleted items */
  async getDeleted(
    libraryId: string | number,
    since: number,
    libraryType: 'user' | 'group' = 'user'
  ): Promise<DeletedObjects> {
    const response = await this.request<DeletedObjects>(
      'GET',
      `${this.getLibraryPath(libraryId, libraryType)}/deleted`,
      { params: { since } }
    );
    return response.data;
  }

  // ============ Collection Operations ============

  /** Get collection versions */
  async getCollectionVersions(
    libraryId: string | number,
    since: number,
    libraryType: 'user' | 'group' = 'user'
  ): Promise<Record<string, number>> {
    const response = await this.request<Record<string, number>>(
      'GET',
      `${this.getLibraryPath(libraryId, libraryType)}/collections`,
      { params: { since, format: 'versions' } }
    );
    return response.data;
  }

  /** Get collections */
  async getCollections(
    libraryId: string | number,
    collectionKeys: string[],
    libraryType: 'user' | 'group' = 'user'
  ): Promise<ZoteroCollectionResponse[]> {
    if (collectionKeys.length === 0) return [];

    const response = await this.request<ZoteroCollectionResponse[]>(
      'GET',
      `${this.getLibraryPath(libraryId, libraryType)}/collections`,
      {
        params: {
          collectionKey: collectionKeys.join(','),
          format: 'json'
        }
      }
    );
    return response.data;
  }

  /** Create a collection */
  async createCollection(
    libraryId: string | number,
    name: string,
    parentKey?: string,
    libraryType: 'user' | 'group' = 'user'
  ): Promise<{ key: string; version: number }> {
    const response = await this.request<WriteResponse>(
      'POST',
      `${this.getLibraryPath(libraryId, libraryType)}/collections`,
      {
        body: [{
          name,
          parentKey: parentKey || undefined
        }]
      }
    );
    const result = response.data;
    if (result.successful && result.successful['0']) {
      const created = result.successful['0'] as any;
      return { key: created.key || created, version: created.version ?? response.version };
    }
    if (result.failed && result.failed['0']) {
      throw new Error(`Create collection failed: ${result.failed['0'].message}`);
    }
    throw new Error('Unexpected response from Zotero API');
  }

  /** Update a collection */
  async updateCollection(
    libraryId: string | number,
    collectionKey: string,
    data: { name: string; parentCollection?: string | false },
    version: number,
    libraryType: 'user' | 'group' = 'user'
  ): Promise<number> {
    const response = await this.request<unknown>(
      'PATCH',
      `${this.getLibraryPath(libraryId, libraryType)}/collections/${collectionKey}`,
      {
        body: data,
        headers: { 'If-Unmodified-Since-Version': String(version) }
      }
    );
    return response.version;
  }

  /** Delete a collection */
  async deleteCollection(
    libraryId: string | number,
    collectionKey: string,
    libraryType: 'user' | 'group' = 'user'
  ): Promise<void> {
    await this.request(
      'DELETE',
      `${this.getLibraryPath(libraryId, libraryType)}/collections/${collectionKey}`
    );
  }

  // ============ Tag Operations ============

  /** Get all tags in a library */
  async getTags(
    libraryId: string | number,
    libraryType: 'user' | 'group' = 'user',
    options?: {
      since?: number;
      limit?: number;
      start?: number;
      order?: string;
      sort?: 'asc' | 'desc';
    }
  ): Promise<{ tag: string; type: number; numItems: number }[]> {
    const response = await this.request<{ tag: string; type: number; numItems: number }[]>(
      'GET',
      `${this.getLibraryPath(libraryId, libraryType)}/tags`,
      { params: options as Record<string, string | number> }
    );
    return response.data;
  }

  /** Get tags for a specific item */
  async getItemTags(
    libraryId: string | number,
    itemKey: string,
    libraryType: 'user' | 'group' = 'user'
  ): Promise<{ tag: string; type: number }[]> {
    const response = await this.request<{ tag: string; type: number }[]>(
      'GET',
      `${this.getLibraryPath(libraryId, libraryType)}/items/${itemKey}/tags`
    );
    return response.data;
  }

  /** Update tags for an item */
  async updateItemTags(
    libraryId: string | number,
    itemKey: string,
    tags: { tag: string; type?: 0 | 1 }[],
    libraryType: 'user' | 'group' = 'user'
  ): Promise<WriteResponse> {
    // First get current item to preserve other fields
    const item = await this.getItem(libraryId, itemKey, libraryType);
    if (!item) {
      throw new Error(`Item ${itemKey} not found`);
    }

    // Update with new tags
    const updatedData = {
      ...item.data,
      tags: tags
    };

    const response = await this.request<WriteResponse>(
      'PATCH',
      `${this.getLibraryPath(libraryId, libraryType)}/items/${itemKey}`,
      { body: [updatedData] }
    );
    return response.data;
  }

  /** Add tags to an item */
  async addItemTags(
    libraryId: string | number,
    itemKey: string,
    tags: string[],
    libraryType: 'user' | 'group' = 'user'
  ): Promise<WriteResponse> {
    // Get current tags
    const currentTags = await this.getItemTags(libraryId, itemKey, libraryType);
    const existingTagNames = new Set(currentTags.map(t => t.tag.toLowerCase()));

    // Add new tags that don't already exist
    const newTags = tags
      .filter(tag => !existingTagNames.has(tag.toLowerCase()))
      .map(tag => ({ tag, type: 0 as const }));

    if (newTags.length === 0) {
      return { successful: {}, unchanged: { [itemKey]: null }, failed: {} };
    }

    const allTags = [
      ...currentTags.map(t => ({ tag: t.tag, type: t.type as 0 | 1 })),
      ...newTags
    ];

    return this.updateItemTags(libraryId, itemKey, allTags, libraryType);
  }

  /** Remove tags from an item */
  async removeItemTags(
    libraryId: string | number,
    itemKey: string,
    tags: string[],
    libraryType: 'user' | 'group' = 'user'
  ): Promise<WriteResponse> {
    // Get current tags
    const currentTags = await this.getItemTags(libraryId, itemKey, libraryType);
    const tagsToRemove = new Set(tags.map(t => t.toLowerCase()));

    // Filter out tags to remove
    const remainingTags = currentTags
      .filter(t => !tagsToRemove.has(t.tag.toLowerCase()))
      .map(t => ({ tag: t.tag, type: t.type as 0 | 1 }));

    return this.updateItemTags(libraryId, itemKey, remainingTags, libraryType);
  }

  /** Delete a tag from the library (removes from all items) */
  async deleteTag(
    libraryId: string | number,
    tag: string,
    libraryType: 'user' | 'group' = 'user'
  ): Promise<void> {
    const encodedTag = encodeURIComponent(tag);
    await this.request(
      'DELETE',
      `${this.getLibraryPath(libraryId, libraryType)}/tags/${encodedTag}`
    );
  }

  // ============ Utility ============

  /** Get item template for new items */
  async getItemTemplate(libraryId: string | number, itemType: string): Promise<Record<string, unknown>> {
    const response = await this.request<Record<string, unknown>>(
      'GET',
      `/users/${libraryId}/items/new`,
      { params: { itemType } }
    );
    return response.data;
  }
}

// Export singleton instance
export const zoteroApi = new ZoteroAPIClient();
