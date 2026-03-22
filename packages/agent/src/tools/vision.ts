import { z } from "zod";
import type { Tool, ToolExecutionContext, ToolResult } from "../types.js";

type VisionOperation = (ctx: ToolExecutionContext, input: Record<string, unknown>) => Promise<ToolResult>;

function createVisionTool(def: {
  id: string;
  name: string;
  description: string;
  inputSchema: z.ZodType;
  tags: string[];
}, operation: VisionOperation): Tool {
  return {
    definition: {
      id: def.id,
      name: def.name,
      category: "vision",
      description: def.description,
      parameters: [],
      inputSchema: def.inputSchema,
      requiresConfirmation: false,
      mutates: false,
      tags: def.tags,
    },
    async execute(input: Record<string, unknown>, context: ToolExecutionContext) {
      const start = Date.now();
      try {
        const result = await operation(context, input);
        return { ...result, duration_ms: Date.now() - start };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error), duration_ms: Date.now() - start };
      }
    },
  };
}

// ──────────────────────────────────────────────────────────────
// 1. vision.renderPdfPage
// ──────────────────────────────────────────────────────────────
export const renderPdfPageTool = createVisionTool({
  id: "vision.renderPdfPage",
  name: "Render PDF Page",
  description: "Render a specific page of a PDF document to an image at the given DPI resolution.",
  inputSchema: z.object({
    documentId: z.string().describe("ID of the PDF document"),
    pageNumber: z.number().describe("Page number to render (1-based)"),
    dpi: z.number().optional().default(150).describe("Resolution in DPI (default 150)"),
  }),
  tags: ["vision", "pdf", "render", "read"],
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Rendered PDF page image would be returned here", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 2. vision.analyzeDrawing
// ──────────────────────────────────────────────────────────────
export const analyzeDrawingTool = createVisionTool({
  id: "vision.analyzeDrawing",
  name: "Analyze Drawing",
  description: "Analyze a construction drawing page using vision AI, identifying elements, annotations, and relevant details for estimating.",
  inputSchema: z.object({
    documentId: z.string().describe("ID of the document containing the drawing"),
    pageNumber: z.number().describe("Page number of the drawing (1-based)"),
    context: z.string().optional().describe("Additional context to guide the analysis (e.g. 'focus on electrical layout')"),
  }),
  tags: ["vision", "drawing", "analyze", "read"],
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Drawing analysis would be returned here", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 3. vision.extractTable
// ──────────────────────────────────────────────────────────────
export const extractTableTool = createVisionTool({
  id: "vision.extractTable",
  name: "Extract Table",
  description: "Extract tabular data from a document page, returning structured rows and columns.",
  inputSchema: z.object({
    documentId: z.string().describe("ID of the document"),
    pageNumber: z.number().describe("Page number to extract tables from (1-based)"),
  }),
  tags: ["vision", "table", "extract", "read"],
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Extracted table data would be returned here", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 4. vision.classifyDocument
// ──────────────────────────────────────────────────────────────
export const classifyDocumentTool = createVisionTool({
  id: "vision.classifyDocument",
  name: "Classify Document",
  description: "Classify a document's type using vision analysis (e.g. specification, drawing, schedule, submittal, RFI).",
  inputSchema: z.object({
    documentId: z.string().describe("ID of the document to classify"),
  }),
  tags: ["vision", "document", "classify", "read"],
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Document classification would be returned here", documentId: input.documentId }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 5. vision.ocrPage
// ──────────────────────────────────────────────────────────────
export const ocrPageTool = createVisionTool({
  id: "vision.ocrPage",
  name: "OCR Page",
  description: "Perform optical character recognition on a PDF page, extracting all text content including handwritten annotations.",
  inputSchema: z.object({
    documentId: z.string().describe("ID of the document"),
    pageNumber: z.number().describe("Page number to OCR (1-based)"),
  }),
  tags: ["vision", "ocr", "text", "read"],
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "OCR text would be returned here", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 6. vision.readRegion
// ──────────────────────────────────────────────────────────────
export const readRegionTool = createVisionTool({
  id: "vision.readRegion",
  name: "Read Region",
  description: "Read and analyze a specific rectangular region of a document page, useful for focusing on title blocks, schedules, or detail callouts.",
  inputSchema: z.object({
    documentId: z.string().describe("ID of the document"),
    pageNumber: z.number().describe("Page number (1-based)"),
    x: z.number().describe("X coordinate of the region's top-left corner (in points)"),
    y: z.number().describe("Y coordinate of the region's top-left corner (in points)"),
    width: z.number().describe("Width of the region (in points)"),
    height: z.number().describe("Height of the region (in points)"),
  }),
  tags: ["vision", "region", "read"],
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Region content would be returned here", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 7. vision.extractDimensions
// ──────────────────────────────────────────────────────────────
export const extractDimensionsTool = createVisionTool({
  id: "vision.extractDimensions",
  name: "Extract Dimensions",
  description: "Extract dimension annotations and measurements from construction drawings.",
  inputSchema: z.object({
    documentId: z.string().describe("ID of the document containing the drawing"),
    pageNumber: z.number().describe("Page number of the drawing (1-based)"),
  }),
  tags: ["vision", "dimensions", "extract", "read"],
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Extracted dimensions would be returned here", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 8. vision.compareRevisions
// ──────────────────────────────────────────────────────────────
export const compareRevisionsTool = createVisionTool({
  id: "vision.compareRevisions",
  name: "Compare Revisions",
  description: "Visually compare two drawing revisions side by side, highlighting additions, deletions, and changes.",
  inputSchema: z.object({
    documentIdA: z.string().describe("ID of the first (older) document revision"),
    documentIdB: z.string().describe("ID of the second (newer) document revision"),
    pageNumber: z.number().describe("Page number to compare (1-based)"),
  }),
  tags: ["vision", "compare", "revision", "read"],
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Revision comparison would be returned here", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 9. vision.identifySymbols
// ──────────────────────────────────────────────────────────────
export const identifySymbolsTool = createVisionTool({
  id: "vision.identifySymbols",
  name: "Identify Symbols",
  description: "Identify and catalog symbols found on a construction drawing page (e.g. electrical symbols, plumbing fixtures, HVAC components).",
  inputSchema: z.object({
    documentId: z.string().describe("ID of the document containing the drawing"),
    pageNumber: z.number().describe("Page number of the drawing (1-based)"),
  }),
  tags: ["vision", "symbols", "identify", "read"],
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Identified symbols would be returned here", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 10. vision.getPageInfo
// ──────────────────────────────────────────────────────────────
export const getPageInfoTool = createVisionTool({
  id: "vision.getPageInfo",
  name: "Get Page Info",
  description: "Get page count, dimensions, and basic metadata for a document without rendering any pages.",
  inputSchema: z.object({
    documentId: z.string().describe("ID of the document to get page info for"),
  }),
  tags: ["vision", "page", "info", "read"],
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Page info would be returned here", documentId: input.documentId }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 11. vision.countSymbols
// ──────────────────────────────────────────────────────────────
const symbolCountTool: Tool = {
  definition: {
    id: "vision.countSymbols",
    name: "Count Symbols in Drawing",
    category: "vision",
    description: "Use machine learning (OpenCV template matching, OCR, visual feature matching) to count occurrences of a symbol or pattern across PDF drawing pages. Uses a pre-trained Python pipeline with 5 matching methods. Provide the document and a template image of the symbol to find.",
    parameters: [
      { name: "documentId", type: "string", description: "Source document ID containing the drawings", required: true },
      { name: "templateDocumentId", type: "string", description: "Document ID of the template/symbol image to search for", required: true },
      { name: "pageNumbers", type: "array", description: "Specific pages to search (empty = all pages)", required: false },
      { name: "threshold", type: "number", description: "Matching confidence threshold 0-1 (default 0.65)", required: false },
    ],
    inputSchema: z.object({
      documentId: z.string(),
      templateDocumentId: z.string(),
      pageNumbers: z.array(z.number()).optional(),
      threshold: z.number().min(0).max(1).optional(),
    }),
    requiresConfirmation: false,
    mutates: false,
    tags: ["vision", "symbol", "counting", "opencv", "template-matching", "drawing", "ml"],
  },
  async execute(input: Record<string, unknown>, context: ToolExecutionContext) {
    const start = Date.now();
    return {
      success: true,
      data: { message: "Symbol counting requires runtime PDF paths. Wire to runAutoCount() from @bidwright/vision." },
      sideEffects: [],
      duration_ms: Date.now() - start,
    };
  },
};

// ──────────────────────────────────────────────────────────────
// Export all tools as array
// ──────────────────────────────────────────────────────────────
export const visionTools: Tool[] = [
  renderPdfPageTool,
  analyzeDrawingTool,
  extractTableTool,
  classifyDocumentTool,
  ocrPageTool,
  readRegionTool,
  extractDimensionsTool,
  compareRevisionsTool,
  identifySymbolsTool,
  getPageInfoTool,
  symbolCountTool,
];
