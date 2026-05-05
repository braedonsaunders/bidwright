/** Type declarations for packages without built-in types. */

declare module 'pdf-parse' {
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    text: string;
    version: string;
    info?: {
      Title?: string;
      Author?: string;
      Subject?: string;
      Creator?: string;
      Producer?: string;
      CreationDate?: string;
      ModDate?: string;
    };
    metadata?: unknown;
  }

  function pdfParse(buffer: Buffer, options?: Record<string, unknown>): Promise<PdfParseResult>;
  export = pdfParse;
}

declare module 'word-extractor' {
  interface WordDocument {
    getBody(): string;
    getHeaders(options?: { includeFooters?: boolean }): string;
    getFooters(): string;
    getFootnotes(): string;
    getEndnotes(): string;
    getAnnotations(): string;
    getTextboxes(options?: { includeHeadersAndFooters?: boolean; includeBody?: boolean }): string;
  }

  class WordExtractor {
    extract(input: string | Buffer): Promise<WordDocument>;
  }

  export = WordExtractor;
}

declare module 'rtf-parser' {
  interface RtfSpan {
    value?: string;
    style?: Record<string, unknown>;
  }

  interface RtfParagraph {
    content?: RtfSpan[];
    style?: Record<string, unknown>;
  }

  interface RtfDocument {
    content?: RtfParagraph[];
  }

  interface RtfParser {
    string(input: string, callback: (err: Error | null, document?: RtfDocument) => void): void;
  }

  const parser: RtfParser;
  export = parser;
}
