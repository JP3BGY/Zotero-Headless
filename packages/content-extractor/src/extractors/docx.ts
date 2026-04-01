import type { ExtractedContent, ExtractionOptions } from '../types.js';
import { createTurndownService } from './turndown-config.js';

export async function extractDocx(filePath: string, options?: ExtractionOptions): Promise<ExtractedContent> {
  const mammoth = await import('mammoth');
  const turndownService = createTurndownService();

  const result = await mammoth.convertToHtml({ path: filePath });
  let text: string;
  let format: 'markdown' | 'text';

  if (options?.format === 'text') {
    // Strip HTML to plain text
    text = result.value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    format = 'text';
  } else {
    text = turndownService.turndown(result.value);
    format = 'markdown';
  }

  if (options?.maxLength && text.length > options.maxLength) {
    text = text.slice(0, options.maxLength);
  }

  return { text, format };
}
