// @ts-nocheck

import type { Command } from '../types.js';
import { initModules, getPluginRegistry } from '../modules.js';
import { symbols } from '@zotero-headless/core';

export const pluginCommands: Command[] = [
  {
    name: 'plugin',
    aliases: ['plugins'],
    description: '管理插件 / Manage plugins',
    options: [],
    execute: async (args: string[]) => {
      const subcommand = args[0]?.toLowerCase() || 'list';

      switch (subcommand) {
        case 'list':
        case 'ls':
          await listPlugins();
          break;
        case 'info':
          await showPluginInfo(args[1]);
          break;
        case 'enable':
          await setPluginEnabled(args[1], true);
          break;
        case 'disable':
          await setPluginEnabled(args[1], false);
          break;
        default:
          console.log(`
${symbols.info} 插件管理

用法: zotero plugin <subcommand>

子命令:
  list, ls          列出已加载的插件
  info <name>       查看插件详情
  enable <name>     启用插件
  disable <name>    禁用插件（下次启动生效）

示例:
  zotero plugin list
  zotero plugin info wechat-fetcher
  zotero plugin disable wechat-fetcher
  zotero plugin enable wechat-fetcher
          `);
      }
    },
  },
];

async function listPlugins() {
  await initModules();
  const registry = getPluginRegistry();

  if (!registry) {
    console.log(`${symbols.error} 插件系统未初始化`);
    return;
  }

  const plugins = registry.listPlugins();

  if (plugins.length === 0) {
    console.log('没有已加载的插件');
    console.log('\n安装插件:');
    console.log('  1. 将插件放入 ~/.config/zotero-headless/plugins/<name>/');
    console.log('  2. 或在 ~/.zoterrc 中配置:');
    console.log('     plugins:');
    console.log('       my-plugin:');
    console.log('         source: "zotero-headless-plugin-xxx"');
    return;
  }

  console.log(`已加载 ${plugins.length} 个插件:\n`);

  for (const plugin of plugins) {
    const status = plugin.enabled ? symbols.success : symbols.error;
    const provides = plugin.provides.join(', ');
    console.log(`  ${status} ${plugin.name} v${plugin.version}`);
    console.log(`     ${plugin.description}`);
    console.log(`     提供: ${provides} | 来源: ${plugin.source}`);
    console.log('');
  }
}

async function setPluginEnabled(name: string | undefined, enabled: boolean) {
  if (!name) {
    console.log(`${symbols.error} 请提供插件名称`);
    console.log(`用法: zotero plugin ${enabled ? 'enable' : 'disable'} <name>`);
    return;
  }

  const { configManager } = await import('@zotero-headless/core');
  const plugins = configManager.get('plugins') ?? {};
  const pluginConfig = (plugins as any)[name] ?? {};
  pluginConfig.enabled = enabled;
  (plugins as any)[name] = pluginConfig;
  configManager.set('plugins', plugins);

  if (enabled) {
    console.log(`${symbols.success} 已启用插件: ${name}`);
    console.log('   重启后生效');
  } else {
    console.log(`${symbols.success} 已禁用插件: ${name}`);
    console.log('   重启后生效');
  }
}

async function showPluginInfo(name?: string) {
  if (!name) {
    console.log(`${symbols.error} 请提供插件名称`);
    console.log('用法: zotero plugin info <name>');
    return;
  }

  await initModules();
  const registry = getPluginRegistry();

  if (!registry) {
    console.log(`${symbols.error} 插件系统未初始化`);
    return;
  }

  const plugin = registry.getPlugin(name);

  if (!plugin) {
    console.log(`${symbols.error} 未找到插件: ${name}`);
    return;
  }

  console.log(`\n插件: ${plugin.name}`);
  console.log(`  版本:   ${plugin.version}`);
  console.log(`  描述:   ${plugin.description}`);
  console.log(`  状态:   ${plugin.enabled ? '已启用' : '已禁用'}`);
  console.log(`  来源:   ${plugin.source}`);
  console.log(`  能力:   ${plugin.provides.join(', ')}`);
  console.log('');
}
