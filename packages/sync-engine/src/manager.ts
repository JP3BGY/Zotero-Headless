// Sync Engine - Sync Manager
// See Zotero-Headless-Complete-Design.md Section 5

import { EventEmitter } from 'events';
import { getDatabase, libraries, items, collections, itemTags, syncLogs, type Database } from '@zotero-headless/database';
import { ZoteroAPIClient } from '@zotero-headless/api';
import { appConfig } from '@zotero-headless/core';
import type { SyncOptions, SyncResult, Library, Item } from '@zotero-headless/types';
import { eq, gt, and, inArray, like, desc } from 'drizzle-orm';

export class SyncManager extends EventEmitter {
  private db: Database;
  private apiClient: ZoteroAPIClient;
  
  constructor(apiClient?: ZoteroAPIClient) {
    super();
    this.db = getDatabase();
    this.apiClient = apiClient ?? new ZoteroAPIClient();
  }
  
  /**
   * Main sync method - performs one-way sync from API to local
   */
  async sync(options: SyncOptions = {}): Promise<SyncResult> {
    this.emit('sync:start', options);
    
    try {
      // 1. Verify API key
      console.log('🔑 Verifying API key...');
      const keyInfo = await this.apiClient.verifyKey();
      console.log(`   Logged in as: ${keyInfo.username}`);
      
      // 2. Ensure library exists in local DB
      const libraryId = options.libraryId ?? await this.ensureLibrary(keyInfo.userID);
      
      // 3. Get local and remote versions
      const library = await this.getLibrary(libraryId);
      const localVersion = library?.version ?? 0;
      const remoteVersion = await this.apiClient.getLibraryVersion(String(library?.zoteroId ?? keyInfo.userID));
      
      console.log(`📊 Versions - Local: ${localVersion}, Remote: ${remoteVersion}`);
      
      // 4. If versions match and not full sync, skip
      if (remoteVersion <= localVersion && !options.fullSync) {
        console.log('✅ Library is up to date!');
        return { success: true, updated: 0, deleted: 0, errors: [] };
      }
      
      // 5. Perform incremental sync
      const result = await this.syncLibrary(libraryId, localVersion, remoteVersion, options.fullSync ?? false);
      
      // 6. Update library version
      await this.updateLibraryVersion(libraryId, remoteVersion);
      
      // 7. Log sync result
      await this.logSync(libraryId, 'success', localVersion, remoteVersion, result);
      
      this.emit('sync:complete', result);
      console.log(`✅ Sync complete: ${result.updated} updated, ${result.deleted} deleted`);
      
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('❌ Sync failed:', message);
      
      // Log error
      await this.logSync(options.libraryId ?? 1, 'failed', 0, 0, { 
        success: false, 
        updated: 0, 
        deleted: 0, 
        errors: [message] 
      });
      
      this.emit('sync:error', error);
      return { success: false, updated: 0, deleted: 0, errors: [message] };
    }
  }
  
  /**
   * Sync single library
   */
  private async syncLibrary(
    libraryId: number, 
    localVersion: number, 
    remoteVersion: number,
    fullSync: boolean
  ): Promise<SyncResult> {
    const zoteroId = String(appConfig.zotero.userId);
    let totalUpdated = 0;
    let totalDeleted = 0;
    const errors: string[] = [];
    
    // 1. Get changed item versions
    console.log('📥 Fetching item versions...');
    const versionMap = await this.apiClient.getItemVersions(zoteroId, localVersion);
    const changedKeys = Object.keys(versionMap);
    console.log(`   Found ${changedKeys.length} changed items`);
    
    // 2. Batch download and update items
    const batchSize = 50;
    for (let i = 0; i < changedKeys.length; i += batchSize) {
      const batch = changedKeys.slice(i, i + batchSize);
      console.log(`   Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(changedKeys.length / batchSize)}...`);
      
      try {
        const apiItems = await this.apiClient.getItems(zoteroId, batch);
        
        for (const apiItem of apiItems) {
          await this.upsertItem(apiItem, libraryId);
          totalUpdated++;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`Batch ${Math.floor(i / batchSize) + 1} failed: ${msg}`);
      }
    }
    
    // 3. Handle deletions
    console.log('🗑️ Checking for deletions...');
    const deletedData = await this.apiClient.getDeleted(zoteroId, localVersion);
    totalDeleted = deletedData.items.length;
    
    if (totalDeleted > 0) {
      console.log(`   Found ${totalDeleted} deleted items`);
      await this.softDeleteItems(deletedData.items, libraryId);
    }
    
    return {
      success: errors.length === 0,
      updated: totalUpdated,
      deleted: totalDeleted,
      errors,
    };
  }
  
  /**
   * Upsert item from API response
   */
  private async upsertItem(apiItem: any, libraryId: number): Promise<void> {
    const data = apiItem.data;
    const now = new Date();
    
    await this.db.insert(items).onConflictDoUpdate({
      target: [items.key, items.libraryId],
      set: {
        version: apiItem.version,
        updatedAt: now,
        deleted: false,
        itemType: data.itemType,
        title: data.title ?? null,
        publicationDate: data.date ?? null,
        abstract: data.abstractNote ?? null,
        doi: data.DOI ?? null,
        url: data.url ?? null,
        isbn: data.ISBN ?? null,
        issn: data.ISSN ?? null,
        publisher: data.publisher ?? null,
        journal: data.publicationTitle ?? null,
        volume: data.volume ?? null,
        issue: data.issue ?? null,
        pages: data.pages ?? null,
        creators: JSON.stringify(data.creators ?? []),
        collectionKeys: JSON.stringify(data.collections ?? []),
        tags: JSON.stringify(data.tags ?? []),
        rawJson: JSON.stringify(apiItem),
        synced: true,
      },
    }).run();
  }
  
  /**
   * Soft delete items
   */
  private async softDeleteItems(keys: string[], libraryId: number): Promise<void> {
    if (keys.length === 0) return;
    
    await this.db.update(items)
      .set({ deleted: true, updatedAt: new Date() })
      .where(and(
        eq(items.libraryId, libraryId),
        inArray(items.key, keys)
      ))
      .run();
  }
  
  /**
   * Ensure library exists in local DB
   */
  private async ensureLibrary(zoteroId: number): Promise<number> {
    const existing = await this.db.select()
      .from(libraries)
      .where(eq(libraries.zoteroId, String(zoteroId)))
      .get();
    
    if (existing) {
      return existing.id;
    }
    
    const result = await this.db.insert(libraries)
      .values({
        zoteroId: String(zoteroId),
        type: 'user',
        name: 'My Library',
        version: 0,
      })
      .returning({ id: libraries.id })
      .get();
    
    return result.id;
  }
  
  /**
   * Get library by ID
   */
  private async getLibrary(libraryId: number): Promise<Library | undefined> {
    return await this.db.select()
      .from(libraries)
      .where(eq(libraries.id, libraryId))
      .get();
  }
  
  /**
   * Update library version
   */
  private async updateLibraryVersion(libraryId: number, version: number): Promise<void> {
    await this.db.update(libraries)
      .set({ version, lastSyncAt: new Date() })
      .where(eq(libraries.id, libraryId))
      .run();
  }
  
  /**
   * Log sync result
   */
  private async logSync(
    libraryId: number, 
    status: 'success' | 'failed' | 'partial',
    localVersion: number,
    remoteVersion: number,
    result: SyncResult
  ): Promise<void> {
    await this.db.insert(syncLogs)
      .values({
        libraryId,
        startedAt: new Date(),
        completedAt: new Date(),
        status,
        remoteVersion,
        localVersion,
        itemsUpdated: result.updated,
        itemsDeleted: result.deleted,
        errorMessage: result.errors.join('; ') || null,
      })
      .run();
  }
}

// Export singleton
export const syncManager = new SyncManager();
