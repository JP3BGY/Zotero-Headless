import { describe, it, expect } from 'vitest';
import { parseItemData, parseRawJson, updateItemData, extractDenormalizedColumns } from './raw-json.js';

// Sample Zotero API envelope
const apiEnvelope = {
  key: 'ABCD1234',
  version: 42,
  library: { type: 'user', id: 123 },
  links: {},
  meta: { numChildren: 2 },
  data: {
    key: 'ABCD1234',
    version: 42,
    itemType: 'journalArticle',
    title: 'Test Article',
    creators: [
      { firstName: 'John', lastName: 'Doe', creatorType: 'author' },
      { firstName: 'Jane', lastName: 'Smith', creatorType: 'editor' },
    ],
    tags: [{ tag: 'machine-learning', type: 0 }],
    collections: ['COL1', 'COL2'],
    date: '2024-01-15',
    DOI: '10.1234/test',
    publicationTitle: 'Nature',
    volume: '42',
    issue: '3',
    pages: '100-110',
    abstractNote: 'A test abstract.',
    url: 'https://example.com',
    publisher: 'Test Publisher',
    ISBN: '978-0-1234-5678-9',
    ISSN: '1234-5678',
  },
};

// Bare data format (no envelope)
const bareData = {
  itemType: 'book',
  title: 'Bare Book',
  creators: [{ firstName: 'Alice', lastName: 'Wonder', creatorType: 'author' }],
  tags: [],
  date: '2023-06-01',
};

describe('parseItemData', () => {
  it('extracts .data from API envelope', () => {
    const data = parseItemData(JSON.stringify(apiEnvelope));
    expect(data.itemType).toBe('journalArticle');
    expect(data.title).toBe('Test Article');
    expect(data.creators).toHaveLength(2);
    expect(data.DOI).toBe('10.1234/test');
    expect(data.tags).toEqual([{ tag: 'machine-learning', type: 0 }]);
  });

  it('returns bare object when no .data wrapper', () => {
    const data = parseItemData(JSON.stringify(bareData));
    expect(data.itemType).toBe('book');
    expect(data.title).toBe('Bare Book');
    expect(data.creators).toHaveLength(1);
  });

  it('returns empty object for null/undefined/empty', () => {
    expect(parseItemData(null)).toEqual({});
    expect(parseItemData(undefined)).toEqual({});
    expect(parseItemData('')).toEqual({});
  });

  it('returns empty object for malformed JSON', () => {
    expect(parseItemData('not json')).toEqual({});
    expect(parseItemData('{broken')).toEqual({});
  });

  it('handles { data: {...} } local format', () => {
    const local = { data: { itemType: 'note', note: '<p>Hello</p>' } };
    const data = parseItemData(JSON.stringify(local));
    expect(data.itemType).toBe('note');
    expect(data.note).toBe('<p>Hello</p>');
  });
});

describe('parseRawJson', () => {
  it('preserves full envelope structure', () => {
    const envelope = parseRawJson(JSON.stringify(apiEnvelope));
    expect(envelope.data.title).toBe('Test Article');
    expect((envelope as any).key).toBe('ABCD1234');
    expect((envelope as any).meta?.numChildren).toBe(2);
  });

  it('wraps bare data in { data: ... }', () => {
    const envelope = parseRawJson(JSON.stringify(bareData));
    expect(envelope.data.itemType).toBe('book');
    expect(envelope.data.title).toBe('Bare Book');
  });

  it('returns { data: {} } for null/empty', () => {
    expect(parseRawJson(null)).toEqual({ data: {} });
    expect(parseRawJson('')).toEqual({ data: {} });
  });
});

describe('updateItemData', () => {
  it('mutates .data in envelope and re-serializes', () => {
    const original = JSON.stringify(apiEnvelope);
    const updated = updateItemData(original, (data) => {
      data.title = 'Updated Title';
      data.tags = [{ tag: 'updated', type: 0 }];
    });

    const parsed = JSON.parse(updated);
    // Envelope preserved
    expect(parsed.key).toBe('ABCD1234');
    expect(parsed.meta?.numChildren).toBe(2);
    // Data mutated
    expect(parsed.data.title).toBe('Updated Title');
    expect(parsed.data.tags).toEqual([{ tag: 'updated', type: 0 }]);
    // Other data untouched
    expect(parsed.data.DOI).toBe('10.1234/test');
  });

  it('wraps bare data before mutating', () => {
    const original = JSON.stringify(bareData);
    const updated = updateItemData(original, (data) => {
      data.title = 'Modified Book';
    });

    const parsed = JSON.parse(updated);
    expect(parsed.data.title).toBe('Modified Book');
    expect(parsed.data.itemType).toBe('book');
  });

  it('handles null input gracefully', () => {
    const updated = updateItemData(null, (data) => {
      data.title = 'From Nothing';
    });

    const parsed = JSON.parse(updated);
    expect(parsed.data.title).toBe('From Nothing');
  });
});

describe('extractDenormalizedColumns', () => {
  it('maps Zotero API fields to DB column names', () => {
    const data = apiEnvelope.data;
    const cols = extractDenormalizedColumns(data);

    expect(cols.title).toBe('Test Article');
    expect(cols.itemType).toBe('journalArticle');
    expect(cols.publicationDate).toBe('2024-01-15');
    expect(cols.abstract).toBe('A test abstract.');
    expect(cols.doi).toBe('10.1234/test');
    expect(cols.url).toBe('https://example.com');
    expect(cols.isbn).toBe('978-0-1234-5678-9');
    expect(cols.issn).toBe('1234-5678');
    expect(cols.publisher).toBe('Test Publisher');
    expect(cols.journal).toBe('Nature');
    expect(cols.volume).toBe('42');
    expect(cols.issue).toBe('3');
    expect(cols.pages).toBe('100-110');
    expect(cols.creators).toBe(JSON.stringify(data.creators));
    expect(cols.collectionKeys).toBe(JSON.stringify(data.collections));
    expect(cols.tags).toBe(JSON.stringify(data.tags));
  });

  it('omits undefined fields', () => {
    const cols = extractDenormalizedColumns({ itemType: 'note' });
    expect(cols.itemType).toBe('note');
    expect(cols).not.toHaveProperty('title');
    expect(cols).not.toHaveProperty('doi');
    expect(cols).not.toHaveProperty('creators');
  });
});
