// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getDb, getItems, getLibraries, getAttachments, getCollections } from '../modules.js';
import { symbols, appConfig } from '@zotero-headless/core';
import { generateKey, resolveCollectionPath, getContentType } from '../utils.js';
import { extractDenormalizedColumns } from '@zotero-headless/types';
import { importFromFile, importFromString } from '@zotero-headless/translator';
import type { TranslatedCollection } from '@zotero-headless/translator';
import { and, eq } from 'drizzle-orm';
import { ProgressBar } from '../progress-bar.js';

export const importCommands: Command[] = [
  {
    name: 'import',
    aliases: ['imp', 'in'],
    description: 'Import items from BibTeX, CSL JSON, RIS, Zotero RDF, and other formats. Aliases: imp, in',
    options: [
      { name: '--format', alias: '-f', description: 'Translator label (e.g. BibTeX, RIS, "CSL JSON", "Zotero RDF"). Auto-detected from extension', value: '<format>' },
      { name: '--collection', alias: '-c', description: 'Add imported items to collection (key or path)', value: '<key|path>' },
      { name: '--tag', alias: '-t', description: 'Add tag to all imported items (repeatable)', value: '<tag>' },
      { name: '--skip-duplicates', description: 'Skip items with same DOI or ISBN already in library' },
      { name: '--dry-run', alias: '-n', description: 'Parse and show items without importing' },
    ],
    examples: [
      'zotero import references.bib',
      'zotero import data.json --format "CSL JSON"',
      'zotero import refs.ris -c /My\\ Collection',
      'zotero import refs.bib -t "imported" -t "review"',
      'zotero import refs.bib --skip-duplicates --dry-run',
      'zotero import export.rdf --format "Zotero RDF"',
    ],
    execute: async (args) => {
      const fs = await import('fs');
      const path = await import('path');

      // Parse arguments
      let filePath = '';
      let formatFlag: string | undefined;
      let collectionRef: string | undefined;
      const userTags: string[] = [];
      let skipDuplicates = false;
      let dryRun = false;

      function consumeValue(flag: string, i: number): string {
        const next = args[i + 1];
        if (next === undefined || next.startsWith('-')) {
          console.log(`${symbols.error} Option ${flag} requires a value`);
          process.exit(1);
        }
        return next;
      }

      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--format' || arg === '-f') {
          formatFlag = consumeValue(arg, i); i++;
        } else if (arg === '--collection' || arg === '-c') {
          collectionRef = consumeValue(arg, i); i++;
        } else if (arg === '--tag' || arg === '-t') {
          userTags.push(consumeValue(arg, i)); i++;
        } else if (arg === '--skip-duplicates') {
          skipDuplicates = true;
        } else if (arg === '--dry-run' || arg === '-n') {
          dryRun = true;
        } else if (!arg.startsWith('-') && !filePath) {
          filePath = arg;
        }
      }

      if (!filePath) {
        console.log(`${symbols.error} Usage: zotero import <file> [options]`);
        console.log('');
        console.log('  Supported formats: BibTeX (.bib), CSL JSON (.json), RIS (.ris), Zotero RDF (.rdf), and 700+ others');
        console.log('');
        console.log('  Options:');
        console.log('    -f, --format <format>       Translator label (e.g. BibTeX, RIS, "CSL JSON")');
        console.log('    -c, --collection <key|path>  Add to collection');
        console.log('    -t, --tag <tag>              Add tag (repeatable)');
        console.log('    --skip-duplicates            Skip items with same DOI/ISBN');
        console.log('    -n, --dry-run                Parse only, do not import');
        console.log('');
        console.log('  Examples:');
        console.log('    zotero import references.bib');
        console.log('    zotero import data.json -f "CSL JSON" -t "imported"');
        console.log('    zotero import refs.ris -c /Research --skip-duplicates');
        process.exit(1);
      }

      // Resolve and validate file
      const resolvedPath = path.resolve(filePath);
      if (!fs.existsSync(resolvedPath)) {
        console.log(`${symbols.error} File not found: ${resolvedPath}`);
        process.exit(1);
      }

      const content = fs.readFileSync(resolvedPath, 'utf-8');
      if (!content.trim()) {
        console.log(`${symbols.error} File is empty: ${resolvedPath}`);
        process.exit(1);
      }

      // Parse using Zotero translator framework
      let translatedItems: any[];
      let translatedCollections: TranslatedCollection[] = [];
      try {
        if (formatFlag) {
          const result = await importFromString(content, formatFlag);
          translatedItems = result.items;
          translatedCollections = result.collections;
        } else {
          const result = await importFromFile(resolvedPath);
          translatedItems = result.items;
          translatedCollections = result.collections;
        }
      } catch (err: any) {
        console.log(`${symbols.error} Failed to parse file: ${err.message || err}`);
        process.exit(1);
      }

      if (translatedItems.length === 0) {
        console.log(`${symbols.warning} No items found in file.`);
        return;
      }

      const colMsg = translatedCollections.length > 0
        ? ` and ${translatedCollections.length} collection(s)` : '';
      console.log(`Parsed ${translatedItems.length} item(s)${colMsg} from ${path.basename(resolvedPath)}\n`);

      // Dry run: just show parsed items
      if (dryRun) {
        let totalAttachments = 0;
        for (let i = 0; i < translatedItems.length; i++) {
          const item = translatedItems[i];
          const creators = (item.creators || []).map((c: any) =>
            c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim()
          ).join(', ');
          console.log(`  ${i + 1}. [${item.itemType}] ${item.title || '(no title)'}`);
          if (creators) console.log(`     Authors: ${creators}`);
          if (item.date) console.log(`     Date: ${item.date}`);
          if (item.DOI) console.log(`     DOI: ${item.DOI}`);
          if (item.ISBN) console.log(`     ISBN: ${item.ISBN}`);
          if (item.attachments?.length > 0) {
            totalAttachments += item.attachments.length;
            for (const att of item.attachments) {
              const attPath = att.path ? path.resolve(path.dirname(resolvedPath), att.path) : null;
              const exists = attPath && fs.existsSync(attPath);
              const marker = exists ? symbols.success : symbols.warning;
              console.log(`     ${marker} ${att.title || att.path || '(attachment)'}${!exists && attPath ? ' (file missing)' : ''}`);
            }
          }
        }
        if (translatedCollections.length > 0) {
          console.log(`\n  Collections:`);
          function printCollection(col: TranslatedCollection, indent: string) {
            const itemCount = col.children.filter(c => c.type === 'item').length;
            const subCols = col.children.filter(c => c.type === 'collection') as TranslatedCollection[];
            console.log(`${indent}${symbols.success} ${col.name} (${itemCount} items)`);
            for (const sub of subCols) printCollection(sub, indent + '  ');
          }
          for (const col of translatedCollections) printCollection(col, '    ');
        }
        console.log(`\n${symbols.success} Dry run complete. ${translatedItems.length} item(s), ${totalAttachments} attachment(s), ${translatedCollections.length} collection(s) would be imported.`);
        return;
      }

      // Initialize database
      await initModules();
      const db = getDb()();
      const items = getItems();
      const libraries = getLibraries();
      const attachmentsTbl = getAttachments();

      const library = await db.select().from(libraries).get();
      if (!library) {
        console.log(`${symbols.error} No library found. Run "sync" first.`);
        process.exit(1);
      }

      // Resolve collection if specified
      let collectionKey: string | undefined;
      if (collectionRef) {
        const resolved = await resolveCollectionPath(db, library.id, collectionRef);
        if (!resolved) {
          console.log(`${symbols.error} Collection not found: ${collectionRef}`);
          process.exit(1);
        }
        collectionKey = resolved.key;
        console.log(`Target collection: ${resolved.path} (${resolved.key})`);
      }

      // Load existing DOIs/ISBNs for duplicate detection
      // Also map DOI/ISBN -> existing key so skipped items can still be linked to collections
      let existingDois = new Map<string, string>();  // lowercase DOI -> itemKey
      let existingIsbns = new Map<string, string>(); // normalized ISBN -> itemKey
      if (skipDuplicates) {
        const allItems = await db.select({ key: items.key, doi: items.doi, isbn: items.isbn })
          .from(items)
          .where(and(eq(items.libraryId, library.id), eq(items.deleted, false)));
        for (const item of allItems) {
          if (item.doi) existingDois.set(item.doi.toLowerCase(), item.key);
          if (item.isbn) existingIsbns.set(item.isbn.replace(/[-\s]/g, ''), item.key);
        }
      }

      // Import items
      let imported = 0;
      let skipped = 0;
      let failed = 0;
      let attachmentsImported = 0;
      let attachmentsFailed = 0;
      const now = Math.floor(Date.now() / 1000);

      // Resolve the base directory of the source file (for relative attachment paths)
      const sourceDir = path.dirname(resolvedPath);
      // Storage directory for imported attachments
      const storageDir = path.join(appConfig.dataDir, 'storage');

      // Map from translator itemID -> assigned DB key (for collection linking)
      const itemIdToKey = new Map<string, string>();

      // Count total attachments for progress
      const totalAttachments = translatedItems.reduce(
        (sum, item) => sum + (item.attachments?.filter((a: any) => a.path)?.length || 0), 0
      );
      const progress = new ProgressBar({
        total: translatedItems.length + totalAttachments,
        label: 'Importing items...',
      });

      for (const translatedItem of translatedItems) {
        try {
          // Translator items are already in Zotero format — use directly
          const zoteroData = { ...translatedItem };
          const itemAttachments = zoteroData.attachments || [];

          // Remove framework-internal fields not needed in DB
          delete zoteroData.itemID;
          delete zoteroData.seeAlso;
          delete zoteroData.attachments;

          // Check for duplicates — still record itemID mapping for collection linking
          if (skipDuplicates) {
            const doiKey = zoteroData.DOI && existingDois.get(zoteroData.DOI.toLowerCase());
            const isbnKey = zoteroData.ISBN && existingIsbns.get(zoteroData.ISBN.replace(/[-\s]/g, ''));
            const existingKey = doiKey || isbnKey;
            if (existingKey) {
              if (translatedItem.itemID) {
                itemIdToKey.set(translatedItem.itemID, existingKey);
              }
              skipped++;
              progress.increment();
              continue;
            }
          }

          // Apply user tags
          if (userTags.length > 0) {
            const existingTags = zoteroData.tags || [];
            zoteroData.tags = [
              ...existingTags,
              ...userTags.map(t => ({ tag: t, type: 0 })),
            ];
          }

          // Apply collection
          if (collectionKey) {
            zoteroData.collections = [...(zoteroData.collections || []), collectionKey];
          }

          // Generate key and prepare DB record
          const itemKey = generateKey();
          const denormalized = extractDenormalizedColumns(zoteroData);

          await db.insert(items).values({
            key: itemKey,
            libraryId: library.id,
            version: 0,
            synced: false,
            deleted: false,
            createdAt: now,
            updatedAt: now,
            ...denormalized,
            rawJson: JSON.stringify({ data: zoteroData }),
          }).run();

          imported++;
          if (translatedItem.itemID) {
            itemIdToKey.set(translatedItem.itemID, itemKey);
          }
          const title = (zoteroData.title || '').substring(0, 40);
          progress.increment(title);

          // Process attachments (PDF, HTML snapshots, etc.)
          for (const att of itemAttachments) {
            try {
              if (!att.path) continue;

              const srcPath = path.resolve(sourceDir, att.path);
              if (!fs.existsSync(srcPath)) {
                progress.increment();
                continue;
              }

              const attKey = generateKey();
              const filename = path.basename(srcPath);
              const contentType = att.mimeType || getContentType(filename);

              // Create Zotero-style storage: storage/<key>/<filename>
              const attStorageDir = path.join(storageDir, attKey);
              fs.mkdirSync(attStorageDir, { recursive: true });
              const destPath = path.join(attStorageDir, filename);
              fs.copyFileSync(srcPath, destPath);

              const stats = fs.statSync(destPath);
              const linkMode = att.linkMode === '1' || att.linkMode === 1
                ? 'imported_url' : 'imported_file';

              const attRawJson = {
                data: {
                  key: attKey,
                  itemType: 'attachment',
                  title: att.title || filename,
                  filename: filename,
                  contentType: contentType,
                  charset: att.charset || '',
                  parentItem: itemKey,
                  linkMode: linkMode,
                  url: att.url || '',
                  accessDate: att.accessDate || att.date || '',
                }
              };

              await db.insert(attachmentsTbl).values({
                key: attKey,
                parentItemKey: itemKey,
                libraryId: library.id,
                filename: filename,
                contentType: contentType,
                fileType: path.extname(filename).toLowerCase(),
                path: destPath,
                url: att.url || null,
                version: 0,
                createdAt: now,
                updatedAt: now,
                deleted: false,
                size: stats.size,
                webdavSynced: false,
                rawJson: JSON.stringify(attRawJson),
              }).run();

              attachmentsImported++;
              progress.increment(filename);
            } catch (attErr: any) {
              attachmentsFailed++;
              progress.increment();
            }
          }

          // Track newly added DOI/ISBN for intra-file dedup
          if (skipDuplicates) {
            if (zoteroData.DOI) existingDois.set(zoteroData.DOI.toLowerCase(), itemKey);
            if (zoteroData.ISBN) existingIsbns.set(zoteroData.ISBN.replace(/[-\s]/g, ''), itemKey);
          }
        } catch (err: any) {
          failed++;
          progress.increment();
          const title = translatedItem.title || '(unknown)';
          console.log(`\n${symbols.error} Failed to import "${title}": ${err.message || err}`);
        }
      }
      progress.complete();

      // Create collections and link items
      let collectionsCreated = 0;
      if (translatedCollections.length > 0 && imported > 0) {
        const collectionsTbl = getCollections();

        function createCollection(
          col: TranslatedCollection,
          parentCollectionKey: string | null,
        ): void {
          const colKey = generateKey();
          const childItemKeys: string[] = [];
          const now = Math.floor(Date.now() / 1000);

          // Resolve child items
          for (const child of col.children) {
            if (child.type === 'item') {
              const itemKey = itemIdToKey.get(child.id);
              if (itemKey) childItemKeys.push(itemKey);
            }
          }

          // Insert collection record
          db.insert(collectionsTbl).values({
            key: colKey,
            libraryId: library.id,
            name: col.name,
            parentKey: parentCollectionKey || collectionKey || null,
            version: 0,
            createdAt: now,
            updatedAt: now,
            deleted: false,
            rawJson: JSON.stringify({
              data: {
                key: colKey,
                name: col.name,
                parentCollection: parentCollectionKey || collectionKey || false,
              }
            }),
          }).run();
          collectionsCreated++;

          // Update items to reference this collection
          for (const itemKey of childItemKeys) {
            const row = db.select({ collectionKeys: items.collectionKeys })
              .from(items)
              .where(and(eq(items.key, itemKey), eq(items.libraryId, library.id)))
              .get();
            if (row) {
              const existing: string[] = JSON.parse(row.collectionKeys || '[]');
              if (!existing.includes(colKey)) {
                existing.push(colKey);
                db.update(items)
                  .set({ collectionKeys: JSON.stringify(existing) })
                  .where(and(eq(items.key, itemKey), eq(items.libraryId, library.id)))
                  .run();
              }
            }
          }

          // Process sub-collections recursively
          for (const child of col.children) {
            if (child.type === 'collection') {
              createCollection(child as TranslatedCollection, colKey);
            }
          }
        }

        for (const col of translatedCollections) {
          createCollection(col, null);
        }
      }

      // Summary
      console.log('');
      if (imported > 0) console.log(`${symbols.success} Imported ${imported} item(s)`);
      if (attachmentsImported > 0) console.log(`${symbols.success} Imported ${attachmentsImported} attachment(s)`);
      if (collectionsCreated > 0) console.log(`${symbols.success} Created ${collectionsCreated} collection(s)`);
      if (skipped > 0) console.log(`${symbols.warning} Skipped ${skipped} duplicate(s)`);
      if (failed > 0) console.log(`${symbols.error} Failed ${failed} item(s)`);
      if (attachmentsFailed > 0) console.log(`${symbols.error} Failed ${attachmentsFailed} attachment(s)`);

      if (imported > 0) {
        console.log(`\nRun "zotero sync" to upload to remote.`);
      }
    }
  },
];
