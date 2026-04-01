import * as fs from 'fs';
import type { ExtractedContent, ExtractionOptions } from '../types.js';
import { createTurndownService } from './turndown-config.js';

export async function extractHtml(filePath: string, options?: ExtractionOptions): Promise<ExtractedContent> {
  const html = fs.readFileSync(filePath, 'utf-8');
  let text: string;
  let format: 'markdown' | 'text';

  if (options?.format === 'text') {
    text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    format = 'text';
  } else {
    const turndownService = createTurndownService();
    text = turndownService.turndown(html);
    format = 'markdown';
  }

  if (options?.maxLength && text.length > options.maxLength) {
    text = text.slice(0, options.maxLength);
  }

  return { text, format };
}
