/**
 * @zotero-headless/plugin
 *
 * 插件系统公共 API
 */

// 类型导出
export type {
  PluginType,
  PluginManifest,
  Plugin,
  PluginCapabilities,
  ContentProcessor,
  ProcessorContext,
  ProcessorResult,
  ProcessorAttachment,
  PostProcessor,
  PostProcessorItem,
  PostProcessorAction,
  ChangeEventType,
  ChangeEvent,
  EventHandler,
  PluginCommand,
  PluginCommandOption,
  PluginLogger,
  PluginContext,
  PluginInfo,
  LoadedPlugin,
} from './types.js';

// 注册表
export { PluginRegistry, pluginRegistry } from './registry.js';

// 清单校验
export { validateManifest } from './manifest.js';

// 上下文工厂
export { createPluginContext, createProcessorContext } from './context.js';

// 加载器
export { registerBuiltinPlugin, loadPluginBySource, type DiscoveredPlugin } from './loader.js';

// 错误
export {
  PluginError,
  PluginLoadError,
  PluginManifestError,
  PluginActivationError,
  PluginNotFoundError,
  PluginDuplicateError,
} from './errors.js';
