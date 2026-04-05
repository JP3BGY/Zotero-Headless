// Log levels with numeric ordering for filtering
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// 输出行类型
export interface OutputLine {
  id: number;
  type: 'input' | 'output' | 'error' | 'info' | 'welcome';
  content: string;
  status?: 'pending' | 'success' | 'error';
  groupId?: number;     // ID of the parent input line; undefined for standalone info
  logLevel?: LogLevel;  // severity; defaults to 'info' if unset
}

// 命令补全项
export interface CommandSuggestion {
  name: string;
  description: string;
}

// Item Key 补全项
export interface ItemKeySuggestion {
  key: string;
  title: string;
  itemType: string;
}

// Path 补全项
export interface PathSuggestion {
  /** The entry name (file or directory name) */
  name: string;
  /** Whether this entry is a directory */
  isDirectory: boolean;
  /** Full completed path (for inserting into input) */
  fullPath: string;
}
