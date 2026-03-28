// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getDb, getItems, getLibraries } from '../modules.js';
import { symbols } from '@zotero-headless/core';
import { generateKey, resolveCollectionPath } from '../utils.js';
import { extractDenormalizedColumns } from '@zotero-headless/types';
import { importFromFile, importFromString } from '@zotero-headless/translator';
import { and, eq } from 'drizzle-orm';

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
      try {
        if (formatFlag) {
          // User specified a translator label — use importFromString with format hint
          translatedItems = await importFromString(content, formatFlag);
        } else {
          // Auto-detect from file extension
          translatedItems = await importFromFile(resolvedPath);
        }
      } catch (err: any) {
        console.log(`${symbols.error} Failed to parse file: ${err.message || err}`);
        process.exit(1);
      }

      if (translatedItems.length === 0) {
        console.log(`${symbols.warning} No items found in file.`);
        return;
      }

      console.log(`Parsed ${translatedItems.length} item(s) from ${path.basename(resolvedPath)}\n`);

      // Dry run: just show parsed items
      if (dryRun) {
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
        }
        console.log(`\n${symbols.success} Dry run complete. ${translatedItems.length} item(s) would be imported.`);
        return;
      }

      // Initialize database
      await initModules();
      const db = getDb()();
      const items = getItems();
      const libraries = getLibraries();

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
      let existingDois = new Set<string>();
      let existingIsbns = new Set<string>();
      if (skipDuplicates) {
        const allItems = await db.select({ doi: items.doi, isbn: items.isbn })
          .from(items)
          .where(and(eq(items.libraryId, library.id), eq(items.deleted, false)));
        for (const item of allItems) {
          if (item.doi) existingDois.add(item.doi.toLowerCase());
          if (item.isbn) existingIsbns.add(item.isbn.replace(/[-\s]/g, ''));
        }
      }

      // Import items
      let imported = 0;
      let skipped = 0;
      let failed = 0;
      const now = Math.floor(Date.now() / 1000);

      for (const translatedItem of translatedItems) {
        try {
          // Translator items are already in Zotero format — use directly
          const zoteroData = { ...translatedItem };

          // Remove framework-internal fields not needed in DB
          delete zoteroData.itemID;
          delete zoteroData.seeAlso;
          delete zoteroData.attachments;

          // Check for duplicates
          if (skipDuplicates) {
            if (zoteroData.DOI && existingDois.has(zoteroData.DOI.toLowerCase())) {
              skipped++;
              continue;
            }
            if (zoteroData.ISBN && existingIsbns.has(zoteroData.ISBN.replace(/[-\s]/g, ''))) {
              skipped++;
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

          // Track newly added DOI/ISBN for intra-file dedup
          if (skipDuplicates) {
            if (zoteroData.DOI) existingDois.add(zoteroData.DOI.toLowerCase());
            if (zoteroData.ISBN) existingIsbns.add(zoteroData.ISBN.replace(/[-\s]/g, ''));
          }
        } catch (err: any) {
          failed++;
          const title = translatedItem.title || '(unknown)';
          console.log(`${symbols.error} Failed to import "${title}": ${err.message || err}`);
        }
      }

      // Summary
      console.log('');
      if (imported > 0) console.log(`${symbols.success} Imported ${imported} item(s)`);
      if (skipped > 0) console.log(`${symbols.warning} Skipped ${skipped} duplicate(s)`);
      if (failed > 0) console.log(`${symbols.error} Failed ${failed} item(s)`);

      if (imported > 0) {
        console.log(`\nRun "zotero sync" to upload to remote.`);
      }
    }
  },
];
