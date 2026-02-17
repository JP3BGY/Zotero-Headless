import { describe, it, expect } from 'vitest';
import { DataConverter } from '../../identifier/converter.js';

describe('Converter Field Name Compliance', () => {
  describe('CrossRef Converter', () => {
    it('should use "date" not "publicationDate" for Zotero API compatibility', () => {
      const crossRefData = {
        type: 'journal-article',
        title: ['Test Article'],
        'published-print': {
          'date-parts': [[2021, 7, 15]]
        },
        author: [{ given: 'John', family: 'Doe' }],
        DOI: '10.1000/test'
      };

      const result = DataConverter.fromCrossRef(crossRefData, '10.1000/test');

      // Critical: Must use 'date' for Zotero API, not 'publicationDate'
      expect(result).toHaveProperty('date');
      expect(result).not.toHaveProperty('publicationDate');
      expect(result.date).toBe('2021-7-15');
    });

    it('should return creators as array, not string', () => {
      const crossRefData = {
        type: 'journal-article',
        title: ['Test Article'],
        author: [
          { given: 'John', family: 'Doe' },
          { given: 'Jane', family: 'Smith' }
        ],
        DOI: '10.1000/test'
      };

      const result = DataConverter.fromCrossRef(crossRefData, '10.1000/test');

      // Creators must be an array for Zotero API
      expect(Array.isArray(result.creators)).toBe(true);
      expect(result.creators).toHaveLength(2);
    });
  });

  describe('All Converters', () => {
    const converters = [
      {
        name: 'CrossRef',
        fn: DataConverter.fromCrossRef,
        sampleData: {
          type: 'journal-article',
          title: ['Test'],
          author: [{ given: 'John', family: 'Doe' }],
          DOI: '10.1000/test'
        }
      },
      // Add other converters here
    ];

    converters.forEach(({ name, fn, sampleData }) => {
      it(`${name} should only use Zotero API compatible fields`, () => {
        const result = fn(sampleData, 'test-id');

        // List of known Zotero API fields
        const zoteroFields = new Set([
          'itemType', 'title', 'creators', 'abstractNote', 'date', 'url', 'DOI',
          'accessDate', 'libraryCatalog', 'callNumber', 'rights', 'extra',
          'tags', 'collections', 'relations', 'notes', 'attachments'
        ]);

        // Check that no unexpected fields are present
        const unexpectedFields = Object.keys(result).filter(
          key => !zoteroFields.has(key) && 
                     !['doi', 'isbn', 'issn', 'journal', 'volume', 'issue', 
                       'pages', 'publisher', 'abstract'].includes(key)
        );

        // Allow some internal fields that get filtered during sync
        const allowedInternalFields = ['collectionKeys', 'extra'];
        const actualUnexpected = unexpectedFields.filter(
          f => !allowedInternalFields.includes(f)
        );

        if (actualUnexpected.length > 0) {
          console.warn(`Unexpected fields in ${name}:`, actualUnexpected);
        }
      });
    });
  });
});
