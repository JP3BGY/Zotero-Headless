/**
 * Plugin Registry
 *
 * 管理插件生命周期和能力注册的单例
 */

import type { Identifier } from '@zotero-headless/types';
import type {
  Plugin,
  PluginInfo,
  PluginCommand,
  LoadedPlugin,
  ContentProcessor,
  PostProcessor,
  EventHandler,
  ChangeEvent,
  PluginContext,
} from './types.js';
import { validateManifest } from './manifest.js';
import { createPluginContext, createProcessorContext } from './context.js';
import {
  PluginDuplicateError,
  PluginNotFoundError,
  PluginActivationError,
} from './errors.js';
import { discoverAndLoadPlugins, type DiscoveredPlugin } from './loader.js';

export class PluginRegistry {
  private plugins: Map<string, LoadedPlugin> = new Map();
  private contentProcessors: ContentProcessor[] = [];
  private postProcessorMap: Map<string, PostProcessor[]> = new Map();
  private commands: PluginCommand[] = [];
  private eventHandlerList: EventHandler[] = [];
  private initialized = false;

  // 用于获取插件配置的回调
  private configProvider: ((pluginName: string) => Record<string, unknown>) | null = null;

  /**
   * 设置配置提供者（由宿主应用在初始化前设置）
   */
  setConfigProvider(provider: (pluginName: string) => Record<string, unknown>): void {
    this.configProvider = provider;
  }

  /**
   * 发现并加载所有插件
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const discovered = await discoverAndLoadPlugins(this.configProvider);
    for (const entry of discovered) {
      try {
        await this.register(entry.plugin, entry.source);
      } catch (error) {
        // 插件加载失败不阻塞整个系统
        console.warn(
          `Warning: Failed to register plugin "${entry.plugin.manifest.name}": ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    this.initialized = true;
  }

  /**
   * 注册单个插件
   */
  async register(plugin: Plugin, source: PluginInfo['source'] = 'local'): Promise<void> {
    // 校验清单
    const manifest = validateManifest(plugin.manifest);
    const name = manifest.name;

    if (this.plugins.has(name)) {
      throw new PluginDuplicateError(name);
    }

    // 创建上下文并激活
    const pluginConfig = this.getPluginConfig(name);
    const context = createPluginContext(name, pluginConfig);

    let capabilities;
    try {
      capabilities = await plugin.activate(context);
    } catch (error) {
      throw new PluginActivationError(
        name,
        error instanceof Error ? error.message : String(error),
      );
    }

    // 注册能力
    const info: PluginInfo = {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      provides: manifest.provides,
      enabled: true,
      source,
    };

    const loaded: LoadedPlugin = { plugin, info, capabilities };
    this.plugins.set(name, loaded);

    // 注册内容处理器（按优先级排序）
    if (capabilities.contentProcessors) {
      for (const cp of capabilities.contentProcessors) {
        this.contentProcessors.push(cp);
      }
      this.contentProcessors.sort(
        (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
      );
    }

    // 注册后置处理器
    if (capabilities.postProcessors) {
      for (const pp of capabilities.postProcessors) {
        const existing = this.postProcessorMap.get(pp.trigger) ?? [];
        existing.push(pp);
        this.postProcessorMap.set(pp.trigger, existing);
      }
    }

    // 注册命令
    if (capabilities.commands) {
      this.commands.push(...capabilities.commands);
    }

    // 注册事件处理器
    if (capabilities.eventHandlers) {
      this.eventHandlerList.push(...capabilities.eventHandlers);
    }
  }

  /**
   * 注销插件
   */
  async unregister(name: string): Promise<void> {
    const loaded = this.plugins.get(name);
    if (!loaded) {
      throw new PluginNotFoundError(name);
    }

    // 调用停用钩子
    if (loaded.plugin.deactivate) {
      try {
        await loaded.plugin.deactivate();
      } catch {
        // 忽略停用错误
      }
    }

    // 移除能力
    const caps = loaded.capabilities;

    if (caps.contentProcessors) {
      const names = new Set(caps.contentProcessors.map((cp) => cp.name));
      this.contentProcessors = this.contentProcessors.filter(
        (cp) => !names.has(cp.name),
      );
    }

    if (caps.postProcessors) {
      for (const pp of caps.postProcessors) {
        const existing = this.postProcessorMap.get(pp.trigger);
        if (existing) {
          this.postProcessorMap.set(
            pp.trigger,
            existing.filter((p) => p.name !== pp.name),
          );
        }
      }
    }

    if (caps.commands) {
      const names = new Set(caps.commands.map((c) => c.name));
      this.commands = this.commands.filter((c) => !names.has(c.name));
    }

    if (caps.eventHandlers) {
      const names = new Set(caps.eventHandlers.map((eh) => eh.name));
      this.eventHandlerList = this.eventHandlerList.filter(
        (eh) => !names.has(eh.name),
      );
    }

    this.plugins.delete(name);
  }

  /**
   * 查找能处理给定标识符的内容处理器（按优先级）
   */
  findContentProcessor(identifier: Identifier): ContentProcessor | null {
    for (const processor of this.contentProcessors) {
      if (processor.match(identifier)) {
        return processor;
      }
    }
    return null;
  }

  /**
   * 获取指定触发时机的所有后置处理器
   */
  getPostProcessors(trigger: string): PostProcessor[] {
    return this.postProcessorMap.get(trigger) ?? [];
  }

  /**
   * 获取插件贡献的所有命令
   */
  getCommands(): PluginCommand[] {
    return [...this.commands];
  }

  /**
   * 获取指定事件类型的所有处理器
   */
  getEventHandlers(eventType: string): EventHandler[] {
    return this.eventHandlerList.filter((eh) =>
      eh.eventTypes.includes(eventType as any),
    );
  }

  /**
   * 列出已加载的插件
   */
  listPlugins(): PluginInfo[] {
    return Array.from(this.plugins.values()).map((lp) => ({ ...lp.info }));
  }

  /**
   * 获取单个插件状态
   */
  getPlugin(name: string): PluginInfo | null {
    const loaded = this.plugins.get(name);
    return loaded ? { ...loaded.info } : null;
  }

  /**
   * 为内容处理器创建 ProcessorContext
   */
  createProcessorContext(pluginName: string): ReturnType<typeof createProcessorContext> {
    const config = this.getPluginConfig(pluginName);
    return createProcessorContext(pluginName, config);
  }

  /**
   * 获取插件配置
   */
  private getPluginConfig(pluginName: string): Record<string, unknown> {
    if (this.configProvider) {
      return this.configProvider(pluginName);
    }
    return {};
  }
}

/** 单例 */
export const pluginRegistry = new PluginRegistry();
