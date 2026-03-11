const lang = process.env.ZOTERO_LANG || 'zh';
const isEnglish = lang === 'en';

export const t = {
  welcome: 'Zotero Shell v1.0.0',
  subtitle: isEnglish ? 'Type "help" for commands, or "exit" to quit' : '输入 "help" 查看可用命令，或 "exit" 退出',
  shortcuts: isEnglish ? 'Tab=complete, ↑↓=history, PgUp/PgDn=scroll, Ctrl+C=exit' : 'Tab=补全, ↑↓=历史, PgUp/PgDn=滚动, Ctrl+C=退出',
  scrollHint: isEnglish ? '... Press PageDown to scroll ...' : '... 按 PageDown 滚动 ...',
  executing: isEnglish ? 'Executing...' : '执行中...',
  moreMatches: (n: number) => isEnglish ? `... ${n} more matches` : `... 还有 ${n} 个匹配`,
  goodbye: isEnglish ? 'Goodbye!' : '再见!',
  unknownCommand: (cmd: string) => isEnglish ? `Unknown command: ${cmd}` : `未知命令: ${cmd}`,
  networkError: (msg: string) => isEnglish ? `Network error: ${msg}\nPlease check your connection and try again.` : `网络错误: ${msg}\n请检查网络连接后重试。`,
  execError: (msg: string) => isEnglish ? `Execution error: ${msg}` : `执行错误: ${msg}`,
  noResult: isEnglish ? 'No results' : '无结果',
  commandDone: isEnglish ? 'Command completed' : '命令执行完成',
  confirmDelete: (key: string) => isEnglish
    ? `Delete item "${key}"? This cannot be undone.`
    : `确认删除 "${key}"？此操作不可撤销。`,
  cancelled: isEnglish ? 'Cancelled.' : '已取消。',
  help: isEnglish ? `
Zotero Shell Help

Item Management:
  ls, list                List items
  search <keywords>       Search items
  add                     Add new item
  rm <key>                Delete item
  show <key>              Show details
  update <key>            Update item

Sync & Storage:
  sync, s                 Sync data
  webdav                  WebDAV management

Others:
  stats                   Statistics
  verify                  Verify API key
  config                  Configuration
  help                    Show help
  exit, quit              Exit shell

Shortcuts:
  Tab                     Autocomplete commands/options
  ↑/↓                     Browse command history
  PgUp/PgDn               Scroll output up/down
  Ctrl+C                  Exit shell
      `.trim() : `
Zotero Shell 帮助

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
  Tab                     自动补全命令/选项
  ↑/↓                     浏览历史命令
  PgUp/PgDn               向上/向下滚动输出
  Ctrl+C                  退出
      `.trim(),
};
