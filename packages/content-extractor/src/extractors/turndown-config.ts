import TurndownService from 'turndown';

/**
 * Create a configured TurndownService instance.
 * Configuration mirrors apps/cli/src/note-utils.ts for consistency.
 */
export function createTurndownService(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
  });

  // Strikethrough
  service.addRule('strikethrough', {
    filter: (node: any) =>
      node.nodeName === 'SPAN' && node.style?.textDecoration === 'line-through',
    replacement: (content: string) => `~~${content}~~`,
  });

  service.addRule('strikethroughTag', {
    filter: ['s', 'strike', 'del'] as any,
    replacement: (content: string) => `~~${content}~~`,
  });

  // Subscript / superscript
  service.addRule('subsup', {
    filter: ['sub', 'sup'] as any,
    replacement: (content: string, node: any) =>
      node.nodeName === 'SUB' ? `~${content}~` : `^${content}^`,
  });

  // Hard breaks
  service.addRule('hardBreak', {
    filter: 'br',
    replacement: () => '  \n',
  });

  // Code blocks (pre without code wrapper)
  service.addRule('codeBlock', {
    filter: (node: any) => node.nodeName === 'PRE' && !node.querySelector('code'),
    replacement: (content: string) => '\n```\n' + content + '\n```\n',
  });

  // Math: display
  service.addRule('mathDisplay', {
    filter: (node: any) => node.nodeName === 'PRE' && node.classList?.contains('math'),
    replacement: (content: string) =>
      '\n$$\n' + content.replace(/^\$\$|\$\$$/g, '').trim() + '\n$$\n',
  });

  // Math: inline
  service.addRule('mathInline', {
    filter: (node: any) => node.nodeName === 'SPAN' && node.classList?.contains('math'),
    replacement: (content: string) => '$' + content.replace(/^\$|\$$/g, '') + '$',
  });

  return service;
}
