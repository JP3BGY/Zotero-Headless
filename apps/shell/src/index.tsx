#!/usr/bin/env node
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { render, Box, Text, useApp, useInput, useStdout, Spacer } from 'ink';
import TextInput from 'ink-text-input';
import { 
  executeCommand, 
  getAvailableCommands, 
  getCommandDescriptions,
  parseCommand,
  highlightSearchResult,
  type ExecuteResult 
} from './commands.js';

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

// 输出行类型
type OutputLine = {
  type: 'input' | 'output' | 'error' | 'info';
  content: string;
  id: number;
};

// 命令补全项
type CommandSuggestion = {
  name: string;
  description: string;
};

// Zotero 命令执行器
class ZoteroExecutor {
  private builtinCommands: Map<string, (args: string[]) => Promise<string>> = new Map();
  private commandDescriptions: Map<string, string>;

  constructor() {
    this.commandDescriptions = getCommandDescriptions();
    this.registerBuiltinCommands();
  }

  private registerBuiltinCommands() {
    this.builtinCommands.set('clear', async () => 'CLEAR');
    this.builtinCommands.set('cls', async () => 'CLEAR');
    this.builtinCommands.set('exit', async () => 'EXIT');
    this.builtinCommands.set('quit', async () => 'EXIT');
    this.builtinCommands.set('q', async () => 'EXIT');

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

  async execute(
    input: string, 
    onOutput?: (data: string) => void
  ): Promise<{ type: 'success' | 'error' | 'builtin'; content: string }> {
    const trimmed = input.trim();
    if (!trimmed) return { type: 'success', content: '' };

    const { cmd, args } = parseCommand(trimmed);

    // 内置命令
    if (this.builtinCommands.has(cmd)) {
      const result = await this.builtinCommands.get(cmd)!(args);
      return { type: 'builtin', content: result };
    }

    // 异步执行 zotero CLI
    try {
      const result = await executeCommand(cmd, args, onOutput);
      
      // 检查是否有错误输出
      if (result.exitCode !== 0 && result.stderr) {
        return { 
          type: 'error', 
          content: result.stderr 
        };
      }
      
      // 如果是 search 命令，高亮关键词
      if ((cmd === 'search' || cmd === 'f' || cmd === 'find') && args.length > 0) {
        const highlighted = highlightSearchResult(result.stdout, args);
        return { 
          type: result.exitCode === 0 ? 'success' : 'error', 
          content: highlighted || result.stderr || '无结果'
        };
      }

      return { 
        type: result.exitCode === 0 ? 'success' : 'error', 
        content: result.stdout || result.stderr || '命令执行完成'
      };
    } catch (error) {
      // 捕获所有未处理的错误（网络错误、超时等）
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('Command execution error:', error); // 调试日志
      return { 
        type: 'error', 
        content: `⚠️ 网络错误: ${errorMsg}\n请检查网络连接后重试。`
      };
    }
  }

  getCompletions(partial: string): CommandSuggestion[] {
    const allCommands = getAvailableCommands();
    const matches = allCommands.filter(c => c.startsWith(partial.toLowerCase()));
    
    return matches.map(name => ({
      name,
      description: this.commandDescriptions.get(name) || ''
    }));
  }
}

// 主组件
export function ZoteroShell() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<OutputLine[]>([]);
  const [suggestions, setSuggestions] = useState<CommandSuggestion[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  
  const historyManager = useRef(new HistoryManager());
  const executor = useRef(new ZoteroExecutor());
  const lineIdCounter = useRef(0);
  const containerRef = useRef<{ height: number }>({ height: 20 });

  // 获取终端高度
  useEffect(() => {
    const updateHeight = () => {
      containerRef.current.height = stdout.rows - 3 || 20;
    };
    updateHeight();
    stdout.on('resize', updateHeight);
    return () => {
      stdout.off('resize', updateHeight);
    };
  }, [stdout]);

  const addLine = useCallback((type: OutputLine['type'], content: string) => {
    const id = lineIdCounter.current++;
    setLines(prev => [...prev, { type, content, id }]);
    // 自动滚动到底部
    setScrollOffset(0);
  }, []);

  const executeCommand = useCallback(async (cmd: string) => {
    if (!cmd.trim() || isExecuting) return;

    setIsExecuting(true);
    historyManager.current.add(cmd);
    addLine('input', `> ${cmd}`);

    // 用于追踪是否有实时输出
    let hasRealtimeOutput = false;

    try {
      const result = await executor.current.execute(cmd, (chunk) => {
        // 实时输出
        if (chunk && chunk.trim()) {
          hasRealtimeOutput = true;
          addLine('output', chunk);
        }
      });

      if (result.content === 'EXIT') {
        addLine('info', '👋 再见!');
        setTimeout(() => exit(), 500);
        setIsExecuting(false);
        return;
      }

      if (result.content === 'CLEAR') {
        setLines([]);
        setInput('');
        setSuggestions([]);
        setIsExecuting(false);
        return;
      }

      // 只有在没有实时输出时才显示结果内容
      if (result.content && !hasRealtimeOutput) {
        const lineType: OutputLine['type'] = result.type === 'success' ? 'output' : 
                                            result.type === 'builtin' ? 'info' : 'error';
        addLine(lineType, result.content);
      }
    } catch (error) {
      addLine('error', `❌ 执行错误: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      // 确保状态总是重置
      setInput('');
      setSuggestions([]);
      setIsExecuting(false);
    }
  }, [exit, isExecuting, addLine]);

  useInput((value, key) => {
    if (isExecuting) return; // 执行中时忽略输入

    if (key.return) {
      executeCommand(input);
      return;
    }

    if (key.upArrow) {
      // 浏览历史
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

    // 滚动支持
    if (key.pageUp) {
      setScrollOffset(prev => Math.min(prev + 5, Math.max(0, lines.length - containerRef.current.height)));
      return;
    }
    if (key.pageDown) {
      setScrollOffset(prev => Math.max(prev - 5, 0));
      return;
    }

    if (key.tab) {
      const comps = executor.current.getCompletions(input);
      if (comps.length === 1) {
        setInput(comps[0].name + ' ');
        setSuggestions([]);
      } else if (comps.length > 0) {
        setSuggestions(comps);
      }
      return;
    }

    // 更新自动补全建议
    const newInput = input + value;
    if (newInput && !key.tab && !key.return) {
      const comps = executor.current.getCompletions(newInput);
      setSuggestions(comps.slice(0, 8)); // 最多显示 8 个建议
    } else if (!newInput) {
      setSuggestions([]);
    }
  });

  // 计算可见行（排除输入区域占用的空间）
  const visibleHeight = containerRef.current.height;
  const welcomeHeight = 2; // 欢迎消息占 2 行
  const inputAreaHeight = 2 + (suggestions.length > 0 ? Math.min(suggestions.length, 8) + 1 : 0); // 提示行 + 输入行 + 建议列表
  const outputHeight = Math.max(1, visibleHeight - inputAreaHeight - welcomeHeight);
  
  const visibleLines = lines.slice(
    Math.max(0, lines.length - outputHeight - scrollOffset),
    lines.length - scrollOffset
  );

  // 计算最长命令名长度，用于对齐
  const maxCommandLength = suggestions.length > 0 
    ? Math.max(...suggestions.map(s => s.name.length))
    : 0;

  return (
    <Box flexDirection="column" height="100%">
      {/* 欢迎消息 - 固定在顶部 */}
      <Box flexDirection="column">
        <Text color="yellow">📚 Zotero Shell v1.0.0</Text>
        <Text color="gray">输入 "help" 查看可用命令，或 "exit" 退出</Text>
      </Box>

      {/* 快捷键提示 */}
      <Box>
        <Text color="gray">Tab to autocomplete, ↑/↓ for history, Ctrl+C to quit</Text>
      </Box>

      {/* 分隔线 */}
      {lines.length > 0 && (
        <Box>
          <Text color="gray">{''.padEnd(60, '─')}</Text>
        </Box>
      )}

      {/* 历史输出区域 - 占据剩余空间 */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {visibleLines.map((item) => (
          <Box key={item.id}>
            {item.type === 'input' ? (
              <Text color="cyan">{item.content}</Text>
            ) : item.type === 'error' ? (
              <Text color="red">{item.content}</Text>
            ) : item.type === 'info' ? (
              <Text color="yellow">{item.content}</Text>
            ) : (
              <Text>{item.content}</Text>
            )}
          </Box>
        ))}
        {scrollOffset > 0 && (
          <Text color="gray">... 按 PageDown 滚动 ...</Text>
        )}
      </Box>

      {/* 输入框 - 固定在底部 */}
      <Box>
        <Text color={isExecuting ? "gray" : "cyan"}>
          {isExecuting ? "⏳ " : "> "}
        </Text>
        {!isExecuting && (
          <TextInput value={input} onChange={(value) => {
            setInput(value);
            if (value) {
              const comps = executor.current.getCompletions(value);
              setSuggestions(comps.slice(0, 8));
            } else {
              setSuggestions([]);
            }
          }} />
        )}
        {isExecuting && <Text color="gray">执行中...</Text>}
      </Box>

      {/* 命令建议列表 - 在输入框上方显示 */}
      {suggestions.length > 0 && !isExecuting && (
        <Box flexDirection="column">
          {suggestions.map((suggestion) => (
            <Box key={suggestion.name}>
              <Text color="gray">  </Text>
              <Text color="green" bold>{suggestion.name.padEnd(maxCommandLength + 2)}</Text>
              <Text color="gray">{suggestion.description}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

// 启动 shell
render(<ZoteroShell />);
