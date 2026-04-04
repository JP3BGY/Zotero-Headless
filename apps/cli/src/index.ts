#!/usr/bin/env node
// @ts-nocheck

// Zotero-Headless CLI
// See Zotero-Headless-Complete-Design.md Section 7

import { symbols } from '@zotero-headless/core';
import { setLanguage, getLanguage, type Language } from './i18n.js';
import { commands } from './commands/index.js';
import type { Command, CommandOption } from './types.js';
import { setShellMode } from './types.js';

// Re-export public API
export { commands, setShellMode };
export type { Command, CommandOption };

// Export main function for testing
export async function main() {
  const args = process.argv.slice(2);

  // Check for --version flag
  if (args[0] === '--version' || args[0] === '-v') {
    try {
      const { readFileSync } = await import('fs');
      const { fileURLToPath } = await import('url');
      const { dirname, join } = await import('path');
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const packageJson = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));
      console.log(packageJson.version || 'unknown');
    } catch {
      console.log('unknown');
    }
    return;
  }

  // Check for --lang option before command parsing
  const langArg = args.find(arg => arg.startsWith('--lang='));
  if (langArg) {
    const lang = langArg.split('=')[1] as Language;
    if (lang === 'en' || lang === 'zh') {
      setLanguage(lang);
    }
  }

  const commandName = args[0]?.toLowerCase() || 'help';
  const commandArgs = args.slice(1);

  // Handle "zotero help <command>" syntax
  if (commandName === 'help' && commandArgs.length > 0 && !commandArgs[0].startsWith('-')) {
    const helpTarget = commandArgs[0].toLowerCase();
    const cmd = commands.find(c =>
      c.name === helpTarget || c.aliases?.includes(helpTarget)
    );
    if (cmd) {
      showCommandHelp(cmd, helpTarget);
      return;
    } else {
      console.log(`${symbols.error} Unknown command: ${helpTarget}`);
      console.log(`   Run "zotero help" for all commands.`);
      process.exit(1);
    }
  }

  // Check for --help or -h flag on commands
  if (commandArgs.includes('--help') || commandArgs.includes('-h') || commandName === 'help') {
    // Show help for specific command or general help
    if (commandName !== 'help') {
      // Try to find the command to show its specific help
      const cmd = commands.find(c =>
        c.name === commandName || c.aliases?.includes(commandName)
      );
      if (cmd) {
        showCommandHelp(cmd, commandName);
        return;
      }
    }

    // Show general help
    const helpCmd = commands.find(c => c.name === 'help');
    if (helpCmd) {
      await helpCmd.execute([]);
      return;
    }
  }

  let command = commands.find(c =>
    c.name === commandName || c.aliases?.includes(commandName)
  );

  // 静态命令未匹配时，尝试从插件注册表查找
  if (!command) {
    try {
      const { initModules, getPluginRegistry } = await import('./modules.js');
      await initModules();
      const registry = getPluginRegistry();
      if (registry) {
        const pluginCommands = registry.getCommands();
        command = pluginCommands.find((c: any) =>
          c.name === commandName || c.aliases?.includes(commandName)
        );
      }
    } catch {
      // 插件系统加载失败，忽略
    }
  }

  if (!command) {
    console.log(`${symbols.error} Unknown command: ${commandName}`);
    console.log(`   Run "zotero help" for usage.`);
    process.exit(1);
  }

  try {
    await command.execute(commandArgs, commandName);
  } catch (error) {
    console.error(`${symbols.error} Command failed:`, error);
    process.exit(1);
  }
}

/**
 * Show detailed help for a specific command
 */
function showCommandHelp(cmd: Command, invokedName: string) {
  console.log(`\n📖 ${cmd.name} - ${cmd.description}\n`);

  console.log(`Usage: zotero ${invokedName}${cmd.options ? ' [options]' : ''} [arguments]\n`);

  if (cmd.aliases && cmd.aliases.length > 0) {
    console.log(`Aliases: ${cmd.aliases.join(', ')}\n`);
  }

  if (cmd.options && cmd.options.length > 0) {
    console.log('Options:');
    for (const opt of cmd.options) {
      const aliasStr = opt.alias ? `, ${opt.alias}` : '';
      const valueStr = opt.value ? ` ${opt.value}` : '';
      console.log(`  ${opt.name}${aliasStr}${valueStr}`);
      console.log(`      ${opt.description}`);
    }
    console.log('');
  }

  if (cmd.examples && cmd.examples.length > 0) {
    console.log('Examples:');
    for (const ex of cmd.examples) {
      console.log(`  $ ${ex}`);
    }
    console.log('');
  }

  console.log('Use "zotero help" to see all available commands.\n');
}

// Only run main if this file is executed directly
import { fileURLToPath } from 'url';
import { realpathSync } from 'fs';
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
