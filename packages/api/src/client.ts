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
      { params: { since, format: 'versions' } }
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
