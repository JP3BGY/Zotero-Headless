#!/usr/bin/env node

// Zotero-Headless CLI
// See Zotero-Headless-Complete-Design.md Section 7

import { syncManager } from '@zotero-headless/sync-engine';
import { getDatabase, items, libraries } from '@zotero-headless/database';
import { zoteroApi } from '@zotero-headless/api';
import { appConfig } from '@zotero-headless/core';
import { eq, like, desc, count, and, isNull } from 'drizzle-orm';

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
    description: 'Synchronize Zotero library (two-way)',
    execute: async () => {
      console.log('🔄 Starting two-way sync...\n');
      const result = await syncManager.sync();
      
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
        console.log(`      Type: ${item.itemType} | Updated: ${item.updatedAt.toISOString().split('T')[0]}`);
        console.log();
      });
    }
  },
  
  {
    name: 'list:unsynced',
    aliases: ['lsu'],
    description: 'List unsynced items',
    execute: async () => {
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
      console.log(`   Created: ${item.createdAt.toISOString()}`);
      console.log(`   Updated: ${item.updatedAt.toISOString()}`);
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
      console.log(`   Last Sync: ${library.lastSyncAt?.toISOString() || 'Never'}`);
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
  help               Show this message

Examples:
  zotero sync              # Full two-way sync
  zotero list 50 0        # List first 50 items
  zotero search machine    # Search for "machine"
  zotero stats             # Show library stats
  zotero get ABCD1234     # Show item details
  zotero verify            # Check API key

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
