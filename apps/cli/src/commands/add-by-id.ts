// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getDb, getItems, getLibraries, getAttachments, getWebdavConfig, getAttachmentManager } from '../modules.js';
import { generateKey, getContentType } from '../utils.js';
import { symbols } from '@zotero-headless/core';
import { extractDenormalizedColumns } from '@zotero-headless/types';
import { searchByIdentifier, translateFromUrl } from '@zotero-headless/translator';

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

            if (identifier.type === 'url' && (await import('../identifier/fetchers/wechat-fetcher.js')).WeChatFetcher.isWeChatURL(identifier.value)) {
              // WeChat: use dedicated fetcher (needs special HTML processing)
              const { WeChatFetcher } = await import('../identifier/fetchers/wechat-fetcher.js');
              const fetcher = new WeChatFetcher({ maxConcurrent: 1, timeout: 30000, retries: 2, cacheTTL: 0 });
              const result = await fetcher.fetchMetadata(identifier);
              item = result.item;
              extra = result.extra;
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

            // Determine if item is from WeChat (old format) or translator (Zotero API format)
            const isWeChatItem = result.extra?.isWeChatArticle;

            let dbValues: any;
            if (isWeChatItem) {
              // WeChat fetcher returns data in DB column format already
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

            // 处理微信文章的 snapshot 附件
            if (isWeChatItem && result.extra?.processedHtml) {
              console.log(`   创建微信文章 snapshot...`);

              const crypto = await import('crypto');
              const contentHash = result.extra.contentHash ||
                crypto.createHash('md5').update(result.extra.processedHtml).digest('hex').substring(0, 16);
              const uniqueFilename = `${contentHash}.html`;
              const attKey = generateKey();

              const { appConfig } = await import('@zotero-headless/core');
              const saveDir = path.join(appConfig.dataDir, 'downloads');
              if (!fs.existsSync(saveDir)) {
                fs.mkdirSync(saveDir, { recursive: true });
              }

              const htmlPath = path.join(saveDir, uniqueFilename);
              fs.writeFileSync(htmlPath, result.extra.processedHtml);

              const accessDate = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
              const sourceUrl = result.item.url || '';

              const attRawJson = {
                data: {
                  key: attKey,
                  itemType: 'attachment',
                  title: 'Snapshot',
                  filename: uniqueFilename,
                  contentType: 'text/html',
                  charset: 'utf-8',
                  parentItem: itemKey,
                  linkMode: 'imported_url',
                  url: sourceUrl,
                  accessDate: accessDate
                }
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
                title: 'Snapshot',
                url: sourceUrl,
                rawJson: JSON.stringify(attRawJson),
              }).run();

              await db.insert(attachments).values({
                key: attKey,
                parentItemKey: itemKey,
                libraryId: library.id,
                filename: uniqueFilename,
                contentType: 'text/html',
                fileType: '.html',
                path: htmlPath,
                version: 0,
                createdAt: now,
                updatedAt: now,
                deleted: false,
                size: result.extra.processedHtml.length,
                webdavSynced: false,
                rawJson: JSON.stringify(attRawJson),
              }).run();

              console.log(`      ${symbols.success} Snapshot: ${uniqueFilename} (${(result.extra.processedHtml.length / 1024).toFixed(1)} KB)`);

              const wdc = await db.select().from(webdavConfig).get();
              if (wdc?.autoSync) {
                console.log(`      自动同步到 WebDAV (autoSync enabled)...`);
                console.log(`      父条目将在下次 sync 时上传到 Zotero，然后附件自动关联`);
              } else {
                console.log(`      运行 "zotero sync" 上传条目，然后 "zotero webdav sync" 上传附件`);
                if (!wdc) {
                  console.log(`         或先配置: zotero webdav config <url> <user> <pass>`);
                }
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
