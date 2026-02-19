#!/usr/bin/env node
import React, { useState, useCallback, useRef } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { executeCommand, getAvailableCommands, parseCommand } from './commands.js';

// 历史管理类
class HistoryManager {
  private history: string[] = [];
  private index = -1;

  add(command: string) {
    if (command.trim() && this.history[this.history.length - 1] !== command) {
      this.history.push(command);
    }
    this.index = this.history.length;
  }

  previous(): string | null {
    if (this.index > 0) {
      this.index--;
      return this.history[this.index];
    }
    return null;
  }

  next(): string | null {
    if (this.index < this.history.length - 1) {
      this.index++;
      return this.history[this.index];
    }
    this.index = this.history.length;
    return null;
  }

  getAll(): string[] {
    return this.history;
  }
}

// Zotero 命令执行器
class ZoteroExecutor {
  private builtinCommands: Map<string, (args: string[]) => Promise<string>> = new Map();

  constructor() {
    this.registerBuiltinCommands();
  }

  private registerBuiltinCommands() {
    // 清屏命令
    this.builtinCommands.set('clear', async () => 'CLEAR');
    this.builtinCommands.set('cls', async () => 'CLEAR');
    
    // 退出命令
    this.builtinCommands.set('exit', async () => 'EXIT');
    this.builtinCommands.set('quit', async () => 'EXIT');
    this.builtinCommands.set('q', async () => 'EXIT');

    // 帮助命令
    this.builtinCommands.set('help', async () => {
      return `
📚 Zotero Shell 帮助

文献管理:
  ls, list                列出文献
  search <关键词>          搜索文献
  add                     添加新文献
  rm <key>                删除文献
  show <key>              查看详情
  update <key>            更新文献

同步与存储:
  sync, s                 同步数据
  webdav                  WebDAV 管理

其他:
  stats                   统计信息
  verify                  验证 API 密钥
  config                  配置管理
  help                    显示帮助
  exit, quit              退出 shell

快捷键:
  ↑/↓                     浏览历史命令
  Tab                     自动补全
  Ctrl+C                  退出
      `.trim();
    });
  }

  async execute(input: string): Promise<string> {
    const trimmed = input.trim();
    if (!trimmed) return '';

    const { cmd, args } = parseCommand(trimmed);

    // 内置命令
    if (this.builtinCommands.has(cmd)) {
      const result = await this.builtinCommands.get(cmd)!(args);
      return result;
    }

    // 转发到 zotero CLI
    return await executeCommand(cmd, args);
  }

  getCompletions(partial: string): string[] {
    return getAvailableCommands().filter(c => c.startsWith(partial.toLowerCase()));
  }
}

// 主组件
function ZoteroShell() {
  const { exit } = useApp();
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<{ type: 'input' | 'output'; content: string }[]>([
    { type: 'output', content: '📚 Zotero Shell v1.0.0' },
    { type: 'output', content: '输入 "help" 查看可用命令，或 "exit" 退出\n' }
  ]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  
  const historyManager = useRef(new HistoryManager());
  const executor = useRef(new ZoteroExecutor());

  const executeCommand = useCallback(async (cmd: string) => {
    if (!cmd.trim()) return;

    // 添加到历史
    historyManager.current.add(cmd);
    setHistory(prev => [...prev, { type: 'input', content: `zotero> ${cmd}` }]);

    // 执行命令
    const output = await executor.current.execute(cmd);

    if (output === 'EXIT') {
      setHistory(prev => [...prev, { type: 'output', content: '👋 再见!' }]);
      setTimeout(() => exit(), 500);
      return;
    }

    if (output === 'CLEAR') {
      setHistory([
        { type: 'output', content: '📚 Zotero Shell v1.0.0' },
        { type: 'output', content: '屏幕已清除\n' }
      ]);
      setInput('');
      setSuggestions([]);
      return;
    }

    if (output) {
      setHistory(prev => [...prev, { type: 'output', content: output }]);
    }

    setInput('');
    setSuggestions([]);
  }, [exit]);

  useInput((value, key) => {
    if (key.return) {
      executeCommand(input);
      return;
    }

    if (key.upArrow) {
      const prev = historyManager.current.previous();
      if (prev !== null) {
        setInput(prev);
      }
      return;
    }

    if (key.downArrow) {
      const next = historyManager.current.next();
      if (next !== null) {
        setInput(next);
      } else {
        setInput('');
      }
      return;
    }

    if (key.tab) {
      const comps = executor.current.getCompletions(input);
      if (comps.length === 1) {
        setInput(comps[0] + ' ');
        setSuggestions([]);
      } else if (comps.length > 1) {
        setSuggestions(comps);
      }
      return;
    }

    // 更新自动补全建议
    if (value && !key.tab) {
      const comps = executor.current.getCompletions(input + value);
      setSuggestions(comps.slice(0, 5));
    } else if (!input && !value) {
      setSuggestions([]);
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      {/* 历史输出区域 */}
      <Box flexDirection="column" flexGrow={1}>
        {history.slice(-20).map((item, index) => (
          <Box key={index}>
            {item.type === 'input' ? (
              <Text color="cyan">{item.content}</Text>
            ) : (
              <Text>{item.content}</Text>
            )}
          </Box>
        ))}
      </Box>

      {/* 建议区域 */}
      {suggestions.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="gray">建议: {suggestions.join(', ')}</Text>
        </Box>
      )}

      {/* 输入区域 */}
      <Box>
        <Text color="cyan">zotero&gt; </Text>
        <TextInput value={input} onChange={setInput} />
      </Box>
    </Box>
  );
}

// 启动 shell
render(<ZoteroShell />);
