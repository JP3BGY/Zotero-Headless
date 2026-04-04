/**
 * Add by Identifier API
 *
 * 通过 DOI、ISBN、arXiv、PMID、URL 等标识符添加文献
 */

import type {
  Item,
  Tag,
  BatchOptions,
  BatchResult,
  CreateItemInput,
} from './types.js';
import { ZoteroError, IdentifierNotFoundError, ValidationError } from './errors.js';
import { createItem, updateItem } from './items.js';
import { IdentifierParser, extractDenormalizedColumns } from '@zotero-headless/types';
import type { Identifier } from '@zotero-headless/types';
import { BATCH_CREATE_LIMIT } from './batch.js';
import { BatchLimitError } from './errors.js';

// ============ 类型定义 ============

export interface AddByIdOptions {
  /** Additional tags to apply to the created item */
  tags?: Tag[];
  /** Collections to add the item to */
  collections?: string[];
  /** If true, return preview without writing to DB */
  dryRun?: boolean;
}

export interface AddByIdResult {
  key: string;
  item: Item;
  identifier: Identifier;
  source: 'search' | 'web' | 'plugin';
}

export type BatchAddByIdOptions = BatchOptions & {
  /** Per-item tags applied to all */
  tags?: Tag[];
  /** Per-item collections applied to all */
  collections?: string[];
};

// ============ 延迟加载 ============

let translatorModule: any;
async function getTranslator() {
  if (!translatorModule) {
    translatorModule = await import('@zotero-headless/translator');
  }
  return translatorModule;
}

// ============ 主函数 ============

/**
 * 通过标识符添加文献
 *
 * 接受原始字符串（自动解析）或预解析的 Identifier 对象。
 * 支持 DOI、ISBN、arXiv、PMID、URL。
 */
export async function addById(
  input: string | Identifier,
  options?: AddByIdOptions,
): Promise<AddByIdResult> {
  // 1. Parse identifier
  let identifier: Identifier;
  if (typeof input === 'string') {
    const identifiers = IdentifierParser.parse(input);
    if (identifiers.length === 0) {
      throw new ValidationError('No identifiers found in input', 'input');
    }
    if (identifiers.length > 1) {
      throw new ValidationError(
        `Multiple identifiers found. Use batchAddById() for batch operations.`,
        'input',
        'Pass a single identifier, or use batchAddById() for multiple.',
      );
    }
    identifier = identifiers[0];
  } else {
    identifier = input;
  }

  // 2. Fetch metadata — 优先查找插件处理器
  let translatedItem: any = null;
  let source: 'search' | 'web' | 'plugin' = 'search';
  let pluginDbColumns: Record<string, any> | null = null;

  try {
    const { pluginRegistry } = await import('@zotero-headless/plugin');
    const processor = pluginRegistry.findContentProcessor(identifier);

    if (processor) {
      const processorContext = pluginRegistry.createProcessorContext(processor.name);
      const pluginResult = await processor.process(identifier, processorContext);
      source = 'plugin';

      if (pluginResult.format === 'db-columns') {
        pluginDbColumns = pluginResult.item;
      } else {
        translatedItem = pluginResult.item;
      }
    }
  } catch {
    // 插件系统不可用时静默降级
  }

  // 2b. Fallback to built-in translators if no plugin matched
  if (!translatedItem && !pluginDbColumns) {
    const { searchByIdentifier, translateFromUrl } = await getTranslator();

    try {
      if (identifier.type === 'url') {
        // URL path: try web translator, fallback to DOI extraction
        source = 'web';
        try {
          const items = await translateFromUrl(identifier.normalized);
          if (items.length > 0) translatedItem = items[0];
        } catch (webErr: any) {
          // Fallback: extract DOI from URL path
          const doiMatch = identifier.normalized.match(/\/(10\.\d{4,9}\/[^\s?#]+)/);
          if (doiMatch) {
            const fullCandidate = doiMatch[1].replace(/\/+$/, '');
            const segments = fullCandidate.split('/');
            for (let len = segments.length; len >= 2; len--) {
              const candidate = segments.slice(0, len).join('/');
              try {
                const items = await searchByIdentifier({ DOI: candidate });
                if (items.length > 0) {
                  translatedItem = items[0];
                  source = 'search';
                  break;
                }
              } catch { /* try shorter candidate */ }
            }
          }
          if (!translatedItem) throw webErr;
        }
      } else {
        // DOI, ISBN, PMID, arXiv: use search translator
        const searchParam: Record<string, string> = {};
        switch (identifier.type) {
          case 'doi': searchParam.DOI = identifier.normalized; break;
          case 'isbn': searchParam.ISBN = identifier.normalized; break;
          case 'pmid': searchParam.PMID = identifier.normalized; break;
          case 'arxiv': searchParam.arXiv = identifier.normalized; break;
          default: searchParam.DOI = identifier.normalized; break;
        }
        const items = await searchByIdentifier(searchParam);
        if (items.length > 0) translatedItem = items[0];
      }
    } catch (error) {
      if (error instanceof ZoteroError) throw error;
      throw new IdentifierNotFoundError(
        identifier.type.toUpperCase(),
        identifier.normalized,
      );
    }
  }

  if (!translatedItem && !pluginDbColumns) {
    throw new IdentifierNotFoundError(
      identifier.type.toUpperCase(),
      identifier.normalized,
    );
  }

  // 3. Handle plugin db-columns format (bypass translator pipeline)
  if (pluginDbColumns) {
    const result = await createItem(pluginDbColumns as any, { dryRun: options?.dryRun });
    if (!options?.dryRun) {
      await runPostProcessors(result.key, result.item, source);
    }
    return { key: result.key, item: result.item, identifier, source };
  }

  // 4. Clean translator result
  const zoteroData = { ...translatedItem };
  delete zoteroData.itemID;
  delete zoteroData.seeAlso;
  delete zoteroData.attachments;

  // 5. Merge user-specified tags and collections
  if (options?.tags?.length) {
    const existingTags = zoteroData.tags || [];
    zoteroData.tags = [...existingTags, ...options.tags];
  }
  if (options?.collections?.length) {
    const existingCols = zoteroData.collections || [];
    zoteroData.collections = [...existingCols, ...options.collections];
  }

  // 6. Create item (or preview)
  const createInput: CreateItemInput = zoteroData;
  const result = await createItem(createInput, { dryRun: options?.dryRun });

  if (!options?.dryRun) {
    await runPostProcessors(result.key, result.item, source);
  }

  return { key: result.key, item: result.item, identifier, source };
}

/**
 * 执行已注册的 after-create 后置处理器
 */
async function runPostProcessors(
  key: string,
  item: Item,
  source: string,
): Promise<void> {
  try {
    const { pluginRegistry } = await import('@zotero-headless/plugin');
    const postProcessors = pluginRegistry.getPostProcessors('after-create');
    if (postProcessors.length === 0) return;

    const postItem = {
      key,
      itemType: item.itemType || '',
      title: item.title || null,
      tags: item.tags || [],
      creators: typeof item.creators === 'string' ? item.creators : JSON.stringify(item.creators || []),
      collectionKeys: item.collections || [],
      url: item.url || null,
      doi: item.DOI || null,
      source,
    };

    for (const pp of postProcessors) {
      try {
        const context = pluginRegistry.createProcessorContext(pp.name);
        const actions = await pp.process(postItem, context as any);

        for (const action of actions) {
          if (action.type === 'add-tags' && action.tags.length > 0) {
            const mergedTags = [...(postItem.tags as any[]), ...action.tags];
            await updateItem(key, { tags: mergedTags });
            postItem.tags = mergedTags;
          } else if (action.type === 'add-to-collection') {
            const cols = postItem.collectionKeys as string[];
            if (!cols.includes(action.collectionKey)) {
              cols.push(action.collectionKey);
              await updateItem(key, { collections: cols });
            }
          }
        }
      } catch {
        // 后置处理器失败不应阻塞主流程
      }
    }
  } catch {
    // 插件系统不可用时静默跳过
  }
}

/**
 * 批量通过标识符添加文献
 */
export async function batchAddById(
  inputs: Array<string | Identifier>,
  options?: BatchAddByIdOptions,
): Promise<BatchResult> {
  if (inputs.length > BATCH_CREATE_LIMIT) {
    throw new BatchLimitError(inputs.length, BATCH_CREATE_LIMIT);
  }

  const succeeded: string[] = [];
  const failed: BatchResult['failed'] = [];
  const concurrency = options?.concurrency ?? 1;

  const addByIdOptions: AddByIdOptions = {
    tags: options?.tags,
    collections: options?.collections,
  };

  const processInput = async (input: string | Identifier, _i: number) => {
    const inputStr = typeof input === 'string' ? input : input.value;
    try {
      const result = await addById(input, addByIdOptions);
      succeeded.push(result.key);
    } catch (error) {
      const entry: BatchResult['failed'][number] = {
        key: inputStr,
        error: error instanceof Error ? error.message : String(error),
      };
      if (error instanceof ZoteroError) {
        entry.code = error.code;
        entry.recoverable = error.recoverable;
        entry.suggestion = error.suggestion;
      }
      failed.push(entry);

      if (!options?.continueOnError) {
        throw error;
      }
    }

    if (options?.onProgress) {
      const current = succeeded.length + failed.length;
      options.onProgress({
        current,
        total: inputs.length,
        currentItem: inputStr,
        succeeded: succeeded.length,
        failed: failed.length,
        percentage: Math.round((current / inputs.length) * 100),
      });
    }
  };

  // Sequential execution with early break support
  for (let i = 0; i < inputs.length; i++) {
    try {
      await processInput(inputs[i], i);
    } catch {
      if (!options?.continueOnError) break;
    }
  }

  return { succeeded, failed, total: inputs.length };
}
