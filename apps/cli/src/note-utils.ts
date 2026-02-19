// Note management utilities with Markdown ↔ HTML conversion
import { marked } from 'marked';
import TurndownService from 'turndown';

// Configure marked for safe HTML output
marked.setOptions({
  gfm: true,
  breaks: true,
});

// Configure turndown for converting HTML back to Markdown
const turndownService = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
});

/**
 * Convert Markdown to HTML for Zotero storage
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown) return '';
  
  // Convert markdown to HTML
  let html = marked.parse(markdown) as string;
  
  // Wrap in paragraph if not already wrapped
  if (!html.trim().startsWith('<')) {
    html = `<p>${html}</p>`;
  }
  
  return html.trim();
}

/**
 * Convert HTML from Zotero to Markdown for editing
 */
export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  
  // Clean up Zotero-specific HTML if needed
  let cleanHtml = html
    .replace(/data-[^=]+="[^"]*"/g, '')  // Remove data attributes
    .replace(/class="[^"]*"/g, '')       // Remove class attributes
    .replace(/style="[^"]*"/g, '');      // Remove style attributes
  
  // Convert to markdown
  return turndownService.turndown(cleanHtml);
}

/**
 * Extract plain text from HTML for preview
 */
export function htmlToPlainText(html: string, maxLength?: number): string {
  if (!html) return '';
  
  // Remove HTML tags
  let text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (maxLength && text.length > maxLength) {
    text = text.substring(0, maxLength) + '...';
  }
  
  return text;
}

/**
 * Check if content looks like HTML
 */
export function isHtml(content: string): boolean {
  if (!content) return false;
  return /<[a-z][\s\S]*>/i.test(content);
}

/**
 * Ensure content is in HTML format (convert if needed)
 */
export function ensureHtml(content: string): string {
  if (isHtml(content)) {
    return content;
  }
  return markdownToHtml(content);
}
