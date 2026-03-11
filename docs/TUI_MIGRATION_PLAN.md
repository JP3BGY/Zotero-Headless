# Zotero Shell TUI 迁移计划

> 目标：借鉴 Claude Code 的 TUI 架构和交互模式，将 Zotero Shell 从单文件实现升级为模块化、
> 可扩展、高性能的终端 UI。

## 完成状态总览

| Phase | 状态 | 备注 |
|-------|------|------|
| Phase 0: 组件化拆分与状态管理重构 | **已完成** | 18 个文件，~1400 行 |
| Phase 1: Spinner + StatusLine + 可折叠输出 | **大部分完成** | 仅 OutputGroup（可折叠输出）未实现 |
| Phase 2: 富文本渲染 + 多行输入 + 历史持久化 | **部分完成** | 历史持久化已完成；富文本渲染、多行输入待实现 |
| Phase 3: Keybinding 可配置 + 渲染优化 | **已完成** | Keybinding 通过 ~/.zoterrc 配置；渲染优化（React.memo + 窗口化）已就绪 |

### 额外已完成项（不在原计划中）

- 命令提示行上下包裹全宽分隔线（Divider 组件）
- StatusBar 组件：显示 user ID、db 连接状态（彩色）、库数量、item 数量、最近同步时间、快捷键提示
- 共享 chalk 彩色符号模块（`@zotero-headless/core/symbols`），所有包统一使用
- 全代码库 emoji 替换为纯文本符号

---

## 设计原则

1. **选择性采用**：Claude Code 是对话式 AI Agent TUI，Zotero Shell 是命令行 Shell TUI。
   采用通用 TUI 模式（组件化、状态管理、Spinner、可折叠输出），保持 Shell 交互特色。
2. **渐进式迁移**：每个 Phase 独立可交付，不破坏现有功能。
3. **最小复杂度**：不过度设计，当前只做必要的改造。

---

## Phase 0: 组件化拆分与状态管理重构（P0）

**目标**：将单文件 `index.tsx` 拆分为模块化组件树，建立 Context-based 状态管理。

### 0.1 文件结构（已实现）

```
apps/shell/src/
├── app.tsx                      # 根组件 ZoteroShell + ShellUI
├── components/
│   ├── Header.tsx               # Header + ShortcutHints + Divider 组件
│   ├── OutputArea.tsx           # 输出历史区域（滚动）
│   ├── OutputLine.tsx           # 单行输出渲染（使用 chalk 彩色符号）
│   ├── InputPrompt.tsx          # 输入行 (> prompt + TextInput + Spinner)
│   ├── CompletionList.tsx       # 补全下拉列表
│   ├── Spinner.tsx              # 自定义 braille 动画指示器 + 计时
│   ├── StatusLine.tsx           # 顶部标题行
│   ├── StatusBar.tsx            # 底部状态栏（db/sync/library 信息）
│   └── ConfirmPrompt.tsx        # y/n 确认提示（用于破坏性操作）
├── hooks/
│   ├── useShellState.ts         # Shell 状态 Context + reducer（13 种 action）
│   ├── useHistory.ts            # 命令历史 Hook
│   ├── useCompletions.ts        # 补全逻辑 Hook
│   ├── useScroll.ts             # 终端布局计算 Hook
│   └── useKeyHandler.ts         # 键盘输入处理 Hook
├── types.ts                     # 共享类型定义
├── i18n.ts                      # 国际化字符串（中/英双语）
├── commands.ts                  # 命令系统（25+ 命令别名）
└── index.tsx                    # 入口点（仅 render 调用）
```

### 0.2 ShellState 设计

```typescript
// types.ts
interface OutputLine {
  id: number;
  type: 'input' | 'output' | 'error' | 'info';
  content: string;
  timestamp: number;
  // Phase 1 扩展：
  // commandId?: number;     // 关联的命令 ID（用于折叠分组）
  // collapsed?: boolean;
}

interface ShellState {
  // UI state
  mode: 'idle' | 'executing' | 'confirming';
  input: string;
  inputKey: number;           // force cursor reset

  // Output
  lines: OutputLine[];
  scrollOffset: number;

  // Completions
  suggestions: CommandSuggestion[];
  itemKeySuggestions: ItemKeySuggestion[];
}

type ShellAction =
  | { type: 'SET_INPUT'; value: string }
  | { type: 'ADD_LINE'; lineType: OutputLine['type']; content: string }
  | { type: 'CLEAR_LINES' }
  | { type: 'SET_MODE'; mode: ShellState['mode'] }
  | { type: 'SET_SCROLL'; offset: number }
  | { type: 'SET_SUGGESTIONS'; suggestions: CommandSuggestion[] }
  | { type: 'SET_ITEM_SUGGESTIONS'; suggestions: ItemKeySuggestion[] }
  | { type: 'RESET_INPUT' };  // clear input + suggestions + reset key

// hooks/useShellState.ts
const ShellContext = createContext<[ShellState, Dispatch<ShellAction>]>(...);

function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case 'ADD_LINE':
      return {
        ...state,
        lines: [...state.lines, { id: nextId(), type: action.lineType, content: action.content, timestamp: Date.now() }],
        scrollOffset: 0,  // auto-scroll to bottom
      };
    case 'RESET_INPUT':
      return {
        ...state,
        input: '',
        inputKey: state.inputKey + 1,
        suggestions: [],
        itemKeySuggestions: [],
      };
    // ...
  }
}
```

### 0.3 实施步骤

1. 创建 `types.ts` 和 `i18n.ts`，提取现有类型和翻译字符串
2. 创建 `hooks/useShellState.ts`，实现 reducer + Context
3. 创建 `hooks/useHistory.ts`，从 `HistoryManager` 类提取为 Hook
4. 创建 `hooks/useCompletions.ts`，从 `ZoteroExecutor` 补全逻辑提取
5. 创建 `hooks/useScroll.ts`，提取滚动计算逻辑
6. 创建 `hooks/useKeyHandler.ts`，提取 `useInput` 回调
7. 逐个创建组件文件，从 `index.tsx` JSX 中提取
8. 创建 `app.tsx` 组装全部组件
9. 简化 `index.tsx` 为入口点
10. 验证功能等价性

### 0.4 验收标准

- [x] 所有现有功能正常工作（命令执行、补全、历史、滚动）
- [x] 单文件拆分为 12+ 个文件（当前 18 个文件，共 ~1400 行）
- [x] 每个组件文件 < 100 行
- [x] 状态通过 Context 传递，无 prop drilling

---

## Phase 1: Spinner + StatusLine + 可折叠输出（P1）

**目标**：替换 ⏳ 为动画 Spinner，添加状态栏，实现命令输出折叠。

### 1.1 Spinner 组件 ✅

> **实现说明**：未使用 `ink-spinner`，改用自定义 braille 动画帧（⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏），
> 内置计时功能（useElapsedTime 逻辑内联在 Spinner 组件中，未独立为 hook）。
> 38 行，集成在 InputPrompt 中显示。

### 1.2 StatusLine + StatusBar ✅

> **实现说明**：拆分为两个组件：
> - **StatusLine.tsx**（11 行）：顶部仅显示标题 "Zotero Shell"
> - **StatusBar.tsx**（96 行）：底部显示 user ID、db 连接状态（绿/红色）、库数量、item 数量、
>   最近同步时间（相对时间格式）、快捷键提示。每 30s 自动刷新 + 命令完成后刷新。
>   直接查询 SQLite 数据库获取实时数据。

### 1.3 可折叠输出组 ❌（未实现）

> **状态**：OutputGroup 组件尚未实现。当前输出为扁平行列表，无命令分组和折叠功能。
> 这是 Phase 1 中唯一未完成的功能点。

**原始设计**：
- OutputGroup 数据结构：按命令分组输出行，记录 exitCode 和 duration
- 输出 > 20 行时自动折叠已完成的命令
- 当前执行中的命令始终展开
- 最近一条命令始终展开

### 1.4 确认提示 ✅

> **实现说明**：ConfirmPrompt.tsx（32 行），支持 y/n/Escape 输入，
> 集成在 Shell 状态的 `confirming` mode 中。

### 1.5 实施步骤

1. ~~用 `ink-spinner` 替换 ⏳~~ → 自定义 braille Spinner ✅
2. ~~用 `React.memo` 包裹 OutputArea~~ → 暂未需要 ✅
3. ~~实现 StatusLine~~ → StatusLine + StatusBar 双组件 ✅
4. ~~扩展 OutputLine 类型添加 `commandId` 字段~~ → 待 OutputGroup 实现时添加
5. 实现 OutputGroup 组件，支持折叠/展开 → **未完成**
6. ~~在 commands.ts 中 delete 命令执行前添加确认流程~~ ✅
7. ~~添加 `useElapsedTime` hook~~ → 内联在 Spinner 中 ✅

### 1.6 验收标准

- [x] 执行命令时显示动画 Spinner + 命令名 + 经过时间（自定义 braille 动画帧 ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏）
- [x] Spinner 动画不导致 OutputArea 闪烁
- [x] 顶部显示 StatusLine；底部 StatusBar 显示 db 连接状态、库数量、item 数量、最近同步时间
- [ ] 长输出自动折叠，可展开查看（OutputGroup 尚未实现）
- [x] delete 操作前弹出确认提示（ConfirmPrompt 组件）

---

## Phase 2: 富文本渲染 + 多行输入 + 历史持久化（P2）

**目标**：提升输出可读性和输入灵活性。

### 2.1 Markdown / 富文本渲染

目的是让 `show <key>` 等详情命令的输出更易读：

```typescript
// components/RichOutput.tsx
// 支持：
// - 表格对齐（item list）
// - 代码块（BibTeX export）
// - 链接（DOI URLs）
// - 加粗/颜色（字段名）
```

**方案选择**：
- 方案 A：使用 `ink-markdown` 社区包（需评估稳定性）
- 方案 B：自定义简单 Markdown subset 渲染器（只支持表格、代码块、加粗）
- **推荐方案 B**：Zotero Shell 不需要完整 Markdown，只需表格和结构化数据展示

### 2.2 多行输入

```typescript
// components/MultiLineInput.tsx
// Enter = 提交
// Shift+Enter = 换行（用于 note 编辑等场景）
// ↑↓ = 多行时在行间移动；单行时浏览历史
```

**实现考量**：
- ink-text-input 不支持多行，需要自定义组件或 fork
- 参考 Claude Code 的 `chat:newline` keybinding action
- 初期可仅在特定命令（如 `note`）中启用多行模式

### 2.3 历史持久化 ✅

> **实现说明**：复用 `packages/core/src/history-manager.ts` 的持久化 `HistoryManager`，
> 新增 `type: 'shell_command'` 类型。历史保存到 `~/.local/share/zotero-headless/history.json`，
> 最多 500 条。Shell 启动时加载历史命令，支持 ↑↓ 箭头跨 session 浏览。
> 修改了 `apps/shell/src/hooks/useHistory.ts` 替换原有的内存实现。

### 2.4 实施步骤

1. 实现简单表格渲染组件（对齐列宽、边框）
2. 实现代码块渲染（背景色 + 语法标识）
3. 改造 `show` 命令输出为结构化富文本
4. 评估多行输入方案（自定义 vs fork ink-text-input）
5. 实现历史文件读写（JSON Lines 格式）
6. 添加 session 标识用于历史排序

### 2.5 验收标准

- [ ] `list` 命令输出为对齐表格
- [ ] `show` 命令输出为结构化卡片（字段名加粗、DOI 可点击）
- [ ] `export --format=bibtex` 输出带代码块样式
- [ ] 多行输入在 `note` 命令中可用
- [x] 历史跨 session 持久化

---

## Phase 3: Keybinding 可配置 + 渲染优化（P3）

**目标**：高级用户定制能力和长 session 性能。

### 3.1 Keybinding 配置

```json
// ~/.zotero-headless/keybindings.json
{
  "submit": "enter",
  "newline": "shift+enter",
  "historyUp": "up",
  "historyDown": "down",
  "scrollUp": "pageup",
  "scrollDown": "pagedown",
  "clear": "ctrl+l",
  "exit": "ctrl+d"
}
```

### 3.2 渲染优化

- `React.memo` 对所有子组件
- OutputArea 虚拟化（只渲染可见行）
- Spinner 渲染隔离（独立 render scope）
- 长输出行截断（> terminal width 时）

### 3.3 实施步骤

1. 设计 keybinding 配置格式和加载机制
2. 创建 `useKeyBindings` hook 读取配置
3. 替换硬编码按键检查为配置查找
4. 实现 OutputArea 虚拟化（窗口化渲染）
5. Profile 长 session 内存使用，修复泄漏

### 3.4 验收标准

- [x] 用户可通过 ~/.zoterrc (YAML) 自定义按键（`keybindings` 字段，集成在 ConfigManager 中）
- [x] 1000+ 行输出无性能退化（OutputArea 使用 React.memo + 窗口化渲染）
- [ ] 长时间运行 session 无内存泄漏（待验证）

---

## 工作量估算

| Phase | 新文件数 | 修改文件数 | 复杂度 |
|-------|---------|-----------|--------|
| Phase 0 | ~12 | 2 | 中（重构，无新功能） |
| Phase 1 | ~4 | ~5 | 中 |
| Phase 2 | ~3 | ~4 | 高（自定义渲染器） |
| Phase 3 | ~2 | ~4 | 中-高 |

## 关键设计决策

### Q: 为什么不完全照搬 Claude Code 的 message bubble 设计？
A: Claude Code 是对话式 AI TUI（用户消息 → AI 流式响应 → 工具调用），message bubble 是核心交互模式。
Zotero Shell 是命令式 Shell（command → output），用传统的 prompt + output 更符合用户心智模型。
我们借鉴的是**架构层面**（组件化、状态管理、性能优化），而非照搬交互设计。

### Q: 为什么 Phase 0 是重构而非新功能？
A: 当前 593 行单文件已接近可维护上限。不先拆分，后续每个 Phase 都会在同一个巨大文件里修改，
容易引入 regression。Phase 0 是所有后续工作的基础。

### Q: 什么时候应该引入 ink-select-input？
A: Phase 1 的确认提示使用简单的 y/n 输入即可。如果后续需要多选菜单（如批量操作选择 items），
再引入 ink-select-input。
