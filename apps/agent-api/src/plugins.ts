/**
 * Plugin Management API
 *
 * 插件查询与状态管理
 */

import type { PluginInfo } from '@zotero-headless/plugin';

/**
 * 列出已加载的插件
 */
export async function listPlugins(): Promise<PluginInfo[]> {
  const { pluginRegistry } = await import('@zotero-headless/plugin');
  return pluginRegistry.listPlugins();
}

/**
 * 获取单个插件状态
 */
export async function getPluginStatus(name: string): Promise<PluginInfo | null> {
  const { pluginRegistry } = await import('@zotero-headless/plugin');
  return pluginRegistry.getPlugin(name);
}
