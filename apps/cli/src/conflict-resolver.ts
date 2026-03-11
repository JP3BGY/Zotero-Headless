#!/usr/bin/env node
/**
 * Interactive Conflict Resolver
 * Prompts user to choose resolution for each conflict
 */

import readline from 'readline';
import { t } from './i18n.js';

export interface ConflictItem {
  key: string;
  title?: string;
  localVersion: number;
  remoteVersion: number;
  localModified?: Date;
  remoteModified?: Date;
}

export type ConflictResolution = 'remote' | 'local' | 'merge' | 'skip' | 'all-remote' | 'all-local';

/**
 * Prompt user for conflict resolution
 */
export async function promptConflictResolution(
  item: ConflictItem,
  rl: readline.Interface
): Promise<ConflictResolution> {
  console.log(`\n${t('conflict.title')}: ${item.title || item.key}`);
  console.log(`   ${t('conflict.local')}: ${item.localVersion} (${item.localModified?.toLocaleString() || t('common.unknown')})`);
  console.log(`   ${t('conflict.remote')}: ${item.remoteVersion} (${item.remoteModified?.toLocaleString() || t('common.unknown')})`);
  console.log('');
  console.log(`   [r] ${t('conflict.remote')}`);
  console.log(`   [l] ${t('conflict.local')}`);
  console.log(`   [s] ${t('conflict.skip')}`);
  console.log(`   [R] ${t('conflict.allRemote')}`);
  console.log(`   [L] ${t('conflict.allLocal')}`);
  console.log('');
  
  return new Promise((resolve) => {
    rl.question(t('conflict.prompt'), (answer) => {
      const choice = answer.trim();
      const lowerChoice = choice.toLowerCase();
      
      // Check for global strategies first (uppercase)
      if (choice === 'R') {
        resolve('all-remote');
      } else if (choice === 'L') {
        resolve('all-local');
      } else {
        // Individual choices (lowercase)
        switch (lowerChoice) {
          case 'r':
            resolve('remote');
            break;
          case 'l':
            resolve('local');
            break;
          case 's':
            resolve('skip');
            break;
          default:
            console.log(t('errors.invalidKey'));
            resolve('skip');
        }
      }
    });
  });
}

/**
 * Create readline interface
 */
export function createPrompt(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

/**
 * Batch resolve conflicts interactively
 */
export async function resolveConflictsInteractive(
  conflicts: ConflictItem[],
  rl?: readline.Interface
): Promise<Map<string, 'remote' | 'local' | 'skip'>> {
  if (conflicts.length === 0) {
    return new Map();
  }
  
  const inputRl = rl || createPrompt();
  const resolutions = new Map<string, 'remote' | 'local' | 'skip'>();
  let globalStrategy: 'remote' | 'local' | null = null;
  
  console.log(`\n!  ${conflicts.length} ${t('conflict.title')}\n`);
  
  for (const item of conflicts) {
    // Skip if already resolved via global strategy
    if (globalStrategy) {
      resolutions.set(item.key, globalStrategy);
      console.log(`   ${item.title || item.key}: ${globalStrategy} (${t('common.all')})`);
      continue;
    }
    
    // Prompt for resolution
    const resolution = await promptConflictResolution(item, inputRl);
    
    switch (resolution) {
      case 'all-remote':
        globalStrategy = 'remote';
        resolutions.set(item.key, 'remote');
        console.log(`   → ${t('conflict.allRemote')}`);
        break;
      case 'all-local':
        globalStrategy = 'local';
        resolutions.set(item.key, 'local');
        console.log(`   → ${t('conflict.allLocal')}`);
        break;
      case 'remote':
        resolutions.set(item.key, 'remote');
        console.log(`   → ${t('conflict.remote')}`);
        break;
      case 'local':
        resolutions.set(item.key, 'local');
        console.log(`   → ${t('conflict.local')}`);
        break;
      case 'skip':
        resolutions.set(item.key, 'skip');
        console.log(`   → ${t('conflict.skip')}`);
        break;
    }
  }
  
  inputRl.close();
  console.log('');
  
  return resolutions;
}

/**
 * Check if running in interactive mode
 */
export function isInteractive(): boolean {
  return process.stdin.isTTY && process.stdout.isTTY;
}
