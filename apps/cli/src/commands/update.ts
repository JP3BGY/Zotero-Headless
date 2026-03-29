// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getDb, getItems, getLibraries } from '../modules.js';
import { symbols } from '@zotero-headless/core';
import { eq, and, like } from 'drizzle-orm';
import { parseItemData, updateItemData, extractDenormalizedColumns } from '@zotero-headless/types';

// Alias-to-subcommand mapping
const UPDATE_ALIAS_MAP: Record<string, string> = {
  'update-by-id': 'byid',
  'updateby': 'byid',
  'enrich': 'byid',
};

async function executeUpdateById(args: string[]) {
  await initModules();

  const db = getDb()();
  const items = getItems();
  const libraries = getLibraries();
  const library = await db.select().from(libraries).get();

  if (!library) {
    console.log(`${symbols.error} No library found. Run "sync" first.`);
    return;
  }

  // Parse options
  const dryRun = args.includes('--dry-run') || args.includes('-n');
  const force = args.includes('--force') || args.includes('-f');
  const overwrite = args.includes('--overwrite');
  const all = args.includes('--all') || args.includes('-a');
  const otherArgs = args.filter(a => !a.startsWith('-'));

  if (!all && otherArgs.length === 0) {
    console.log(`
${symbols.error} 请提供条目 key 或 --all

用法:
  zotero update byid <key>             更新指定条目
  zotero update byid <key1> <key2>     更新多个条目
  zotero update byid --all             更新所有缺失元数据的条目

选项:
  -a, --all        更新所有缺失元数据的条目
  -n, --dry-run    仅显示将要更新的条目
  -f, --force      即使 publication 字段非空也重新获取
  --overwrite      用获取的数据覆盖已有非空字段

示例:
  zotero update byid 465AIA2A
  zotero update byid --all --dry-run
  zotero update byid --all --force --overwrite
`);
    return;
  }

  // Get target items
  const allCandidates = await db.select().from(items)
    .where(and(eq(items.libraryId, library.id), eq(items.deleted, false)))
    .all();

  const nonChildItems = allCandidates.filter(item =>
    item.itemType !== 'attachment' && item.itemType !== 'note'
  );

  let targets: typeof nonChildItems;

  if (all) {
    // Filter to items with DOI or ISBN that have missing publication fields
    targets = nonChildItems.filter(item => {
      const data = parseItemData(item.rawJson);
      const hasDoi = data.DOI && String(data.DOI).startsWith('10.');
      const hasIsbn = data.ISBN && String(data.ISBN).length > 5;
      if (!hasDoi && !hasIsbn) return false;
      if (force) return true;

      // Check if publication-specific fields are mostly empty
      const fields = [
        data.publicationTitle || '', data.volume || '', data.issue || '',
        data.pages || '', data.publisher || '', data.journalAbbreviation || '',
      ];
      const emptyCount = fields.filter(v => !v.trim()).length;
      return emptyCount >= 4;
    });
  } else {
    // Specific keys
    const keys = new Set(otherArgs);
    targets = nonChildItems.filter(item => keys.has(item.key));
    if (targets.length === 0) {
      console.log(`${symbols.error} No matching items found for: ${otherArgs.join(', ')}`);
      return;
    }
    // Check that they have identifiers
    const noId = targets.filter(item => {
      const data = parseItemData(item.rawJson);
      return !(data.DOI && String(data.DOI).startsWith('10.')) && !(data.ISBN && String(data.ISBN).length > 5);
    });
    if (noId.length > 0) {
      for (const item of noId) {
        console.log(`${symbols.error} ${item.key} has no DOI or ISBN, cannot fetch metadata`);
      }
      targets = targets.filter(item => !noId.some(n => n.key === item.key));
    }
  }

  if (targets.length === 0) {
    console.log('No items to update.');
    return;
  }

  console.log(`Found ${targets.length} item(s) to update\n`);

  if (dryRun) {
    for (const item of targets) {
      const data = parseItemData(item.rawJson);
      console.log(`  [${item.key}] ${(item.title || '').substring(0, 60)}`);
      console.log(`    DOI: ${data.DOI || '(none)'}  ISBN: ${data.ISBN || '(none)'}`);
    }
    console.log(`\n(--dry-run) No changes made.`);
    return;
  }

  // Import translator
  const { searchByIdentifier } = await import('@zotero-headless/translator');

  let updated = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < targets.length; i++) {
    const item = targets[i];
    const data = parseItemData(item.rawJson);
    const doi = data.DOI ? String(data.DOI) : null;
    const isbn = data.ISBN ? String(data.ISBN) : null;
    const progress = `[${i + 1}/${targets.length}]`;

    try {
      let freshItems: any[] = [];
      if (doi) freshItems = await searchByIdentifier({ DOI: doi });
      if (freshItems.length === 0 && isbn) freshItems = await searchByIdentifier({ ISBN: isbn });

      if (freshItems.length === 0) {
        console.log(`${progress} ${symbols.error} ${item.key} - no results for ${doi || isbn}`);
        failed++;
        continue;
      }

      const fresh = freshItems[0];

      // Parse existing rawJson
      let rawEnvelope: any;
      try { rawEnvelope = JSON.parse(item.rawJson); } catch { rawEnvelope = { data: {} }; }
      const existingData = rawEnvelope.data || rawEnvelope;

      // Fields that can be enriched from external sources
      const enrichFields = [
        'publicationTitle', 'volume', 'issue', 'pages', 'publisher',
        'journalAbbreviation', 'shortTitle', 'language', 'ISSN', 'ISBN',
        'place', 'series', 'seriesTitle', 'seriesText', 'edition',
        'numPages', 'bookTitle', 'conferenceName', 'proceedingsTitle',
        'encyclopediaTitle', 'dictionaryTitle', 'extra', 'abstractNote',
      ];

      let fieldsUpdated = 0;
      const changes: string[] = [];

      for (const field of enrichFields) {
        const existingVal = existingData[field];
        const freshVal = fresh[field];
        const existingEmpty = !existingVal || (typeof existingVal === 'string' && !existingVal.trim());
        const freshHasData = freshVal && String(freshVal).trim();

        if (freshHasData && (existingEmpty || overwrite)) {
          if (!existingEmpty && overwrite) {
            changes.push(`${field}: "${String(existingVal).substring(0, 30)}" → "${String(freshVal).substring(0, 30)}"`);
          } else if (existingEmpty) {
            changes.push(`${field}: "${String(freshVal).substring(0, 40)}"`);
          }
          existingData[field] = freshVal;
          fieldsUpdated++;
        }
      }

      // Also enrich creators if empty
      if ((!existingData.creators || (Array.isArray(existingData.creators) && existingData.creators.length === 0))
          && fresh.creators && fresh.creators.length > 0) {
        existingData.creators = fresh.creators;
        fieldsUpdated++;
        changes.push(`creators: ${fresh.creators.length} author(s)`);
      }

      if (fieldsUpdated === 0) {
        console.log(`${progress}    ${item.key} - already up to date`);
        skipped++;
        continue;
      }

      // Reconstruct rawJson
      rawEnvelope.data = existingData;
      const newRawJson = JSON.stringify(rawEnvelope);

      // Build denormalized column updates
      const denorm = extractDenormalizedColumns(existingData);
      const updates: any = {
        ...denorm,
        rawJson: newRawJson,
        synced: false,
        updatedAt: Math.floor(Date.now() / 1000),
      };

      await db.update(items).set(updates)
        .where(and(eq(items.key, item.key), eq(items.libraryId, library.id)))
        .run();

      console.log(`${progress} ${symbols.success} ${item.key} +${fieldsUpdated} fields  ${(item.title || '').substring(0, 45)}`);
      for (const c of changes.slice(0, 3)) {
        console.log(`       ${c}`);
      }
      if (changes.length > 3) console.log(`       ... and ${changes.length - 3} more`);
      updated++;

      // Rate limit between API calls
      if (i < targets.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (e: any) {
      console.log(`${progress} ${symbols.error} ${item.key} - ${e.message?.substring(0, 60) || e}`);
      failed++;
    }
  }

  console.log(`\nDone: ${updated} updated, ${skipped} skipped, ${failed} failed`);
  if (updated > 0) {
    console.log(`Run "zotero sync" to push changes to Zotero servers.`);
  }
}

export const updateCommands: Command[] = [
  {
    name: 'update',
    aliases: ['u', 'edit', 'set', 'mod', 'update-by-id', 'updateby', 'enrich'],
    description: 'Update an item. Subcommands: byid. Aliases: u, edit, set, mod',
    options: [
      { name: '--field', alias: '-f', description: 'Field to update', value: '<field>' },
      { name: '--value', alias: '-v', description: 'New value', value: '<value>' },
    ],
    examples: [
      'zotero update ABC123 title "New Title"',
      'zotero update byid ABC123',
      'zotero update byid --all',
    ],
    execute: async (args, invokedAs) => {
      // Handle 'byid' subcommand
      const subcommand = UPDATE_ALIAS_MAP[invokedAs || ''] || args[0];
      if (subcommand === 'byid') {
        const subArgs = UPDATE_ALIAS_MAP[invokedAs || ''] ? args : args.slice(1);
        return executeUpdateById(subArgs);
      }

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
        console.log('\n   Subcommands:');
        console.log('   byid <key> [--all]  Fetch metadata from DOI/ISBN to fill missing fields');
        process.exit(1);
      }

      try {
        const db = getDb()();
        const library = await db.select().from(getLibraries()).get();

        if (!library) {
          console.log(`${symbols.error} No library found. Run "sync" first.`);
          process.exit(1);
        }

        // Get current item
        const item = await db.select()
          .from(getItems())
          .where(and(eq(getItems().key, key), eq(getItems().libraryId, library.id)))
          .get();

        if (!item) {
          console.log(`${symbols.error} Item ${key} not found.`);
          process.exit(1);
        }

        // Map CLI field names to Zotero API field names
        const fieldMap: Record<string, string> = {
          'title': 'title',
          'date': 'date',
          'abstract': 'abstractNote',
          'url': 'url',
          'doi': 'DOI'
        };

        const apiField = fieldMap[field.toLowerCase()] || field;
        const oldValue = parseItemData(item.rawJson)[apiField];

        // Update local database only (do not call API)
        console.log(`   Updating ${key}: ${field} = "${value}"`);

        // Update the field and re-serialize
        const updatedRawJson = updateItemData(item.rawJson, (data) => {
          data[apiField] = value;
        });

        // Update local item: mark as unsynced and update rawJson
        await db.update(getItems())
          .set({
            synced: false,
            updatedAt: Math.floor(Date.now() / 1000),
            rawJson: updatedRawJson,
            // Also update the title field if that's what changed
            ...(apiField === 'title' ? { title: value } : {})
          })
          .where(and(eq(getItems().key, key), eq(getItems().libraryId, library.id)))
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
];
