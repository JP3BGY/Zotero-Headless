// @ts-nocheck

// File-based Zotero.Translators implementation.
// Scans the translators directory, parses JSON headers, caches metadata.

import fs from 'node:fs';
import path from 'node:path';

// Regex to extract JSON metadata header from translator files
const INFO_RE = /^\s*\{[\S\s]*?\}\s*?[\r\n]/;

function parseTranslatorHeader(filePath: string): any | null {
  // Read only first 4KB for header detection — most headers are <2KB
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(4096);
  const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
  fs.closeSync(fd);

  const head = buf.toString('utf-8', 0, bytesRead);
  const match = head.match(INFO_RE);
  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/**
 * Install file-based Zotero.Translators implementation onto the Zotero object.
 */
export function installFileTranslators(Zotero: any, translatorsDir: string): void {
  const TRANSLATOR_TYPES: Record<string, number> = {
    import: 1, export: 2, web: 4, search: 8,
  };

  const _cache: Record<string, any[]> = { import: [], export: [], web: [], webWithTargetAll: [], search: [] };
  const _translators: Map<string, any> = new Map();
  let _initialized = false;

  const impl = {
    _cache,
    _initialized: false,

    async init() {
      if (_initialized) return;

      // Scan all .js files in translators directory
      const files = fs.readdirSync(translatorsDir).filter(f => f.endsWith('.js'));

      for (const file of files) {
        const filePath = path.join(translatorsDir, file);
        try {
          const info = parseTranslatorHeader(filePath);
          if (!info || !info.translatorID) continue;

          // Store the file path for lazy code loading
          info._filePath = filePath;
          const translator = new Zotero.Translator(info);
          translator._filePath = filePath;
          _translators.set(translator.translatorID, translator);

          for (const type in TRANSLATOR_TYPES) {
            if (translator.translatorType & TRANSLATOR_TYPES[type]) {
              _cache[type].push(translator);
            }
          }
          // Web translators with targetAll go into a separate cache for frame matching
          if ((translator.translatorType & TRANSLATOR_TYPES.web) && translator.targetAll) {
            _cache.webWithTargetAll.push(translator);
          }
        } catch (e) {
          // Skip invalid translators silently
        }
      }

      // Sort by priority (lower = higher priority)
      for (const type in _cache) {
        _cache[type].sort((a: any, b: any) => a.priority - b.priority);
      }

      _initialized = true;
      impl._initialized = true;
    },

    get: async function (id: string) {
      if (!_initialized) await impl.init();
      const translator = _translators.get(id);
      if (!translator) return false;

      if (!translator.code && translator._filePath) {
        translator.code = fs.readFileSync(translator._filePath, 'utf-8');
      }
      return translator;
    },

    getCodeForTranslator: Zotero.Promise.method(function (translator: any) {
      if (translator.code) return translator.code;
      if (translator._filePath) {
        translator.code = fs.readFileSync(translator._filePath, 'utf-8');
        return translator.code;
      }
      throw new Error(`No code available for translator ${translator.translatorID}`);
    }),

    getAllForType: async function (type: string) {
      if (!_initialized) await impl.init();
      const translators = _cache[type].slice(0);
      const codeGetter = new Zotero.Translators.CodeGetter(translators);
      await codeGetter.getAll();
      return translators;
    },

    // Prioritize translators whose importRegexp matches the file path
    getImportTranslatorsForLocation: async function (location: string) {
      const all = await impl.getAllForType('import');
      const tier1: any[] = [];
      const tier2: any[] = [];
      for (const t of all) {
        if (t.importRegexp && t.importRegexp.test(location)) {
          tier1.push(t);
        } else {
          tier2.push(t);
        }
      }
      return tier1.concat(tier2);
    },

    // Match web translators by URL regex against the page location
    getWebTranslatorsForLocation: async function (URI: string, rootURI?: string) {
      const isFrame = URI !== rootURI;
      const type = isFrame ? 'webWithTargetAll' : 'web';

      const allTranslators = await impl.getAllForType(type);
      const potentialTranslators: any[] = [];
      const proxies: any[] = [];

      // Zotero.Proxies.getPotentialProxies returns { url: proxyOrNull }
      const rootSearchURIs = Zotero.Proxies.getPotentialProxies(rootURI || URI);
      const frameSearchURIs = isFrame ? Zotero.Proxies.getPotentialProxies(URI) : rootSearchURIs;

      for (const translator of allTranslators) {
        rootURIsLoop:
        for (const rootSearchURI in rootSearchURIs) {
          const isGeneric = !translator.webRegexp.root;
          const rootURIMatches = isGeneric || (rootSearchURI.length < 8192 && translator.webRegexp.root.test(rootSearchURI));

          if (translator.webRegexp.all && rootURIMatches) {
            for (const frameSearchURI in frameSearchURIs) {
              if (frameSearchURI.length < 8192 && translator.webRegexp.all.test(frameSearchURI)) {
                potentialTranslators.push(translator);
                proxies.push(frameSearchURIs[frameSearchURI]);
                break rootURIsLoop;
              }
            }
          } else if (!isFrame && (isGeneric || rootURIMatches)) {
            potentialTranslators.push(translator);
            proxies.push(rootSearchURIs[rootSearchURI]);
            break;
          }
        }
      }

      return [potentialTranslators, proxies];
    },
  };

  // Override the Zotero.Translators singleton
  Object.assign(Zotero.Translators, impl);
}
