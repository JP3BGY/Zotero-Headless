export type ItemType = 'journalArticle' | 'book' | 'bookSection' | 'conferencePaper' | 'thesis' | 'report' | 'webpage' | 'blogPost' | 'forumPost' | 'magazineArticle' | 'newspaperArticle' | 'patent' | 'map' | 'audioRecording' | 'videoRecording' | 'image' | 'presentation' | 'interview' | 'letter' | 'manuscript' | 'dictionaryEntry' | 'encyclopediaArticle' | 'statute' | 'case' | 'hearing' | 'device' | 'software' | 'email' | 'attachment' | 'note';
export type CreatorType = 'author' | 'editor' | 'translator' | 'contributor' | 'illustrator' | 'producer' | 'director';
export interface Creator {
    lastName: string;
    firstName: string;
    creatorType: CreatorType;
    name?: string;
}
export interface Tag {
    tag: string;
    type?: 0 | 1;
}
export type LibraryType = 'user' | 'group';
export interface Library {
    id: number;
    zoteroId: string;
    type: LibraryType;
    name: string | null;
    version: number;
    lastSyncAt: Date | null;
}
export interface Item {
    key: string;
    libraryId: number;
    version: number;
    synced: boolean;
    deleted: boolean;
    createdAt: Date;
    updatedAt: Date;
    itemType: string;
    title: string | null;
    publicationDate: string | null;
    abstract: string | null;
    doi: string | null;
    url: string | null;
    isbn: string | null;
    issn: string | null;
    publisher: string | null;
    journal: string | null;
    volume: string | null;
    issue: string | null;
    pages: string | null;
    creators: Creator[];
    collectionKeys: string[];
    tags: Tag[];
    extra: Record<string, unknown>;
    rawJson: string;
}
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
export interface DeletedObjects {
    items: string[];
    collections: string[];
    tags: string[];
}
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
//# sourceMappingURL=index.d.ts.map