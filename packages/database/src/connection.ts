// Database Connection and Initialization
// See Zotero-Headless-Complete-Design.md Section 3

import fs from 'fs';
import path from 'path';
import BetterSQLite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { appConfig } from '@zotero-headless/core';

// Re-export schema
export * from './schema.js';

// Database instance type (Drizzle ORM wrapper)
export type Database = ReturnType<typeof drizzle>;

// Singleton database instance
let db: Database | null = null;
let sqliteInstance: BetterSQLite3.Database | null = null;

/**
 * Get raw SQLite instance for executing raw SQL
 */
export function getRawSQLite(): BetterSQLite3.Database {
  if (!sqliteInstance) {
    initializeDatabase();
  }
  if (!sqliteInstance) {
    throw new Error('Failed to initialize SQLite instance');
  }
  return sqliteInstance;
}

/**
 * Initialize database connection
 */
export function initializeDatabase(): Database {
  if (db) {
    return db;
  }

  const dbPath = appConfig.database.path;
  
  // Create database directory if it doesn't exist
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log(`Created database directory: ${dbDir}`);
  }
  
  // Open database connection
  sqliteInstance = new BetterSQLite3(dbPath);
  
  // Enable WAL mode for better concurrency
  sqliteInstance.pragma('journal_mode = WAL');
  sqliteInstance.pragma('foreign_keys = ON');
  sqliteInstance.pragma('cache_size = -6400'); // 64MB cache
  
  // Create drizzle instance
  db = drizzle(sqliteInstance, { schema });
  
  // Create tables if they don't exist
  sqliteInstance.exec(`
    CREATE TABLE IF NOT EXISTS libraries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zotero_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      last_sync_at INTEGER,
      raw_json TEXT,
      UNIQUE(zotero_id, type)
    );
    
    CREATE TABLE IF NOT EXISTS items (
      key TEXT NOT NULL,
      library_id INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      synced INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      item_type TEXT NOT NULL,
      title TEXT,
      publication_date TEXT,
      abstract TEXT,
      doi TEXT,
      url TEXT,
      isbn TEXT,
      issn TEXT,
      publisher TEXT,
      journal TEXT,
      volume TEXT,
      issue TEXT,
      pages TEXT,
      creators TEXT,
      collection_keys TEXT,
      tags TEXT,
      extra TEXT DEFAULT '{}',
      raw_json TEXT,
      PRIMARY KEY (key, library_id),
      FOREIGN KEY (library_id) REFERENCES libraries(id)
    );
    
    CREATE TABLE IF NOT EXISTS collections (
      key TEXT NOT NULL,
      library_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      parent_key TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      raw_json TEXT,
      PRIMARY KEY (key, library_id),
      FOREIGN KEY (library_id) REFERENCES libraries(id)
    );
    
    CREATE TABLE IF NOT EXISTS item_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_key TEXT NOT NULL,
      library_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      tag_type INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      UNIQUE(item_key, library_id, tag)
    );
    
    CREATE TABLE IF NOT EXISTS attachments (
      key TEXT NOT NULL,
      parent_item_key TEXT NOT NULL,
      library_id INTEGER NOT NULL,
      filename TEXT,
      content_type TEXT,
      file_type TEXT,
      path TEXT,
      url TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      size INTEGER,
      md5 TEXT,
      webdav_synced INTEGER NOT NULL DEFAULT 0,
      webdav_path TEXT,
      webdav_synced_at INTEGER,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (key, library_id),
      FOREIGN KEY (library_id) REFERENCES libraries(id)
    );
    
    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      library_id INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      status TEXT NOT NULL,
      remote_version INTEGER,
      local_version INTEGER,
      items_updated INTEGER DEFAULT 0,
      items_deleted INTEGER DEFAULT 0,
      error_message TEXT,
      FOREIGN KEY (library_id) REFERENCES libraries(id)
    );
    
    CREATE TABLE IF NOT EXISTS webdav_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      base_path TEXT NOT NULL DEFAULT '/zotero',
      enabled INTEGER NOT NULL DEFAULT 1,
      auto_sync INTEGER NOT NULL DEFAULT 0,
      last_sync_at INTEGER,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_items_library ON items(library_id);
    CREATE INDEX IF NOT EXISTS idx_items_synced ON items(synced);
    CREATE INDEX IF NOT EXISTS idx_items_deleted ON items(deleted);
  `);
  
  // Migration: Add missing columns to existing tables
  try {
    // Check if webdav_synced column exists
    const columns = sqliteInstance.prepare(`PRAGMA table_info(attachments)`).all() as any[];
    const hasWebdavSynced = columns.some(col => col.name === 'webdav_synced');
    
    if (!hasWebdavSynced) {
      console.log('Migrating database: Adding WebDAV columns to attachments...');
      sqliteInstance.exec(`
        ALTER TABLE attachments ADD COLUMN webdav_synced INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE attachments ADD COLUMN webdav_path TEXT;
        ALTER TABLE attachments ADD COLUMN webdav_synced_at INTEGER;
      `);
      console.log('✔ Migration complete');
    }
  } catch (e) {
    console.warn('! Database migration warning:', e);
  }
  
  console.log(`📂 Database initialized: ${dbPath}`);
  
  return db;
}

/**
 * Get database instance (lazy initialization)
 */
export function getDatabase(): Database {
  if (!db) {
    return initializeDatabase();
  }
  return db;
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  if (sqliteInstance) {
    sqliteInstance.close();
    sqliteInstance = null;
    db = null;
    console.log('📂 Database connection closed');
  }
}

// For CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Initializing database...');
  initializeDatabase();
  console.log('Done!');
}
