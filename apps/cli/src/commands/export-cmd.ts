// @ts-nocheck

import type { Command } from '../types.js';
import { initModules } from '../modules.js';
import { symbols } from '@zotero-headless/core';

export const exportCommands: Command[] = [
  {
    name: 'export',
    aliases: ['e', 'out', 'save'],
    description: 'Export items to various formats. Aliases: e, out, save',
    options: [
      { name: '--format', alias: '-f', description: 'Export format (bibtex|ris|csv|json)', value: '<format>' },
      { name: '--output', alias: '-o', description: 'Output file path', value: '<path>' },
    ],
    examples: [
      'zotero export ABC123 -f bibtex',
      'zotero e ABC123 ABC124 -o output.bib',
    ],
    execute: async (args) => {
      await initModules();
      console.log('Exporting items...\n');

      try {
        // Parse arguments
        const format = args[0]?.toLowerCase() || 'bibtex';
        const outputFile = args[1];
        const limit = args[2] ? parseInt(args[2]) : 100;

        const validFormats = ['bibtex', 'ris', 'csv', 'json'];
        if (!validFormats.includes(format)) {
          console.log(`${symbols.error} Invalid format: ${format}`);
          console.log(`   Valid formats: ${validFormats.join(', ')}`);
          process.exit(1);
        }

        const { Exporter } = await import('../export.js');
        const exporter = new Exporter();

        const content = await exporter.exportItems({
          format: format as any,
          limit
        });

        if (outputFile) {
          await exporter.exportToFile(content, outputFile);
          console.log(`${symbols.success} Exported ${limit} items to ${outputFile} (${format} format)`);
        } else {
          console.log(content);
          console.log(`\nTip: Add output file path to save to file`);
          console.log(`   Example: zotero export bibtex references.bib`);
        }
      } catch (error) {
        console.error(`${symbols.error} Export failed:`, error);
        process.exit(1);
      }
    }
  },
];
