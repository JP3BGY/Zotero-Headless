// @ts-nocheck
// Sync Engine - Sync Manager with Two-Way Sync
// See Zotero-Headless-Complete-Design.md Section 5

import { EventEmitter } from 'events';
import { getDatabase, getRawSQLite, libraries, items, collections, itemTags, syncLogs, attachments, webdavConfig, logDeletion, type Database } from '@zotero-headless/database';
import { ZoteroAPIClient } from '@zotero-headless/api';
import { appConfig, symbols } from '@zotero-headless/core';
import { ConflictResolver, conflictResolver } from './conflict.js';
import { PayloadBuilder } from './payload-builder.js';
import { parseItemData, parseRawJson } from '@zotero-headless/types';
import type { SyncOptions, SyncResult, Library, Item } from '@zotero-headless/types';
import { eq, gt, and, inArray, like, desc } from 'drizzle-orm';

export interface SyncConfig {
  maxRetries?: number;
  batchSize?: number;
  concurrency?: number;
  conflictStrategy?: 'local' | 'remote' | 'manual';
}

const DEFAULT_CONFIG: SyncConfig = {
  maxRetries: 3,
  batchSize: 50,
  concurrency: 5,
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
    // If syncAll is true, sync all libraries including groups
    if (options.syncAll) {
      return this.syncAllLibraries(options);
    }

    // If groupId is specified, sync that specific group
    if (options.groupId) {
      return this.syncGroupLibrary(options.groupId, options);
    }

    // Otherwise sync user library (default behavior)
    return this.syncUserLibrary(options);
  }

  /**
   * Sync user library (default) with auto-retry on 412 errors
   */
  private async syncUserLibrary(options: SyncOptions = {}): Promise<SyncResult> {
    this.emit('sync:start', { ...options, libraryType: 'user' });

    const maxRetries = 3;
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < maxRetries) {
      if (attempt > 0) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000); // Exponential backoff: 1s, 2s, 4s, max 8s
        console.log(`   Retrying sync in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      try {
        console.log('Verifying API key...');
        const keyInfo = await this.apiClient.verifyKey();
        console.log(`   Logged in as: ${keyInfo.username}`);

        const libraryId = options.libraryId ?? await this.ensureLibrary(keyInfo.userID, 'user', 'My Library');
        const library = await this.getLibrary(libraryId);
        const localVersion = library?.version ?? 0;
        const zoteroId = String(library?.zoteroId ?? keyInfo.userID);
        const remoteVersion = await this.apiClient.getLibraryVersion(zoteroId, 'user');

        console.log(`Versions - Local: ${localVersion}, Remote: ${remoteVersion}`);

        const unsyncedItems = await this.getUnsyncedItems(libraryId);
        const hasUnsyncedChanges = unsyncedItems.length > 0;

        // Check for unsynced collections too
        const unsyncedColCount = await this.db.select({ key: collections.key })
          .from(collections)
          .where(and(eq(collections.libraryId, libraryId), eq(collections.synced, false)))
          .all();
        const hasUnsyncedCollections = unsyncedColCount.length > 0;

        if (remoteVersion <= localVersion && !options.fullSync && !hasUnsyncedChanges && !hasUnsyncedCollections) {
          // Items are up to date, but still sync collections (lightweight version check)
          try {
            await this.syncCollections(libraryId, zoteroId, 'user', localVersion);
          } catch (e) {
            // Non-fatal: log but don't fail
          }
          console.log(`${symbols.success} Library is up to date!`);
          return { success: true, updated: 0, deleted: 0, errors: [] };
        }

        const result = await this.twoWaySync(libraryId, zoteroId, 'user', localVersion, remoteVersion, options.fullSync ?? false);
        await this.updateLibraryVersion(libraryId, remoteVersion);
        await this.logSync(libraryId, result.success ? 'success' : 'partial', localVersion, remoteVersion, result);

        this.emit('sync:complete', result);
        
        const parts: string[] = [];
        if (result.updated > 0) parts.push(`${result.updated} updated`);
        if (result.deleted > 0) parts.push(`${result.deleted} deleted`);
        if (parts.length === 0) parts.push('no changes');
        console.log(`${symbols.success} Sync complete: ${parts.join(', ')}`);

        // If we had conflicts but succeeded overall, report partial success
        if (result.conflicts && result.conflicts.length > 0) {
          console.log(`   !  ${result.conflicts.length} conflict(s) resolved automatically`);
        }

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const message = lastError.message;
        
        // Check if this is a 412 error that warrants a retry
        if (message.includes('412') || message.includes('Precondition Failed')) {
          attempt++;
          console.log(`   !  Sync conflict detected (412), will retry...`);
          
          // Refresh library version before retry
          try {
            const zoteroId = String((await this.getLibrary(options.libraryId ?? 1))?.zoteroId ?? '1');
            const freshVersion = await this.apiClient.getLibraryVersion(zoteroId, 'user');
            console.log(`   Remote version updated, restarting sync...`);
          } catch (e) {
            // Ignore version check errors
          }
          
          if (attempt < maxRetries) {
            continue; // Retry
          }
        } else {
          // Non-412 error, fail immediately
          console.error(`${symbols.error} Sync failed:`, message);
          return { success: false, updated: 0, deleted: 0, errors: [message] };
        }
      }
    }

    // All retries exhausted
    console.error(`${symbols.error} Sync failed after ${maxRetries} attempts:`, lastError?.message);
    return { 
      success: false, 
      updated: 0, 
      deleted: 0, 
      errors: [`Failed after ${maxRetries} attempts: ${lastError?.message}`] 
    };
  }

  /**
   * Sync a specific group library (public API)
   */
  async syncGroup(groupId: string, options: SyncOptions = {}): Promise<SyncResult> {
    return this.syncGroupLibrary(groupId, options);
  }

  /**
   * Sync a specific group library
   */
  private async syncGroupLibrary(groupId: string, options: SyncOptions = {}): Promise<SyncResult> {
    this.emit('sync:start', { ...options, libraryType: 'group', groupId });

    try {
      console.log(`Syncing group library: ${groupId}`);
      
      // Get group details
      const groupInfo = await this.apiClient.getGroup(groupId);
      const groupName = groupInfo.name;
      
      const libraryId = await this.ensureLibrary(groupId, 'group', groupName);
      const library = await this.getLibrary(libraryId);
      const localVersion = library?.version ?? 0;
      const remoteVersion = await this.apiClient.getLibraryVersion(groupId, 'group');

      console.log(`Versions - Local: ${localVersion}, Remote: ${remoteVersion}`);

      const unsyncedItems = await this.getUnsyncedItems(libraryId);
      const hasUnsyncedChanges = unsyncedItems.length > 0;

      if (remoteVersion <= localVersion && !options.fullSync && !hasUnsyncedChanges) {
        try {
          await this.syncCollections(libraryId, groupId, 'group', localVersion);
        } catch (e) {
          // Non-fatal
        }
        console.log(`${symbols.success} Group library is up to date!`);
        return { success: true, updated: 0, deleted: 0, errors: [] };
      }

      const result = await this.twoWaySync(libraryId, groupId, 'group', localVersion, remoteVersion, options.fullSync ?? false);
      await this.updateLibraryVersion(libraryId, remoteVersion);
      await this.logSync(libraryId, result.success ? 'success' : 'partial', localVersion, remoteVersion, result);

      this.emit('sync:complete', result);
      
      const parts: string[] = [];
      if (result.updated > 0) parts.push(`${result.updated} updated`);
      if (result.deleted > 0) parts.push(`${result.deleted} deleted`);
      if (parts.length === 0) parts.push('no changes');
      console.log(`${symbols.success} Group sync complete: ${parts.join(', ')}`);

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${symbols.error} Group sync failed:`, message);
      return { success: false, updated: 0, deleted: 0, errors: [message] };
    }
  }

  /**
   * Sync all libraries (user + all groups)
   */
  private async syncAllLibraries(options: SyncOptions = {}): Promise<SyncResult> {
    this.emit('sync:start', { ...options, syncAll: true });

    try {
      console.log('Verifying API key...');
      const keyInfo = await this.apiClient.verifyKey();
      console.log(`   Logged in as: ${keyInfo.username}`);

      let totalUpdated = 0;
      let totalDeleted = 0;
      const allErrors: string[] = [];

      // 1. Sync user library first
      console.log('\n=== Syncing User Library ===');
      const userResult = await this.syncUserLibrary({ ...options, syncAll: false });
      totalUpdated += userResult.updated;
      totalDeleted += userResult.deleted;
      allErrors.push(...userResult.errors);

      // 2. Get user's groups
      console.log('\n=== Fetching Groups ===');
      const groups = await this.getUserGroups();
      console.log(`   Found ${groups.length} groups`);

      // 3. Sync each group library
      for (const group of groups) {
        console.log(`\n=== Syncing Group: ${group.name} (${group.groupId}) ===`);
        const groupResult = await this.syncGroupLibrary(group.groupId, { ...options, syncAll: false });
        totalUpdated += groupResult.updated;
        totalDeleted += groupResult.deleted;
        allErrors.push(...groupResult.errors);
      }

      const overallResult: SyncResult = {
        success: allErrors.length === 0,
        updated: totalUpdated,
        deleted: totalDeleted,
        errors: allErrors
      };

      this.emit('sync:complete', overallResult);
      console.log(`\n${symbols.success} All libraries synced: ${totalUpdated} updated, ${totalDeleted} deleted`);
      
      return overallResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${symbols.error} Sync all failed:`, message);
      return { success: false, updated: 0, deleted: 0, errors: [message] };
    }
  }

  /**
   * Get user's groups from API and sync to local DB
   */
  async getUserGroups(): Promise<Array<{ groupId: string; name: string; accessLevel: string }>> {
    try {
      const keyInfo = await this.apiClient.verifyKey();
      const userId = keyInfo.userID;

      // Get groups from Zotero API
      const apiGroups = await this.apiClient.getGroups(userId);
      
      const groups: Array<{ groupId: string; name: string; accessLevel: string }> = [];

      for (const apiGroup of apiGroups) {
        const groupId = String(apiGroup.id);
        
        // Get detailed group info
        try {
          const groupDetails = await this.apiClient.getGroup(groupId);
          const access = keyInfo.access.groups?.[groupId];
          const accessLevel = access?.write ? 'write' : (access?.library ? 'read' : 'none');
          
          groups.push({
            groupId,
            name: groupDetails.name,
            accessLevel
          });

          // Ensure group library exists in local DB
          await this.ensureLibrary(groupId, 'group', groupDetails.name);
        } catch (e) {
          console.warn(`   !  Failed to get group details for ${groupId}`);
        }
      }

      return groups;
    } catch (error) {
      console.error(`${symbols.error} Failed to get user groups:`, error);
      return [];
    }
  }

  /**
   * Two-way sync: download changes + upload local changes
   */
  private async twoWaySync(
    libraryId: number,
    zoteroId: string,
    libraryType: 'user' | 'group' = 'user',
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
      console.log('\nPhase 1: Downloading from remote...');
      const sinceVersion = fullSync ? 0 : localVersion;
      const downloadResult = await this.downloadUpdates(libraryId, zoteroId, libraryType, sinceVersion);
      totalUpdated += downloadResult.updated;
      totalDeleted += downloadResult.deleted;
      errors.push(...downloadResult.errors);
      conflicts.push(...downloadResult.conflicts);
    } else {
      console.log('\nPhase 1: Skipped (local changes only)');
    }

    // ===== PHASE 2: Upload to remote =====
    console.log('\nPhase 2: Uploading local changes...');
    const uploadResult = await this.uploadChanges(libraryId, zoteroId, libraryType, remoteVersion);
    totalUpdated += uploadResult.updated;
    totalDeleted += uploadResult.deleted;
    errors.push(...uploadResult.errors);
    conflicts.push(...uploadResult.conflicts);

    // ===== PHASE 3: WebDAV sync (if autoSync enabled) =====
    const webdavConfig = await this.getWebDAVConfig();
    if (webdavConfig?.enabled && webdavConfig?.autoSync) {
      console.log('\nPhase 3: Syncing attachments to WebDAV (autoSync enabled)...');
      try {
        const { AttachmentManager } = await import('@zotero-headless/attachment-manager');
        const attachmentManager = new AttachmentManager();
        const webdavResult = await attachmentManager.syncAllToWebDAV();
        
        if (webdavResult.success) {
          console.log(`${symbols.success} WebDAV sync complete: ${webdavResult.synced} attachments synced`);
        } else {
          console.log(`   ! WebDAV sync completed with issues:`);
          webdavResult.errors.forEach(err => console.log(`      - ${err}`));
        }
      } catch (e: any) {
        console.log(`   ! WebDAV sync failed: ${e.message}`);
        console.log(`      Run "zotero webdav:sync" manually to retry`);
      }
    }

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
    libraryType: 'user' | 'group' = 'user',
    sinceVersion: number
  ): Promise<{ updated: number; deleted: number; errors: string[]; conflicts: string[] }> {
    let updated = 0;
    let deleted = 0;
    const errors: string[] = [];
    const conflicts: string[] = [];

    // 1. Get changed item versions
    const versionMap = await this.apiClient.getItemVersions(zoteroId, sinceVersion, libraryType);
    const changedKeys = Object.keys(versionMap);
    console.log(`   Found ${changedKeys.length} changed items`);

    // 2. Parallel download with batch processing
    const batchSize = this.config.batchSize ?? 50;
    const concurrency = this.config.concurrency ?? 5;
    
    console.log(`   Downloading with ${concurrency} parallel connections...`);
    
    for (let i = 0; i < changedKeys.length; i += batchSize) {
      const batch = changedKeys.slice(i, i + batchSize);
      
      try {
        // Fetch batch from API
        const apiItems = await this.apiClient.getItems(zoteroId, batch, libraryType);
        
        // Process batch in parallel with concurrency limit
        const chunkSize = Math.min(concurrency, apiItems.length);
        
        for (let j = 0; j < apiItems.length; j += chunkSize) {
          const chunk = apiItems.slice(j, j + chunkSize);
          
          await Promise.all(chunk.map(async (apiItem) => {
            try {
              const localItem = await this.getItemByKey(apiItem.key, libraryId);
              
              if (localItem && !localItem.synced) {
                // Conflict detected
                console.log(`   !  Conflict: ${apiItem.key}`);
                conflicts.push(apiItem.key);
                
                if (this.config.conflictStrategy === 'remote') {
                  await this.upsertItem(apiItem, libraryId);
                  updated++;
                }
              } else {
                // No conflict
                await this.upsertItem(apiItem, libraryId);
                updated++;
              }
            } catch (e) {
              console.error(`${symbols.error} Failed: ${apiItem.key}:`, e);
            }
          }));
        }
        
        // Progress update
        const progress = Math.min(i + batchSize, changedKeys.length);
        console.log(`   Progress: ${progress}/${changedKeys.length} items (${Math.floor(progress / changedKeys.length * 100)}%)`);
        
      } catch (e) {
        errors.push(`Batch ${Math.floor(i / batchSize) + 1} failed: ${e}`);
      }
    }

    // 3. Handle deletions
    const deletedData = await this.apiClient.getDeleted(zoteroId, sinceVersion, libraryType);
    deleted = deletedData.items.length;

    if (deleted > 0) {
      await this.softDeleteItems(deletedData.items, libraryId);
    }

    // 3b. Handle deleted collections
    if (deletedData.collections && deletedData.collections.length > 0) {
      console.log(`   Removing ${deletedData.collections.length} deleted collection(s)...`);
      for (const collKey of deletedData.collections) {
        await this.db.delete(collections)
          .where(and(eq(collections.key, collKey), eq(collections.libraryId, libraryId)))
          .run();
      }
    }

    // 4. Sync collections
    try {
      await this.syncCollections(libraryId, zoteroId, libraryType, sinceVersion);
    } catch (e) {
      console.error(`   ! Collection sync failed: ${e}`);
      errors.push(`Collection sync failed: ${e}`);
    }

    return { updated, deleted, errors, conflicts };
  }

  /**
   * Sync collections from remote
   */
  private async syncCollections(
    libraryId: number,
    zoteroId: string,
    libraryType: 'user' | 'group',
    sinceVersion: number
  ): Promise<void> {
    const db = this.db;
    const { eq, and, count, notInArray } = await import('drizzle-orm');

    // If no local collections exist yet, do a full collection sync from version 0
    const localCount = await db.select({ cnt: count() })
      .from(collections)
      .where(eq(collections.libraryId, libraryId))
      .get();
    const effectiveSince = (localCount?.cnt ?? 0) === 0 ? 0 : sinceVersion;

    // Get changed collection versions
    const versionMap = await this.apiClient.getCollectionVersions(zoteroId, effectiveSince, libraryType);
    const changedKeys = Object.keys(versionMap);

    if (changedKeys.length === 0 && effectiveSince > 0) {
      // No incremental changes — still reconcile to catch missed deletions
      // Fetch all remote collection keys
      const allRemoteVersions = await this.apiClient.getCollectionVersions(zoteroId, 0, libraryType);
      const remoteKeys = Object.keys(allRemoteVersions);
      if (remoteKeys.length > 0) {
        const deleted = await db.delete(collections)
          .where(and(
            eq(collections.libraryId, libraryId),
            notInArray(collections.key, remoteKeys)
          ))
          .run();
        if (deleted.changes > 0) {
          console.log(`   Removed ${deleted.changes} stale collection(s) not present on remote`);
        }
      }
      return;
    }

    console.log(`   Syncing ${changedKeys.length} collection(s)...`);

    // Fetch collection data
    const apiCollections = await this.apiClient.getCollections(zoteroId, changedKeys, libraryType);

    const now = Math.floor(Date.now() / 1000);

    for (const apiCol of apiCollections) {
      const data = (apiCol.data || {}) as Record<string, any>;
      const key = apiCol.key;
      const name = (data.name as string) || key;
      const parentKey = (data.parentCollection as string) || null;
      const version = apiCol.version;

      // Check if collection exists locally
      const existing = await db.select()
        .from(collections)
        .where(and(eq(collections.key, key), eq(collections.libraryId, libraryId)))
        .get();

      if (existing) {
        await db.update(collections)
          .set({
            name,
            parentKey: parentKey || null,
            version,
            synced: true,
            updatedAt: now,
            deleted: false,
            rawJson: JSON.stringify(apiCol),
          })
          .where(and(eq(collections.key, key), eq(collections.libraryId, libraryId)));
      } else {
        await db.insert(collections).values({
          key,
          libraryId,
          name,
          parentKey: parentKey || null,
          version,
          synced: true,
          createdAt: now,
          updatedAt: now,
          deleted: false,
          rawJson: JSON.stringify(apiCol),
        });
      }
    }

    // Reconcile: remove local collections not present on remote
    // Use the full remote version map if we fetched all (effectiveSince=0),
    // otherwise fetch all keys for reconciliation
    const allRemoteVersions = effectiveSince === 0
      ? versionMap
      : await this.apiClient.getCollectionVersions(zoteroId, 0, libraryType);
    const allRemoteKeys = Object.keys(allRemoteVersions);
    if (allRemoteKeys.length > 0) {
      const purged = await db.delete(collections)
        .where(and(
          eq(collections.libraryId, libraryId),
          notInArray(collections.key, allRemoteKeys)
        ))
        .run();
      if (purged.changes > 0) {
        console.log(`   Removed ${purged.changes} stale collection(s) not present on remote`);
      }
    }

    console.log(`   ${symbols.success} Synced ${apiCollections.length} collection(s)`);
  }

  /**
   * Download items in parallel with concurrency limit
   */
  private async downloadItemsParallel(
    items: any[],
    libraryId: number,
    concurrency: number
  ): Promise<{ updated: number; conflicts: string[] }> {
    const updated = 0;
    const conflicts: string[] = [];
    
    // Process items in chunks with concurrency limit
    for (let i = 0; i < items.length; i += concurrency) {
      const chunk = items.slice(i, i + concurrency);
      
      await Promise.all(chunk.map(async (apiItem) => {
        try {
          const localItem = await this.getItemByKey(apiItem.key, libraryId);
          
          if (localItem && !localItem.synced) {
            // Conflict detected
            conflicts.push(apiItem.key);
            
            if (this.config.conflictStrategy === 'remote') {
              await this.upsertItem(apiItem, libraryId);
            }
            // 'local' or 'manual' - skip, will handle later
          } else {
            // No conflict
            await this.upsertItem(apiItem, libraryId);
          }
        } catch (e) {
          console.error(`Failed to download item ${apiItem.key}:`, e);
        }
      }));
      
      // Progress update
      if (i + concurrency < items.length) {
        console.log(`   Downloaded ${Math.min(i + concurrency, items.length)}/${items.length} items...`);
      }
    }
    
    return { updated, conflicts };
  }

  /**
   * Upload local changes to remote
   */
  private async uploadChanges(
    libraryId: number,
    zoteroId: string,
    libraryType: 'user' | 'group' = 'user',
    baseVersion: number
  ): Promise<{ updated: number; deleted: number; errors: string[]; conflicts: string[] }> {
    let updated = 0;
    let deleted = 0;
    const errors: string[] = [];
    const conflicts: string[] = [];

    // 0. Upload new collections (version=0) before items, since items reference collection keys
    const newCollections = await this.db.select()
      .from(collections)
      .where(and(eq(collections.libraryId, libraryId), eq(collections.version, 0)))
      .all();

    if (newCollections.length > 0) {
      console.log(`   Uploading ${newCollections.length} new collection(s)...`);

      // Sort: parents before children (null parentKey first, then by dependency)
      const keySet = new Set(newCollections.map(c => c.key));
      const sorted: typeof newCollections = [];
      const pending = [...newCollections];
      const added = new Set<string>();

      // Iteratively resolve dependencies
      while (pending.length > 0) {
        const before = pending.length;
        for (let i = pending.length - 1; i >= 0; i--) {
          const c = pending[i];
          // Can add if: no parent, or parent is not a new collection, or parent already added
          if (!c.parentKey || !keySet.has(c.parentKey) || added.has(c.parentKey)) {
            sorted.push(c);
            added.add(c.key);
            pending.splice(i, 1);
          }
        }
        if (pending.length === before) {
          // Circular or unresolvable — add remaining as-is
          sorted.push(...pending);
          break;
        }
      }

      // Map from local key -> remote key (in case server reassigns)
      const collectionKeyMap = new Map<string, string>();

      for (const col of sorted) {
        try {
          // Resolve parentKey: could be a new local key that was remapped
          let remoteParentKey = col.parentKey || undefined;
          if (remoteParentKey && collectionKeyMap.has(remoteParentKey)) {
            remoteParentKey = collectionKeyMap.get(remoteParentKey);
          }

          const result = await this.apiClient.createCollection(
            zoteroId, col.name, remoteParentKey, libraryType
          );

          // API returns the created collection — extract the server key and version
          const serverKey = result?.key || col.key;
          const serverVersion = result?.version || 1;
          collectionKeyMap.set(col.key, serverKey);

          if (serverKey !== col.key) {
            // Server assigned a different key — update local DB and item references
            await this.db.update(collections)
              .set({ key: serverKey, version: serverVersion })
              .where(and(eq(collections.key, col.key), eq(collections.libraryId, libraryId)))
              .run();

            // Update child collections' parentKey
            await this.db.update(collections)
              .set({ parentKey: serverKey })
              .where(and(eq(collections.parentKey, col.key), eq(collections.libraryId, libraryId)))
              .run();

            // Update items' collectionKeys that reference the old key
            const affectedItems = await this.db.select({ key: items.key, collectionKeys: items.collectionKeys, rawJson: items.rawJson })
              .from(items)
              .where(and(eq(items.libraryId, libraryId), like(items.collectionKeys, `%${col.key}%`)))
              .all();

            for (const item of affectedItems) {
              const colKeys: string[] = JSON.parse(item.collectionKeys || '[]');
              const idx = colKeys.indexOf(col.key);
              if (idx !== -1) {
                colKeys[idx] = serverKey;
                let rawEnvelope: any;
                try { rawEnvelope = JSON.parse(item.rawJson); } catch { rawEnvelope = { data: {} }; }
                if (rawEnvelope.data) rawEnvelope.data.collections = colKeys;
                await this.db.update(items)
                  .set({
                    collectionKeys: JSON.stringify(colKeys),
                    rawJson: JSON.stringify(rawEnvelope),
                  })
                  .where(and(eq(items.key, item.key), eq(items.libraryId, libraryId)))
                  .run();
              }
            }

            console.log(`${symbols.success} Created collection "${col.name}" (key: ${col.key} -> ${serverKey})`);
          } else {
            await this.db.update(collections)
              .set({ version: serverVersion })
              .where(and(eq(collections.key, col.key), eq(collections.libraryId, libraryId)))
              .run();
            console.log(`${symbols.success} Created collection "${col.name}" (${serverKey})`);
          }
          updated++;
        } catch (e: any) {
          errors.push(`Create collection "${col.name}" failed: ${e.message || e}`);
        }
      }
    }

    // 1. Find unsynced items
    const unsyncedItems = await this.getUnsyncedItems(libraryId);
    console.log(`   Found ${unsyncedItems.length} unsynced items`);

    // Separate parent items and attachment items
    // Parent items must be uploaded before attachments (which reference them via parentItem)
    const parentItems = unsyncedItems.filter(item => {
      return parseItemData(item.rawJson).itemType !== 'attachment';
    });

    const attachmentItems = unsyncedItems.filter(item => {
      return parseItemData(item.rawJson).itemType === 'attachment';
    });

    if (attachmentItems.length > 0) {
      console.log(`   (${parentItems.length} parent items, ${attachmentItems.length} attachments)`);
    }

    // Upload parent items first
    for (const item of parentItems) {
      try {
        const rawEnvelope = parseRawJson(item.rawJson);
        let data = rawEnvelope.data;
        
        // Add key and version from item to data for new items
        if (item.version === 0 && item.key) {
          data.key = item.key;
          data.version = item.version;  // CRITICAL: must include version for key-based writes
        }

        // Parse creators if it's a string
        if (typeof data.creators === 'string') {
          try {
            data.creators = JSON.parse(data.creators);
          } catch (e) {
            data.creators = [];
          }
        }
        // Sanitize creators for Zotero API:
        // - fieldMode is internal, not accepted by API
        // - fieldMode=1 means single-name creator: use { name, creatorType }
        // - fieldMode=0 or absent means two-field: use { firstName, lastName, creatorType }
        if (Array.isArray(data.creators)) {
          data.creators = data.creators.map((c: any) => {
            const { fieldMode, ...rest } = c;
            if (fieldMode === 1 || (c.lastName && !c.firstName && !c.name)) {
              // Single-field creator (e.g., "BBC News")
              return { name: c.lastName || c.name || '', creatorType: c.creatorType || 'author' };
            }
            // Two-field creator: ensure firstName exists
            if (rest.lastName != null && rest.firstName == null) {
              rest.firstName = '';
            }
            return rest;
          });
        }

        // Parse tags if it's a string (stored as JSON in DB, needs to be array for API)
        if (typeof data.tags === 'string') {
          try {
            data.tags = JSON.parse(data.tags);
          } catch (e) {
            data.tags = [];
          }
        }
        // Ensure tags is always an array
        if (!Array.isArray(data.tags)) {
          data.tags = [];
        }

        // Remove metadata fields that shouldn't be sent
        // For 'key'-based writes, we must include 'version' property
        // CRITICAL: Never delete key for deleted items - they need it for the delete API call
        const isNewItem = item.version === 0;
        if (!isNewItem && !item.deleted) {
          delete data.key;  // Only delete key for existing items that are NOT being deleted
        }
        // Keep version for key-based writes
        // delete data.version;

        // Fix: Zotero API uses 'date' not 'publicationDate'
        if (data.publicationDate) {
          data.date = data.publicationDate;
          delete data.publicationDate;
        }

        // Remove fields that Zotero API doesn't accept (custom fields should be in 'extra')
        // Include 'key' for client-generated keys
        // CRITICAL: These fields must never be deleted for key-based writes
        const CRITICAL_FIELDS = new Set(['key', 'version', 'itemType']);
        const zoteroItemFields = [
          'key', 'itemType', 'title', 'creators', 'abstractNote', 'date', 'url', 'DOI',
          'accessDate', 'libraryCatalog', 'callNumber', 'rights', 'placeholder',
          'note', 'parentItem', 'tags', 'collections', 'relations', 'version'
        ];
        
        // Remove any custom/unknown fields, but NEVER remove critical fields
        const knownFields = new Set(zoteroItemFields);
        for (const field of Object.keys(data)) {
          // CRITICAL: Never delete key fields - they are required for API
          if (CRITICAL_FIELDS.has(field)) {
            continue;
          }
          if (!knownFields.has(field)) {
            delete data[field];
          }
        }
        
        // Runtime validation: Ensure critical fields are present
        // For existing items, 'key' is intentionally removed from data (it's passed via URL)
        const fieldsToCheck = isNewItem ? CRITICAL_FIELDS : new Set(['version', 'itemType']);
        const missingCriticalFields: string[] = [];
        for (const field of fieldsToCheck) {
          if (!(field in data) || data[field] === undefined || data[field] === null) {
            missingCriticalFields.push(field);
          }
        }

        if (missingCriticalFields.length > 0) {
          console.error(`🚨 CRITICAL VALIDATION ERROR: Missing required fields: ${missingCriticalFields.join(', ')}`);
          console.error(`   Item key: ${item.key}`);
          console.error(`   Available fields: ${Object.keys(data).join(', ')}`);
          throw new Error(`BUG: Cannot sync item without required fields: ${missingCriticalFields.join(', ')}`);
        }

        // Validate key format (for new items where key is in data, or always validate item.key)
        const keyToValidate = data.key || item.key;
        const keyPattern = /^[23456789ABCDEFGHIJKLMNPQRSTUVWXYZ]{8}$/;
        if (!keyPattern.test(keyToValidate)) {
          console.warn(`!  WARNING: Key format may be invalid: ${keyToValidate}`);
          console.warn(`   Expected format: 8 chars from [23456789ABCDEFGHIJKLMNPQRSTUVWXYZ]`);
        }

        if (item.deleted) {
          // Soft delete: move to remote trash via PATCH (not permanent delete)
          // The item stays in both local and remote trash until explicitly purged
          try {
            data.deleted = true;
            await this.apiClient.updateItem(zoteroId, item.key, data, item.version, libraryType);
            console.log(`${symbols.success} Trashed ${item.key} on remote`);
            await this.markAsSynced(item.key, libraryId);
            deleted++;
          } catch (e: any) {
            if (e.message?.includes('404')) {
              // Item doesn't exist on remote - just mark synced locally
              console.log(`    Item ${item.key} not found on remote, marking synced`);
              await this.markAsSynced(item.key, libraryId);
              deleted++;
            } else if (e.message?.includes('412')) {
              // Version conflict - get latest version and retry
              console.log(`   !  Version conflict for ${item.key}, fetching latest version...`);
              try {
                const remoteItem = await this.apiClient.getItem(zoteroId, item.key, libraryType);
                const remoteVersion = remoteItem?.data?.version || remoteItem?.version;
                if (remoteVersion) {
                  data.deleted = true;
                  await this.apiClient.updateItem(zoteroId, item.key, data, remoteVersion, libraryType);
                  console.log(`${symbols.success} Trashed ${item.key} on remote (resolved conflict)`);
                  // Update local version to match remote
                  await this.db.update(items)
                    .set({ version: remoteVersion + 1, synced: true })
                    .where(and(eq(items.key, item.key), eq(items.libraryId, libraryId)))
                    .run();
                  deleted++;
                } else {
                  errors.push(`Trash ${item.key} failed: could not resolve version conflict`);
                }
              } catch (retryError: any) {
                if (retryError.message?.includes('404')) {
                  console.log(`    Item ${item.key} already gone on remote`);
                  await this.markAsSynced(item.key, libraryId);
                  deleted++;
                } else {
                  errors.push(`Trash ${item.key} failed: ${retryError}`);
                }
              }
            } else {
              errors.push(`Trash ${item.key} failed: ${e}`);
            }
          }
        } else if (item.version === 0) {
          // Create new item
          console.log(`   Uploading new item with key: ${data.key || '(none)'}`);
          const result = await this.apiClient.createItems(zoteroId, [data], libraryType);
          if (result.successful && result.successful['0']) {
            const newKey = result.successful['0'].key || result.successful['0'];
            console.log(`${symbols.success} Created new item ${newKey}`);
            
            // 如果 key 改变了，先更新本地数据库中的 key
            if (newKey !== item.key) {
              console.warn(`   !  WARNING: Server reassigned key for item ${item.key} -> ${newKey}`);
              console.warn(`      This may indicate key collision or invalid key format.`);
              
              // 使用事务确保一致性
              await this.db.transaction(async (tx) => {
                // 1. 更新 items 表
                await tx.update(items)
                  .set({ key: newKey })
                  .where(and(eq(items.key, item.key), eq(items.libraryId, libraryId)))
                  .run();
                
                // 2. 更新 attachments 表的 parentItemKey 和 rawJson 中的 parentItem
                const affectedAttachments = await tx.select()
                  .from(attachments)
                  .where(and(
                    eq(attachments.parentItemKey, item.key),
                    eq(attachments.libraryId, libraryId)
                  ))
                  .all();

                for (const att of affectedAttachments) {
                  const updates: any = { parentItemKey: newKey };
                  try {
                    const attEnvelope = parseRawJson(att.rawJson);
                    if (attEnvelope.data.parentItem === item.key) {
                      attEnvelope.data.parentItem = newKey;
                      updates.rawJson = JSON.stringify(attEnvelope);
                    }
                  } catch (e) {
                    // ignore parse error
                  }
                  await tx.update(attachments)
                    .set(updates)
                    .where(and(
                      eq(attachments.key, att.key),
                      eq(attachments.libraryId, libraryId)
                    ))
                    .run();
                }

                if (affectedAttachments.length > 0) {
                  console.log(`   Updated ${affectedAttachments.length} attachment(s) parent reference`);
                }
                
                // 3. 更新子条目（notes 和 attachments）的 rawJson 中的 parentItem
                const childItems = await tx.select()
                  .from(items)
                  .where(and(
                    eq(items.libraryId, libraryId),
                    like(items.rawJson, `%"parentItem":"${item.key}"%`)
                  ))
                  .all();

                for (const child of childItems) {
                  try {
                    const childEnvelope = parseRawJson(child.rawJson);
                    if (childEnvelope.data.parentItem === item.key) {
                      childEnvelope.data.parentItem = newKey;
                      await tx.update(items)
                        .set({ rawJson: JSON.stringify(childEnvelope) })
                        .where(and(eq(items.key, child.key), eq(items.libraryId, libraryId)))
                        .run();
                    }
                  } catch (e) {
                    console.warn(`      Failed to update child ${child.key} parent reference: ${e}`);
                  }
                }

                if (childItems.length > 0) {
                  console.log(`   Updated ${childItems.length} child item(s) parent reference`);
                }
              });
              
              console.log(`   Updated local key: ${item.key} -> ${newKey}`);
            }
            
            // 使用新的 key 标记为已同步
            await this.markAsSynced(newKey, libraryId);
          } else if (result.failed && result.failed['0']) {
            console.log(`${symbols.error} Failed to create item: ${result.failed['0'].message}`);
          }
          updated++;
        } else {
          // Update existing item
          await this.apiClient.updateItem(zoteroId, item.key, data, item.version, libraryType);
          console.log(`${symbols.success} Updated ${item.key}`);
          updated++;
          
          // Mark as synced
          await this.markAsSynced(item.key, libraryId);
        }
      } catch (e: any) {
        if (e.message?.includes('412')) {
          // Conflict - remote was modified
          console.log(`   !  Conflict for ${item.key} (remote modified)`);
          
          if (this.config.conflictStrategy === 'remote') {
            // Fetch remote version and apply to local
            try {
              const remoteItem = await this.apiClient.getItem(zoteroId, item.key, libraryType);
              if (remoteItem) {
                await this.upsertItem(remoteItem, libraryId);
                console.log(`${symbols.success} Applied remote version for ${item.key}`);
              }
            } catch (fetchError) {
              console.error(`${symbols.error} Failed to fetch remote version for ${item.key}:`, fetchError);
              conflicts.push(item.key);
            }
          } else if (this.config.conflictStrategy === 'local') {
            // Force update with latest version from server
            try {
              const remoteItem = await this.apiClient.getItem(zoteroId, item.key, libraryType);
              const remoteVersion = remoteItem?.data?.version || item.version;
              await this.apiClient.updateItem(zoteroId, item.key, data, remoteVersion, libraryType);
              await this.markAsSynced(item.key, libraryId);
              console.log(`${symbols.success} Force updated ${item.key} with local changes`);
              updated++;
            } catch (forceError) {
              console.error(`${symbols.error} Failed to force update ${item.key}:`, forceError);
              conflicts.push(item.key);
            }
          } else {
            // Manual mode - record conflict for interactive resolution
            conflicts.push(item.key);
          }
        } else {
          errors.push(`Upload ${item.key} failed: ${e}`);
        }
      }
    }

    // Upload attachment items after all parent items are uploaded
    // This ensures parentItem references exist in Zotero
    for (const item of attachmentItems) {
      try {
        const attEnvelope = parseRawJson(item.rawJson);
        let data = attEnvelope.data;
        
        // Add key and version from item to data for new items
        if (item.version === 0 && item.key) {
          data.key = item.key;
          data.version = item.version;
        }

        // Ensure tags is an array
        if (typeof data.tags === 'string') {
          try {
            data.tags = JSON.parse(data.tags);
          } catch (e) {
            data.tags = [];
          }
        }
        if (!Array.isArray(data.tags)) {
          data.tags = [];
        }

        if (item.deleted) {
          // Soft delete: move attachment to remote trash via PATCH
          try {
            data.deleted = true;
            await this.apiClient.updateItem(zoteroId, item.key, data, item.version, libraryType);
            console.log(`${symbols.success} Trashed attachment ${item.key} on remote`);
            await this.markAsSynced(item.key, libraryId);
            deleted++;
          } catch (e: any) {
            if (e.message?.includes('404') || (e.message?.includes('412') && e.message?.includes('not found'))) {
              // Item doesn't exist on remote (deleted or parent cascaded)
              console.log(`    Attachment ${item.key} not found on remote, marking synced`);
              await this.markAsSynced(item.key, libraryId);
              deleted++;
            } else {
              errors.push(`Trash attachment ${item.key} failed: ${e}`);
            }
          }
        } else if (item.version === 0) {
          // Create new attachment item
          console.log(`   Creating attachment item: ${data.key} (parent: ${data.parentItem})`);
          try {
            const result = await this.apiClient.createItems(zoteroId, [data], libraryType);
            if (result.successful && result.successful['0']) {
              const newKey = result.successful['0'].key || result.successful['0'];
              console.log(`${symbols.success} Created attachment ${newKey}`);
              
              // Update local key if server reassigned
              if (newKey !== item.key) {
                await this.db.update(items)
                  .set({ key: newKey, synced: true, version: 1 })
                  .where(and(eq(items.key, item.key), eq(items.libraryId, libraryId)))
                  .run();
              } else {
                await this.markAsSynced(item.key, libraryId);
              }
              updated++;
            } else if (result.failed && result.failed['0']) {
              const errorMsg = result.failed['0'].message || 'Unknown error';
              console.error(`${symbols.error} Failed to create attachment ${item.key}: ${errorMsg}`);
              
              // Check if parent item doesn't exist
              if (errorMsg.includes('Parent item') && errorMsg.includes('not found')) {
                console.log(`   !  Parent item not synced yet, will retry on next sync`);
                // Don't mark as error, just skip for now
              } else {
                errors.push(`Create attachment ${item.key} failed: ${errorMsg}`);
              }
            }
          } catch (e: any) {
            console.error(`${symbols.error} Failed to create attachment ${item.key}:`, e.message);
            errors.push(`Create attachment ${item.key} failed: ${e}`);
          }
        } else {
          // Update existing attachment
          try {
            delete data.key; // Don't send key for updates
            await this.apiClient.updateItem(zoteroId, item.key, data, item.version, libraryType);
            await this.markAsSynced(item.key, libraryId);
            updated++;
            console.log(`${symbols.success} Updated attachment ${item.key}`);
          } catch (e: any) {
            errors.push(`Update attachment ${item.key} failed: ${e}`);
          }
        }
      } catch (e: any) {
        errors.push(`Process attachment ${item.key} failed: ${e}`);
      }
    }

    // Upload unsynced collections
    await this.uploadCollectionChanges(libraryId, zoteroId, libraryType, errors);

    return { updated, deleted, errors, conflicts };
  }

  /**
   * Upload locally modified collections to remote
   */
  private async uploadCollectionChanges(
    libraryId: number,
    zoteroId: string,
    libraryType: 'user' | 'group',
    errors: string[]
  ): Promise<void> {
    const unsyncedCollections = await this.db.select()
      .from(collections)
      .where(and(eq(collections.libraryId, libraryId), eq(collections.synced, false)))
      .all();

    if (unsyncedCollections.length === 0) return;

    console.log(`   Uploading ${unsyncedCollections.length} collection change(s)...`);

    for (const col of unsyncedCollections) {
      try {
        const data: { name: string; parentCollection?: string | false } = {
          name: col.name,
          parentCollection: col.parentKey || false,
        };

        const newVersion = await this.apiClient.updateCollection(
          zoteroId, col.key, data, col.version, libraryType
        );

        await this.db.update(collections)
          .set({
            version: newVersion,
            synced: true,
            updatedAt: Math.floor(Date.now() / 1000),
          })
          .where(and(eq(collections.key, col.key), eq(collections.libraryId, libraryId)));

        console.log(`   ${symbols.success} Synced collection "${col.name}"`);
      } catch (e: any) {
        errors.push(`Collection ${col.key} (${col.name}): ${e.message || e}`);
      }
    }
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
      data.deleted ? 1 : 0, // deleted: respect trash status from API
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

    // Sync tags to item_tags table
    const tags: Array<{ tag: string; type?: number }> = data.tags ?? [];
    if (tags.length > 0) {
      const now = Math.floor(Date.now() / 1000);
      // Clear existing tags for this item, then re-insert
      sqlite.prepare('DELETE FROM item_tags WHERE item_key = ? AND library_id = ?')
        .run(apiItem.key, libraryId);
      const tagStmt = sqlite.prepare(
        'INSERT OR IGNORE INTO item_tags (item_key, library_id, tag, tag_type, created_at) VALUES (?, ?, ?, ?, ?)'
      );
      for (const t of tags) {
        tagStmt.run(apiItem.key, libraryId, t.tag, t.type ?? 0, now);
      }
    }
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
   * Soft delete items and cascade delete their attachments
   */
  private async softDeleteItems(keys: string[], libraryId: number): Promise<void> {
    if (keys.length === 0) return;

    // First, mark attachments of these items as deleted (cascade delete)
    // Attachments have parentItemKey referencing these items
    for (const parentKey of keys) {
      const childAttachments = await this.db.select()
        .from(items)
        .where(and(
          eq(items.libraryId, libraryId),
          eq(items.itemType, 'attachment'),
          eq(items.rawJson, `%"parentItem":"${parentKey}"%`)
        ))
        .all();

      if (childAttachments.length > 0) {
        console.log(`    Cascading delete: ${childAttachments.length} attachment(s) of ${parentKey}`);
        for (const child of childAttachments) {
          await logDeletion({
            itemKey: child.key, libraryId, title: child.title,
            itemType: child.itemType, operationType: 'soft', caller: 'sync',
            rawJsonSnapshot: child.rawJson,
          });
        }
        await this.db.update(items)
          .set({ deleted: true, deletedAt: Math.floor(Date.now() / 1000), updatedAt: Math.floor(Date.now() / 1000), synced: false })
          .where(and(
            eq(items.libraryId, libraryId),
            eq(items.itemType, 'attachment'),
            eq(items.rawJson, `%"parentItem":"${parentKey}"%`)
          ))
          .run();
      }
    }

    // Log parent item deletions
    const parentItems = await this.db.select()
      .from(items)
      .where(and(eq(items.libraryId, libraryId), inArray(items.key, keys)))
      .all();
    for (const item of parentItems) {
      await logDeletion({
        itemKey: item.key, libraryId, title: item.title,
        itemType: item.itemType, operationType: 'soft', caller: 'sync',
        rawJsonSnapshot: item.rawJson,
      });
    }

    // Then mark the parent items as deleted
    await this.db.update(items)
      .set({ deleted: true, deletedAt: Math.floor(Date.now() / 1000), updatedAt: Math.floor(Date.now() / 1000), synced: false })
      .where(and(
        eq(items.libraryId, libraryId),
        inArray(items.key, keys)
      ))
      .run();
  }

  /**
   * Ensure library exists
   */
  private async ensureLibrary(
    zoteroId: string | number, 
    type: 'user' | 'group' = 'user', 
    name: string = 'My Library'
  ): Promise<number> {
    const zoteroIdStr = String(zoteroId);
    const existing = await this.db.select()
      .from(libraries)
      .where(and(
        eq(libraries.zoteroId, zoteroIdStr),
        eq(libraries.type, type)
      ))
      .get();

    if (existing) return existing.id;

    const result = await this.db.insert(libraries)
      .values({
        zoteroId: zoteroIdStr,
        type,
        name,
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

  /**
   * Get WebDAV configuration
   */
  private async getWebDAVConfig(): Promise<{ enabled: boolean; autoSync: boolean } | null> {
    try {
      const config = await this.db.select().from(webdavConfig).get();
      if (!config) return null;
      return { enabled: config.enabled, autoSync: config.autoSync };
    } catch (e) {
      return null;
    }
  }
}

// Export singleton
export const syncManager = new SyncManager();

// Type exports
export type { SyncOptions, SyncResult, SyncConfig } from './manager.js';
