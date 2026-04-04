/**
 * Plugin Context Factory
 *
 * 为每个插件创建受控的 API 上下文
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { PluginContext, PluginLogger, ProcessorContext } from './types.js';

const PLUGIN_DATA_BASE = path.join(
  os.homedir(),
  '.config',
  'zotero-headless',
  'plugins',
);

function createLogger(pluginName: string): PluginLogger {
  const prefix = `[plugin:${pluginName}]`;
  return {
    info: (msg: string) => console.log(`${prefix} ${msg}`),
    warn: (msg: string) => console.warn(`${prefix} ${msg}`),
    error: (msg: string) => console.error(`${prefix} ${msg}`),
    debug: (msg: string) => {
      if (process.env.DEBUG) {
        console.log(`${prefix} [debug] ${msg}`);
      }
    },
  };
}

/**
 * 创建插件生命周期上下文（在 activate 时注入）
 */
export function createPluginContext(
  pluginName: string,
  pluginConfig: Record<string, unknown>,
): PluginContext {
  const dataDir = path.join(PLUGIN_DATA_BASE, pluginName);

  return {
    config: pluginConfig,
    log: createLogger(pluginName),
    http: {
      fetch: (url: string, options?: RequestInit) => fetch(url, options),
    },
    dataDir,
  };
}

/**
 * 创建内容处理器上下文（在 process 时注入）
 */
export function createProcessorContext(
  pluginName: string,
  pluginConfig: Record<string, unknown>,
): ProcessorContext {
  const log = createLogger(pluginName);

  return {
    fetch: (url: string, options?: RequestInit) => fetch(url, options),
    reportProgress: (message: string) => log.info(message),
    config: pluginConfig,
    log,
  };
}
