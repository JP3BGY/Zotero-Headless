// 输出行类型
export interface OutputLine {
  id: number;
  type: 'input' | 'output' | 'error' | 'info';
  content: string;
  status?: 'pending' | 'success' | 'error';
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
