// Note management utilities with ProseMirror-compatible HTML conversion
// Based on Zotero note-editor schema:
// https://github.com/zotero/note-editor

import { marked } from 'marked';
import TurndownService from 'turndown';
import { JSDOM } from 'jsdom';

// ============== Configuration ==============

// Configure marked for ProseMirror-compatible output
marked.setOptions({
  gfm: true,
  breaks: false,
});

// Configure turndown for ProseMirror-compatible HTML → Markdown
const turndownService = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
});

// Custom turndown rules for ProseMirror compatibility

// Handle Zotero's strikethrough (span with text-decoration)
turndownService.addRule('zoteroStrikethrough', {
  filter: (node: any) => {
    return node.nodeName === 'SPAN' && 
           node.style?.textDecoration === 'line-through';
  },
  replacement: (content: string) => {
    return `~~${content}~~`;
  }
});

// Handle subscript/superscript
turndownService.addRule('subsup', {
  filter: ['sub', 'sup'] as any,
  replacement: (content: string, node: any) => {
    if (node.nodeName === 'SUB') {
      return `~${content}~`;
    }
    return `^${content}^`;
  }
});

// Handle hard breaks
turndownService.addRule('hardBreak', {
  filter: 'br',
  replacement: () => '  \n',
});

// Handle code blocks (pre without code wrapper)
turndownService.addRule('codeBlock', {
  filter: (node: any) => {
    if (node.nodeName !== 'PRE') return false;
    // Check if it contains a code element
    return !node.querySelector('code');
  },
  replacement: (content: string) => {
    return '\n```\n' + content + '\n```\n';
  }
});

// Skip Zotero-specific elements (preserve as-is in HTML, don't convert)
turndownService.addRule('zoteroCitation', {
  filter: (node: any) => {
    return node.nodeName === 'SPAN' && node.classList?.contains('citation');
  },
  replacement: (content: string) => content,
});

turndownService.addRule('zoteroHighlight', {
  filter: (node: any) => {
    return node.nodeName === 'SPAN' && node.classList?.contains('highlight');
  },
  replacement: (content: string) => content,
});

turndownService.addRule('zoteroUnderlineAnnotation', {
  filter: (node: any) => {
    return node.nodeName === 'SPAN' && node.classList?.contains('underline');
  },
  replacement: (content: string) => content,
});

// Handle math elements
turndownService.addRule('mathDisplay', {
  filter: (node: any) => {
    return node.nodeName === 'PRE' && node.classList?.contains('math');
  },
  replacement: (content: string) => {
    return '\n$$\n' + content.replace(/^\$\$|\$\$$/g, '').trim() + '\n$$\n';
  }
});

turndownService.addRule('mathInline', {
  filter: (node: any) => {
    return node.nodeName === 'SPAN' && node.classList?.contains('math');
  },
  replacement: (content: string) => {
    return '$' + content.replace(/^\$|\$$/g, '') + '$';
  }
});

// ============== Helper Functions ==============

function escapeHtml(text: string): string {
  const div: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return text.replace(/[&<>"']/g, (m) => div[m] || m);
}

/**
 * Check if element is supported by Zotero ProseMirror schema
 */
function isSupportedElement(node: any): boolean {
  const supportedTags = new Set([
    'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'BLOCKQUOTE', 'PRE', 'HR',
    'OL', 'UL', 'LI',
    'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD',
    'BR', 'IMG', 'A',
    'STRONG', 'B', 'EM', 'I',
    'U', 'S', 'STRIKE', 'DEL',
    'SUB', 'SUP', 'CODE',
    'SPAN',
  ]);
  
  return supportedTags.has(node.nodeName);
}

/**
 * Clean HTML to ensure ProseMirror compatibility
 * Removes unsupported tags and attributes
 */
export function cleanHtmlForProseMirror(html: string): string {
  if (!html) return '';
  
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const body = doc.body;
  
  cleanNode(body, dom.window as any);
  
  return body.innerHTML;
}

function cleanNode(node: any, win: any): void {
  for (let i = node.childNodes.length - 1; i >= 0; i--) {
    const child = node.childNodes[i];
    
    if (child.nodeType === 1) {
      if (!isSupportedElement(child)) {
        const parent = child.parentNode;
        if (parent) {
          while (child.firstChild) {
            parent.insertBefore(child.firstChild, child);
          }
          parent.removeChild(child);
        }
      } else {
        cleanAttributes(child);
        cleanNode(child, win);
      }
    }
  }
}

function cleanAttributes(el: any): void {
  const supportedAttrs = new Set([
    'href', 'title', 'alt', 'src', 'width', 'height',
    'data-indent', 'data-align', 'dir', 'id',
    'data-attachment-key', 'data-annotation', 'data-citation', 'data-original-src',
    'class',
    'style',
  ]);
  
  const attrsToRemove: string[] = [];
  for (const attr of el.attributes) {
    if (!supportedAttrs.has(attr.name)) {
      attrsToRemove.push(attr.name);
    }
  }
  
  attrsToRemove.forEach(attr => el.removeAttribute(attr));
  
  const style = el.style;
  if (style && style.cssText) {
    const supportedStyles = ['text-decoration', 'text-decoration-color', 
                            'color', 'background-color', 'text-align'];
    const newStyles: string[] = [];
    
    for (let i = 0; i < style.length; i++) {
      const prop = style.item(i);
      if (supportedStyles.some(s => prop.toLowerCase().includes(s))) {
        newStyles.push(`${prop}: ${style.getPropertyValue(prop)}`);
      }
    }
    
    if (newStyles.length > 0) {
      el.setAttribute('style', newStyles.join('; '));
    } else {
      el.removeAttribute('style');
    }
  }
}

// ============== Main Export Functions ==============

/**
 * Convert Markdown to ProseMirror-compatible HTML
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown || !markdown.trim()) {
    return '<p></p>';
  }
  
  // Convert markdown to HTML
  let html = marked.parse(markdown) as string;
  
  // Clean for ProseMirror compatibility
  html = cleanHtmlForProseMirror(html);
  
  if (!html.trim().startsWith('<')) {
    html = `<p>${html}</p>`;
  }
  
  return html.trim();
}

/**
 * Convert ProseMirror HTML to Markdown
 */
export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) {
    return '';
  }
  
  html = cleanHtmlForProseMirror(html);
  
  let markdown = turndownService.turndown(html);
  
  markdown = markdown
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  return markdown;
}

/**
 * Extract plain text from HTML
 */
export function htmlToPlainText(html: string, maxLength?: number): string {
  if (!html) return '';
  
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  
  let text = doc.body.textContent || '';
  text = text.replace(/\s+/g, ' ').trim();
  
  if (maxLength && text.length > maxLength) {
    text = text.substring(0, maxLength) + '...';
  }
  
  return text;
}

/**
 * Check if content appears to be HTML
 */
export function isHtml(content: string): boolean {
  if (!content || !content.trim()) return false;
  return /<[a-z][\s\S]*>/i.test(content);
}

/**
 * Ensure content is HTML
 */
export function ensureHtml(content: string): string {
  if (isHtml(content)) {
    return cleanHtmlForProseMirror(content);
  }
  return markdownToHtml(content);
}

/**
 * Validate HTML compatibility
 */
export function validateHtml(html: string): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  if (!html) {
    return { valid: true, issues: [] };
  }
  
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  
  const allElements = doc.body.querySelectorAll('*');
  const unsupportedElements = new Set<string>();
  
  allElements.forEach(el => {
    if (!isSupportedElement(el)) {
      unsupportedElements.add(el.tagName.toLowerCase());
    }
  });
  
  if (unsupportedElements.size > 0) {
    issues.push(`Unsupported elements: ${Array.from(unsupportedElements).join(', ')}`);
  }
  
  const nestedBlockquotes = doc.body.querySelectorAll('blockquote blockquote');
  if (nestedBlockquotes.length > 0) {
    issues.push('Nested blockquotes are not supported');
  }
  
  return { valid: issues.length === 0, issues };
}

/**
 * Check for Zotero-specific elements
 */
export function hasZoteroElements(html: string): boolean {
  if (!html) return false;
  
  return html.includes('class="citation"') ||
         html.includes('class="highlight"') ||
         html.includes('class="underline"') ||
         html.includes('data-annotation=') ||
         html.includes('data-citation=');
}
