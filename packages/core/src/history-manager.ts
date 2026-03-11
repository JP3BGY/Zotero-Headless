// History Manager - Simple JSON file based history
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface HistoryEntry {
  id: number;
  type: 'item' | 'search' | 'command' | 'shell_command';
  key?: string;
  query?: string;
  command?: string;
  title?: string;
  timestamp: number;
  count: number;
}

const HISTORY_FILE = path.join(os.homedir(), '.local', 'share', 'zotero-headless', 'history.json');

export class HistoryManager {
  private entries: HistoryEntry[] = [];
  private maxEntries: number = 500;

  constructor() {
    this.load();
  }

  /**
   * Load history from file
   */
  private load(): void {
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
        this.entries = JSON.parse(content);
      }
    } catch (error) {
      this.entries = [];
    }
  }

  /**
   * Save history to file
   */
  private save(): void {
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Keep only recent entries
    const recent = this.entries.slice(0, this.maxEntries);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(recent, null, 2), 'utf-8');
  }

  /**
   * Record an entry
   */
  record(entry: {
    type: 'item' | 'search' | 'command' | 'shell_command';
    key?: string;
    query?: string;
    command?: string;
    title?: string;
  }): void {
    const now = Date.now();
    
    // Check if already exists
    const existing = this.entries.find(e =>
      e.type === entry.type &&
      ((entry.key && e.key === entry.key) ||
       (entry.query && e.query === entry.query) ||
       (entry.command && e.command === entry.command))
    );

    if (existing) {
      // Update count and timestamp
      existing.timestamp = now;
      existing.count = (existing.count || 0) + 1;
      if (entry.title) existing.title = entry.title;
    } else {
      // Add new entry
      this.entries.unshift({
        id: now,
        ...entry,
        timestamp: now,
        count: 1
      });
    }
    
    this.save();
  }

  /**
   * Get recent entries
   */
  getRecent(limit: number = 10): HistoryEntry[] {
    return this.entries.slice(0, limit);
  }

  /**
   * Get recent item keys
   */
  getRecentKeys(limit: number = 10): string[] {
    return this.entries
      .filter(e => e.type === 'item' && e.key)
      .slice(0, limit)
      .map(e => e.key!);
  }

  /**
   * Get recent shell commands (oldest first, for arrow-key navigation)
   */
  getRecentCommands(limit: number = 100): string[] {
    return this.entries
      .filter(e => e.type === 'shell_command' && e.command)
      .slice(0, limit)
      .reverse()
      .map(e => e.command!);
  }

  /**
   * Clear history
   */
  clear(): void {
    this.entries = [];
    this.save();
  }

  /**
   * Remove an entry
   */
  remove(key: string): boolean {
    const idx = this.entries.findIndex(e => e.key === key);
    if (idx >= 0) {
      this.entries.splice(idx, 1);
      this.save();
      return true;
    }
    return false;
  }
}

// Singleton
export const historyManager = new HistoryManager();
