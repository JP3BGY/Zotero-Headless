/**
 * Shared lazy-loaded database module accessors.
 * Avoids duplicating the same pattern across zotero-fs.ts and custom-commands.ts.
 */

let _dbModule: any;
export async function getDb() {
  if (!_dbModule) {
    _dbModule = await import('@zotero-headless/database');
  }
  return _dbModule;
}

let _drizzleModule: any;
export async function getDrizzle() {
  if (!_drizzleModule) {
    _drizzleModule = await import('drizzle-orm');
  }
  return _drizzleModule;
}
