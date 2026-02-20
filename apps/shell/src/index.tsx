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
  needsItemKey,
  getItemKeyCompletions,
  clearItemCache,
  type ExecuteResult,
  type ItemInfo
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

// Item Key 补全项
type ItemKeySuggestion = {
  key: string;
  title: string;
  itemType: string;
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

  async getItemKeyCompletions(prefix: string): Promise<ItemKeySuggestion[]> {
    const items = await getItemKeyCompletions(prefix);
    return items;
  }
}

// 主组件
export function ZoteroShell() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<OutputLine[]>([]);
  const [suggestions, setSuggestions] = useState<CommandSuggestion[]>([]);
  const [itemKeySuggestions, setItemKeySuggestions] = useState<ItemKeySuggestion[]>([]);
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
      setItemKeySuggestions([]);
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
      // 检查是否是 item key 补全
      const parts = input.trim().split(/\s+/);
      const cmd = parts[0]?.toLowerCase() || '';
      const arg = parts[1] || '';

      if (needsItemKey(cmd) && parts.length >= 2) {
        // Item Key 补全
        executor.current.getItemKeyCompletions(arg).then(items => {
          if (items.length === 1) {
            setInput(`${cmd} ${items[0].key}`);
            setItemKeySuggestions([]);
          } else if (items.length > 0) {
            setItemKeySuggestions(items);
          }
        });
      } else {
        // 命令补全
        const comps = executor.current.getCompletions(input);
        if (comps.length === 1) {
          setInput(comps[0].name + ' ');
          setSuggestions([]);
        } else if (comps.length > 0) {
          setSuggestions(comps);
        }
      }
      return;
    }

    // 更新自动补全建议
    const newInput = input + value;
    if (newInput && !key.tab && !key.return) {
      const parts = newInput.trim().split(/\s+/);
      const cmd = parts[0]?.toLowerCase() || '';
      const arg = parts[1] || '';

      if (needsItemKey(cmd) && parts.length >= 2) {
        // Item Key 补全模式
        executor.current.getItemKeyCompletions(arg).then(items => {
          setItemKeySuggestions(items.slice(0, 8));
          setSuggestions([]);
        });
      } else {
        // 命令补全模式
        const comps = executor.current.getCompletions(newInput);
        setSuggestions(comps.slice(0, 8));
        setItemKeySuggestions([]);
      }
    } else if (!newInput) {
      setSuggestions([]);
      setItemKeySuggestions([]);
    }
  });

  // 计算可见行
  const visibleHeight = containerRef.current.height;
  const welcomeHeight = 2; // 欢迎消息占 2 行
  const shortcutHeight = 1; // 快捷键提示占 1 行
  const dividerHeight = lines.length > 0 ? 1 : 0; // 分隔线
  const inputHeight = 1; // 输入行固定1行
  const completionHeight = 3; // 补全区域固定3行（在底部）
  const outputHeight = Math.max(1, visibleHeight - welcomeHeight - shortcutHeight - dividerHeight - inputHeight - completionHeight);

  const visibleLines = lines.slice(
    Math.max(0, lines.length - outputHeight - scrollOffset),
    lines.length - scrollOffset
  );

  return (
    <Box flexDirection="column" height="100%">
      {/* 1. 欢迎消息 - 固定在顶部 */}
      <Box flexDirection="column">
        <Text color="yellow">📚 Zotero Shell v1.0.0</Text>
        <Text color="gray">输入 "help" 查看可用命令，或 "exit" 退出</Text>
      </Box>

      {/* 2. 快捷键提示 */}
      <Box>
        <Text color="gray">Tab to autocomplete, ↑/↓ for history, Ctrl+C to quit</Text>
      </Box>

      {/* 3. 分隔线 */}
      {lines.length > 0 && (
        <Box>
          <Text color="gray">{''.padEnd(60, '─')}</Text>
        </Box>
      )}

      {/* 4. 历史输出区域 */}
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

      {/* 5. 输入行 */}
      <Box>
        <Text color={isExecuting ? "gray" : "cyan"}>
          {isExecuting ? "⏳ " : "> "}
        </Text>
        {!isExecuting && (
          <TextInput value={input} onChange={(value) => {
            setInput(value);
            if (value) {
              const parts = value.trim().split(/\s+/);
              const cmd = parts[0]?.toLowerCase() || '';
              const arg = parts[1] || '';

              if (needsItemKey(cmd) && parts.length >= 2) {
                // Item Key 补全模式
                executor.current.getItemKeyCompletions(arg).then(items => {
                  setItemKeySuggestions(items.slice(0, 8));
                  setSuggestions([]);
                });
              } else {
                // 命令补全模式
                const comps = executor.current.getCompletions(value);
                setSuggestions(comps.slice(0, 8));
                setItemKeySuggestions([]);
              }
            } else {
              setSuggestions([]);
              setItemKeySuggestions([]);
            }
          }} />
        )}
        {isExecuting && <Text color="gray">执行中...</Text>}
      </Box>

      {/* 6. 补全列表 - 固定3行在最底部 */}
      <Box flexDirection="column" height={3} overflow="hidden">
        {suggestions.length > 0 && !isExecuting && (
          <>
            {suggestions.slice(0, 3).map((suggestion) => (
              <Box key={suggestion.name}>
                <Text color="gray">  </Text>
                <Text color="green" bold>{suggestion.name.padEnd(12)}</Text>
                <Text color="gray">{suggestion.description.substring(0, 50)}</Text>
                {suggestion.description.length > 50 && <Text color="gray">...</Text>}
              </Box>
            ))}
            {suggestions.length > 3 && (
              <Box>
                <Text color="gray">  ... 还有 {suggestions.length - 3} 个匹配</Text>
              </Box>
            )}
          </>
        )}
        {itemKeySuggestions.length > 0 && !isExecuting && (
          <>
            {itemKeySuggestions.slice(0, 3).map((item) => (
              <Box key={item.key}>
                <Text color="gray">  </Text>
                <Text color="cyan" bold>{item.key.padEnd(12)}</Text>
                <Text color="white">{item.title.substring(0, 40)}</Text>
                {item.title.length > 40 && <Text color="gray">...</Text>}
                <Text color="gray"> ({item.itemType})</Text>
              </Box>
            ))}
            {itemKeySuggestions.length > 3 && (
              <Box>
                <Text color="gray">  ... 还有 {itemKeySuggestions.length - 3} 个匹配</Text>
              </Box>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}

// 启动 shell
render(<ZoteroShell />);
