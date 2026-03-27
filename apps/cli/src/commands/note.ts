// @ts-nocheck

import { symbols } from '@zotero-headless/core';
import { eq, and } from 'drizzle-orm';
import { parseItemData, updateItemData } from '@zotero-headless/types';
import { Command } from '../types.js';
import { initModules, getDb, getItems, getLibraries } from '../modules.js';
import { generateKey, formatDate } from '../utils.js';

export const noteCommands: Command[] = [

  {
    name: 'note',
    aliases: ['n', 'notes'],
    description: 'Note management. Subcommands: add, edit, show, list. Supports Markdown input/output',
    options: [
      { name: '--item', alias: '-i', description: 'Parent item key', value: '<key>' },
      { name: '--edit', alias: '-e', description: 'Edit note content' },
    ],
    examples: [
      'zotero note list ABC123',
      'zotero note add ABC123 "Content"',
      'zotero note edit NOTE456 -e',
    ],
    execute: async (args) => {
      await initModules();

      const subcommand = args[0];
      const subArgs = args.slice(1);

      if (!subcommand || subcommand === '--help' || subcommand === '-h') {
        console.log(`
Note Management

Usage: zotero note <subcommand> [options]

Subcommands:
  add <parent-key> [content]     Add a note to an item (Markdown supported)
  edit <note-key> [content]      Edit an existing note (opens $EDITOR if no content)
  show <note-key>                Show note content (as Markdown)
  list <parent-key>              List all notes for an item
  export <note-key> [path]       Export note(s) to Markdown file(s)
                                 Use --all to export all notes

Examples:
  zotero note add ABCD1234 "This is a **note**"
  zotero note edit NOTE5678              # Opens $EDITOR (vim/nano)
  zotero note edit NOTE5678 "New text"   # Direct update
  zotero note show NOTE5678
  zotero note list ABCD1234
  zotero note export NOTE5678 ./notes/   # Export to file
  zotero note export --all ./exported/   # Export all notes

Notes:
  - Content supports Markdown formatting
  - All operations are local; use 'zotero sync' to upload
  - Set $EDITOR env var to customize editor (default: nano)
        `);
        return;
      }

      // Import note utilities
      const { markdownToHtml, htmlToMarkdown, htmlToPlainText, ensureHtml } = await import('../note-utils.js');

      const db = getDb()();
      const items = getItems();
      const libraries = getLibraries();
      const library = await db.select().from(libraries).get();

      if (!library) {
        console.log(`${symbols.error} No library found. Run "sync" first.`);
        return;
      }

      switch (subcommand) {
        case 'add': {
          const parentKey = subArgs[0];
          let content = subArgs.slice(1).join(' ');

          if (!parentKey) {
            console.log(`${symbols.error} Usage: zotero note add <parent-key> [content]`);
            console.log('   Example: zotero note add ABCD1234 "This is a **note**"');
            return;
          }

          // Check if parent item exists
          const parentItem = await db.select()
            .from(items)
            .where(and(eq(items.key, parentKey), eq(items.libraryId, library.id)))
            .get();

          if (!parentItem) {
            console.log(`${symbols.error} Parent item ${parentKey} not found.`);
            return;
          }

          const noteKey = generateKey();
          const now = Math.floor(Date.now() / 1000);

          // If no content provided, open external editor
          if (!content) {
            const { fileSync } = await import('tmp');
            const { writeFileSync, readFileSync } = await import('fs');
            const { spawn } = await import('child_process');

            const tmpFile = fileSync({
              postfix: '.md',
              prefix: 'zotero-note-'
            });

            writeFileSync(tmpFile.name, '', 'utf-8');

            const { configManager } = await import('@zotero-headless/core');
            const editor = configManager.get('editor') || process.env.EDITOR || process.env.VISUAL || 'nano';

            console.log(`Opening external editor: ${editor}`);
            console.log(`   File: ${tmpFile.name}`);
            console.log(`   Edit and save the file, then close the editor to apply changes.`);
            console.log('');

            await new Promise<void>((resolve, reject) => {
              const child = spawn(editor, [tmpFile.name], {
                stdio: 'inherit',
                detached: false
              });

              child.on('close', (code) => {
                if (code === 0 || code === null) {
                  resolve();
                } else {
                  reject(new Error(`Editor exited with code ${code}`));
                }
              });

              child.on('error', (err) => {
                reject(err);
              });
            });

            const editedContent = readFileSync(tmpFile.name, 'utf-8');
            tmpFile.removeCallback();

            if (!editedContent.trim()) {
              console.log('Empty note. Aborting.');
              return;
            }

            content = editedContent;
          }

          // Convert Markdown to HTML for storage
          const htmlContent = ensureHtml(content);

          // Create note data
          const noteData = {
            itemType: 'note',
            note: htmlContent,
            parentItem: parentKey,
            tags: [],
          };

          // Insert to local database
          await db.insert(items).values({
            key: noteKey,
            libraryId: library.id,
            version: 0,
            synced: false,
            deleted: false,
            createdAt: now,
            updatedAt: now,
            itemType: 'note',
            title: htmlToPlainText(htmlContent, 50) || '(empty note)',
            rawJson: JSON.stringify({ data: noteData }),
          }).run();

          console.log(`${symbols.success} Note added successfully!`);
          console.log(`   Key: ${noteKey}`);
          console.log(`   Parent: ${parentKey}`);
          if (content) {
            console.log(`   Preview: ${htmlToPlainText(htmlContent, 80)}`);
          }
          console.log(`\nRun "zotero sync" to upload to remote.`);
          break;
        }

        case 'edit': {
          const noteKey = subArgs[0];
          let newContent = subArgs.slice(1).join(' ');

          if (!noteKey) {
            console.log(`${symbols.error} Usage: zotero note edit <note-key> [content]`);
            console.log('   Example: zotero note edit NOTE5678 "Updated **content**"');
            return;
          }

          // Get existing note
          const note = await db.select()
            .from(items)
            .where(and(eq(items.key, noteKey), eq(items.libraryId, library.id)))
            .get();

          if (!note) {
            console.log(`${symbols.error} Note ${noteKey} not found.`);
            return;
          }

          if (note.itemType !== 'note') {
            console.log(`${symbols.error} Item ${noteKey} is not a note.`);
            return;
          }

          // Parse existing data
          const data = parseItemData(note.rawJson);

          // If no new content provided, open external editor
          if (!newContent) {
            const currentHtml = data.note || '';
            const currentMarkdown = htmlToMarkdown(currentHtml);

            // Import required modules for external editor
            const { fileSync } = await import('tmp');
            const { writeFileSync, readFileSync } = await import('fs');
            const { spawn } = await import('child_process');

            // Create temporary file with current content
            const tmpFile = fileSync({
              postfix: '.md',
              prefix: 'zotero-note-'
            });

            // Write current markdown to temp file
            writeFileSync(tmpFile.name, currentMarkdown || '', 'utf-8');

            // Get editor from config, environment, or use default
            const { configManager } = await import('@zotero-headless/core');
            const editor = configManager.get('editor') || process.env.EDITOR || process.env.VISUAL || 'nano';

            console.log(`Opening external editor: ${editor}`);
            console.log(`   File: ${tmpFile.name}`);
            console.log(`   Edit and save the file, then close the editor to apply changes.`);
            console.log('');

            // Wait for editor to close
            await new Promise<void>((resolve, reject) => {
              const child = spawn(editor, [tmpFile.name], {
                stdio: 'inherit',
                detached: false
              });

              child.on('close', (code) => {
                if (code === 0 || code === null) {
                  resolve();
                } else {
                  reject(new Error(`Editor exited with code ${code}`));
                }
              });

              child.on('error', (err) => {
                reject(err);
              });
            });

            // Read edited content
            const editedContent = readFileSync(tmpFile.name, 'utf-8');

            // Clean up temp file
            tmpFile.removeCallback();

            // Check if content changed
            if (editedContent === currentMarkdown) {
              console.log('\nNo changes detected. Note not updated.');
              return;
            }

            // Use edited content
            newContent = editedContent;
          }

          // Convert new content to HTML
          const newHtmlContent = ensureHtml(newContent);

          // Update local database
          const now = Math.floor(Date.now() / 1000);
          await db.update(items)
            .set({
              synced: false,
              updatedAt: now,
              title: htmlToPlainText(newHtmlContent, 50) || '(empty note)',
              rawJson: updateItemData(note.rawJson, (d) => { d.note = newHtmlContent; }),
            })
            .where(and(eq(items.key, noteKey), eq(items.libraryId, library.id)))
            .run();

          console.log(`${symbols.success} Note updated successfully!`);
          console.log(`   Key: ${noteKey}`);
          console.log(`   Preview: ${htmlToPlainText(newHtmlContent, 80)}`);
          console.log(`\nRun "zotero sync" to upload changes.`);
          break;
        }

        case 'show': {
          const noteKey = subArgs[0];

          if (!noteKey) {
            console.log(`${symbols.error} Usage: zotero note show <note-key>`);
            console.log('   Example: zotero note show NOTE5678');
            return;
          }

          // Get note
          const note = await db.select()
            .from(items)
            .where(and(eq(items.key, noteKey), eq(items.libraryId, library.id)))
            .get();

          if (!note) {
            console.log(`${symbols.error} Note ${noteKey} not found.`);
            return;
          }

          if (note.itemType !== 'note') {
            console.log(`${symbols.error} Item ${noteKey} is not a note.`);
            return;
          }

          // Parse data
          const data = parseItemData(note.rawJson);
          const htmlContent = data.note || '';

          // Convert to Markdown for display
          const markdownContent = htmlToMarkdown(htmlContent);

          console.log(`\nNote: ${noteKey}`);
          console.log(`   Parent: ${data.parentItem || '(none)'}`);
          console.log(`   Updated: ${formatDate(note.updatedAt)}`);
          console.log(`   Synced: ${note.synced ? symbols.success : ''}`);
          console.log('\u2500'.repeat(60));
          console.log(markdownContent || '(empty note)');
          console.log('\u2500'.repeat(60));
          break;
        }

        case 'list': {
          const parentKey = subArgs[0];

          if (!parentKey) {
            console.log(`${symbols.error} Usage: zotero note list <parent-key>`);
            console.log('   Example: zotero note list ABCD1234');
            return;
          }

          // Get all notes for this parent
          const notes = await db.select()
            .from(items)
            .where(and(
              eq(items.libraryId, library.id),
              eq(items.itemType, 'note'),
              eq(items.deleted, false)
            ))
            .all();

          // Filter notes that belong to this parent
          const parentNotes = notes.filter(note => {
            const data = parseItemData(note.rawJson);
            return data.parentItem === parentKey;
          });

          if (parentNotes.length === 0) {
            console.log(`\nNo notes found for item ${parentKey}.`);
            return;
          }

          console.log(`\nNotes for ${parentKey} (${parentNotes.length}):\n`);

          for (const note of parentNotes) {
            const data = parseItemData(note.rawJson);
            const htmlContent = data.note || '';
            const preview = htmlToPlainText(htmlContent, 60) || '(empty note)';
            const syncStatus = note.synced ? symbols.success : '';

            console.log(`  ${syncStatus} [${note.key}] ${preview}`);
          }
          console.log();
          break;
        }

        case 'export': {
          const target = subArgs[0];
          const outputPath = subArgs[1] || '.';

          if (!target) {
            console.log(`${symbols.error} Usage: zotero note export <note-key> [output-path]`);
            console.log('   Example: zotero note export NOTE1234 ./my-notes/');
            console.log('   Example: zotero note export --all ./exported-notes/');
            return;
          }

          // Check if exporting all notes
          if (target === '--all') {
            const allNotes = await db.select()
              .from(items)
              .where(and(
                eq(items.libraryId, library.id),
                eq(items.itemType, 'note')
              ))
              .all();

            if (allNotes.length === 0) {
              console.log('No notes found to export.');
              return;
            }

            // Create output directory if not exists
            const fs = await import('fs');
            const path = await import('path');
            const outputDir = outputPath || './zotero-notes-export';

            if (!fs.existsSync(outputDir)) {
              fs.mkdirSync(outputDir, { recursive: true });
            }

            console.log(`Exporting ${allNotes.length} notes to ${outputDir}...\n`);

            let exported = 0;
            for (const note of allNotes) {
              try {
                const data = parseItemData(note.rawJson);
                const htmlContent = data.note || '';

                // Convert to Markdown
                const { htmlToMarkdown } = await import('../note-utils.js');
                const markdown = htmlToMarkdown(htmlContent);

                // Create filename from key and title
                const title = note.title?.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30) || 'untitled';
                const filename = `${note.key}_${title}.md`;
                const filepath = path.join(outputDir, filename);

                // Write file
                fs.writeFileSync(filepath, markdown, 'utf-8');
                exported++;
                console.log(`  ${symbols.success} ${filename}`);
              } catch (e) {
                console.warn(`  !  Failed to export note ${note.key}: ${e}`);
              }
            }

            console.log(`\nExported ${exported}/${allNotes.length} notes to ${outputDir}/`);
            return;
          }

          // Export single note
          const note = await db.select()
            .from(items)
            .where(and(eq(items.key, target), eq(items.libraryId, library.id)))
            .get();

          if (!note) {
            console.log(`${symbols.error} Note ${target} not found.`);
            return;
          }

          if (note.itemType !== 'note') {
            console.log(`${symbols.error} Item ${target} is not a note.`);
            return;
          }

          try {
            const data = parseItemData(note.rawJson);
            const htmlContent = data.note || '';

            // Convert to Markdown
            const { htmlToMarkdown } = await import('../note-utils.js');
            const markdown = htmlToMarkdown(htmlContent);

            // Write to file or stdout
            const fs = await import('fs');
            const path = await import('path');

            if (outputPath && outputPath !== '-') {
              // Determine if outputPath is a file or directory
              let filepath = outputPath;
              if (fs.existsSync(outputPath) && fs.statSync(outputPath).isDirectory()) {
                const title = note.title?.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30) || 'untitled';
                filepath = path.join(outputPath, `${note.key}_${title}.md`);
              }

              fs.writeFileSync(filepath, markdown, 'utf-8');
              console.log(`${symbols.success} Exported note to ${filepath}`);
            } else {
              // Output to stdout
              console.log(markdown);
            }
          } catch (e) {
            console.error(`${symbols.error} Failed to export note: ${e}`);
          }
          break;
        }

        default:
          console.log(`${symbols.error} Unknown subcommand: ${subcommand}`);
          console.log('   Run "zotero note --help" for usage.');
      }
    }
  },

];
