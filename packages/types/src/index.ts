// Type Definitions for Zotero-Headless
// See Zotero-Headless-Complete-Design.md Section 3.3

// ============ Item Types ============

export type ItemType = 
  | 'journalArticle' | 'book' | 'bookSection' | 'conferencePaper'
  | 'thesis' | 'report' | 'webpage' | 'blogPost' | 'forumPost'
  | 'magazineArticle' | 'newspaperArticle' | 'patent' | 'map'
  | 'audioRecording' | 'videoRecording' | 'image' | 'presentation'
  | 'interview' | 'letter' | 'manuscript' | 'dictionaryEntry'
  | 'encyclopediaArticle' | 'statute' | 'case' | 'hearing'
  | 'device' | 'software' | 'email' | 'attachment' | 'note';

// ============ Creator Types ============

export type CreatorType = 
  | 'author' | 'editor' | 'translator' | 'contributor'
  | 'illustrator' | 'producer' | 'director';

export interface Creator {
  lastName: string;
  firstName: string;
  creatorType: CreatorType;
  name?: string;  // For organizations
}

// ============ Tag Types ============

export interface Tag {
  tag: string;
  type?: 0 | 1;  // 0 = user tag, 1 = automatic tag
}

// ============ Library Types ============

export type LibraryType = 'user' | 'group';

export interface Library {
  id: number;
  zoteroId: string;
  type: LibraryType;
  name: string | null;
  version: number;
  lastSyncAt: Date | null;
}

// ============ Item Types ============

export interface Item {
  key: string;
  libraryId: number;
  version: number;
  synced: boolean;
  deleted: boolean;
  createdAt: Date;
  updatedAt: Date;
  
  // Core fields
  itemType: string;
  title: string | null;
  publicationDate: string | null;
  abstract: string | null;
  
  // Identifier fields
  doi: string | null;
  url: string | null;
  isbn: string | null;
  issn: string | null;
  
  // Publication info
  publisher: string | null;
  journal: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  
  // JSON fields
  creators: Creator[];
  collectionKeys: string[];
  tags: Tag[];
  extra: Record<string, unknown>;
  
  // Raw data
  rawJson: string;
}

// ============ Collection Types ============

export interface Collection {
  key: string;
  libraryId: number;
  name: string;
  parentKey: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deleted: boolean;
  rawJson: string;
}

// ============ Deleted Objects ============

export interface DeletedObjects {
  items: string[];
  collections: string[];
  tags: string[];
}

// ============ Sync Types ============

export interface SyncOptions {
  libraryId?: number;
  fullSync?: boolean;
}

export interface SyncResult {
  success: boolean;
  updated: number;
  deleted: number;
  errors: string[];
  conflicts?: string[];
}

// ============ Filter Types ============

export interface ItemFilter {
  libraryId: number;
  itemType?: string | string[];
  title?: string;
  creator?: string;
  tag?: string;
  sinceVersion?: number;
  deleted?: boolean;
  limit?: number;
  offset?: number;
}

export interface CollectionFilter {
  libraryId: number;
  parentKey?: string | null;
  includeDeleted?: boolean;
}
