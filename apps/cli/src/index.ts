#!/usr/bin/env node
// @ts-nocheck

// Zotero-Headless CLI
// See Zotero-Headless-Complete-Design.md Section 7

import { appConfig } from '@zotero-headless/core';
import { eq, like, desc, count, and, isNull } from 'drizzle-orm';

// Lazy-loaded modules (to avoid initialization on help commands)
let syncManager: any;
let getDatabase: any;
let items: any;
let libraries: any;
let zoteroApi: any;

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
  }
  if (!zoteroApi) {
    const apiMod = await import('@zotero-headless/api');
    zoteroApi = apiMod.zoteroApi;
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
    aliases: ['s'],
    description: 'Synchronize Zotero library (two-way). Use --full-sync to force complete re-sync',
    execute: async (args) => {
      await initModules();
      const fullSync = args.includes('--full-sync') || args.includes('-f');
      
      console.log('🔄 Starting two-way sync...');
      if (fullSync) {
        console.log('   (Full sync mode - ignoring version numbers)');
      }
      console.log('');
      
      const result = await syncManager.sync({ fullSync });
      
      if (result.success) {
        console.log(`\n✅ Sync completed successfully!`);
        console.log(`   Items updated: ${result.updated}`);
        console.log(`   Items deleted: ${result.deleted}`);
      } else {
        console.log(`\n⚠️  Sync completed with issues:`);
        result.errors.forEach(e => console.log(`   Error: ${e}`));
        if (result.conflicts) {
          console.log(`   Conflicts: ${result.conflicts.length}`);
          result.conflicts.forEach(c => console.log(`     - ${c}`));
        }
        process.exit(1);
      }
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
    aliases: ['ls'],
    description: 'List items in library',
    execute: async (args) => {
      await initModules();
      const db = getDatabase();
      const limit = parseInt(args[0]) || 20;
      const offset = parseInt(args[1]) || 0;
      
      const library = await db.select().from(libraries).get();
      if (!library) {
        console.log('❌ No library found. Run "sync" first.');
        return;
      }
      
      const results = await db.select()
        .from(items)
        .where(eq(items.libraryId, library.id))
        .orderBy(desc(items.updatedAt))
        .limit(limit)
        .offset(offset)
        .all();
      
      console.log(`\n📚 Items (${results.length} shown):\n`);
      results.forEach(item => {
        const syncStatus = item.synced ? '✅' : '🔄';
        const delStatus = item.deleted ? ' (deleted)' : '';
        console.log(`  ${syncStatus} [${item.key}] ${item.title?.substring(0, 60) || '(no title)'}${delStatus}`);
        console.log(`      Type: ${item.itemType} | Updated: ${formatDate(item.updatedAt)}`);
        console.log();
      });
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
    aliases: ['find'],
    description: 'Search items by title',
    execute: async (args) => {
      await initModules();
      if (args.length === 0) {
        console.log('❌ Please provide a search query');
        console.log('   Usage: zotero search <query>');
        return;
      }
      
      const db = getDatabase();
      const query = args.join(' ');
      const library = await db.select().from(libraries).get();
      
      if (!library) {
        console.log('❌ No library found. Run "sync" first.');
        return;
      }
      
      const results = await db.select()
        .from(items)
        .where(and(
          eq(items.libraryId, library.id),
          like(items.title, `%${query}%`)
        ))
        .limit(20)
        .all();
      
      console.log(`\n🔍 Search results for "${query}" (${results.length}):\n`);
      results.forEach(item => {
        console.log(`  [${item.key}] ${item.title?.substring(0, 70) || '(no title)'}`);
      });
      
      if (results.length === 0) {
        console.log('   No results found.');
      }
    }
  },
  
  {
    name: 'get',
    aliases: ['show'],
    description: 'Get single item details',
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
    aliases: ['st'],
    description: 'Show library statistics',
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
    aliases: ['v'],
    description: 'Verify API key',
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
  
  {
    name: 'add',
    aliases: ['a'],
    description: 'Add a new item to library',
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
    aliases: ['u'],
    description: 'Update an existing item (local only, run sync to upload)',
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
    aliases: ['d', 'del'],
    description: 'Delete (trash) an item (local only, run sync to upload)',
    execute: async (args) => {
      await initModules();
      console.log('🗑️  Deleting item locally...\n');
      
      const key = args[0];
      const permanent = args.includes('--permanent') || args.includes('-p');
      
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
    aliases: ['e'],
    description: 'Export items to various formats',
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

Commands:
  sync              Synchronize library (two-way)
  sync:upload        Upload local changes only
  list [limit]       List items
  list:unsynced      List unsynced items
  search <query>     Search by title
  get <key>          Get item details
  stats              Show statistics
  verify             Verify API key
  add <type> <title> [authors...]  Add new item
  add-by-id <id>     Add item by identifier (DOI, ISBN, PMID, arXiv)
  update <key> <field> <value>      Update item
  delete <key> [--permanent]         Delete (trash) item
  export [format] [file] Export items (bibtex, ris, csv, json)
  help               Show this message

Examples:
  zotero sync              # Full two-way sync
  zotero list 50 0        # List first 50 items
  zotero search machine    # Search for "machine"
  zotero stats             # Show library stats
  zotero get ABCD1234     # Show item details
  zotero verify            # Check API key
  zotero add journalArticle "My Article" "John Doe"  # Add new article
  zotero add-by-id "10.1007/s11263-019-01228-7"  # Add by DOI
  zotero add-by-id "978-3-642-15515-4"  # Add by ISBN
  zotero add-by-id "10.1007/xyz, 978-3-642-15515-4"  # Batch add
  zotero update ABCD1234 title "New Title"  # Update item title
  zotero delete ABCD1234   # Move item to trash
  zotero delete ABCD1234 --permanent  # Permanently delete
  zotero export bibtex     # Export as BibTeX
  zotero export ris refs.ris # Export RIS to file

For more info: https://github.com/altairwei/Zotero-Headless
`);
    }
  }
];

// ============ CLI Entry Point ============

async function main() {
  const args = process.argv.slice(2);
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
