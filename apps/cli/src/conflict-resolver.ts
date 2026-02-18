#!/usr/bin/env node
/**
 * Interactive Conflict Resolver
 * Prompts user to choose resolution for each conflict
 */

import readline from 'readline';

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
  console.log(`\n📄 Conflict detected for: ${item.title || item.key}`);
  console.log(`   Local version:  ${item.localVersion} (${item.localModified?.toLocaleString() || 'unknown'})`);
  console.log(`   Remote version: ${item.remoteVersion} (${item.remoteModified?.toLocaleString() || 'unknown'})`);
  console.log('');
  console.log('   [r] Use remote version (discard local changes)');
  console.log('   [l] Use local version (keep local changes)');
  console.log('   [s] Skip (resolve later)');
  console.log('   [R] Use remote for all remaining conflicts');
  console.log('   [L] Use local for all remaining conflicts');
  console.log('');
  
  return new Promise((resolve) => {
    rl.question('Your choice (r/l/s/R/L): ', (answer) => {
      const choice = answer.trim().toLowerCase();
      
      switch (choice) {
        case 'r':
          resolve('remote');
          break;
        case 'l':
          resolve('local');
          break;
        case 's':
          resolve('skip');
          break;
        case 'R':
          resolve('all-remote');
          break;
        case 'L':
          resolve('all-local');
          break;
        default:
          console.log('Invalid choice, defaulting to skip');
          resolve('skip');
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
  conflicts: ConflictItem[]
): Promise<Map<string, 'remote' | 'local' | 'skip'>> {
  if (conflicts.length === 0) {
    return new Map();
  }
  
  const rl = createPrompt();
  const resolutions = new Map<string, 'remote' | 'local' | 'skip'>();
  let globalStrategy: 'remote' | 'local' | null = null;
  
  console.log(`\n⚠️  ${conflicts.length} conflicts detected that need your attention.\n`);
  
  for (const item of conflicts) {
    // Skip if already resolved via global strategy
    if (globalStrategy) {
      resolutions.set(item.key, globalStrategy);
      console.log(`   ${item.title || item.key}: Using ${globalStrategy} (global)`);
      continue;
    }
    
    // Prompt for resolution
    const resolution = await promptConflictResolution(item, rl);
    
    switch (resolution) {
      case 'all-remote':
        globalStrategy = 'remote';
        resolutions.set(item.key, 'remote');
        console.log(`   → Set global strategy to: remote`);
        break;
      case 'all-local':
        globalStrategy = 'local';
        resolutions.set(item.key, 'local');
        console.log(`   → Set global strategy to: local`);
        break;
      case 'remote':
        resolutions.set(item.key, 'remote');
        console.log(`   → Using remote version`);
        break;
      case 'local':
        resolutions.set(item.key, 'local');
        console.log(`   → Keeping local version`);
        break;
      case 'skip':
        resolutions.set(item.key, 'skip');
        console.log(`   → Skipped`);
        break;
    }
  }
  
  rl.close();
  console.log('');
  
  return resolutions;
}

/**
 * Check if running in interactive mode
 */
export function isInteractive(): boolean {
  return process.stdin.isTTY && process.stdout.isTTY;
}
