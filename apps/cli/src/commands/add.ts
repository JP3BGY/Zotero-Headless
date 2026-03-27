// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getDb, getItems, getLibraries, getAttachments } from '../modules.js';
import { symbols } from '@zotero-headless/core';
import { generateKey, getContentType } from '../utils.js';
import { executeAddById } from './add-by-id.js';

// Alias-to-subcommand mapping for backward compatibility
const ADD_ALIAS_MAP: Record<string, string> = {
  'add-by-id': 'byid',
  'addby': 'byid',
};

export const addCommands: Command[] = [
  {
    name: 'add',
    aliases: ['a', 'new', 'touch', 'create', 'add-by-id', 'addby'],
    description: 'Add a new item. Subcommands: byid. Aliases: a, new, touch, create',
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
    execute: async (args, invokedAs) => {
      // Handle 'byid' subcommand (also via add-by-id / addby aliases)
      const subcommand = ADD_ALIAS_MAP[invokedAs || ''] || args[0];
      if (subcommand === 'byid') {
        const subArgs = ADD_ALIAS_MAP[invokedAs || ''] ? args : args.slice(1);
        return executeAddById(subArgs);
      }

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
        const library = await getDb()().select().from(getLibraries()).get();
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
        await getDb()().insert(getItems()).values({
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
            await getDb()().insert(getAttachments()).values({
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
];
