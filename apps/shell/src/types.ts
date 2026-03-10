// 输出行类型
export interface OutputLine {
  id: number;
  type: 'input' | 'output' | 'error' | 'info';
  content: string;
  commandId?: number; // groups lines belonging to the same command execution
}

// 命令执行组（用于折叠显示）
export interface OutputGroup {
  id: number;
  command: string;
  lines: OutputLine[];
  collapsed: boolean;
  exitCode: number;
  startTime: number;
  endTime?: number;
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
