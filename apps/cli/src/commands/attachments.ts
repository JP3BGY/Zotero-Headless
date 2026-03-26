// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getDb, getAttachmentManager, getLibraries } from '../modules.js';
import { symbols } from '@zotero-headless/core';

export const attachmentCommands: Command[] = [
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

      const db = getDb()();
      const libraries = getLibraries();
      const library = await db.select().from(libraries).get();

      if (!library) {
        console.log(`${symbols.error} No library found. Run "sync" first.`);
        return;
      }

      const attachmentList = await getAttachmentManager().listAttachments({
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
      const result = await getAttachmentManager().downloadFromWebDAV(args[0]);
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
      const result = await getAttachmentManager().openAttachment(args[0]);
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
      const result = await getAttachmentManager().findDuplicates();
      if (!result.success) { console.log(`${symbols.error} ${result.error}`); return; }
      console.log(`Found ${result.duplicates.length} duplicates`);
      if (args.includes('--delete')) {
        for (const g of result.duplicates) {
          await getAttachmentManager().removeDuplicates(g);
        }
        console.log(' Removed');
      }
    }
  },
];
