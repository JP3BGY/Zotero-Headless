// @ts-nocheck

// Collecting ItemSaver — captures translated items without saving to any database.
// Follows the pattern from example/translate_item.js.

/**
 * Install collecting ItemSaver onto the Zotero object.
 * When translate({ libraryID: false }) is used, the framework short-circuits
 * and items go directly to translate.newItems. The ItemSaver is only invoked
 * for nested translator calls.
 */
export function installItemSaver(Zotero: any): void {
  Zotero.Translate.ItemSaver.prototype.saveItems = async function (jsonItems: any[]) {
    this.items = (this.items || []).concat(jsonItems);
    return jsonItems;
  };

  Zotero.Translate.ItemSaver.prototype.saveCollection = function (collection: any) {
    this.collections = (this.collections || []).concat(collection);
  };
}
