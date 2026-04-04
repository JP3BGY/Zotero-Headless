/**
 * Plugin Loader
 *
 * 从多种来源发现并动态加载插件
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Plugin, PluginInfo } from './types.js';
import { PluginLoadError } from './errors.js';

export interface DiscoveredPlugin {
  plugin: Plugin;
  source: PluginInfo['source'];
}

const PLUGIN_DIR = path.join(
  os.homedir(),
  '.config',
  'zotero-headless',
  'plugins',
);

/** 内置插件的动态导入函数 */
const builtinPluginLoaders: Array<{
  name: string;
  load: () => Promise<any>;
}> = [];

/**
 * 注册内置插件加载器（供宿主应用调用）
 */
export function registerBuiltinPlugin(
  name: string,
  load: () => Promise<any>,
): void {
  builtinPluginLoaders.push({ name, load });
}

/**
 * 发现并加载所有插件
 */
export async function discoverAndLoadPlugins(
  configProvider: ((pluginName: string) => Record<string, unknown>) | null,
): Promise<DiscoveredPlugin[]> {
  const plugins: DiscoveredPlugin[] = [];

  // 1. 加载内置插件
  for (const builtin of builtinPluginLoaders) {
    // 检查是否被用户禁用
    const builtinConfig = configProvider?.(builtin.name) ?? {};
    if (builtinConfig.enabled === false) continue;

    try {
      const plugin = await loadPluginModule(builtin.load);
      if (plugin) {
        plugins.push({ plugin, source: 'builtin' });
      }
    } catch (error) {
      console.warn(
        `Warning: Failed to load builtin plugin "${builtin.name}": ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  // 2. 扫描插件目录
  if (fs.existsSync(PLUGIN_DIR)) {
    const entries = fs.readdirSync(PLUGIN_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const pluginDir = path.join(PLUGIN_DIR, entry.name);
      const plugin = await loadPluginFromDirectory(pluginDir, entry.name);
      if (plugin) {
        // 检查是否在配置中被禁用
        const config = configProvider?.(plugin.manifest.name) ?? {};
        if (config.enabled === false) continue;
        plugins.push({ plugin, source: 'local' });
      }
    }
  }

  return plugins;
}

/**
 * 从目录加载插件
 */
async function loadPluginFromDirectory(
  dir: string,
  name: string,
): Promise<Plugin | null> {
  // 尝试多种入口文件
  const candidates = ['index.js', 'index.mjs', 'dist/index.js'];

  for (const candidate of candidates) {
    const entryPath = path.join(dir, candidate);
    if (fs.existsSync(entryPath)) {
      try {
        const plugin = await loadPluginModule(
          () => import(entryPath),
        );
        return plugin;
      } catch (error) {
        throw new PluginLoadError(
          name,
          `Failed to import ${candidate}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  return null;
}

/**
 * 通过 source 字符串加载插件（npm 包名或本地路径）
 */
export async function loadPluginBySource(source: string): Promise<Plugin | null> {
  // 本地路径
  if (source.startsWith('/') || source.startsWith('~') || source.startsWith('./')) {
    const resolvedPath = source.startsWith('~')
      ? path.join(os.homedir(), source.slice(1))
      : path.resolve(source);
    return loadPluginFromDirectory(resolvedPath, path.basename(resolvedPath));
  }

  // npm 包名
  try {
    const plugin = await loadPluginModule(() => import(source));
    return plugin;
  } catch (error) {
    throw new PluginLoadError(
      source,
      `Failed to import npm package: ${error instanceof Error ? error.message : error}`,
    );
  }
}

/**
 * 从模块加载 Plugin 对象
 */
async function loadPluginModule(
  loader: () => Promise<any>,
): Promise<Plugin | null> {
  const mod = await loader();

  // 支持 default export
  if (mod.default) {
    const exported = mod.default;
    if (isPlugin(exported)) return exported;
    // 支持 createPlugin() 工厂函数
    if (typeof exported === 'function') {
      const result = exported();
      if (isPlugin(result)) return result;
    }
  }

  // 支持 named export: createPlugin()
  if (typeof mod.createPlugin === 'function') {
    const result = mod.createPlugin();
    if (isPlugin(result)) return result;
  }

  // 支持模块本身就是 Plugin
  if (isPlugin(mod)) return mod;

  return null;
}

/**
 * 类型守卫：检查对象是否满足 Plugin 接口
 */
function isPlugin(obj: unknown): obj is Plugin {
  if (!obj || typeof obj !== 'object') return false;
  const p = obj as any;
  return (
    p.manifest &&
    typeof p.manifest === 'object' &&
    typeof p.manifest.name === 'string' &&
    typeof p.activate === 'function'
  );
}
