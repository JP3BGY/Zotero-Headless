/**
 * Virtual Filesystem Types
 *
 * Type definitions for path resolution and VFS operations.
 */

// ============ Path Resolution Types ============

export type ResolvedPath =
  | { type: 'root' }
  | { type: 'collections-dir'; libraryId: number }
  | { type: 'collection'; libraryId: number; collectionKey: string }
  | { type: 'items-dir'; libraryId: number }
  | { type: 'item'; libraryId: number; itemKey: string }
  | { type: 'metadata-file'; libraryId: number; itemKey: string }
  | { type: 'abstract-file'; libraryId: number; itemKey: string }
  | { type: 'notes-dir'; libraryId: number; itemKey: string }
  | { type: 'note-file'; libraryId: number; noteKey: string }
  | { type: 'attachments-dir'; libraryId: number; itemKey: string }
  | { type: 'attachment-file'; libraryId: number; attachmentKey: string; filename: string }
  | { type: 'annotations-dir'; libraryId: number; itemKey: string }
  | { type: 'annotation-file'; libraryId: number; annotationKey: string }
  | { type: 'tags-dir'; libraryId: number }
  | { type: 'tag'; libraryId: number; tag: string }
  | { type: 'types-dir'; libraryId: number }
  | { type: 'item-type'; libraryId: number; itemType: string }
  | { type: 'unfiled-dir'; libraryId: number };

// ============ Command Result ============

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ============ Session ============

export interface VfsSession {
  /** Execute a shell command against the virtual filesystem */
  execute(command: string): Promise<CommandResult>;
  /** Get current working directory */
  getCwd(): string;
  /** Clean up resources */
  destroy(): void;
}

// ============ Options ============

export interface VfsOptions {
  /** Specific library ID to use (auto-detected if omitted) */
  libraryId?: number;
  /** Initial working directory (default: '/') */
  cwd?: string;
  /** Maximum characters for command output (default: 200000) */
  outputLimit?: number;
}

// ============ Cache Entry ============

export interface CachedCollectionTree {
  collections: CollectionNode[];
  byKey: Map<string, CollectionNode>;
  byParent: Map<string | null, CollectionNode[]>;
  timestamp: number;
}

export interface CollectionNode {
  key: string;
  name: string;
  parentKey: string | null;
  libraryId: number;
  sanitizedName: string;
}
