/**
 * WeChat Article Plugin
 *
 * 微信公众号文章内容处理器插件
 * 这是插件系统的参考实现，展示如何将内容处理器包装为插件
 */

import type {
  Plugin,
  ContentProcessor,
  ProcessorContext,
  ProcessorResult,
  PluginContext,
} from '@zotero-headless/plugin';
import type { Identifier } from '@zotero-headless/types';
import { WeChatFetcher } from './wechat-fetcher.js';

const wechatProcessor: ContentProcessor = {
  name: 'wechat',
  description: 'WeChat public account article processor (微信公众号文章处理器)',
  priority: 10,

  match(identifier: Identifier): boolean {
    return identifier.type === 'url' && identifier.value.includes('mp.weixin.qq.com');
  },

  async process(identifier: Identifier, context: ProcessorContext): Promise<ProcessorResult> {
    const timeout = (context.config.timeout as number) ?? 30000;
    const retries = (context.config.retries as number) ?? 2;

    const fetcher = new WeChatFetcher({ timeout, retries });
    const result = await fetcher.fetchMetadata(identifier.value);

    return {
      format: 'db-columns',
      item: result.item,
      attachments: result.processedHtml
        ? [
            {
              title: 'Snapshot',
              contentType: 'text/html',
              content: result.processedHtml,
              sourceUrl: identifier.value,
              linkMode: 'imported_url',
            },
          ]
        : [],
      source: 'wechat',
    };
  },
};

const plugin: Plugin = {
  manifest: {
    name: 'wechat-fetcher',
    version: '1.0.0',
    description: 'WeChat public account article fetcher (微信公众号文章抓取插件)',
    author: 'zotero-headless',
    provides: ['content-processor'],
  },

  async activate(_context: PluginContext) {
    return {
      contentProcessors: [wechatProcessor],
    };
  },
};

export default plugin;
