/**
 * Export API
 *
 * 导出文献为 BibTeX、RIS、CSV、JSON 等格式
 */

import { eq, and, isNull, sql, inArray } from 'drizzle-orm';
import type { ExportFormat } from './types.js';
import { ValidationError } from './errors.js';
import { parseItemData } from '@zotero-headless/types';

// ============ 类型定义 ============

export interface ExportItemsOptions {
  format: ExportFormat;
  /** Specific item keys to export. If omitted, exports items matching filters. */
  keys?: string[];
  /** Filter by item type */
  itemType?: string;
  /** Filter by collection key */
  collection?: string;
  /** Maximum items to export. Default 100. */
  limit?: number;
}

export interface ExportResult {
  content: string;
  format: ExportFormat;
  itemCount: number;
}

// ============ 延迟加载 ============

let dbModule: any;
async function getDb() {
  if (!dbModule) {
    dbModule = await import('@zotero-headless/database');
  }
  return dbModule;
}

// ============ 主函数 ============

/**
 * 导出文献为指定格式
 */
export async function exportItems(options: ExportItemsOptions): Promise<ExportResult> {
  const { format, limit = 100 } = options;

  const validFormats: ExportFormat[] = ['json', 'bibtex', 'ris', 'csv', 'csljson'];
  if (!validFormats.includes(format)) {
    throw new ValidationError(
      `Unsupported export format: ${format}. Valid formats: ${validFormats.join(', ')}`,
      'format',
    );
  }

  const { getDatabase, items } = await getDb();
  const db = getDatabase();

  // Build query conditions
  const conditions: any[] = [isNull(items.deleted)];

  if (options.keys?.length) {
    conditions.push(sql`${items.key} IN (${sql.join(options.keys.map(k => sql`${k}`), sql`, `)})`);
  }

  if (options.itemType) {
    conditions.push(eq(items.itemType, options.itemType));
  }

  if (options.collection) {
    conditions.push(sql`${items.collections} LIKE ${`%${options.collection}%`}`);
  }

  const whereClause = and(...conditions);

  const rows = db.select()
    .from(items)
    .where(whereClause)
    .limit(limit)
    .all();

  // Parse each row's rawJson for canonical field access
  const parsed = rows.map((row: any) => ({
    key: row.key,
    itemType: row.itemType,
    data: parseItemData(row.rawJson),
  }));

  let content: string;
  switch (format) {
    case 'json':
      content = toJSON(parsed);
      break;
    case 'csljson':
      content = toCslJSON(parsed);
      break;
    case 'bibtex':
      content = toBibTeX(parsed);
      break;
    case 'ris':
      content = toRIS(parsed);
      break;
    case 'csv':
      content = toCSV(parsed);
      break;
    default:
      content = toJSON(parsed);
  }

  return { content, format, itemCount: parsed.length };
}

// ============ 格式转换 ============

interface ParsedItem {
  key: string;
  itemType: string;
  data: any;
}

function toJSON(items: ParsedItem[]): string {
  return JSON.stringify(items.map(i => i.data), null, 2);
}

function toCslJSON(items: ParsedItem[]): string {
  const cslItems = items.map(item => {
    const d = item.data;
    const csl: Record<string, any> = {
      id: item.key,
      type: mapItemTypeToCsl(item.itemType),
      title: d.title || '',
    };

    if (d.creators?.length) {
      csl.author = d.creators
        .filter((c: any) => c.creatorType === 'author')
        .map(formatCreatorCsl);
      const editors = d.creators.filter((c: any) => c.creatorType === 'editor');
      if (editors.length) csl.editor = editors.map(formatCreatorCsl);
    }

    if (d.date) csl.issued = { 'date-parts': [parseDateParts(d.date)] };
    if (d.DOI) csl.DOI = d.DOI;
    if (d.url) csl.URL = d.url;
    if (d.abstractNote) csl.abstract = d.abstractNote;
    if (d.publicationTitle) csl['container-title'] = d.publicationTitle;
    if (d.volume) csl.volume = d.volume;
    if (d.issue) csl.issue = d.issue;
    if (d.pages) csl.page = d.pages;
    if (d.publisher) csl.publisher = d.publisher;
    if (d.ISBN) csl.ISBN = d.ISBN;
    if (d.ISSN) csl.ISSN = d.ISSN;

    return csl;
  });

  return JSON.stringify(cslItems, null, 2);
}

function toBibTeX(items: ParsedItem[]): string {
  let output = '';

  for (const item of items) {
    const d = item.data;
    const entryType = mapItemTypeToBibTeX(item.itemType);
    const key = item.key.toLowerCase();

    output += `@${entryType}{${key},\n`;

    if (d.title) output += `  title = {${d.title}},\n`;

    if (d.creators?.length) {
      const authors = d.creators
        .filter((c: any) => c.creatorType === 'author')
        .map((c: any) => {
          if (c.name) return c.name;
          return `${c.lastName || ''}, ${c.firstName || ''}`;
        })
        .filter(Boolean)
        .join(' and ');
      if (authors) output += `  author = {${authors}},\n`;
    }

    if (d.date) {
      const year = d.date.substring(0, 4);
      if (/^\d{4}$/.test(year)) output += `  year = {${year}},\n`;
    }

    if (d.publicationTitle) output += `  journal = {${d.publicationTitle}},\n`;
    if (d.volume) output += `  volume = {${d.volume}},\n`;
    if (d.issue) output += `  number = {${d.issue}},\n`;
    if (d.pages) output += `  pages = {${d.pages}},\n`;
    if (d.publisher) output += `  publisher = {${d.publisher}},\n`;
    if (d.DOI) output += `  doi = {${d.DOI}},\n`;
    if (d.url) output += `  url = {${d.url}},\n`;
    if (d.ISBN) output += `  isbn = {${d.ISBN}},\n`;

    // Remove trailing comma and close
    output = output.replace(/,\n$/, '\n') + '}\n\n';
  }

  return output;
}

function toRIS(items: ParsedItem[]): string {
  let output = '';

  for (const item of items) {
    const d = item.data;
    output += `TY  - ${mapItemTypeToRIS(item.itemType)}\n`;

    if (d.title) output += `TI  - ${d.title}\n`;

    if (d.creators?.length) {
      for (const c of d.creators) {
        if (c.creatorType !== 'author') continue;
        const name = c.name || `${c.lastName || ''}, ${c.firstName || ''}`;
        if (name.trim()) output += `AU  - ${name}\n`;
      }
    }

    if (d.date) output += `PY  - ${d.date}\n`;
    if (d.publicationTitle) output += `JO  - ${d.publicationTitle}\n`;
    if (d.volume) output += `VL  - ${d.volume}\n`;
    if (d.issue) output += `IS  - ${d.issue}\n`;
    if (d.pages) {
      const parts = d.pages.split('-');
      output += `SP  - ${parts[0]?.trim()}\n`;
      if (parts[1]) output += `EP  - ${parts[1].trim()}\n`;
    }
    if (d.DOI) output += `DO  - ${d.DOI}\n`;
    if (d.url) output += `UR  - ${d.url}\n`;
    if (d.abstractNote) {
      const truncated = d.abstractNote.length > 500
        ? d.abstractNote.substring(0, 500) + '...'
        : d.abstractNote;
      output += `AB  - ${truncated}\n`;
    }
    if (d.publisher) output += `PB  - ${d.publisher}\n`;
    if (d.ISBN) output += `SN  - ${d.ISBN}\n`;
    if (d.ISSN) output += `SN  - ${d.ISSN}\n`;

    output += `ER  - \n\n`;
  }

  return output;
}

function toCSV(items: ParsedItem[]): string {
  const headers = ['Key', 'Title', 'Authors', 'Year', 'Type', 'DOI', 'URL', 'Journal'];
  let output = headers.join(',') + '\n';

  for (const item of items) {
    const d = item.data;
    const authors = (d.creators || [])
      .filter((c: any) => c.creatorType === 'author')
      .map((c: any) => c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim())
      .join('; ');

    const year = d.date ? d.date.substring(0, 4) : '';

    const row = [
      csvEscape(item.key),
      csvEscape(d.title || ''),
      csvEscape(authors),
      csvEscape(year),
      csvEscape(item.itemType),
      csvEscape(d.DOI || ''),
      csvEscape(d.url || ''),
      csvEscape(d.publicationTitle || ''),
    ];

    output += row.join(',') + '\n';
  }

  return output;
}

// ============ 辅助函数 ============

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatCreatorCsl(c: any): Record<string, string> {
  if (c.name) return { literal: c.name };
  return { family: c.lastName || '', given: c.firstName || '' };
}

function parseDateParts(date: string): number[] {
  const parts = date.split(/[-/]/);
  return parts.map(p => parseInt(p, 10)).filter(n => !isNaN(n));
}

function mapItemTypeToBibTeX(zoteroType: string): string {
  const mapping: Record<string, string> = {
    journalArticle: 'article',
    book: 'book',
    bookSection: 'incollection',
    conferencePaper: 'inproceedings',
    thesis: 'phdthesis',
    report: 'techreport',
    webpage: 'misc',
    document: 'misc',
    preprint: 'misc',
  };
  return mapping[zoteroType] || 'misc';
}

function mapItemTypeToRIS(zoteroType: string): string {
  const mapping: Record<string, string> = {
    journalArticle: 'JOUR',
    book: 'BOOK',
    bookSection: 'CHAP',
    conferencePaper: 'CONF',
    thesis: 'THES',
    report: 'RPRT',
    webpage: 'ELEC',
    document: 'GEN',
    preprint: 'GEN',
  };
  return mapping[zoteroType] || 'GEN';
}

function mapItemTypeToCsl(zoteroType: string): string {
  const mapping: Record<string, string> = {
    journalArticle: 'article-journal',
    book: 'book',
    bookSection: 'chapter',
    conferencePaper: 'paper-conference',
    thesis: 'thesis',
    report: 'report',
    webpage: 'webpage',
    document: 'document',
    preprint: 'article',
    magazineArticle: 'article-magazine',
    newspaperArticle: 'article-newspaper',
    patent: 'patent',
    presentation: 'speech',
    letter: 'personal_communication',
  };
  return mapping[zoteroType] || 'article';
}
