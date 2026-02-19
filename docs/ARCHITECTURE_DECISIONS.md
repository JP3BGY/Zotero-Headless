# 重要开发决策记录

本文档记录 Zotero-Headless 项目的关键架构决策和设计选择。

## 决策索引

1. [云端操作统一通过 sync 命令](#决策-1-云端操作统一通过-sync-命令)
2. [Markdown ↔ HTML 双向转换](#决策-2-markdown--html-双向转换)
4. [ProseMirror Schema 兼容性](#决策-3-prosemirror-schema-兼容性)
5. [外部编辑器支持](#决策-4-外部编辑器支持)
6. [本地优先架构](#决策-5-本地优先架构)
7. [附件与主条目分离存储](#决策-6-附件与主条目分离存储)
8. [Zotero API Key 处理](#决策-7-zotero-api-key-处理长期调查)
9. [Key 映射与关联更新](#决策-8-key-映射与关联更新)

---

## 决策 1: 云端操作统一通过 sync 命令

**日期**: 2026-02-19

**状态**: ✅ 已采纳

**背景**: 
最初实现 `add` 命令时，直接调用了 Zotero API 创建条目到云端。这与 `add-by-id` 的行为不一致，也破坏了"本地优先"的架构原则。

**决策**: 
所有云端操作（创建、更新、删除）都只在本地数据库标记，通过统一的 `sync` 命令上传到云端。

**理由**:
1. **一致性**: 所有命令行为统一，避免混淆
2. **离线支持**: 可以在没有网络时添加条目和附件
3. **批量效率**: 可以添加多个条目后再一次性同步
4. **避免冲突**: 避免直接 API 操作与 sync 机制的冲突
5. **错误恢复**: 本地操作失败可重试，不会导致云端数据不一致

**影响**:
- `add` 命令改为只写入本地数据库
- `add-by-id` 保持一致（已正确实现）
- `update` 和 `delete` 命令同样遵循此原则
- 用户需要运行 `sync` 才能看到远程变化

**代码变更**:
```typescript
// 错误方式：直接调用 API
const result = await zoteroApi.createItems(...);

// 正确方式：只写入本地数据库
await db.insert(items).values({ ...item, synced: false });
console.log('💡 Run "zotero sync" to upload to remote.');
```

---

## 决策 2: Markdown ↔ HTML 双向转换

**日期**: 2026-02-19

**状态**: ✅ 已采纳

**背景**: 
Zotero 笔记在云端存储为 HTML，但用户习惯使用 Markdown 编辑。需要提供良好的编辑体验。

**决策**: 
实现 Markdown 到 HTML 的双向转换：
- **输入**: Markdown 格式（用户友好）
- **存储**: ProseMirror-compatible HTML（Zotero 兼容）
- **显示**: Markdown 格式（可读性强）

**技术选型**:
- `marked`: Markdown → HTML 转换
- `turndown`: HTML → Markdown 转换
- 自定义规则处理 Zotero 特有元素

**理由**:
1. **用户友好**: Markdown 是程序员和学术工作者的首选格式
2. **数据兼容**: 与 Zotero 桌面客户端完全兼容
3. **可编辑性**: 纯文本 Markdown 易于版本控制和协作
4. **生态丰富**: Markdown 工具链成熟（编辑器、渲染器、导出工具）

**实现细节**:
```typescript
// Markdown → HTML (存储到数据库)
const html = markdownToHtml("**bold** text");
// → "<p><strong>bold</strong> text</p>"

// HTML → Markdown (显示给用户)
const md = htmlToMarkdown("<p><strong>bold</strong> text</p>");
// → "**bold** text"
```

**支持的 Markdown 语法**:
- 标题 `# H1` - `###### H6`
- 粗体 `**text**`、斜体 `*text*`
- 列表 `- item`、`1. item`
- 链接 `[text](url)`、图片 `![alt](url)`
- 代码 `` `inline` ``、代码块 ` ```code``` `
- 引用 `> quote`、分隔线 `---`
- 删除线 `~~text~~`、表格
- 数学公式 `$inline$`、`$$block$$`

---

## 决策 3: ProseMirror Schema 兼容性

**日期**: 2026-02-19

**状态**: ✅ 已采纳

**背景**: 
Zotero 使用 ProseMirror 作为笔记编辑器引擎。如果不遵循其 Schema，HTML 内容在桌面客户端打开时可能丢失格式或显示异常。

**决策**: 
深入调研 Zotero note-editor 源代码，确保生成的 HTML 完全符合 ProseMirror Schema。

**调研结果**:
- 源码位置: `github.com/zotero/note-editor`
- 节点定义: `src/core/schema/nodes.js`
- 标记定义: `src/core/schema/marks.js`

**支持的 Nodes**:
- `paragraph` - 段落（支持 indent, align, dir）
- `heading` - 标题 h1-h6
- `blockquote` - 引用块（不支持嵌套）
- `codeBlock` - 代码块
- `bulletList` / `orderedList` - 列表
- `listItem` - 列表项
- `table` - 表格（通过 prosemirror-tables）
- `hardBreak` - 硬换行 `<br>`
- `image` - 图片（支持 attachmentKey, annotation）
- `math_display` / `math_inline` - 数学公式
- `citation` / `highlight` / `underline_annotation` - Zotero 特有

**支持的 Marks**:
- `strong` / `em` - 粗体/斜体
- `underline` - 下划线（支持颜色）
- `strike` - 删除线
- `subsup` - 上下标
- `link` - 链接
- `code` - 行内代码
- `textColor` / `backgroundColor` - 颜色

**数据清理策略**:
```typescript
// 移除不支持的元素
function cleanNode(node: Node): void {
  if (!isSupportedElement(child)) {
    replaceWithChildren(child);
  }
}

// 移除不安全的属性
function cleanAttributes(el: Element): void {
  // 保留：href, src, alt, data-*, class, style
  // 移除：onclick, onload, style中的position等
}
```

**测试覆盖**:
- 单元测试: `apps/cli/src/__tests__/note-utils.test.ts`
- 测试用例: 100+ 个，覆盖所有节点和标记

---

## 决策 4: 外部编辑器支持

**日期**: 2026-02-19

**状态**: ✅ 已采纳

**背景**: 
命令行中直接编辑多行文本（如笔记）体验不佳。需要提供类似 `git commit` 的交互式编辑体验。

**决策**: 
`note edit` 命令在没有提供内容时，自动打开 `$EDITOR` 环境变量指定的编辑器。

**实现机制**:
1. 创建临时文件（`.md` 后缀）
2. 将当前 Markdown 内容写入文件
3. 启动 `$EDITOR`（默认 `nano`）
4. 等待编辑器进程退出
5. 读取文件内容，与原始内容比较
6. 如有变化则更新数据库

**环境变量优先级**:
```bash
$EDITOR > $VISUAL > nano (默认)
```

**使用示例**:
```bash
# 使用 vim
EDITOR=vim zotero note edit NOTE5678

# 使用 VS Code（--wait 等待关闭）
EDITOR="code --wait" zotero note edit NOTE5678

# 永久设置
export EDITOR=vim
```

**理由**:
1. **熟悉的工作流**: 类似 `git commit`，符合开发者习惯
2. **编辑器自由**: 用户可以使用最喜欢的编辑器
3. **多行编辑**: 轻松编辑复杂 Markdown 文档
4. **语法高亮**: 利用编辑器的 Markdown 支持

**技术细节**:
```typescript
const tmpFile = fileSync({ postfix: '.md' });
writeFileSync(tmpFile.name, currentMarkdown);

const editor = process.env.EDITOR || 'nano';
const child = spawn(editor, [tmpFile.name], { stdio: 'inherit' });

await new Promise((resolve) => {
  child.on('close', resolve);
});

const edited = readFileSync(tmpFile.name, 'utf-8');
tmpFile.removeCallback();
```

---

## 决策 5: 本地优先架构

**日期**: 项目初始设计

**状态**: ✅ 已采纳

**背景**: 
Zotero 官方客户端采用持续同步模式，但这在无头环境中不实用（无法常驻内存）。

**决策**: 
采用"本地优先"架构：
1. 所有数据存储在本地 SQLite 数据库
2. 所有操作先在本地执行
3. 显式运行 `sync` 才与云端同步
4. 支持离线操作，网络恢复后自动合并

**架构图**:
```
┌─────────────┐     sync      ┌─────────────┐
│   Zotero    │ ◄────────────►│   Zotero    │
│   Cloud     │               │   Cloud     │
└─────────────┘               └─────────────┘
       ▲                            ▲
       │                            │
       ▼                            ▼
┌─────────────┐               ┌─────────────┐
│    Web      │               │    Local    │
│     API     │               │   SQLite    │
└─────────────┘               └─────────────┘
                                     ▲
                                     │
                              ┌──────┴──────┐
                              │  CLI / API  │
                              └─────────────┘
```

**理由**:
1. **无头友好**: 不需要常驻进程
2. **性能**: 本地查询毫秒级响应
3. **离线支持**: 无网络时可继续使用
4. **可靠性**: 本地数据不易丢失
5. **成本控制**: 减少 API 调用次数

**权衡**:
- ✅ 需要显式运行 `sync`
- ✅ 可能存在版本冲突（提供冲突解决机制）
- ❌ 不支持实时协作

---

## 决策 6: 附件与主条目分离存储

**日期**: 2026-02-18

**状态**: ✅ 已采纳

**背景**: 
附件（PDF、图片等）的存储方式需要考虑云端同步、本地访问和 WebDAV 支持。

**决策**: 
附件信息存储在数据库，文件可以：
1. **本地存储**: 指定本地路径
2. **WebDAV 同步**: 上传到 WebDAV 服务器
3. **延迟加载**: 按需从云端下载

**数据库 Schema**:
```typescript
interface Attachment {
  key: string;              // 唯一标识
  parentItemKey: string;    // 关联的主条目
  filename: string;         // 文件名
  contentType: string;      // MIME 类型
  localPath?: string;       // 本地路径
  webdavPath?: string;      // WebDAV 路径
  webdavSynced: boolean;    // 同步状态
  size?: number;            // 文件大小
}
```

**多附件支持**:
```bash
# 添加条目时附加多个文件
zotero add book "Title" "Author" -a file1.pdf -a file2.pdf -a data.xlsx

# 每个附件独立创建 attachment 记录
// 1. 主条目 (itemType: book)
// 2. 附件1 (itemType: attachment, parentItem: 主条目key)
// 3. 附件2 (itemType: attachment, parentItem: 主条目key)
```

**附件数量显示**:
```bash
zotero list
# 输出：✅ [ABCD1234] 标题 📎2
#                    ^^^ 显示附件数量
```

**理由**:
1. **灵活性**: 支持多种存储后端
2. **可扩展性**: 未来可支持更多存储方式（S3、Google Drive等）
3. **性能**: 附件元数据查询快速，文件按需加载
4. **兼容性**: 与 Zotero 桌面客户端的附件模型一致

---

## 决策 7: Zotero API Key 处理（长期调查）

**日期**: 2026-02-19

**状态**: ✅ 已解决

**问题**: 
同步时 Zotero API 总是重新分配 key，即使我们使用了正确的字符集。

**调查过程**:
1. 最初假设是 key 格式问题
2. 发现 Zotero 的 key 生成字符集: `23456789ABCDEFGHIJKLMNPQRSTUVWXYZ`
3. 发现 API 错误: `Either If-Unmodified-Since-Version or 'version' property must be provided for 'key'-based writes`

**根本原因**:
当发送 `key` 字段时，API 要求同时提供 `version` 属性。我们之前删除了 `version` 字段，导致 API 不接受我们发送的 key。

**解决方案**:
```typescript
// 1. 添加 'key' 到允许的字段列表
const zoteroItemFields = [
  'key', 'itemType', 'title', 'creators', ...
];

// 2. 保留 version 字段用于 key-based writes
// 不要删除 version: delete data.version; // ← 这行删除了
if (!isNewItem) {
  delete data.key;  // 只删除已有条目的 key
}
```

**测试结果**:
| 条目 | 本地 Key | 同步后 Key | 状态 |
|------|---------|-----------|------|
| Final Key Test | K2ULAZ8V | K2ULAZ8V | ✅ 保留 |
| Version Test | RATPVZJQ | RATPVZJQ | ✅ 保留 |

**架构层级**:
1. **方案A（首选）**: 使用正确的 API 调用方式，保留本地 key
   - 发送 `key` + `version=0`
   - 云端接受我们的 key，不重新分配

2. **方案B（备份）**: 如果云端仍然重新分配，自动更新本地映射
   - 同步引擎检测 key 变化
   - 更新本地数据库中的 key
   - 更新关联表中的 parentItemKey
   - 更新 notes rawJson 中的 parentItem 引用

---

## 决策 8: Key 映射与关联更新

**日期**: 2026-02-19

**状态**: ✅ 已采纳

**背景**: 
当云端重新分配 key 时（即使现在很少发生），需要正确更新所有关联数据。

**决策**: 
实现完整的 key 映射更新机制，包括：
1. 更新 items 表的主键
2. 更新 attachments 表的 parentItemKey
3. 更新 notes rawJson 中的 parentItem 引用

**实现代码**:
```typescript
await this.db.transaction(async (tx) => {
  // 1. 更新 items 表
  await tx.update(items)
    .set({ key: newKey })
    .where(and(eq(items.key, oldKey), eq(items.libraryId, libraryId)))
    .run();
  
  // 2. 更新 attachments 表的 parentItemKey
  const attachmentCount = await tx.update(attachments)
    .set({ parentItemKey: newKey })
    .where(and(
      eq(attachments.parentItemKey, oldKey),
      eq(attachments.libraryId, libraryId)
    ))
    .run();
  
  // 3. 更新作为 parent 的 notes 的 rawJson 中的 parentItem
  const childNotes = await tx.select()
    .from(items)
    .where(and(
      eq(items.itemType, 'note'),
      eq(items.libraryId, libraryId),
      like(items.rawJson, `%"parentItem":"${oldKey}"%`)
    ))
    .all();
  
  for (const note of childNotes) {
    const rawData = JSON.parse(note.rawJson);
    if (rawData.data?.parentItem === oldKey) {
      rawData.data.parentItem = newKey;
      rawData.key = newKey;
      await tx.update(items)
        .set({ rawJson: JSON.stringify(rawData) })
        .where(and(eq(items.key, note.key), eq(items.libraryId, libraryId)))
        .run();
    }
  }
});
```

**测试验证**:
```
✅ 创建带附件和笔记的条目
✅ 同步时 key 被重新分配 (PRXC5ZMT → B9DMPWKX)
✅ Attachment 的 parentItemKey 正确更新
✅ Note 的 parentItem 正确更新
✅ 条目和笔记可以通过新 key 访问
```

---

## 待决策事项

### 1. 笔记实时预览
**提议**: 添加 `note preview` 命令，在终端渲染 Markdown
**状态**: 🔄 待讨论

### 2. 笔记模板支持
**提议**: 支持模板文件（如 `~/.config/zotero-headless/note-templates/default.md`）
**状态**: 🔄 待讨论

### 3. 批量导入/导出笔记
**提议**: 支持从文件导入笔记，或导出为 Markdown 文件
**状态**: 🔄 待讨论

---

## 决策记录维护

- 新决策添加到顶部
- 更新决策时保留历史版本
- 每个决策需包含：日期、状态、背景、决策、理由、影响

**最后更新**: 2026-02-19
