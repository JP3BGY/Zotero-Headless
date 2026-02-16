#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { configureSync, performSync } from './commands/sync.js';
import { configureList, performList } from './commands/list.js';
import { configureSearch, performSearch } from './commands/search.js';
import { configureStats, performStats } from './commands/stats.js';
import { configureGet, performGet } from './commands/get.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function main() {
  const program = new Command();
  
  program
    .name('zotero-headless')
    .description('Zotero Headless - Sync your Zotero library without the desktop client')
    .version('1.0.0')
    .option('-c, --config <path>', 'config file path', '.env')
    .hook('preAction', async (thisCommand, actionCommand) => {
      const configPath = actionCommand.opts().config || '.env';
      
      try {
        await fs.access(configPath);
        
        // Load environment variables
        const envContent = await fs.readFile(configPath, 'utf-8');
        const lines = envContent.split('\n');
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...valueParts] = trimmed.split('=');
            const value = valueParts.join('=').trim();
            
            if (key && value) {
              // Remove quotes if present
              const cleanValue = value.replace(/^["']|["']$/g, '');
              process.env[key] = cleanValue;
            }
          }
        }
      } catch (error) {
        console.warn(`Config file not found at ${configPath}. Some commands may require configuration.`);
      }
    });
  
  // Add subcommands
  configureSync(program);
  configureList(program);
  configureSearch(program);
  configureStats(program);
  configureGet(program);
  
  // Help command
  program.command('help')
    .description('显示帮助信息')
    .action(() => {
      program.help();
    });
  
  // Default command with error handling
  program.on('command:*', (operands) => {
    console.error(`错误：未知命令 '${operands[0]}'`);
    console.error('可用命令：sync, list, search, stats, get, help');
    process.exit(1);
  });
  
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    console.error('命令执行失败：', error.message);
    process.exit(1);
  }
}

// Export for testing
export { configureSync, performSync };
export { configureList, performList };
export { configureSearch, performSearch };
export { configureStats, performStats };
export { configureGet, performGet };