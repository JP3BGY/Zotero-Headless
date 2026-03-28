// @ts-nocheck

// Loads the Zotero translate framework CJS files into a single Zotero object.
// The framework files are designed to run as sequential <script> tags modifying a global Zotero.
// We replicate this by reading each file and executing it via new Function().

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);

/**
 * Execute a framework JS file in a scope where Zotero and other globals are available.
 */
function execFile(filePath: string, context: Record<string, any>): void {
  const code = fs.readFileSync(filePath, 'utf-8');
  execCode(code, context, filePath);
}

function execCode(code: string, context: Record<string, any>, sourceUrl?: string): void {
  const suffix = sourceUrl ? `\n//# sourceURL=${sourceUrl}` : '';
  // The framework files expect these names in their scope.
  // Shadow Node.js CJS globals (module, exports, require, __filename, __dirname) with undefined
  // so that files like utilities.js and cachedTypes.js take the browser-style path
  // (assigning to Zotero.*) instead of the CJS path (module.exports = ...).
  const fn = new Function(
    'Zotero', 'ZOTERO_CONFIG', 'ZOTERO_TYPE_SCHEMA',
    'DOMParser', 'XPathResult', 'XRegExp',
    'console', 'setTimeout', 'clearTimeout', 'Promise',
    'XMLHttpRequest', 'window', 'document', 'navigator',
    'OS',
    'TRANSLATOR_TYPES', 'TRANSLATOR_REQUIRED_PROPERTIES', 'TRANSLATOR_CACHING_PROPERTIES',
    'module', 'exports', 'require', '__filename', '__dirname', 'process',
    code + suffix
  );
  // Shadow all CJS/Node globals as undefined so framework files take the
  // browser-style code path (assigning to Zotero.*) instead of using
  // module.exports. The guards are `typeof module !== 'undefined'` and
  // `typeof process === 'object'` — both evaluate to false with undefined params.
  fn.call(
    context,
    context.Zotero, context.ZOTERO_CONFIG, context.ZOTERO_TYPE_SCHEMA,
    context.DOMParser, context.XPathResult, context.XRegExp,
    console, setTimeout, clearTimeout, Promise,
    context.XMLHttpRequest, context.window, context.document, context.navigator,
    context.OS,
    context.TRANSLATOR_TYPES, context.TRANSLATOR_REQUIRED_PROPERTIES, context.TRANSLATOR_CACHING_PROPERTIES,
    undefined, undefined, undefined, undefined, undefined, undefined,
  );
}

/**
 * Load the Zotero translate framework and return the assembled Zotero object.
 * @param frameworkDir - Path to references/zotero-connectors/src/translate/
 */
export function loadFramework(frameworkDir: string): any {
  const src = (p: string) => path.join(frameworkDir, p);
  const mod = (p: string) => path.join(frameworkDir, 'modules/utilities', p);

  // --- 1. Load xregexp as CJS module ---
  const XRegExp = require(path.join(frameworkDir, 'modules/utilities/xregexp-all.js'));

  // --- 2. Load type schema as CJS module ---
  const ZOTERO_TYPE_SCHEMA = require(path.join(frameworkDir, 'modules/utilities/resource/zoteroTypeSchemaData.js'));

  // --- 3. Build context with globals ---
  const context: Record<string, any> = {
    Zotero: undefined, // will be created by zotero.js
    ZOTERO_CONFIG: {
      REPOSITORY_URL: 'https://www.zotero.org/repo/',
      REPOSITORY_CHECK_INTERVAL: 86400,
      REPOSITORY_RETRY_INTERVAL: 3600,
      REPOSITORY_CHANNEL: 'trunk',
    },
    ZOTERO_TYPE_SCHEMA,
    // Use jsdom's DOMParser for text/html support (web translators need it).
    // Fall back to xmldom for text/xml (used by RDF import and parseDOMXML).
    DOMParser: new JSDOM('').window.DOMParser,
    XPathResult: new JSDOM('').window.XPathResult,
    XRegExp,
    XMLHttpRequest: class XMLHttpRequest {}, // stub, not needed for Import/Search
    window: {},
    document: undefined,
    navigator: { userAgent: 'zotero-headless' },
    OS: { Path: { basename: path.basename } },
    TRANSLATOR_TYPES: { "import": 1, "export": 2, "web": 4, "search": 8 },
    TRANSLATOR_REQUIRED_PROPERTIES: [
      "translatorID", "translatorType", "label", "creator",
      "target", "priority", "lastUpdated"
    ],
    TRANSLATOR_CACHING_PROPERTIES: [
      "translatorID", "translatorType", "label", "creator",
      "target", "priority", "lastUpdated", "browserSupport", "targetAll"
    ],
  };

  // --- 4. Load seed Zotero object (zotero.js creates `var Zotero = new function()`) ---
  // We need to capture the Zotero variable it creates. zotero.js uses `var Zotero = ...`
  // which creates a local. We need to extract it.
  // Strategy: wrap the code to assign to our context.
  const zoteroJsCode = fs.readFileSync(src('src/zotero.js'), 'utf-8');
  // zotero.js defines `var Zotero = new function() { ... }` and `Zotero.Prefs = ...`
  // Execute it and capture the result by appending an assignment
  const wrappedZoteroJs = zoteroJsCode + '\nreturn Zotero;';
  const zoteroFn = new Function(
    'setTimeout', 'console', 'Map',
    wrappedZoteroJs
  );
  context.Zotero = zoteroFn(setTimeout, console, Map);

  // --- 5. Load framework files in order ---
  // promise.js
  execFile(src('src/promise.js'), context);

  // Utilities
  execFile(mod('openurl.js'), context);
  execFile(mod('date.js'), context);

  // xregexp-unicode-zotero.js needs XRegExp in scope and calls addZoteroUnicodeData
  const xregexpUnicodeCode = fs.readFileSync(mod('xregexp-unicode-zotero.js'), 'utf-8');
  // This file defines an IIFE that checks for window/module. We need to inject XRegExp.
  // The file assigns to window.addZoteroUnicodeData or module.exports, then calls it.
  // Simplest: execute it and it will find XRegExp in scope if we provide it.
  // But the file expects `XRegExp` as a global or via require. Let's just call the function directly.
  // The IIFE self-invokes with XRegExp from global scope. Since we pass XRegExp in the context, it works.
  // Actually, looking at the code, it does: `if (typeof module !== 'undefined') { module.exports = addZoteroUnicodeData; }`
  // and `if (typeof XRegExp !== 'undefined') { addZoteroUnicodeData(XRegExp); }`
  // In our execution, XRegExp is in scope, so it will be called automatically.
  execCode(xregexpUnicodeCode, context, mod('xregexp-unicode-zotero.js'));

  // utilities.js — needs XRegExp in Zotero scope
  // utilities.js checks `typeof XRegExp !== 'undefined'` at the top level
  execFile(mod('utilities.js'), context);

  // utilities_item.js
  execFile(mod('utilities_item.js'), context);

  // schema.js
  execFile(mod('schema.js'), context);

  // cachedTypes.js — uses ZOTERO_TYPE_SCHEMA from context
  execFile(mod('cachedTypes.js'), context);

  // utilities_translate.js
  execFile(src('src/utilities_translate.js'), context);

  // debug.js
  execFile(src('src/debug.js'), context);

  // translator.js
  execFile(src('src/translator.js'), context);

  // translators.js (base interface — we override later)
  execFile(src('src/translators.js'), context);

  // repo.js
  execFile(src('src/repo.js'), context);

  // Main translate engine
  execFile(src('src/translation/translate.js'), context);

  // sandboxManager.js
  execFile(src('src/translation/sandboxManager.js'), context);

  // translate_item.js
  execFile(src('src/translation/translate_item.js'), context);

  // tlds.js
  execFile(src('src/tlds.js'), context);

  // proxy.js
  execFile(src('src/proxy.js'), context);

  // --- 6. Load RDF subsystem via Node.js require ---
  // rdf/init.js is loaded via native require() and references Zotero as a global.
  // Temporarily expose Zotero on globalThis so the CJS files can find it.
  const prevGlobalZotero = (globalThis as any).Zotero;
  (globalThis as any).Zotero = context.Zotero;
  try {
    const $rdf = require(path.join(frameworkDir, 'src/rdf/init.js'));
    // In the Node.js branch, init.js exports $rdf but may not set Zotero.RDF
    if (!context.Zotero.RDF) {
      context.Zotero.RDF = { AJAW: $rdf };
    }
  } finally {
    // Restore previous global state
    if (prevGlobalZotero === undefined) {
      delete (globalThis as any).Zotero;
    } else {
      (globalThis as any).Zotero = prevGlobalZotero;
    }
  }

  return context.Zotero;
}
