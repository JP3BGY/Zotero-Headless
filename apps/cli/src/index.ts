#!/usr/bin/env node

// Zotero-Headless CLI
// See Zotero-Headless-Complete-Design.md Section 7

import { syncManager } from '@zotero-headless/sync-engine';
import { getDatabase, items, libraries } from '@zotero-headless/database';
import { zoteroApi } from '@zotero-headless/api';
import { appConfig } from '@zotero-headless/core';
import { eq, like, desc, count, sql } from 'drizzle-orm';

// ============ CLI Commands ============

interface Command {
  name: string;
  description: string;
  aliases?: string[];
  execute: (args: string[]) => Promise<void>;
}

const commands: Command[] = [
  {
    name: 'sync',
    aliases: ['s'],
    description: 'Synchronize Zotero library',
    execute: async () => {
      console.log('🔄 Starting sync...\n');
      const result = await syncManager.sync();
      
      if (result.success) {
        console.log(`\n✅ Sync completed successfully!`);
        console.log(`   Items updated: ${result.updated}`);
        console.log(`   Items deleted: ${result.deleted}`);
      } else {
        console.log(`\n❌ Sync failed!`);
        result.errors.forEach(e => console.log(`   Error: ${e}`));
        process.exit(1);
      }
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
        console.log(`  [${item.key}] ${item.title?.substring(0, 60) || '(no title)'}`);
        console.log(`     Type: ${item.itemType} | Updated: ${item.updatedAt.toISOString().split('T')[0]}`);
        console.log();
      });
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
        .where(eq(items.deleted, true))
        .get();
      
      console.log('\n📊 Library Statistics:\n');
      console.log(`   Library: ${library.name || 'My Library'}`);
      console.log(`   Zotero ID: ${library.zoteroId}`);
      console.log(`   Version: ${library.version}`);
      console.log(`   Last Sync: ${library.lastSyncAt?.toISOString() || 'Never'}`);
      console.log(`   Total Items: ${totalResult?.count ?? 0}`);
      console.log(`   Deleted Items: ${deletedResult?.count ?? 0}`);
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
        console.log(`   Access:`, keyInfo.access);
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
    description: 'Show this help message',
    execute: async () => {
      console.log(`
🛠️  Zotero-Headless CLI

Usage: zotero <command> [options]

Commands:
  sync              Synchronize Zotero library (download from cloud)
  list [limit] [offset]  List items in library
  search <query>     Search items by title
  stats             Show library statistics
  verify            Verify API key
  help              Show this help message

Examples:
  zotero sync              # Sync all items
  zotero list 50 0        # List first 50 items
  zotero search machine    # Search for "machine"
  zotero stats             # Show library stats

For more info, see: https://github.com/altairwei/Zotero-Headless
`);
    }
  }
];

// ============ CLI Entry Point ============

async function main() {
  const args = process.argv.slice(2);
  const commandName = args[0]?.toLowerCase() || 'help';
  const commandArgs = args.slice(1);
  
  // Find command
  const command = commands.find(c => 
    c.name === commandName || c.aliases?.includes(commandName)
  );
  
  if (!command) {
    console.log(`❌ Unknown command: ${commandName}`);
    console.log(`   Run "zotero help" for usage information.`);
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
