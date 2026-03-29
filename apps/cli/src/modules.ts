// @ts-nocheck

// Lazy-loaded modules (to avoid initialization on help commands)
let syncManager: any;
let getDatabase: any;
let _items: any;
let _libraries: any;
let _attachments: any;
let _itemTags: any;
let _collections: any;
let zoteroApi: any;
let _attachmentManager: any;
let _fullTextFinder: any;
let _webdavConfig: any;
let _logDeletion: any;

export async function initModules() {
  if (!syncManager) {
    const syncMod = await import('@zotero-headless/sync-engine');
    syncManager = syncMod.syncManager;
  }
  if (!getDatabase) {
    const dbMod = await import('@zotero-headless/database');
    getDatabase = dbMod.getDatabase;
    _items = dbMod.items;
    _libraries = dbMod.libraries;
    _webdavConfig = dbMod.webdavConfig;
    _attachments = dbMod.attachments;
    _logDeletion = dbMod.logDeletion;
    _itemTags = dbMod.itemTags;
    _collections = dbMod.collections;
  }
  if (!zoteroApi) {
    const apiMod = await import('@zotero-headless/api');
    zoteroApi = apiMod.zoteroApi;
  }
  if (!_attachmentManager) {
    const attMod = await import('@zotero-headless/attachment-manager');
    _attachmentManager = attMod.attachmentManager;
    _fullTextFinder = new attMod.FullTextFinder();
  }
}

export function getSyncManager() { return syncManager; }
export function getDb() { return getDatabase; }
export function getItems() { return _items; }
export function getLibraries() { return _libraries; }
export function getAttachments() { return _attachments; }
export function getItemTags() { return _itemTags; }
export function getCollections() { return _collections; }
export function getZoteroApi() { return zoteroApi; }
export function getAttachmentManager() { return _attachmentManager; }
export function getFullTextFinder() { return _fullTextFinder; }
export function getWebdavConfig() { return _webdavConfig; }
export function getLogDeletion() { return _logDeletion; }
