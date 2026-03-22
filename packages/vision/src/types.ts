export interface PageInfo {
  pageNumber: number;
  width: number;
  height: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DrawingElement {
  type: string;
  label: string;
  boundingBox?: BoundingBox;
  confidence: number;
}

export interface DrawingAnalysis {
  drawingType: "plan" | "elevation" | "section" | "detail" | "schedule" | "diagram" | "unknown";
  discipline: "mechanical" | "electrical" | "plumbing" | "structural" | "architectural" | "general";
  sheetNumber: string;
  title: string;
  scale?: string;
  elements: DrawingElement[];
  notes: string[];
  confidence: number;
}

export interface SymbolDetection {
  symbol: string;
  label: string;
  count: number;
  boundingBox?: BoundingBox;
  confidence: number;
}

export interface DimensionReading {
  value: string;
  unit: string;
  label?: string;
  confidence: number;
}

export interface ExtractedTable {
  headers: string[];
  rows: string[][];
  confidence: number;
  pageNumber: number;
}

export interface OcrResult {
  text: string;
  pageNumber: number;
  confidence: number;
  blocks: Array<{
    text: string;
    boundingBox: BoundingBox;
    confidence: number;
  }>;
}

export interface RevisionDiff {
  summary: string;
  changes: Array<{
    type: "added" | "removed" | "modified";
    description: string;
    location?: string;
    confidence: number;
  }>;
}

export interface VisionProvider {
  analyzeImage(imageData: Buffer | string, prompt: string): Promise<string>;
  analyzeImageStructured<T>(imageData: Buffer | string, prompt: string): Promise<T>;
}

export interface PdfRenderer {
  renderPage(pdfPath: string, pageNumber: number, dpi?: number): Promise<Buffer>;
  getPageInfo(pdfPath: string): Promise<PageInfo[]>;
  renderRegion(pdfPath: string, pageNumber: number, region: BoundingBox, dpi?: number): Promise<Buffer>;
}
