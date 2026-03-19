#!/usr/bin/env node
// @ts-nocheck

// Zotero-Headless CLI
// See Zotero-Headless-Complete-Design.md Section 7

import { existsSync } from 'fs';
import { appConfig, symbols } from '@zotero-headless/core';
import { eq, like, desc, asc, count, and, isNull, sql } from 'drizzle-orm';
import { ProgressBar } from './progress-bar.js';
import { resolveConflictsInteractive, isInteractive, createPrompt, ConflictItem } from './conflict-resolver.js';
import { t, setLanguage, getLanguage, formatItemType, formatField, type Language } from './i18n.js';

// Lazy-loaded modules (to avoid initialization on help commands)
let syncManager: any;
let getDatabase: any;
let items: any;
let libraries: any;
let attachments: any;
let zoteroApi: any;
let attachmentManager: any;
let webdavConfig: any;
let logDeletion: any;

async function initModules() {
  if (!syncManager) {
    const syncMod = await import('@zotero-headless/sync-engine');
    syncManager = syncMod.syncManager;
  }
  if (!getDatabase) {
    const dbMod = await import('@zotero-headless/database');
    getDatabase = dbMod.getDatabase;
    items = dbMod.items;
    libraries = dbMod.libraries;
    webdavConfig = dbMod.webdavConfig;
    attachments = dbMod.attachments;
    logDeletion = dbMod.logDeletion;
  }
  if (!zoteroApi) {
    const apiMod = await import('@zotero-headless/api');
    zoteroApi = apiMod.zoteroApi;
  }
  if (!attachmentManager) {
    const attMod = await import('@zotero-headless/attachment-manager');
    attachmentManager = attMod.attachmentManager;
  }
}

/**
 * 格式化日期显示
 * 数据库统一使用秒级 Unix 时间戳
 */
function formatDate(dateValue: any): string {
  if (!dateValue) return 'Unknown';

  try {
    let timestamp: number;

    // 如果是 Date 对象（Drizzle 转换后的）
    if (dateValue instanceof Date) {
      // Drizzle 的 mode: 'timestamp' 会返回 Date 对象
      // 但如果时间戳有问题，Date 对象可能无效
      if (isNaN(dateValue.getTime())) {
        return 'Invalid date';
      }
      return dateValue.toISOString().split('T')[0];
    }

    // 如果是数字（应该是秒级时间戳）
    if (typeof dateValue === 'number') {
      timestamp = dateValue * 1000;  // 秒 -> 毫秒
    } else {
      // 尝试解析字符串
      const date = new Date(dateValue);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
      return 'Invalid date';
    }

    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      return 'Invalid date';
    }
    return date.toISOString().split('T')[0];
  } catch {
    return 'Invalid date';
  }
}

/**
 * 格式化完整日期时间
 * 数据库统一使用秒级 Unix 时间戳
 */
function formatDateTime(dateValue: any): string {
  if (!dateValue) return 'Unknown';

  try {
    let timestamp: number;

    if (dateValue instanceof Date) {
      if (isNaN(dateValue.getTime())) {
        return 'Invalid date';
      }
      return dateValue.toISOString();
    }

    if (typeof dateValue === 'number') {
      timestamp = dateValue * 1000;  // 秒 -> 毫秒
    } else {
      const date = new Date(dateValue);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
      return 'Invalid date';
    }

    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      return 'Invalid date';
    }
    return date.toISOString();
  } catch {
    return 'Invalid date';
  }
}

/**
 * Generate a Zotero-compatible object key
 * Uses the same algorithm as Zotero Desktop:
 * - 8 characters from allowedKeyChars
 * - Excludes 0, 1, O to avoid visual confusion
 */
function generateKey(): string {
  // Zotero's allowedKeyChars: "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ"
  // Excludes: 0, 1, O (to avoid confusion with O, I, L)
  const allowedKeyChars = '23456789ABCDEFGHIJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 8 }, () =>
    allowedKeyChars.charAt(
      Math.floor(Math.random() * allowedKeyChars.length)
    )
  ).join('');
}

/**
 * Get MIME content type from filename
 */
function getContentType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || '';
  const mimeTypes: Record<string, string> = {
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'txt': 'text/plain',
    'rtf': 'application/rtf',
    'html': 'text/html',
    'htm': 'text/html',
    'epub': 'application/epub+zip',
    'mobi': 'application/x-mobipocket-ebook',
    'zip': 'application/zip',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'mp4': 'video/mp4',
    'mp3': 'audio/mpeg',
    'json': 'application/json',
    'xml': 'application/xml',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// ============ CLI Commands ============

export interface CommandOption {
  name: string;
  alias?: string;
  description: string;
  value?: string; // value placeholder like "<type>", "<N>"
}

export interface Command {
  name: string;
  aliases?: string[];
  description: string;
  options?: CommandOption[];
  examples?: string[];
  execute: (args: string[], invokedAs?: string) => Promise<void>;
}

// Shell mode flag — when true, permanent delete is allowed
let _shellMode = false;
export function setShellMode(v: boolean) { _shellMode = v; }

const commands: Command[] = [
  {
    name: 'sync',
    aliases: ['s', 'pull', 'fetch', 'refresh'],
    description: 'Synchronize library with Zotero servers',
    options: [
      { name: '--full-sync', alias: '-f', description: 'Perform a full sync (ignore version cache)' },
      { name: '--groups', alias: '-g', description: 'Sync all group libraries' },
      { name: '--group', alias: '-G', description: 'Sync specific group library', value: '<id>' },
      { name: '--quiet', alias: '-q', description: 'Quiet mode (no progress bar)' },
      { name: '--interactive', alias: '-i', description: 'Interactive conflict resolution' },
    ],
    examples: [
      'zotero sync',
      'zotero sync -f',
      'zotero sync -g',
      'zotero sync -G12345',
    ],
    execute: async (args) => {
      await initModules();
      const fullSync = args.includes('--full-sync') || args.includes('-f');
      const syncGroups = args.includes('--groups') || args.includes('-g');
      const quiet = args.includes('--quiet') || args.includes('-q');
      const interactive = args.includes('--interactive') || args.includes('-i');
      const groupArg = args.find(arg => arg.startsWith('--group='))?.split('=')[1] ||
                       args.find(arg => arg.startsWith('-G'))?.substring(2);

      if (!quiet) {
        console.log(t('commands.sync.starting'));
        if (fullSync) {
          console.log(t('commands.sync.fullSync'));
        }
        if (syncGroups) {
          console.log(t('commands.sync.groupSync'));
        }
        if (groupArg) {
          console.log(t('commands.sync.groupSingle', groupArg));
        }
        console.log('');
      }

      // Create progress bar if not quiet
      let progressBar: ProgressBar | null = null;

      const result = await syncManager.sync({
        fullSync,
        syncAll: syncGroups,
        groupId: groupArg,
        onProgress: quiet ? undefined : (progress) => {
          if (progress.total > 0) {
            if (!progressBar) {
              progressBar = new ProgressBar({
                total: progress.total,
                label: progress.phase
              });
            }
            progressBar.update(progress.current, progress.phase);

            if (progress.phase === 'complete') {
              progressBar.complete();
              progressBar = null;
            }
          }
        }
      });

      // Handle conflicts interactively if requested
      if (result.conflicts && result.conflicts.length > 0) {
        if (interactive && isInteractive()) {
          console.log(`\n!  ${result.conflicts.length} ${t('conflict.title')}`);

          // Get database connection
          const db = getDatabase();

          // Get item details for conflicts
          const conflictItems: ConflictItem[] = [];
          for (const key of result.conflicts) {
            const item = await db.select()
              .from(items)
              .where(eq(items.key, key))
              .get();
            if (item) {
              conflictItems.push({
                key,
                title: item.title || undefined,
                localVersion: item.version,
                remoteVersion: item.version + 1
              });
            }
          }

          // Interactive resolution
          const resolutions = await resolveConflictsInteractive(conflictItems);

          // Apply resolutions
          let resolvedCount = 0;
          for (const [key, resolution] of resolutions) {
            if (resolution === 'remote') {
              // Use remote: clear deleted flag, reset version to re-download on next sync
              console.log(`   ${t('conflict.remote')}: ${key}`);
              await db.update(items)
                .set({ deleted: 0, version: 0, synced: 0 })
                .where(eq(items.key, key))
                .run();
              resolvedCount++;
            } else if (resolution === 'local') {
              // Use local: remove from DB (will be recreated if needed)
              console.log(`   ${t('conflict.local')}: ${key}`);
              await db.delete(items)
                .where(eq(items.key, key))
                .run();
              resolvedCount++;
            }
          }

          console.log(`\n${symbols.success} ${t('common.success')}: ${resolvedCount}`);
        } else if (!quiet) {
          console.log(`\n!  ${result.conflicts.length} conflicts detected.`);
          console.log('   Run with --interactive (-i) to resolve manually');
          console.log('   Or use --conflict-strategy=remote|local for auto-resolution');
        }
      }

      if (result.success) {
        if (!quiet) {
          console.log(`\n${symbols.success} Sync completed successfully!`);
          console.log(`   Items updated: ${result.updated}`);
          console.log(`   Items deleted: ${result.deleted}`);
        }
      } else {
        console.log(`\n!  Sync completed with issues:`);
        result.errors.forEach(e => console.log(`   Error: ${e}`));
        if (result.conflicts && result.conflicts.length > 0 && !interactive) {
          console.log(`   Conflicts: ${result.conflicts.length}`);
          result.conflicts.forEach(c => console.log(`     - ${c}`));
        }
        throw new Error(`Sync completed with ${result.errors.length} errors`);
      }
    }
  },

  {
    name: 'attachment-download',
    aliases: ['attdl', 'down'],
    description: 'Download attachment from WebDAV',
    options: [
      { name: '--force', alias: '-f', description: 'Overwrite existing file' },
    ],
    examples: [
      'zotero attachment-download ABC123',
      'zotero attdl ABC123 -f',
    ],
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-download <key>'); return; }
      const result = await attachmentManager.downloadFromWebDAV(args[0]);
      console.log(result.success ? `${symbols.success} Downloaded to ${result.localPath}` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-open',
    aliases: ['atto', 'open'],
    description: 'Open attachment with system default app',
    options: [
      { name: '--wait', alias: '-w', description: 'Wait for application to close' },
    ],
    examples: [
      'zotero attachment-open ABC123',
      'zotero atto ABC123 -w',
    ],
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-open <key>'); return; }
      const result = await attachmentManager.openAttachment(args[0]);
      console.log(result.success ? `${symbols.success} Opened` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-dedup',
    aliases: ['attdedup', 'dedup'],
    description: 'Find and remove duplicate attachments',
    options: [
      { name: '--delete', alias: '-d', description: 'Automatically delete duplicates' },
      { name: '--dry-run', description: 'Show duplicates without deleting' },
    ],
    examples: [
      'zotero attachment-dedup',
      'zotero attdedup --dry-run',
      'zotero attdedup --delete',
    ],
    execute: async (args) => {
      await initModules();
      const result = await attachmentManager.findDuplicates();
      if (!result.success) { console.log(`${symbols.error} ${result.error}`); return; }
      console.log(`Found ${result.duplicates.length} duplicates`);
      if (args.includes('--delete')) {
        for (const g of result.duplicates) {
          await attachmentManager.removeDuplicates(g);
        }
        console.log(' Removed');
      }
    }
  },

  {
    name: 'groups',
    aliases: ['g', 'team', 'org'],
    description: 'List and sync group libraries. Aliases: g, team, org. Use --sync <group-id> to sync a group library',
    options: [
      { name: '--sync', alias: '-s', description: 'Sync specific group library', value: '<group-id>' },
    ],
    examples: [
      'zotero groups',
      'zotero groups --sync 12345',
    ],
    execute: async (args) => {
      await initModules();

      // Check for sync option
      const syncIndex = args.indexOf('--sync');
      if (syncIndex >= 0 && args[syncIndex + 1]) {
        const groupId = args[syncIndex + 1];
        console.log(`Syncing group library ${groupId}...\n`);
        
        try {
          const result = await syncManager.syncGroup(groupId);
          if (result.success) {
            console.log(`${symbols.success} Group library synced successfully!`);
            console.log(`   Downloaded: ${result.downloaded || 0}`);
            console.log(`   Updated: ${result.updated || 0}`);
          } else {
            console.log(`${symbols.error} Sync failed: ${result.error}`);
          }
        } catch (error: any) {
          console.log(`${symbols.error} Error: ${error.message}`);
        }
        return;
      }

      // List groups
      console.log('Fetching your groups...');
      const groups = await syncManager.getUserGroups();

      if (groups.length === 0) {
        console.log('   No groups found.');
        console.log('\nTo create a group, visit: https://www.zotero.org/groups/new');
        return;
      }

      console.log(`\nYour Groups (${groups.length}):\n`);
      groups.forEach(group => {
        const accessIcon = group.accessLevel === 'write' ? '✏️' : '👁️';
        const libraryIcon = group.isLibrary ? '' : '👥';
        console.log(`  ${libraryIcon} ${accessIcon} [${group.groupId}] ${group.name}`);
        console.log(`      Access: ${group.accessLevel}`);
        console.log(`      Sync: zotero groups --sync ${group.groupId}`);
        console.log('');
      });
      
      console.log('To sync a group library:');
      console.log('   zotero groups --sync <group-id>');
    }
  },

  {
    name: 'attachment-download',
    aliases: ['attdl', 'down'],
    description: 'Download attachment from WebDAV',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-download <key>'); return; }
      const result = await attachmentManager.downloadFromWebDAV(args[0]);
      console.log(result.success ? `${symbols.success} Downloaded to ${result.localPath}` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-open',
    aliases: ['atto', 'open'],
    description: 'Open attachment with system default app',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-open <key>'); return; }
      const result = await attachmentManager.openAttachment(args[0]);
      console.log(result.success ? `${symbols.success} Opened` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-dedup',
    aliases: ['attdedup', 'dedup'],
    description: 'Find and remove duplicate attachments',
    execute: async (args) => {
      await initModules();
      const result = await attachmentManager.findDuplicates();
      if (!result.success) { console.log(`${symbols.error} ${result.error}`); return; }
      console.log(`Found ${result.duplicates.length} duplicates`);
      if (args.includes('--delete')) {
        for (const g of result.duplicates) {
          await attachmentManager.removeDuplicates(g);
        }
        console.log(' Removed');
      }
    }
  },

  {
    name: 'sync:upload',
    aliases: ['su'],
    description: 'Upload local changes only',
    options: [
      { name: '--force', alias: '-f', description: 'Force upload even if unchanged' },
    ],
    examples: [
      'zotero sync:upload',
      'zotero sync:upload -f',
    ],
    execute: async () => {
      console.log('This would upload local changes...');
      // Implementation for upload-only would go here
    }
  },

  {
    name: 'attachment-download',
    aliases: ['attdl', 'down'],
    description: 'Download attachment from WebDAV',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-download <key>'); return; }
      const result = await attachmentManager.downloadFromWebDAV(args[0]);
      console.log(result.success ? `${symbols.success} Downloaded to ${result.localPath}` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-open',
    aliases: ['atto', 'open'],
    description: 'Open attachment with system default app',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-open <key>'); return; }
      const result = await attachmentManager.openAttachment(args[0]);
      console.log(result.success ? `${symbols.success} Opened` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-dedup',
    aliases: ['attdedup', 'dedup'],
    description: 'Find and remove duplicate attachments',
    execute: async (args) => {
      await initModules();
      const result = await attachmentManager.findDuplicates();
      if (!result.success) { console.log(`${symbols.error} ${result.error}`); return; }
      console.log(`Found ${result.duplicates.length} duplicates`);
      if (args.includes('--delete')) {
        for (const g of result.duplicates) {
          await attachmentManager.removeDuplicates(g);
        }
        console.log(' Removed');
      }
    }
  },

  {
    name: 'list',
    aliases: ['ls', 'll', 'la'],
    description: 'List items in the library',
    options: [
      { name: '--type', alias: '-t', description: 'Filter by item type', value: '<type>' },
      { name: '--unsynced', alias: '-u', description: 'Show only unsynced items' },
      { name: '--deleted', alias: '-d', description: 'Show deleted items' },
      { name: '--since', alias: '-s', description: 'Show items updated since date', value: '<YYYY-MM-DD>' },
      { name: '--until', alias: '-e', description: 'Show items updated until date', value: '<YYYY-MM-DD>' },
      { name: '--sort', description: 'Sort by field (title|date|updated|type)', value: '<field>' },
      { name: '--order', description: 'Sort order (asc|desc)', value: '<order>' },
      { name: '--limit', alias: '-l', description: 'Limit number of results', value: '<N>' },
      { name: '--offset', alias: '-o', description: 'Offset for pagination', value: '<N>' },
      { name: '--compact', alias: '-c', description: 'Compact output format' },
    ],
    examples: [
      'zotero list',
      'zotero ls -t book',
      'zotero ls -u -l 10',
      'zotero la',
      'zotero ll --sort title',
    ],
    execute: async (args, invokedAs) => {
      const isDetailed = invokedAs === 'll';  // Check if invoked as 'll'
      const isCompact = invokedAs === 'la';   // Check if invoked as 'la'
      await initModules();
      const db = getDatabase();

      // Parse options
      const { configManager } = await import('@zotero-headless/core');
      const configLimit = configManager.get('display')?.defaultLimit || 20;
      
      const options: {
        type?: string;
        unsynced?: boolean;
        deleted?: boolean;
        since?: string;
        until?: string;
        sort?: 'title' | 'date' | 'updated' | 'type';
        order?: 'asc' | 'desc';
        limit: number;
        offset: number;
        compact?: boolean;
      } = { limit: configLimit, offset: 0 };

      const positionalArgs: string[] = [];

      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--type' || arg === '-t') {
          options.type = args[++i];
        } else if (arg === '--unsynced' || arg === '-u') {
          options.unsynced = true;
        } else if (arg === '--deleted' || arg === '-d') {
          options.deleted = true;
        } else if (arg === '--since' || arg === '-s') {
          options.since = args[++i];
        } else if (arg === '--until' || arg === '-e') {
          options.until = args[++i];
        } else if (arg === '--sort') {
          options.sort = args[++i] as any;
        } else if (arg === '--order') {
          options.order = args[++i] as any;
        } else if (arg === '--limit' || arg === '-l') {
          options.limit = parseInt(args[++i]) || 20;
        } else if (arg === '--offset' || arg === '-o') {
          options.offset = parseInt(args[++i]) || 0;
        } else if (arg === '--compact' || arg === '-c') {
          options.compact = true;
        } else if (!arg.startsWith('-')) {
          positionalArgs.push(arg);
        }
      }

      // Backward compatibility: positional args as limit/offset
      if (positionalArgs.length > 0) options.limit = parseInt(positionalArgs[0]) || 20;
      if (positionalArgs.length > 1) options.offset = parseInt(positionalArgs[1]) || 0;

      // Determine output mode: compact if --compact, -c, or invoked as 'la'
      const useCompact = options.compact || isCompact;

      const library = await db.select().from(libraries).get();
      if (!library) {
        console.log(`${symbols.error} No library found. Run "sync" first.`);
        return;
      }

      // Build where conditions
      let whereConditions: any = eq(items.libraryId, library.id);

      if (options.type) {
        whereConditions = and(whereConditions, eq(items.itemType, options.type));
      }
      if (options.unsynced) {
        whereConditions = and(whereConditions, eq(items.synced, false));
      }
      if (options.deleted) {
        whereConditions = and(whereConditions, eq(items.deleted, true));
      } else {
        // By default, hide deleted items
        whereConditions = and(whereConditions, eq(items.deleted, false));
      }
      if (options.since) {
        const sinceDate = new Date(options.since).getTime();
        if (!isNaN(sinceDate)) {
          whereConditions = and(whereConditions, desc(items.updatedAt) >= sinceDate);
        }
      }
      if (options.until) {
        const untilDate = new Date(options.until).getTime();
        if (!isNaN(untilDate)) {
          whereConditions = and(whereConditions, desc(items.updatedAt) <= untilDate);
        }
      }

      // Build order by
      let orderByColumn = items.updatedAt;
      if (options.sort === 'title') orderByColumn = items.title;
      else if (options.sort === 'date') orderByColumn = items.publicationDate;
      else if (options.sort === 'type') orderByColumn = items.itemType;

      const orderDirection = options.order === 'asc' ? asc : desc;

      // Build the query using sql`` for subquery
      const attachmentCountSubquery = sql<number>`(
        SELECT COUNT(*) FROM ${attachments}
        WHERE ${attachments.parentItemKey} = ${items.key}
        AND ${attachments.libraryId} = ${items.libraryId}
        AND (${attachments.deleted} IS NULL OR ${attachments.deleted} = 0)
      )`.as('attachmentCount');

      const results = await db.select({
        key: items.key,
        title: items.title,
        itemType: items.itemType,
        updatedAt: items.updatedAt,
        synced: items.synced,
        deleted: items.deleted,
        attachmentCount: attachmentCountSubquery,
      })
        .from(items)
        .where(whereConditions)
        .orderBy(orderDirection(orderByColumn))
        .limit(options.limit)
        .offset(options.offset)
        .all();

      // Build filter description
      const filters: string[] = [];
      if (options.type) filters.push(`type:${options.type}`);
      if (options.unsynced) filters.push('unsynced');
      if (options.deleted) filters.push('deleted');
      if (options.since) filters.push(`since:${options.since}`);
      if (options.until) filters.push(`until:${options.until}`);
      if (options.sort) filters.push(`sort:${options.sort}(${options.order || 'desc'})`);

      const filterDesc = filters.length > 0 ? ` (filtered: ${filters.join(', ')})` : '';
      console.log(`\nItems (${results.length} shown)${filterDesc}:\n`);

      if (results.length === 0) {
        console.log('   No items match the criteria.');
        return;
      }

      if (useCompact) {
        // Compact mode: similar to ls -alF
        // Format: [sync][type] [attachments] [date] [title]
        // Indicators: / = has attachments, * = unsynced, X = deleted
        const formatCompactDate = (timestamp: number) => {
          const d = new Date(timestamp * 1000);
          const now = new Date();
          const isCurrentYear = d.getFullYear() === now.getFullYear();
          
          if (isCurrentYear) {
            // Same year: show "Mon DD HH:MM"
            return d.toLocaleDateString('en-US', { 
              month: 'short', 
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit'
            }).replace(',', '');
          } else {
            // Different year: show "Mon DD  YYYY"
            return d.toLocaleDateString('en-US', { 
              month: 'short', 
              day: '2-digit',
              year: 'numeric'
            });
          }
        };

        results.forEach(item => {
          const syncIndicator = item.synced ? '✓' : '*';
          const delIndicator = item.deleted ? 'X' : ' ';
          const attCount = Number(item.attachmentCount) || 0;
          const attIndicator = attCount > 0 ? '/' : ' ';
          const attDisplay = attCount > 0 ? String(attCount).padStart(2, ' ') : '  ';
          
          const dateStr = formatCompactDate(item.updatedAt);
          const titleStr = (item.title?.substring(0, 50) || '(no title)').padEnd(50, ' ');
          const typeStr = item.itemType.padEnd(12, ' ');
          
          // Format: [S][D][A] [#] [date] [type] [title]
          // S = sync status, D = deleted, A = has attachments
          console.log(`${syncIndicator}${delIndicator}${attIndicator} ${attDisplay} ${dateStr}  ${typeStr}  ${titleStr}`);
        });
        
        // Print legend
        console.log(`\nLegend: [Sync][Del][Att] [#Att] [Date] [Type] [Title]`);
        console.log(`  Sync: ✓=synced *=unsynced`);
        console.log(`  Del:  X=deleted  =active`);
        console.log(`  Att:  /=has attachments  =none`);
      } else if (isDetailed) {
        // Detailed mode (ll)
        results.forEach(item => {
          const syncStatus = item.synced ? symbols.success : '';
          const delStatus = item.deleted ? ' (deleted)' : '';
          const attCount = Number(item.attachmentCount) || 0;
          const attIcon = attCount > 0 ? ` ${attCount}` : '';
          console.log(`  ${syncStatus} [${item.key}] ${item.title?.substring(0, 60) || '(no title)'}${delStatus}${attIcon}`);
          console.log(`      Type: ${item.itemType} | Updated: ${formatDate(item.updatedAt)} | Key: ${item.key}`);
          console.log();
        });
      } else {
        // Standard mode (ls)
        results.forEach(item => {
          const syncStatus = item.synced ? symbols.success : '';
          const delStatus = item.deleted ? ' (deleted)' : '';
          const attCount = Number(item.attachmentCount) || 0;
          const attIcon = attCount > 0 ? ` ${attCount}` : '';
          console.log(`  ${syncStatus} [${item.key}] ${item.title?.substring(0, 60) || '(no title)'}${delStatus}${attIcon}`);
          console.log(`      Type: ${item.itemType} | Updated: ${formatDate(item.updatedAt)}`);
          console.log();
        });
      }
    }
  },

  {
    name: 'attachment-download',
    aliases: ['attdl', 'down'],
    description: 'Download attachment from WebDAV',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-download <key>'); return; }
      const result = await attachmentManager.downloadFromWebDAV(args[0]);
      console.log(result.success ? `${symbols.success} Downloaded to ${result.localPath}` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-open',
    aliases: ['atto', 'open'],
    description: 'Open attachment with system default app',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-open <key>'); return; }
      const result = await attachmentManager.openAttachment(args[0]);
      console.log(result.success ? `${symbols.success} Opened` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-dedup',
    aliases: ['attdedup', 'dedup'],
    description: 'Find and remove duplicate attachments',
    execute: async (args) => {
      await initModules();
      const result = await attachmentManager.findDuplicates();
      if (!result.success) { console.log(`${symbols.error} ${result.error}`); return; }
      console.log(`Found ${result.duplicates.length} duplicates`);
      if (args.includes('--delete')) {
        for (const g of result.duplicates) {
          await attachmentManager.removeDuplicates(g);
        }
        console.log(' Removed');
      }
    }
  },

  {
    name: 'list:unsynced',
    aliases: ['lsu'],
    description: 'List unsynced items',
    options: [
      { name: '--limit', alias: '-l', description: 'Limit number of results', value: '<N>' },
    ],
    examples: [
      'zotero list:unsynced',
      'zotero list:unsynced -l 50',
    ],
    execute: async () => {
      await initModules();
      const db = getDatabase();
      const library = await db.select().from(libraries).get();
      if (!library) {
        console.log(`${symbols.error} No library found. Run "sync" first.`);
        return;
      }

      const results = await db.select()
        .from(items)
        .where(and(
          eq(items.libraryId, library.id),
          eq(items.synced, false)
        ))
        .all();

      console.log(`\nUnsynced items (${results.length}):\n`);
      if (results.length === 0) {
        console.log('   All items are synced!');
      } else {
        results.forEach(item => {
          console.log(`  [${item.key}] ${item.title?.substring(0, 60) || '(no title)'}`);
        });
      }
    }
  },

  {
    name: 'attachment-download',
    aliases: ['attdl', 'down'],
    description: 'Download attachment from WebDAV',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-download <key>'); return; }
      const result = await attachmentManager.downloadFromWebDAV(args[0]);
      console.log(result.success ? `${symbols.success} Downloaded to ${result.localPath}` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-open',
    aliases: ['atto', 'open'],
    description: 'Open attachment with system default app',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-open <key>'); return; }
      const result = await attachmentManager.openAttachment(args[0]);
      console.log(result.success ? `${symbols.success} Opened` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-dedup',
    aliases: ['attdedup', 'dedup'],
    description: 'Find and remove duplicate attachments',
    execute: async (args) => {
      await initModules();
      const result = await attachmentManager.findDuplicates();
      if (!result.success) { console.log(`${symbols.error} ${result.error}`); return; }
      console.log(`Found ${result.duplicates.length} duplicates`);
      if (args.includes('--delete')) {
        for (const g of result.duplicates) {
          await attachmentManager.removeDuplicates(g);
        }
        console.log(' Removed');
      }
    }
  },

  {
    name: 'search',
    aliases: ['find', 'grep', 'f'],
    description: 'Search items by keywords',
    options: [
      { name: '--field', alias: '-f', description: 'Search field (title|author|tags|note|all)', value: '<field>' },
      { name: '--since', alias: '-s', description: 'Search items since date', value: '<YYYY-MM-DD>' },
      { name: '--unsynced', alias: '-u', description: 'Search only unsynced items' },
      { name: '--limit', alias: '-l', description: 'Limit number of results', value: '<N>' },
    ],
    examples: [
      'zotero search "machine learning"',
      'zotero grep "Smith" -f author',
      'zotero f "findings" --field note',
    ],
    execute: async (args) => {
      await initModules();

      // Parse options
      const options: {
        query: string;
        field: 'title' | 'author' | 'tags' | 'note' | 'all';
        since?: string;
        unsynced?: boolean;
        limit: number;
      } = {
        field: 'title',
        limit: 20
      };

      const queryParts: string[] = [];

      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--field' || arg === '-f') {
          options.field = args[++i] as any;
        } else if (arg === '--since' || arg === '-s') {
          options.since = args[++i];
        } else if (arg === '--unsynced' || arg === '-u') {
          options.unsynced = true;
        } else if (arg === '--limit' || arg === '-l') {
          options.limit = parseInt(args[++i]) || 20;
        } else if (!arg.startsWith('-')) {
          queryParts.push(arg);
        }
      }

      options.query = queryParts.join(' ');

      if (!options.query) {
        console.log(`${symbols.error} Please provide a search query`);
        console.log('   Usage: zotero search <query> [options]');
        console.log('   Options:');
        console.log('     --field title|author|tags|note|all  (default: title)');
        console.log('       note: search in note content (Markdown/HTML)');
        console.log('     --since YYYY-MM-DD');
        console.log('     --unsynced');
        console.log('     --limit N');
        console.log('');
        console.log('   Examples:');
        console.log('     zotero search "machine learning"');
        console.log('     zotero search "findings" --field note');
        console.log('     zotero search "Smith" --field author');
        return;
      }

      const db = getDatabase();
      const library = await db.select().from(libraries).get();

      if (!library) {
        console.log(`${symbols.error} No library found. Run "sync" first.`);
        return;
      }

      let results: any[] = [];

      // Note content search (special handling)
      if (options.field === 'note') {
        // Search in notes' rawJson for the query
        const noteResults = await db.select()
          .from(items)
          .where(and(
            eq(items.libraryId, library.id),
            eq(items.itemType, 'note'),
            like(items.rawJson, `%${options.query}%`)
          ))
          .limit(options.limit)
          .all();

        // Also get parent items
        const parentKeys = new Set<string>();
        for (const note of noteResults) {
          try {
            const rawData = JSON.parse(note.rawJson || '{}');
            const data = rawData.data || rawData;
            if (data.parentItem) {
              parentKeys.add(data.parentItem);
            }
          } catch {
            // ignore
          }
        }

        // Get parent items
        if (parentKeys.size > 0) {
          const parentItems = await db.select()
            .from(items)
            .where(and(
              eq(items.libraryId, library.id),
              sql`${items.key} IN (${Array.from(parentKeys).map(k => `'${k}'`).join(',')})`
            ))
            .all();

          // Merge with notes
          results = [...parentItems, ...noteResults];
        } else {
          results = noteResults;
        }
      } else {
        // Build search conditions for regular fields
        let whereConditions: any = eq(items.libraryId, library.id);

        // Field-specific search
        if (options.field === 'title' || options.field === 'all') {
          whereConditions = and(whereConditions, like(items.title, `%${options.query}%`));
        } else if (options.field === 'author') {
          whereConditions = and(whereConditions, like(items.creators, `%${options.query}%`));
        } else if (options.field === 'tags') {
          whereConditions = and(whereConditions, like(items.tags, `%${options.query}%`));
        }

        // Date filter
        if (options.since) {
          const sinceDate = new Date(options.since).getTime();
          if (!isNaN(sinceDate)) {
            whereConditions = and(whereConditions, desc(items.updatedAt) >= sinceDate);
          }
        }

        // Unsynced filter
        if (options.unsynced) {
          whereConditions = and(whereConditions, eq(items.synced, false));
        }

        results = await db.select()
          .from(items)
          .where(whereConditions)
          .limit(options.limit)
          .all();
      }

      // Build search description
      const filters: string[] = [];
      if (options.field !== 'title') filters.push(`field:${options.field}`);
      if (options.since) filters.push(`since:${options.since}`);
      if (options.unsynced) filters.push('unsynced');

      const filterDesc = filters.length > 0 ? ` (${filters.join(', ')})` : '';
      console.log(`\nSearch results for "${options.query}"${filterDesc} (${results.length}):\n`);

      if (results.length === 0) {
        console.log('   No results found.');
      } else {
        results.forEach(item => {
          const syncStatus = item.synced ? symbols.success : '';
          const itemType = item.itemType === 'note' ? '' : '';
          console.log(`  ${itemType} ${syncStatus} [${item.key}] ${item.title?.substring(0, 60) || '(no title)'}`);
          if (options.field === 'author' && item.creators) {
            console.log(`      Authors: ${item.creators.substring(0, 50)}`);
          }
          if (options.field === 'note' && item.itemType === 'note') {
            // Show a snippet of the note content
            try {
              const { htmlToPlainText } = require('./note-utils.js');
              const rawData = JSON.parse(item.rawJson || '{}');
              const data = rawData.data || rawData;
              const content = data.note || '';
              const snippet = htmlToPlainText(content, 60);
              if (snippet) {
                console.log(`      Note: ${snippet}`);
              }
            } catch {
              // ignore
            }
          }
        });
      }
    }
  },

  {
    name: 'attachment-download',
    aliases: ['attdl', 'down'],
    description: 'Download attachment from WebDAV',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-download <key>'); return; }
      const result = await attachmentManager.downloadFromWebDAV(args[0]);
      console.log(result.success ? `${symbols.success} Downloaded to ${result.localPath}` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-open',
    aliases: ['atto', 'open'],
    description: 'Open attachment with system default app',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-open <key>'); return; }
      const result = await attachmentManager.openAttachment(args[0]);
      console.log(result.success ? `${symbols.success} Opened` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-dedup',
    aliases: ['attdedup', 'dedup'],
    description: 'Find and remove duplicate attachments',
    execute: async (args) => {
      await initModules();
      const result = await attachmentManager.findDuplicates();
      if (!result.success) { console.log(`${symbols.error} ${result.error}`); return; }
      console.log(`Found ${result.duplicates.length} duplicates`);
      if (args.includes('--delete')) {
        for (const g of result.duplicates) {
          await attachmentManager.removeDuplicates(g);
        }
        console.log(' Removed');
      }
    }
  },

  {
    name: 'get',
    aliases: ['show', 'cat', 'view'],
    description: 'Show item details. Aliases: show, cat, view',
    options: [
      { name: '--format', alias: '-f', description: 'Output format (json|yaml|text)', value: '<format>' },
      { name: '--attachments', alias: '-a', description: 'Include attachment info' },
    ],
    examples: [
      'zotero get ABC123',
      'zotero cat ABC123 -f json',
      'zotero show ABC123 -a',
    ],
    execute: async (args) => {
      await initModules();
      if (args.length === 0) {
        console.log(`${symbols.error} Please provide an item key`);
        console.log('   Usage: zotero get <key>');
        return;
      }

      const db = getDatabase();
      const key = args[0];
      const library = await db.select().from(libraries).get();

      if (!library) {
        console.log(`${symbols.error} No library found. Run "sync" first.`);
        return;
      }

      const item = await db.select()
        .from(items)
        .where(and(eq(items.key, key), eq(items.libraryId, library.id)))
        .get();

      if (!item) {
        console.log(`${symbols.error} Item ${key} not found.`);
        return;
      }

      console.log(`\nItem: ${key}\n`);
      console.log(`   Title: ${item.title || '(none)'}`);
      console.log(`   Type: ${item.itemType}`);
      console.log(`   DOI: ${item.doi || '(none)'}`);
      console.log(`   URL: ${item.url || '(none)'}`);
      console.log(`   Date: ${item.publicationDate || '(none)'}`);
      console.log(`   Created: ${formatDateTime(item.createdAt)}`);
      console.log(`   Updated: ${formatDateTime(item.updatedAt)}`);
      console.log(`   Synced: ${item.synced ? 'Yes' : 'No'}`);
      console.log(`   Deleted: ${item.deleted ? 'Yes' : 'No'}`);

      const creators = JSON.parse(item.creators || '[]');
      if (creators.length > 0) {
        console.log(`\n   Creators:`);
        creators.forEach((c: any) => {
          console.log(`     - ${c.firstName || ''} ${c.lastName || ''} (${c.creatorType})`);
        });
      }
    }
  },

  {
    name: 'attachment-download',
    aliases: ['attdl', 'down'],
    description: 'Download attachment from WebDAV',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-download <key>'); return; }
      const result = await attachmentManager.downloadFromWebDAV(args[0]);
      console.log(result.success ? `${symbols.success} Downloaded to ${result.localPath}` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-open',
    aliases: ['atto', 'open'],
    description: 'Open attachment with system default app',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-open <key>'); return; }
      const result = await attachmentManager.openAttachment(args[0]);
      console.log(result.success ? `${symbols.success} Opened` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-dedup',
    aliases: ['attdedup', 'dedup'],
    description: 'Find and remove duplicate attachments',
    execute: async (args) => {
      await initModules();
      const result = await attachmentManager.findDuplicates();
      if (!result.success) { console.log(`${symbols.error} ${result.error}`); return; }
      console.log(`Found ${result.duplicates.length} duplicates`);
      if (args.includes('--delete')) {
        for (const g of result.duplicates) {
          await attachmentManager.removeDuplicates(g);
        }
        console.log(' Removed');
      }
    }
  },

  {
    name: 'stats',
    aliases: ['st', 'info', 'status', 'df'],
    description: 'Show library statistics. Aliases: st, info, status, df',
    options: [
      { name: '--type', alias: '-t', description: 'Show stats for specific item type', value: '<type>' },
      { name: '--group', alias: '-g', description: 'Show stats by group library' },
    ],
    examples: [
      'zotero stats',
      'zotero stats -t book',
      'zotero stats --group',
    ],
    execute: async () => {
      await initModules();
      const db = getDatabase();

      const library = await db.select().from(libraries).get();
      if (!library) {
        console.log(`${symbols.error} No library found. Run "sync" first.`);
        return;
      }

      const totalResult = await db.select({ count: count() })
        .from(items)
        .where(eq(items.libraryId, library.id))
        .get();

      const deletedResult = await db.select({ count: count() })
        .from(items)
        .where(and(eq(items.libraryId, library.id), eq(items.deleted, true)))
        .get();

      const unsyncedResult = await db.select({ count: count() })
        .from(items)
        .where(and(eq(items.libraryId, library.id), eq(items.synced, false)))
        .get();

      console.log('\nLibrary Statistics:\n');
      console.log(`   Library: ${library.name || 'My Library'}`);
      console.log(`   Zotero ID: ${library.zoteroId}`);
      console.log(`   Version: ${library.version}`);
      console.log(`   Last Sync: ${formatDateTime(library.lastSyncAt) || 'Never'}`);
      console.log(`   ─────────────────────`);
      console.log(`   Total Items: ${totalResult?.count ?? 0}`);
      console.log(`   Deleted: ${deletedResult?.count ?? 0}`);
      console.log(`   Unsynced: ${unsyncedResult?.count ?? 0}`);
      console.log();
    }
  },

  {
    name: 'attachment-download',
    aliases: ['attdl', 'down'],
    description: 'Download attachment from WebDAV',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-download <key>'); return; }
      const result = await attachmentManager.downloadFromWebDAV(args[0]);
      console.log(result.success ? `${symbols.success} Downloaded to ${result.localPath}` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-open',
    aliases: ['atto', 'open'],
    description: 'Open attachment with system default app',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-open <key>'); return; }
      const result = await attachmentManager.openAttachment(args[0]);
      console.log(result.success ? `${symbols.success} Opened` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-dedup',
    aliases: ['attdedup', 'dedup'],
    description: 'Find and remove duplicate attachments',
    execute: async (args) => {
      await initModules();
      const result = await attachmentManager.findDuplicates();
      if (!result.success) { console.log(`${symbols.error} ${result.error}`); return; }
      console.log(`Found ${result.duplicates.length} duplicates`);
      if (args.includes('--delete')) {
        for (const g of result.duplicates) {
          await attachmentManager.removeDuplicates(g);
        }
        console.log(' Removed');
      }
    }
  },

  {
    name: 'verify',
    aliases: ['v', 'check', 'test', 'ping'],
    description: 'Verify API key and connection. Aliases: v, check, test, ping',
    options: [
      { name: '--fix', description: 'Attempt to fix verification issues' },
      { name: '--verbose', alias: '-v', description: 'Show detailed output' },
    ],
    examples: [
      'zotero verify',
      'zotero verify --fix',
      'zotero v -v',
    ],
    execute: async () => {
      await initModules();
      console.log('Verifying API key...\n');
      try {
        const keyInfo = await zoteroApi.verifyKey();
        console.log(`${symbols.success} API key is valid!`);
        console.log(`   Username: ${keyInfo.username}`);
        console.log(`   User ID: ${keyInfo.userID}`);
        console.log(`\n   Access:`);
        console.log(`     Library: ${keyInfo.access.user.library ? symbols.success : symbols.error}`);
        console.log(`     Files: ${keyInfo.access.user.files ? symbols.success : symbols.error}`);
        console.log(`     Notes: ${keyInfo.access.user.notes ? symbols.success : symbols.error}`);
        console.log(`     Write: ${keyInfo.access.user.write ? symbols.success : symbols.error}`);
      } catch (e) {
        console.log(`${symbols.error} API key verification failed!`);
        console.log(`   Error: ${e}`);
        process.exit(1);
      }
    }
  },

  {
    name: 'attachment-download',
    aliases: ['attdl', 'down'],
    description: 'Download attachment from WebDAV',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-download <key>'); return; }
      const result = await attachmentManager.downloadFromWebDAV(args[0]);
      console.log(result.success ? `${symbols.success} Downloaded to ${result.localPath}` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-open',
    aliases: ['atto', 'open'],
    description: 'Open attachment with system default app',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-open <key>'); return; }
      const result = await attachmentManager.openAttachment(args[0]);
      console.log(result.success ? `${symbols.success} Opened` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-dedup',
    aliases: ['attdedup', 'dedup'],
    description: 'Find and remove duplicate attachments',
    execute: async (args) => {
      await initModules();
      const result = await attachmentManager.findDuplicates();
      if (!result.success) { console.log(`${symbols.error} ${result.error}`); return; }
      console.log(`Found ${result.duplicates.length} duplicates`);
      if (args.includes('--delete')) {
        for (const g of result.duplicates) {
          await attachmentManager.removeDuplicates(g);
        }
        console.log(' Removed');
      }
    }
  },

  // ============ Attachment & WebDAV Commands ============

  {
    name: 'attachments',
    aliases: ['att', 'files', 'docs'],
    description: 'List attachments. Aliases: att, files, docs',
    examples: [
      'zotero attachments ABC123',
      'zotero att ABC123',
    ],
    execute: async (args) => {
      await initModules();
      const options: {
        itemKey?: string;
        webdavSynced?: boolean;
        limit: number;
      } = {
        limit: 50
      };

      // Parse arguments
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--item' && args[i + 1]) {
          options.itemKey = args[++i];
        } else if (arg === '--webdav' && args[i + 1]) {
          const val = args[++i];
          options.webdavSynced = val === 'true' || val === 'yes' || val === '1';
        } else if (arg === '--limit' && args[i + 1]) {
          options.limit = parseInt(args[++i]) || 50;
        }
      }

      const db = getDatabase();
      const library = await db.select().from(libraries).get();

      if (!library) {
        console.log(`${symbols.error} No library found. Run "sync" first.`);
        return;
      }

      const attachmentList = await attachmentManager.listAttachments({
        libraryId: library.id,
        itemKey: options.itemKey,
        webdavSynced: options.webdavSynced,
        limit: options.limit,
      });

      console.log(`\nAttachments (${attachmentList.length}):\n`);

      if (attachmentList.length === 0) {
        console.log('   No attachments found.');
      } else {
        attachmentList.forEach(att => {
          const webdavStatus = att.webdavSynced ? '' : '';
          const typeIcon = att.attachmentType === 'link' ? '🔗' : '';
          console.log(`  ${webdavStatus} ${typeIcon} [${att.key}] ${att.filename}`);
          console.log(`      Title: ${att.title}`);
          console.log(`      Size: ${att.fileSize ? (att.fileSize / 1024).toFixed(1) + ' KB' : 'N/A'}`);
          if (att.webdavPath) {
            console.log(`      WebDAV: ${att.webdavPath}`);
          }
          console.log();
        });
      }
    }
  },

  {
    name: 'attachment-download',
    aliases: ['attdl', 'down'],
    description: 'Download attachment from WebDAV',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-download <key>'); return; }
      const result = await attachmentManager.downloadFromWebDAV(args[0]);
      console.log(result.success ? `${symbols.success} Downloaded to ${result.localPath}` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-open',
    aliases: ['atto', 'open'],
    description: 'Open attachment with system default app',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-open <key>'); return; }
      const result = await attachmentManager.openAttachment(args[0]);
      console.log(result.success ? `${symbols.success} Opened` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-dedup',
    aliases: ['attdedup', 'dedup'],
    description: 'Find and remove duplicate attachments',
    execute: async (args) => {
      await initModules();
      const result = await attachmentManager.findDuplicates();
      if (!result.success) { console.log(`${symbols.error} ${result.error}`); return; }
      console.log(`Found ${result.duplicates.length} duplicates`);
      if (args.includes('--delete')) {
        for (const g of result.duplicates) {
          await attachmentManager.removeDuplicates(g);
        }
        console.log(' Removed');
      }
    }
  },

  {
    name: 'webdav:config',
    aliases: ['wdc'],
    description: 'Configure WebDAV server (files stored under <basePath>/zotero/)',
    options: [
      { name: '--auto-sync', description: 'Enable/disable auto-sync for attachments', value: '<true|false>' },
      { name: '--base-path', description: 'Base path for WebDAV storage (default: /)', value: '<path>' },
    ],
    examples: [
      'zotero webdav:config https://dav.example.com user pass',
      'zotero webdav:config https://dav.example.com user pass /mydata --auto-sync true',
      'zotero webdav:config --auto-sync true     # Update existing config',
      'zotero webdav:config --base-path /mydata  # Update base path only',
    ],
    execute: async (args) => {
      await initModules();
      
      // Parse arguments
      let url: string | undefined;
      let username: string | undefined;
      let password: string | undefined;
      let basePath: string | undefined;
      let autoSync: boolean | undefined;
      
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--auto-sync') {
          const val = args[++i];
          autoSync = val === 'true' || val === 'yes' || val === '1';
        } else if (arg.startsWith('--auto-sync=')) {
          const val = arg.split('=')[1];
          autoSync = val === 'true' || val === 'yes' || val === '1';
        } else if (arg === '--base-path') {
          basePath = args[++i];
        } else if (arg.startsWith('--base-path=')) {
          basePath = arg.split('=')[1];
        } else if (arg === '--enabled') {
          i++; // kept for backward compatibility
        } else if (arg.startsWith('--enabled=')) {
          // kept for backward compatibility
        } else if (!url) {
          url = arg;
        } else if (!username) {
          username = arg;
        } else if (!password) {
          password = arg;
        } else if (!basePath) {
          basePath = arg;
        }
      }
      
      // Check if this is an update-only operation (no credentials provided but update flags present)
      const hasCredentials = url && username && password;
      const hasUpdateFlags = autoSync !== undefined || basePath !== undefined;
      
      if (!hasCredentials && hasUpdateFlags) {
        // Update mode: only update specific fields without re-entering credentials
        const db = getDatabase();
        const existing = await db.select().from(webdavConfig).get();
        
        if (!existing) {
          console.log(`${symbols.error} WebDAV not configured`);
          console.log('   Run "zotero webdav:config <url> <username> <password>" first');
          return;
        }
        
        console.log('Updating WebDAV configuration...\n');
        const result = await attachmentManager.updateWebDAVConfig({
          autoSync,
          basePath,
        });
        
        if (result.success) {
          console.log(`${symbols.success} Configuration updated!`);
          console.log(`   URL: ${result.config.url}`);
          console.log(`   Username: ${result.config.username}`);
          console.log(`   Base Path: ${result.config.basePath}`);
          console.log(`   Storage: ${result.config.basePath}/zotero/ (Zotero Desktop compatible)`);
          console.log(`   Auto Sync: ${result.config.autoSync ? 'Enabled' : 'Disabled'}`);
          if (result.config.autoSync) {
            console.log(`\nAuto-sync is enabled. New attachments will be automatically uploaded to WebDAV.`);
          }
        } else {
          console.log(`${symbols.error} Update failed!`);
          console.log(`   Error: ${result.error}`);
        }
        return;
      }
      
      if (!hasCredentials) {
        console.log(`${symbols.error} Please provide WebDAV configuration`);
        console.log('');
        console.log('Setup mode (initial configuration):');
        console.log('   zotero webdav:config <url> <username> <password> [basePath] [--auto-sync true]');
        console.log('   Example: zotero webdav:config https://dav.jianguoyun.com/dav user pass');
        console.log('   Example: zotero webdav:config https://dav.jianguoyun.com/dav user pass /mydata');
        console.log('');
        console.log('Note: Files are stored under <basePath>/zotero/ for Zotero compatibility.');
        console.log('      Default basePath is "/" (root), storing files at /zotero/');
        console.log('');
        console.log('Update mode (modify existing config):');
        console.log('   zotero webdav:config --auto-sync true');
        console.log('   zotero webdav:config --auto-sync false');
        return;
      }

      console.log('🔧 Configuring WebDAV...\n');
      
      // Normalize basePath: remove trailing slashes, default to '/'
      const normalizedBasePath = basePath 
        ? basePath.replace(/\/+$/, '') || '/'
        : '/';
      
      if (basePath && basePath !== normalizedBasePath) {
        console.log(`   ℹ️  Base path normalized: "${basePath}" → "${normalizedBasePath}"`);
      }
      console.log(`   ℹ️  Files will be stored under: ${normalizedBasePath}/zotero/`);

      const result = await attachmentManager.configureWebDAV({
        url: url!,
        username: username!,
        password: password!,
        basePath: normalizedBasePath,
        autoSync: autoSync || false,
      });

      if (result.success) {
        console.log(`${symbols.success} WebDAV configured successfully!`);
        console.log(`   URL: ${url}`);
        console.log(`   Username: ${username}`);
        console.log(`   Base Path: ${normalizedBasePath}`);
        console.log(`   Storage: ${normalizedBasePath}/zotero/ (Zotero Desktop compatible)`);
        console.log(`   Auto Sync: ${autoSync ? 'Enabled' : 'Disabled'}`);
        if (autoSync) {
          console.log(`\nAuto-sync is enabled. New attachments will be automatically uploaded to WebDAV.`);
        }
      } else {
        console.log(`${symbols.error} WebDAV configuration failed!`);
        console.log(`   Error: ${result.error}`);
        throw new Error(result.error || 'WebDAV configuration failed');
      }
    }
  },

  {
    name: 'attachment-download',
    aliases: ['attdl', 'down'],
    description: 'Download attachment from WebDAV',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-download <key>'); return; }
      const result = await attachmentManager.downloadFromWebDAV(args[0]);
      console.log(result.success ? `${symbols.success} Downloaded to ${result.localPath}` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-open',
    aliases: ['atto', 'open'],
    description: 'Open attachment with system default app',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-open <key>'); return; }
      const result = await attachmentManager.openAttachment(args[0]);
      console.log(result.success ? `${symbols.success} Opened` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-dedup',
    aliases: ['attdedup', 'dedup'],
    description: 'Find and remove duplicate attachments',
    execute: async (args) => {
      await initModules();
      const result = await attachmentManager.findDuplicates();
      if (!result.success) { console.log(`${symbols.error} ${result.error}`); return; }
      console.log(`Found ${result.duplicates.length} duplicates`);
      if (args.includes('--delete')) {
        for (const g of result.duplicates) {
          await attachmentManager.removeDuplicates(g);
        }
        console.log(' Removed');
      }
    }
  },

  {
    name: 'webdav:sync',
    aliases: ['wds'],
    description: 'Sync attachments to WebDAV',
    options: [
      { name: '--download', alias: '-d', description: 'Download only (skip uploads)' },
      { name: '--upload', alias: '-u', description: 'Upload only (skip downloads)' },
    ],
    examples: [
      'zotero webdav:sync',
      'zotero wds -d',
    ],
    execute: async (args) => {
      await initModules();
      const quiet = args.includes('--quiet') || args.includes('-q');

      if (!quiet) {
        console.log(' Syncing attachments to WebDAV...\n');
      }

      const result = await attachmentManager.syncAllToWebDAV({
        onProgress: !quiet ? (current, total, filename) => {
          const percent = Math.round((current / total) * 100);
          const bar = '█'.repeat(Math.floor(percent / 5)) + '░'.repeat(20 - Math.floor(percent / 5));
          process.stdout.write(`\r   [${bar}] ${percent}%`);
        } : undefined,
      });

      if (!quiet) {
        process.stdout.write('\n');
      }

      if (result.success) {
        console.log(`\n${symbols.success} WebDAV sync completed!`);
        console.log(`   Attachments synced: ${result.synced}`);
      } else {
        console.log(`\n!  WebDAV sync completed with errors:`);
        result.errors.forEach(e => console.log(`   Error: ${e}`));
      }
    }
  },

  {
    name: 'attachment-download',
    aliases: ['attdl', 'down'],
    description: 'Download attachment from WebDAV',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-download <key>'); return; }
      const result = await attachmentManager.downloadFromWebDAV(args[0]);
      console.log(result.success ? `${symbols.success} Downloaded to ${result.localPath}` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-open',
    aliases: ['atto', 'open'],
    description: 'Open attachment with system default app',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-open <key>'); return; }
      const result = await attachmentManager.openAttachment(args[0]);
      console.log(result.success ? `${symbols.success} Opened` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-dedup',
    aliases: ['attdedup', 'dedup'],
    description: 'Find and remove duplicate attachments',
    execute: async (args) => {
      await initModules();
      const result = await attachmentManager.findDuplicates();
      if (!result.success) { console.log(`${symbols.error} ${result.error}`); return; }
      console.log(`Found ${result.duplicates.length} duplicates`);
      if (args.includes('--delete')) {
        for (const g of result.duplicates) {
          await attachmentManager.removeDuplicates(g);
        }
        console.log(' Removed');
      }
    }
  },

  {
    name: 'webdav:status',
    aliases: ['wdst'],
    description: 'Show WebDAV configuration status',
    options: [
      { name: '--verbose', alias: '-v', description: 'Show detailed status' },
    ],
    examples: [
      'zotero webdav:status',
      'zotero wdst',
    ],
    execute: async () => {
      await initModules();
      const db = getDatabase();
      const config = await db.select().from(webdavConfig).get();

      if (!config) {
        console.log(`${symbols.error} WebDAV not configured`);
        console.log('   Use "zotero webdav:config" to configure');
        return;
      }

      console.log('\n WebDAV Configuration:\n');
      console.log(`   URL: ${config.url}`);
      console.log(`   Username: ${config.username}`);
      console.log(`   Base Path: ${config.basePath}`);
      console.log(`   Storage: ${config.basePath}/zotero/ (Zotero Desktop compatible)`);
      console.log(`   Enabled: ${config.enabled ? 'Yes' : 'No'}`);
      console.log(`   Auto Sync: ${config.autoSync ? 'Yes' : 'No'}`);
      console.log(`   Last Sync: ${config.lastSyncAt ? new Date(config.lastSyncAt * 1000).toISOString() : 'Never'}`);
      if (config.lastError) {
        console.log(`   Last Error: ${config.lastError}`);
      }

      // Test connection
      console.log('\nTesting connection...');
      const init = await attachmentManager.initWebDAV();
      if (init.success) {
        console.log(`   ${symbols.success} Connection successful!`);
      } else {
        console.log(`   ${symbols.error} Connection failed: ${init.error}`);
      }
      console.log();
    }
  },

  {
    name: 'attachment-download',
    aliases: ['attdl', 'down'],
    description: 'Download attachment from WebDAV',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-download <key>'); return; }
      const result = await attachmentManager.downloadFromWebDAV(args[0]);
      console.log(result.success ? `${symbols.success} Downloaded to ${result.localPath}` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-open',
    aliases: ['atto', 'open'],
    description: 'Open attachment with system default app',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-open <key>'); return; }
      const result = await attachmentManager.openAttachment(args[0]);
      console.log(result.success ? `${symbols.success} Opened` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-dedup',
    aliases: ['attdedup', 'dedup'],
    description: 'Find and remove duplicate attachments',
    execute: async (args) => {
      await initModules();
      const result = await attachmentManager.findDuplicates();
      if (!result.success) { console.log(`${symbols.error} ${result.error}`); return; }
      console.log(`Found ${result.duplicates.length} duplicates`);
      if (args.includes('--delete')) {
        for (const g of result.duplicates) {
          await attachmentManager.removeDuplicates(g);
        }
        console.log(' Removed');
      }
    }
  },

  {
    name: 'webdav:scan',
    aliases: ['wdscan'],
    description: 'Scan WebDAV for existing Zotero Desktop attachments',
    options: [
      { name: '--orphaned', alias: '-o', description: 'Show orphaned attachments only' },
    ],
    examples: [
      'zotero webdav:scan',
      'zotero wdscan --orphaned',
    ],
    execute: async (args) => {
      await initModules();
      const quiet = args.includes('--quiet') || args.includes('-q');

      if (!quiet) {
        console.log('Scanning WebDAV for Zotero Desktop attachments...\n');
      }

      const result = await attachmentManager.scanWebDAV();

      if (!result.success) {
        console.log(`${symbols.error} Failed to scan WebDAV: ${result.error}`);
        return;
      }

      if (result.items.length === 0) {
        console.log('ℹ️  No items found in WebDAV storage.');
        return;
      }

      console.log(`Found ${result.items.length} item(s) in WebDAV storage:\n`);

      let totalFiles = 0;
      let withProp = 0;
      let withoutProp = 0;

      for (const item of result.items.slice(0, 20)) { // Limit to first 20
        totalFiles += item.files.length;
        item.files.forEach(f => {
          if (f.hasProp) withProp++;
          else withoutProp++;
        });

        const propIcon = item.files[0]?.hasProp ? symbols.success : '! ';
        console.log(`   ${item.itemKey}/`);
        item.files.forEach(f => {
          console.log(`      ${propIcon} ${f.filename} (${(f.size / 1024).toFixed(1)} KB)`);
        });
      }

      if (result.items.length > 20) {
        console.log(`   ... and ${result.items.length - 20} more items`);
      }

      console.log(`\nSummary:`);
      console.log(`   Total files: ${totalFiles}`);
      console.log(`   With .prop: ${withProp}`);
      console.log(`   Without .prop: ${withoutProp}`);
      console.log(`\nTip: Files without .prop can still be used, but metadata may differ.`);
      console.log();
    }
  },

  {
    name: 'attachment-download',
    aliases: ['attdl', 'down'],
    description: 'Download attachment from WebDAV',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-download <key>'); return; }
      const result = await attachmentManager.downloadFromWebDAV(args[0]);
      console.log(result.success ? `${symbols.success} Downloaded to ${result.localPath}` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-open',
    aliases: ['atto', 'open'],
    description: 'Open attachment with system default app',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-open <key>'); return; }
      const result = await attachmentManager.openAttachment(args[0]);
      console.log(result.success ? `${symbols.success} Opened` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-dedup',
    aliases: ['attdedup', 'dedup'],
    description: 'Find and remove duplicate attachments',
    execute: async (args) => {
      await initModules();
      const result = await attachmentManager.findDuplicates();
      if (!result.success) { console.log(`${symbols.error} ${result.error}`); return; }
      console.log(`Found ${result.duplicates.length} duplicates`);
      if (args.includes('--delete')) {
        for (const g of result.duplicates) {
          await attachmentManager.removeDuplicates(g);
        }
        console.log(' Removed');
      }
    }
  },

  {
    name: 'add',
    aliases: ['a', 'new', 'touch', 'create'],
    description: 'Add a new item. Aliases: a, new, touch, create. Options: -a/--attachment <path> (multiple allowed)',
    options: [
      { name: '--type', alias: '-t', description: 'Item type (book|journalArticle|webpage|...) ', value: '<type>' },
      { name: '--attachment', alias: '-a', description: 'Add attachment file (can specify multiple)', value: '<file>' },
      { name: '--collection', alias: '-c', description: 'Add to collection', value: '<key>' },
    ],
    examples: [
      'zotero add book "Title" "Author"',
      'zotero touch journalArticle "Title" -a file.pdf',
      'zotero new webpage "Title" --collection ABC123',
    ],
    execute: async (args) => {
      await initModules();
      console.log('Adding new item to library...\n');

      // Parse arguments: zotero add <type> <title> [authors...] [-a/--attachment path...]
      const attachmentPaths: string[] = [];
      const otherArgs: string[] = [];

      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '-a' || arg === '--attachment') {
          if (i + 1 < args.length) {
            attachmentPaths.push(args[++i]);
          }
        } else {
          otherArgs.push(arg);
        }
      }

      const itemType = otherArgs[0] || 'journalArticle';
      const title = otherArgs[1];

      if (!title) {
        console.log(`${symbols.error} Usage: zotero add <type> <title> [authors...] [-a/--attachment <path>...]`);
        console.log('   Example: zotero add journalArticle "My Article" "John Doe"');
        console.log('   Example with attachments: zotero add book "My Book" "John Doe" -a /path/to/file1.pdf -a /path/to/file2.pdf');
        console.log('\n   Supported types:');
        console.log('   journalArticle, book, bookSection, conferencePaper, thesis, report, webpage, document');
        process.exit(1);
      }

      // Validate attachment paths
      const fs = await import('fs');
      const path = await import('path');
      const validAttachments: string[] = [];
      for (const attPath of attachmentPaths) {
        if (fs.existsSync(attPath)) {
          validAttachments.push(attPath);
        } else {
          console.log(`!  Attachment not found: ${attPath}`);
        }
      }

      try {
        // Get library info
        const library = await getDatabase().select().from(libraries).get();
        if (!library) {
          console.log(`${symbols.error} No library found. Run "sync" first.`);
          process.exit(1);
        }

        // Create item data (for local database and future sync)
        const now = Math.floor(Date.now() / 1000);
        const itemKey = generateKey();

        const itemData = {
          itemType,
          title,
          creators: otherArgs.slice(2).map((author, index) => {
            const parts = author.split(' ');
            const lastName = parts.pop() || '';
            const firstName = parts.join(' ') || '';
            return { firstName, lastName, creatorType: index === 0 ? 'author' : 'author' };
          })
        };

        // Insert item to local database only (marked as unsynced)
        console.log(`   Creating ${itemType}: "${title}"`);
        await getDatabase().insert(items).values({
          key: itemKey,
          libraryId: library.id,
          version: 0,
          synced: false,
          deleted: false,
          createdAt: now,
          updatedAt: now,
          itemType,
          title,
          creators: JSON.stringify(itemData.creators),
          rawJson: JSON.stringify({ data: itemData }),
        }).run();

        console.log(`${symbols.success} Item created successfully!`);
        console.log(`   Key: ${itemKey}`);

        // Create attachments if provided (only in local database)
        if (validAttachments.length > 0) {
          console.log(`\nAdding ${validAttachments.length} attachment(s) locally...`);

          for (const attPath of validAttachments) {
            const filename = path.basename(attPath);
            const stats = fs.statSync(attPath);
            const attKey = generateKey();

            // Create attachment data
            const attachmentData = {
              itemType: 'attachment',
              title: filename,
              filename: filename,
              contentType: getContentType(filename),
              parentItem: itemKey,
              linkMode: 'linked_file'
            };

            // Insert attachment to local database only (marked as unsynced)
            await getDatabase().insert(attachments).values({
              key: attKey,
              parentItemKey: itemKey,
              libraryId: library.id,
              filename: filename,
              contentType: getContentType(filename),
              fileType: path.extname(filename).toLowerCase(),
              path: attPath,
              version: 0,
              createdAt: now,
              updatedAt: now,
              deleted: false,
              size: stats.size,
              webdavSynced: false,
              rawJson: JSON.stringify({ data: attachmentData }),
            }).run();

            console.log(`   ${symbols.success} Added locally: ${filename} (${(stats.size / 1024).toFixed(1)} KB)`);
          }
        }

        console.log(`\nRun "zotero sync" to upload to remote.`);
      } catch (error) {
        console.log(`${symbols.error} Failed to add item: ${error}`);
        process.exit(1);
      }
    }
  },

  {
    name: 'attachment-download',
    aliases: ['attdl', 'down'],
    description: 'Download attachment from WebDAV',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-download <key>'); return; }
      const result = await attachmentManager.downloadFromWebDAV(args[0]);
      console.log(result.success ? `${symbols.success} Downloaded to ${result.localPath}` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-open',
    aliases: ['atto', 'open'],
    description: 'Open attachment with system default app',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-open <key>'); return; }
      const result = await attachmentManager.openAttachment(args[0]);
      console.log(result.success ? `${symbols.success} Opened` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-dedup',
    aliases: ['attdedup', 'dedup'],
    description: 'Find and remove duplicate attachments',
    execute: async (args) => {
      await initModules();
      const result = await attachmentManager.findDuplicates();
      if (!result.success) { console.log(`${symbols.error} ${result.error}`); return; }
      console.log(`Found ${result.duplicates.length} duplicates`);
      if (args.includes('--delete')) {
        for (const g of result.duplicates) {
          await attachmentManager.removeDuplicates(g);
        }
        console.log(' Removed');
      }
    }
  },

  {
    name: 'update',
    aliases: ['u', 'edit', 'set', 'mod'],
    description: 'Update an item. Aliases: u, edit, set, mod',
    options: [
      { name: '--field', alias: '-f', description: 'Field to update', value: '<field>' },
      { name: '--value', alias: '-v', description: 'New value', value: '<value>' },
    ],
    examples: [
      'zotero update ABC123 --field title --value "New Title"',
      'zotero u ABC123 -f date -v "2024-01-01"',
    ],
    execute: async (args) => {
      await initModules();
      console.log('Updating item locally...\n');

      const key = args[0];
      const field = args[1];
      const value = args.slice(2).join(' ');

      if (!key || !field || !value) {
        console.log(`${symbols.error} Usage: zotero update <key> <field> <value>`);
        console.log('   Example: zotero update ABCD123 title "New Title"');
        console.log('\n   Available fields:');
        console.log('   title, date, abstract, url, doi');
        process.exit(1);
      }

      try {
        const db = getDatabase();
        const library = await db.select().from(libraries).get();

        if (!library) {
          console.log(`${symbols.error} No library found. Run "sync" first.`);
          process.exit(1);
        }

        // Get current item
        const item = await db.select()
          .from(items)
          .where(and(eq(items.key, key), eq(items.libraryId, library.id)))
          .get();

        if (!item) {
          console.log(`${symbols.error} Item ${key} not found.`);
          process.exit(1);
        }

        // Parse the raw JSON and update the field
        const rawData = JSON.parse(item.rawJson || '{}');
        const data = rawData.data || rawData;

        // Map CLI field names to Zotero API field names
        const fieldMap: Record<string, string> = {
          'title': 'title',
          'date': 'date',
          'abstract': 'abstractNote',
          'url': 'url',
          'doi': 'DOI'
        };

        const apiField = fieldMap[field.toLowerCase()] || field;
        const oldValue = data[apiField];
        data[apiField] = value;

        // Update local database only (do not call API)
        console.log(`   Updating ${key}: ${field} = "${value}"`);

        // Re-serialize the updated data
        const updatedRawJson = JSON.stringify({ ...rawData, data });

        // Update local item: mark as unsynced and update rawJson
        await db.update(items)
          .set({
            synced: false,
            updatedAt: Math.floor(Date.now() / 1000),  // 使用秒级时间戳
            rawJson: updatedRawJson,
            // Also update the title field if that's what changed
            ...(apiField === 'title' ? { title: value } : {})
          })
          .where(and(eq(items.key, key), eq(items.libraryId, library.id)))
          .run();

        console.log(`${symbols.success} Item updated locally!`);
        console.log(`   Changed: ${field} "${oldValue}" → "${value}"`);
        console.log(`\nRun "zotero sync" to upload changes to remote.`);
      } catch (error) {
        console.log(`${symbols.error} Failed to update item: ${error}`);
        process.exit(1);
      }
    }
  },

  {
    name: 'attachment-download',
    aliases: ['attdl', 'down'],
    description: 'Download attachment from WebDAV',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-download <key>'); return; }
      const result = await attachmentManager.downloadFromWebDAV(args[0]);
      console.log(result.success ? `${symbols.success} Downloaded to ${result.localPath}` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-open',
    aliases: ['atto', 'open'],
    description: 'Open attachment with system default app',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-open <key>'); return; }
      const result = await attachmentManager.openAttachment(args[0]);
      console.log(result.success ? `${symbols.success} Opened` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-dedup',
    aliases: ['attdedup', 'dedup'],
    description: 'Find and remove duplicate attachments',
    execute: async (args) => {
      await initModules();
      const result = await attachmentManager.findDuplicates();
      if (!result.success) { console.log(`${symbols.error} ${result.error}`); return; }
      console.log(`Found ${result.duplicates.length} duplicates`);
      if (args.includes('--delete')) {
        for (const g of result.duplicates) {
          await attachmentManager.removeDuplicates(g);
        }
        console.log(' Removed');
      }
    }
  },

  {
    name: 'delete',
    aliases: ['d', 'del', 'rm', 'trash'],
    description: 'Delete (trash) an item. Aliases: rm, del, d. Options: -p/--permanent, -f/--force, -n/--dry-run',
    options: [
      { name: '--force', alias: '-f', description: 'Permanently delete - shell mode only' },
      { name: '--permanent', alias: '-p', description: 'Same as --force - shell mode only' },
      { name: '--yes', alias: '-y', description: 'Skip confirmation prompt' },
      { name: '--dry-run', alias: '-n', description: 'Show what would be deleted without executing' },
    ],
    examples: [
      'zotero delete ABC123',
      'zotero rm ABC123 -f',
      'zotero del ABC123 ABC124',
      'zotero delete ABC123 --dry-run',
    ],
    execute: async (args) => {
      await initModules();
      console.log(' Deleting item locally...\n');

      const key = args[0];
      let isPermanent = args.includes('--permanent') || args.includes('-p')
        || args.includes('--force') || args.includes('-f');
      const skipConfirm = args.includes('--yes') || args.includes('-y');
      const dryRun = args.includes('--dry-run') || args.includes('-n');

      // Restrict permanent delete to shell mode only
      if (isPermanent && !_shellMode) {
        console.log(`${symbols.warning} ${t('commands.delete.shellOnly')}`);
        isPermanent = false;
      }

      if (!key) {
        console.log(`${symbols.error} Usage: zotero delete <key> [--permanent]`);
        console.log('   Example: zotero delete ABCD123');
        console.log('   Example: zotero delete ABCD123 --permanent (permanent delete)');
        process.exit(1);
      }

      try {
        const db = getDatabase();
        const library = await db.select().from(libraries).get();

        if (!library) {
          console.log(`${symbols.error} No library found. Run "sync" first.`);
          process.exit(1);
        }

        // Get current item
        const item = await db.select()
          .from(items)
          .where(and(eq(items.key, key), eq(items.libraryId, library.id)))
          .get();

        if (!item) {
          console.log(`${symbols.error} Item ${key} not found.`);
          process.exit(1);
        }

        // Confirmation prompt
        if (!skipConfirm) {
          if (!isInteractive()) {
            console.log(`${symbols.error} ${t('commands.delete.nonInteractive')}`);
            process.exit(1);
          }

          const title = item.title || '(no title)';
          const promptMsg = isPermanent
            ? t('commands.delete.confirmPermanent', title, key)
            : t('commands.delete.confirmTrash', title, key);

          const rl = createPrompt();
          const answer = await new Promise<string>((resolve) => {
            rl.question(promptMsg, (ans) => resolve(ans));
          });
          rl.close();

          if (!['y', 'yes'].includes(answer.trim().toLowerCase())) {
            console.log(`${symbols.warning} ${t('commands.delete.cancelled')}`);
            return;
          }
        }

        if (dryRun) {

          // Count child attachments
          let childCount = 0;
          try {
            const result = await db.select({ count: count() })
              .from(items)
              .where(and(
                eq(items.libraryId, library.id),
                like(items.rawJson, `%"parentItem":"${key}"%`)
              ))
              .get();
            childCount = result?.count ?? 0;
          } catch (e) {
            // Ignore errors counting children
          }

          console.log(t('commands.delete.dryRunHeader'));
          console.log(`   ${t('fields.title')}:  ${item.title || t('common.unknown')}`);
          console.log(`   Key:       ${key}`);
          console.log(`   ${t('fields.type')}:  ${item.itemType}`);
          console.log(`   ${t('commands.delete.dryRunMode')}:  ${isPermanent ? t('commands.delete.dryRunPermanent') : t('commands.delete.dryRunTrash')}`);
          if (childCount > 0) {
            console.log(`   ${t('commands.delete.dryRunChildren', childCount)}`);
          }
          console.log(`\n${t('commands.delete.dryRunNoChanges')}`);
          return;
        }

        if (isPermanent) {
          // Check trash retention period
          if (item.deletedAt) {
            const { configManager } = await import('@zotero-headless/core');
            const retentionDays = configManager.get('delete')?.trashRetentionDays ?? 7;
            const retentionSeconds = retentionDays * 24 * 60 * 60;
            const now = Math.floor(Date.now() / 1000);
            const elapsed = now - item.deletedAt;
            if (elapsed < retentionSeconds) {
              const availableDate = new Date((item.deletedAt + retentionSeconds) * 1000).toLocaleDateString();
              console.log(`${symbols.error} Cannot permanently delete: item has been in trash for less than ${retentionDays} days.`);
              console.log(`   Permanent deletion available after: ${availableDate}`);
              console.log(`   Use "zotero restore ${key}" to recover from trash.`);
              process.exit(1);
            }
          }

          // Permanent delete: remove from local DB immediately
          // Sync will detect it's gone and delete from remote
          console.log(`   Marking ${key} for permanent deletion...`);

          await logDeletion({
            itemKey: key,
            libraryId: library.id,
            title: item.title,
            itemType: item.itemType,
            operationType: 'hard',
            caller: 'cli',
            rawJsonSnapshot: item.rawJson,
          });

          await db.delete(items)
            .where(and(eq(items.key, key), eq(items.libraryId, library.id)))
            .run();

          console.log(`${symbols.success} Item marked for permanent deletion!`);
        } else {
          // Soft delete (move to trash): mark as deleted locally
          console.log(`   Moving ${key} to trash...`);

          // Get current data and set deleted flag
          const rawData = JSON.parse(item.rawJson || '{}');
          const data = rawData.data || rawData;
          data.deleted = true;

          await logDeletion({
            itemKey: key,
            libraryId: library.id,
            title: item.title,
            itemType: item.itemType,
            operationType: 'soft',
            caller: 'cli',
            rawJsonSnapshot: item.rawJson,
          });

          // Update local item: mark as deleted and unsynced
          await db.update(items)
            .set({
              deleted: true,
              synced: false,
              updatedAt: Math.floor(Date.now() / 1000),  // 使用秒级时间戳
              deletedAt: Math.floor(Date.now() / 1000),  // Track when trashed
              rawJson: JSON.stringify({ ...rawData, data })
            })
            .where(and(eq(items.key, key), eq(items.libraryId, library.id)))
            .run();

          console.log(`${symbols.success} Item moved to trash locally!`);
        }

        console.log(`\nRun "zotero sync" to sync deletion to remote.`);
      } catch (error) {
        console.log(`${symbols.error} Failed to delete item: ${error}`);
        process.exit(1);
      }
    }
  },

  {
    name: 'attachment-download',
    aliases: ['attdl', 'down'],
    description: 'Download attachment from WebDAV',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-download <key>'); return; }
      const result = await attachmentManager.downloadFromWebDAV(args[0]);
      console.log(result.success ? `${symbols.success} Downloaded to ${result.localPath}` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-open',
    aliases: ['atto', 'open'],
    description: 'Open attachment with system default app',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-open <key>'); return; }
      const result = await attachmentManager.openAttachment(args[0]);
      console.log(result.success ? `${symbols.success} Opened` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-dedup',
    aliases: ['attdedup', 'dedup'],
    description: 'Find and remove duplicate attachments',
    execute: async (args) => {
      await initModules();
      const result = await attachmentManager.findDuplicates();
      if (!result.success) { console.log(`${symbols.error} ${result.error}`); return; }
      console.log(`Found ${result.duplicates.length} duplicates`);
      if (args.includes('--delete')) {
        for (const g of result.duplicates) {
          await attachmentManager.removeDuplicates(g);
        }
        console.log(' Removed');
      }
    }
  },

  {
    name: 'export',
    aliases: ['e', 'out', 'save'],
    description: 'Export items to various formats. Aliases: e, out, save',
    options: [
      { name: '--format', alias: '-f', description: 'Export format (bibtex|ris|csv|json)', value: '<format>' },
      { name: '--output', alias: '-o', description: 'Output file path', value: '<path>' },
    ],
    examples: [
      'zotero export ABC123 -f bibtex',
      'zotero e ABC123 ABC124 -o output.bib',
    ],
    execute: async (args) => {
      await initModules();
      console.log('Exporting items...\n');

      try {
        // Parse arguments
        const format = args[0]?.toLowerCase() || 'bibtex';
        const outputFile = args[1];
        const limit = args[2] ? parseInt(args[2]) : 100;

        const validFormats = ['bibtex', 'ris', 'csv', 'json'];
        if (!validFormats.includes(format)) {
          console.log(`${symbols.error} Invalid format: ${format}`);
          console.log(`   Valid formats: ${validFormats.join(', ')}`);
          process.exit(1);
        }

        const { Exporter } = await import('./export.js');
        const exporter = new Exporter();

        const content = await exporter.exportItems({
          format: format as any,
          limit
        });

        if (outputFile) {
          await exporter.exportToFile(content, outputFile);
          console.log(`${symbols.success} Exported ${limit} items to ${outputFile} (${format} format)`);
        } else {
          console.log(content);
          console.log(`\nTip: Add output file path to save to file`);
          console.log(`   Example: zotero export bibtex references.bib`);
        }
      } catch (error) {
        console.error(`${symbols.error} Export failed:`, error);
        process.exit(1);
      }
    }
  },

  {
    name: 'attachment-download',
    aliases: ['attdl', 'down'],
    description: 'Download attachment from WebDAV',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-download <key>'); return; }
      const result = await attachmentManager.downloadFromWebDAV(args[0]);
      console.log(result.success ? `${symbols.success} Downloaded to ${result.localPath}` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-open',
    aliases: ['atto', 'open'],
    description: 'Open attachment with system default app',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-open <key>'); return; }
      const result = await attachmentManager.openAttachment(args[0]);
      console.log(result.success ? `${symbols.success} Opened` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-dedup',
    aliases: ['attdedup', 'dedup'],
    description: 'Find and remove duplicate attachments',
    execute: async (args) => {
      await initModules();
      const result = await attachmentManager.findDuplicates();
      if (!result.success) { console.log(`${symbols.error} ${result.error}`); return; }
      console.log(`Found ${result.duplicates.length} duplicates`);
      if (args.includes('--delete')) {
        for (const g of result.duplicates) {
          await attachmentManager.removeDuplicates(g);
        }
        console.log(' Removed');
      }
    }
  },

  {
    name: 'add-by-id',
    aliases: ['addby'],
    description: 'Add item(s) by identifier (DOI, ISBN, PMID, arXiv). Options: -a/--attachment <path> (multiple allowed)',
    options: [
      { name: '--attachment', alias: '-a', description: 'Add attachment file', value: '<file>' },
      { name: '--collection', alias: '-c', description: 'Add to collection', value: '<key>' },
    ],
    examples: [
      'zotero add-by-id "10.1000/xyz"',
      'zotero addby "978-0-123456-78-9" -a file.pdf',
    ],
    execute: async (args) => {
      // Parse arguments for attachments
      const attachmentPaths: string[] = [];
      const otherArgs: string[] = [];

      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '-a' || arg === '--attachment') {
          if (i + 1 < args.length) {
            attachmentPaths.push(args[++i]);
          }
        } else {
          otherArgs.push(arg);
        }
      }

      if (otherArgs.length === 0) {
        console.log(`
${symbols.error} 请提供至少一个标识符

用法: zotero add-by-id <identifier> [identifier2 ...] [-a/--attachment <path>...]

支持的标识符类型:
  • DOI    - 如 10.1007/s11263-019-01228-7
  • ISBN   - 如 978-3-642-15515-4
  • PMID   - 如 1234567
  • arXiv  - 如 2001.12345
  • 微信文章 URL - 如 https://mp.weixin.qq.com/s/...

选项:
  -a, --attachment <path>  添加附件文件（可多次使用）

WebDAV 同步:
  微信文章会自动生成 Snapshot 附件，可通过以下方式同步到 WebDAV:

  1. 手动同步: 运行 zotero webdav:sync
  2. 自动同步: 配置 autoSync (见下文)

  配置自动同步:
    zotero webdav:config <url> <username> <password> --auto-sync

  查看 WebDAV 状态:
    zotero webdav:status

示例:
  zotero add-by-id "10.1007/s11263-019-01228-7"
  zotero add-by-id "978-3-642-15515-4"
  zotero add-by-id "1234567"
  zotero add-by-id "https://mp.weixin.qq.com/s/xxxxx"
  zotero add-by-id "10.1007/xyz" -a /path/to/supplemental.pdf
  zotero add-by-id "10.1007/xyz" -a file1.pdf -a file2.pdf
        `);
        return;
      }

      await initModules();
      const input = otherArgs.join(' ');

      // Validate attachment paths
      const fs = await import('fs');
      const path = await import('path');
      const validAttachments: string[] = [];
      for (const attPath of attachmentPaths) {
        if (fs.existsSync(attPath)) {
          validAttachments.push(attPath);
        } else {
          console.log(`!  Attachment not found: ${attPath}`);
        }
      }

      try {
        console.log('正在解析标识符...\n');

        // 导入 identifier 模块
        const { IdentifierParser, MetadataFetcher } = await import('./identifier/index.js');

        // 1. 解析标识符
        const identifiers = IdentifierParser.parse(input);
        console.log(`找到 ${identifiers.length} 个标识符`);

        // 2. 显示识别结果
        identifiers.forEach((id, index) => {
          console.log(`   ${index + 1}. ${id.type.toUpperCase()}: ${id.value}`);
        });

        // 3. 配置获取器
        const fetcher = new MetadataFetcher({
          maxConcurrent: 3,
          timeout: 30000,
          retries: 2,
          cacheTTL: 3600000,
          email: process.env.CROSSREF_EMAIL,
        });

        // 4. 获取元数据
        console.log('\n正在获取元数据...');
        const results = await fetcher.fetchBatch(identifiers);

        // 5. 显示结果摘要
        const successCount = results.filter(r => !r.error).length;
        const failCount = results.filter(r => r.error).length;

        console.log(`\n结果摘要:`);
        console.log(`   ${symbols.success} 成功: ${successCount}`);
        console.log(`   ${symbols.error} 失败: ${failCount}`);

        // 6. 写入数据库
        if (successCount > 0) {
          console.log('\n写入本地数据库...');
          const db = getDatabase();
          const library = await db.select().from(libraries).get();

          if (!library) {
            console.log(`${symbols.error} 未找到文献库。请先运行 "zotero sync"`);
            return;
          }

          for (const result of results) {
            if (result.error || !result.item) continue;

            const itemKey = generateKey();
            const item = {
              key: itemKey,
              libraryId: library.id,
              version: 0,
              synced: false,
              deleted: false,
              createdAt: Math.floor(Date.now() / 1000),
              updatedAt: Math.floor(Date.now() / 1000),
              ...result.item,
              rawJson: JSON.stringify({ data: result.item }),
            };

            await db.insert(items).values(item).run();
            console.log(`   已添加: ${item.title?.substring(0, 50) || '(无标题)'}...`);

            // 处理微信文章的 snapshot 附件（iOS 兼容性）
            if (result.extra?.isWeChatArticle && result.extra?.processedHtml) {
              console.log(`   创建微信文章 snapshot...`);
              
              const crypto = await import('crypto');
              const contentHash = result.extra.contentHash || 
                crypto.createHash('md5').update(result.extra.processedHtml).digest('hex').substring(0, 16);
              const uniqueFilename = `${contentHash}.html`;
              const attKey = generateKey();
              const now = Math.floor(Date.now() / 1000);
              
              // 获取保存路径
              const { appConfig } = await import('@zotero-headless/core');
              const saveDir = path.join(appConfig.dataDir, 'downloads');
              if (!fs.existsSync(saveDir)) {
                fs.mkdirSync(saveDir, { recursive: true });
              }
              
              // 使用 uniqueFilename 作为实际文件名（与显示一致）
              const htmlPath = path.join(saveDir, uniqueFilename);
              fs.writeFileSync(htmlPath, result.extra.processedHtml);
              
              // 创建 attachment 记录
              // Zotero requires ISO 8601 format WITHOUT milliseconds
              const accessDate = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
              const sourceUrl = result.item.url || '';
              
              await db.insert(attachments).values({
                key: attKey,
                parentItemKey: itemKey,
                libraryId: library.id,
                filename: uniqueFilename,  // iOS 兼容：使用内容哈希，不等于 attachment key
                contentType: 'text/html',
                fileType: '.html',
                path: htmlPath,
                version: 0,
                createdAt: now,
                updatedAt: now,
                deleted: false,
                size: result.extra.processedHtml.length,
                webdavSynced: false,
                rawJson: JSON.stringify({
                  data: {
                    itemType: 'attachment',
                    title: 'Snapshot',
                    filename: uniqueFilename,
                    contentType: 'text/html',
                    charset: 'utf-8',
                    parentItem: itemKey,
                    linkMode: 'imported_url',
                    url: sourceUrl,
                    accessDate: accessDate
                  }
                }),
              }).run();
              
              console.log(`      ${symbols.success} Snapshot: ${uniqueFilename} (${(result.extra.processedHtml.length / 1024).toFixed(1)} KB)`);
              
              // 检查 autoSync 配置
              const wdc = await db.select().from(webdavConfig).get();
              if (wdc?.autoSync) {
                console.log(`      自动同步到 WebDAV (autoSync enabled)...`);
                console.log(`      父条目将在下次 sync 时上传到 Zotero，然后附件自动关联`);
                // Note: WebDAV sync will be handled by sync process or manual webdav:sync
                // The attachment item will be created during regular sync (parent first, then attachment)
              } else {
                console.log(`      运行 "zotero sync" 上传条目，然后 "zotero webdav:sync" 上传附件`);
                if (!wdc) {
                  console.log(`         或先配置: zotero webdav:config <url> <user> <pass>`);
                }
              }
            }

            // Add attachments if provided
            if (validAttachments.length > 0) {
              console.log(`   添加 ${validAttachments.length} 个附件...`);
              
              const addedAttKeys: string[] = [];

              for (const attPath of validAttachments) {
                const filename = path.basename(attPath);
                const stats = fs.statSync(attPath);
                const attKey = generateKey();
                addedAttKeys.push(attKey);

                // Create attachment record
                const now = Math.floor(Date.now() / 1000);
                await db.insert(attachments).values({
                  key: attKey,
                  parentItemKey: itemKey,
                  libraryId: library.id,
                  filename: filename,
                  contentType: getContentType(filename),
                  fileType: path.extname(filename).toLowerCase(),
                  path: attPath,
                  version: 0,
                  createdAt: now,
                  updatedAt: now,
                  deleted: false,
                  size: stats.size,
                  webdavSynced: false,
                  rawJson: JSON.stringify({
                    data: {
                      itemType: 'attachment',
                      title: filename,
                      filename: filename,
                      contentType: getContentType(filename),
                      parentItem: itemKey,
                      linkMode: 'linked_file'
                    }
                  }),
                }).run();

                console.log(`      ${symbols.success} ${filename} (${(stats.size / 1024).toFixed(1)} KB)`);
              }
              
              // Auto-sync attachments if enabled
              const wdc = await db.select().from(webdavConfig).get();
              if (wdc?.autoSync && addedAttKeys.length > 0) {
                console.log(`      自动同步 ${addedAttKeys.length} 个附件到 WebDAV...`);
                console.log(`      父条目将在下次 sync 时上传到 Zotero`);
                let syncCount = 0;
                let failCount = 0;
                for (const attKey of addedAttKeys) {
                  try {
                    const syncResult = await attachmentManager.syncToWebDAV(attKey);
                    if (syncResult.success) {
                      syncCount++;
                    } else {
                      failCount++;
                      console.log(`         !  ${attKey}: ${syncResult.error}`);
                    }
                  } catch (e: any) {
                    failCount++;
                    console.log(`         !  ${attKey}: ${e.message}`);
                  }
                }
                if (syncCount > 0) {
                  console.log(`      ${symbols.success} ${syncCount} 个附件已上传`);
                }
                if (failCount > 0) {
                  console.log(`      !  ${failCount} 个附件上传失败，运行 "zotero webdav:sync" 重试`);
                }
              } else if (!wdc?.autoSync && addedAttKeys.length > 0) {
                console.log(`      运行 "zotero webdav:sync" 上传这些附件`);
              }
            }
          }

          console.log(`\n成功添加 ${successCount} 个文献到本地数据库！`);
          if (validAttachments.length > 0) {
            console.log(`   共添加 ${validAttachments.length} 个附件`);
          }
          console.log('运行 "zotero sync" 同步到 Zotero 服务器');
        }

        // 7. 显示失败详情
        if (failCount > 0) {
          console.log('\n! 失败的标识符:');
          results.filter(r => r.error).forEach((result, index) => {
            console.log(`   ${index + 1}. ${result.identifier.value}`);
            console.log(`     原因: ${result.error}`);
          });
        }

      } catch (error) {
        console.log(`\n${symbols.error} 添加失败: ${error}`);
        console.log('\n请检查:');
        console.log('   1. 标识符格式是否正确');
        console.log('   2. 网络连接是否正常');
        console.log('   3. API 密钥配置是否正确');
      }
    }
  },

  {
    name: 'attachment-download',
    aliases: ['attdl', 'down'],
    description: 'Download attachment from WebDAV',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-download <key>'); return; }
      const result = await attachmentManager.downloadFromWebDAV(args[0]);
      console.log(result.success ? `${symbols.success} Downloaded to ${result.localPath}` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-open',
    aliases: ['atto', 'open'],
    description: 'Open attachment with system default app',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-open <key>'); return; }
      const result = await attachmentManager.openAttachment(args[0]);
      console.log(result.success ? `${symbols.success} Opened` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-dedup',
    aliases: ['attdedup', 'dedup'],
    description: 'Find and remove duplicate attachments',
    execute: async (args) => {
      await initModules();
      const result = await attachmentManager.findDuplicates();
      if (!result.success) { console.log(`${symbols.error} ${result.error}`); return; }
      console.log(`Found ${result.duplicates.length} duplicates`);
      if (args.includes('--delete')) {
        for (const g of result.duplicates) {
          await attachmentManager.removeDuplicates(g);
        }
        console.log(' Removed');
      }
    }
  },

  {
    name: 'note',
    aliases: ['n', 'notes'],
    description: 'Note management. Subcommands: add, edit, show, list. Supports Markdown input/output',
    options: [
      { name: '--item', alias: '-i', description: 'Parent item key', value: '<key>' },
      { name: '--edit', alias: '-e', description: 'Edit note content' },
    ],
    examples: [
      'zotero note list ABC123',
      'zotero note add ABC123 "Content"',
      'zotero note edit NOTE456 -e',
    ],
    execute: async (args) => {
      await initModules();

      const subcommand = args[0];
      const subArgs = args.slice(1);

      if (!subcommand || subcommand === '--help' || subcommand === '-h') {
        console.log(`
Note Management

Usage: zotero note <subcommand> [options]

Subcommands:
  add <parent-key> [content]     Add a note to an item (Markdown supported)
  edit <note-key> [content]      Edit an existing note (opens $EDITOR if no content)
  show <note-key>                Show note content (as Markdown)
  list <parent-key>              List all notes for an item
  export <note-key> [path]       Export note(s) to Markdown file(s)
                                 Use --all to export all notes

Examples:
  zotero note add ABCD1234 "This is a **note**"
  zotero note edit NOTE5678              # Opens $EDITOR (vim/nano)
  zotero note edit NOTE5678 "New text"   # Direct update
  zotero note show NOTE5678
  zotero note list ABCD1234
  zotero note export NOTE5678 ./notes/   # Export to file
  zotero note export --all ./exported/   # Export all notes

Notes:
  - Content supports Markdown formatting
  - All operations are local; use 'zotero sync' to upload
  - Set $EDITOR env var to customize editor (default: nano)
        `);
        return;
      }

      // Import note utilities
      const { markdownToHtml, htmlToMarkdown, htmlToPlainText, ensureHtml } = await import('./note-utils.js');

      const db = getDatabase();
      const library = await db.select().from(libraries).get();

      if (!library) {
        console.log(`${symbols.error} No library found. Run "sync" first.`);
        return;
      }

      switch (subcommand) {
        case 'add': {
          const parentKey = subArgs[0];
          const content = subArgs.slice(1).join(' ');

          if (!parentKey) {
            console.log(`${symbols.error} Usage: zotero note add <parent-key> [content]`);
            console.log('   Example: zotero note add ABCD1234 "This is a **note**"');
            return;
          }

          // Check if parent item exists
          const parentItem = await db.select()
            .from(items)
            .where(and(eq(items.key, parentKey), eq(items.libraryId, library.id)))
            .get();

          if (!parentItem) {
            console.log(`${symbols.error} Parent item ${parentKey} not found.`);
            return;
          }

          const noteKey = generateKey();
          const now = Math.floor(Date.now() / 1000);

          // Convert Markdown to HTML for storage
          const htmlContent = ensureHtml(content || '<p></p>');

          // Create note data
          const noteData = {
            itemType: 'note',
            note: htmlContent,
            parentItem: parentKey,
            tags: [],
          };

          // Insert to local database
          await db.insert(items).values({
            key: noteKey,
            libraryId: library.id,
            version: 0,
            synced: false,
            deleted: false,
            createdAt: now,
            updatedAt: now,
            itemType: 'note',
            title: htmlToPlainText(htmlContent, 50) || '(empty note)',
            rawJson: JSON.stringify({ data: noteData }),
          }).run();

          console.log(`${symbols.success} Note added successfully!`);
          console.log(`   Key: ${noteKey}`);
          console.log(`   Parent: ${parentKey}`);
          if (content) {
            console.log(`   Preview: ${htmlToPlainText(htmlContent, 80)}`);
          }
          console.log(`\nRun "zotero sync" to upload to remote.`);
          break;
        }

        case 'edit': {
          const noteKey = subArgs[0];
          let newContent = subArgs.slice(1).join(' ');

          if (!noteKey) {
            console.log(`${symbols.error} Usage: zotero note edit <note-key> [content]`);
            console.log('   Example: zotero note edit NOTE5678 "Updated **content**"');
            return;
          }

          // Get existing note
          const note = await db.select()
            .from(items)
            .where(and(eq(items.key, noteKey), eq(items.libraryId, library.id)))
            .get();

          if (!note) {
            console.log(`${symbols.error} Note ${noteKey} not found.`);
            return;
          }

          if (note.itemType !== 'note') {
            console.log(`${symbols.error} Item ${noteKey} is not a note.`);
            return;
          }

          // Parse existing data
          const rawData = JSON.parse(note.rawJson || '{}');
          const data = rawData.data || rawData;

          // If no new content provided, open external editor
          if (!newContent) {
            const currentHtml = data.note || '';
            const currentMarkdown = htmlToMarkdown(currentHtml);

            // Import required modules for external editor
            const { fileSync } = await import('tmp');
            const { writeFileSync, readFileSync } = await import('fs');
            const { spawn } = await import('child_process');

            // Create temporary file with current content
            const tmpFile = fileSync({
              postfix: '.md',
              prefix: 'zotero-note-'
            });

            // Write current markdown to temp file
            writeFileSync(tmpFile.name, currentMarkdown || '', 'utf-8');

            // Get editor from config, environment, or use default
            const { configManager } = await import('@zotero-headless/core');
            const editor = configManager.get('editor') || process.env.EDITOR || process.env.VISUAL || 'nano';

            console.log(`Opening external editor: ${editor}`);
            console.log(`   File: ${tmpFile.name}`);
            console.log(`   Edit and save the file, then close the editor to apply changes.`);
            console.log('');

            // Wait for editor to close
            await new Promise<void>((resolve, reject) => {
              const child = spawn(editor, [tmpFile.name], {
                stdio: 'inherit',
                detached: false
              });

              child.on('close', (code) => {
                if (code === 0 || code === null) {
                  resolve();
                } else {
                  reject(new Error(`Editor exited with code ${code}`));
                }
              });

              child.on('error', (err) => {
                reject(err);
              });
            });

            // Read edited content
            const editedContent = readFileSync(tmpFile.name, 'utf-8');

            // Clean up temp file
            tmpFile.removeCallback();

            // Check if content changed
            if (editedContent === currentMarkdown) {
              console.log('\nNo changes detected. Note not updated.');
              return;
            }

            // Use edited content
            newContent = editedContent;
          }

          // Convert new content to HTML
          const newHtmlContent = ensureHtml(newContent);
          data.note = newHtmlContent;

          // Update local database
          const now = Math.floor(Date.now() / 1000);
          await db.update(items)
            .set({
              synced: false,
              updatedAt: now,
              title: htmlToPlainText(newHtmlContent, 50) || '(empty note)',
              rawJson: JSON.stringify({ ...rawData, data }),
            })
            .where(and(eq(items.key, noteKey), eq(items.libraryId, library.id)))
            .run();

          console.log(`${symbols.success} Note updated successfully!`);
          console.log(`   Key: ${noteKey}`);
          console.log(`   Preview: ${htmlToPlainText(newHtmlContent, 80)}`);
          console.log(`\nRun "zotero sync" to upload changes.`);
          break;
        }

        case 'show': {
          const noteKey = subArgs[0];

          if (!noteKey) {
            console.log(`${symbols.error} Usage: zotero note show <note-key>`);
            console.log('   Example: zotero note show NOTE5678');
            return;
          }

          // Get note
          const note = await db.select()
            .from(items)
            .where(and(eq(items.key, noteKey), eq(items.libraryId, library.id)))
            .get();

          if (!note) {
            console.log(`${symbols.error} Note ${noteKey} not found.`);
            return;
          }

          if (note.itemType !== 'note') {
            console.log(`${symbols.error} Item ${noteKey} is not a note.`);
            return;
          }

          // Parse data
          const rawData = JSON.parse(note.rawJson || '{}');
          const data = rawData.data || rawData;
          const htmlContent = data.note || '';

          // Convert to Markdown for display
          const markdownContent = htmlToMarkdown(htmlContent);

          console.log(`\nNote: ${noteKey}`);
          console.log(`   Parent: ${data.parentItem || '(none)'}`);
          console.log(`   Updated: ${formatDate(note.updatedAt)}`);
          console.log(`   Synced: ${note.synced ? symbols.success : ''}`);
          console.log('─'.repeat(60));
          console.log(markdownContent || '(empty note)');
          console.log('─'.repeat(60));
          break;
        }

        case 'list': {
          const parentKey = subArgs[0];

          if (!parentKey) {
            console.log(`${symbols.error} Usage: zotero note list <parent-key>`);
            console.log('   Example: zotero note list ABCD1234');
            return;
          }

          // Get all notes for this parent
          const notes = await db.select()
            .from(items)
            .where(and(
              eq(items.libraryId, library.id),
              eq(items.itemType, 'note'),
              eq(items.deleted, false)
            ))
            .all();

          // Filter notes that belong to this parent
          const parentNotes = notes.filter(note => {
            try {
              const rawData = JSON.parse(note.rawJson || '{}');
              const data = rawData.data || rawData;
              return data.parentItem === parentKey;
            } catch {
              return false;
            }
          });

          if (parentNotes.length === 0) {
            console.log(`\nNo notes found for item ${parentKey}.`);
            return;
          }

          console.log(`\nNotes for ${parentKey} (${parentNotes.length}):\n`);

          for (const note of parentNotes) {
            const rawData = JSON.parse(note.rawJson || '{}');
            const data = rawData.data || rawData;
            const htmlContent = data.note || '';
            const preview = htmlToPlainText(htmlContent, 60) || '(empty note)';
            const syncStatus = note.synced ? symbols.success : '';

            console.log(`  ${syncStatus} [${note.key}] ${preview}`);
          }
          console.log();
          break;
        }

        case 'export': {
          const target = subArgs[0];
          const outputPath = subArgs[1] || '.';

          if (!target) {
            console.log(`${symbols.error} Usage: zotero note export <note-key> [output-path]`);
            console.log('   Example: zotero note export NOTE1234 ./my-notes/');
            console.log('   Example: zotero note export --all ./exported-notes/');
            return;
          }

          // Check if exporting all notes
          if (target === '--all') {
            const allNotes = await db.select()
              .from(items)
              .where(and(
                eq(items.libraryId, library.id),
                eq(items.itemType, 'note')
              ))
              .all();

            if (allNotes.length === 0) {
              console.log('No notes found to export.');
              return;
            }

            // Create output directory if not exists
            const fs = await import('fs');
            const path = await import('path');
            const outputDir = outputPath || './zotero-notes-export';
            
            if (!fs.existsSync(outputDir)) {
              fs.mkdirSync(outputDir, { recursive: true });
            }

            console.log(`Exporting ${allNotes.length} notes to ${outputDir}...\n`);

            let exported = 0;
            for (const note of allNotes) {
              try {
                const rawData = JSON.parse(note.rawJson || '{}');
                const data = rawData.data || rawData;
                const htmlContent = data.note || '';
                
                // Convert to Markdown
                const { htmlToMarkdown } = await import('./note-utils.js');
                const markdown = htmlToMarkdown(htmlContent);
                
                // Create filename from key and title
                const title = note.title?.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30) || 'untitled';
                const filename = `${note.key}_${title}.md`;
                const filepath = path.join(outputDir, filename);
                
                // Write file
                fs.writeFileSync(filepath, markdown, 'utf-8');
                exported++;
                console.log(`  ${symbols.success} ${filename}`);
              } catch (e) {
                console.warn(`  !  Failed to export note ${note.key}: ${e}`);
              }
            }

            console.log(`\nExported ${exported}/${allNotes.length} notes to ${outputDir}/`);
            return;
          }

          // Export single note
          const note = await db.select()
            .from(items)
            .where(and(eq(items.key, target), eq(items.libraryId, library.id)))
            .get();

          if (!note) {
            console.log(`${symbols.error} Note ${target} not found.`);
            return;
          }

          if (note.itemType !== 'note') {
            console.log(`${symbols.error} Item ${target} is not a note.`);
            return;
          }

          try {
            const rawData = JSON.parse(note.rawJson || '{}');
            const data = rawData.data || rawData;
            const htmlContent = data.note || '';
            
            // Convert to Markdown
            const { htmlToMarkdown } = await import('./note-utils.js');
            const markdown = htmlToMarkdown(htmlContent);
            
            // Write to file or stdout
            const fs = await import('fs');
            const path = await import('path');
            
            if (outputPath && outputPath !== '-') {
              // Determine if outputPath is a file or directory
              let filepath = outputPath;
              if (fs.existsSync(outputPath) && fs.statSync(outputPath).isDirectory()) {
                const title = note.title?.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30) || 'untitled';
                filepath = path.join(outputPath, `${note.key}_${title}.md`);
              }
              
              fs.writeFileSync(filepath, markdown, 'utf-8');
              console.log(`${symbols.success} Exported note to ${filepath}`);
            } else {
              // Output to stdout
              console.log(markdown);
            }
          } catch (e) {
            console.error(`${symbols.error} Failed to export note: ${e}`);
          }
          break;
        }

        default:
          console.log(`${symbols.error} Unknown subcommand: ${subcommand}`);
          console.log('   Run "zotero note --help" for usage.');
      }
    }
  },

  {
    name: 'attachment-download',
    aliases: ['attdl', 'down'],
    description: 'Download attachment from WebDAV',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-download <key>'); return; }
      const result = await attachmentManager.downloadFromWebDAV(args[0]);
      console.log(result.success ? `${symbols.success} Downloaded to ${result.localPath}` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-open',
    aliases: ['atto', 'open'],
    description: 'Open attachment with system default app',
    execute: async (args) => {
      await initModules();
      if (!args[0]) { console.log('Usage: attachment-open <key>'); return; }
      const result = await attachmentManager.openAttachment(args[0]);
      console.log(result.success ? `${symbols.success} Opened` : `${symbols.error} ${result.error}`);
    }
  },
  {
    name: 'attachment-dedup',
    aliases: ['attdedup', 'dedup'],
    description: 'Find and remove duplicate attachments',
    execute: async (args) => {
      await initModules();
      const result = await attachmentManager.findDuplicates();
      if (!result.success) { console.log(`${symbols.error} ${result.error}`); return; }
      console.log(`Found ${result.duplicates.length} duplicates`);
      if (args.includes('--delete')) {
        for (const g of result.duplicates) {
          await attachmentManager.removeDuplicates(g);
        }
        console.log(' Removed');
      }
    }
  },

  {
    name: 'annotations',
    aliases: ['annot', 'highlights', 'hl'],
    description: 'Show annotations/highlights for an item. Aliases: annot, highlights, hl',
    options: [
      { name: '--color', alias: '-c', description: 'Filter by annotation color', value: '<color>' },
      { name: '--type', alias: '-t', description: 'Filter by type (highlight, note, image, underline)', value: '<type>' },
      { name: '--format', alias: '-f', description: 'Output format (text|json|markdown)', value: '<fmt>' },
    ],
    examples: [
      'zotero annotations ABC123',
      'zotero hl ABC123 --format markdown',
      'zotero annot ABC123 -t highlight',
      'zotero annot ABC123 -c yellow',
    ],
    execute: async (args) => {
      await initModules();

      const key = args.find(a => !a.startsWith('-'));
      if (!key) {
        console.log(`${symbols.error} Usage: zotero annotations <item-key> [--color <color>] [--type <type>] [--format text|json|markdown]`);
        console.log('   Example: zotero annotations ABCD1234');
        process.exit(1);
      }

      // Parse options
      const colorIdx = args.indexOf('--color') !== -1 ? args.indexOf('--color') : args.indexOf('-c');
      const typeIdx = args.indexOf('--type') !== -1 ? args.indexOf('--type') : args.indexOf('-t');
      const fmtIdx = args.indexOf('--format') !== -1 ? args.indexOf('--format') : args.indexOf('-f');
      const colorFilter = colorIdx !== -1 ? args[colorIdx + 1] : undefined;
      const typeFilter = typeIdx !== -1 ? args[typeIdx + 1] : undefined;
      const format = fmtIdx !== -1 ? args[fmtIdx + 1] : 'text';

      try {
        const db = getDatabase();
        const library = await db.select().from(libraries).get();
        if (!library) {
          console.log(`${symbols.error} No library found. Run "sync" first.`);
          process.exit(1);
        }

        // Find the item
        const item = await db.select()
          .from(items)
          .where(and(eq(items.key, key), eq(items.libraryId, library.id)))
          .get();

        if (!item) {
          console.log(`${symbols.error} ${t('commands.annotations.notFound')}`);
          process.exit(1);
        }

        // Determine attachment keys to query annotations for
        let attachmentKeys: string[] = [];
        if (item.itemType === 'attachment') {
          attachmentKeys = [key];
        } else {
          // Find PDF attachment children
          const children = await db.select()
            .from(items)
            .where(and(
              eq(items.libraryId, library.id),
              eq(items.itemType, 'attachment'),
              eq(items.deleted, false),
              like(items.rawJson, `%"parentItem":"${key}"%`)
            ))
            .all();
          attachmentKeys = children.map((c: any) => c.key);
        }

        if (attachmentKeys.length === 0 && item.itemType !== 'annotation') {
          console.log(`\n${symbols.warning} ${t('commands.annotations.noAttachments')}`);
          return;
        }

        // Query annotation items
        const allAnnotations: any[] = [];
        for (const attKey of attachmentKeys) {
          const annots = await db.select()
            .from(items)
            .where(and(
              eq(items.libraryId, library.id),
              eq(items.itemType, 'annotation'),
              eq(items.deleted, false),
              like(items.rawJson, `%"parentItem":"${attKey}"%`)
            ))
            .all();
          allAnnotations.push(...annots);
        }

        // Parse annotation data
        let annotations = allAnnotations.map((row: any) => {
          const raw = JSON.parse(row.rawJson || '{}');
          const d = raw.data || raw;
          return {
            key: row.key,
            parentAttachmentKey: d.parentItem || '',
            annotationType: d.annotationType || 'highlight',
            annotationText: d.annotationText || '',
            annotationComment: d.annotationComment || '',
            annotationColor: d.annotationColor || '',
            annotationPageLabel: d.annotationPageLabel || '',
            annotationSortIndex: d.annotationSortIndex || '',
            tags: d.tags || [],
          };
        });

        // Apply filters
        if (colorFilter) {
          const colorMap: Record<string, string> = {
            yellow: '#ffd400', red: '#ff6666', green: '#5fb236',
            blue: '#2ea8e5', purple: '#a28ae5', orange: '#f19837',
          };
          const hex = colorMap[colorFilter.toLowerCase()] || colorFilter.toLowerCase();
          annotations = annotations.filter(a => a.annotationColor.toLowerCase() === hex);
        }
        if (typeFilter) {
          annotations = annotations.filter(a => a.annotationType === typeFilter.toLowerCase());
        }

        // Sort by sortIndex (page order)
        annotations.sort((a, b) => a.annotationSortIndex.localeCompare(b.annotationSortIndex));

        if (annotations.length === 0) {
          console.log(`\n${symbols.warning} ${t('commands.annotations.noAnnotations')}`);
          return;
        }

        const itemTitle = item.title || '(no title)';

        // Output based on format
        if (format === 'json') {
          console.log(JSON.stringify(annotations, null, 2));
        } else if (format === 'markdown') {
          console.log(`# ${itemTitle}\n`);
          let currentPage = '';
          for (const a of annotations) {
            const page = a.annotationPageLabel;
            if (page && page !== currentPage) {
              currentPage = page;
              console.log(`## Page ${page}\n`);
            }
            if (a.annotationType === 'note') {
              console.log(`- **${t('commands.annotations.note')}**: ${a.annotationComment}\n`);
            } else {
              if (a.annotationText) {
                console.log(`> ${a.annotationText}\n`);
              }
              if (a.annotationComment) {
                console.log(`${t('commands.annotations.comment')}: ${a.annotationComment}\n`);
              }
            }
          }
        } else {
          // Default: text format
          const colorDot = (hex: string): string => {
            const map: Record<string, string> = {
              '#ffd400': '\u{1F7E1}', '#ff6666': '\u{1F534}', '#5fb236': '\u{1F7E2}',
              '#2ea8e5': '\u{1F535}', '#a28ae5': '\u{1F7E3}', '#f19837': '\u{1F7E0}',
            };
            return map[hex.toLowerCase()] || '\u{26AA}';
          };

          console.log(`\n${t('commands.annotations.title', itemTitle, annotations.length)}\n`);
          for (const a of annotations) {
            const page = a.annotationPageLabel ? `[${t('commands.annotations.page')}${a.annotationPageLabel}]` : '';
            const dot = colorDot(a.annotationColor);

            if (a.annotationType === 'note') {
              console.log(`  ${page} ${dot} ${t('commands.annotations.note')}: ${a.annotationComment}`);
            } else {
              const text = a.annotationText ? `"${a.annotationText}"` : '';
              console.log(`  ${page} ${dot} ${text}`);
              if (a.annotationComment) {
                console.log(`        ${t('commands.annotations.comment')}: ${a.annotationComment}`);
              }
            }
            console.log();
          }
        }
      } catch (error) {
        console.log(`${symbols.error} Failed to get annotations: ${error}`);
        process.exit(1);
      }
    }
  },

  {
    name: 'config',
    aliases: ['cfg', 'conf'],
    description: 'Configure zotero CLI settings',
    options: [
      { name: '--get', alias: '-g', description: 'Get config value', value: '<key>' },
      { name: '--set', alias: '-s', description: 'Set config value', value: '<key=value>' },
      { name: '--list', alias: '-l', description: 'List all config' },
    ],
    examples: [
      'zotero config --get apiKey',
      'zotero config -s "defaultLimit=50"',
    ],
    execute: async (args) => {
      const { configManager } = await import('@zotero-headless/core');
      
      if (args[0] === '--init') {
        configManager.init();
        console.log(`${symbols.success} Config file created at ~/.zoterrc`);
        return;
      }
      
      if (args[0] === '--show') {
        console.log('Current config:');
        console.log(JSON.stringify(configManager.getAll(), null, 2));
        return;
      }
      
      console.log('Usage:');
      console.log('  zotero config --init   Create default config');
      console.log('  zotero config --show    Show current config');
    }
  },

  {
    name: 'history',
    aliases: ['hist', 'h', 'recent'],
    description: 'Show recent items and commands',
    options: [
      { name: '--limit', alias: '-l', description: 'Number of entries', value: '<N>' },
      { name: '--clear', alias: '-c', description: 'Clear history' },
    ],
    examples: [
      'zotero history',
      'zotero history -l 20',
    ],
    execute: async (args) => {
      const { historyManager } = await import('@zotero-headless/core');
      
      if (args.includes('--clear')) {
        historyManager.clear();
        console.log(' History cleared');
        return;
      }
      
      const limit = parseInt(args.find(a => !a.startsWith('-')) || '10');
      const recent = historyManager.getRecent(limit);
      
      if (recent.length === 0) {
        console.log('📭 No history found');
        return;
      }
      
      console.log(`\n📜 Recent history (${recent.length}):\n`);
      recent.forEach((entry, i) => {
        const date = new Date(entry.timestamp).toLocaleDateString();
        const icon = entry.type === 'item' ? '' : entry.type === 'search' ? '' : '';
        console.log(`  ${icon} [${entry.key || entry.query || entry.command}] (${date})`);
      });
      console.log();
    }
  },

  {
    name: 'help',
    aliases: ['h', '?'],
    description: 'Show help message',
    options: [
      { name: '--all', alias: '-a', description: 'Show all commands including hidden ones' },
    ],
    examples: [
      'zotero help',
      'zotero help sync',
      'zotero sync --help',
    ],
    execute: async () => {
      console.log(`
 Zotero-Headless CLI

Usage: zotero <command> [options]

Core Commands:
  sync (s, pull, fetch)        Synchronize library
  list (ls, ll, la)            List items (ls=standard, ll=detailed, la=compact)
  search (find, grep, f)       Search by title/author/tags
  get (show, cat, view)        Show item details
  stats (st, info, df)         Show statistics
  verify (v, check, ping)      Verify API key

Item Management:
  add (a, new, touch)          Add new item with optional attachments
  add-by-id (addby)            Add by DOI/ISBN/PMID/arXiv with optional attachments
  update (u, edit, set)        Update item field
  delete (rm, del, d, trash)   Delete/trash item
  export (e, out, save)        Export to bibtex/ris/csv/json

Notes & Attachments:
  note (n, notes)              Note management (Markdown support)
  attachments (att, files)     List attachments

Group Libraries:
  groups (g, team)             List group libraries

WebDAV:
  webdav:config (wdc)          Configure WebDAV
  webdav:sync (wds)            Sync attachments to WebDAV
  webdav:status (wdst)         Show WebDAV status
  webdav:scan (wdscan)         Scan WebDAV attachments

Global Options:
  --lang=en|zh                 Set language (default: zh)

Quick Examples:
  zotero sync                           # Sync library
  zotero ls -t book                     # List books
  zotero grep "machine learning"        # Search
  zotero cat ABCD1234                   # View item
  zotero rm ABCD1234 -f                 # Force delete
  zotero touch journalArticle "Title"   # Add item

With Attachments:
  zotero add book "Title" "Author" -a file1.pdf -a file2.pdf
  zotero add-by-id "10.1000/xyz" -a supplement.pdf
  zotero ls                             # Shows N count for each item

With Notes (Markdown):
  zotero note add ABCD1234 "Key findings: ..."
  zotero note show NOTE5678             # View as Markdown
  zotero note edit NOTE5678 "Updated: ..."
  zotero note list ABCD1234             # List item's notes

For more info: https://github.com/altairwei/Zotero-Headless
`);
    }
  },

  // ============ Shell Command ============

  {
    name: 'shell',
    aliases: ['sh', 'repl', 'interactive', 'i'],
    description: 'Start interactive shell. Use --lang=en or --lang=zh to set language.',
    options: [
      { name: '--lang', description: 'Set language (en|zh)', value: '<lang>' },
    ],
    examples: [
      'zotero shell',
    ],
    execute: async (args: string[]) => {
      const { spawn } = await import('child_process');
      const { fileURLToPath } = await import('url');
      const { dirname, join } = await import('path');
      const { existsSync } = await import('fs');

      // Parse --lang argument
      let lang: string | undefined;
      const langArg = args.find(arg => arg.startsWith('--lang='));
      if (langArg) {
        lang = langArg.split('=')[1];
      }

      // Find shell path - try multiple locations
      let shellPath: string | null = null;

      // Try 1: Shell bundle next to CLI entry point (npm package layout)
      try {
        const __dirname = dirname(fileURLToPath(import.meta.url));
        // Try .mjs first (ESM bundle), then .js fallback
        for (const name of ['shell.mjs', 'shell.js']) {
          const bundlePath = join(__dirname, name);
          if (existsSync(bundlePath)) {
            shellPath = bundlePath;
            break;
          }
        }
      } catch {
        // ignore
      }

      // Try 2: Relative to CLI entry point (__dirname)
      // This works for npm global install (legacy layout)
      if (!shellPath) {
        try {
          const __dirname = dirname(fileURLToPath(import.meta.url));
          const relativePath = join(__dirname, 'apps', 'shell', 'dist', 'index.js');
          if (existsSync(relativePath)) {
            shellPath = relativePath;
          }
        } catch {
          // ignore
        }
      }

      // Try 3: In node_modules (development or npm link)
      if (!shellPath) {
        try {
          shellPath = require.resolve('@zotero-headless/shell');
        } catch {
          // ignore
        }
      }

      // Try 4: Relative to current working directory (development)
      if (!shellPath) {
        const devPath = join(process.cwd(), 'apps', 'shell', 'dist', 'index.js');
        if (existsSync(devPath)) {
          shellPath = devPath;
        }
      }

      if (!shellPath) {
        console.error(`${symbols.error} Cannot find shell.`);
        console.log('');
        console.log('Try reinstalling: npm install -g zotero-headless');
        return;
      }

      try {
        const child = spawn('node', [shellPath], {
          stdio: 'inherit',
          shell: false,
          env: {
            ...process.env,
            ZOTERO_LANG: lang || getLanguage()
          }
        });

        child.on('exit', (code) => {
          process.exitCode = code ?? 0;
        });
      } catch (error) {
        console.error(`${symbols.error} Failed to start shell:`, error);
      }
    }
  }
];

// ============ CLI Entry Point ============

// Export commands for programmatic use (e.g., from shell)
export { commands };

// Export main function for testing
export async function main() {
  const args = process.argv.slice(2);

  // Check for --version flag
  if (args[0] === '--version' || args[0] === '-v') {
    try {
      // Use require for pkg compatibility
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const packageJson = require('../../package.json');
      console.log(packageJson.version || 'unknown');
    } catch {
      console.log('unknown');
    }
    return;
  }

  // Check for --lang option before command parsing
  const langArg = args.find(arg => arg.startsWith('--lang='));
  if (langArg) {
    const lang = langArg.split('=')[1] as Language;
    if (lang === 'en' || lang === 'zh') {
      setLanguage(lang);
    }
  }

  const commandName = args[0]?.toLowerCase() || 'help';
  const commandArgs = args.slice(1);

  // Handle "zotero help <command>" syntax
  if (commandName === 'help' && commandArgs.length > 0 && !commandArgs[0].startsWith('-')) {
    const helpTarget = commandArgs[0].toLowerCase();
    const cmd = commands.find(c =>
      c.name === helpTarget || c.aliases?.includes(helpTarget)
    );
    if (cmd) {
      showCommandHelp(cmd, helpTarget);
      return;
    } else {
      console.log(`${symbols.error} Unknown command: ${helpTarget}`);
      console.log(`   Run "zotero help" for all commands.`);
      process.exit(1);
    }
  }

  // Check for --help or -h flag on commands
  if (commandArgs.includes('--help') || commandArgs.includes('-h') || commandName === 'help') {
    // Show help for specific command or general help
    if (commandName !== 'help') {
      // Try to find the command to show its specific help
      const cmd = commands.find(c =>
        c.name === commandName || c.aliases?.includes(commandName)
      );
      if (cmd) {
        showCommandHelp(cmd, commandName);
        return;
      }
    }

    // Show general help
    const helpCmd = commands.find(c => c.name === 'help');
    if (helpCmd) {
      await helpCmd.execute([]);
      return;
    }
  }

  const command = commands.find(c =>
    c.name === commandName || c.aliases?.includes(commandName)
  );

  if (!command) {
    console.log(`${symbols.error} Unknown command: ${commandName}`);
    console.log(`   Run "zotero help" for usage.`);
    process.exit(1);
  }

  try {
    await command.execute(commandArgs, commandName);
  } catch (error) {
    console.error(`${symbols.error} Command failed:`, error);
    process.exit(1);
  }
}

/**
 * Show detailed help for a specific command
 */
function showCommandHelp(cmd: Command, invokedName: string) {
  console.log(`\n📖 ${cmd.name} - ${cmd.description}\n`);
  
  console.log(`Usage: zotero ${invokedName}${cmd.options ? ' [options]' : ''} [arguments]\n`);
  
  if (cmd.aliases && cmd.aliases.length > 0) {
    console.log(`Aliases: ${cmd.aliases.join(', ')}\n`);
  }
  
  if (cmd.options && cmd.options.length > 0) {
    console.log('Options:');
    for (const opt of cmd.options) {
      const aliasStr = opt.alias ? `, ${opt.alias}` : '';
      const valueStr = opt.value ? ` ${opt.value}` : '';
      console.log(`  ${opt.name}${aliasStr}${valueStr}`);
      console.log(`      ${opt.description}`);
    }
    console.log('');
  }
  
  if (cmd.examples && cmd.examples.length > 0) {
    console.log('Examples:');
    for (const ex of cmd.examples) {
      console.log(`  $ ${ex}`);
    }
    console.log('');
  }
  
  console.log('Use "zotero help" to see all available commands.\n');
}

// Only run main if this file is executed directly
import { fileURLToPath } from 'url';
import { realpathSync } from 'fs';
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  main();
}
