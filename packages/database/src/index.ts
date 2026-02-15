// Database Layer
// See Zotero-Headless-Complete-Design.md Section 3 & 6

export * from './schema.js';
export * from './connection.js';

// Re-export for convenience
export type { Database } from './connection.js';
