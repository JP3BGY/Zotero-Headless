// @ts-nocheck

// Public API for @zotero-headless/translator

import fs from 'node:fs';
import path from 'node:path';
import { initTranslatorEngine, getZotero, isInitialized } from './engine.js';
import type { TranslatedItem, TranslatedCollection, ImportResult, TranslatorEngineOptions } from './types.js';

export { initTranslatorEngine, getZotero, isInitialized } from './engine.js';
export type { TranslatedItem, TranslatedCollection, ImportResult, TranslatorEngineOptions } from './types.js';

/**
 * Ensure the engine is initialized.
 */
async function ensureInit(): Promise<void> {
  if (!isInitialized()) {
    await initTranslatorEngine();
  }
}

/**
 * Find a translator by label (e.g., "BibTeX", "RIS", "CSL JSON").
 * Returns the translator object or null.
 */
async function findTranslatorByLabel(label: string, type: string = 'import'): Promise<any | null> {
  const Zotero = getZotero();
  const translators = await Zotero.Translators.getAllForType(type);
  const needle = label.toLowerCase();
  return translators.find((t: any) => t.label.toLowerCase() === needle) || null;
}

/**
 * Import items from a file. Format is auto-detected from file extension.
 * @param filePath - Path to the file to import
 * @returns Import result with items and collections
 */
export async function importFromFile(filePath: string): Promise<ImportResult> {
  await ensureInit();
  const Zotero = getZotero();

  const resolvedPath = path.resolve(filePath);
  const content = fs.readFileSync(resolvedPath, 'utf-8');

  const translate = new Zotero.Translate.Import();
  translate.setString(content);
  // Set location so import translator detection can match by file extension
  translate.setLocation(resolvedPath);

  const items = await translate.translate({ libraryID: false, saveAttachments: false });
  return {
    items: items || [],
    collections: translate.newCollections || [],
  };
}

/**
 * Import items from a string. Format can be auto-detected or specified by label.
 * @param content - The content string to import
 * @param format - Optional translator label (e.g., "BibTeX", "RIS", "CSL JSON", "Zotero RDF")
 * @returns Import result with items and collections
 */
export async function importFromString(content: string, format?: string): Promise<ImportResult> {
  await ensureInit();
  const Zotero = getZotero();

  const translate = new Zotero.Translate.Import();
  translate.setString(content);

  if (format) {
    const translator = await findTranslatorByLabel(format);
    if (!translator) {
      throw new Error(`No translator found with label "${format}". Check the format name (e.g. "BibTeX", "RIS", "CSL JSON", "Zotero RDF").`);
    }
    translate.setTranslator(translator);
  }

  const items = await translate.translate({ libraryID: false, saveAttachments: false });
  return {
    items: items || [],
    collections: translate.newCollections || [],
  };
}

/**
 * Search for items by identifier (DOI, ISBN, PMID, arXiv).
 * Uses Zotero's search translators (e.g., DOI Content Negotiation, Crossref REST, etc.)
 * @param identifier - Object with one or more identifiers
 * @returns Array of translated items
 */
export async function searchByIdentifier(identifier: {
  DOI?: string;
  ISBN?: string;
  PMID?: string;
  arXiv?: string;
}): Promise<TranslatedItem[]> {
  await ensureInit();
  const Zotero = getZotero();

  const translate = new Zotero.Translate.Search();
  translate.setIdentifier(identifier);

  const translators = await translate.getTranslators();
  translate.setTranslator(translators);

  const items = await translate.translate({ libraryID: false, saveAttachments: false });
  return items || [];
}

/**
 * Translate a web page by URL using Zotero's web translators.
 * Fetches the page HTML, creates a DOM via jsdom, and runs matching web translators.
 * @param url - The URL to translate
 * @param options - Optional: custom headers, user agent
 * @returns Array of translated items in Zotero format
 */
export async function translateFromUrl(url: string, options?: {
  headers?: Record<string, string>;
  userAgent?: string;
}): Promise<TranslatedItem[]> {
  await ensureInit();
  const Zotero = getZotero();
  const { JSDOM } = await import('jsdom');

  // Fetch the page HTML
  const response = await fetch(url, {
    headers: {
      'User-Agent': options?.userAgent ?? 'Mozilla/5.0 (compatible; zotero-headless/1.0)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      ...options?.headers,
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}`);
  }

  const html = await response.text();

  // Create a DOM document via jsdom
  const dom = new JSDOM(html, { url, contentType: 'text/html' });
  const doc = dom.window.document;

  const translate = new Zotero.Translate.Web();
  // Set document — framework reads doc.location.href for URL matching
  translate.setDocument(doc);

  const translators = await translate.getTranslators();
  if (!translators || translators.length === 0) {
    throw new Error(`No web translators found for ${url}`);
  }

  translate.setTranslator(translators);
  const items = await translate.translate({ libraryID: false, saveAttachments: false });
  return items || [];
}

/**
 * Create a low-level Translate.Import instance for advanced use.
 */
export function createTranslateImport(): any {
  const Zotero = getZotero();
  return new Zotero.Translate.Import();
}

/**
 * Create a low-level Translate.Search instance for advanced use.
 */
export function createTranslateSearch(): any {
  const Zotero = getZotero();
  return new Zotero.Translate.Search();
}

/**
 * Create a low-level Translate.Web instance for advanced use.
 */
export function createTranslateWeb(): any {
  const Zotero = getZotero();
  return new Zotero.Translate.Web();
}
