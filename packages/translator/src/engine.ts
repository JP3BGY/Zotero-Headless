// @ts-nocheck

// Initialization orchestrator for the Zotero translator framework.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFramework } from './globals.js';
import { installFileTranslators } from './translators.js';
import { installNodeHttp } from './http.js';
import { installItemSaver } from './item-saver.js';
import type { TranslatorEngineOptions } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _zotero: any = null;
let _initialized = false;

function resolveRepoRoot(): string {
  // Walk up from packages/translator/dist/ or packages/translator/src/
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'references', 'translators'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error(
    'Cannot auto-detect repository root. Provide translatorsDir and frameworkDir options.'
  );
}

/**
 * Initialize the Zotero translator engine.
 * Must be called once before using any translation functions.
 */
export async function initTranslatorEngine(options?: TranslatorEngineOptions): Promise<void> {
  if (_initialized) return;

  // Only auto-detect repo root when paths aren't explicitly provided
  let frameworkDir = options?.frameworkDir ? path.resolve(options.frameworkDir) : undefined;
  let translatorsDir = options?.translatorsDir ? path.resolve(options.translatorsDir) : undefined;
  if (!frameworkDir || !translatorsDir) {
    const repoRoot = resolveRepoRoot();
    frameworkDir = frameworkDir ?? path.join(repoRoot, 'references/zotero-connectors/src/translate');
    translatorsDir = translatorsDir ?? path.join(repoRoot, 'references/translators');
  }

  // 1. Load framework files into Zotero object
  const Zotero = loadFramework(frameworkDir);

  // 2. Install our Node.js HTTP implementation
  installNodeHttp(Zotero);

  // 3. Install file-based translator registry
  installFileTranslators(Zotero, translatorsDir);

  // 4. Initialize schema
  const schemaPath = path.join(frameworkDir, 'modules/utilities/resource/schema/global/schema.json');
  if (fs.existsSync(schemaPath)) {
    const schemaData = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
    Zotero.Schema.init(schemaData);
  }

  // 5. Initialize date formats
  const dateFormatsPath = path.join(frameworkDir, 'modules/utilities/resource/dateFormats.json');
  if (fs.existsSync(dateFormatsPath)) {
    const dateFormats = JSON.parse(fs.readFileSync(dateFormatsPath, 'utf-8'));
    Zotero.Date.init(dateFormats);
  }

  // 6. Patch Zotero.Utilities.xpath to tolerate jsdom XPath evaluation failures.
  // jsdom does not support all XPath expressions (e.g. preceding-sibling with name()).
  // The original code rethrows, crashing the entire translator. We log and skip instead.
  const _origXpath = Zotero.Utilities.xpath;
  Zotero.Utilities.xpath = function (elements: any, xpath: string, namespaces?: any) {
    try {
      return _origXpath.call(Zotero.Utilities, elements, xpath, namespaces);
    } catch (e: any) {
      Zotero.debug(`xpath error (skipped): ${e.message} for "${xpath}"`, 2);
      return [];
    }
  };

  // 7. Initialize debug logging (disabled by default to avoid noisy output)
  Zotero.Debug.init(options?.debug ?? false);

  // 7. Initialize translator cache
  await Zotero.Translators.init();

  // 8. Install collecting ItemSaver (after translate framework is loaded)
  installItemSaver(Zotero);

  _zotero = Zotero;
  _initialized = true;
}

/**
 * Get the initialized Zotero object. Throws if not initialized.
 */
export function getZotero(): any {
  if (!_initialized) {
    throw new Error('Translator engine not initialized. Call initTranslatorEngine() first.');
  }
  return _zotero;
}

/**
 * Check if the translator engine is initialized.
 */
export function isInitialized(): boolean {
  return _initialized;
}
