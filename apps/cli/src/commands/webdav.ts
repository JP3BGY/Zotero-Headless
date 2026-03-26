// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getDb, getAttachmentManager, getWebdavConfig } from '../modules.js';
import { symbols } from '@zotero-headless/core';

export const webdavCommands: Command[] = [
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
        const db = getDb()();
        const webdavConfigTable = getWebdavConfig();
        const existing = await db.select().from(webdavConfigTable).get();

        if (!existing) {
          console.log(`${symbols.error} WebDAV not configured`);
          console.log('   Run "zotero webdav:config <url> <username> <password>" first');
          return;
        }

        console.log('Updating WebDAV configuration...\n');
        const result = await getAttachmentManager().updateWebDAVConfig({
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

      const result = await getAttachmentManager().configureWebDAV({
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

      const result = await getAttachmentManager().syncAllToWebDAV({
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
      const db = getDb()();
      const webdavConfigTable = getWebdavConfig();
      const config = await db.select().from(webdavConfigTable).get();

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
      const init = await getAttachmentManager().initWebDAV();
      if (init.success) {
        console.log(`   ${symbols.success} Connection successful!`);
      } else {
        console.log(`   ${symbols.error} Connection failed: ${init.error}`);
      }
      console.log();
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

      const result = await getAttachmentManager().scanWebDAV();

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
];
