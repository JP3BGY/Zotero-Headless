import * as fs from 'fs';
import type { ExtractedContent, ExtractionOptions } from '../types.js';

export async function extractPdf(filePath: string, options?: ExtractionOptions): Promise<ExtractedContent> {
  const { getDocumentProxy } = await import('unpdf');

  const buffer = fs.readFileSync(filePath);
  const pdf = await getDocumentProxy(new Uint8Array(buffer));

  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .filter((item: any) => 'str' in item)
      .map((item: any) => item.str)
      .join('');
    if (pageText.trim()) {
      pages.push(pageText.trim());
    }
  }

  let text = pages.join('\n\n---\n\n');

  if (options?.maxLength && text.length > options.maxLength) {
    text = text.slice(0, options.maxLength);
  }

  return {
    text,
    format: 'text',
    metadata: {
      pageCount: pdf.numPages,
    },
  };
}
