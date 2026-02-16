// Export functionality for Zotero-Headless
// Supports BibTeX, RIS, CSV, JSON formats

import { getDatabase, items } from '@zotero-headless/database';

export interface ExportOptions {
  format: 'bibtex' | 'ris' | 'csv' | 'json';
  output?: string; // Output file path
  limit?: number;
  collections?: string[]; // Collection names
  tags?: string[]; // Filter by tags
}

export class Exporter {
  private db = getDatabase();
  
  async exportItems(options: ExportOptions): Promise<string> {
    const { format, limit = 100 } = options;
    
    // Query items - fetch all then apply limit
    const allItems = await this.db.select().from(items).all();
    const dbItems = allItems.slice(0, limit);
    
    // Convert to requested format
    switch (format) {
      case 'bibtex':
        return this.toBibTeX(dbItems);
      case 'ris':
        return this.toRIS(dbItems);
      case 'csv':
        return this.toCSV(dbItems);
      case 'json':
        return this.toJSON(dbItems);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }
  
  private toBibTeX(items: any[]): string {
    let bibtex = '';
    
    for (const item of items) {
      const entryType = this.mapZoteroTypeToBibTeX(item.itemType);
      const key = item.key || `zotero-${item.id}`;
      
      bibtex += `@${entryType}{${key},\n`;
      
      // Add fields
      if (item.title) {
        bibtex += `  title = {${item.title}},\n`;
      }
      
      if (item.authors) {
        const authors = JSON.parse(item.authors || '[]');
        if (authors.length > 0) {
          const authorStr = authors.map((a: any) => {
            if (a.name) return a.name;
            if (a.firstName && a.lastName) return `${a.lastName}, ${a.firstName}`;
            return '';
          }).filter(Boolean).join(' and ');
          if (authorStr) {
            bibtex += `  author = {${authorStr}},\n`;
          }
        }
      }
      
      if (item.publicationDate) {
        bibtex += `  year = {${item.publicationDate.substring(0, 4)}},\n`;
      }
      
      if (item.DOI) {
        bibtex += `  doi = {${item.DOI}},\n`;
      }
      
      if (item.URL) {
        bibtex += `  url = {${item.URL}},\n`;
      }
      
      // Remove trailing comma and close entry
      bibtex = bibtex.replace(/,\n$/, '\n') + '}\n\n';
    }
    
    return bibtex;
  }
  
  private toRIS(items: any[]): string {
    let ris = '';
    
    for (const item of items) {
      // RIS format uses 2-letter tags
      ris += `TY  - ${this.mapZoteroTypeToRIS(item.itemType)}\n`;
      
      if (item.title) {
        ris += `TI  - ${item.title}\n`;
      }
      
      if (item.authors) {
        const authors = JSON.parse(item.authors || '[]');
        for (const author of authors) {
          let authorStr = '';
          if (author.name) {
            authorStr = author.name;
          } else if (author.firstName && author.lastName) {
            authorStr = `${author.lastName}, ${author.firstName}`;
          }
          if (authorStr) {
            ris += `AU  - ${authorStr}\n`;
          }
        }
      }
      
      if (item.publicationDate) {
        ris += `PY  - ${item.publicationDate}\n`;
      }
      
      if (item.DOI) {
        ris += `DO  - ${item.DOI}\n`;
      }
      
      if (item.URL) {
        ris += `UR  - ${item.URL}\n`;
      }
      
      if (item.abstract) {
        ris += `AB  - ${item.abstract.substring(0, 500)}${item.abstract.length > 500 ? '...' : ''}\n`;
      }
      
      ris += `ER  - \n\n`;
    }
    
    return ris;
  }
  
  private toCSV(items: any[]): string {
    const headers = ['Title', 'Authors', 'Year', 'DOI', 'URL', 'Type'];
    let csv = headers.join(',') + '\n';
    
    for (const item of items) {
      const authors = JSON.parse(item.authors || '[]');
      const authorStr = authors.map((a: any) => {
        if (a.name) return a.name;
        if (a.firstName && a.lastName) return `${a.firstName} ${a.lastName}`;
        return '';
      }).filter(Boolean).join('; ');
      
      const row = [
        `"${(item.title || '').replace(/"/g, '""')}"`,
        `"${authorStr.replace(/"/g, '""')}"`,
        `"${(item.publicationDate || '').substring(0, 4)}"`,
        `"${item.DOI || ''}"`,
        `"${item.URL || ''}"`,
        `"${item.itemType || ''}"`
      ];
      
      csv += row.join(',') + '\n';
    }
    
    return csv;
  }
  
  private toJSON(items: any[]): string {
    return JSON.stringify(items, null, 2);
  }
  
  private mapZoteroTypeToBibTeX(zoteroType: string): string {
    const mapping: Record<string, string> = {
      'journalArticle': 'article',
      'book': 'book',
      'bookSection': 'incollection',
      'conferencePaper': 'inproceedings',
      'thesis': 'phdthesis',
      'report': 'techreport',
      'webpage': 'misc',
      'document': 'misc'
    };
    
    return mapping[zoteroType] || 'misc';
  }
  
  private mapZoteroTypeToRIS(zoteroType: string): string {
    const mapping: Record<string, string> = {
      'journalArticle': 'JOUR',
      'book': 'BOOK',
      'bookSection': 'CHAP',
      'conferencePaper': 'CONF',
      'thesis': 'THES',
      'report': 'RPRT',
      'webpage': 'ELEC',
      'document': 'GEN'
    };
    
    return mapping[zoteroType] || 'GEN';
  }
  
  async exportToFile(content: string, outputPath: string): Promise<void> {
    const fs = await import('fs/promises');
    await fs.writeFile(outputPath, content, 'utf-8');
  }
}