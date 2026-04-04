/**
 * Plugin System Type Definitions
 *
 * 定义插件系统的所有接口和类型
 */

import type { Identifier } from '@zotero-headless/types';

// ============ 插件清单 ============

export type PluginType = 'content-processor' | 'post-processor' | 'command' | 'event';

export interface PluginManifest {
  /** 唯一标识符, e.g. "wechat-fetcher" */
  name: string;
  /** SemVer 版本号 */
  version: string;
  /** 人类可读的描述 */
  description: string;
  /** 作者 */
  author?: string;
  /** 此插件提供的能力类型 */
  provides: PluginType[];
}

// ============ 插件生命周期 ============

export interface Plugin {
  manifest: PluginManifest;
  /** 激活插件，返回其提供的能力 */
  activate(context: PluginContext): Promise<PluginCapabilities>;
  /** 可选的停用钩子 */
  deactivate?(): Promise<void>;
}

export interface PluginCapabilities {
  contentProcessors?: ContentProcessor[];
  postProcessors?: PostProcessor[];
  commands?: PluginCommand[];
  eventHandlers?: EventHandler[];
}

// ============ 内容处理器（核心能力）============

export interface ContentProcessor {
  /** 处理器名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 优先级，数值越高越先被匹配，默认 0 */
  priority?: number;
  /** 判断此处理器是否能处理给定标识符 */
  match(identifier: Identifier): boolean;
  /** 获取并处理内容，返回元数据和附件 */
  process(identifier: Identifier, context: ProcessorContext): Promise<ProcessorResult>;
}

export interface ProcessorContext {
  /** 带超时的 HTTP fetch */
  fetch(url: string, options?: RequestInit): Promise<Response>;
  /** 报告进度信息 */
  reportProgress(message: string): void;
  /** 来自 ~/.zoterrc plugins.<name> 的配置 */
  config: Record<string, unknown>;
  /** 日志记录器 */
  log: PluginLogger;
}

export interface ProcessorResult {
  /**
   * 结果格式:
   * - 'zotero-api': Zotero API 格式（如 translator 输出），将通过 extractDenormalizedColumns() 转换
   * - 'db-columns': 直接 DB 列格式（如 WeChat fetcher 输出），直接插入
   */
  format: 'zotero-api' | 'db-columns';
  /** 条目数据 */
  item: Record<string, any>;
  /** 可选附件列表 */
  attachments?: ProcessorAttachment[];
  /** 数据来源标识 */
  source: string;
}

export interface ProcessorAttachment {
  /** 附件标题, e.g. "Snapshot", "Full Text PDF" */
  title: string;
  /** MIME 类型 */
  contentType: string;
  /** 内容（字符串或 Buffer） */
  content: string | Buffer;
  /** 如果 content 是文件路径，设为 true */
  isFilePath?: boolean;
  /** 来源 URL */
  sourceUrl?: string;
  /** 链接模式 */
  linkMode?: 'imported_url' | 'linked_file';
}

// ============ 后置处理器 ============

export interface PostProcessor {
  /** 处理器名称 */
  name: string;
  /** 触发时机 */
  trigger: 'after-create' | 'after-update' | 'after-sync';
  /** 处理条目，返回声明式操作列表 */
  process(item: PostProcessorItem, context: PluginContext): Promise<PostProcessorAction[]>;
}

export interface PostProcessorItem {
  key: string;
  itemType: string;
  title: string | null;
  tags: Array<{ tag: string }>;
  creators: string;
  collectionKeys: string[];
  url: string | null;
  doi: string | null;
  /** 创建此条目的内容处理器来源（如有） */
  source?: string;
}

export type PostProcessorAction =
  | { type: 'add-tags'; tags: Array<{ tag: string }> }
  | { type: 'add-to-collection'; collectionKey: string }
  | { type: 'set-field'; field: string; value: string };

// ============ 事件处理器 ============

export type ChangeEventType = 'create' | 'update' | 'delete';

export interface ChangeEvent {
  type: ChangeEventType;
  itemKey: string;
  item: Record<string, any>;
  timestamp: Date;
}

export interface EventHandler {
  /** 处理器名称 */
  name: string;
  /** 要监听的事件类型 */
  eventTypes: ChangeEventType[];
  /** 处理事件 */
  handle(event: ChangeEvent, context: PluginContext): Promise<void>;
}

// ============ 命令 ============

export interface PluginCommandOption {
  name: string;
  alias?: string;
  description: string;
  required?: boolean;
}

export interface PluginCommand {
  name: string;
  aliases?: string[];
  description: string;
  options?: PluginCommandOption[];
  execute: (args: string[], invokedAs?: string) => Promise<void>;
}

// ============ 插件上下文 ============

export interface PluginLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export interface PluginContext {
  /** 来自 ~/.zoterrc plugins.<name> 的插件配置 */
  config: Record<string, unknown>;
  /** 以插件名为前缀的日志记录器 */
  log: PluginLogger;
  /** HTTP 客户端 */
  http: {
    fetch(url: string, options?: RequestInit): Promise<Response>;
  };
  /** 插件专属数据目录 */
  dataDir: string;
}

// ============ 插件信息（注册表查询结果）============

export interface PluginInfo {
  name: string;
  version: string;
  description: string;
  provides: PluginType[];
  enabled: boolean;
  source: 'builtin' | 'local' | 'npm';
}

export interface LoadedPlugin {
  plugin: Plugin;
  info: PluginInfo;
  capabilities: PluginCapabilities;
}
