import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiPost, getProjectId } from "../api-client.js";

/**
 * Vision tools for the MCP server — gives the Claude Code CLI agent
 * the ability to visually inspect construction drawings, isolate symbols,
 * and run the OpenCV auto-count pipeline.
 *
 * The agent workflow for counting symbols:
 *   1. renderDrawingPage  → see the full page as an image
 *   2. zoomDrawingRegion  → zoom into a specific area to inspect small symbols
 *   3. countSymbols       → run CV pipeline with a precise bounding box
 */

const boundingBoxSchema = {
  x: z.number().describe("X coordinate of top-left corner (pixels from left, in the rendered image coordinate space)"),
  y: z.number().describe("Y coordinate of top-left corner (pixels from top)"),
  width: z.number().describe("Width of region in pixels"),
  height: z.number().describe("Height of region in pixels"),
  imageWidth: z.number().describe("Total width of the rendered image this bbox refers to"),
  imageHeight: z.number().describe("Total height of the rendered image this bbox refers to"),
};

export function registerVisionTools(server: McpServer) {

  // ── renderDrawingPage ──────────────────────────────────────
  server.tool(
    "renderDrawingPage",
    `Render a construction drawing PDF page to an image so you can visually inspect it. Returns the page as a viewable image. Use this as the FIRST step when you need to look at a drawing — to find symbols, identify elements, understand the layout, or locate items to count. The image coordinates returned (width/height) are what you use for bounding boxes in other vision tools.`,
    {
      documentId: z.string().describe("Document ID of the PDF drawing"),
      pageNumber: z.number().min(1).default(1).describe("Page number (1-based)"),
      dpi: z.number().min(72).max(300).default(150).describe("Resolution — 150 for overview, 200-300 for detail. Higher = larger image but more detail visible for small symbols"),
    },
    async ({ documentId, pageNumber, dpi }) => {
      const result = await apiPost("/api/vision/render-page", {
        projectId: getProjectId(),
        documentId,
        pageNumber,
        dpi,
      });

      if (!result.success || !result.image) {
        return { content: [{ type: "text" as const, text: `Failed to render page: ${result.error ?? "unknown error"}` }] };
      }

      // Extract the raw base64 from the data URL
      const base64Match = (result.image as string).match(/^data:image\/png;base64,(.+)$/);
      if (!base64Match) {
        return { content: [{ type: "text" as const, text: "Render succeeded but image format was unexpected" }] };
      }

      return {
        content: [
          {
            type: "image" as const,
            data: base64Match[1],
            mimeType: "image/png" as const,
          },
          {
            type: "text" as const,
            text: JSON.stringify({
              imageWidth: result.width,
              imageHeight: result.height,
              pageWidth: result.pageWidth,
              pageHeight: result.pageHeight,
              pageCount: result.pageCount,
              pageNumber,
              dpi,
              note: "Use imageWidth and imageHeight as the coordinate space for bounding boxes in zoomDrawingRegion and countSymbols tools.",
            }, null, 2),
          },
        ],
      };
    }
  );

  // ── zoomDrawingRegion ──────────────────────────────────────
  server.tool(
    "zoomDrawingRegion",
    `Zoom into a specific region of a drawing page at high resolution. Use this after renderDrawingPage to get a closer look at small symbols, crowded areas, or fine details that are hard to see at overview resolution. Returns a cropped, high-res image of just that region. The bounding box coordinates must be in the coordinate space of a previously rendered image (use the imageWidth/imageHeight from renderDrawingPage).`,
    {
      documentId: z.string().describe("Document ID of the PDF drawing"),
      pageNumber: z.number().min(1).default(1).describe("Page number (1-based)"),
      region: z.object(boundingBoxSchema).describe("Region to zoom into — coordinates from a previous renderDrawingPage result"),
    },
    async ({ documentId, pageNumber, region }) => {
      const result = await apiPost("/api/vision/render-page", {
        projectId: getProjectId(),
        documentId,
        pageNumber,
        dpi: 300, // Always high-res for zoom
        region,
      });

      if (!result.success || !result.image) {
        return { content: [{ type: "text" as const, text: `Failed to zoom: ${result.error ?? "unknown error"}` }] };
      }

      const base64Match = (result.image as string).match(/^data:image\/png;base64,(.+)$/);
      if (!base64Match) {
        return { content: [{ type: "text" as const, text: "Zoom succeeded but image format was unexpected" }] };
      }

      return {
        content: [
          {
            type: "image" as const,
            data: base64Match[1],
            mimeType: "image/png" as const,
          },
          {
            type: "text" as const,
            text: JSON.stringify({
              zoomedWidth: result.width,
              zoomedHeight: result.height,
              originalRegion: region,
              note: "This is a high-res crop. To count symbols, use the ORIGINAL region coordinates (from renderDrawingPage's coordinate space) with countSymbols — not the zoomed image dimensions.",
            }, null, 2),
          },
        ],
      };
    }
  );

  // ── countSymbols ───────────────────────────────────────────
  server.tool(
    "countSymbols",
    `Run the OpenCV computer vision pipeline to count all occurrences of a symbol on a drawing page. You MUST provide an accurate bounding box around ONE example of the symbol to use as a template. The pipeline extracts that region, then searches the entire page using template matching, feature detection (SIFT/ORB/BRISK), direct text extraction, and OCR.

WORKFLOW: First call renderDrawingPage to see the page. If the symbol is small, call zoomDrawingRegion to inspect the area closely. Then provide the bounding box of ONE clear example of the symbol — coordinates must be in the renderDrawingPage image coordinate space.

TIPS FOR ACCURACY:
- Draw the box tightly around the symbol with minimal surrounding whitespace
- Pick a clean, unobstructed example of the symbol (not one that overlaps with other elements)
- For text-based symbols (like "SP-01"), the text matching pipeline is highly accurate
- For graphical symbols, template matching works best when the box captures the full symbol
- Lower threshold (0.5) finds more but risks false positives; higher (0.8) is stricter`,
    {
      documentId: z.string().describe("Document ID of the PDF drawing"),
      pageNumber: z.number().min(1).describe("Page number to search (1-based)"),
      boundingBox: z.object(boundingBoxSchema).describe("Bounding box around ONE example of the symbol to find — in renderDrawingPage coordinate space"),
      threshold: z.number().min(0.3).max(0.95).default(0.65).describe("Match confidence threshold (0.3-0.95). Default 0.65 is good for most symbols"),
    },
    async ({ documentId, pageNumber, boundingBox, threshold }) => {
      const result = await apiPost("/api/vision/count-symbols", {
        projectId: getProjectId(),
        documentId,
        pageNumber,
        boundingBox,
        threshold,
      });

      if (!result.success) {
        return { content: [{ type: "text" as const, text: `Symbol counting failed: ${result.error ?? JSON.stringify(result.errors)}` }] };
      }

      // Strip base64 images from matches to keep context lean
      const matches = (result.matches ?? []).map((m: any) => ({
        rect: m.rect,
        confidence: m.confidence,
        text: m.text || undefined,
        method: m.detection_method,
      }));

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            totalCount: result.totalCount,
            documentId,
            pageNumber,
            threshold,
            duration_ms: result.duration_ms,
            matches,
            errors: result.errors?.length ? result.errors : undefined,
          }, null, 2),
        }],
      };
    }
  );

  // ── detectScale ────────────────────────────────────────────
  server.tool(
    "detectScale",
    `Render a drawing page and analyze the title block area to detect the drawing scale. Looks for scale notations like "1/4\" = 1'-0\"", "1:50", "SCALE: 1\"=20'", etc. Returns the detected scale and the calibration factor (pixels per real-world unit). Use this before doing measurements to set up calibration.`,
    {
      documentId: z.string().describe("Document ID"),
      pageNumber: z.number().min(1).default(1),
    },
    async ({ documentId, pageNumber }) => {
      // Render the bottom-right quadrant at high DPI (title blocks are typically there)
      const fullRender = await apiPost("/api/vision/render-page", {
        projectId: getProjectId(),
        documentId,
        pageNumber,
        dpi: 100, // Low DPI first to get dimensions
      });

      if (!fullRender.success) {
        return { content: [{ type: "text" as const, text: `Failed: ${fullRender.error}` }] };
      }

      // Render the title block region (bottom-right 30% x 15%)
      const w = fullRender.width as number;
      const h = fullRender.height as number;
      const titleBlockRegion = {
        x: Math.round(w * 0.65),
        y: Math.round(h * 0.85),
        width: Math.round(w * 0.35),
        height: Math.round(h * 0.15),
        imageWidth: w,
        imageHeight: h,
      };

      const zoomResult = await apiPost("/api/vision/render-page", {
        projectId: getProjectId(),
        documentId,
        pageNumber,
        dpi: 300,
        region: titleBlockRegion,
      });

      if (!zoomResult.success || !zoomResult.image) {
        return { content: [{ type: "text" as const, text: `Failed to render title block: ${zoomResult.error}` }] };
      }

      const base64Match = (zoomResult.image as string).match(/^data:image\/png;base64,(.+)$/);
      if (!base64Match) {
        return { content: [{ type: "text" as const, text: "Image format error" }] };
      }

      return {
        content: [
          {
            type: "image" as const,
            data: base64Match[1],
            mimeType: "image/png" as const,
          },
          {
            type: "text" as const,
            text: JSON.stringify({
              region: "title block (bottom-right)",
              pageWidth: fullRender.pageWidth,
              pageHeight: fullRender.pageHeight,
              imageWidth: w,
              imageHeight: h,
              instruction: "Look at this title block image for scale information (e.g. '1/4\" = 1\\'-0\"', 'SCALE: 1:50'). Report the scale you find.",
            }, null, 2),
          },
        ],
      };
    }
  );

  // ── measureLinear ──────────────────────────────────────────
  server.tool(
    "measureLinear",
    `Measure a linear distance on a drawing between two points, using calibration. You provide two points in renderDrawingPage coordinate space and the calibration (pixelsPerUnit + unit). Returns the real-world distance. Use detectScale first to establish calibration, or use a known dimension on the drawing.`,
    {
      pointA: z.object({ x: z.number(), y: z.number() }).describe("Start point in image coordinates"),
      pointB: z.object({ x: z.number(), y: z.number() }).describe("End point in image coordinates"),
      pixelsPerUnit: z.number().positive().describe("Calibration: how many pixels per real-world unit"),
      unit: z.string().default("ft").describe("Real-world unit (ft, in, m, etc.)"),
    },
    async ({ pointA, pointB, pixelsPerUnit, unit }) => {
      const pixelDist = Math.sqrt((pointB.x - pointA.x) ** 2 + (pointB.y - pointA.y) ** 2);
      const realDist = pixelDist / pixelsPerUnit;

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            pixelDistance: Math.round(pixelDist * 100) / 100,
            realDistance: Math.round(realDist * 1000) / 1000,
            unit,
            pointA,
            pointB,
          }, null, 2),
        }],
      };
    }
  );

  // ── listDrawingPages ───────────────────────────────────────
  server.tool(
    "listDrawingPages",
    "List all PDF drawing documents in the current project with their page counts. Use this to discover what drawings are available before rendering them.",
    {},
    async () => {
      const { apiGet } = await import("../api-client.js");
      const workspace = await apiGet(`/projects/${getProjectId()}/workspace`);
      const docs = (workspace.sourceDocuments ?? workspace.documents ?? [])
        .filter((d: any) => d.fileType === "application/pdf" || d.documentType === "drawing")
        .map((d: any) => ({
          id: d.id,
          fileName: d.fileName ?? d.name,
          pageCount: d.pageCount ?? null,
          documentType: d.documentType,
        }));

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ documents: docs, count: docs.length }, null, 2) }],
      };
    }
  );
}
