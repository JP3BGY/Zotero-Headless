// Database Connection and Initialization
// See Zotero-Headless-Complete-Design.md Section 3

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { appConfig } from '@zotero-headless/core';

// Re-export schema
export * from './schema.js';

// Database instance type
export type Database = ReturnType<typeof drizzle>;

// Singleton database instance
let db: Database | null = null;

/**
 * Initialize database connection
 */
export function initializeDatabase(): Database {
  if (db) {
    return db;
  }

  const dbPath = appConfig.database.path;
  
  // Create database directory if it doesn't exist
  const dbDir = dbPath.includes('/') ? dbPath.substring(0, dbPath.lastIndexOf('/')) : './data';
  
  // Open database connection
  const sqlite = new Database(dbPath);
  
  // Enable WAL mode for better concurrency
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('cache_size = -6400'); // 64MB cache
  
  // Create drizzle instance
  db = drizzle(sqlite, { schema });
  
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
  if (db) {
    // @ts-ignore - access raw sqlite connection
    db.$client.close();
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
