// Configuration Manager for Zotero-Headless
// Handles ~/.zoterrc configuration file

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { symbols } from './symbols.js';

export interface ZoteroConfig {
  // Default settings
  editor?: string;
  language?: 'en' | 'zh';
  
  // Sync settings
  sync?: {
    autoSync?: boolean;
    syncInterval?: number; // minutes
  };
  
  // Display settings
  display?: {
    defaultLimit?: number;
    showAttachments?: boolean;
  };
  
  // Download settings
  download?: {
    defaultDir?: string;
  };
  
  // Shortcuts for common queries
  shortcuts?: Record<string, string>;

  // Shell keybindings
  keybindings?: {
    submit?: string;       // default: "enter"
    historyUp?: string;    // default: "up"
    historyDown?: string;  // default: "down"
    scrollUp?: string;     // default: "pageup"
    scrollDown?: string;   // default: "pagedown"
    complete?: string;     // default: "tab"
    clear?: string;        // default: "ctrl+l"
    exit?: string;         // default: "ctrl+d"
  };
}

const DEFAULT_CONFIG: ZoteroConfig = {
  editor: process.env.EDITOR || 'nano',
  language: 'zh',
  sync: {
    autoSync: false,
    syncInterval: 30,
  },
  display: {
    defaultLimit: 20,
    showAttachments: true,
  },
  download: {
    defaultDir: path.join(os.homedir(), '.local', 'share', 'zotero-headless', 'downloads'),
  },
  shortcuts: {},
  keybindings: {
    submit: 'enter',
    historyUp: 'up',
    historyDown: 'down',
    scrollUp: 'pageup',
    scrollDown: 'pagedown',
    complete: 'tab',
    clear: 'ctrl+l',
    exit: 'ctrl+d',
  },
};

export class ConfigManager {
  private configPath: string;
  private config: ZoteroConfig;

  constructor() {
    this.configPath = path.join(os.homedir(), '.zoterrc');
    this.config = this.load();
  }

  /**
   * Load configuration from ~/.zoterrc
   */
  private load(): ZoteroConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf8');
        const userConfig = yaml.load(content) as ZoteroConfig;
        return { ...DEFAULT_CONFIG, ...userConfig };
      }
    } catch (error) {
      console.warn(`Warning: Failed to load config from ${this.configPath}`);
    }
    return { ...DEFAULT_CONFIG };
  }

  /**
   * Save current configuration to ~/.zoterrc
   */
  save(): void {
    try {
      const content = yaml.dump(this.config, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
      });
      fs.writeFileSync(this.configPath, content, 'utf8');
    } catch (error) {
      console.error(`Error: Failed to save config to ${this.configPath}`);
    }
  }

  /**
   * Get configuration value
   */
  get<K extends keyof ZoteroConfig>(key: K): ZoteroConfig[K] {
    return this.config[key];
  }

  /**
   * Set configuration value
   */
  set<K extends keyof ZoteroConfig>(key: K, value: ZoteroConfig[K]): void {
    this.config[key] = value;
    this.save();
  }

  /**
   * Get full configuration object
   */
  getAll(): ZoteroConfig {
    return { ...this.config };
  }

  /**
   * Create default config file if not exists
   */
  init(): void {
    if (!fs.existsSync(this.configPath)) {
      this.save();
      console.log(`${symbols.success} Created default config at ${this.configPath}`);
    }
  }

  /**
   * Get shortcut query
   */
  getShortcut(name: string): string | undefined {
    return this.config.shortcuts?.[name];
  }

  /**
   * Add or update shortcut
   */
  setShortcut(name: string, query: string): void {
    if (!this.config.shortcuts) {
      this.config.shortcuts = {};
    }
    this.config.shortcuts[name] = query;
    this.save();
  }
}

// Singleton instance
export const configManager = new ConfigManager();
