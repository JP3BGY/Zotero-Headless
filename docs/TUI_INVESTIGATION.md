# Zotero Shell TUI 调研报告：Claude Code TUI 框架分析与迁移方案

## 一、Claude Code TUI 框架总结

### 1.1 技术栈

| 层次 | 技术 |
|------|------|
| UI 框架 | React 18 + Ink (Yoga WASM layout engine) |
| 渲染优化 | React Compiler、50ms spinner 动画隔离、REPL render scope 隔离 |
| 状态管理 | 自定义 AppStateProvider（React Context + `[state, dispatch]` 模式） |
| 输入处理 | 自定义多行输入编辑器，支持可配置 keybindings (`~/.claude/keybindings.json`) |
| Markdown | 自定义 Markdown 渲染器（代码高亮、链接、表格、图片内联） |
| 组件注册 | Context-based 组件注册表（Alert, Badge, ConfirmInput, Select, Spinner 等） |

### 1.2 核心 UI 布局

```
┌─────────────────────────────────────────────────────────┐
│ Status Line (model/effort: ○◐●, session info)           │  ← Hook 可扩展
├─────────────────────────────────────────────────────────┤
│ Message Transcript (scrollable)                         │
│  ├─ User Message Bubble                                 │
│  ├─ Assistant Message Bubble (streaming Markdown)       │
│  ├─ Tool Call Group (collapsible)                       │
│  │   ├─ Tool Name + Status indicator                    │
│  │   ├─ Tool Input (collapsed by default)               │
│  │   └─ Tool Result (collapsed, expandable)             │
│  ├─ Permission Prompt (inline modal)                    │
│  │   ├─ Tool description + input preview                │
│  │   ├─ Yes / No / Always Allow 选项                    │
│  │   └─ 键盘选择 (y/n/a)                               │
│  └─ AskUserQuestion (multiple choice / multi-select)    │
├─────────────────────────────────────────────────────────┤
│ Spinner (动画，50ms 循环，渲染隔离)                       │  ← 仅 AI 思考时
├─────────────────────────────────────────────────────────┤
│ Input Area                                              │
│  ├─ 多行文本编辑器 (Shift+Enter = 换行)                  │
│  ├─ / 命令自动补全下拉                                   │
│  ├─ @ 文件引用建议                                      │
│  └─ 历史 (↑↓, session 优先排序)                         │
├─────────────────────────────────────────────────────────┤
│ Keybinding Hints (上下文相关)                            │
└─────────────────────────────────────────────────────────┘
```

### 1.3 关键 UI 特性

#### Streaming Markdown 渲染
- AI 响应逐 token 增量追加显示，非全页重绘
- 支持代码块语法高亮、列表、表格、链接（repo-aware URL）

#### 可折叠的工具调用组
- 多个工具调用可折叠/展开，节省屏幕空间
- 显示工具名称、执行状态、耗时
- 折叠时显示摘要行（如文件路径、搜索模式）

#### Permission 系统 UI
- 内联权限提示，选项：Yes / Yes don't ask again / No
- "Yes, and don't ask again for similar commands in {workspace}" 智能匹配
- Escape 键 = No 并告诉 Claude 不同做法

#### Spinner 性能隔离
- 50ms 动画循环独立于 shell 渲染
- 不触发周围组件的 re-render
- 显示当前操作描述和已用时间

#### 多行输入
- Enter 提交，Shift+Enter 换行
- Ctrl+U 清除当前行
- 支持 keybinding 自定义 (`chat:newline` action)
- 光标支持上下移动和空行

#### 高级交互
- Stash (Ctrl+S)：暂存当前输入
- Queue：AI 工作时可排队消息
- Ctrl+O：查看/折叠完整 transcript
- Ctrl+B：后台提问
- Ctrl+F：终止后台 agent

### 1.4 状态管理架构

```typescript
// Claude Code 使用自定义 AppStateProvider
interface AppState {
  // Session
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions';

  // Model
  model: string;  // haiku, sonnet, opus
  effort: 'low' | 'medium' | 'high';

  // Messages
  messages: Message[];  // user, assistant, progress, system, tool_result, attachment

  // Tasks
  tasks: Map<string, TaskState>;

  // MCP
  mcp: { clients, tools, commands, resources };
}

// 组件注册表 via Context
const ComponentRegistry = {
  Alert, Badge, ConfirmInput, MultiSelect, OrderedList,
  ProgressBar, Select, Spinner, StatusMessage,
  UnorderedList, TextInput, EmailInput, PasswordInput
};
```

### 1.5 消息类型系统

| 类型 | 用途 |
|------|------|
| `user` | 用户输入消息 |
| `assistant` | Claude 响应（含 content blocks：text, tool_use） |
| `progress` | 工具执行进度更新 |
| `system` | 系统/Hook 消息 |
| `tool_result` | 工具执行结果 |
| `attachment` | 文件附件 |

### 1.6 渲染优化

- **React Compiler**：编译时优化 re-render
- **50ms spinner 隔离**：动画循环独立于主渲染树
- **REPL render scope 隔离**：防止长会话内存泄漏（~35MB/1000 turns）
- **Prompt input re-render 减少 74%**：通过 memo 和 callback 稳定化
- **Yoga WASM 延迟加载**：减少 ~16MB 基础内存
- **CJK 宽字符**：正确对齐中日韩字符

---

## 二、Zotero Shell 当前 TUI 分析

### 2.1 技术栈

| 技术 | 版本 |
|------|------|
| ink | ^5.0.0 |
| ink-text-input | ^6.0.0 |
| ink-select-input | ^6.0.0（未使用） |
| ink-spinner | ^5.0.0（未使用） |
| react | ^18.2.0 |

### 2.2 当前布局

```
┌─────────────────────────────────────────────────────────┐
│ Welcome Message (yellow, 2 lines)                       │  ← 固定
├─────────────────────────────────────────────────────────┤
│ Shortcut Hints (gray, 1 line)                           │  ← 固定
├─────────────────────────────────────────────────────────┤
│ Divider ──────────────────                              │
├─────────────────────────────────────────────────────────┤
│ Output Area (flat text lines, scrollable)               │
│  ├─ cyan: user input echo                               │
│  ├─ white: command output                               │
│  ├─ red: error output                                   │
│  └─ yellow: info messages                               │
├─────────────────────────────────────────────────────────┤
│ > [TextInput] (单行)                                    │
├─────────────────────────────────────────────────────────┤
│ Completion Box (3 lines, fixed)                         │
└─────────────────────────────────────────────────────────┘
```

### 2.3 文件结构

| 文件 | 用途 | 行数 |
|------|------|------|
| `apps/shell/src/index.tsx` | 主组件 + 全部 UI 逻辑 | 593 |
| `apps/shell/src/commands.ts` | 命令执行 + 补全 + DB 查询 | 352 |

### 2.4 现有功能

- 命令行输入 + 实时输出
- 命令/选项/Item Key 三级 Tab 补全
- 命令历史 (↑↓ 浏览，内存中)
- PgUp/PgDn 滚动
- 中英文 i18n
- 搜索关键词黄色高亮
- 执行中状态 ⏳

---

## 三、差距分析

| 维度 | 当前状态 | Claude Code 水平 | 优先级 |
|------|---------|-------------------|--------|
| 组件化 | 单文件 593 行 | 模块化组件树 + Context | P0 |
| 状态管理 | 全部 useState | AppStateProvider + hooks | P0 |
| Loading 指示 | ⏳ emoji | 动画 Spinner + 进度文本 | P0 |
| 输出分组 | 平铺文本 | 可折叠命令输出组 | P1 |
| 状态栏 | 无 | StatusLine (连接/同步/库信息) | P1 |
| 确认对话 | 无 | 内联 ConfirmInput | P1 |
| 输出渲染 | 纯 ANSI color | Markdown + 代码高亮 | P2 |
| 多行输入 | 单行 TextInput | 多行编辑器 | P2 |
| 历史持久化 | 内存 | 文件持久化 + session 优先 | P2 |
| Keybinding | 硬编码 | JSON 可配置 | P3 |
| 渲染优化 | 无特殊处理 | Spinner 隔离 + memo | P3 |

---

## 四、参考资料

### Claude Code 源码参考
- `reference/claude-code/tui-source/cli-v1.0.17-beautified.js` — beautified 源码（341K 行，变量名已混淆，可 grep）
- `reference/claude-code/tui-source/README.md` — grep 模式和关键发现文档
- `reference/claude-code/CHANGELOG.md` — 完整变更历史，含 UI 特性和性能优化细节

### Ink 框架文档
- [Ink GitHub](https://github.com/vadimdemedes/ink) — React for CLIs
- [Yoga Layout](https://yogalayout.dev/) — Flexbox layout engine
- Ink 内置组件: Box, Text, Spacer, Newline, Transform, Static

### 关键 Ink 社区组件
- `ink-text-input` — 文本输入
- `ink-select-input` — 选择列表
- `ink-spinner` — 加载动画
- `ink-link` — 终端链接
- `ink-table` — 表格渲染
- `ink-markdown` — Markdown 渲染（社区）
