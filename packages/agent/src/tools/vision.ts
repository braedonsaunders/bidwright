import { z } from "zod";
import type { Tool, ToolExecutionContext, ToolResult } from "../types.js";
import { apiFetch } from "./api-fetch.js";

type VisionOperation = (ctx: ToolExecutionContext, input: Record<string, unknown>) => Promise<Omit<ToolResult, 'duration_ms'>>;

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

// ── Helpers ──────────────────────────────────────────────────

async function fetchWorkspace(ctx: ToolExecutionContext): Promise<any> {
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${ctx.projectId}/workspace`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

function findDocument(workspace: any, documentId: string): any | null {
  const documents: any[] = workspace.documents ?? [];
  return documents.find((d: any) => d.id === documentId) ?? null;
}

function classifyByFilename(filename: string): { type: string; confidence: number } {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) {
    if (lower.includes("spec")) return { type: "specification", confidence: 0.85 };
    if (lower.includes("drawing") || lower.includes("plan") || lower.includes("sheet")) return { type: "drawing", confidence: 0.85 };
    if (lower.includes("schedule")) return { type: "schedule", confidence: 0.8 };
    if (lower.includes("rfp") || lower.includes("rfi") || lower.includes("bid")) return { type: "rfp", confidence: 0.8 };
    if (lower.includes("submit")) return { type: "submittal", confidence: 0.8 };
    if (lower.includes("addend")) return { type: "addendum", confidence: 0.85 };
    return { type: "document", confidence: 0.5 };
  }
  if (lower.endsWith(".dwg") || lower.endsWith(".dxf")) return { type: "cad_drawing", confidence: 0.95 };
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".csv")) return { type: "spreadsheet", confidence: 0.9 };
  if (lower.endsWith(".docx") || lower.endsWith(".doc")) return { type: "specification", confidence: 0.6 };
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".png") || lower.endsWith(".tiff")) return { type: "image", confidence: 0.9 };
  return { type: "unknown", confidence: 0.3 };
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
}, async (ctx, input) => {
  const workspace = await fetchWorkspace(ctx);
  const doc = findDocument(workspace, input.documentId as string);
  if (!doc) return { success: false, error: `Document not found: ${input.documentId}`, duration_ms: 0 };

  return {
    success: true,
    data: {
      documentId: doc.id,
      documentName: doc.name ?? doc.filename,
      pageNumber: input.pageNumber,
      dpi: input.dpi ?? 150,
      pageCount: doc.pageCount ?? doc.pages ?? null,
      mimeType: doc.mimeType ?? "application/pdf",
      note: "PDF page rendering requires a backend rendering service. Document metadata is returned. Actual image rendering will be available when the vision backend is deployed.",
    },
  };
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
}, async (ctx, input) => {
  const workspace = await fetchWorkspace(ctx);
  const doc = findDocument(workspace, input.documentId as string);
  if (!doc) return { success: false, error: `Document not found: ${input.documentId}`, duration_ms: 0 };

  const filename = doc.name ?? doc.filename ?? "";
  const classification = classifyByFilename(filename);

  return {
    success: true,
    data: {
      documentId: doc.id,
      documentName: filename,
      pageNumber: input.pageNumber,
      classification: classification.type,
      classificationConfidence: classification.confidence,
      context: input.context ?? null,
      extractedText: doc.extractedText ?? null,
      pageCount: doc.pageCount ?? doc.pages ?? null,
      note: "Full drawing analysis with element detection requires a vision AI backend. Document metadata and available extracted text are returned.",
    },
  };
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
}, async (ctx, input) => {
  const workspace = await fetchWorkspace(ctx);
  const doc = findDocument(workspace, input.documentId as string);
  if (!doc) return { success: false, error: `Document not found: ${input.documentId}`, duration_ms: 0 };

  const extractedText: string | null = doc.extractedText ?? null;

  return {
    success: true,
    data: {
      documentId: doc.id,
      documentName: doc.name ?? doc.filename,
      pageNumber: input.pageNumber,
      extractedText,
      tables: extractedText ? [{ note: "Text content available - table structure extraction requires vision backend for accurate row/column parsing." }] : [],
      note: "Structured table extraction with row/column detection requires a vision AI backend. Any available extracted text from the document is included above.",
    },
  };
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
}, async (ctx, input) => {
  const workspace = await fetchWorkspace(ctx);
  const doc = findDocument(workspace, input.documentId as string);
  if (!doc) return { success: false, error: `Document not found: ${input.documentId}`, duration_ms: 0 };

  const filename = doc.name ?? doc.filename ?? "";
  const classification = classifyByFilename(filename);

  // Try to improve classification from extracted text content
  const text: string = (doc.extractedText ?? "").toLowerCase();
  let contentClassification: { type: string; confidence: number } | null = null;
  if (text.length > 0) {
    if (text.includes("specification") || text.includes("section ") || text.includes("division ")) {
      contentClassification = { type: "specification", confidence: 0.75 };
    } else if (text.includes("schedule") || text.includes("timeline") || text.includes("milestone")) {
      contentClassification = { type: "schedule", confidence: 0.7 };
    } else if (text.includes("request for proposal") || text.includes("rfp") || text.includes("bid ")) {
      contentClassification = { type: "rfp", confidence: 0.75 };
    }
  }

  // Use the higher confidence classification
  const best = contentClassification && contentClassification.confidence > classification.confidence
    ? contentClassification
    : classification;

  return {
    success: true,
    data: {
      documentId: doc.id,
      documentName: filename,
      classifiedType: best.type,
      confidence: best.confidence,
      method: contentClassification && contentClassification.confidence > classification.confidence ? "content_analysis" : "filename_analysis",
      mimeType: doc.mimeType ?? null,
      pageCount: doc.pageCount ?? doc.pages ?? null,
    },
  };
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
}, async (ctx, input) => {
  const workspace = await fetchWorkspace(ctx);
  const doc = findDocument(workspace, input.documentId as string);
  if (!doc) return { success: false, error: `Document not found: ${input.documentId}`, duration_ms: 0 };

  const extractedText: string | null = doc.extractedText ?? null;

  return {
    success: true,
    data: {
      documentId: doc.id,
      documentName: doc.name ?? doc.filename,
      pageNumber: input.pageNumber,
      text: extractedText,
      hasText: extractedText !== null && extractedText.length > 0,
      characterCount: extractedText?.length ?? 0,
      note: extractedText
        ? "Text extracted from document. Per-page OCR with handwriting recognition requires a vision AI backend."
        : "No extracted text available for this document. Full OCR requires a vision AI backend.",
    },
  };
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
}, async (ctx, input) => {
  const workspace = await fetchWorkspace(ctx);
  const doc = findDocument(workspace, input.documentId as string);
  if (!doc) return { success: false, error: `Document not found: ${input.documentId}`, duration_ms: 0 };

  return {
    success: true,
    data: {
      documentId: doc.id,
      documentName: doc.name ?? doc.filename,
      pageNumber: input.pageNumber,
      region: {
        x: input.x,
        y: input.y,
        width: input.width,
        height: input.height,
      },
      note: "Region cropping and analysis requires a vision AI backend with PDF rendering. Document metadata is returned with the region coordinates for when the backend is available.",
    },
  };
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
}, async (ctx, input) => {
  const workspace = await fetchWorkspace(ctx);
  const doc = findDocument(workspace, input.documentId as string);
  if (!doc) return { success: false, error: `Document not found: ${input.documentId}`, duration_ms: 0 };

  // Try to extract dimension-like patterns from text if available
  const text: string = doc.extractedText ?? "";
  const dimensionPatterns = text.match(/\d+['"]?\s*[-x×]\s*\d+['"]?/g) ?? [];
  const measurementPatterns = text.match(/\d+(?:\.\d+)?\s*(?:ft|in|m|mm|cm|'|")/gi) ?? [];

  return {
    success: true,
    data: {
      documentId: doc.id,
      documentName: doc.name ?? doc.filename,
      pageNumber: input.pageNumber,
      dimensionsFound: dimensionPatterns.length + measurementPatterns.length,
      dimensionStrings: [...new Set([...dimensionPatterns, ...measurementPatterns])].slice(0, 50),
      note: "Dimension extraction from text patterns is approximate. Accurate dimension extraction from drawings requires a vision AI backend with CAD/drawing analysis capabilities.",
    },
  };
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
}, async (ctx, input) => {
  const workspace = await fetchWorkspace(ctx);
  const docA = findDocument(workspace, input.documentIdA as string);
  const docB = findDocument(workspace, input.documentIdB as string);

  if (!docA) return { success: false, error: `Document A not found: ${input.documentIdA}`, duration_ms: 0 };
  if (!docB) return { success: false, error: `Document B not found: ${input.documentIdB}`, duration_ms: 0 };

  // Compare metadata
  const textA: string = docA.extractedText ?? "";
  const textB: string = docB.extractedText ?? "";
  const textChanged = textA !== textB;

  return {
    success: true,
    data: {
      documentA: {
        id: docA.id,
        name: docA.name ?? docA.filename,
        pageCount: docA.pageCount ?? docA.pages ?? null,
        uploadedAt: docA.uploadedAt ?? docA.createdAt ?? null,
        textLength: textA.length,
      },
      documentB: {
        id: docB.id,
        name: docB.name ?? docB.filename,
        pageCount: docB.pageCount ?? docB.pages ?? null,
        uploadedAt: docB.uploadedAt ?? docB.createdAt ?? null,
        textLength: textB.length,
      },
      pageNumber: input.pageNumber,
      textContentChanged: textChanged,
      textLengthDifference: textB.length - textA.length,
      note: "Visual side-by-side comparison with change highlighting requires a vision AI backend. Metadata comparison and text content change detection are returned.",
    },
  };
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
}, async (ctx, input) => {
  const workspace = await fetchWorkspace(ctx);
  const doc = findDocument(workspace, input.documentId as string);
  if (!doc) return { success: false, error: `Document not found: ${input.documentId}`, duration_ms: 0 };

  const filename = (doc.name ?? doc.filename ?? "").toLowerCase();
  const classification = classifyByFilename(filename);

  // Infer likely symbol types from document classification
  let likelySymbolTypes: string[] = [];
  if (filename.includes("electrical") || filename.includes("elec")) {
    likelySymbolTypes = ["outlets", "switches", "panels", "junction boxes", "conduit runs", "lighting fixtures"];
  } else if (filename.includes("plumbing") || filename.includes("plumb")) {
    likelySymbolTypes = ["fixtures", "valves", "drains", "water heaters", "pipe runs"];
  } else if (filename.includes("hvac") || filename.includes("mechanical")) {
    likelySymbolTypes = ["diffusers", "returns", "ductwork", "thermostats", "units", "dampers"];
  } else if (filename.includes("fire") || filename.includes("sprinkler")) {
    likelySymbolTypes = ["sprinkler heads", "fire alarm pulls", "smoke detectors", "standpipes"];
  } else {
    likelySymbolTypes = ["doors", "windows", "walls", "dimensions", "annotations", "section markers"];
  }

  return {
    success: true,
    data: {
      documentId: doc.id,
      documentName: doc.name ?? doc.filename,
      pageNumber: input.pageNumber,
      documentType: classification.type,
      likelySymbolTypes,
      note: "Symbol identification and cataloging requires a vision AI backend with drawing analysis. Likely symbol types are inferred from the document name and classification.",
    },
  };
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
}, async (ctx, input) => {
  const workspace = await fetchWorkspace(ctx);
  const doc = findDocument(workspace, input.documentId as string);
  if (!doc) return { success: false, error: `Document not found: ${input.documentId}`, duration_ms: 0 };

  return {
    success: true,
    data: {
      documentId: doc.id,
      documentName: doc.name ?? doc.filename,
      pageCount: doc.pageCount ?? doc.pages ?? null,
      mimeType: doc.mimeType ?? null,
      fileSize: doc.fileSize ?? doc.size ?? null,
      uploadedAt: doc.uploadedAt ?? doc.createdAt ?? null,
      status: doc.status ?? null,
      hasExtractedText: !!(doc.extractedText && doc.extractedText.length > 0),
    },
  };
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

    // Try to call the vision package endpoint if available
    try {
      const res = await apiFetch(context, `${context.apiBaseUrl}/api/vision/count-symbols`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: input.documentId,
          templateDocumentId: input.templateDocumentId,
          pageNumbers: input.pageNumbers ?? [],
          threshold: input.threshold ?? 0.65,
          projectId: context.projectId,
        }),
      });

      if (res.ok) {
        const result = await res.json();
        return { success: true, data: result, duration_ms: Date.now() - start };
      }
    } catch {
      // Vision endpoint not available, fall through
    }

    return {
      success: true,
      data: {
        message: "Symbol counting requires the @bidwright/vision backend service with OpenCV support. The vision endpoint is not currently available.",
        documentId: input.documentId,
        templateDocumentId: input.templateDocumentId,
        pageNumbers: input.pageNumbers ?? "all",
        threshold: input.threshold ?? 0.65,
      },
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
