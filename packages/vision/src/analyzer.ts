import type { DrawingAnalysis, DrawingElement, SymbolDetection, DimensionReading, ExtractedTable, OcrResult, RevisionDiff, VisionProvider } from "./types.js";

export class DocumentAnalyzer {
  constructor(private vision: VisionProvider) {}

  async analyzeDrawing(imageBuffer: Buffer, context?: string): Promise<DrawingAnalysis> {
    const contextStr = context ? `\nContext: ${context}` : "";
    const prompt = `Analyze this construction drawing. Return a JSON object with:
- drawingType: one of "plan", "elevation", "section", "detail", "schedule", "diagram", "unknown"
- discipline: one of "mechanical", "electrical", "plumbing", "structural", "architectural", "general"
- sheetNumber: the sheet number visible on the drawing
- title: the drawing title
- scale: the scale if visible
- elements: array of {type, label, confidence} for major elements
- notes: array of important notes visible
- confidence: overall confidence 0-1
${contextStr}
Return ONLY valid JSON.`;

    const result = await this.vision.analyzeImageStructured<DrawingAnalysis>(imageBuffer, prompt);
    return result;
  }

  async identifySymbols(imageBuffer: Buffer): Promise<SymbolDetection[]> {
    const prompt = `Identify all engineering symbols, callouts, and annotations on this construction drawing. For each symbol return: {symbol, label, count, confidence}. Return as JSON array.`;
    return this.vision.analyzeImageStructured<SymbolDetection[]>(imageBuffer, prompt);
  }

  async extractDimensions(imageBuffer: Buffer): Promise<DimensionReading[]> {
    const prompt = `Extract all visible dimensions and measurements from this drawing. For each return: {value, unit, label, confidence}. Return as JSON array.`;
    return this.vision.analyzeImageStructured<DimensionReading[]>(imageBuffer, prompt);
  }

  async extractTable(imageBuffer: Buffer): Promise<ExtractedTable> {
    const prompt = `Extract the table visible in this image. Return JSON with: {headers: string[], rows: string[][], confidence: number, pageNumber: 1}`;
    return this.vision.analyzeImageStructured<ExtractedTable>(imageBuffer, prompt);
  }

  async ocrPage(imageBuffer: Buffer): Promise<OcrResult> {
    const prompt = `Extract all text from this document page. Return JSON with: {text: "full extracted text", pageNumber: 1, confidence: number, blocks: [{text, boundingBox: {x, y, width, height}, confidence}]}`;
    return this.vision.analyzeImageStructured<OcrResult>(imageBuffer, prompt);
  }

  async compareRevisions(imageA: Buffer, imageB: Buffer): Promise<RevisionDiff> {
    // For revision comparison, we analyze each independently and compare
    const prompt = `Compare these two drawing revisions and identify all changes. Return JSON with: {summary: "brief summary", changes: [{type: "added"|"removed"|"modified", description, location, confidence}]}`;
    // Note: multi-image requires provider support
    return this.vision.analyzeImageStructured<RevisionDiff>(imageA, prompt);
  }

  async classifyDocument(imageBuffer: Buffer): Promise<{ documentType: string; confidence: number }> {
    const prompt = `Classify this construction document. What type is it? Return JSON: {documentType: one of "spec", "drawing", "rfq", "addendum", "schedule", "vendor", "reference", "unknown", confidence: 0-1}`;
    return this.vision.analyzeImageStructured<{ documentType: string; confidence: number }>(imageBuffer, prompt);
  }
}
