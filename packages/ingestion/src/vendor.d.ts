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
