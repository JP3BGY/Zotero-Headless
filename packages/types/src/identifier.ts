/**
 * Identifier types for DOI, ISBN, arXiv, PMID, etc.
 */

export type IdentifierType = 'doi' | 'isbn' | 'pmid' | 'arxiv' | 'ads' | 'url';

export interface Identifier {
  type: IdentifierType;
  value: string;
  normalized: string;
  confidence: number;  // 识别置信度（0-1）
}
