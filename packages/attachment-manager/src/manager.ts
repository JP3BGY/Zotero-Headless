// Attachment Manager with WebDAV Sync Support
// Zotero Desktop compatible structure: /zotero/<item_key>.zip and .prop (XML format)

import { getDatabase, attachments, libraries, webdavConfig, items } from '@zotero-headless/database';
import { zoteroApi } from '@zotero-headless/api';
import { symbols } from '@zotero-headless/core';
import { WebDAVClient, createWebDAVClient } from '@zotero-headless/webdav-client';
import { eq, and, or, desc, sql, isNull, isNotNull } from 'drizzle-orm';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import AdmZip from 'adm-zip';

export interface AttachmentInfo {
  key: string;
  title: string;
  filename: string;
  contentType?: string;
  fileSize?: number;
  md5?: string;
  attachmentType: 'file' | 'link' | 'note';
  url?: string;
  localPath?: string;
  webdavPath?: string;
  webdavSynced: boolean;
}

export interface AttachmentListOptions {
  itemKey?: string;
  libraryId?: number;
  webdavSynced?: boolean;
  limit?: number;
  offset?: number;
}

export interface AttachmentSyncOptions {
  onProgress?: (current: number, total: number, filename: string) => void;
}

export class AttachmentManager {
  private db: ReturnType<typeof getDatabase>;
  private webdavClient: WebDAVClient | null = null;

  constructor() {
    this.db = getDatabase();
  }

  /**
   * Initialize WebDAV client from config
   */
  async initWebDAV(): Promise<{ success: boolean; error?: string }> {
    const config = await this.db.select().from(webdavConfig).where(eq(webdavConfig.enabled, true)).get();
    
    if (!config) {
      return { success: false, error: 'WebDAV not configured' };
    }

    try {
      this.webdavClient = createWebDAVClient({
        url: config.url,
        username: config.username,
        password: config.password,
        basePath: config.basePath || '/',
      });

      const test = await this.webdavClient.testConnection();
      if (!test.success) {
        return { success: false, error: test.error };
      }

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Configure WebDAV
   */
  async configureWebDAV(config: {
    url: string;
    username: string;
    password: string;
    basePath?: string;
    autoSync?: boolean;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      // Use user's basePath (default to '/'), client will append '/zotero'
      const userBasePath = config.basePath || '/';
      
      const client = createWebDAVClient({
        url: config.url,
        username: config.username,
        password: config.password,
        basePath: userBasePath,
      });

      const test = await client.testConnection();
      if (!test.success) {
        return { success: false, error: test.error };
      }

      // Ensure /zotero directory exists (Zotero Desktop compatible)
      // The client automatically uses /zotero subdirectory
      try {
        await client.createDirectory('/');
      } catch (e) {
        // Directory might already exist, that's ok
      }

      const now = Math.floor(Date.now() / 1000);
      const existing = await this.db.select().from(webdavConfig).get();

      if (existing) {
        await this.db.update(webdavConfig)
          .set({
            url: config.url,
            username: config.username,
            password: config.password,
            basePath: userBasePath,
            autoSync: config.autoSync || false,
            enabled: true,
            updatedAt: now,
          })
          .where(eq(webdavConfig.id, existing.id));
      } else {
        await this.db.insert(webdavConfig).values({
          url: config.url,
          username: config.username,
          password: config.password,
          basePath: userBasePath,
          autoSync: config.autoSync || false,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        });
      }

      this.webdavClient = client;
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Update WebDAV configuration partially (without re-entering credentials)
   */
  async updateWebDAVConfig(updates: {
    autoSync?: boolean;
    enabled?: boolean;
  }): Promise<{ success: boolean; error?: string; config?: any }> {
    try {
      const existing = await this.db.select().from(webdavConfig).get();

      if (!existing) {
        return { success: false, error: 'WebDAV not configured. Run "zotero webdav:config" first.' };
      }

      const now = Math.floor(Date.now() / 1000);
      const updateData: any = { updatedAt: now };

      if (updates.autoSync !== undefined) {
        updateData.autoSync = updates.autoSync;
      }
      if (updates.enabled !== undefined) {
        updateData.enabled = updates.enabled;
      }

      await this.db.update(webdavConfig)
        .set(updateData)
        .where(eq(webdavConfig.id, existing.id));

      // Return updated config
      const updated = await this.db.select().from(webdavConfig).get();
      return { success: true, config: updated };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * List attachments
   */
  async listAttachments(options: AttachmentListOptions = {}): Promise<AttachmentInfo[]> {
    const { itemKey, libraryId, webdavSynced, limit = 100, offset = 0 } = options;

    let whereCondition: any = eq(attachments.deleted, false); // Not deleted

    if (itemKey) {
      whereCondition = and(whereCondition, eq(attachments.itemKey, itemKey));
    }

    if (libraryId) {
      whereCondition = and(whereCondition, eq(attachments.libraryId, libraryId));
    }

    if (webdavSynced !== undefined) {
      whereCondition = and(whereCondition, eq(attachments.webdavSynced, webdavSynced));
    }

    const results = await this.db.select()
      .from(attachments)
      .where(whereCondition)
      .orderBy(desc(attachments.createdAt))
      .limit(limit)
      .offset(offset)
      .all();

    return results.map((a: any) => ({
      key: a.key,
      title: a.title,
      filename: a.filename,
      contentType: a.contentType || undefined,
      fileSize: a.fileSize || undefined,
      md5: a.md5 || undefined,
      attachmentType: a.attachmentType,
      url: a.url || undefined,
      localPath: a.path || undefined,
      webdavPath: a.webdavPath || undefined,
      webdavSynced: a.webdavSynced,
    }));
  }

  /**
   * Get attachment details
   */
  async getAttachment(key: string): Promise<AttachmentInfo | null> {
    const attachment = await this.db.select()
      .from(attachments)
      .where(eq(attachments.key, key))
      .get();

    if (!attachment) return null;

    return {
      key: attachment.key,
      title: attachment.title,
      filename: attachment.filename,
      contentType: attachment.contentType || undefined,
      fileSize: attachment.fileSize || undefined,
      md5: attachment.md5 || undefined,
      attachmentType: attachment.attachmentType,
      url: attachment.url || undefined,
      localPath: attachment.path || undefined,
      webdavPath: attachment.webdavPath || undefined,
      webdavSynced: attachment.webdavSynced,
    };
  }

  /**
   * Calculate file MD5
   */
  private calculateMD5(filePath: string): string {
    const data = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(data).digest('hex');
  }

  /**
   * Create ZIP file (if input is not ZIP)
   * Zotero Desktop compatible: all attachments are stored as ZIP
   */
  private createZipIfNeeded(inputFile: string, outputZip: string): string {
    const ext = path.extname(inputFile).toLowerCase();

    if (ext === '.zip') {
      fs.copyFileSync(inputFile, outputZip);
      return outputZip;
    }

    // Need to create ZIP using adm-zip (cross-platform)
    const zip = new AdmZip();
    const filename = path.basename(inputFile);
    zip.addLocalFile(inputFile, '', filename);
    zip.writeZip(outputZip);

    return outputZip;
  }

  /**
   * Generate .prop file content (Zotero Desktop XML format)
   * Format: <properties version="1"><mtime>...</mtime><hash>...</hash></properties>
   */
  private generatePropContent(zipFilePath: string): string {
    const hash = this.calculateMD5(zipFilePath);
    const mtime = Date.now(); // milliseconds
    
    return `<properties version="1"><mtime>${mtime}</mtime><hash>${hash}</hash></properties>`;
  }

  /**
   * Parse .prop file content (XML format)
   */
  private parsePropContent(content: string): Record<string, string> {
    const result: Record<string, string> = {};
    
    // Parse XML: <properties version="1"><mtime>123</mtime><hash>abc</hash></properties>
    const mtimeMatch = content.match(/<mtime>(\d+)<\/mtime>/);
    const hashMatch = content.match(/<hash>([^<]+)<\/hash>/);
    
    if (mtimeMatch) result.mtime = mtimeMatch[1];
    if (hashMatch) result.md5 = hashMatch[1];
    
    return result;
  }

  /**
   * Ensure Zotero attachment item exists on server
   * This creates/updates the attachment item in Zotero before WebDAV upload
   */
  private async ensureZoteroAttachmentItem(
    attachment: any,
    libraryId: number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Get library info for API calls
      const library = await this.db.select().from(libraries).where(eq(libraries.id, libraryId)).get();
      if (!library) {
        return { success: false, error: 'Library not found' };
      }

      const zoteroId = String(library.zoteroId);
      const libraryType = library.type as 'user' | 'group';

      // Check if attachment item exists in Zotero
      try {
        const existingItem = await zoteroApi.getItem(zoteroId, attachment.key, libraryType);
        if (existingItem && existingItem.data) {
          // Attachment exists, update if needed (especially md5/mtime for WebDAV)
          const needsUpdate =
            existingItem.data.linkMode !== 'imported_file' ||
            existingItem.data.contentType !== attachment.contentType ||
            existingItem.data.filename !== attachment.filename;

          if (needsUpdate) {
            console.log(`   Updating attachment item ${attachment.key} in Zotero...`);
            
            // Extract fields from rawJson if available
            let attachmentTitle = existingItem.data.title || 'Attachment';
            let linkMode = existingItem.data.linkMode || 'imported_file';
            let url = existingItem.data.url || '';
            let accessDate = existingItem.data.accessDate || '';
            let charset = existingItem.data.charset || '';
            try {
              const rawData = JSON.parse(attachment.rawJson || '{}');
              attachmentTitle = rawData.data?.title || existingItem.data.title || 'Attachment';
              linkMode = rawData.data?.linkMode || existingItem.data.linkMode || 'imported_file';
              url = rawData.data?.url || existingItem.data.url || '';
              accessDate = rawData.data?.accessDate || existingItem.data.accessDate || '';
              charset = rawData.data?.charset || existingItem.data.charset || '';
            } catch (e) {
              // Use existing values
            }
            
            const updateData: any = {
              ...existingItem.data,
              linkMode: linkMode,
              contentType: attachment.contentType || 'application/octet-stream',
              filename: attachment.filename || 'attachment.zip',
              title: attachmentTitle,
              charset: charset,
              md5: null, // Will be set after WebDAV upload
              mtime: null, // Will be set after WebDAV upload
            };
            
            // Preserve URL and accessDate for imported_url attachments
            if (linkMode === 'imported_url') {
              if (url) updateData.url = url;
              if (accessDate) updateData.accessDate = accessDate;
            }
            
            await zoteroApi.updateItem(zoteroId, attachment.key, updateData, existingItem.version, libraryType);
          }
          return { success: true };
        }
      } catch (e: any) {
        // Item doesn't exist (404), will create below
        if (!e.message?.includes('404')) {
          throw e;
        }
      }

      // Create new attachment item in Zotero
      console.log(`   Creating attachment item ${attachment.key} in Zotero...`);
      
      // Check if parent item exists in Zotero first
      if (attachment.parentItemKey) {
        try {
          await zoteroApi.getItem(zoteroId, attachment.parentItemKey, libraryType);
          console.log(`   ${symbols.success} Parent item ${attachment.parentItemKey} exists`);
        } catch (e: any) {
          if (e.message?.includes('404')) {
            console.warn(`   !  Parent item ${attachment.parentItemKey} not found in Zotero`);
            console.warn(`   !  Skipping attachment creation - will retry after parent syncs`);
            return { 
              success: false, 
              error: `Parent item ${attachment.parentItemKey} not found. Please sync the parent item first.` 
            };
          }
        }
      }
      
      // Extract title from rawJson if available, otherwise use filename
      let attachmentTitle = 'Attachment';
      let linkMode = 'imported_file';
      let url = '';
      let accessDate = '';
      let charset = '';
      try {
        const rawData = JSON.parse(attachment.rawJson || '{}');
        attachmentTitle = rawData.data?.title || attachment.filename || 'Attachment';
        linkMode = rawData.data?.linkMode || 'imported_file';
        url = rawData.data?.url || '';
        accessDate = rawData.data?.accessDate || '';
        charset = rawData.data?.charset || '';
      } catch (e) {
        attachmentTitle = attachment.filename || 'Attachment';
      }
      
      const attachmentItem: any = {
        itemType: 'attachment',
        key: attachment.key,
        version: 0, // Required for key-based writes
        parentItem: attachment.parentItemKey,
        linkMode: linkMode,
        title: attachmentTitle,
        contentType: attachment.contentType || 'application/octet-stream',
        charset: charset,
        filename: attachment.filename || 'attachment.zip',
        md5: null,
        mtime: null,
        tags: [],
        relations: {},
      };
      
      // Add URL and accessDate for imported_url attachments (snapshots)
      if (linkMode === 'imported_url') {
        if (url) attachmentItem.url = url;
        if (accessDate) attachmentItem.accessDate = accessDate;
      }

      const result = await zoteroApi.createItems(zoteroId, [attachmentItem], libraryType);
      console.log(`   API Response:`, JSON.stringify(result, null, 2));
      
      // Check for success
      if (result.failed && result.failed['0']) {
        const errorMsg = result.failed['0'].message || 'Unknown error';
        console.error(`   ${symbols.error} Attachment creation failed: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }
      
      if (result.successful && result.successful['0']) {
        console.log(`   ${symbols.success} Created attachment item: ${result.successful['0']}`);
        return { success: true };
      }

      console.error(`   ${symbols.error} Unexpected API response`);
      return { success: false, error: 'Failed to create attachment item in Zotero' };
    } catch (error: any) {
      console.error(`   ${symbols.error} Failed to ensure attachment item:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Sync attachment to WebDAV
   * Zotero's actual structure: /zotero/<item_key>.zip and .prop (XML format)
   */
  async syncToWebDAV(
    attachmentKey: string,
    onProgress?: (current: number, total: number, filename: string) => void
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.webdavClient) {
      const init = await this.initWebDAV();
      if (!init.success) {
        return init;
      }
    }

    try {
      const attachment = await this.db.select()
        .from(attachments)
        .where(eq(attachments.key, attachmentKey))
        .get();

      if (!attachment) {
        return { success: false, error: 'Attachment not found' };
      }

      if (!attachment.path || !fs.existsSync(attachment.path)) {
        return { success: false, error: `Local file not found: ${attachment.path || '(no path)'}` };
      }

      // Step 1: Ensure Zotero attachment item exists (CRITICAL for Zotero Desktop to recognize it)
      console.log(`   Ensuring Zotero attachment item exists for ${attachmentKey}...`);
      const itemResult = await this.ensureZoteroAttachmentItem(attachment, attachment.libraryId);
      if (!itemResult.success) {
        return { success: false, error: `Failed to create Zotero attachment item: ${itemResult.error}` };
      }

      // Step 2: Upload to WebDAV
      console.log(`    Uploading to WebDAV...`);

      // Calculate WebDAV paths - Zotero's actual structure
      // Files are at root: /zotero/<item_key>.zip and /zotero/<item_key>.prop
      const webdavPath = `${attachment.key}.zip`;
      const propPath = `${attachment.key}.prop`;

      // Create temporary ZIP file in OS temp directory
      const tempDir = os.tmpdir();
      const tempZip = path.join(tempDir, webdavPath);
      this.createZipIfNeeded(attachment.path, tempZip);

      // Upload ZIP
      const zipStats = fs.statSync(tempZip);
      await this.webdavClient!.uploadFile(tempZip, webdavPath, (uploaded: number, total: number) => {
        if (onProgress) {
          onProgress(uploaded, total, attachment.filename);
        }
      });

      // Generate and upload .prop file (XML format)
      const propContent = this.generatePropContent(tempZip);
      const propTempPath = path.join(tempDir, propPath);
      fs.writeFileSync(propTempPath, propContent);

      try {
        await this.webdavClient!.uploadFile(propTempPath, propPath);
        fs.unlinkSync(propTempPath); // Clean up temp file
      } catch (propError) {
        // If .prop upload fails, still consider main sync successful
        console.warn(`Warning: Failed to upload .prop file: ${propError}`);
        if (fs.existsSync(propTempPath)) {
          fs.unlinkSync(propTempPath);
        }
      }

      // Calculate md5 before cleanup
      const zipMd5 = this.calculateMD5(tempZip);

      // Update database
      const now = Math.floor(Date.now() / 1000);
      await this.db.update(attachments)
        .set({
          webdavPath,
          webdavSynced: true,
          webdavSyncedAt: now,
          md5: zipMd5,
          fileSize: zipStats.size,
          updatedAt: now,
        })
        .where(eq(attachments.key, attachmentKey));

      // Clean up temp ZIP
      if (tempZip !== attachment.path && fs.existsSync(tempZip)) {
        fs.unlinkSync(tempZip);
      }

      // Step 3: Update Zotero attachment item with md5 and mtime
      console.log(`   Updating attachment metadata in Zotero...`);
      const mtimeMs = zipStats.mtime.getTime();
      await this.updateAttachmentMetadata(attachment, zipMd5, mtimeMs, attachment.libraryId);

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Update Zotero attachment item metadata after WebDAV upload
   */
  private async updateAttachmentMetadata(
    attachment: any,
    md5: string,
    mtime: number,
    libraryId: number
  ): Promise<void> {
    try {
      const library = await this.db.select().from(libraries).where(eq(libraries.id, libraryId)).get();
      if (!library) return;

      const zoteroId = String(library.zoteroId);
      const libraryType = library.type as 'user' | 'group';

      // Get current item
      const existingItem = await zoteroApi.getItem(zoteroId, attachment.key, libraryType);
      if (!existingItem || !existingItem.data) return;

      // Update with md5 and mtime (required for Zotero to recognize WebDAV file)
      const updateData = {
        ...existingItem.data,
        md5: md5,
        mtime: mtime,
      };

      await zoteroApi.updateItem(zoteroId, attachment.key, updateData, existingItem.version, libraryType);
      console.log(`   ${symbols.success} Updated attachment metadata (md5: ${md5.slice(0, 8)}..., mtime: ${mtime})`);
    } catch (error: any) {
      console.warn(`   !  Failed to update attachment metadata: ${error.message}`);
      // Don't fail the whole operation if metadata update fails
    }
  }

  /**
   * Sync all unsynced attachments to WebDAV
   */
  async syncAllToWebDAV(options: AttachmentSyncOptions = {}): Promise<{
    success: boolean;
    synced: number;
    errors: string[];
  }> {
    if (!this.webdavClient) {
      const init = await this.initWebDAV();
      if (!init.success) {
        return { success: false, synced: 0, errors: [init.error || 'Unknown error'] };
      }
    }

    const unsynced = await this.db.select()
      .from(attachments)
      .where(and(
        eq(attachments.webdavSynced, false),
        eq(attachments.deleted, false)
      ))
      .all();

    const errors: string[] = [];
    let synced = 0;

    for (let i = 0; i < unsynced.length; i++) {
      const attachment = unsynced[i];
      
      try {
        const result = await this.syncToWebDAV(attachment.key, options.onProgress);
        if (result.success) {
          synced++;
        } else {
          errors.push(`${attachment.key}: ${result.error}`);
        }
      } catch (error: any) {
        errors.push(`${attachment.key}: ${error.message}`);
      }
    }

    return { success: errors.length === 0, synced, errors };
  }

  /**
   * Scan WebDAV for existing Zotero Desktop attachments
   */
  async scanWebDAV(): Promise<{
    success: boolean;
    items: Array<{
      itemKey: string;
      files: Array<{
        filename: string;
        size: number;
        hasProp: boolean;
      }>;
    }>;
    error?: string;
  }> {
    if (!this.webdavClient) {
      const init = await this.initWebDAV();
      if (!init.success) {
        return { success: false, items: [], error: init.error };
      }
    }

    try {
      // List root directory
      const files = await this.webdavClient!.listFiles('/');
      
      // Group by item key
      const itemMap = new Map<string, Array<{
        filename: string;
        size: number;
        isProp: boolean;
      }>>();

      for (const file of files) {
        if (file.isDirectory) continue;
        
        const match = file.filename.match(/^([A-Z0-9]+)\.(zip|prop)$/);
        if (!match) continue;
        
        const itemKey = match[1];
        const ext = match[2];
        
        if (!itemMap.has(itemKey)) {
          itemMap.set(itemKey, []);
        }
        
        itemMap.get(itemKey)!.push({
          filename: file.filename,
          size: file.size,
          isProp: ext === 'prop',
        });
      }

      // Format results
      const items = Array.from(itemMap.entries()).map(([itemKey, files]) => {
        const zipFile = files.find(f => !f.isProp);
        const propFile = files.find(f => f.isProp);
        
        return {
          itemKey,
          files: zipFile ? [{
            filename: zipFile.filename,
            size: zipFile.size,
            hasProp: !!propFile,
          }] : [],
        };
      }).filter(item => item.files.length > 0);

      return { success: true, items };
    } catch (error: any) {
      return { success: false, items: [], error: error.message };
    }
  }

  /**
   * Download attachment from WebDAV to local storage
   */
  async downloadFromWebDAV(
    attachmentKey: string,
    localDir?: string,
    onProgress?: (downloaded: number, total: number) => void
  ): Promise<{ success: boolean; localPath?: string; error?: string }> {
    if (!this.webdavClient) {
      const init = await this.initWebDAV();
      if (!init.success) {
        return { success: false, error: init.error };
      }
    }

    // Get attachment info
    const attachment = await this.db.select()
      .from(attachments)
      .where(eq(attachments.key, attachmentKey))
      .get();

    if (!attachment) {
      return { success: false, error: `Attachment ${attachmentKey} not found` };
    }

    if (!attachment.webdavPath) {
      return { success: false, error: `Attachment ${attachmentKey} has no WebDAV path` };
    }

    try {
      // Download from WebDAV
      const remotePath = attachment.webdavPath;
      const filename = attachment.filename || `${attachmentKey}.zip`;
      
      // Use provided directory or default storage location
      const storageDir = localDir || this.getDefaultStorageDir();
      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
      }

      const localPath = path.join(storageDir, filename);

      // Download file
      await this.webdavClient!.downloadFile(remotePath, localPath, onProgress);

      // Update database
      await this.db.update(attachments)
        .set({ 
          localPath,
          webdavSynced: true,
          updatedAt: Math.floor(Date.now() / 1000)
        })
        .where(eq(attachments.key, attachmentKey))
        .run();

      return { success: true, localPath };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Download all missing attachments from WebDAV
   */
  async downloadAll(
    localDir?: string,
    options?: {
      onProgress?: (current: number, total: number, filename: string) => void;
      onlyMissing?: boolean;
    }
  ): Promise<{ success: boolean; downloaded: number; errors: string[] }> {
    // Get attachments to download
    let attachmentsToDownload: typeof attachments.$inferSelect[];
    
    if (options?.onlyMissing) {
      // Only attachments without local path but with webdav path
      attachmentsToDownload = await this.db.select()
        .from(attachments)
        .where(and(
          isNull(attachments.path),
          sql`${attachments.webdavPath} IS NOT NULL`,
          eq(attachments.deleted, false)
        ))
        .all();
    } else {
      // All attachments with webdav path
      attachmentsToDownload = await this.db.select()
        .from(attachments)
        .where(and(
          sql`${attachments.webdavPath} IS NOT NULL`,
          eq(attachments.deleted, false)
        ))
        .all();
    }

    if (attachmentsToDownload.length === 0) {
      return { success: true, downloaded: 0, errors: [] };
    }

    const errors: string[] = [];
    let downloaded = 0;

    for (let i = 0; i < attachmentsToDownload.length; i++) {
      const attachment = attachmentsToDownload[i];
      
      try {
        // Wrap progress callback
        const originalCallback = options?.onProgress;
        const wrappedCallback = originalCallback 
          ? (d: number, t: number) => originalCallback(i + 1, attachmentsToDownload.length, attachment.filename)
          : undefined;
        
        const result = await this.downloadFromWebDAV(
          attachment.key,
          localDir,
          wrappedCallback
        );
        
        if (result.success) {
          downloaded++;
        } else {
          errors.push(`${attachment.key}: ${result.error}`);
        }
      } catch (error: any) {
        errors.push(`${attachment.key}: ${error.message}`);
      }
    }

    return { success: errors.length === 0, downloaded, errors };
  }

  /**
   * Get default storage directory for attachments
   */
  private getDefaultStorageDir(): string {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
    return path.join(homeDir, '.local', 'share', 'zotero-headless', 'attachments');
  }

  /**
   * Find duplicate attachments by file hash
   */
  async findDuplicates(): Promise<{
    success: boolean;
    duplicates: Array<{
      hash: string;
      size: number;
      attachments: Array<{
        key: string;
        filename: string;
        localPath?: string;
        webdavPath?: string;
      }>;
    }>;
    error?: string;
  }> {
    try {
      // Get all attachments with local or webdav path
      const allAttachments = await this.db.select()
        .from(attachments)
        .where(eq(attachments.deleted, false))
        .all();
      
      // Filter attachments with local or webdav path
      const filteredAttachments = allAttachments.filter(att =>
        att.path !== null && att.path !== undefined ||
        att.webdavPath !== null && att.webdavPath !== undefined
      );

      if (filteredAttachments.length === 0) {
        return { success: true, duplicates: [] };
      }

      // Calculate hash for each attachment
      const hashMap = new Map<string, typeof filteredAttachments>();

      for (const att of filteredAttachments) {
        let hash: string | null = null;
        let size = 0;

        try {
          if (att.path && fs.existsSync(att.path)) {
            // Calculate hash from local file
            const content = fs.readFileSync(att.path);
            hash = crypto.createHash('md5').update(content).digest('hex');
            size = content.length;
          } else if (att.md5) {
            // Use stored MD5 if available
            hash = att.md5;
          }
        } catch (error) {
          console.warn(`Failed to hash attachment ${att.key}:`, error);
          continue;
        }

        if (hash) {
          const key = `${hash}_${size}`; // Include size to avoid collisions
          if (!hashMap.has(key)) {
            hashMap.set(key, []);
          }
          hashMap.get(key)!.push(att);
        }
      }

      // Filter groups with duplicates (2+ attachments with same hash)
      const duplicates = Array.from(hashMap.entries())
        .filter(([_, group]) => group.length > 1)
        .map(([key, group]) => {
          const [hash, sizeStr] = key.split('_');
          return {
            hash,
            size: parseInt(sizeStr) || 0,
            attachments: group.map(att => ({
              key: att.key,
              filename: att.filename,
              localPath: att.path || undefined,
              webdavPath: att.webdavPath || undefined,
            })),
          };
        });

      return { success: true, duplicates };
    } catch (error: any) {
      return { success: false, duplicates: [], error: error.message };
    }
  }

  /**
   * Remove duplicate attachments (keep one)
   */
  async removeDuplicates(
    duplicateGroup: { hash: string; attachments: Array<{ key: string }> },
    keepKey?: string
  ): Promise<{ success: boolean; removed: number; error?: string }> {
    try {
      if (duplicateGroup.attachments.length < 2) {
        return { success: true, removed: 0 };
      }

      // Determine which one to keep
      let keepIndex = 0;
      if (keepKey) {
        const idx = duplicateGroup.attachments.findIndex(a => a.key === keepKey);
        if (idx >= 0) keepIndex = idx;
      }

      // Remove others
      let removed = 0;
      for (let i = 0; i < duplicateGroup.attachments.length; i++) {
        if (i === keepIndex) continue;

        const attKey = duplicateGroup.attachments[i].key;
        
        // Mark as deleted
        await this.db.update(attachments)
          .set({ 
            deleted: true,
            updatedAt: Math.floor(Date.now() / 1000)
          })
          .where(eq(attachments.key, attKey))
          .run();

        removed++;
      }

      return { success: true, removed };
    } catch (error: any) {
      return { success: false, removed: 0, error: error.message };
    }
  }

  /**
   * Open attachment with system default application
   */
  async openAttachment(attachmentKey: string): Promise<{ success: boolean; error?: string }> {
    // Get attachment info
    const attachment = await this.db.select()
      .from(attachments)
      .where(eq(attachments.key, attachmentKey))
      .get();

    if (!attachment) {
      return { success: false, error: `Attachment ${attachmentKey} not found` };
    }

    // Determine file path
    let filePath = attachment.path;
    
    if (!filePath) {
      // Try to download first
      if (attachment.webdavPath) {
        const download = await this.downloadFromWebDAV(attachmentKey);
        if (!download.success) {
          return { success: false, error: `File not available locally and download failed: ${download.error}` };
        }
        filePath = download.localPath;
      } else {
        return { success: false, error: 'No local file or WebDAV path available' };
      }
    }

    if (!fs.existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }

    // Open with system default application
    try {
      const platform = process.platform;
      let command: string;
      
      if (platform === 'darwin') {
        command = `open "${filePath}"`;
      } else if (platform === 'win32') {
        command = `start "" "${filePath}"`;
      } else {
        command = `xdg-open "${filePath}"`;
      }

      execSync(command, { stdio: 'ignore' });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: `Failed to open file: ${error.message}` };
    }
  }
}

export const attachmentManager = new AttachmentManager();
