import type { ExtractedContent, ExtractionOptions } from '../types.js';

export async function extractEpub(filePath: string, options?: ExtractionOptions): Promise<ExtractedContent> {
  const { epub2md } = await import('epub2md');

  let text = await epub2md(filePath);

  if (options?.maxLength && text.length > options.maxLength) {
    text = text.slice(0, options.maxLength);
  }

  return {
    text,
    format: 'markdown',
  };
}
