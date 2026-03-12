// i18n Internationalization Support
// Multi-language support for Zotero-Headless CLI

import { symbols } from '@zotero-headless/core';

export type Language = 'en' | 'zh';

export interface Translations {
  [key: string]: string | Translations | ((...args: any[]) => string);
}

// English translations
const en: Translations = {
  common: {
    error: 'Error',
    warning: 'Warning',
    success: 'Success',
    loading: 'Loading...',
    done: 'Done',
    cancel: 'Cancel',
    confirm: 'Confirm',
    yes: 'Yes',
    no: 'No',
    save: 'Save',
    delete: 'Delete',
    edit: 'Edit',
    create: 'Create',
    update: 'Update',
    sync: 'Sync',
    search: 'Search',
    filter: 'Filter',
    sort: 'Sort',
    unknown: 'Unknown',
    none: 'None',
    all: 'All',
  },
  commands: {
    sync: {
      starting: 'Starting two-way sync...',
      fullSync: '(Full sync mode - ignoring version numbers)',
      groupSync: '(Sync all group libraries)',
      groupSingle: (group: string) => `(Sync group: ${group})`,
      quiet: '(Quiet mode - no progress output)',
      interactive: '(Interactive mode - prompt for conflicts)',
      completed: 'Sync completed!',
      stats: (updated: number, errors: number) => 
        `Stats: ${updated} updated, ${errors} errors`,
      downloading: (concurrency: number) => 
        `   Downloading with ${concurrency} parallel connections...`,
      batchProgress: (current: number, total: number) => 
        `   Downloaded ${current}/${total} items...`,
    },
    list: {
      title: 'Library Items',
      filtered: '(filtered)',
      noItems: 'No items found',
      showing: (start: number, end: number, total: number) => 
        `Showing items ${start}-${end} of ${total}`,
    },
    search: {
      searching: 'Searching...',
      results: (count: number) => `Found ${count} results`,
      noResults: 'No results found',
    },
    add: {
      adding: 'Adding new item...',
      added: (key: string) => `Item added successfully: ${key}`,
      error: 'Failed to add item',
    },
    update: {
      updating: 'Updating item...',
      updated: (key: string) => `Item updated: ${key}`,
      error: 'Failed to update item',
    },
    delete: {
      deleting: 'Deleting item...',
      deleted: (key: string) => `Item deleted: ${key}`,
      error: 'Failed to delete item',
    },
    export: {
      exporting: 'Exporting...',
      exported: (path: string) => `Exported to: ${path}`,
      error: 'Export failed',
    },
    webdav: {
      configured: 'WebDAV configured successfully',
      testing: 'Testing WebDAV connection...',
      connected: 'WebDAV connection successful',
      failed: 'WebDAV connection failed',
      syncing: 'Syncing attachments to WebDAV...',
      synced: (count: number) => `Synced ${count} attachments`,
    },
  },
  errors: {
    noLibrary: 'No library found. Please configure first: zotero config',
    noConfig: 'Configuration not found',
    invalidKey: 'Invalid item key',
    networkError: 'Network error - check your connection',
    apiError: (code: number) => `API error: ${code}`,
    fileNotFound: (path: string) => `File not found: ${path}`,
    permissionDenied: 'Permission denied',
  },
  fields: {
    title: 'Title',
    author: 'Author',
    date: 'Date',
    abstract: 'Abstract',
    tags: 'Tags',
    type: 'Type',
    url: 'URL',
    doi: 'DOI',
    isbn: 'ISBN',
    journal: 'Journal',
    volume: 'Volume',
    issue: 'Issue',
    pages: 'Pages',
    publisher: 'Publisher',
  },
  types: {
    journalArticle: 'Journal Article',
    book: 'Book',
    bookSection: 'Book Section',
    conferencePaper: 'Conference Paper',
    thesis: 'Thesis',
    report: 'Report',
    webpage: 'Webpage',
    attachment: 'Attachment',
    note: 'Note',
  },
  conflict: {
    title: 'Conflict Detected',
    description: (item: string) => `Item "${item}" has conflicting changes`,
    local: 'Use local version',
    remote: 'Use remote version',
    skip: 'Skip this item',
    allLocal: 'Use local for all remaining',
    allRemote: 'Use remote for all remaining',
    prompt: 'Your choice (l/r/s/L/R): ',
  },
  progress: {
    start: 'Starting...',
    processing: 'Processing...',
    completed: 'Completed',
    failed: 'Failed',
  },
};

// Chinese translations
const zh: Translations = {
  common: {
    error: '错误',
    warning: '警告',
    success: '成功',
    loading: '加载中...',
    done: '完成',
    cancel: '取消',
    confirm: '确认',
    yes: '是',
    no: '否',
    save: '保存',
    delete: '删除',
    edit: '编辑',
    create: '创建',
    update: '更新',
    sync: '同步',
    search: '搜索',
    filter: '过滤',
    sort: '排序',
    unknown: '未知',
    none: '无',
    all: '全部',
  },
  commands: {
    sync: {
      starting: '开始双向同步...',
      fullSync: '   (完整同步模式 - 忽略版本号)',
      groupSync: '   (同步所有群组库)',
      groupSingle: (group: string) => `   (同步群组: ${group})`,
      quiet: '   (静默模式 - 无进度输出)',
      interactive: '   (交互模式 - 提示冲突解决)',
      completed: `${symbols.success} 同步完成！`,
      stats: (updated: number, errors: number) => 
        `同步统计：更新 ${updated} 个，错误 ${errors} 个`,
      downloading: (concurrency: number) => 
        `   使用 ${concurrency} 个并行连接下载...`,
      batchProgress: (current: number, total: number) => 
        `   已下载 ${current}/${total} 个项目...`,
    },
    list: {
      title: '文献列表',
      filtered: '(已过滤)',
      noItems: '未找到文献',
      showing: (start: number, end: number, total: number) => 
        `显示第 ${start}-${end} 项，共 ${total} 项`,
    },
    search: {
      searching: '搜索中...',
      results: (count: number) => `找到 ${count} 个结果`,
      noResults: '未找到结果',
    },
    add: {
      adding: '添加新文献...',
      added: (key: string) => `文献添加成功: ${key}`,
      error: '添加文献失败',
    },
    update: {
      updating: '更新文献...',
      updated: (key: string) => `文献已更新: ${key}`,
      error: '更新文献失败',
    },
    delete: {
      deleting: '删除文献...',
      deleted: (key: string) => `文献已删除: ${key}`,
      error: '删除文献失败',
    },
    export: {
      exporting: '导出中...',
      exported: (path: string) => `已导出到: ${path}`,
      error: '导出失败',
    },
    webdav: {
      configured: `${symbols.success} WebDAV 配置成功`,
      testing: '测试 WebDAV 连接...',
      connected: `${symbols.success} WebDAV 连接成功`,
      failed: `${symbols.error} WebDAV 连接失败`,
      syncing: '同步附件到 WebDAV...',
      synced: (count: number) => `已同步 ${count} 个附件`,
    },
  },
  errors: {
    noLibrary: `${symbols.error} 未找到库。请先配置: zotero config`,
    noConfig: `${symbols.error} 未找到配置`,
    invalidKey: `${symbols.error} 无效的文献 Key`,
    networkError: `${symbols.error} 网络错误 - 请检查连接`,
    apiError: (code: number) => `${symbols.error} API 错误: ${code}`,
    fileNotFound: (path: string) => `${symbols.error} 文件未找到: ${path}`,
    permissionDenied: `${symbols.error} 权限被拒绝`,
  },
  fields: {
    title: '标题',
    author: '作者',
    date: '日期',
    abstract: '摘要',
    tags: '标签',
    type: '类型',
    url: '网址',
    doi: 'DOI',
    isbn: 'ISBN',
    journal: '期刊',
    volume: '卷',
    issue: '期',
    pages: '页码',
    publisher: '出版社',
  },
  types: {
    journalArticle: '期刊文章',
    book: '书籍',
    bookSection: '书籍章节',
    conferencePaper: '会议论文',
    thesis: '学位论文',
    report: '报告',
    webpage: '网页',
    attachment: '附件',
    note: '笔记',
  },
  conflict: {
    title: '! 检测到冲突',
    description: (item: string) => `文献 "${item}" 存在冲突的更改`,
    local: '使用本地版本',
    remote: '使用远程版本',
    skip: '跳过此项',
    allLocal: '所有剩余项使用本地',
    allRemote: '所有剩余项使用远程',
    prompt: '您的选择 (l/r/s/L/R): ',
  },
  progress: {
    start: '开始...',
    processing: '处理中...',
    completed: '已完成',
    failed: '失败',
  },
};

// Translation storage
const translations: Record<Language, Translations> = { en, zh };

// Current language (can be changed at runtime)
let currentLang: Language = 'zh';

/**
 * Initialize i18n with detected or specified language
 */
export function initI18n(lang?: Language): void {
  if (lang) {
    currentLang = lang;
  } else {
    // Auto-detect from environment
    const envLang = process.env.LANG || process.env.LC_ALL || '';
    if (envLang.toLowerCase().startsWith('zh')) {
      currentLang = 'zh';
    } else {
      currentLang = 'en';
    }
  }
}

/**
 * Set current language
 */
export function setLanguage(lang: Language): void {
  currentLang = lang;
}

/**
 * Get current language
 */
export function getLanguage(): Language {
  return currentLang;
}

/**
 * Get translation for a key path
 * Usage: t('commands.sync.starting') or t('errors.apiError', 404)
 */
export function t(key: string, ...args: any[]): string {
  const keys = key.split('.');
  let value: any = translations[currentLang];
  
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k];
    } else {
      // Fallback to English
      value = translations['en'];
      for (const k2 of keys) {
        if (value && typeof value === 'object' && k2 in value) {
          value = value[k2];
        } else {
          return key; // Return key if not found
        }
      }
      break;
    }
  }
  
  if (typeof value === 'function') {
    return value(...args);
  }
  
  return typeof value === 'string' ? value : key;
}

/**
 * Format item type for display
 */
export function formatItemType(type: string): string {
  return t(`types.${type}`) || type;
}

/**
 * Format field name for display
 */
export function formatField(field: string): string {
  return t(`fields.${field}`) || field;
}

// Initialize on module load
initI18n();
