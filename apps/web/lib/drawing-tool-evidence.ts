export interface DrawingToolEvidence {
  viewId: string;
  documentId?: string;
  pageNumber: number;
  bbox?: { x: number; y: number; width: number; height: number };
  imageWidth: number;
  imageHeight: number;
  dpi?: number;
}

/** MCP results may be JSON, content blocks, or a persisted result envelope. */
export function drawingToolEvidence(value: unknown, input?: unknown, depth = 0): DrawingToolEvidence | null {
  if (depth > 8 || value == null) return null;
  if (typeof value === "string") {
    try { return drawingToolEvidence(JSON.parse(value), input, depth + 1); } catch { return null; }
  }
  if (Array.isArray(value)) {
    for (const block of value) {
      const found = drawingToolEvidence(block, input, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const record = value as Record<string, any>;
  const args = input && typeof input === "object" ? input as Record<string, any> : {};
  if (typeof record.viewId === "string" && record.viewId.startsWith("view-")) {
    const box = record.bbox ?? args.bbox;
    const validBox = box && ["x", "y", "width", "height"].every((key) => typeof box[key] === "number" && Number.isFinite(box[key]) && box[key] >= 0 && box[key] <= 1);
    return {
      viewId: record.viewId,
      documentId: record.documentId ?? args.documentId,
      pageNumber: Number(record.pageNumber ?? args.pageNumber) || 1,
      bbox: validBox ? box : undefined,
      imageWidth: Number(record.imageWidth ?? record.width) || 0,
      imageHeight: Number(record.imageHeight ?? record.height) || 0,
      dpi: Number(record.dpi) || undefined,
    };
  }
  for (const key of ["content", "text", "result", "data"]) {
    const found = drawingToolEvidence(record[key], input, depth + 1);
    if (found) return found;
  }
  return null;
}
