// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getDb, getAttachmentManager, getLibraries } from '../modules.js';
import { symbols } from '@zotero-headless/core';

// Alias-to-subcommand mapping for backward compatibility
const ATTACHMENT_ALIAS_MAP: Record<string, string> = {
  'attachments': 'list',
  'att': 'list',
  'files': 'list',
  'docs': 'list',
  'attachment-download': 'download',
  'attdl': 'download',
  'down': 'download',
  'attachment-open': 'open',
  'atto': 'open',
  'open': 'open',
  'attachment-dedup': 'dedup',
  'attdedup': 'dedup',
  'dedup': 'dedup',
};

async function executeAttachmentList(args: string[]) {
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

async function executeAttachmentDownload(args: string[]) {
  await initModules();
  if (!args[0]) { console.log('Usage: zotero attachment download <key>'); return; }
  const result = await getAttachmentManager().downloadFromWebDAV(args[0]);
  console.log(result.success ? `${symbols.success} Downloaded to ${result.localPath}` : `${symbols.error} ${result.error}`);
}

async function executeAttachmentOpen(args: string[]) {
  await initModules();
  if (!args[0]) { console.log('Usage: zotero attachment open <key>'); return; }
  const result = await getAttachmentManager().openAttachment(args[0]);
  console.log(result.success ? `${symbols.success} Opened` : `${symbols.error} ${result.error}`);
}

async function executeAttachmentDedup(args: string[]) {
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

export const attachmentCommands: Command[] = [
  {
    name: 'attachment',
    aliases: [
      'attachments', 'att', 'files', 'docs',
      'attachment-download', 'attdl', 'down',
      'attachment-open', 'atto',
      'attachment-dedup', 'attdedup',
    ],
    description: 'Attachment management. Subcommands: list (default), download, open, dedup',
    options: [
      { name: '--item', description: 'Filter by parent item key (list subcommand)', value: '<key>' },
      { name: '--limit', alias: '-l', description: 'Limit results (list subcommand)', value: '<N>' },
      { name: '--force', alias: '-f', description: 'Overwrite existing file (download subcommand)' },
      { name: '--wait', alias: '-w', description: 'Wait for application to close (open subcommand)' },
      { name: '--delete', alias: '-d', description: 'Delete duplicates (dedup subcommand)' },
      { name: '--dry-run', description: 'Show duplicates without deleting (dedup subcommand)' },
    ],
    examples: [
      'zotero attachment list',
      'zotero attachment list --item ABC123',
      'zotero attachment download ABC123',
      'zotero attachment open ABC123',
      'zotero attachment dedup',
    ],
    execute: async (args, invokedAs) => {
      // Resolve subcommand from alias or first arg
      let subcommand = ATTACHMENT_ALIAS_MAP[invokedAs || ''];
      let subArgs: string[];

      if (subcommand) {
        subArgs = args;
      } else {
        const validSubs = ['list', 'download', 'open', 'dedup'];
        if (validSubs.includes(args[0])) {
          subcommand = args[0];
          subArgs = args.slice(1);
        } else {
          // Default: list
          subcommand = 'list';
          subArgs = args;
        }
      }

      switch (subcommand) {
        case 'list':
          return executeAttachmentList(subArgs);
        case 'download':
          return executeAttachmentDownload(subArgs);
        case 'open':
          return executeAttachmentOpen(subArgs);
        case 'dedup':
          return executeAttachmentDedup(subArgs);
      }
    }
  },
];
