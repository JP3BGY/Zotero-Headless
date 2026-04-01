declare module 'word-extractor' {
  interface Document {
    getBody(): string;
    getHeaders(options?: { includeFooters?: boolean }): Record<string, string>;
    getFooters(): Record<string, string>;
    getFootnotes(): string;
    getEndnotes(): string;
  }

  class WordExtractor {
    extract(filePath: string): Promise<Document>;
  }

  export default WordExtractor;
}

declare module 'epub2md' {
  export function epub2md(filePath: string): Promise<string>;
}
