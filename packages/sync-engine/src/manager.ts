// @ts-nocheck
// Sync Engine - Sync Manager with Two-Way Sync
// See Zotero-Headless-Complete-Design.md Section 5

import { EventEmitter } from 'events';
import { getDatabase, getRawSQLite, libraries, items, collections, itemTags, syncLogs, attachments, webdavConfig, savedSearches, savedSearchConditions, logDeletion, type Database } from '@zotero-headless/database';
import { ZoteroAPIClient } from '@zotero-headless/api';
import { appConfig, symbols } from '@zotero-headless/core';
import { ConflictResolver, conflictResolver } from './conflict.js';
import { SyncCacheManager } from './sync-cache.js';
import { SyncQueueManager } from './sync-queue.js';
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

// Delay intervals for download restarts when library version changes mid-sync (in ms)
const DOWNLOAD_RESTART_DELAYS = [10000, 20000, 40000, 60000, 120000, 240000, 300000];
const MAX_DOWNLOAD_RESTARTS = 5;

export class SyncManager extends EventEmitter {
  private db: Database;
  private apiClient: ZoteroAPIClient;
  private conflictResolver: ConflictResolver;
  private syncCache: SyncCacheManager;
  private syncQueue: SyncQueueManager;
  private config: SyncConfig;

  constructor(
    apiClient?: ZoteroAPIClient,
    config?: SyncConfig
  ) {
    super();
    this.db = getDatabase();
    this.apiClient = apiClient ?? new ZoteroAPIClient();
    this.conflictResolver = conflictResolver;
    this.syncCache = new SyncCacheManager();
    this.syncQueue = new SyncQueueManager();
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

        // Handle resetMode before normal sync
        if (options.resetMode === 'fromLocal') {
          await this._restoreToServer(libraryId, zoteroId, 'user');
          return { success: true, updated: 0, deleted: 0, errors: [] };
        } else if (options.resetMode === 'fromServer') {
          // Wipe local and download everything
          const sqlite = getRawSQLite();
          this.syncCache.clearForLibrary(libraryId);
          this.syncQueue.clearForLibrary(libraryId);
          sqlite.prepare('DELETE FROM items WHERE library_id = ?').run(libraryId);
          sqlite.prepare('DELETE FROM collections WHERE library_id = ?').run(libraryId);
          sqlite.prepare('DELETE FROM saved_searches WHERE library_id = ?').run(libraryId);
          sqlite.prepare('DELETE FROM synced_settings WHERE library_id = ?').run(libraryId);
          sqlite.prepare('DELETE FROM attachments WHERE library_id = ?').run(libraryId);
          await this.updateLibraryVersion(libraryId, 0);
          options.fullSync = true;
        }

        const unsyncedItems = await this.getUnsyncedItems(libraryId);
        const hasUnsyncedChanges = unsyncedItems.length > 0;

        // Check for unsynced collections too
        const unsyncedColCount = await this.db.select({ key: collections.key })
          .from(collections)
          .where(and(eq(collections.libraryId, libraryId), eq(collections.synced, false)))
          .all();
        const hasUnsyncedCollections = unsyncedColCount.length > 0;

        if (remoteVersion <= localVersion && !options.fullSync && !hasUnsyncedChanges && !hasUnsyncedCollections) {
          // Items are up to date, but still sync collections/searches/settings
          try { await this.syncSettings(libraryId, zoteroId, 'user', localVersion); } catch { /* non-fatal */ }
          try { await this.syncCollections(libraryId, zoteroId, 'user', localVersion); } catch { /* non-fatal */ }
          try { await this.syncSearches(libraryId, zoteroId, 'user', localVersion); } catch { /* non-fatal */ }
          console.log(`${symbols.success} Library is up to date!`);
          return { success: true, updated: 0, deleted: 0, errors: [] };
        }

        const result = await this.twoWaySync(libraryId, zoteroId, 'user', localVersion, remoteVersion, options.fullSync ?? false);
        // Re-fetch the actual current library version (uploads may have incremented it)
        const finalVersion = await this.apiClient.getLibraryVersion(zoteroId, 'user');
        await this.updateLibraryVersion(libraryId, finalVersion);
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
   * Two-way sync: upload first, then download, with restart-on-conflict.
   * Matches official Zotero's sync loop (syncEngine.js:138-220).
   */
  private async twoWaySync(
    libraryId: number,
    zoteroId: string,
    libraryType: 'user' | 'group' = 'user',
    localVersion: number,
    remoteVersion: number,
    fullSync: boolean,
    skipDownload: boolean = false,
    restartCount: number = 0
  ): Promise<SyncResult> {
    let totalUpdated = 0;
    let totalDeleted = 0;
    const errors: string[] = [];
    const conflicts: string[] = [];

    // ===== PHASE 1: Upload local changes first =====
    // Upload first reduces conflict chance (official Zotero pattern)
    console.log('\nPhase 1: Uploading local changes...');
    const uploadResult = await this.uploadChanges(libraryId, zoteroId, libraryType, remoteVersion);
    totalUpdated += uploadResult.updated;
    totalDeleted += uploadResult.deleted;
    errors.push(...uploadResult.errors);
    conflicts.push(...uploadResult.conflicts);

    // If upload detected a library-level conflict (412 with changed library version),
    // restart the entire sync cycle. Mirrors official Zotero's UPLOAD_RESULT_LIBRARY_CONFLICT.
    if (uploadResult.needsRestart) {
      if (restartCount >= 3) {
        errors.push('Upload restart limit reached (3 restarts) — stopping');
        return { success: false, updated: totalUpdated, deleted: totalDeleted, errors, conflicts: conflicts.length > 0 ? conflicts : undefined };
      }
      console.log(`   Restarting sync cycle (attempt ${restartCount + 2}/4)...`);
      const freshVersion = await this.apiClient.getLibraryVersion(zoteroId, libraryType);
      return this.twoWaySync(libraryId, zoteroId, libraryType, localVersion, freshVersion, fullSync, skipDownload, restartCount + 1);
    }

    // ===== PHASE 2: Download from remote (with restart-on-version-change) =====
    if (!skipDownload) {
      console.log('\nPhase 2: Downloading from remote...');
      const sinceVersion = fullSync ? 0 : localVersion;
      let downloadRestarts = 0;

      while (downloadRestarts < MAX_DOWNLOAD_RESTARTS) {
        const downloadResult = await this.downloadUpdates(libraryId, zoteroId, libraryType, sinceVersion);

        if (downloadResult.restart) {
          downloadRestarts++;
          if (downloadRestarts >= MAX_DOWNLOAD_RESTARTS) {
            errors.push(`Download failed: library version changed ${MAX_DOWNLOAD_RESTARTS} times during sync`);
            break;
          }
          const delay = DOWNLOAD_RESTART_DELAYS[Math.min(downloadRestarts - 1, DOWNLOAD_RESTART_DELAYS.length - 1)];
          console.log(`   Restarting download in ${delay / 1000}s (attempt ${downloadRestarts + 1}/${MAX_DOWNLOAD_RESTARTS})...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // Handle 409 → full sync reconciliation
        if (downloadResult.needsFullSync) {
          try {
            const lastVersion = await this._fullSync(libraryId, zoteroId, libraryType);
            await this.updateLibraryVersion(libraryId, lastVersion);
          } catch (e) {
            errors.push(`Full sync reconciliation failed: ${e}`);
          }
        }

        totalUpdated += downloadResult.updated;
        totalDeleted += downloadResult.deleted;
        errors.push(...downloadResult.errors);
        conflicts.push(...downloadResult.conflicts);
        break;
      }
    } else {
      console.log('\nPhase 2: Skipped (local changes only)');
    }

    // ===== PHASE 2b: Full-text content sync =====
    try {
      const ftSinceVersion = fullSync ? 0 : localVersion;
      await this.syncFulltext(libraryId, zoteroId, libraryType, ftSinceVersion);
    } catch (e) {
      console.log(`   ! Full-text sync failed: ${e}`);
      // Non-fatal — fulltext can always retry later
    }

    // ===== PHASE 3: WebDAV sync (if autoSync enabled) =====
    const webdavCfg = await this.getWebDAVConfig();
    if (webdavCfg?.enabled && webdavCfg?.autoSync) {
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

    // Purge old cache versions periodically
    try {
      this.syncCache.purgeOldVersions('item', libraryId);
      this.syncCache.purgeOldVersions('collection', libraryId);
      this.syncCache.purgeOldVersions('search', libraryId);
    } catch { /* non-fatal */ }

    return {
      success: errors.length === 0 && conflicts.length === 0,
      updated: totalUpdated,
      deleted: totalDeleted,
      errors,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
    };
  }

  /**
   * Download remote updates with:
   * - Library version change detection (restarts if remote changed mid-download)
   * - Top-level items first (prevents missing-parent errors)
   * - Three-way merge via sync cache (field-level conflict resolution)
   * - Batch transaction safety (atomic per-batch writes)
   * - Sync queue integration (failed items queued for retry)
   */
  private async downloadUpdates(
    libraryId: number,
    zoteroId: string,
    libraryType: 'user' | 'group' = 'user',
    sinceVersion: number
  ): Promise<{ updated: number; deleted: number; errors: string[]; conflicts: string[]; restart?: boolean; needsFullSync?: boolean }> {
    let updated = 0;
    let deleted = 0;
    const errors: string[] = [];
    const conflicts: string[] = [];

    // 1. Get changed item versions (top-level first to ensure parents exist before children)
    const { versions: topVersionMap, libraryVersion: newLibraryVersion } =
      await this.apiClient.getItemVersions(zoteroId, sinceVersion, libraryType, { top: true });
    const topKeys = Object.keys(topVersionMap);

    // Also get all changed versions (includes children)
    const { versions: allVersionMap, libraryVersion: allLibVersion } =
      await this.apiClient.getItemVersions(zoteroId, sinceVersion, libraryType);

    // Check for library version change between the two calls
    if (allLibVersion !== newLibraryVersion) {
      console.log('   Library version changed during version fetch -- requesting restart');
      return { updated: 0, deleted: 0, errors: [], conflicts: [], restart: true };
    }

    // Child keys = all keys minus top-level keys
    const topKeySet = new Set(topKeys);
    const childKeys = Object.keys(allVersionMap).filter(k => !topKeySet.has(k));

    // Include queued items that are due for retry
    const queuedKeys = this.syncQueue.getDueForRetry('item', libraryId);
    if (queuedKeys.length > 0) {
      console.log(`   Retrying ${queuedKeys.length} queued item(s)`);
    }

    // Build ordered download list: top-level first, then children, then queued
    const allKeys = [...new Set([...topKeys, ...childKeys, ...queuedKeys])];
    console.log(`   Found ${allKeys.length} items to download (${topKeys.length} top-level, ${childKeys.length} children, ${queuedKeys.length} queued)`);

    // 2. Download and process in batches with transaction safety
    const batchSize = this.config.batchSize ?? 50;

    for (let i = 0; i < allKeys.length; i += batchSize) {
      const batch = allKeys.slice(i, i + batchSize);

      try {
        const { items: apiItems, libraryVersion: batchLibVersion } =
          await this.apiClient.getItems(zoteroId, batch, libraryType);

        // Check for library version change
        if (batchLibVersion !== newLibraryVersion) {
          console.log('   Library version changed during download -- requesting restart');
          return { updated, deleted, errors, conflicts, restart: true };
        }

        // Process entire batch in a single SQLite transaction for atomicity
        const sqlite = getRawSQLite();
        const batchResult = { batchUpdated: 0, batchConflicts: [] as string[], batchQueued: [] as string[] };

        const processBatch = sqlite.transaction(() => {
          for (const apiItem of apiItems) {
            try {
              const result = this.processDownloadedItem(apiItem, libraryId, sqlite);
              if (result.updated) batchResult.batchUpdated++;
              if (result.conflict) batchResult.batchConflicts.push(apiItem.key);
              if (result.queued) batchResult.batchQueued.push(apiItem.key);
            } catch (e) {
              // Item failed within transaction — queue for retry
              batchResult.batchQueued.push(apiItem.key);
            }
          }
        });
        processBatch();

        updated += batchResult.batchUpdated;
        conflicts.push(...batchResult.batchConflicts);

        // Queue failed items for retry (outside transaction)
        if (batchResult.batchQueued.length > 0) {
          this.syncQueue.enqueue('item', libraryId, batchResult.batchQueued);
        }

        // Dequeue successfully processed items
        const successKeys = apiItems
          .map(item => item.key)
          .filter(k => !batchResult.batchQueued.includes(k) && !batchResult.batchConflicts.includes(k));
        if (successKeys.length > 0) {
          this.syncQueue.dequeue('item', libraryId, successKeys);
        }

        // Remove keys that were requested but not returned by API (missing remotely)
        // Prevents them from being retried forever in the sync queue
        const returnedKeys = new Set(apiItems.map(item => item.key));
        const missingKeys = batch.filter(k => !returnedKeys.has(k));
        if (missingKeys.length > 0) {
          this.syncQueue.dequeue('item', libraryId, missingKeys);
        }

        // Progress update
        const progress = Math.min(i + batchSize, allKeys.length);
        console.log(`   Progress: ${progress}/${allKeys.length} items (${Math.floor(progress / allKeys.length * 100)}%)`);

      } catch (e) {
        errors.push(`Batch ${Math.floor(i / batchSize) + 1} failed: ${e}`);
      }
    }

    // 3. Handle deletions (with 409 detection)
    try {
      const { deleted: deletedData, libraryVersion: delLibVersion } =
        await this.apiClient.getDeleted(zoteroId, sinceVersion, libraryType);

      if (delLibVersion !== newLibraryVersion) {
        console.log('   Library version changed during deletion fetch -- requesting restart');
        return { updated, deleted, errors, conflicts, restart: true };
      }

      if (deletedData.items.length > 0) {
        const delResult = await this.processRemoteDeletions(deletedData.items, libraryId);
        deleted = delResult.deleted;
        conflicts.push(...delResult.conflicts);
      }

      // 3b. Handle deleted collections (with conflict detection)
      if (deletedData.collections && deletedData.collections.length > 0) {
        console.log(`   Processing ${deletedData.collections.length} remotely deleted collection(s)...`);
        const colDelResult = await this.processRemoteCollectionDeletions(deletedData.collections, libraryId);
        deleted += colDelResult.deleted;
        conflicts.push(...colDelResult.conflicts);
      }

      // 3c. Handle deleted searches (with conflict detection)
      if (deletedData.searches && deletedData.searches.length > 0) {
        console.log(`   Processing ${deletedData.searches.length} remotely deleted search(es)...`);
        const searchDelResult = await this.processRemoteSearchDeletions(deletedData.searches, libraryId);
        deleted += searchDelResult.deleted;
        conflicts.push(...searchDelResult.conflicts);
      }

      // 3d. Handle deleted settings
      if (deletedData.settings && deletedData.settings.length > 0) {
        const sqlite = getRawSQLite();
        for (const settingKey of deletedData.settings) {
          sqlite.prepare('DELETE FROM synced_settings WHERE setting = ? AND library_id = ?')
            .run(settingKey, libraryId);
        }
      }
    } catch (e: any) {
      if (e.message?.includes('409')) {
        console.log('   Delete log too old (409) -- triggering full sync reconciliation');
        return { updated, deleted, errors, conflicts, needsFullSync: true };
      }
      throw e;
    }

    // 4. Sync settings
    try {
      await this.syncSettings(libraryId, zoteroId, libraryType, sinceVersion);
    } catch (e) {
      errors.push(`Settings sync failed: ${e}`);
    }

    // 5. Sync collections
    try {
      await this.syncCollections(libraryId, zoteroId, libraryType, sinceVersion);
    } catch (e) {
      console.error(`   ! Collection sync failed: ${e}`);
      errors.push(`Collection sync failed: ${e}`);
    }

    // 6. Sync searches
    try {
      await this.syncSearches(libraryId, zoteroId, libraryType, sinceVersion);
    } catch (e) {
      errors.push(`Search sync failed: ${e}`);
    }

    return { updated, deleted, errors, conflicts };
  }

  /**
   * Process a single downloaded item with three-way merge conflict resolution.
   * Called within a SQLite transaction for atomicity.
   * Returns { updated, conflict, queued } flags.
   */
  private processDownloadedItem(
    apiItem: any,
    libraryId: number,
    sqlite: any
  ): { updated: boolean; conflict: boolean; queued: boolean } {
    // Check for existing local item
    const localRow = sqlite.prepare(
      'SELECT key, version, synced, raw_json FROM items WHERE key = ? AND library_id = ?'
    ).get(apiItem.key, libraryId) as { key: string; version: number; synced: number; raw_json: string } | undefined;

    if (!localRow || localRow.synced) {
      // Check if item was hard-deleted locally by user (not by sync)
      // Mirrors official Zotero's getDateDeleted check (syncLocal.js:1059-1107)
      if (!localRow) {
        const deletionEntry = sqlite.prepare(
          `SELECT caller FROM deletion_log
           WHERE item_key = ? AND library_id = ? AND caller != 'sync'
           ORDER BY deleted_at DESC LIMIT 1`
        ).get(apiItem.key, libraryId) as { caller: string } | undefined;

        if (deletionEntry) {
          // User deleted this item locally, but remote has a modified version
          if (this.config.conflictStrategy === 'remote') {
            // Re-create from remote
            this.upsertItemRaw(apiItem, libraryId, sqlite);
            this.syncCache.save('item', libraryId, apiItem);
            this.logConflict({ key: apiItem.key, libraryId, objectType: 'item', conflictType: 'download', resolvedBy: 'remote' });
            return { updated: true, conflict: true, queued: false };
          } else {
            // 'local' or 'manual': respect local deletion, skip download
            return { updated: false, conflict: true, queued: false };
          }
        }
      }

      // No local item, or local is synced (no local changes) — just upsert
      this.upsertItemRaw(apiItem, libraryId, sqlite);
      this.syncCache.save('item', libraryId, apiItem);
      return { updated: true, conflict: false, queued: false };
    }

    // Local has unsynced changes — attempt three-way merge
    const cachedSnapshot = this.syncCache.get('item', libraryId, apiItem.key, localRow.version);

    if (cachedSnapshot) {
      // Three-way merge: cached (base) vs local vs remote
      const baseData = (cachedSnapshot as any).data ?? cachedSnapshot;
      let localData: Record<string, unknown>;
      try {
        const parsed = JSON.parse(localRow.raw_json);
        localData = parsed.data ?? parsed;
      } catch {
        localData = {};
      }
      const remoteData = apiItem.data;

      const mergeResult = this.conflictResolver.resolveForSync(baseData, localData, remoteData);

      if (mergeResult.type === 'resolved') {
        // Auto-merged successfully — upsert the merged result
        const mergedApiItem = { ...apiItem, data: { ...mergeResult.data } };
        // Preserve remote metadata fields
        mergedApiItem.data.version = apiItem.data.version;
        mergedApiItem.data.dateAdded = apiItem.data.dateAdded;
        mergedApiItem.data.dateModified = apiItem.data.dateModified;
        this.upsertItemRaw(mergedApiItem, libraryId, sqlite, mergeResult.localChanged);
        this.syncCache.save('item', libraryId, mergedApiItem);
        return { updated: true, conflict: false, queued: false };
      } else {
        // Has conflicts — apply merge result but mark as unresolved
        if (this.config.conflictStrategy === 'remote') {
          this.upsertItemRaw(apiItem, libraryId, sqlite);
          this.syncCache.save('item', libraryId, apiItem);
          return { updated: true, conflict: true, queued: false };
        } else if (this.config.conflictStrategy === 'local') {
          // Keep local version, don't overwrite. Save remote to cache for next merge.
          this.syncCache.save('item', libraryId, apiItem);
          return { updated: false, conflict: true, queued: false };
        } else {
          // Manual — record conflict, keep local for now
          this.syncCache.save('item', libraryId, apiItem);
          return { updated: false, conflict: true, queued: false };
        }
      }
    } else {
      // No cache — use two-way reconciliation (conservative)
      let localData: Record<string, unknown>;
      try {
        const parsed = JSON.parse(localRow.raw_json);
        localData = parsed.data ?? parsed;
      } catch {
        localData = {};
      }
      const remoteData = apiItem.data;

      const mergeResult = this.conflictResolver.resolveWithoutCache(localData, remoteData);

      if (mergeResult.type === 'resolved') {
        const mergedApiItem = { ...apiItem, data: { ...mergeResult.data } };
        mergedApiItem.data.version = apiItem.data.version;
        mergedApiItem.data.dateAdded = apiItem.data.dateAdded;
        mergedApiItem.data.dateModified = apiItem.data.dateModified;
        this.upsertItemRaw(mergedApiItem, libraryId, sqlite, mergeResult.localChanged);
        this.syncCache.save('item', libraryId, mergedApiItem);
        return { updated: true, conflict: false, queued: false };
      } else {
        // Without cache, scalar conflicts exist
        if (this.config.conflictStrategy === 'remote') {
          this.upsertItemRaw(apiItem, libraryId, sqlite);
          this.syncCache.save('item', libraryId, apiItem);
          return { updated: true, conflict: true, queued: false };
        } else {
          this.syncCache.save('item', libraryId, apiItem);
          return { updated: false, conflict: true, queued: false };
        }
      }
    }
  }

  /**
   * Raw SQLite upsert for use within transactions.
   * If localChanged is true, marks item as synced=false (has remaining local changes to upload).
   */
  private upsertItemRaw(apiItem: any, libraryId: number, sqlite: any, localChanged: boolean = false): void {
    const data = apiItem.data;
    const createdAt = data.dateAdded
      ? Math.floor(new Date(data.dateAdded).getTime() / 1000)
      : Math.floor(Date.now() / 1000);
    const updatedAt = data.dateModified
      ? Math.floor(new Date(data.dateModified).getTime() / 1000)
      : Math.floor(Date.now() / 1000);

    sqlite.prepare(`
      INSERT OR REPLACE INTO items (
        key, library_id, version, synced, deleted,
        created_at, updated_at, item_type, title,
        publication_date, abstract, doi, url, isbn, issn,
        publisher, journal, volume, issue, pages,
        creators, collection_keys, tags, extra, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      apiItem.key,
      libraryId,
      apiItem.version,
      localChanged ? 0 : 1, // synced: false if local has remaining changes
      data.deleted ? 1 : 0,
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

    // Sync attachment metadata
    if (data.itemType === 'attachment' && data.parentItem) {
      const linkMode = data.linkMode ?? '';
      const webdavPath = (linkMode === 'imported_file' || linkMode === 'imported_url')
        ? `${apiItem.key}.zip` : null;
      sqlite.prepare(`
        INSERT OR REPLACE INTO attachments (
          key, parent_item_key, library_id, filename, content_type,
          file_type, path, url, version, created_at, updated_at,
          deleted, size, md5, webdav_path, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        apiItem.key,
        data.parentItem,
        libraryId,
        data.filename ?? data.title ?? null,
        data.contentType ?? null,
        linkMode || null,
        null,
        data.url ?? null,
        apiItem.version,
        createdAt,
        updatedAt,
        data.deleted ? 1 : 0,
        null,
        data.md5 ?? null,
        webdavPath,
        JSON.stringify(apiItem),
      );
    }

    // Sync tags
    const tags: Array<{ tag: string; type?: number }> = data.tags ?? [];
    if (tags.length > 0) {
      const now = Math.floor(Date.now() / 1000);
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
    const { versions: versionMap } = await this.apiClient.getCollectionVersions(zoteroId, effectiveSince, libraryType);
    const changedKeys = Object.keys(versionMap);

    if (changedKeys.length === 0 && effectiveSince > 0) {
      // No incremental changes — still reconcile to catch missed deletions
      // Fetch all remote collection keys
      const { versions: allRemoteVersions } = await this.apiClient.getCollectionVersions(zoteroId, 0, libraryType);
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
    const { collections: apiCollections } = await this.apiClient.getCollections(zoteroId, changedKeys, libraryType);

    const now = Math.floor(Date.now() / 1000);
    const restoredCollectionKeys: string[] = [];

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
        // Track restored collections (previously deleted locally, now arriving from remote)
        if (existing.deleted) {
          restoredCollectionKeys.push(key);
        }

        if (!existing.synced && !existing.deleted) {
          // Local has unsynced changes — lightweight merge:
          // preserve local name (user-visible), take remote structure (parentKey, version)
          const mergedName = (existing.name !== name) ? existing.name : name;
          if (existing.name !== name) {
            console.log(`   !  Collection ${key}: preserved local name "${existing.name}" over remote "${name}"`);
          }
          await db.update(collections)
            .set({
              name: mergedName,
              parentKey: parentKey || null,
              version,
              synced: false, // Keep unsynced — will re-upload local name on next cycle
              updatedAt: now,
              deleted: false,
              rawJson: JSON.stringify(apiCol),
            })
            .where(and(eq(collections.key, key), eq(collections.libraryId, libraryId)));
        } else {
          // synced=true or deleted — safe to overwrite
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
        }
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
      : (await this.apiClient.getCollectionVersions(zoteroId, 0, libraryType)).versions;
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

    // Restore items that belong to restored collections
    // Mirrors official Zotero's _restoreRestoredCollectionItems (syncEngine.js:756-808)
    if (restoredCollectionKeys.length > 0) {
      await this._restoreRestoredCollectionItems(restoredCollectionKeys, libraryId, zoteroId, libraryType);
    }

    console.log(`   ${symbols.success} Synced ${apiCollections.length} collection(s)`);
  }

  /**
   * When a locally-deleted collection is restored from remote, restore its member items.
   * Items in local trash are un-trashed; items not in local DB are queued for download.
   * Mirrors official Zotero's _restoreRestoredCollectionItems (syncEngine.js:756-808).
   */
  private async _restoreRestoredCollectionItems(
    collectionKeys: string[],
    libraryId: number,
    zoteroId: string,
    libraryType: 'user' | 'group'
  ): Promise<void> {
    for (const collKey of collectionKeys) {
      try {
        const memberKeys = await this.apiClient.getCollectionItemKeys(zoteroId, collKey, libraryType);
        if (memberKeys.length === 0) continue;

        let restored = 0;
        let queued = 0;
        for (const itemKey of memberKeys) {
          const localItem = await this.db.select()
            .from(items)
            .where(and(eq(items.key, itemKey), eq(items.libraryId, libraryId)))
            .get();

          if (localItem && localItem.deleted) {
            // Item is in local trash — restore it
            await this.db.update(items)
              .set({ deleted: false, synced: false })
              .where(and(eq(items.key, itemKey), eq(items.libraryId, libraryId)))
              .run();
            restored++;
          } else if (!localItem) {
            // Item not in local DB — enqueue for download
            this.syncQueue.enqueue('item', libraryId, [itemKey], true);
            queued++;
          }
        }
        if (restored > 0 || queued > 0) {
          console.log(`   Restored collection ${collKey}: ${restored} item(s) un-trashed, ${queued} item(s) queued for download`);
        }
      } catch (e) {
        console.log(`   ! Failed to restore items for collection ${collKey}: ${e}`);
      }
    }
  }


  /**
   * Upload local changes to remote
   */
  private async uploadChanges(
    libraryId: number,
    zoteroId: string,
    libraryType: 'user' | 'group' = 'user',
    baseVersion: number
  ): Promise<{ updated: number; deleted: number; errors: string[]; conflicts: string[]; needsRestart?: boolean }> {
    let updated = 0;
    let deleted = 0;
    let batchSuccessCount = 0;
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

    // 1. Upload modified existing collections before items (Zotero Desktop order: collections → items)
    await this.uploadCollectionChanges(libraryId, zoteroId, libraryType, errors);

    // 2. Find unsynced items (excluding items in sync queue — they may have unresolved conflicts)
    const allUnsyncedItems = await this.getUnsyncedItems(libraryId);
    const queuedKeys = new Set(this.syncQueue.getAll('item', libraryId));
    const unsyncedItems = queuedKeys.size > 0
      ? allUnsyncedItems.filter(item => !queuedKeys.has(item.key))
      : allUnsyncedItems;
    if (queuedKeys.size > 0 && allUnsyncedItems.length !== unsyncedItems.length) {
      console.log(`   Skipping ${allUnsyncedItems.length - unsyncedItems.length} item(s) in sync queue`);
    }
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

    // Separate new items (version=0, not deleted) for batched creation
    const newParentItems = parentItems.filter(item => item.version === 0 && !item.deleted);
    const existingOrDeletedParentItems = parentItems.filter(item => item.version !== 0 || item.deleted);

    // Snapshot updated_at timestamps before upload to detect concurrent modifications
    const parentTimestampMap = new Map<string, number>();
    for (const item of existingOrDeletedParentItems) {
      parentTimestampMap.set(item.key, item.updatedAt ?? 0);
    }
    const attachmentTimestampMap = new Map<string, number>();
    for (const item of attachmentItems) {
      if (item.version !== 0 || item.deleted) {
        attachmentTimestampMap.set(item.key, item.updatedAt ?? 0);
      }
    }

    // 2a. Batch create new parent items (10 per POST, matching Zotero Desktop)
    if (newParentItems.length > 0) {
      console.log(`   Batch creating ${newParentItems.length} new item(s)...`);
      const BATCH_SIZE = 10;

      for (let batchStart = 0; batchStart < newParentItems.length; batchStart += BATCH_SIZE) {
        const batch = newParentItems.slice(batchStart, batchStart + BATCH_SIZE);
        const batchData: Array<Record<string, unknown>> = [];

        // Prepare all items in this batch
        for (const item of batch) {
          const rawEnvelope = parseRawJson(item.rawJson);
          let data = rawEnvelope.data;

          data.key = item.key;
          data.version = item.version;

          // Parse creators if string
          if (typeof data.creators === 'string') {
            try { data.creators = JSON.parse(data.creators); } catch { data.creators = []; }
          }
          // Sanitize creators
          if (Array.isArray(data.creators)) {
            data.creators = data.creators.map((c: any) => {
              const { fieldMode, ...rest } = c;
              if (fieldMode === 1 || (c.lastName && !c.firstName && !c.name)) {
                return { name: c.lastName || c.name || '', creatorType: c.creatorType || 'author' };
              }
              if (rest.lastName != null && rest.firstName == null) rest.firstName = '';
              return rest;
            });
          }

          // Parse tags if string
          if (typeof data.tags === 'string') {
            try { data.tags = JSON.parse(data.tags); } catch { data.tags = []; }
          }
          if (!Array.isArray(data.tags)) data.tags = [];

          if (data.publicationDate) {
            data.date = data.publicationDate;
            delete data.publicationDate;
          }

          // Remove server-managed read-only fields (everything else from rawJson is valid)
          const EXCLUDED_FIELDS = new Set(['dateAdded', 'dateModified', 'library', 'links', 'meta']);
          for (const field of Object.keys(data)) {
            if (EXCLUDED_FIELDS.has(field)) delete data[field];
          }

          batchData.push(data);
        }

        try {
          console.log(`   Uploading batch ${Math.floor(batchStart / BATCH_SIZE) + 1} (${batch.length} items)...`);
          const result = await this.apiClient.createItems(zoteroId, batchData, libraryType);
          const resultVersion = result.libraryVersion;

          // Process per-item results
          for (let i = 0; i < batch.length; i++) {
            const item = batch[i];
            const idx = String(i);

            if (result.successful && result.successful[idx]) {
              const successful0 = result.successful[idx] as any;
              const newKey = typeof successful0 === 'string' ? successful0 : (successful0.key || successful0);
              console.log(`${symbols.success} Created new item ${newKey}`);

              if (newKey !== item.key) {
                console.warn(`   !  WARNING: Server reassigned key for item ${item.key} -> ${newKey}`);
                await this.db.transaction(async (tx) => {
                  await tx.update(items)
                    .set({ key: newKey })
                    .where(and(eq(items.key, item.key), eq(items.libraryId, libraryId)))
                    .run();
                  const affectedAttachments = await tx.select()
                    .from(attachments)
                    .where(and(eq(attachments.parentItemKey, item.key), eq(attachments.libraryId, libraryId)))
                    .all();
                  for (const att of affectedAttachments) {
                    const updates: any = { parentItemKey: newKey };
                    try {
                      const attEnvelope = parseRawJson(att.rawJson);
                      if (attEnvelope.data.parentItem === item.key) {
                        attEnvelope.data.parentItem = newKey;
                        updates.rawJson = JSON.stringify(attEnvelope);
                      }
                    } catch (e) { /* ignore */ }
                    await tx.update(attachments)
                      .set(updates)
                      .where(and(eq(attachments.key, att.key), eq(attachments.libraryId, libraryId)))
                      .run();
                  }
                });
                console.log(`   Updated local key: ${item.key} -> ${newKey}`);
              }
              const syncedKey = newKey !== item.key ? newKey : item.key;
              await this.markAsSynced(syncedKey, libraryId, resultVersion);
              this.syncQueue.dequeue('item', libraryId, [syncedKey]);
              updated++;
              batchSuccessCount++;
            } else if (result.failed && result.failed[idx]) {
              console.log(`${symbols.error} Failed to create item ${item.key}: ${result.failed[idx].message}`);
              errors.push(`Create ${item.key} failed: ${result.failed[idx].message}`);
              this.syncQueue.enqueue('item', libraryId, [item.key]);
            }
          }
        } catch (e: any) {
          errors.push(`Batch create failed: ${e}`);
        }
      }
    }

    // 2b. Upload existing/deleted parent items individually
    for (const item of existingOrDeletedParentItems) {
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

        // For existing/deleted items, key is passed via URL, not in body
        if (!item.deleted) {
          delete data.key;
        }

        // Fix: Zotero API uses 'date' not 'publicationDate'
        if (data.publicationDate) {
          data.date = data.publicationDate;
          delete data.publicationDate;
        }

        // Remove server-managed read-only fields (everything else from rawJson is valid)
        const EXCLUDED_FIELDS = new Set(['dateAdded', 'dateModified', 'library', 'links', 'meta']);
        for (const field of Object.keys(data)) {
          if (EXCLUDED_FIELDS.has(field)) delete data[field];
        }

        // Ensure data.version matches item.version (used as If-Unmodified-Since-Version header)
        // rawJson may have a stale version from before local edits
        data.version = item.version;

        // Patch mode: for existing, non-deleted items, only send changed fields.
        // Prevents silently overwriting concurrent remote changes on untouched fields.
        // Mirrors official Zotero's _getJSONForObject patch mode (syncEngine.js:1647-1686).
        if (item.version > 0 && !item.deleted) {
          const cached = this.syncCache.getLatest('item', libraryId, item.key);
          if (cached) {
            const cachedData = (cached as any).data ?? cached;
            data = PayloadBuilder.buildPatchPayload(item, cachedData);
          }
        }

        if (item.deleted) {
          // Soft delete: move to remote trash via PATCH (not permanent delete)
          const preTs = parentTimestampMap.get(item.key) ?? 0;
          try {
            data.deleted = true;
            const trashVersion = await this.apiClient.updateItem(zoteroId, item.key, data, item.version, libraryType);
            console.log(`${symbols.success} Trashed ${item.key} on remote`);
            await this.markAsSyncedIfUnchanged(item.key, libraryId, trashVersion, preTs);
            this.syncQueue.dequeue('item', libraryId, [item.key]);
            deleted++;
            batchSuccessCount++;
          } catch (e: any) {
            if (e.message?.includes('404')) {
              console.log(`    Item ${item.key} not found on remote, marking synced`);
              await this.markAsSyncedIfUnchanged(item.key, libraryId, item.version, preTs);
              this.syncQueue.dequeue('item', libraryId, [item.key]);
              deleted++;
              batchSuccessCount++;
            } else if (e.message?.includes('412')) {
              console.log(`   !  Version conflict for ${item.key}, fetching latest version...`);
              try {
                const remoteItem = await this.apiClient.getItem(zoteroId, item.key, libraryType);
                const remoteVersion = remoteItem?.data?.version || remoteItem?.version;
                if (remoteVersion) {
                  data.deleted = true;
                  const retryVersion = await this.apiClient.updateItem(zoteroId, item.key, data, remoteVersion, libraryType);
                  console.log(`${symbols.success} Trashed ${item.key} on remote (resolved conflict)`);
                  await this.markAsSyncedIfUnchanged(item.key, libraryId, retryVersion, preTs);
                  this.syncQueue.dequeue('item', libraryId, [item.key]);
                  deleted++;
                  batchSuccessCount++;
                } else {
                  errors.push(`Trash ${item.key} failed: could not resolve version conflict`);
                }
              } catch (retryError: any) {
                if (retryError.message?.includes('404')) {
                  console.log(`    Item ${item.key} already gone on remote`);
                  await this.markAsSyncedIfUnchanged(item.key, libraryId, item.version, preTs);
                  deleted++;
                } else {
                  errors.push(`Trash ${item.key} failed: ${retryError}`);
                }
              }
            } else {
              errors.push(`Trash ${item.key} failed: ${e}`);
            }
          }
        } else {
          // Update existing item (version > 0)
          const preTs = parentTimestampMap.get(item.key) ?? 0;
          const newVersion = await this.apiClient.updateItem(zoteroId, item.key, data, item.version, libraryType);
          console.log(`${symbols.success} Updated ${item.key}`);
          updated++;
          batchSuccessCount++;

          // Mark as synced with new version (if not modified during upload)
          await this.markAsSyncedIfUnchanged(item.key, libraryId, newVersion, preTs);
          this.syncQueue.dequeue('item', libraryId, [item.key]);

          // Save full item data to sync cache for future patch mode
          try {
            const fullData = parseRawJson(item.rawJson);
            this.syncCache.save('item', libraryId, { key: item.key, version: newVersion, data: fullData.data });
          } catch { /* non-fatal */ }
        }
      } catch (e: any) {
        if (e.message?.includes('412')) {
          // Conflict - remote was modified
          console.log(`   !  Conflict for ${item.key} (remote modified)`);
          const preTs = parentTimestampMap.get(item.key) ?? 0;

          if (this.config.conflictStrategy === 'remote') {
            // Fetch remote version and apply to local
            try {
              const remoteItem = await this.apiClient.getItem(zoteroId, item.key, libraryType);
              if (remoteItem) {
                await this.upsertItem(remoteItem, libraryId);
                this.syncCache.save('item', libraryId, remoteItem);
                console.log(`${symbols.success} Applied remote version for ${item.key}`);
                this.logConflict({ key: item.key, libraryId, objectType: 'item', conflictType: 'upload', resolvedBy: 'remote' });
              }
            } catch (fetchError) {
              console.error(`${symbols.error} Failed to fetch remote version for ${item.key}:`, fetchError);
              conflicts.push(item.key);
            }
          } else if (this.config.conflictStrategy === 'local') {
            // Three-way merge then upload — preserves non-conflicting remote changes
            // Mirrors official Zotero's approach of download-then-re-upload on 412
            try {
              const remoteItem = await this.apiClient.getItem(zoteroId, item.key, libraryType);
              const remoteData = remoteItem?.data ?? {};
              const remoteVersion = remoteData.version ?? remoteItem?.version ?? item.version;

              // Verify library version hasn't changed during recovery
              // Prevents TOCTOU race condition (syncEngine.js:2135-2136)
              const currentLibVersion = await this.apiClient.getLibraryVersion(zoteroId, libraryType);
              if (currentLibVersion !== baseVersion && currentLibVersion !== remoteVersion) {
                console.log(`   !  Library version changed during 412 recovery (${baseVersion} -> ${currentLibVersion}), requesting restart`);
                return { updated, deleted, errors, conflicts, needsRestart: true };
              }

              // Attempt three-way merge using sync cache
              const cached = this.syncCache.getLatest('item', libraryId, item.key);
              let mergeResult;
              if (cached) {
                const baseData = (cached as any).data ?? cached;
                mergeResult = this.conflictResolver.resolveForSync(baseData, data, remoteData);
              } else {
                mergeResult = this.conflictResolver.resolveWithoutCache(data, remoteData);
              }

              // mergeResult.data already defaults to local for conflicting fields
              const mergedData = { ...mergeResult.data };
              const MERGE_EXCLUDED = new Set(['dateAdded', 'dateModified', 'library', 'links', 'meta']);
              for (const field of Object.keys(mergedData)) {
                if (MERGE_EXCLUDED.has(field)) delete mergedData[field];
              }
              mergedData.version = remoteVersion;

              const mergedVersion = await this.apiClient.updateItem(zoteroId, item.key, mergedData, remoteVersion, libraryType);
              await this.markAsSyncedIfUnchanged(item.key, libraryId, mergedVersion, preTs);
              this.syncCache.save('item', libraryId, { ...remoteItem, data: mergedData, version: mergedVersion });
              console.log(`${symbols.success} Merged and updated ${item.key} (preserved non-conflicting remote changes)`);
              this.logConflict({ key: item.key, libraryId, objectType: 'item', conflictType: 'upload', resolvedBy: 'merge' });
              this.syncQueue.dequeue('item', libraryId, [item.key]);
              updated++;
              batchSuccessCount++;
            } catch (mergeError) {
              console.error(`${symbols.error} Failed to merge-update ${item.key}:`, mergeError);
              conflicts.push(item.key);
            }
          } else {
            // Manual mode - record conflict for interactive resolution
            conflicts.push(item.key);
          }
        } else {
          errors.push(`Upload ${item.key} failed: ${e}`);
          this.syncQueue.enqueue('item', libraryId, [item.key]);
        }
      }
    }

    // Upload attachment items after all parent items are uploaded
    // This ensures parentItem references exist in Zotero
    const newAttachments = attachmentItems.filter(item => item.version === 0 && !item.deleted);
    const existingOrDeletedAttachments = attachmentItems.filter(item => item.version !== 0 || item.deleted);

    // Batch create new attachments (10 per POST)
    if (newAttachments.length > 0) {
      console.log(`   Batch creating ${newAttachments.length} new attachment(s)...`);
      const BATCH_SIZE = 10;

      for (let batchStart = 0; batchStart < newAttachments.length; batchStart += BATCH_SIZE) {
        const batch = newAttachments.slice(batchStart, batchStart + BATCH_SIZE);
        const batchData: Array<Record<string, unknown>> = [];

        for (const item of batch) {
          const attEnvelope = parseRawJson(item.rawJson);
          let data = attEnvelope.data;
          data.key = item.key;
          data.version = item.version;

          if (typeof data.tags === 'string') {
            try { data.tags = JSON.parse(data.tags); } catch { data.tags = []; }
          }
          if (!Array.isArray(data.tags)) data.tags = [];

          batchData.push(data);
        }

        try {
          const result = await this.apiClient.createItems(zoteroId, batchData, libraryType);
          const attVersion = result.libraryVersion;

          for (let i = 0; i < batch.length; i++) {
            const item = batch[i];
            const idx = String(i);

            if (result.successful && result.successful[idx]) {
              const successful0att = result.successful[idx] as any;
              const newKey = typeof successful0att === 'string' ? successful0att : (successful0att.key || successful0att);
              console.log(`${symbols.success} Created attachment ${newKey}`);

              if (newKey !== item.key) {
                await this.db.update(items)
                  .set({ key: newKey, synced: true, version: attVersion })
                  .where(and(eq(items.key, item.key), eq(items.libraryId, libraryId)))
                  .run();
                this.syncQueue.dequeue('item', libraryId, [item.key]);
              } else {
                await this.markAsSynced(item.key, libraryId, attVersion);
                this.syncQueue.dequeue('item', libraryId, [item.key]);
              }
              updated++;
              batchSuccessCount++;
            } else if (result.failed && result.failed[idx]) {
              const errorMsg = result.failed[idx].message || 'Unknown error';
              this.syncQueue.enqueue('item', libraryId, [item.key]);
              if (errorMsg.includes('Parent item') && errorMsg.includes('not found')) {
                console.log(`   !  Attachment ${item.key}: parent not synced yet, will retry on next sync`);
              } else {
                console.error(`${symbols.error} Failed to create attachment ${item.key}: ${errorMsg}`);
                errors.push(`Create attachment ${item.key} failed: ${errorMsg}`);
              }
            }
          }
        } catch (e: any) {
          errors.push(`Batch create attachments failed: ${e}`);
        }
      }
    }

    // Handle existing/deleted attachments individually
    for (const item of existingOrDeletedAttachments) {
      try {
        const attEnvelope = parseRawJson(item.rawJson);
        let data = attEnvelope.data;
        const attPreTs = attachmentTimestampMap.get(item.key) ?? 0;

        if (typeof data.tags === 'string') {
          try { data.tags = JSON.parse(data.tags); } catch { data.tags = []; }
        }
        if (!Array.isArray(data.tags)) data.tags = [];

        if (item.deleted) {
          try {
            data.deleted = true;
            const attTrashVer = await this.apiClient.updateItem(zoteroId, item.key, data, item.version, libraryType);
            console.log(`${symbols.success} Trashed attachment ${item.key} on remote`);
            await this.markAsSyncedIfUnchanged(item.key, libraryId, attTrashVer, attPreTs);
            this.syncQueue.dequeue('item', libraryId, [item.key]);
            deleted++;
            batchSuccessCount++;
          } catch (e: any) {
            if (e.message?.includes('404') || (e.message?.includes('412') && e.message?.includes('not found'))) {
              console.log(`    Attachment ${item.key} not found on remote, marking synced`);
              await this.markAsSyncedIfUnchanged(item.key, libraryId, item.version, attPreTs);
              this.syncQueue.dequeue('item', libraryId, [item.key]);
              deleted++;
              batchSuccessCount++;
            } else {
              errors.push(`Trash attachment ${item.key} failed: ${e}`);
              this.syncQueue.enqueue('item', libraryId, [item.key]);
            }
          }
        } else {
          // Update existing attachment
          try {
            delete data.key;
            const attUpdateVer = await this.apiClient.updateItem(zoteroId, item.key, data, item.version, libraryType);
            await this.markAsSyncedIfUnchanged(item.key, libraryId, attUpdateVer, attPreTs);
            this.syncQueue.dequeue('item', libraryId, [item.key]);
            updated++;
            batchSuccessCount++;
            console.log(`${symbols.success} Updated attachment ${item.key}`);
          } catch (e: any) {
            errors.push(`Update attachment ${item.key} failed: ${e}`);
            this.syncQueue.enqueue('item', libraryId, [item.key]);
          }
        }
      } catch (e: any) {
        errors.push(`Process attachment ${item.key} failed: ${e}`);
      }
    }

    // Zero-progress detection: if no items succeeded but there were errors,
    // stop early to avoid infinite retry loops. Mirrors official Zotero (syncEngine.js:1514).
    if (batchSuccessCount === 0 && errors.length > 0) {
      errors.push('Made no progress during upload -- stopping');
    }

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

    // Sync attachment metadata to attachments table
    if (data.itemType === 'attachment' && data.parentItem) {
      const linkMode = data.linkMode ?? '';
      const webdavPath = (linkMode === 'imported_file' || linkMode === 'imported_url')
        ? `${apiItem.key}.zip` : null;
      const attStmt = sqlite.prepare(`
        INSERT OR REPLACE INTO attachments (
          key, parent_item_key, library_id, filename, content_type,
          file_type, path, url, version, created_at, updated_at,
          deleted, size, md5, webdav_path, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      attStmt.run(
        apiItem.key,
        data.parentItem,
        libraryId,
        data.filename ?? data.title ?? null,
        data.contentType ?? null,
        linkMode || null,
        null, // path — resolved later by attachment-manager
        data.url ?? null,
        apiItem.version,
        createdAt,
        updatedAt,
        data.deleted ? 1 : 0,
        null, // size — not in API response
        data.md5 ?? null,
        webdavPath,
        JSON.stringify(apiItem),
      );
    }

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
  private async markAsSynced(key: string, libraryId: number, version?: number): Promise<void> {
    const updates: any = { synced: true };
    if (version != null) updates.version = version;
    await this.db.update(items)
      .set(updates)
      .where(and(eq(items.key, key), eq(items.libraryId, libraryId)))
      .run();

    // Save current item state to sync cache (for future three-way merge)
    try {
      const item = await this.getItemByKey(key, libraryId);
      if (item?.rawJson) {
        const envelope = JSON.parse(item.rawJson);
        if (version != null) envelope.version = version;
        this.syncCache.save('item', libraryId, envelope);
      }
    } catch { /* non-fatal */ }
  }

  /**
   * Mark item as synced only if it hasn't been modified during the upload.
   * Compares the item's updated_at timestamp against a pre-upload snapshot.
   * If the item was modified concurrently, only updates the version (so the next
   * upload starts from the correct base) but keeps synced=false.
   * Mirrors official Zotero's changedObjects observer (syncEngine.js:1266-1288).
   */
  private async markAsSyncedIfUnchanged(
    key: string,
    libraryId: number,
    version: number,
    preUploadTimestamp: number
  ): Promise<boolean> {
    const current = await this.db.select({ updatedAt: items.updatedAt })
      .from(items)
      .where(and(eq(items.key, key), eq(items.libraryId, libraryId)))
      .get();

    if (current && current.updatedAt !== preUploadTimestamp) {
      // Item was modified during upload — only update version, keep unsynced
      await this.db.update(items)
        .set({ version })
        .where(and(eq(items.key, key), eq(items.libraryId, libraryId)))
        .run();
      console.log(`   !  Item ${key} changed during upload — kept as unsynced`);
      return false;
    }

    await this.markAsSynced(key, libraryId, version);
    return true;
  }

  /**
   * Process remote deletions with conflict detection.
   * Checks each item for local unsynced modifications before deleting.
   * Mirrors official Zotero's deletion conflict handling (syncEngine.js:873-897).
   */
  private async processRemoteDeletions(
    deletedKeys: string[],
    libraryId: number
  ): Promise<{ deleted: number; conflicts: string[] }> {
    if (deletedKeys.length === 0) return { deleted: 0, conflicts: [] };

    const safeToDelete: string[] = [];
    const conflicts: string[] = [];

    for (const key of deletedKeys) {
      const localItem = await this.db.select()
        .from(items)
        .where(and(eq(items.key, key), eq(items.libraryId, libraryId)))
        .get();

      if (!localItem) continue; // Not in local DB — nothing to delete

      if (localItem.synced) {
        // No local changes — safe to delete
        safeToDelete.push(key);
      } else if (localItem.deleted) {
        // Both sides agree on deletion — safe
        safeToDelete.push(key);
      } else {
        // CONFLICT: local has unsynced modifications, remote wants to delete
        if (this.config.conflictStrategy === 'remote') {
          safeToDelete.push(key);
        } else {
          // 'local' or 'manual': keep local version, it will be re-uploaded on next sync
          conflicts.push(key);
          this.logConflict({ key, libraryId, objectType: 'item', conflictType: 'deletion', resolvedBy: 'local' });
          console.log(`   !  Conflict: remote deleted ${key} but local has unsynced changes — keeping local`);
        }
      }
    }

    if (safeToDelete.length > 0) {
      await this.softDeleteItems(safeToDelete, libraryId);
    }
    return { deleted: safeToDelete.length, conflicts };
  }

  /**
   * Process remote collection deletions with conflict detection.
   * Checks synced flag before deleting — unsynced local collections are preserved.
   */
  private async processRemoteCollectionDeletions(
    deletedKeys: string[],
    libraryId: number
  ): Promise<{ deleted: number; conflicts: string[] }> {
    if (deletedKeys.length === 0) return { deleted: 0, conflicts: [] };

    const safeToDelete: string[] = [];
    const conflicts: string[] = [];

    for (const key of deletedKeys) {
      const localCol = await this.db.select()
        .from(collections)
        .where(and(eq(collections.key, key), eq(collections.libraryId, libraryId)))
        .get();

      if (!localCol) continue;

      if (localCol.synced) {
        safeToDelete.push(key);
      } else if (localCol.deleted) {
        safeToDelete.push(key);
      } else {
        if (this.config.conflictStrategy === 'remote') {
          safeToDelete.push(key);
        } else {
          // Keep local: reset version to 0 so it will be re-uploaded
          await this.db.update(collections)
            .set({ version: 0, synced: false })
            .where(and(eq(collections.key, key), eq(collections.libraryId, libraryId)));
          conflicts.push(key);
          this.logConflict({ key, libraryId, objectType: 'collection', conflictType: 'deletion', resolvedBy: 'local' });
          console.log(`   !  Conflict: remote deleted collection ${key} but local has unsynced changes — keeping local`);
        }
      }
    }

    if (safeToDelete.length > 0) {
      await this.db.delete(collections)
        .where(and(eq(collections.libraryId, libraryId), inArray(collections.key, safeToDelete)))
        .run();
    }

    return { deleted: safeToDelete.length, conflicts };
  }

  /**
   * Process remote search deletions with conflict detection.
   * Checks synced flag before deleting — unsynced local searches are preserved.
   */
  private async processRemoteSearchDeletions(
    deletedKeys: string[],
    libraryId: number
  ): Promise<{ deleted: number; conflicts: string[] }> {
    if (deletedKeys.length === 0) return { deleted: 0, conflicts: [] };

    const safeToDelete: string[] = [];
    const conflicts: string[] = [];

    for (const key of deletedKeys) {
      const localSearch = await this.db.select()
        .from(savedSearches)
        .where(and(eq(savedSearches.key, key), eq(savedSearches.libraryId, libraryId)))
        .get();

      if (!localSearch) continue;

      if (localSearch.synced) {
        safeToDelete.push(key);
      } else if (localSearch.deleted) {
        safeToDelete.push(key);
      } else {
        if (this.config.conflictStrategy === 'remote') {
          safeToDelete.push(key);
        } else {
          await this.db.update(savedSearches)
            .set({ version: 0, synced: false })
            .where(and(eq(savedSearches.key, key), eq(savedSearches.libraryId, libraryId)));
          conflicts.push(key);
          this.logConflict({ key, libraryId, objectType: 'search', conflictType: 'deletion', resolvedBy: 'local' });
          console.log(`   !  Conflict: remote deleted search ${key} but local has unsynced changes — keeping local`);
        }
      }
    }

    if (safeToDelete.length > 0) {
      // Clean up search conditions first
      await this.db.delete(savedSearchConditions)
        .where(and(eq(savedSearchConditions.libraryId, libraryId), inArray(savedSearchConditions.searchKey, safeToDelete)))
        .run();
      await this.db.delete(savedSearches)
        .where(and(eq(savedSearches.libraryId, libraryId), inArray(savedSearches.key, safeToDelete)))
        .run();
    }

    return { deleted: safeToDelete.length, conflicts };
  }

  /**
   * Soft delete items and cascade delete their attachments.
   * All operations wrapped in a single SQLite transaction for atomicity —
   * prevents orphaned state if process crashes mid-deletion.
   */
  private async softDeleteItems(keys: string[], libraryId: number): Promise<void> {
    if (keys.length === 0) return;

    const sqlite = getRawSQLite();
    const now = Math.floor(Date.now() / 1000);
    const parentKeySet = new Set(keys);

    // Query candidate children outside the transaction (read-only)
    const candidateChildren = sqlite.prepare(
      'SELECT key, title, item_type, raw_json FROM items WHERE library_id = ? AND deleted = 0'
    ).all(libraryId) as Array<{ key: string; title: string | null; item_type: string | null; raw_json: string }>;

    const childItems = candidateChildren.filter(child => {
      try {
        const data = parseItemData(child.raw_json);
        return data.parentItem && parentKeySet.has(data.parentItem);
      } catch { return false; }
    });

    // Query parent items for deletion log
    const placeholders = keys.map(() => '?').join(',');
    const parentItems = sqlite.prepare(
      `SELECT key, title, item_type, raw_json FROM items WHERE library_id = ? AND key IN (${placeholders})`
    ).all(libraryId, ...keys) as Array<{ key: string; title: string | null; item_type: string | null; raw_json: string }>;

    // Synchronous deletion log helper
    const logStmt = sqlite.prepare(
      'INSERT INTO deletion_log (item_key, library_id, title, item_type, operation_type, caller, raw_json_snapshot, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const updateStmt = sqlite.prepare(
      'UPDATE items SET deleted = 1, deleted_at = ?, updated_at = ?, synced = 1 WHERE key = ? AND library_id = ?'
    );

    // Perform all mutations atomically
    const doDelete = sqlite.transaction(() => {
      // 1. Log and mark child items as deleted
      if (childItems.length > 0) {
        console.log(`    Cascading delete: ${childItems.length} child item(s)`);
        for (const child of childItems) {
          logStmt.run(child.key, libraryId, child.title, child.item_type, 'soft', 'sync', child.raw_json, now);
          updateStmt.run(now, now, child.key, libraryId);
        }
      }

      // 2. Log and mark parent items as deleted
      // synced=true because this deletion came from the server — no need to re-upload
      for (const item of parentItems) {
        logStmt.run(item.key, libraryId, item.title, item.item_type, 'soft', 'sync', item.raw_json, now);
        updateStmt.run(now, now, item.key, libraryId);
      }
    });

    doDelete();
  }

  /**
   * Log a conflict to the conflict_log table for headless inspection.
   * Non-fatal — logging failure never breaks sync.
   */
  private logConflict(params: {
    key: string;
    libraryId: number;
    objectType: 'item' | 'collection' | 'search';
    conflictType: 'upload' | 'download' | 'deletion';
    localData?: unknown;
    remoteData?: unknown;
    resolvedBy: string;
    fields?: string[];
  }): void {
    try {
      const sqlite = getRawSQLite();
      sqlite.prepare(`
        INSERT INTO conflict_log (key, library_id, object_type, conflict_type, local_data, remote_data, resolved_by, fields, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        params.key, params.libraryId, params.objectType, params.conflictType,
        params.localData ? JSON.stringify(params.localData) : null,
        params.remoteData ? JSON.stringify(params.remoteData) : null,
        params.resolvedBy,
        params.fields ? JSON.stringify(params.fields) : null,
        Math.floor(Date.now() / 1000)
      );
    } catch (e) {
      // Non-fatal — don't let logging break sync
    }
  }

  /**
   * Get recent conflicts for a library (for programmatic access in headless mode).
   */
  getRecentConflicts(libraryId: number, limit: number = 50): Array<{
    key: string;
    objectType: string;
    conflictType: string;
    localData: unknown;
    remoteData: unknown;
    resolvedBy: string;
    fields: string[];
    createdAt: number;
  }> {
    const sqlite = getRawSQLite();
    const rows = sqlite.prepare(
      'SELECT * FROM conflict_log WHERE library_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(libraryId, limit) as any[];

    return rows.map((r: any) => ({
      key: r.key,
      objectType: r.object_type,
      conflictType: r.conflict_type,
      localData: r.local_data ? JSON.parse(r.local_data) : null,
      remoteData: r.remote_data ? JSON.parse(r.remote_data) : null,
      resolvedBy: r.resolved_by,
      fields: r.fields ? JSON.parse(r.fields) : [],
      createdAt: r.created_at,
    }));
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

  // ============ Settings Sync ============

  /**
   * Sync settings from/to remote.
   * Settings are simple key-value pairs — remote wins on conflict (matching official Zotero).
   */
  private async syncSettings(
    libraryId: number,
    zoteroId: string,
    libraryType: 'user' | 'group',
    sinceVersion: number
  ): Promise<void> {
    const sqlite = getRawSQLite();

    // Download settings
    try {
      const { settings, libraryVersion } = await this.apiClient.getSettings(zoteroId, sinceVersion, libraryType);
      const settingEntries = Object.entries(settings);

      if (settingEntries.length > 0) {
        console.log(`   Syncing ${settingEntries.length} setting(s)...`);
        const upsert = sqlite.prepare(`
          INSERT OR REPLACE INTO synced_settings (setting, library_id, value, version, synced)
          VALUES (?, ?, ?, ?, 1)
        `);
        const runBatch = sqlite.transaction((entries: Array<[string, { value: unknown; version: number }]>) => {
          for (const [key, { value, version }] of entries) {
            upsert.run(key, libraryId, JSON.stringify(value), version);
          }
        });
        runBatch(settingEntries);
      }
    } catch (e) {
      console.log(`   ! Settings download failed: ${e}`);
    }

    // Upload unsynced settings
    try {
      const unsyncedRows = sqlite.prepare(
        'SELECT setting, value FROM synced_settings WHERE library_id = ? AND synced = 0'
      ).all(libraryId) as Array<{ setting: string; value: string }>;

      if (unsyncedRows.length > 0) {
        console.log(`   Uploading ${unsyncedRows.length} setting(s)...`);
        const settingsPayload: Record<string, { value: unknown }> = {};
        for (const row of unsyncedRows) {
          try {
            settingsPayload[row.setting] = { value: JSON.parse(row.value) };
          } catch {
            settingsPayload[row.setting] = { value: row.value };
          }
        }

        const remoteVersion = await this.apiClient.getLibraryVersion(zoteroId, libraryType);
        const { libraryVersion: newVersion } = await this.apiClient.uploadSettings(
          zoteroId, settingsPayload, remoteVersion, libraryType
        );

        // Mark as synced
        sqlite.prepare(
          'UPDATE synced_settings SET synced = 1, version = ? WHERE library_id = ? AND synced = 0'
        ).run(newVersion, libraryId);
      }
    } catch (e) {
      console.log(`   ! Settings upload failed: ${e}`);
    }
  }

  // ============ Saved Searches Sync ============

  /**
   * Sync saved searches from/to remote.
   * Follows the same pattern as syncCollections().
   */
  private async syncSearches(
    libraryId: number,
    zoteroId: string,
    libraryType: 'user' | 'group',
    sinceVersion: number
  ): Promise<void> {
    const db = this.db;
    const sqlite = getRawSQLite();
    const { eq, and, count, notInArray } = await import('drizzle-orm');

    // If no local searches exist yet, do a full search sync from version 0
    const localCount = await db.select({ cnt: count() })
      .from(savedSearches)
      .where(eq(savedSearches.libraryId, libraryId))
      .get();
    const effectiveSince = (localCount?.cnt ?? 0) === 0 ? 0 : sinceVersion;

    // Get changed search versions
    const { versions: versionMap } = await this.apiClient.getSearchVersions(zoteroId, effectiveSince, libraryType);
    const changedKeys = Object.keys(versionMap);

    if (changedKeys.length === 0 && effectiveSince > 0) {
      // No incremental changes — reconcile to catch missed deletions
      const { versions: allRemoteVersions } = await this.apiClient.getSearchVersions(zoteroId, 0, libraryType);
      const remoteKeys = Object.keys(allRemoteVersions);
      if (remoteKeys.length > 0) {
        const deleted = await db.delete(savedSearches)
          .where(and(
            eq(savedSearches.libraryId, libraryId),
            notInArray(savedSearches.key, remoteKeys)
          ))
          .run();
        if (deleted.changes > 0) {
          // Also clean up conditions for deleted searches
          sqlite.prepare(
            `DELETE FROM saved_search_conditions WHERE library_id = ? AND search_key NOT IN (${remoteKeys.map(() => '?').join(',')})`
          ).run(libraryId, ...remoteKeys);
          console.log(`   Removed ${deleted.changes} stale search(es) not present on remote`);
        }
      }
      return;
    }

    console.log(`   Syncing ${changedKeys.length} search(es)...`);

    // Fetch search data
    const { searches: apiSearches } = await this.apiClient.getSearches(zoteroId, changedKeys, libraryType);
    const now = Math.floor(Date.now() / 1000);

    // Query unsynced search keys to protect from overwrite
    const unsyncedSearchRows = sqlite.prepare(
      'SELECT key, name FROM saved_searches WHERE library_id = ? AND synced = 0 AND deleted = 0'
    ).all(libraryId) as Array<{ key: string; name: string }>;
    const unsyncedSearchMap = new Map(unsyncedSearchRows.map(r => [r.key, r.name]));

    // Upsert each search and its conditions in a transaction
    const upsertSearch = sqlite.prepare(`
      INSERT OR REPLACE INTO saved_searches (key, library_id, name, version, synced, created_at, updated_at, deleted, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `);
    const deleteConditions = sqlite.prepare(
      'DELETE FROM saved_search_conditions WHERE search_key = ? AND library_id = ?'
    );
    const insertCondition = sqlite.prepare(`
      INSERT INTO saved_search_conditions (search_key, library_id, condition_index, condition, operator, value, required)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const processSearches = sqlite.transaction((searches: typeof apiSearches) => {
      for (const apiSearch of searches) {
        const data = (apiSearch.data || {}) as Record<string, any>;
        const key = apiSearch.key;
        const remoteName = (data.name as string) || key;
        const version = apiSearch.version;

        // If local has unsynced changes, preserve local name
        const localUnsyncedName = unsyncedSearchMap.get(key);
        let finalName = remoteName;
        let finalSynced = 1; // synced=true
        if (localUnsyncedName !== undefined && localUnsyncedName !== remoteName) {
          finalName = localUnsyncedName;
          finalSynced = 0; // Keep unsynced to re-upload local name
          console.log(`   !  Search ${key}: preserved local name "${localUnsyncedName}" over remote "${remoteName}"`);
        }

        upsertSearch.run(key, libraryId, finalName, version, finalSynced, now, now, JSON.stringify(apiSearch));

        // Replace conditions (always take remote structure)
        deleteConditions.run(key, libraryId);
        const conditions = (data.conditions as Array<{ condition: string; operator: string; value?: string; required?: boolean }>) || [];
        for (let idx = 0; idx < conditions.length; idx++) {
          const cond = conditions[idx];
          insertCondition.run(key, libraryId, idx, cond.condition, cond.operator, cond.value ?? null, cond.required ? 1 : 0);
        }
      }
    });
    processSearches(apiSearches);

    // Save to sync cache
    for (const apiSearch of apiSearches) {
      this.syncCache.save('search', libraryId, apiSearch);
    }

    // Reconcile: remove local searches not present on remote
    const allRemoteVersions = effectiveSince === 0
      ? versionMap
      : (await this.apiClient.getSearchVersions(zoteroId, 0, libraryType)).versions;
    const allRemoteKeys = Object.keys(allRemoteVersions);
    if (allRemoteKeys.length > 0) {
      const purged = await db.delete(savedSearches)
        .where(and(
          eq(savedSearches.libraryId, libraryId),
          notInArray(savedSearches.key, allRemoteKeys)
        ))
        .run();
      if (purged.changes > 0) {
        console.log(`   Removed ${purged.changes} stale search(es) not present on remote`);
      }
    }

    console.log(`   ${symbols.success} Synced ${apiSearches.length} search(es)`);
  }

  // ============ Full-Text Content Sync ============

  /**
   * Sync full-text content for PDF attachments.
   * Downloads remote fulltext, uploads local extractions.
   */
  private async syncFulltext(
    libraryId: number,
    zoteroId: string,
    libraryType: 'user' | 'group',
    sinceVersion: number
  ): Promise<void> {
    const sqlite = getRawSQLite();

    // Get the fulltext library version from synced_settings
    const ftVersionRow = sqlite.prepare(
      'SELECT value FROM synced_settings WHERE setting = ? AND library_id = ?'
    ).get('fulltextLibraryVersion', libraryId) as { value: string } | undefined;
    const fulltextSince = ftVersionRow ? Number(JSON.parse(ftVersionRow.value)) : 0;

    // Download phase
    try {
      const { versions: ftVersions, libraryVersion: ftLibVersion } =
        await this.apiClient.getFulltextVersions(zoteroId, fulltextSince, libraryType);

      const changedKeys = Object.keys(ftVersions);
      if (changedKeys.length > 0) {
        console.log(`   Downloading fulltext for ${changedKeys.length} item(s)...`);

        let downloaded = 0;
        for (const key of changedKeys) {
          try {
            const ft = await this.apiClient.getFulltext(zoteroId, key, libraryType);
            if (!ft) continue;

            // Store in content_cache
            sqlite.prepare(`
              INSERT OR REPLACE INTO content_cache (attachment_key, library_id, file_md5, content, format, extracted_at)
              VALUES (?, ?, 'remote-sync', ?, 'text', ?)
            `).run(key, libraryId, ft.content, Math.floor(Date.now() / 1000));

            // Update fulltext_sync_state
            sqlite.prepare(`
              INSERT OR REPLACE INTO fulltext_sync_state (attachment_key, library_id, version, synced, indexed_pages, total_pages, indexed_chars, total_chars)
              VALUES (?, ?, ?, 1, ?, ?, ?, ?)
            `).run(key, libraryId, ft.version, ft.indexedPages ?? null, ft.totalPages ?? null, ft.indexedChars, ft.totalChars);

            // Update FTS5 index — look up parent item key from attachments table
            const attRow = sqlite.prepare(
              'SELECT parent_item_key FROM attachments WHERE key = ? AND library_id = ?'
            ).get(key, libraryId) as { parent_item_key: string } | undefined;

            // Delete existing FTS entry and insert new one
            sqlite.prepare('DELETE FROM content_fts WHERE attachment_key = ? AND library_id = ?').run(key, libraryId);
            sqlite.prepare(
              'INSERT INTO content_fts (content, attachment_key, library_id, parent_item_key) VALUES (?, ?, ?, ?)'
            ).run(ft.content, key, libraryId, attRow?.parent_item_key ?? '');

            downloaded++;
          } catch (e) {
            // Non-fatal per item
          }
        }
        if (downloaded > 0) {
          console.log(`   ${symbols.success} Downloaded fulltext for ${downloaded} item(s)`);
        }
      }

      // Save the new fulltext library version
      sqlite.prepare(`
        INSERT OR REPLACE INTO synced_settings (setting, library_id, value, version, synced)
        VALUES ('fulltextLibraryVersion', ?, ?, ?, 1)
      `).run(libraryId, JSON.stringify(ftLibVersion), ftLibVersion);
    } catch (e) {
      console.log(`   ! Fulltext download failed: ${e}`);
    }

    // Upload phase — find locally extracted content not yet synced
    try {
      const unsyncedRows = sqlite.prepare(`
        SELECT cc.attachment_key, cc.content
        FROM content_cache cc
        LEFT JOIN fulltext_sync_state fts
          ON cc.attachment_key = fts.attachment_key AND cc.library_id = fts.library_id
        WHERE cc.library_id = ?
          AND cc.file_md5 != 'remote-sync'
          AND (fts.synced IS NULL OR fts.synced = 0)
      `).all(libraryId) as Array<{ attachment_key: string; content: string }>;

      if (unsyncedRows.length > 0) {
        console.log(`   Uploading fulltext for ${unsyncedRows.length} item(s)...`);
        let uploaded = 0;
        const remoteVersion = await this.apiClient.getLibraryVersion(zoteroId, libraryType);

        for (const row of unsyncedRows) {
          try {
            const content = row.content;
            const newVersion = await this.apiClient.setFulltext(
              zoteroId, row.attachment_key,
              { content, indexedChars: content.length, totalChars: content.length },
              remoteVersion, libraryType
            );

            sqlite.prepare(`
              INSERT OR REPLACE INTO fulltext_sync_state (attachment_key, library_id, version, synced, indexed_chars, total_chars)
              VALUES (?, ?, ?, 1, ?, ?)
            `).run(row.attachment_key, libraryId, newVersion, content.length, content.length);

            uploaded++;
          } catch (e) {
            // Non-fatal per item
          }
        }
        if (uploaded > 0) {
          console.log(`   ${symbols.success} Uploaded fulltext for ${uploaded} item(s)`);
        }
      }
    } catch (e) {
      console.log(`   ! Fulltext upload failed: ${e}`);
    }
  }

  // ============ Full Sync Reconciliation (409 handling) ============

  /**
   * Full sync reconciliation — downloads ALL remote objects, compares with ALL local,
   * and reconciles differences. Triggered when getDeleted returns 409.
   * Mirrors official Zotero's _fullSync (syncEngine.js:368-527).
   */
  private async _fullSync(
    libraryId: number,
    zoteroId: string,
    libraryType: 'user' | 'group'
  ): Promise<number> {
    const sqlite = getRawSQLite();
    console.log('   Performing full sync reconciliation...');

    let lastLibraryVersion = 0;

    // 1. Download deletions from version 0
    try {
      const { deleted: deletedData, libraryVersion } =
        await this.apiClient.getDeleted(zoteroId, 0, libraryType);
      lastLibraryVersion = Math.max(lastLibraryVersion, libraryVersion);

      if (deletedData.items.length > 0) {
        await this.processRemoteDeletions(deletedData.items, libraryId);
      }
      if (deletedData.collections?.length > 0) {
        for (const collKey of deletedData.collections) {
          await this.db.delete(collections)
            .where(and(eq(collections.key, collKey), eq(collections.libraryId, libraryId)))
            .run();
        }
      }
      if (deletedData.searches?.length > 0) {
        for (const searchKey of deletedData.searches) {
          await this.db.delete(savedSearches)
            .where(and(eq(savedSearches.key, searchKey), eq(savedSearches.libraryId, libraryId)))
            .run();
        }
      }
    } catch (e) {
      console.log(`   ! Deletion fetch failed during fullSync: ${e}`);
    }

    // 2. Download settings from version 0
    try {
      await this.syncSettings(libraryId, zoteroId, libraryType, 0);
    } catch (e) {
      console.log(`   ! Settings sync failed during fullSync: ${e}`);
    }

    // 3. Reconcile each object type: collections, searches, items
    // 3a. Collections
    try {
      const { versions: remoteColVersions, libraryVersion: colLibVer } =
        await this.apiClient.getCollectionVersions(zoteroId, 0, libraryType);
      lastLibraryVersion = Math.max(lastLibraryVersion, colLibVer);

      const localCols = sqlite.prepare(
        'SELECT key, version FROM collections WHERE library_id = ?'
      ).all(libraryId) as Array<{ key: string; version: number }>;
      const localColMap = new Map(localCols.map(c => [c.key, c.version]));

      // Download remote-only or remote-newer collections
      const colsToDownload = Object.entries(remoteColVersions)
        .filter(([key, ver]) => !localColMap.has(key) || localColMap.get(key)! < ver)
        .map(([key]) => key);

      if (colsToDownload.length > 0) {
        const { collections: apiCols } = await this.apiClient.getCollections(zoteroId, colsToDownload, libraryType);
        const now = Math.floor(Date.now() / 1000);
        for (const apiCol of apiCols) {
          const data = (apiCol.data || {}) as Record<string, any>;
          sqlite.prepare(`
            INSERT OR REPLACE INTO collections (key, library_id, name, parent_key, version, synced, created_at, updated_at, deleted, raw_json)
            VALUES (?, ?, ?, ?, ?, 1, ?, ?, 0, ?)
          `).run(apiCol.key, libraryId, data.name || apiCol.key, data.parentCollection || null, apiCol.version, now, now, JSON.stringify(apiCol));
        }
      }

      // Local-only collections → mark for upload
      const remoteColKeySet = new Set(Object.keys(remoteColVersions));
      const localOnlyCols = localCols.filter(c => !remoteColKeySet.has(c.key)).map(c => c.key);
      if (localOnlyCols.length > 0) {
        sqlite.prepare(
          `UPDATE collections SET version = 0, synced = 0 WHERE library_id = ? AND key IN (${localOnlyCols.map(() => '?').join(',')})`
        ).run(libraryId, ...localOnlyCols);
      }
    } catch (e) {
      console.log(`   ! Collection reconciliation failed: ${e}`);
    }

    // 3b. Searches
    try {
      const { versions: remoteSearchVersions, libraryVersion: searchLibVer } =
        await this.apiClient.getSearchVersions(zoteroId, 0, libraryType);
      lastLibraryVersion = Math.max(lastLibraryVersion, searchLibVer);

      const localSearches = sqlite.prepare(
        'SELECT key, version FROM saved_searches WHERE library_id = ?'
      ).all(libraryId) as Array<{ key: string; version: number }>;
      const localSearchMap = new Map(localSearches.map(s => [s.key, s.version]));

      const searchesToDownload = Object.entries(remoteSearchVersions)
        .filter(([key, ver]) => !localSearchMap.has(key) || localSearchMap.get(key)! < ver)
        .map(([key]) => key);

      if (searchesToDownload.length > 0) {
        const { searches: apiSearches } = await this.apiClient.getSearches(zoteroId, searchesToDownload, libraryType);
        const now = Math.floor(Date.now() / 1000);
        for (const apiSearch of apiSearches) {
          const data = (apiSearch.data || {}) as Record<string, any>;
          sqlite.prepare(`
            INSERT OR REPLACE INTO saved_searches (key, library_id, name, version, synced, created_at, updated_at, deleted, raw_json)
            VALUES (?, ?, ?, ?, 1, ?, ?, 0, ?)
          `).run(apiSearch.key, libraryId, data.name || apiSearch.key, apiSearch.version, now, now, JSON.stringify(apiSearch));

          // Replace conditions
          sqlite.prepare('DELETE FROM saved_search_conditions WHERE search_key = ? AND library_id = ?').run(apiSearch.key, libraryId);
          const conditions = (data.conditions as Array<{ condition: string; operator: string; value?: string; required?: boolean }>) || [];
          for (let idx = 0; idx < conditions.length; idx++) {
            const cond = conditions[idx];
            sqlite.prepare(`
              INSERT INTO saved_search_conditions (search_key, library_id, condition_index, condition, operator, value, required)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(apiSearch.key, libraryId, idx, cond.condition, cond.operator, cond.value ?? null, cond.required ? 1 : 0);
          }
        }
      }

      // Local-only searches → mark for upload
      const remoteSearchKeySet = new Set(Object.keys(remoteSearchVersions));
      const localOnlySearches = localSearches.filter(s => !remoteSearchKeySet.has(s.key)).map(s => s.key);
      if (localOnlySearches.length > 0) {
        sqlite.prepare(
          `UPDATE saved_searches SET version = 0, synced = 0 WHERE library_id = ? AND key IN (${localOnlySearches.map(() => '?').join(',')})`
        ).run(libraryId, ...localOnlySearches);
      }
    } catch (e) {
      console.log(`   ! Search reconciliation failed: ${e}`);
    }

    // 3c. Items
    try {
      const { versions: remoteItemVersions, libraryVersion: itemLibVer } =
        await this.apiClient.getItemVersions(zoteroId, 0, libraryType);
      lastLibraryVersion = Math.max(lastLibraryVersion, itemLibVer);

      const localItems = sqlite.prepare(
        'SELECT key, version FROM items WHERE library_id = ?'
      ).all(libraryId) as Array<{ key: string; version: number }>;
      const localItemMap = new Map(localItems.map(i => [i.key, i.version]));

      const itemsToDownload = Object.entries(remoteItemVersions)
        .filter(([key, ver]) => !localItemMap.has(key) || localItemMap.get(key)! < ver)
        .map(([key]) => key);

      if (itemsToDownload.length > 0) {
        console.log(`   Downloading ${itemsToDownload.length} item(s) for reconciliation...`);
        const batchSize = this.config.batchSize ?? 50;
        for (let i = 0; i < itemsToDownload.length; i += batchSize) {
          const batch = itemsToDownload.slice(i, i + batchSize);
          const { items: apiItems } = await this.apiClient.getItems(zoteroId, batch, libraryType);
          const processBatch = sqlite.transaction(() => {
            for (const apiItem of apiItems) {
              this.upsertItemRaw(apiItem, libraryId, sqlite);
              this.syncCache.save('item', libraryId, apiItem);
            }
          });
          processBatch();
        }
      }

      // Local-only items → mark for upload
      const remoteItemKeySet = new Set(Object.keys(remoteItemVersions));
      const localOnlyItems = localItems.filter(i => !remoteItemKeySet.has(i.key)).map(i => i.key);
      if (localOnlyItems.length > 0) {
        sqlite.prepare(
          `UPDATE items SET version = 0, synced = 0 WHERE library_id = ? AND key IN (${localOnlyItems.map(() => '?').join(',')})`
        ).run(libraryId, ...localOnlyItems);
      }
    } catch (e) {
      console.log(`   ! Item reconciliation failed: ${e}`);
    }

    // 4. Purge old cache
    try {
      this.syncCache.purgeOldVersions('item', libraryId);
      this.syncCache.purgeOldVersions('collection', libraryId);
      this.syncCache.purgeOldVersions('search', libraryId);
    } catch { /* non-fatal */ }

    console.log(`   ${symbols.success} Full sync reconciliation complete`);
    return lastLibraryVersion;
  }

  /**
   * Restore local library to server — pushes entire local library to remote.
   * Mirrors official Zotero's _restoreToServer (syncEngine.js:530-600).
   */
  private async _restoreToServer(
    libraryId: number,
    zoteroId: string,
    libraryType: 'user' | 'group'
  ): Promise<void> {
    const sqlite = getRawSQLite();
    console.log('   Restoring local library to server...');

    // 1. Clear sync state
    this.syncCache.clearForLibrary(libraryId);
    this.syncQueue.clearForLibrary(libraryId);

    // 2. Mark all settings as unsynced
    sqlite.prepare('UPDATE synced_settings SET synced = 0, version = 0 WHERE library_id = ?').run(libraryId);

    // 3. Mark all objects as unsynced with version 0
    sqlite.prepare('UPDATE items SET version = 0, synced = 0 WHERE library_id = ?').run(libraryId);
    sqlite.prepare('UPDATE collections SET version = 0, synced = 0 WHERE library_id = ?').run(libraryId);
    sqlite.prepare('UPDATE saved_searches SET version = 0, synced = 0 WHERE library_id = ?').run(libraryId);

    // 4. Delete remote-only objects
    let currentVersion = await this.apiClient.getLibraryVersion(zoteroId, libraryType);

    // Collections
    try {
      const { versions: remoteCols } = await this.apiClient.getCollectionVersions(zoteroId, 0, libraryType);
      const localColKeys = new Set(
        (sqlite.prepare('SELECT key FROM collections WHERE library_id = ?').all(libraryId) as Array<{ key: string }>).map(r => r.key)
      );
      const toDeleteCols = Object.keys(remoteCols).filter(k => !localColKeys.has(k));
      if (toDeleteCols.length > 0) {
        // Batch delete in groups of 50
        for (let i = 0; i < toDeleteCols.length; i += 50) {
          const batch = toDeleteCols.slice(i, i + 50);
          currentVersion = await this.apiClient.deleteCollections(zoteroId, batch, currentVersion, libraryType);
        }
      }
    } catch (e) {
      console.log(`   ! Remote collection cleanup failed: ${e}`);
    }

    // Searches
    try {
      const { versions: remoteSearches } = await this.apiClient.getSearchVersions(zoteroId, 0, libraryType);
      const localSearchKeys = new Set(
        (sqlite.prepare('SELECT key FROM saved_searches WHERE library_id = ?').all(libraryId) as Array<{ key: string }>).map(r => r.key)
      );
      const toDeleteSearches = Object.keys(remoteSearches).filter(k => !localSearchKeys.has(k));
      if (toDeleteSearches.length > 0) {
        for (let i = 0; i < toDeleteSearches.length; i += 50) {
          const batch = toDeleteSearches.slice(i, i + 50);
          await this.apiClient.deleteSearches(zoteroId, batch, currentVersion, libraryType);
        }
      }
    } catch (e) {
      console.log(`   ! Remote search cleanup failed: ${e}`);
    }

    // Items
    try {
      const { versions: remoteItems } = await this.apiClient.getItemVersions(zoteroId, 0, libraryType);
      const localItemKeys = new Set(
        (sqlite.prepare('SELECT key FROM items WHERE library_id = ?').all(libraryId) as Array<{ key: string }>).map(r => r.key)
      );
      const toDeleteItems = Object.keys(remoteItems).filter(k => !localItemKeys.has(k));
      if (toDeleteItems.length > 0) {
        for (let i = 0; i < toDeleteItems.length; i += 50) {
          const batch = toDeleteItems.slice(i, i + 50);
          currentVersion = await this.apiClient.deleteItems(zoteroId, batch, currentVersion, libraryType);
        }
      }
    } catch (e) {
      console.log(`   ! Remote item cleanup failed: ${e}`);
    }

    // 5. Upload all local objects (reuse existing uploadChanges)
    const uploadResult = await this.uploadChanges(libraryId, zoteroId, libraryType, currentVersion);
    console.log(`   ${symbols.success} Restore to server complete: ${uploadResult.updated} uploaded`);

    // 6. Update library version
    const finalVersion = await this.apiClient.getLibraryVersion(zoteroId, libraryType);
    await this.updateLibraryVersion(libraryId, finalVersion);
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
