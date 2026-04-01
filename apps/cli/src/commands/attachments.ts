// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getDb, getAttachmentManager, getFullTextFinder, getLibraries, getItems, getAttachments } from '../modules.js';
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
  'find-fulltext': 'find',
  'findpdf': 'find',
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

async function executeAttachmentFind(args: string[]) {
  await initModules();

  const options = {
    keys: [] as string[],
    all: false,
    methods: undefined as string[] | undefined,
    dryRun: false,
    limit: 50,
  };

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--all' || arg === '-a') {
      options.all = true;
    } else if ((arg === '--methods' || arg === '-m') && args[i + 1]) {
      options.methods = args[++i].split(',').map(m => m.trim());
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if ((arg === '--limit' || arg === '-l') && args[i + 1]) {
      options.limit = parseInt(args[++i]) || 50;
    } else if (!arg.startsWith('-')) {
      options.keys.push(arg);
    }
  }

  if (options.keys.length === 0 && !options.all) {
    console.log('Usage: zotero attachment find <key...>');
    console.log('       zotero attachment find --all [--limit N]');
    console.log('');
    console.log('Options:');
    console.log('  --all, -a              Find full text for all eligible items');
    console.log('  --methods, -m <list>   Resolver methods: doi,oa,url,custom (default: all)');
    console.log('  --limit, -l <N>        Max items to process (default: 50)');
    console.log('  --dry-run              Show eligible items without downloading');
    return;
  }

  const db = getDb()();
  const libTable = getLibraries();
  const itemsTable = getItems();
  const library = await db.select().from(libTable).get();

  if (!library) {
    console.log(`${symbols.error} No library found. Run "sync" first.`);
    return;
  }

  const finder = getFullTextFinder();
  let itemRecords: any[];

  if (options.all) {
    // Find all eligible items
    itemRecords = await finder.getEligibleItems(library.id, options.limit);
    console.log(`\nFound ${itemRecords.length} items eligible for full text finding.\n`);
  } else {
    // Look up specific items by key
    const { eq, and } = await import('drizzle-orm');
    itemRecords = [];
    for (const key of options.keys) {
      const item = await db.select().from(itemsTable)
        .where(and(eq(itemsTable.key, key), eq(itemsTable.libraryId, library.id)))
        .get();
      if (item) {
        itemRecords.push(item);
      } else {
        console.log(`${symbols.warning} Item ${key} not found.`);
      }
    }
    if (itemRecords.length === 0) return;
    console.log(`\nProcessing ${itemRecords.length} item(s)...\n`);
  }

  if (options.dryRun) {
    console.log('Dry run - showing eligible items:\n');
    for (const item of itemRecords) {
      const title = (item.title || '(untitled)').substring(0, 60);
      const doi = item.doi ? `DOI: ${item.doi}` : '';
      const url = item.url ? `URL: ${item.url.substring(0, 40)}...` : '';
      console.log(`  [${item.key}] ${title}`);
      if (doi) console.log(`    ${doi}`);
      if (url) console.log(`    ${url}`);
    }
    console.log(`\n${itemRecords.length} item(s) would be processed.`);
    return;
  }

  // Load custom resolvers from config if available
  let customResolvers;
  try {
    const { configManager } = await import('@zotero-headless/core');
    const fulltextConfig = configManager.get('fulltext');
    customResolvers = fulltextConfig?.resolvers;
  } catch { /* no config */ }

  const result = await finder.findForItems(itemRecords, {
    methods: options.methods as any,
    customResolvers,
    dryRun: false,
    onProgress: (current, total, title) => {
      const truncTitle = title.substring(0, 50);
      process.stdout.write(`\r  [${current}/${total}] ${truncTitle}...`.padEnd(80));
    },
    onItemResult: (key, res) => {
      process.stdout.write('\r' + ' '.repeat(80) + '\r');
      if (res.success) {
        console.log(`  ${symbols.success} [${key}] ${res.filename} (${res.accessMethod}, ${((res.fileSize || 0) / 1024).toFixed(0)} KB)`);
      } else {
        console.log(`  ${symbols.error} [${key}] ${res.error}`);
      }
    },
  });

  console.log(`\nResults: ${result.found} found, ${result.failed} failed, ${result.skipped} skipped.`);

  if (result.found > 0) {
    console.log(`\nRun "zotero sync" to upload items, then "zotero webdav sync" to upload files.`);
  }
}

async function executeAttachmentRead(args: string[]) {
  if (!args[0]) {
    console.log('Usage: zotero attachment read <key> [--format markdown|text] [--max-length N]');
    console.log('       zotero attachment read <key> --render [--pages 1,2,3] [--scale 2] [--output-dir ./out]');
    return;
  }

  await initModules();

  const key = args[0];
  let format: 'markdown' | 'text' | undefined;
  let maxLength: number | undefined;
  let render = false;
  let pages: number[] | undefined;
  let scale: number | undefined;
  let outputDir: string | undefined;
  let imageFormat: 'png' | 'jpeg' | undefined;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--format' && args[i + 1]) {
      const val = args[++i];
      if (val === 'markdown' || val === 'text') format = val;
    } else if (arg === '--max-length' && args[i + 1]) {
      maxLength = parseInt(args[++i]) || undefined;
    } else if (arg === '--render') {
      render = true;
    } else if (arg === '--pages' && args[i + 1]) {
      pages = args[++i].split(',').map(p => parseInt(p.trim())).filter(p => !isNaN(p));
    } else if (arg === '--scale' && args[i + 1]) {
      scale = parseFloat(args[++i]) || undefined;
    } else if (arg === '--output-dir' && args[i + 1]) {
      outputDir = args[++i];
    } else if (arg === '--image-format' && args[i + 1]) {
      const val = args[++i];
      if (val === 'png' || val === 'jpeg') imageFormat = val;
    }
  }

  try {
    const { ContentExtractor } = await import('@zotero-headless/content-extractor');
    const extractor = new ContentExtractor();

    if (render) {
      const fs = await import('fs');
      const path = await import('path');
      const renderedPages = await extractor.renderPages(key, { pages, scale, imageFormat });

      // Determine output directory
      const dir = outputDir || process.cwd();
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      for (const page of renderedPages) {
        const filename = `${key}_page${page.pageNumber}.${page.imageFormat}`;
        const filePath = path.join(dir, filename);
        fs.writeFileSync(filePath, page.data);
        console.log(`${symbols.success} ${filePath} (${page.width}x${page.height})`);
      }
      console.log(`\nRendered ${renderedPages.length} page(s)`);
    } else {
      const result = await extractor.extract(key, { format, maxLength });
      process.stdout.write(result.text);
      if (!result.text.endsWith('\n')) process.stdout.write('\n');
    }
  } catch (error: any) {
    console.error(`${symbols.error} ${error.message}`);
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
      'find-fulltext', 'findpdf',
    ],
    description: 'Attachment management. Subcommands: list (default), download, open, dedup, find, read',
    options: [
      { name: '--item', description: 'Filter by parent item key (list subcommand)', value: '<key>' },
      { name: '--limit', alias: '-l', description: 'Limit results', value: '<N>' },
      { name: '--force', alias: '-f', description: 'Overwrite existing file (download subcommand)' },
      { name: '--wait', alias: '-w', description: 'Wait for application to close (open subcommand)' },
      { name: '--delete', alias: '-d', description: 'Delete duplicates (dedup subcommand)' },
      { name: '--dry-run', description: 'Preview without action (find/dedup subcommands)' },
      { name: '--all', alias: '-a', description: 'Process all eligible items (find subcommand)' },
      { name: '--methods', alias: '-m', description: 'Resolver methods: doi,oa,url,custom (find subcommand)', value: '<list>' },
    ],
    examples: [
      'zotero attachment list',
      'zotero attachment list --item ABC123',
      'zotero attachment download ABC123',
      'zotero attachment open ABC123',
      'zotero attachment dedup',
      'zotero attachment find ABC123',
      'zotero attachment find --all --limit 10',
      'zotero attachment find --all --dry-run',
      'zotero attachment find ABC123 --methods oa,doi',
      'zotero attachment read ABC123',
      'zotero attachment read ABC123 --format markdown',
      'zotero attachment read ABC123 --max-length 50000',
      'zotero attachment read ABC123 --render',
      'zotero attachment read ABC123 --render --pages 1,2,3',
      'zotero attachment read ABC123 --render --scale 3 --output-dir ./images',
    ],
    execute: async (args, invokedAs) => {
      // Resolve subcommand from alias or first arg
      let subcommand = ATTACHMENT_ALIAS_MAP[invokedAs || ''];
      let subArgs: string[];

      if (subcommand) {
        subArgs = args;
      } else {
        const validSubs = ['list', 'download', 'open', 'dedup', 'find', 'read'];
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
        case 'find':
          return executeAttachmentFind(subArgs);
        case 'read':
          return executeAttachmentRead(subArgs);
      }
    }
  },
];
