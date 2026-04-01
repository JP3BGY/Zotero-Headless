import type { ExtractedContent, ExtractionOptions } from '../types.js';

export async function extractDoc(filePath: string, options?: ExtractionOptions): Promise<ExtractedContent> {
  const WordExtractor = (await import('word-extractor')).default;
  const extractor = new WordExtractor();

  const doc = await extractor.extract(filePath);
  let text = doc.getBody();

  const footnotes = doc.getFootnotes();
  const endnotes = doc.getEndnotes();

  const parts: string[] = [text];
  if (footnotes && footnotes.trim()) {
    parts.push('---\n\n**Footnotes**\n\n' + footnotes.trim());
  }
  if (endnotes && endnotes.trim()) {
    parts.push('---\n\n**Endnotes**\n\n' + endnotes.trim());
  }

  text = parts.join('\n\n');

  if (options?.maxLength && text.length > options.maxLength) {
    text = text.slice(0, options.maxLength);
  }

  return {
    text,
    format: 'text',
  };
}
