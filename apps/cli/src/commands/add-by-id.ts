// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getDb, getItems, getLibraries, getAttachments, getWebdavConfig, getAttachmentManager, getPluginRegistry } from '../modules.js';
import { generateKey, getContentType } from '../utils.js';
import { symbols } from '@zotero-headless/core';
import { extractDenormalizedColumns } from '@zotero-headless/types';
import { searchByIdentifier, translateFromUrl } from '@zotero-headless/translator';
import type { ProcessorResult, ProcessorAttachment } from '@zotero-headless/plugin';

// Result type for unified processing
interface FetchResult {
  identifier: { type: string; value: string };
  item: any | null;       // Zotero API format item (from translator)
  error?: string;
  extra?: any;            // WeChat-specific extra data
}

export async function executeAddById(args: string[]) {
      // Parse arguments for attachments
      const attachmentPaths: string[] = [];
      const otherArgs: string[] = [];

      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '-a' || arg === '--attachment') {
          if (i + 1 < args.length) {
            attachmentPaths.push(args[++i]);
          }
        } else {
          otherArgs.push(arg);
        }
      }

      if (otherArgs.length === 0) {
        console.log(`
${symbols.error} 请提供至少一个标识符

用法: zotero add byid <identifier> [identifier2 ...] [-a/--attachment <path>...]

支持的标识符类型:
  • DOI    - 如 10.1007/s11263-019-01228-7
  • ISBN   - 如 978-3-642-15515-4
  • PMID   - 如 1234567
  • arXiv  - 如 2001.12345
  • URL    - 任意网页 URL（使用 Zotero Web Translator）
  • 微信文章 URL - 如 https://mp.weixin.qq.com/s/...

选项:
  -a, --attachment <path>  添加附件文件（可多次使用）

WebDAV 同步:
  微信文章会自动生成 Snapshot 附件，可通过以下方式同步到 WebDAV:

  1. 手动同步: 运行 zotero webdav sync
  2. 自动同步: 配置 autoSync (见下文)

  配置自动同步:
    zotero webdav config <url> <username> <password> --auto-sync

  查看 WebDAV 状态:
    zotero webdav status

示例:
  zotero add byid "10.1007/s11263-019-01228-7"
  zotero add byid "978-3-642-15515-4"
  zotero add byid "1234567"
  zotero add byid "https://en.wikipedia.org/wiki/Deep_learning"
  zotero add byid "https://mp.weixin.qq.com/s/xxxxx"
  zotero add byid "10.1007/xyz" -a /path/to/supplemental.pdf
  zotero add byid "10.1007/xyz" -a file1.pdf -a file2.pdf
        `);
        return;
      }

      await initModules();
      const input = otherArgs.join(' ');

      // Validate attachment paths
      const fs = await import('fs');
      const path = await import('path');
      const validAttachments: string[] = [];
      for (const attPath of attachmentPaths) {
        if (fs.existsSync(attPath)) {
          validAttachments.push(attPath);
        } else {
          console.log(`!  Attachment not found: ${attPath}`);
        }
      }

      try {
        console.log('正在解析标识符...\n');

        const { IdentifierParser } = await import('../identifier/index.js');
        const identifiers = IdentifierParser.parse(input);
        console.log(`找到 ${identifiers.length} 个标识符`);
        identifiers.forEach((id, index) => {
          console.log(`   ${index + 1}. ${id.type.toUpperCase()}: ${id.value}`);
        });

        // Fetch metadata using translator framework
        console.log('\n正在获取元数据...');
        const results: FetchResult[] = [];

        for (const identifier of identifiers) {
          try {
            let item: any = null;
            let extra: any = undefined;
            let pluginResult: ProcessorResult | null = null;

            // 优先查找插件处理器
            const registry = getPluginRegistry();
            const processor = registry?.findContentProcessor(identifier);

            if (processor) {
              // 使用插件处理
              const processorContext = registry.createProcessorContext(processor.name);
              pluginResult = await processor.process(identifier, processorContext);
              if (pluginResult.format === 'db-columns') {
                item = pluginResult.item;
                extra = { pluginAttachments: pluginResult.attachments, isPluginResult: true };
              } else {
                // zotero-api format
                item = pluginResult.item;
              }
            } else if (identifier.type === 'url') {
              // Generic URL: try web translator, fall back to DOI extraction
              try {
                const items = await translateFromUrl(identifier.normalized);
                if (items.length > 0) item = items[0];
              } catch (webErr: any) {
                // Web translation failed — try extracting DOI from URL path as fallback
                // DOI pattern: 10.xxxx/suffix, but URL may have extra path segments after the DOI
                // e.g. /doi/10.1093/bioinformatics/btae038/7585532 → try progressively shorter candidates
                const doiMatch = identifier.normalized.match(/\/(10\.\d{4,9}\/[^\s?#]+)/);
                if (doiMatch) {
                  const fullCandidate = doiMatch[1].replace(/\/+$/, '');
                  const segments = fullCandidate.split('/');
                  // Try from longest to shortest: 10.1093/bioinformatics/btae038/7585532, then .../btae038, etc.
                  for (let len = segments.length; len >= 2; len--) {
                    const candidate = segments.slice(0, len).join('/');
                    console.log(`      Web 翻译失败，尝试 DOI: ${candidate} ...`);
                    try {
                      const items = await searchByIdentifier({ DOI: candidate });
                      if (items.length > 0) { item = items[0]; break; }
                    } catch { /* try shorter candidate */ }
                  }
                }
                if (!item) throw webErr; // re-throw if all fallbacks failed
              }
            } else {
              // DOI, ISBN, PMID, arXiv: use search translator
              const searchParam: any = {};
              switch (identifier.type) {
                case 'doi': searchParam.DOI = identifier.normalized; break;
                case 'isbn': searchParam.ISBN = identifier.normalized; break;
                case 'pmid': searchParam.PMID = identifier.normalized; break;
                case 'arxiv': searchParam.arXiv = identifier.normalized; break;
              }
              const items = await searchByIdentifier(searchParam);
              if (items.length > 0) item = items[0];
            }

            if (item) {
              console.log(`   ${symbols.success} ${identifier.type.toUpperCase()}: ${identifier.value}`);
              results.push({ identifier, item, extra });
            } else {
              console.log(`   ${symbols.error} ${identifier.type.toUpperCase()}: ${identifier.value} - 未找到元数据`);
              results.push({ identifier, item: null, error: '未找到元数据' });
            }
          } catch (error: any) {
            console.log(`   ${symbols.error} ${identifier.type.toUpperCase()}: ${identifier.value} - ${error.message}`);
            results.push({ identifier, item: null, error: error.message });
          }
        }

        // Summary
        const successCount = results.filter(r => r.item).length;
        const failCount = results.filter(r => !r.item).length;

        console.log(`\n结果摘要:`);
        console.log(`   ${symbols.success} 成功: ${successCount}`);
        console.log(`   ${symbols.error} 失败: ${failCount}`);

        // Write to database
        if (successCount > 0) {
          console.log('\n写入本地数据库...');
          const db = getDb()();
          const items = getItems();
          const libraries = getLibraries();
          const attachments = getAttachments();
          const webdavConfig = getWebdavConfig();
          const library = await db.select().from(libraries).get();

          if (!library) {
            console.log(`${symbols.error} 未找到文献库。请先运行 "zotero sync"`);
            return;
          }

          for (const result of results) {
            if (!result.item) continue;

            const itemKey = generateKey();
            const now = Math.floor(Date.now() / 1000);

            // Determine if item is from plugin (db-columns) or translator (Zotero API format)
            const isPluginDbColumns = result.extra?.isPluginResult;

            let dbValues: any;
            if (isPluginDbColumns) {
              // Plugin returned data in DB column format
              dbValues = {
                key: itemKey,
                libraryId: library.id,
                version: 0,
                synced: false,
                deleted: false,
                createdAt: now,
                updatedAt: now,
                ...result.item,
                rawJson: JSON.stringify({ data: result.item }),
              };
            } else {
              // Translator items are in Zotero API format — use extractDenormalizedColumns
              const zoteroData = { ...result.item };
              // Remove framework-internal fields not needed in DB
              delete zoteroData.itemID;
              delete zoteroData.seeAlso;
              delete zoteroData.attachments;

              const denormalized = extractDenormalizedColumns(zoteroData);
              dbValues = {
                key: itemKey,
                libraryId: library.id,
                version: 0,
                synced: false,
                deleted: false,
                createdAt: now,
                updatedAt: now,
                ...denormalized,
                rawJson: JSON.stringify({ data: zoteroData }),
              };
            }

            await db.insert(items).values(dbValues).run();
            const displayTitle = dbValues.title?.substring(0, 50) || result.item.title?.substring(0, 50) || '(无标题)';
            console.log(`   已添加: ${displayTitle}...`);

            // 处理插件附件
            if (isPluginDbColumns && result.extra?.pluginAttachments?.length) {
              const pluginAttachments = result.extra.pluginAttachments as ProcessorAttachment[];
              for (const att of pluginAttachments) {
                const attContent = typeof att.content === 'string' ? att.content : att.content.toString('utf-8');
                console.log(`   创建插件附件: ${att.title}...`);

                const crypto = await import('crypto');
                const contentHash = crypto.createHash('md5').update(attContent).digest('hex').substring(0, 16);
                const ext = att.contentType === 'text/html' ? '.html' : '';
                const uniqueFilename = `${contentHash}${ext}`;
                const attKey = generateKey();

                const { appConfig } = await import('@zotero-headless/core');
                const saveDir = path.join(appConfig.dataDir, 'downloads');
                if (!fs.existsSync(saveDir)) {
                  fs.mkdirSync(saveDir, { recursive: true });
                }

                const filePath = path.join(saveDir, uniqueFilename);
                fs.writeFileSync(filePath, attContent);

                const accessDate = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
                const sourceUrl = att.sourceUrl || '';

                const attRawJson = {
                  data: {
                    key: attKey,
                    itemType: 'attachment',
                    title: att.title,
                    filename: uniqueFilename,
                    contentType: att.contentType,
                    charset: 'utf-8',
                    parentItem: itemKey,
                    linkMode: att.linkMode || 'imported_url',
                    url: sourceUrl,
                    accessDate: accessDate,
                  },
                };

                await db.insert(items).values({
                  key: attKey,
                  libraryId: library.id,
                  version: 0,
                  synced: false,
                  deleted: false,
                  createdAt: now,
                  updatedAt: now,
                  itemType: 'attachment',
                  title: att.title,
                  url: sourceUrl,
                  rawJson: JSON.stringify(attRawJson),
                }).run();

                await db.insert(attachments).values({
                  key: attKey,
                  parentItemKey: itemKey,
                  libraryId: library.id,
                  filename: uniqueFilename,
                  contentType: att.contentType,
                  fileType: ext || path.extname(uniqueFilename).toLowerCase(),
                  path: filePath,
                  version: 0,
                  createdAt: now,
                  updatedAt: now,
                  deleted: false,
                  size: attContent.length,
                  webdavSynced: false,
                  rawJson: JSON.stringify(attRawJson),
                }).run();

                console.log(`      ${symbols.success} ${att.title}: ${uniqueFilename} (${(attContent.length / 1024).toFixed(1)} KB)`);
              }
            }

            // Add attachments if provided
            if (validAttachments.length > 0) {
              console.log(`   添加 ${validAttachments.length} 个附件...`);

              const addedAttKeys: string[] = [];

              for (const attPath of validAttachments) {
                const filename = path.basename(attPath);
                const stats = fs.statSync(attPath);
                const attKey = generateKey();
                addedAttKeys.push(attKey);

                await db.insert(attachments).values({
                  key: attKey,
                  parentItemKey: itemKey,
                  libraryId: library.id,
                  filename: filename,
                  contentType: getContentType(filename),
                  fileType: path.extname(filename).toLowerCase(),
                  path: attPath,
                  version: 0,
                  createdAt: now,
                  updatedAt: now,
                  deleted: false,
                  size: stats.size,
                  webdavSynced: false,
                  rawJson: JSON.stringify({
                    data: {
                      itemType: 'attachment',
                      title: filename,
                      filename: filename,
                      contentType: getContentType(filename),
                      parentItem: itemKey,
                      linkMode: 'linked_file'
                    }
                  }),
                }).run();

                console.log(`      ${symbols.success} ${filename} (${(stats.size / 1024).toFixed(1)} KB)`);
              }

              const wdc = await db.select().from(webdavConfig).get();
              if (wdc?.autoSync && addedAttKeys.length > 0) {
                console.log(`      自动同步 ${addedAttKeys.length} 个附件到 WebDAV...`);
                console.log(`      父条目将在下次 sync 时上传到 Zotero`);
                let syncCount = 0;
                let failCount = 0;
                for (const attKey of addedAttKeys) {
                  try {
                    const syncResult = await getAttachmentManager().syncToWebDAV(attKey);
                    if (syncResult.success) {
                      syncCount++;
                    } else {
                      failCount++;
                      console.log(`         !  ${attKey}: ${syncResult.error}`);
                    }
                  } catch (e: any) {
                    failCount++;
                    console.log(`         !  ${attKey}: ${e.message}`);
                  }
                }
                if (syncCount > 0) {
                  console.log(`      ${symbols.success} ${syncCount} 个附件已上传`);
                }
                if (failCount > 0) {
                  console.log(`      !  ${failCount} 个附件上传失败，运行 "zotero webdav sync" 重试`);
                }
              } else if (!wdc?.autoSync && addedAttKeys.length > 0) {
                console.log(`      运行 "zotero webdav sync" 上传这些附件`);
              }
            }

            // 执行后置处理器
            const postProcessors = registry?.getPostProcessors('after-create') ?? [];
            if (postProcessors.length > 0) {
              const { eq } = await import('drizzle-orm');
              const postItem = {
                key: itemKey,
                itemType: dbValues.itemType || '',
                title: dbValues.title || null,
                tags: (() => { try { return JSON.parse(dbValues.tags || '[]'); } catch { return []; } })(),
                creators: dbValues.creators || '[]',
                collectionKeys: (() => { try { return JSON.parse(dbValues.collectionKeys || '[]'); } catch { return []; } })(),
                url: dbValues.url || null,
                doi: dbValues.doi || null,
                source: pluginResult?.source,
              };
              for (const pp of postProcessors) {
                try {
                  const actions = await pp.process(postItem, registry.createProcessorContext(pp.name));
                  for (const action of actions) {
                    if (action.type === 'add-tags') {
                      const merged = [...postItem.tags, ...action.tags];
                      await db.update(items).set({
                        tags: JSON.stringify(merged),
                        updatedAt: Math.floor(Date.now() / 1000),
                      }).where(eq(items.key, itemKey)).run();
                      postItem.tags = merged;
                      console.log(`      ${symbols.success} [${pp.name}] 添加标签: ${action.tags.map(t => t.tag).join(', ')}`);
                    } else if (action.type === 'add-to-collection') {
                      if (!postItem.collectionKeys.includes(action.collectionKey)) {
                        postItem.collectionKeys.push(action.collectionKey);
                        await db.update(items).set({
                          collectionKeys: JSON.stringify(postItem.collectionKeys),
                          updatedAt: Math.floor(Date.now() / 1000),
                        }).where(eq(items.key, itemKey)).run();
                        console.log(`      ${symbols.success} [${pp.name}] 添加到集合: ${action.collectionKey}`);
                      }
                    }
                  }
                } catch (ppErr: any) {
                  console.log(`      !  [${pp.name}] 后置处理失败: ${ppErr.message}`);
                }
              }
            }
          }

          console.log(`\n成功添加 ${successCount} 个文献到本地数据库！`);
          if (validAttachments.length > 0) {
            console.log(`   共添加 ${validAttachments.length} 个附件`);
          }
          console.log('运行 "zotero sync" 同步到 Zotero 服务器');
        }

        // Show failure details
        if (failCount > 0) {
          console.log('\n! 失败的标识符:');
          results.filter(r => !r.item).forEach((result, index) => {
            console.log(`   ${index + 1}. ${result.identifier.value}`);
            console.log(`     原因: ${result.error}`);
          });
        }

      } catch (error) {
        console.log(`\n${symbols.error} 添加失败: ${error}`);
        console.log('\n请检查:');
        console.log('   1. 标识符格式是否正确');
        console.log('   2. 网络连接是否正常');
      }
}

// Keep empty array - add-by-id is now a subcommand of 'add'
export const addByIdCommands: Command[] = [];
