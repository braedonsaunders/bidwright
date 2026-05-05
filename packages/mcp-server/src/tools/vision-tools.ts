import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiPost, getProjectId } from "../api-client.js";

/**
 * Vision tools for the MCP server — gives the Claude Code CLI agent
 * the ability to visually inspect construction drawings, isolate symbols,
 * and run the OpenCV auto-count pipeline.
 *
 * The agent workflow for counting symbols:
 *   1. listDrawingPages   → discover what drawings exist in the project
 *   2. renderDrawingPage  → see the full page as an image
 *   3. zoomDrawingRegion  → zoom into a specific area to inspect small symbols
 *   4. countSymbols       → run CV pipeline with a precise bounding box
 *   5. saveCountAsAnnotations → persist results as takeoff annotations
 */

const boundingBoxSchema = {
  x: z.number().describe("X coordinate of top-left corner (pixels from left, in the rendered image coordinate space)"),
  y: z.number().describe("Y coordinate of top-left corner (pixels from top)"),
  width: z.number().describe("Width of region in pixels"),
  height: z.number().describe("Height of region in pixels"),
  imageWidth: z.number().describe("Total width of the rendered image this bbox refers to"),
  imageHeight: z.number().describe("Total height of the rendered image this bbox refers to"),
};

/** Helper: save an array of matches as TakeoffAnnotation records via the API */
async function saveMatchesAsAnnotations(opts: {
  documentId: string;
  pageNumber: number;
  matches: Array<{ rect: { x: number; y: number; width?: number; height?: number }; confidence: number; text?: string; method?: string }>;
  label: string;
  color: string;
  templateImage?: string;
}): Promise<{ savedCount: number; errors: string[] }> {
  const projectId = getProjectId();
  const errors: string[] = [];
  let savedCount = 0;

  for (const match of opts.matches) {
    try {
      await apiPost(`/api/takeoff/${projectId}/annotations`, {
        documentId: opts.documentId,
        pageNumber: opts.pageNumber,
        annotationType: "count",
        label: opts.label,
        color: opts.color,
        points: [{ x: match.rect.x, y: match.rect.y }],
        measurement: { value: opts.matches.length, unit: "count" },
        metadata: {
          createdBy: "agent",
          detection_method: match.method ?? "template_matching",
          confidence: match.confidence,
          matchText: match.text || undefined,
          templateImage: opts.templateImage || undefined,
        },
      });
      savedCount++;
    } catch (err) {
      errors.push(`Failed to save match at (${match.rect.x}, ${match.rect.y}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { savedCount, errors };
}

export function registerVisionTools(server: McpServer) {

  // ── listDrawingPages ───────────────────────────────────────
  server.tool(
    "listDrawingPages",
    `List all PDF drawing documents in the current project with their page counts.

WHEN TO USE: Call this FIRST when starting any vision workflow. You need document IDs to use all other vision tools.

INPUTS: None required — automatically scoped to the current project.

OUTPUT: Array of documents with id, fileName, pageCount, and documentType. Use the "id" field as the documentId parameter for renderDrawingPage and other tools.

COMMON PITFALLS:
- Do NOT guess document IDs — always call this tool first to get valid IDs
- Documents with documentType "drawing" are construction drawings; "reference" docs may also be PDFs but aren't drawings
- pageCount may be null if the document hasn't been fully processed yet`,
    {},
    async () => {
      const { apiGet } = await import("../api-client.js");
      const workspace = await apiGet(`/projects/${getProjectId()}/workspace`);
      const docs = (workspace.sourceDocuments ?? workspace.documents ?? [])
        .filter((d: any) => d.fileType === "application/pdf" || d.fileType === "pdf" || d.documentType === "drawing")
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

  // ── renderDrawingPage ──────────────────────────────────────
  server.tool(
    "renderDrawingPage",
    `Render a construction drawing PDF page to an image so you can visually inspect it.

WHEN TO USE: This is the FIRST step whenever you need to look at a drawing — to find symbols, identify elements, understand the layout, or locate items to count. Always start here before zooming or counting.

INPUTS:
- documentId: Get this from listDrawingPages
- pageNumber: 1-based page number (default 1)
- dpi: Resolution — use 150 for overview/browsing, 200-300 for detailed inspection of small symbols. Higher DPI = larger image = more detail but more data

OUTPUT: Returns the page as a viewable PNG image, plus metadata JSON with imageWidth, imageHeight, pageWidth, pageHeight, pageCount, and dpi. The imageWidth/imageHeight define the coordinate space you MUST use for bounding boxes in zoomDrawingRegion and countSymbols.

COMMON PITFALLS:
- Always note the imageWidth and imageHeight from the response — you need these for bounding box coordinates
- Start with dpi=150 to get an overview, then zoom into specific areas with zoomDrawingRegion for detail
- Large pages at 300 DPI produce very large images — only use high DPI when you need to see fine detail`,
    {
      documentId: z.string().describe("Document ID of the PDF drawing (from listDrawingPages)"),
      pageNumber: z.number().min(1).default(1).describe("Page number (1-based)"),
      dpi: z.number().min(72).max(300).default(150).describe("Resolution — 150 for overview, 200-300 for detail"),
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
    `Zoom into a specific region of a drawing page at high resolution (300 DPI).

WHEN TO USE: After calling renderDrawingPage, use this to get a closer look at small symbols, crowded areas, or fine details that are hard to see at overview resolution. Essential for identifying the exact boundaries of small symbols before running countSymbols.

INPUTS:
- documentId: Same document ID used in renderDrawingPage
- pageNumber: Same page number
- region: Bounding box object with {x, y, width, height, imageWidth, imageHeight} — all coordinates MUST be in the renderDrawingPage coordinate space (use the imageWidth/imageHeight from that tool's output)

OUTPUT: A cropped, 300 DPI image of just the specified region, plus metadata. The zoomed image has its own dimensions (zoomedWidth/zoomedHeight) — do NOT use these as coordinates for countSymbols.

COMMON PITFALLS:
- Coordinates must come from renderDrawingPage's coordinate space, NOT from a previous zoom
- The zoomed image dimensions are different from the original — always use ORIGINAL coordinates for countSymbols
- Make the region large enough to see context around the symbol (add 20-30% padding)`,
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
    `Run the OpenCV computer vision pipeline to count all occurrences of a symbol on a drawing page.

WHEN TO USE: After you have identified a symbol on a drawing page using renderDrawingPage (and optionally zoomDrawingRegion), use this tool to count how many times that symbol appears. You MUST provide an accurate bounding box around ONE clear example of the symbol.

INPUTS:
- documentId: Document ID from listDrawingPages
- pageNumber: Page to search (1-based)
- boundingBox: Tight bounding box around ONE example of the symbol — coordinates in renderDrawingPage's image coordinate space
- threshold: Match confidence (0.3-0.95). Default 0.65 works well. Lower = more matches but more false positives. Higher = fewer but more confident matches
- autoSave: If true, automatically saves all matches as TakeoffAnnotation records in the project takeoff. Default false — set to true when you want to persist count results for the user
- crossScale: If true, matches at multiple scales (0.75x-1.25x) to find the same symbol even when rendered at different sizes. ESSENTIAL for cross-document searches where different CAD sources produce different-sized symbols. ~6x slower but finds symbols that single-scale misses. Default false for same-page, set to true for cross-document.

OUTPUT: totalCount (number of matches), matches array with rect/confidence/text/method for each match, duration_ms, and any errors.

WORKFLOW:
1. Call renderDrawingPage to see the page (get imageWidth/imageHeight)
2. If the symbol is small, call zoomDrawingRegion to inspect it closely
3. Identify ONE clean, unobstructed example of the symbol
4. Call countSymbols with a tight bounding box around that example
5. If autoSave=true, matches are automatically saved as takeoff annotations
6. To count across ALL pages of a document, use countSymbolsAllPages instead
7. To count across ALL documents in the project, call countSymbolsAllPages for each document with crossScale=true

TIPS FOR ACCURACY:
- Draw the box tightly around the symbol with minimal surrounding whitespace
- Pick a clean, unobstructed example (not overlapping with other elements)
- Optimal threshold is 0.75 (proven across 5 real construction packages)
- If you get too many false positives, increase threshold to 0.80-0.85
- If you get too few matches, decrease threshold to 0.60-0.70
- For cross-document searches, ALWAYS set crossScale=true

COMMON PITFALLS:
- Bounding box coordinates MUST be in renderDrawingPage coordinate space (NOT zoomed coordinates)
- Providing too large a bounding box (with lots of surrounding context) reduces accuracy
- Providing too small a bounding box (clipping the symbol) also reduces accuracy
- Without crossScale, a template from one CAD source may not match a different source's rendering of the same symbol`,
    {
      documentId: z.string().describe("Document ID of the PDF drawing"),
      pageNumber: z.number().min(1).describe("Page number to search (1-based)"),
      boundingBox: z.object(boundingBoxSchema).describe("Bounding box around ONE example of the symbol to find — in renderDrawingPage coordinate space"),
      threshold: z.number().min(0.3).max(0.95).default(0.75).describe("Match confidence threshold. 0.75 is optimal (proven across 5 packages). Lower = more matches, higher = stricter"),
      crossScale: z.boolean().default(false).describe("Enable cross-scale matching (0.75x-1.25x). ESSENTIAL for cross-document searches. ~6x slower but catches different-sized renderings of the same symbol"),
      autoSave: z.boolean().default(false).describe("If true, automatically persist all matches as TakeoffAnnotation records"),
    },
    async ({ documentId, pageNumber, boundingBox, threshold, crossScale, autoSave }) => {
      const result = await apiPost("/api/vision/count-symbols", {
        projectId: getProjectId(),
        documentId,
        pageNumber,
        boundingBox,
        threshold,
        crossScale,
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

      // Auto-save as annotations if requested
      let saveResult: { savedCount: number; errors: string[] } | undefined;
      if (autoSave && matches.length > 0) {
        const totalCount = result.totalCount ?? matches.length;
        saveResult = await saveMatchesAsAnnotations({
          documentId,
          pageNumber,
          matches,
          label: `Auto Count: ${totalCount} symbols`,
          color: "#22c55e",
        });
      }

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
            ...(saveResult ? {
              autoSaved: true,
              savedCount: saveResult.savedCount,
              saveErrors: saveResult.errors.length ? saveResult.errors : undefined,
            } : {}),
          }, null, 2),
        }],
      };
    }
  );

  // ── saveCountAsAnnotations ─────────────────────────────────
  server.tool(
    "saveCountAsAnnotations",
    `Save symbol count results as takeoff annotations in the project. Creates a TakeoffAnnotation record for each match location, preserving the detection metadata.

WHEN TO USE: After running countSymbols (with autoSave=false), call this to persist the results if the user confirms they look correct. This is the manual alternative to countSymbols' autoSave parameter — useful when you want to review results before saving.

INPUTS:
- documentId: The document the matches were found in
- pageNumber: The page number the matches were found on
- matches: Array of match objects (copy from countSymbols output) — each needs at least rect.x, rect.y, and confidence
- label: Human-readable label for the annotations (e.g. "Fire Sprinkler Heads", "46 valve tags")
- color: Hex color for the annotation markers (default green #22c55e). Use colors that contrast with the drawing

OUTPUT: Number of successfully saved annotations and any errors.

COMMON PITFALLS:
- Make sure to pass the matches array from a countSymbols result — don't fabricate match data
- Each match becomes a separate annotation point on the takeoff
- The label should be descriptive — it shows up in the takeoff annotation list for the user
- Annotations are marked with metadata.createdBy = "agent" so users can distinguish them from manual annotations`,
    {
      documentId: z.string().describe("Document ID where matches were found"),
      pageNumber: z.number().min(1).describe("Page number where matches were found"),
      matches: z.array(z.object({
        rect: z.object({
          x: z.number().describe("X coordinate of the match"),
          y: z.number().describe("Y coordinate of the match"),
          width: z.number().optional().describe("Width of the matched region"),
          height: z.number().optional().describe("Height of the matched region"),
        }),
        confidence: z.number().describe("Match confidence (0-1)"),
        text: z.string().optional().describe("Detected text content if applicable"),
        method: z.string().optional().describe("Detection method used"),
      })).describe("Array of match results from countSymbols"),
      label: z.string().describe("Human-readable label for the annotations (e.g. 'Fire Sprinkler Heads')"),
      color: z.string().default("#22c55e").describe("Hex color for annotation markers (default green)"),
      templateImage: z.string().optional().describe("Optional base64 template image used for matching"),
    },
    async ({ documentId, pageNumber, matches, label, color, templateImage }) => {
      if (matches.length === 0) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ savedCount: 0, message: "No matches to save" }, null, 2) }],
        };
      }

      const result = await saveMatchesAsAnnotations({
        documentId,
        pageNumber,
        matches,
        label,
        color,
        templateImage,
      });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            savedCount: result.savedCount,
            totalMatches: matches.length,
            label,
            color,
            documentId,
            pageNumber,
            errors: result.errors.length ? result.errors : undefined,
          }, null, 2),
        }],
      };
    }
  );

  // ── countSymbolsAllPages ──────────────────────────────────
  server.tool(
    "countSymbolsAllPages",
    `Count a symbol across ALL pages of a multi-page document in one call. The server handles the per-page loop — much faster than calling countSymbols for each page individually.

WHEN TO USE: After finding a symbol on one page with countSymbols, use this to search the entire document for the same symbol. This is the "Search All Pages" capability.

INPUTS:
- documentId: Document ID from listDrawingPages
- boundingBox: Same bounding box used in countSymbols — coordinates in renderDrawingPage coordinate space
- threshold: Match confidence (default 0.75)
- crossScale: Set to true if pages may have different zoom levels or if the symbol might render at slightly different sizes across pages. ALWAYS use true when searching across documents from different sources.

OUTPUT: Per-page breakdown {pageNumber, totalCount, matches} plus grandTotal across all pages. Use this to see exactly which pages contain the symbol.

EXAMPLE USE CASES:
- "Count all valve tags across a 12-page P&ID set" → one call, get counts per page
- "How many fire sprinklers on each floor plan?" → search a multi-page architectural set
- "Find this symbol across all project drawings" → call this for each document from listDrawingPages with crossScale=true`,
    {
      documentId: z.string().describe("Document ID of the PDF drawing"),
      boundingBox: z.object(boundingBoxSchema).describe("Bounding box of the symbol template — in renderDrawingPage coordinate space"),
      threshold: z.number().min(0.3).max(0.95).default(0.75).describe("Match confidence threshold (0.75 optimal)"),
      crossScale: z.boolean().default(false).describe("Enable cross-scale matching for different-sized renderings"),
    },
    async ({ documentId, boundingBox, threshold, crossScale }) => {
      const result = await apiPost("/api/vision/count-symbols-all-pages", {
        projectId: getProjectId(),
        documentId,
        boundingBox,
        threshold,
        crossScale,
      });

      if (!result.success) {
        return { content: [{ type: "text" as const, text: `Failed: ${JSON.stringify(result)}` }] };
      }

      // Summarize per-page results (strip match images)
      const pages = (result.pages ?? []).map((p: any) => ({
        pageNumber: p.pageNumber,
        totalCount: p.totalCount,
        matchCount: p.matches?.length ?? 0,
        errors: p.errors?.length ? p.errors : undefined,
      }));

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            grandTotal: result.grandTotal,
            pageCount: result.pageCount,
            documentId,
            threshold,
            crossScale,
            pages,
          }, null, 2),
        }],
      };
    }
  );

  // ── findSymbolCandidates ─────────────────────────────────
  server.tool(
    "findSymbolCandidates",
    `Automatically discover symbol-like elements on a drawing page using computer vision (connected component analysis). Returns bounding boxes of candidate symbols WITHOUT needing a template — useful for exploring a drawing when you don't know what symbols exist.

WHEN TO USE:
- When you need to find symbols on a drawing but don't have a specific template yet
- When a user asks "what symbols are on this page?" or "find all instruments"
- As a discovery step before running countSymbols — find candidates, visually verify them with zoomDrawingRegion, then count

INPUTS:
- documentId: Document ID from listDrawingPages
- pageNumber: Page to analyze (1-based, default 1)
- minSize: Minimum symbol dimension in pixels (default 20). Increase to skip text characters
- maxSize: Maximum symbol dimension in pixels (default 150). Decrease to skip large elements

OUTPUT: Array of candidates with {x, y, w, h, area, aspect} plus total count and image dimensions. Candidates are sorted by area (largest first) and filtered to exclude title block areas and borders.

TIPS:
- Set minSize=40 to skip individual text characters and find only real symbols
- Look for candidates that are roughly square (aspect 0.5-2.0) — these are often instruments, valves, or markers
- Use zoomDrawingRegion to visually inspect interesting candidates before counting
- Cluster candidates by size bucket to identify symbol types (e.g. all ~80x80 candidates are likely the same symbol type)`,
    {
      documentId: z.string().describe("Document ID of the PDF drawing"),
      pageNumber: z.number().min(1).default(1).describe("Page number (1-based)"),
      minSize: z.number().default(20).describe("Minimum symbol dimension in pixels. Set to 40+ to skip text characters"),
      maxSize: z.number().default(150).describe("Maximum symbol dimension in pixels"),
    },
    async ({ documentId, pageNumber, minSize, maxSize }) => {
      const result = await apiPost("/api/vision/find-symbols", {
        projectId: getProjectId(),
        documentId,
        pageNumber,
        minSize,
        maxSize,
      });

      if (!result.success) {
        return { content: [{ type: "text" as const, text: `Failed: ${result.error ?? "unknown error"}` }] };
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            total: result.total,
            imageWidth: result.imageWidth,
            imageHeight: result.imageHeight,
            candidates: (result.candidates ?? []).slice(0, 30), // Cap at 30 to avoid context bloat
            note: result.total > 30 ? `Showing top 30 of ${result.total} candidates` : undefined,
          }, null, 2),
        }],
      };
    }
  );

  // ── scanDrawingSymbols ────────────────────────────────────
  server.tool(
    "scanDrawingSymbols",
    `Scan a drawing page to discover repeating symbol types automatically. Returns a compact structured inventory of symbol clusters with counts and locations.

WHEN TO USE: Use this only when a project document/RFQ/spec makes a specific drawing sheet relevant to a quantity or coverage question. Do NOT run it once on a random drawing just to satisfy a workflow checkbox. First identify the drawing/purpose with readDocumentText, schedules, title blocks, or listDrawingPages, then scan the relevant page.

INPUTS:
- documentId: Document ID from listDrawingPages
- pageNumber: Page to scan (1-based, default 1)
- maxClusters: Limit returned clusters. Default 20 keeps responses small.
- includeImage: Default false. Set true only when you need the rendered page image in the tool response.

OUTPUT: A structured inventory with:
- clusters: Array of symbol types found, each containing:
  - id: Cluster identifier
  - sizeCategory: "small", "medium", or "large"
  - avgDimensions: Average width and height of symbols in this cluster
  - matchCount: How many instances of this symbol were found on the page
  - avgConfidence: Average template matching confidence (0-1)
  - representativeBox: Bounding box of the best example (use as bbox for countSymbols if you need to refine)
  - topMatches: Up to 3 match locations with coordinates and confidence
- imageWidth, imageHeight: The coordinate space (150 DPI) — use these if you call countSymbols to refine
- totalClusters: Number of distinct symbol types found
- totalSymbolsFound: Total symbol instances across all clusters

WORKFLOW:
1. Choose a relevant sheet/page based on the scope question.
2. Call scanDrawingSymbols with includeImage=false for a compact inventory.
3. Interpret each cluster: "Cluster 0 is valve tags (medium, 110x42, 46 found)" etc.
4. If the user asked about specific symbols, find the matching cluster and report its count.
5. If you need to refine a count (different threshold, cross-scale, etc.), call countSymbols with that cluster's representativeBox.
6. If you need visual confirmation, call renderDrawingPage or scanDrawingSymbols with includeImage=true for the specific page only.

WHAT THIS REPLACES:
- You no longer need to: renderDrawingPage → zoom → zoom → zoom → zoom → countSymbols
- Instead: scanDrawingSymbols → done (or → countSymbols for refinement)
- This is 10x faster and finds symbols you might miss visually

Avg scan time 2-5 seconds per page.`,
    {
      documentId: z.string().describe("Document ID of the PDF drawing"),
      pageNumber: z.number().min(1).default(1).describe("Page number to scan (1-based)"),
      maxClusters: z.number().min(1).max(100).default(20).describe("Maximum number of clusters to return; keeps tool output compact"),
      includeImage: z.boolean().default(false).describe("Include the rendered page image. Defaults false to avoid huge base64/image payloads."),
    },
    async ({ documentId, pageNumber, maxClusters, includeImage }) => {
      const scanResult = await apiPost("/api/vision/scan-drawing", {
        projectId: getProjectId(),
        documentId,
        pageNumber,
      });

      const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];

      if (includeImage) {
        const renderResult = await apiPost("/api/vision/render-page", {
          projectId: getProjectId(),
          documentId,
          pageNumber,
          dpi: 150,
        });

        if (renderResult.success && renderResult.image) {
          const base64Match = (renderResult.image as string).match(/^data:image\/png;base64,(.+)$/);
          if (base64Match) {
            content.push({
              type: "image" as const,
              data: base64Match[1],
              mimeType: "image/png" as const,
            });
          }
        }
      }

      if (!scanResult.success) {
        content.push({
          type: "text" as const,
          text: `Scan failed: ${scanResult.error ?? JSON.stringify(scanResult)}`,
        });
        return { content };
      }

      // Format cluster data (strip thumbnails to save context, keep structure)
      const clusters = (scanResult.clusters ?? []).map((c: any) => ({
        id: c.id,
        sizeCategory: c.sizeCategory,
        avgDimensions: c.avgDimensions,
        matchCount: c.matchCount,
        avgConfidence: c.avgConfidence,
        representativeBox: {
          ...c.representativeBox,
          imageWidth: scanResult.imageWidth,
          imageHeight: scanResult.imageHeight,
        },
        topMatches: (c.topMatches ?? []).slice(0, 3),
      })).slice(0, maxClusters);
      const omittedClusters = Math.max(0, Number(scanResult.totalClusters ?? 0) - clusters.length);

      content.push({
        type: "text" as const,
        text: JSON.stringify({
          totalClusters: scanResult.totalClusters,
          totalSymbolsFound: scanResult.totalSymbolsFound,
          returnedClusters: clusters.length,
          omittedClusters,
          imageWidth: scanResult.imageWidth,
          imageHeight: scanResult.imageHeight,
          scanDuration_ms: scanResult.scanDuration_ms,
          documentId,
          pageNumber,
          clusters,
          note: includeImage
            ? "Each cluster represents a distinct symbol type. Use representativeBox with countSymbols if you need to refine the count."
            : "Compact response: no page image returned. Set includeImage=true or call renderDrawingPage only when visual confirmation is necessary. Use representativeBox with countSymbols if you need to refine a count.",
        }, null, 2),
      });

      return { content };
    }
  );

  // ── detectScale ────────────────────────────────────────────
  server.tool(
    "detectScale",
    `Render a drawing page and extract the title block area to detect the drawing scale.

WHEN TO USE: Before measuring distances on a drawing with measureLinear. The title block (usually bottom-right corner) contains scale information like "1/4" = 1'-0"", "1:50", or "SCALE: 1"=20'". This tool renders that area at high resolution so you can read the scale notation.

INPUTS:
- documentId: Document ID from listDrawingPages
- pageNumber: Page number (default 1). For multi-page drawing sets, each page may have a different scale

OUTPUT: A high-resolution image of the title block region plus metadata (page dimensions, image dimensions). YOU must visually read the scale from the image and calculate the pixelsPerUnit calibration for measureLinear.

HOW TO CALCULATE CALIBRATION: If the scale is "1/4" = 1'-0"" and the image was rendered at 150 DPI:
- 1/4" on paper = 150 * 0.25 = 37.5 pixels
- 1/4" represents 1 foot
- So pixelsPerUnit = 37.5 pixels per foot

COMMON PITFALLS:
- Title blocks are usually in the bottom-right corner, but not always — if the tool doesn't find scale info, try renderDrawingPage and look manually
- Some drawings have multiple scales (e.g. "PLAN: 1/4" = 1'-0"", "DETAIL: 1" = 1'-0"") — use the one relevant to your measurement area
- The scale may be for the original print size (e.g. "24x36") — the DPI factor matters`,
    {
      documentId: z.string().describe("Document ID of the PDF drawing"),
      pageNumber: z.number().min(1).default(1).describe("Page number (1-based)"),
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
    `Measure a linear distance on a drawing between two points using calibration.

WHEN TO USE: After establishing calibration (via detectScale or a known dimension), use this to measure real-world distances between any two points on the drawing. Works for walls, pipes, cable runs, duct lengths, etc.

INPUTS:
- pointA, pointB: Start and end points in renderDrawingPage image coordinates (pixels)
- pixelsPerUnit: Calibration factor — how many pixels equal one real-world unit. Calculate this from the drawing scale (see detectScale)
- unit: The real-world unit (ft, in, m, cm, etc.)

OUTPUT: pixelDistance (raw pixel distance), realDistance (calibrated real-world distance), and the unit.

HOW TO USE:
1. Call detectScale to find the drawing scale
2. Calculate pixelsPerUnit from the scale and DPI
3. Call measureLinear with two points and the calibration

COMMON PITFALLS:
- Points must be in renderDrawingPage coordinate space
- Make sure pixelsPerUnit matches the DPI of the image you measured points from
- For angled measurements, the tool calculates the true hypotenuse distance, not just horizontal or vertical
- Double-check calibration by measuring a known dimension first (e.g. a labeled wall length)`,
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
}
