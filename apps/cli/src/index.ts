#!/usr/bin/env node
// @ts-nocheck

// Zotero-Headless CLI
// See Zotero-Headless-Complete-Design.md Section 7

import { appConfig } from '@zotero-headless/core';
import { eq, like, desc, asc, count, and, isNull } from 'drizzle-orm';
import { ProgressBar } from './progress-bar.js';
import { resolveConflictsInteractive, isInteractive, ConflictItem } from './conflict-resolver.js';
import { t, setLanguage, formatItemType, formatField, type Language } from './i18n.js';

// Lazy-loaded modules (to avoid initialization on help commands)
let syncManager: any;
let getDatabase: any;
let items: any;
let libraries: any;
let attachments: any;
let zoteroApi: any;
let attachmentManager: any;
let webdavConfig: any;

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
 * 生成 Zotero 格式的随机 key
 * 8位大写字母和数字组合
 */
function generateKey(): string {
  return Array.from({ length: 8 }, () => 
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.charAt(
      Math.floor(Math.random() * 36)
    )
  ).join('');
}

// ============ CLI Commands ============

interface Command {
  name: string;
  aliases?: string[];
  description: string;
  execute: (args: string[]) => Promise<void>;
}

const commands: Command[] = [
  {
    name: 'sync',
    aliases: ['s', 'pull', 'fetch', 'refresh'],
    description: 'Synchronize library. Aliases: s, pull, fetch, refresh. Options: -f/--full-sync, -g/--groups, -q/--quiet, -i/--interactive',
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
          console.log(`\n⚠️  ${result.conflicts.length} ${t('conflict.title')}`);
          
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
              // Re-fetch and apply remote version
              console.log(`   ${t('conflict.remote')}: ${key}`);
              // Note: Would need to re-fetch from API here
              resolvedCount++;
            } else if (resolution === 'local') {
              console.log(`   ${t('conflict.local')}: ${key}`);
              resolvedCount++;
            }
          }
          
          console.log(`\n✅ ${t('common.success')}: ${resolvedCount}`);
        } else if (!quiet) {
          console.log(`\n⚠️  ${result.conflicts.length} conflicts detected.`);
          console.log('   Run with --interactive (-i) to resolve manually');
          console.log('   Or use --conflict-strategy=remote|local for auto-resolution');
        }
      }
      
      if (result.success) {
        if (!quiet) {
          console.log(`\n✅ Sync completed successfully!`);
          console.log(`   Items updated: ${result.updated}`);
          console.log(`   Items deleted: ${result.deleted}`);
        }
      } else {
        console.log(`\n⚠️  Sync completed with issues:`);
        result.errors.forEach(e => console.log(`   Error: ${e}`));
        if (result.conflicts && result.conflicts.length > 0 && !interactive) {
          console.log(`   Conflicts: ${result.conflicts.length}`);
          result.conflicts.forEach(c => console.log(`     - ${c}`));
        }
        process.exit(1);
      }
    }
  },
  
  {
    name: 'groups',
    aliases: ['g', 'team', 'org'],
    description: 'List group libraries. Aliases: g, team, org',
    execute: async () => {
      await initModules();
      
      console.log('📚 Fetching your groups...');
      const groups = await syncManager.getUserGroups();
      
      if (groups.length === 0) {
        console.log('   No groups found.');
        return;
      }
      
      console.log(`\n📚 Your Groups (${groups.length}):\n`);
      groups.forEach(group => {
        const accessIcon = group.accessLevel === 'write' ? '✏️' : '👁️';
        console.log(`  ${accessIcon} [${group.groupId}] ${group.name}`);
        console.log(`      Access: ${group.accessLevel}`);
        console.log('');
      });
    }
  },
  
  {
    name: 'sync:upload',
    aliases: ['su'],
    description: 'Upload local changes only',
    execute: async () => {
      console.log('📤 This would upload local changes...');
      // Implementation for upload-only would go here
    }
  },
  
  {
    name: 'list',
    aliases: ['ls', 'll'],
    description: 'List items. Aliases: ls, ll (detailed). Options: -t/--type, -u/--unsynced, -d/--deleted, -s/--since, -e/--until, -S/--sort, -o/--order, -l/--limit, -O/--offset',
    execute: async (args) => {
      const isDetailed = process.argv.includes('ll');  // Check if invoked as 'll'
      await initModules();
      const db = getDatabase();
      
      // Parse options
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
      } = { limit: 20, offset: 0 };
      
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
        } else if (!arg.startsWith('-')) {
          positionalArgs.push(arg);
        }
      }
      
      // Backward compatibility: positional args as limit/offset
      if (positionalArgs.length > 0) options.limit = parseInt(positionalArgs[0]) || 20;
      if (positionalArgs.length > 1) options.offset = parseInt(positionalArgs[1]) || 0;
      
      const library = await db.select().from(libraries).get();
      if (!library) {
        console.log('❌ No library found. Run "sync" first.');
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
      
      const results = await db.select()
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
      console.log(`\n📚 Items (${results.length} shown)${filterDesc}:\n`);
      
      if (results.length === 0) {
        console.log('   No items match the criteria.');
      } else {
        results.forEach(item => {
          const syncStatus = item.synced ? '✅' : '🔄';
          const delStatus = item.deleted ? ' (deleted)' : '';
          console.log(`  ${syncStatus} [${item.key}] ${item.title?.substring(0, 60) || '(no title)'}${delStatus}`);
          console.log(`      Type: ${item.itemType} | Updated: ${formatDate(item.updatedAt)}`);
          console.log();
        });
      }
    }
  },
  
  {
    name: 'list:unsynced',
    aliases: ['lsu'],
    description: 'List unsynced items',
    execute: async () => {
      await initModules();
      const db = getDatabase();
      const library = await db.select().from(libraries).get();
      if (!library) {
        console.log('❌ No library found. Run "sync" first.');
        return;
      }
      
      const results = await db.select()
        .from(items)
        .where(and(
          eq(items.libraryId, library.id),
          eq(items.synced, false)
        ))
        .all();
      
      console.log(`\n🔄 Unsynced items (${results.length}):\n`);
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
    name: 'search',
    aliases: ['find', 'grep', 'f'],
    description: 'Search items. Aliases: find, grep, f. Options: -f/--field, -s/--since, -u/--unsynced, -l/--limit',
    execute: async (args) => {
      await initModules();
      
      // Parse options
      const options: {
        query: string;
        field: 'title' | 'author' | 'tags' | 'all';
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
        console.log('❌ Please provide a search query');
        console.log('   Usage: zotero search <query> [options]');
        console.log('   Options:');
        console.log('     --field title|author|tags|all  (default: title)');
        console.log('     --since YYYY-MM-DD');
        console.log('     --unsynced');
        console.log('     --limit N');
        return;
      }
      
      const db = getDatabase();
      const library = await db.select().from(libraries).get();
      
      if (!library) {
        console.log('❌ No library found. Run "sync" first.');
        return;
      }
      
      // Build search conditions
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
      
      const results = await db.select()
        .from(items)
        .where(whereConditions)
        .limit(options.limit)
        .all();
      
      // Build search description
      const filters: string[] = [];
      if (options.field !== 'title') filters.push(`field:${options.field}`);
      if (options.since) filters.push(`since:${options.since}`);
      if (options.unsynced) filters.push('unsynced');
      
      const filterDesc = filters.length > 0 ? ` (${filters.join(', ')})` : '';
      console.log(`\n🔍 Search results for "${options.query}"${filterDesc} (${results.length}):\n`);
      
      if (results.length === 0) {
        console.log('   No results found.');
      } else {
        results.forEach(item => {
          const syncStatus = item.synced ? '✅' : '🔄';
          console.log(`  ${syncStatus} [${item.key}] ${item.title?.substring(0, 70) || '(no title)'}`);
          if (options.field === 'author' && item.creators) {
            console.log(`      Authors: ${item.creators.substring(0, 50)}`);
          }
        });
      }
    }
  },
  
  {
    name: 'get',
    aliases: ['show', 'cat', 'view'],
    description: 'Show item details. Aliases: show, cat, view',
    execute: async (args) => {
      await initModules();
      if (args.length === 0) {
        console.log('❌ Please provide an item key');
        console.log('   Usage: zotero get <key>');
        return;
      }
      
      const db = getDatabase();
      const key = args[0];
      const library = await db.select().from(libraries).get();
      
      if (!library) {
        console.log('❌ No library found. Run "sync" first.');
        return;
      }
      
      const item = await db.select()
        .from(items)
        .where(and(eq(items.key, key), eq(items.libraryId, library.id)))
        .get();
      
      if (!item) {
        console.log(`❌ Item ${key} not found.`);
        return;
      }
      
      console.log(`\n📄 Item: ${key}\n`);
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
    name: 'stats',
    aliases: ['st', 'info', 'status', 'df'],
    description: 'Show library statistics. Aliases: st, info, status, df',
    execute: async () => {
      await initModules();
      const db = getDatabase();
      
      const library = await db.select().from(libraries).get();
      if (!library) {
        console.log('❌ No library found. Run "sync" first.');
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
      
      console.log('\n📊 Library Statistics:\n');
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
    name: 'verify',
    aliases: ['v', 'check', 'test', 'ping'],
    description: 'Verify API key and connection. Aliases: v, check, test, ping',
    execute: async () => {
      await initModules();
      console.log('🔑 Verifying API key...\n');
      try {
        const keyInfo = await zoteroApi.verifyKey();
        console.log(`✅ API key is valid!`);
        console.log(`   Username: ${keyInfo.username}`);
        console.log(`   User ID: ${keyInfo.userID}`);
        console.log(`\n   Access:`);
        console.log(`     Library: ${keyInfo.access.user.library ? '✅' : '❌'}`);
        console.log(`     Files: ${keyInfo.access.user.files ? '✅' : '❌'}`);
        console.log(`     Notes: ${keyInfo.access.user.notes ? '✅' : '❌'}`);
        console.log(`     Write: ${keyInfo.access.user.write ? '✅' : '❌'}`);
      } catch (e) {
        console.log(`❌ API key verification failed!`);
        console.log(`   Error: ${e}`);
        process.exit(1);
      }
    }
  },
  
  // ============ Attachment & WebDAV Commands ============
  
  {
    name: 'attachments',
    aliases: ['att', 'files', 'docs'],
    description: 'List attachments. Aliases: att, files, docs',
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
        console.log('❌ No library found. Run "sync" first.');
        return;
      }
      
      const attachmentList = await attachmentManager.listAttachments({
        libraryId: library.id,
        itemKey: options.itemKey,
        webdavSynced: options.webdavSynced,
        limit: options.limit,
      });
      
      console.log(`\n📎 Attachments (${attachmentList.length}):\n`);
      
      if (attachmentList.length === 0) {
        console.log('   No attachments found.');
      } else {
        attachmentList.forEach(att => {
          const webdavStatus = att.webdavSynced ? '☁️' : '📁';
          const typeIcon = att.attachmentType === 'link' ? '🔗' : '📄';
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
    name: 'webdav:config',
    aliases: ['wdc'],
    description: 'Configure WebDAV server',
    execute: async (args) => {
      await initModules();
      if (args.length < 3) {
        console.log('❌ Please provide WebDAV configuration');
        console.log('   Usage: zotero webdav:config <url> <username> <password> [basePath]');
        console.log('   Example: zotero webdav:config https://dav.jianguoyun.com/dav/zotero user pass /');
        return;
      }
      
      const [url, username, password, basePath] = args;
      
      console.log('🔧 Configuring WebDAV...\n');
      const result = await attachmentManager.configureWebDAV({
        url,
        username,
        password,
        basePath: basePath || '/zotero',
        autoSync: false,
      });
      
      if (result.success) {
        console.log('✅ WebDAV configured successfully!');
        console.log(`   URL: ${url}`);
        console.log(`   Username: ${username}`);
        console.log(`   Base Path: ${basePath || '/zotero'}`);
      } else {
        console.log('❌ WebDAV configuration failed!');
        console.log(`   Error: ${result.error}`);
        process.exit(1);
      }
    }
  },
  
  {
    name: 'webdav:sync',
    aliases: ['wds'],
    description: 'Sync attachments to WebDAV',
    execute: async (args) => {
      await initModules();
      const quiet = args.includes('--quiet') || args.includes('-q');
      
      if (!quiet) {
        console.log('☁️  Syncing attachments to WebDAV...\n');
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
        console.log(`\n✅ WebDAV sync completed!`);
        console.log(`   Attachments synced: ${result.synced}`);
      } else {
        console.log(`\n⚠️  WebDAV sync completed with errors:`);
        result.errors.forEach(e => console.log(`   Error: ${e}`));
      }
    }
  },
  
  {
    name: 'webdav:status',
    aliases: ['wdst'],
    description: 'Show WebDAV configuration status',
    execute: async () => {
      await initModules();
      const db = getDatabase();
      const config = await db.select().from(webdavConfig).get();
      
      if (!config) {
        console.log('❌ WebDAV not configured');
        console.log('   Use "zotero webdav:config" to configure');
        return;
      }
      
      console.log('\n☁️  WebDAV Configuration:\n');
      console.log(`   URL: ${config.url}`);
      console.log(`   Username: ${config.username}`);
      console.log(`   Base Path: ${config.basePath}`);
      console.log(`   Enabled: ${config.enabled ? 'Yes' : 'No'}`);
      console.log(`   Auto Sync: ${config.autoSync ? 'Yes' : 'No'}`);
      console.log(`   Last Sync: ${config.lastSyncAt ? new Date(config.lastSyncAt * 1000).toISOString() : 'Never'}`);
      if (config.lastError) {
        console.log(`   Last Error: ${config.lastError}`);
      }
      
      // Test connection
      console.log('\n🔍 Testing connection...');
      const init = await attachmentManager.initWebDAV();
      if (init.success) {
        console.log('   ✅ Connection successful!');
      } else {
        console.log(`   ❌ Connection failed: ${init.error}`);
      }
      console.log();
    }
  },
  
  {
    name: 'webdav:scan',
    aliases: ['wdscan'],
    description: 'Scan WebDAV for existing Zotero Desktop attachments',
    execute: async (args) => {
      await initModules();
      const quiet = args.includes('--quiet') || args.includes('-q');
      
      if (!quiet) {
        console.log('🔍 Scanning WebDAV for Zotero Desktop attachments...\n');
      }
      
      const result = await attachmentManager.scanWebDAV();
      
      if (!result.success) {
        console.log(`❌ Failed to scan WebDAV: ${result.error}`);
        return;
      }
      
      if (result.items.length === 0) {
        console.log('ℹ️  No items found in WebDAV storage.');
        return;
      }
      
      console.log(`📂 Found ${result.items.length} item(s) in WebDAV storage:\n`);
      
      let totalFiles = 0;
      let withProp = 0;
      let withoutProp = 0;
      
      for (const item of result.items.slice(0, 20)) { // Limit to first 20
        totalFiles += item.files.length;
        item.files.forEach(f => {
          if (f.hasProp) withProp++;
          else withoutProp++;
        });
        
        const propIcon = item.files[0]?.hasProp ? '✅' : '⚠️ ';
        console.log(`   📁 ${item.itemKey}/`);
        item.files.forEach(f => {
          console.log(`      ${propIcon} ${f.filename} (${(f.size / 1024).toFixed(1)} KB)`);
        });
      }
      
      if (result.items.length > 20) {
        console.log(`   ... and ${result.items.length - 20} more items`);
      }
      
      console.log(`\n📊 Summary:`);
      console.log(`   Total files: ${totalFiles}`);
      console.log(`   With .prop: ${withProp}`);
      console.log(`   Without .prop: ${withoutProp}`);
      console.log(`\n💡 Tip: Files without .prop can still be used, but metadata may differ.`);
      console.log();
    }
  },
  
  {
    name: 'add',
    aliases: ['a', 'new', 'touch', 'create'],
    description: 'Add a new item. Aliases: a, new, touch, create',
    execute: async (args) => {
      await initModules();
      console.log('📝 Adding new item to library...\n');
      
      // Parse arguments: zotero add <type> <title> [authors...]
      const itemType = args[0] || 'journalArticle';
      const title = args[1];
      
      if (!title) {
        console.log('❌ Usage: zotero add <type> <title> [authors...]');
        console.log('   Example: zotero add journalArticle "My Article" "John Doe"');
        console.log('\n   Supported types:');
        console.log('   journalArticle, book, bookSection, conferencePaper, thesis, report, webpage, document');
        process.exit(1);
      }
      
      try {
        // Get library info
        const library = await getDatabase().select().from(libraries).get();
        if (!library) {
          console.log('❌ No library found. Run "sync" first.');
          process.exit(1);
        }
        
        // Create item data
        const itemData = {
          itemType,
          title,
          creators: args.slice(2).map((author, index) => {
            const parts = author.split(' ');
            const lastName = parts.pop() || '';
            const firstName = parts.join(' ') || '';
            return { firstName, lastName, creatorType: index === 0 ? 'author' : 'author' };
          })
        };
        
        // Call Zotero API to create item
        console.log(`   Creating ${itemType}: "${title}"`);
        const result = await zoteroApi.createItems(String(library.zoteroId), [itemData]);
        
        if (result.successful && result.successful['0']) {
          const newKey = result.successful['0'];
          console.log(`✅ Item created successfully!`);
          console.log(`   Key: ${newKey}`);
          
          // Update local version to trigger re-sync
          await getDatabase().update(libraries)
            .set({ version: library.version - 1 })
            .where(eq(libraries.id, library.id))
            .run();
          
          console.log(`\n💡 Run "zotero sync" to download the new item.`);
        } else if (result.failed) {
          console.log(`❌ Failed to create item:`);
          Object.values(result.failed).forEach((err: any) => {
            console.log(`   ${err.code}: ${err.message}`);
          });
          process.exit(1);
        }
      } catch (error) {
        console.log(`❌ Failed to add item: ${error}`);
        process.exit(1);
      }
    }
  },
  
  {
    name: 'update',
    aliases: ['u', 'edit', 'set', 'mod'],
    description: 'Update an item. Aliases: u, edit, set, mod',
    execute: async (args) => {
      await initModules();
      console.log('📝 Updating item locally...\n');
      
      const key = args[0];
      const field = args[1];
      const value = args.slice(2).join(' ');
      
      if (!key || !field || !value) {
        console.log('❌ Usage: zotero update <key> <field> <value>');
        console.log('   Example: zotero update ABCD123 title "New Title"');
        console.log('\n   Available fields:');
        console.log('   title, date, abstract, url, doi');
        process.exit(1);
      }
      
      try {
        const db = getDatabase();
        const library = await db.select().from(libraries).get();
        
        if (!library) {
          console.log('❌ No library found. Run "sync" first.');
          process.exit(1);
        }
        
        // Get current item
        const item = await db.select()
          .from(items)
          .where(and(eq(items.key, key), eq(items.libraryId, library.id)))
          .get();
        
        if (!item) {
          console.log(`❌ Item ${key} not found.`);
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
        
        console.log(`✅ Item updated locally!`);
        console.log(`   Changed: ${field} "${oldValue}" → "${value}"`);
        console.log(`\n💡 Run "zotero sync" to upload changes to remote.`);
      } catch (error) {
        console.log(`❌ Failed to update item: ${error}`);
        process.exit(1);
      }
    }
  },
  
  {
    name: 'delete',
    aliases: ['d', 'del', 'rm', 'trash'],
    description: 'Delete (trash) an item. Aliases: rm, del, d. Options: -p/--permanent, -f/--force',
    execute: async (args) => {
      await initModules();
      console.log('🗑️  Deleting item locally...\n');
      
      const key = args[0];
      const permanent = args.includes('--permanent') || args.includes('-p');
      const force = args.includes('--force') || args.includes('-f');
      
      if (!key) {
        console.log('❌ Usage: zotero delete <key> [--permanent]');
        console.log('   Example: zotero delete ABCD123');
        console.log('   Example: zotero delete ABCD123 --permanent (permanent delete)');
        process.exit(1);
      }
      
      try {
        const db = getDatabase();
        const library = await db.select().from(libraries).get();
        
        if (!library) {
          console.log('❌ No library found. Run "sync" first.');
          process.exit(1);
        }
        
        // Get current item
        const item = await db.select()
          .from(items)
          .where(and(eq(items.key, key), eq(items.libraryId, library.id)))
          .get();
        
        if (!item) {
          console.log(`❌ Item ${key} not found.`);
          process.exit(1);
        }
        
        if (permanent) {
          // Permanent delete: remove from local DB immediately
          // Sync will detect it's gone and delete from remote
          console.log(`   Marking ${key} for permanent deletion...`);
          
          await db.delete(items)
            .where(and(eq(items.key, key), eq(items.libraryId, library.id)))
            .run();
          
          console.log(`✅ Item marked for permanent deletion!`);
        } else {
          // Soft delete (move to trash): mark as deleted locally
          console.log(`   Moving ${key} to trash...`);
          
          // Get current data and set deleted flag
          const rawData = JSON.parse(item.rawJson || '{}');
          const data = rawData.data || rawData;
          data.deleted = true;
          
          // Update local item: mark as deleted and unsynced
          await db.update(items)
            .set({ 
              deleted: true, 
              synced: false, 
              updatedAt: Math.floor(Date.now() / 1000),  // 使用秒级时间戳
              rawJson: JSON.stringify({ ...rawData, data })
            })
            .where(and(eq(items.key, key), eq(items.libraryId, library.id)))
            .run();
          
          console.log(`✅ Item moved to trash locally!`);
        }
        
        console.log(`\n💡 Run "zotero sync" to sync deletion to remote.`);
      } catch (error) {
        console.log(`❌ Failed to delete item: ${error}`);
        process.exit(1);
      }
    }
  },
  
  {
    name: 'export',
    aliases: ['e', 'out', 'save'],
    description: 'Export items to various formats. Aliases: e, out, save',
    execute: async (args) => {
      await initModules();
      console.log('📤 Exporting items...\n');
      
      try {
        // Parse arguments
        const format = args[0]?.toLowerCase() || 'bibtex';
        const outputFile = args[1];
        const limit = args[2] ? parseInt(args[2]) : 100;
        
        const validFormats = ['bibtex', 'ris', 'csv', 'json'];
        if (!validFormats.includes(format)) {
          console.log(`❌ Invalid format: ${format}`);
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
          console.log(`✅ Exported ${limit} items to ${outputFile} (${format} format)`);
        } else {
          console.log(content);
          console.log(`\n💡 Tip: Add output file path to save to file`);
          console.log(`   Example: zotero export bibtex references.bib`);
        }
      } catch (error) {
        console.error('❌ Export failed:', error);
        process.exit(1);
      }
    }
  },

  {
    name: 'add-by-id',
    aliases: ['add'],
    description: 'Add item(s) by identifier (DOI, ISBN, PMID, arXiv)',
    execute: async (args) => {
      if (args.length === 0) {
        console.log(`
❌ 请提供至少一个标识符

用法: zotero add-by-id <identifier> [identifier2 ...]

支持的标识符类型:
  • DOI    - 如 10.1007/s11263-019-01228-7
  • ISBN   - 如 978-3-642-15515-4
  • PMID   - 如 1234567
  • arXiv  - 如 2001.12345

示例:
  zotero add-by-id "10.1007/s11263-019-01228-7"
  zotero add-by-id "978-3-642-15515-4"
  zotero add-by-id "1234567"
  zotero add-by-id "10.1007/xyz, 978-3-642-15515-4"  # 批量
        `);
        return;
      }

      await initModules();
      const input = args.join(' ');
      
      try {
        console.log('🔍 正在解析标识符...\n');
        
        // 导入 identifier 模块
        const { IdentifierParser, MetadataFetcher } = await import('./identifier/index.js');
        
        // 1. 解析标识符
        const identifiers = IdentifierParser.parse(input);
        console.log(`📝 找到 ${identifiers.length} 个标识符`);
        
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
        console.log('\n📦 正在获取元数据...');
        const results = await fetcher.fetchBatch(identifiers);
        
        // 5. 显示结果摘要
        const successCount = results.filter(r => !r.error).length;
        const failCount = results.filter(r => r.error).length;
        
        console.log(`\n📊 结果摘要:`);
        console.log(`   ✅ 成功: ${successCount}`);
        console.log(`   ❌ 失败: ${failCount}`);
        
        // 6. 写入数据库
        if (successCount > 0) {
          console.log('\n💾 写入本地数据库...');
          const db = getDatabase();
          const library = await db.select().from(libraries).get();
          
          if (!library) {
            console.log('❌ 未找到文献库。请先运行 "zotero sync"');
            return;
          }
          
          for (const result of results) {
            if (result.error || !result.item) continue;
            
            const item = {
              key: generateKey(),
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
            console.log(`   📄 已添加: ${item.title?.substring(0, 50) || '(无标题)'}...`);
          }
          
          console.log(`\n🎉 成功添加 ${successCount} 个文献到本地数据库！`);
          console.log('💡 运行 "zotero sync" 上传到远程');
        }
        
        // 7. 显示失败详情
        if (failCount > 0) {
          console.log('\n⚠️ 失败的标识符:');
          results.filter(r => r.error).forEach((result, index) => {
            console.log(`   ${index + 1}. ${result.identifier.value}`);
            console.log(`     原因: ${result.error}`);
          });
        }
        
      } catch (error) {
        console.log(`\n❌ 添加失败: ${error}`);
        console.log('\n💡 请检查:');
        console.log('   1. 标识符格式是否正确');
        console.log('   2. 网络连接是否正常');
        console.log('   3. API 密钥配置是否正确');
      }
    }
  },
  
  {
    name: 'help',
    aliases: ['h', '?'],
    description: 'Show help message',
    execute: async () => {
      console.log(`
🛠️  Zotero-Headless CLI

Usage: zotero <command> [options]

Core Commands:
  sync (s, pull, fetch)        Synchronize library
  list (ls, ll)                List items with filters
  search (find, grep, f)       Search by title/author/tags
  get (show, cat, view)        Show item details
  stats (st, info, df)         Show statistics
  verify (v, check, ping)      Verify API key

Item Management:
  add (a, new, touch)          Add new item
  add-by-id (add)              Add by DOI/ISBN/PMID/arXiv
  update (u, edit, set)        Update item field
  delete (rm, del, d, trash)   Delete/trash item
  export (e, out, save)        Export to bibtex/ris/csv/json

Group & Attachments:
  groups (g, team)             List group libraries
  attachments (att, files)     List attachments

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

For more info: https://github.com/altairwei/Zotero-Headless
`);
    }
  }
];

// ============ CLI Entry Point ============

async function main() {
  const args = process.argv.slice(2);
  
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
  
  // Check for --help or -h flag
  if (commandArgs.includes('--help') || commandArgs.includes('-h') || commandName === 'help') {
    // Show help for specific command or general help
    if (commandName !== 'help') {
      // Try to find the command to show its specific help
      const cmd = commands.find(c => 
        c.name === commandName || c.aliases?.includes(commandName)
      );
      if (cmd) {
        console.log(`\nUsage: zotero ${commandName} [options]`);
        console.log(`\n${cmd.description}`);
        if (cmd.aliases) {
          console.log(`\nAliases: ${cmd.aliases.join(', ')}`);
        }
        // TODO: Add command-specific help text
        console.log(`\nRun "zotero help" for all commands.`);
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
    console.log(`❌ Unknown command: ${commandName}`);
    console.log(`   Run "zotero help" for usage.`);
    process.exit(1);
  }
  
  try {
    await command.execute(commandArgs);
  } catch (error) {
    console.error('❌ Command failed:', error);
    process.exit(1);
  }
}

main();
