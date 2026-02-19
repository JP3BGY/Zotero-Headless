/**
 * 配置 API
 * 
 * 管理 Zotero-Headless 的配置
 */

import type { Config } from './types.js';

// 延迟加载配置模块
let coreModule: any;

async function getCore() {
  if (!coreModule) {
    coreModule = await import('@zotero-headless/core');
  }
  return coreModule;
}

/**
 * 获取当前配置
 */
export async function getConfig(): Promise<Config> {
  const { appConfig } = await getCore();
  
  return {
    apiKey: appConfig.zotero?.apiKey,
    userId: appConfig.zotero?.userId,
    libraryId: appConfig.zotero?.libraryId,
    libraryType: appConfig.zotero?.libraryType,
    syncMode: appConfig.sync?.mode,
    webdav: appConfig.webdav ? {
      enabled: appConfig.webdav.enabled,
      url: appConfig.webdav.url,
      username: appConfig.webdav.username,
      password: appConfig.webdav.password ? '***' : undefined
    } : undefined
  };
}

/**
 * 设置配置项
 */
export async function setConfig(key: string, value: any): Promise<void> {
  const { appConfig } = await getCore();
  
  const parts = key.split('.');
  let target: any = appConfig;
  
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in target)) {
      target[parts[i]] = {};
    }
    target = target[parts[i]];
  }
  
  target[parts[parts.length - 1]] = value;
}

/**
 * 验证 API Key
 */
export async function validateApiKey(key: string): Promise<boolean> {
  // TODO: 实现 API Key 验证
  // 暂时返回 true，实际应该调用 Zotero API 验证
  return !!key && key.length > 0;
}

/**
 * 初始化配置
 */
export async function initConfig(config: Partial<Config>): Promise<void> {
  if (config.apiKey) {
    await setConfig('zotero.apiKey', config.apiKey);
  }
  if (config.userId) {
    await setConfig('zotero.userId', config.userId);
  }
  if (config.libraryId) {
    await setConfig('zotero.libraryId', config.libraryId);
  }
  if (config.libraryType) {
    await setConfig('zotero.libraryType', config.libraryType);
  }
}
