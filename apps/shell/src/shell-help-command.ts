/**
 * Unified Help Command for Zotero Shell
 *
 * Overrides just-bash's built-in help to show both filesystem
 * commands and Zotero CLI commands in a unified view.
 */

import { defineCommand } from 'just-bash';

export const shellHelpCommand = defineCommand('help', async () => {
  const text = `Zotero Shell — Virtual filesystem + Zotero commands

Filesystem commands:
  ls [path]          List directory contents (with item titles)
  cd <path>          Change directory
  pwd                Print working directory
  cat <file|key>     Read file or show item summary
  grep [-r] <pat>    Search content (FTS5-optimized for items)
  find <path> ...    Find files by name
  tree [-L N] [path] Display directory tree (default depth: 3)
  head/tail <file>   Show first/last lines
  stat <file>        Display file metadata

Zotero commands:
  sync               Sync library with Zotero servers
  search <query>     Search items by title/abstract
  list [options]     List items (--type, --limit, --sort, etc.)
  get <key>          Show formatted item details
  add [options]      Add new item
  delete <key>       Delete an item (with confirmation)
  export <key>       Export item (bibtex, json, etc.)
  update <key>       Update item metadata
  note <key>         Manage notes
  attachment <key>   Manage attachments
  trash [options]    View/manage trashed items
  tags [options]     List/manage tags
  collections        Manage collections
  cite <key>         Generate citation

Virtual filesystem structure:
  /collections/      Collection hierarchy
  /items/            All items (flat)
  /tags/             Items grouped by tag
  /types/            Items grouped by type
  /unfiled/          Items not in any collection

Each item directory contains:
  metadata.json      Bibliographic metadata
  abstract.txt       Paper abstract
  notes/             Attached notes (.md)
  attachments/       Document content (extracted text)
  annotations/       PDF annotations (.txt)

Pipes and shell features work: search neural | grep 2024 | head -5
Type "exit" to quit. Use "<command> --help" for detailed options.
`;

  return { stdout: text, stderr: '', exitCode: 0 };
});
