// Attachment Manager with WebDAV Sync Support
// Zotero Desktop compatible structure: /zotero/<item_key>.zip and .prop (XML format)

import { getDatabase, attachments, libraries, webdavConfig, items } from '@zotero-headless/database';
import { zoteroApi } from '@zotero-headless/api';
import { WebDAVClient, createWebDAVClient } from '@zotero-headless/webdav-client';
import { eq, and, desc, sql, isNull } from 'drizzle-orm';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

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
        basePath: config.basePath,
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
      const client = createWebDAVClient({
        url: config.url,
        username: config.username,
        password: config.password,
        basePath: config.basePath || '/zotero',
      });

      const test = await client.testConnection();
      if (!test.success) {
        return { success: false, error: test.error };
      }

      const now = Math.floor(Date.now() / 1000);
      const existing = await this.db.select().from(webdavConfig).get();

      if (existing) {
        await this.db.update(webdavConfig)
          .set({
            url: config.url,
            username: config.username,
            password: config.password,
            basePath: config.basePath || '/zotero',
            autoSync: config.autoSync || false,
            enabled: true,
            updatedAt: now.toString(),
          })
          .where(eq(webdavConfig.id, existing.id));
      } else {
        await this.db.insert(webdavConfig).values({
          url: config.url,
          username: config.username,
          password: config.password,
          basePath: config.basePath || '/zotero',
          autoSync: config.autoSync || false,
          enabled: true,
          createdAt: now.toString(),
          updatedAt: now.toString(),
        });
      }

      this.webdavClient = client;
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * List attachments
   */
  async listAttachments(options: AttachmentListOptions = {}): Promise<AttachmentInfo[]> {
    const { itemKey, libraryId, webdavSynced, limit = 100, offset = 0 } = options;

    let whereCondition = isNull(attachments.deleted); // Not deleted

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

    return results.map(a => ({
      key: a.key,
      title: a.title,
      filename: a.filename,
      contentType: a.contentType || undefined,
      fileSize: a.fileSize || undefined,
      md5: a.md5 || undefined,
      attachmentType: a.attachmentType,
      url: a.url || undefined,
      localPath: a.localPath || undefined,
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
      localPath: attachment.localPath || undefined,
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
    
    // Need to create ZIP - use zip -j to store only file, no directory structure
    const filename = path.basename(inputFile);
    const dir = path.dirname(inputFile);
    
    execSync(`cd "${dir}" && zip -j "${outputZip}" "${filename}"`, { stdio: 'ignore' });
    
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

      if (!attachment.localPath || !fs.existsSync(attachment.localPath)) {
        return { success: false, error: 'Local file not found' };
      }

      // Calculate WebDAV paths - Zotero's actual structure
      // Files are at root: /zotero/<item_key>.zip and /zotero/<item_key>.prop
      const webdavPath = `${attachment.itemKey}.zip`;
      const propPath = `${attachment.itemKey}.prop`;

      // Create temporary ZIP file
      const tempZip = `/tmp/${webdavPath}`;
      this.createZipIfNeeded(attachment.localPath, tempZip);

      // Upload ZIP
      const zipStats = fs.statSync(tempZip);
      await this.webdavClient!.uploadFile(tempZip, webdavPath, (uploaded, total) => {
        if (onProgress) {
          onProgress(uploaded, total, attachment.filename);
        }
      });

      // Generate and upload .prop file (XML format)
      const propContent = this.generatePropContent(tempZip);
      const propTempPath = `/tmp/${propPath}`;
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

      // Clean up temp ZIP
      if (tempZip !== attachment.localPath) {
        fs.unlinkSync(tempZip);
      }

      // Update database
      const now = Math.floor(Date.now() / 1000);
      await this.db.update(attachments)
        .set({
          webdavPath,
          webdavSynced: true,
          webdavSyncedAt: now.toString(),
          md5: this.calculateMD5(`/tmp/${webdavPath}`),
          fileSize: zipStats.size,
          updatedAt: now.toString(),
        })
        .where(eq(attachments.key, attachmentKey));

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
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
        eq(attachments.deleted, false),
        isNull(attachments.deleted)
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
}

export const attachmentManager = new AttachmentManager();
