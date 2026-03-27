// @ts-nocheck

import type { Command } from '../types.js';

export const helpCommands: Command[] = [
  {
    name: 'help',
    aliases: ['h', '?'],
    description: 'Show help message',
    options: [
      { name: '--all', alias: '-a', description: 'Show all commands including hidden ones' },
    ],
    examples: [
      'zotero help',
      'zotero help sync',
      'zotero sync --help',
    ],
    execute: async () => {
      console.log(`
 Zotero-Headless CLI

Usage: zotero <command> [subcommand] [options]

Core Commands:
  sync (s, pull, fetch)        Synchronize library
    sync upload                Upload local changes only
  list (ls, ll, la)            List items (ls=standard, ll=detailed, la=compact)
    list unsynced              List unsynced items
  search (find, grep, f)       Search by title/author/tags
  get (show, cat, view)        Show item details
  stats (st, info, df)         Show statistics
  verify (v, check, ping)      Verify API key

Item Management:
  add (a, new, touch)          Add new item with optional attachments
    add byid                   Add by DOI/ISBN/PMID/arXiv with optional attachments
  update (u, edit, set)        Update item field
  delete (rm, del, d)          Delete/trash item
  export (e, out, save)        Export to bibtex/ris/csv/json

Notes & Attachments:
  note (n, notes)              Note management (Markdown support)
    note add/edit/show/list    Subcommands
  attachment (att, files)      Attachment management
    attachment list            List attachments (default)
    attachment download        Download from WebDAV
    attachment open            Open with system app
    attachment dedup           Find duplicate attachments

Trash Management:
  trash                        Trash management
    trash list                 List trash items (default)
    trash empty                Permanently empty trash
    trash restore              Restore item from trash

Group Libraries:
  groups (g, team)             List group libraries

Tags & Collections:
  tags (t)                     Manage item tags
  collections (col, folder)    Manage collections (folders)

WebDAV:
  webdav                       WebDAV management
    webdav config              Configure WebDAV server
    webdav sync                Sync attachments to WebDAV
    webdav status              Show WebDAV configuration status
    webdav scan                Scan WebDAV for attachments

Global Options:
  --lang=en|zh                 Set language (default: zh)

Quick Examples:
  zotero sync                           # Sync library
  zotero ls -t book                     # List books
  zotero grep "machine learning"        # Search
  zotero cat ABCD1234                   # View item
  zotero rm ABCD1234 -f                 # Force delete
  zotero touch journalArticle "Title"   # Add item

With Attachments:
  zotero add book "Title" "Author" -a file1.pdf -a file2.pdf
  zotero add byid "10.1000/xyz" -a supplement.pdf
  zotero ls                             # Shows N count for each item

With Notes (Markdown):
  zotero note add ABCD1234 "Key findings: ..."
  zotero note show NOTE5678             # View as Markdown
  zotero note edit NOTE5678 "Updated: ..."
  zotero note list ABCD1234             # List item's notes

For more info: https://github.com/altairwei/Zotero-Headless
`);
    }
  },
];
