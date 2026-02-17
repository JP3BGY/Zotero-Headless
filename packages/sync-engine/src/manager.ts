// @ts-nocheck
// Sync Engine - Sync Manager with Two-Way Sync
// See Zotero-Headless-Complete-Design.md Section 5

import { EventEmitter } from 'events';
import { getDatabase, getRawSQLite, libraries, items, collections, itemTags, syncLogs, type Database } from '@zotero-headless/database';
import { ZoteroAPIClient } from '@zotero-headless/api';
import { appConfig } from '@zotero-headless/core';
import { ConflictResolver, conflictResolver } from './conflict.js';
import type { SyncOptions, SyncResult, Library, Item } from '@zotero-headless/types';
import { eq, gt, and, inArray, like, desc } from 'drizzle-orm';

export interface SyncConfig {
  maxRetries?: number;
  batchSize?: number;
  conflictStrategy?: 'local' | 'remote' | 'manual';
}

const DEFAULT_CONFIG: SyncConfig = {
  maxRetries: 3,
  batchSize: 50,
  conflictStrategy: 'local',
};

export class SyncManager extends EventEmitter {
  private db: Database;
  private apiClient: ZoteroAPIClient;
  private conflictResolver: ConflictResolver;
  private config: SyncConfig;

  constructor(
    apiClient?: ZoteroAPIClient,
    config?: SyncConfig
  ) {
    super();
    this.db = getDatabase();
    this.apiClient = apiClient ?? new ZoteroAPIClient();
    this.conflictResolver = conflictResolver;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Main sync method - performs two-way sync
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
      const zoteroId = String(library?.zoteroId ?? keyInfo.userID);
      const remoteVersion = await this.apiClient.getLibraryVersion(zoteroId);

      console.log(`📊 Versions - Local: ${localVersion}, Remote: ${remoteVersion}`);

      // 4. Check for unsynced local changes (even if versions match)
      const unsyncedItems = await this.getUnsyncedItems(libraryId);
      const hasUnsyncedChanges = unsyncedItems.length > 0;

      if (remoteVersion <= localVersion && !options.fullSync && !hasUnsyncedChanges) {
        console.log('✅ Library is up to date!');
        return { success: true, updated: 0, deleted: 0, errors: [] };
      }

      // 5. Two-way sync
      const result = await this.twoWaySync(libraryId, zoteroId, localVersion, remoteVersion, options.fullSync ?? false, hasUnsyncedChanges);

      // 6. Update library version
      await this.updateLibraryVersion(libraryId, remoteVersion);

      // 7. Log sync result
      await this.logSync(libraryId, result.success ? 'success' : 'partial', localVersion, remoteVersion, result);

      this.emit('sync:complete', result);
      
      // 显示同步结果摘要
      const parts: string[] = [];
      if (result.updated > 0) parts.push(`${result.updated} updated`);
      if (result.deleted > 0) parts.push(`${result.deleted} deleted`);
      if (parts.length === 0) parts.push('no changes');
      
      console.log(`✅ Sync complete: ${parts.join(', ')}`);

      if (result.conflicts && result.conflicts.length > 0) {
        console.log(`⚠️  ${result.conflicts.length} conflicts detected`);
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('❌ Sync failed:', message);

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
   * Two-way sync: download changes + upload local changes
   */
  private async twoWaySync(
    libraryId: number,
    zoteroId: string,
    localVersion: number,
    remoteVersion: number,
    fullSync: boolean,
    skipDownload: boolean = false
  ): Promise<SyncResult> {
    let totalUpdated = 0;
    let totalDeleted = 0;
    const errors: string[] = [];
    const conflicts: string[] = [];

    // ===== PHASE 1: Download from remote =====
    if (!skipDownload) {
      console.log('\n📥 Phase 1: Downloading from remote...');
      // For full sync, use since=0 to get all items
      const sinceVersion = fullSync ? 0 : localVersion;
      const downloadResult = await this.downloadUpdates(libraryId, zoteroId, sinceVersion);
      totalUpdated += downloadResult.updated;
      totalDeleted += downloadResult.deleted;
      errors.push(...downloadResult.errors);
      conflicts.push(...downloadResult.conflicts);
    } else {
      console.log('\n📥 Phase 1: Skipped (local changes only)');
    }

    // ===== PHASE 2: Upload to remote =====
    console.log('\n📤 Phase 2: Uploading local changes...');
    const uploadResult = await this.uploadChanges(libraryId, zoteroId, remoteVersion);
    totalUpdated += uploadResult.updated;
    totalDeleted += uploadResult.deleted;
    errors.push(...uploadResult.errors);
    conflicts.push(...uploadResult.conflicts);

    return {
      success: errors.length === 0 && conflicts.length === 0,
      updated: totalUpdated,
      deleted: totalDeleted,
      errors,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
    };
  }

  /**
   * Download from remote updates
   */
  private async downloadUpdates(
    libraryId: number,
    zoteroId: string,
    sinceVersion: number
  ): Promise<{ updated: number; deleted: number; errors: string[]; conflicts: string[] }> {
    let updated = 0;
    let deleted = 0;
    const errors: string[] = [];
    const conflicts: string[] = [];

    // 1. Get changed item versions
    const versionMap = await this.apiClient.getItemVersions(zoteroId, sinceVersion);
    const changedKeys = Object.keys(versionMap);
    console.log(`   Found ${changedKeys.length} changed items`);

    // 2. Batch download and merge
    const batchSize = this.config.batchSize ?? 50;
    for (let i = 0; i < changedKeys.length; i += batchSize) {
      const batch = changedKeys.slice(i, i + batchSize);

      try {
        const apiItems = await this.apiClient.getItems(zoteroId, batch);

        for (const apiItem of apiItems) {
          // Check for conflict
          const localItem = await this.getItemByKey(apiItem.key, libraryId);

          if (localItem && !localItem.synced) {
            // Local has unsynced changes - potential conflict!
            console.log(`   ⚠️  Conflict detected for item ${apiItem.key}`);
            conflicts.push(apiItem.key);

            // Auto-resolve based on strategy
            if (this.config.conflictStrategy === 'remote') {
              // Accept remote, discard local
              await this.upsertItem(apiItem, libraryId);
              updated++;
            } else if (this.config.conflictStrategy === 'local') {
              // Keep local, will upload in Phase 2
              console.log(`   → Keeping local version for ${apiItem.key}`);
            }
            // 'manual' would require user input
          } else {
            // No conflict, just update
            await this.upsertItem(apiItem, libraryId);
            updated++;
          }
        }
      } catch (e) {
        errors.push(`Download batch ${Math.floor(i / batchSize) + 1} failed: ${e}`);
      }
    }

    // 3. Handle deletions
    const deletedData = await this.apiClient.getDeleted(zoteroId, sinceVersion);
    deleted = deletedData.items.length;

    if (deleted > 0) {
      await this.softDeleteItems(deletedData.items, libraryId);
    }

    return { updated, deleted, errors, conflicts };
  }

  /**
   * Upload local changes to remote
   */
  private async uploadChanges(
    libraryId: number,
    zoteroId: string,
    baseVersion: number
  ): Promise<{ updated: number; deleted: number; errors: string[]; conflicts: string[] }> {
    let updated = 0;
    let deleted = 0;
    const errors: string[] = [];
    const conflicts: string[] = [];

    // 1. Find unsynced items
    const unsyncedItems = await this.getUnsyncedItems(libraryId);
    console.log(`   Found ${unsyncedItems.length} unsynced items`);

    // 2. Upload each item
    for (const item of unsyncedItems) {
      try {
        const rawData = JSON.parse(item.rawJson);
        const data = rawData.data;

        // Remove metadata fields that shouldn't be sent
        delete data.key;
        delete data.version;

        if (item.deleted) {
          // Delete from remote
          await this.apiClient.deleteItem(zoteroId, item.key, item.version);
          console.log(`   🗑️  Deleted ${item.key} from remote`);
          // Also delete from local DB after successful remote deletion
          await this.db.delete(items)
            .where(and(eq(items.key, item.key), eq(items.libraryId, libraryId)))
            .run();
          deleted++;
        } else if (item.version === 0) {
          // Create new item
          const result = await this.apiClient.createItems(zoteroId, [data]);
          if (result.successful['0']) {
            console.log(`   ✅ Created new item ${result.successful['0']}`);
          }
          updated++;
        } else {
          // Update existing item
          await this.apiClient.updateItem(zoteroId, item.key, data, item.version);
          console.log(`   ✅ Updated ${item.key}`);
          updated++;
        }

        // Mark remaining non-deleted items as synced
        if (!item.deleted) {
          await this.markAsSynced(item.key, libraryId);
        }
      } catch (e: any) {
        if (e.message?.includes('412')) {
          // Conflict - remote was modified
          conflicts.push(item.key);
          console.log(`   ⚠️  Conflict for ${item.key} (remote modified)`);
        } else {
          errors.push(`Upload ${item.key} failed: ${e}`);
        }
      }
    }

    return { updated, deleted, errors, conflicts };
  }

  /**
   * Upsert item from API response
   * SQLite 不支持复合主键的 onConflictDoUpdate，使用 onConflictDoReplace
   */
  private async upsertItem(apiItem: any, libraryId: number): Promise<void> {
    const data = apiItem.data;
    
    // Parse dates from API response (ISO 8601 format)
    // 统一使用秒级 Unix 时间戳（不是毫秒）
    const createdAt = data.dateAdded 
      ? Math.floor(new Date(data.dateAdded).getTime() / 1000)
      : Math.floor(Date.now() / 1000);
    const updatedAt = data.dateModified 
      ? Math.floor(new Date(data.dateModified).getTime() / 1000)
      : Math.floor(Date.now() / 1000);

    // Use raw SQLite instance for INSERT OR REPLACE
    const sqlite = getRawSQLite();
    const stmt = sqlite.prepare(`
      INSERT OR REPLACE INTO items (
        key, library_id, version, synced, deleted,
        created_at, updated_at, item_type, title,
        publication_date, abstract, doi, url, isbn, issn,
        publisher, journal, volume, issue, pages,
        creators, collection_keys, tags, extra, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      apiItem.key,
      libraryId,
      apiItem.version,
      1, // synced = true
      0, // deleted = false
      createdAt,
      updatedAt,
      data.itemType ?? 'document',
      data.title ?? null,
      data.date ?? null,
      data.abstractNote ?? null,
      data.DOI ?? null,
      data.url ?? null,
      data.ISBN ?? null,
      data.ISSN ?? null,
      data.publisher ?? null,
      data.publicationTitle ?? null,
      data.volume ?? null,
      data.issue ?? null,
      data.pages ?? null,
      JSON.stringify(data.creators ?? []),
      JSON.stringify(data.collections ?? []),
      JSON.stringify(data.tags ?? []),
      JSON.stringify(data.extra ?? {}),
      JSON.stringify(apiItem)
    );
  }

  /**
   * Get item by key
   */
  private async getItemByKey(key: string, libraryId: number): Promise<Item | undefined> {
    return await this.db.select()
      .from(items)
      .where(and(eq(items.key, key), eq(items.libraryId, libraryId)))
      .get();
  }

  /**
   * Get unsynced items
   */
  private async getUnsyncedItems(libraryId: number): Promise<Item[]> {
    return await this.db.select()
      .from(items)
      .where(and(eq(items.libraryId, libraryId), eq(items.synced, false)))
      .all();
  }

  /**
   * Mark item as synced
   */
  private async markAsSynced(key: string, libraryId: number): Promise<void> {
    await this.db.update(items)
      .set({ synced: true })
      .where(and(eq(items.key, key), eq(items.libraryId, libraryId)))
      .run();
  }

  /**
   * Soft delete items
   */
  private async softDeleteItems(keys: string[], libraryId: number): Promise<void> {
    if (keys.length === 0) return;

    await this.db.update(items)
      .set({ deleted: true, updatedAt: Math.floor(Date.now() / 1000), synced: false })
      .where(and(
        eq(items.libraryId, libraryId),
        inArray(items.key, keys)
      ))
      .run();
  }

  /**
   * Ensure library exists
   */
  private async ensureLibrary(zoteroId: number): Promise<number> {
    const existing = await this.db.select()
      .from(libraries)
      .where(eq(libraries.zoteroId, String(zoteroId)))
      .get();

    if (existing) return existing.id;

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
   * Get library
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
      .set({ version, lastSyncAt: Math.floor(Date.now() / 1000) })
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
        startedAt: Math.floor(Date.now() / 1000),
        completedAt: Math.floor(Date.now() / 1000),
        status,
        remoteVersion,
        localVersion,
        itemsUpdated: result.updated,
        itemsDeleted: result.deleted,
        errorMessage: result.errors?.join('; ') ?? result.conflicts?.join('; ') ?? null,
      })
      .run();
  }
}

// Export singleton
export const syncManager = new SyncManager();

// Type exports
export type { SyncOptions, SyncResult, SyncConfig } from './manager.js';
