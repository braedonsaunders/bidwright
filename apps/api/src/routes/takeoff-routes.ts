import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDwgProcessingResult } from "../services/dwg-processing-service.js";
import { detectTitleBlockScale } from "../services/titleblock-scale-service.js";
import { extractLegendFromPage } from "../services/symbol-legend-service.js";
import { suggestLineItemsForAnnotation } from "../services/auto-takeoff-service.js";
import { interruptAndResumeSession } from "../services/cli-runtime.js";
import { resolveProjectDir } from "../paths.js";

// Map MIME type → file extension for photos persisted to disk so the
// agent's Read tool can pick the right loader. Keep this list aligned
// with site-photo-intake's ACCEPTED_TYPES on the client.
const PHOTO_MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/tiff": "tiff",
  "image/tif": "tiff",
};

// Azure Document Intelligence creds come exclusively from organisation
// Settings > Integrations. There is no env-var fallback — configure them
// in the UI.
async function resolveAzureConfig(
  request: FastifyRequest,
): Promise<{ endpoint?: string; key?: string }> {
  try {
    const settings = await request.store!.getSettings();
    const integrations = (settings.integrations ?? {}) as {
      azureDiEndpoint?: string;
      azureDiKey?: string;
    };
    return {
      endpoint: integrations.azureDiEndpoint || undefined,
      key: integrations.azureDiKey || undefined,
    };
  } catch {
    return {};
  }
}

export async function takeoffRoutes(app: FastifyInstance) {
  // ── GET /api/takeoff/:projectId/documents/:documentId/dwg-metadata ───
  // Server-side DXF/DWG intake processing for CAD takeoff. DXF is parsed
  // directly; binary DWG uses the optional BIDWRIGHT_DWG_CONVERTER_CMD
  // adapter, then persists entity/layer/layout metadata in SourceDocument.
  app.get("/api/takeoff/:projectId/documents/:documentId/dwg-metadata", async (request, reply) => {
    const { projectId, documentId } = request.params as { projectId: string; documentId: string };
    const query = request.query as { refresh?: string; sourceKind?: string };
    try {
      return await getDwgProcessingResult(projectId, documentId, {
        refresh: query.refresh === "1" || query.refresh === "true",
        sourceKind: query.sourceKind === "file_node" ? "file_node" : "source_document",
      });
    } catch (error) {
      const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 500;
      return reply.code(statusCode).send({
        message: error instanceof Error ? error.message : "DWG processing failed",
        result: (error as { result?: unknown }).result,
      });
    }
  });

  // ── POST /api/takeoff/:projectId/documents/:documentId/process-dwg ────
  app.post("/api/takeoff/:projectId/documents/:documentId/process-dwg", async (request, reply) => {
    const { projectId, documentId } = request.params as { projectId: string; documentId: string };
    const query = request.query as { sourceKind?: string };
    try {
      return await getDwgProcessingResult(projectId, documentId, {
        refresh: true,
        sourceKind: query.sourceKind === "file_node" ? "file_node" : "source_document",
      });
    } catch (error) {
      const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 500;
      return reply.code(statusCode).send({
        message: error instanceof Error ? error.message : "DWG processing failed",
        result: (error as { result?: unknown }).result,
      });
    }
  });

  // ── POST /api/takeoff/:projectId/documents/:documentId/detect-scale ──
  // OCRs the page via Azure Document Intelligence and parses the text for
  // standard scale notations like "1:50" or "1/4\" = 1'-0\"".
  app.post("/api/takeoff/:projectId/documents/:documentId/detect-scale", async (request, reply) => {
    const { projectId, documentId } = request.params as { projectId: string; documentId: string };
    const body = (request.body ?? {}) as { pageNumber?: number };
    const pageNumber = body.pageNumber ?? 1;
    try {
      const azureConfig = await resolveAzureConfig(request);
      const result = await detectTitleBlockScale(projectId, documentId, pageNumber, azureConfig);
      return result;
    } catch (err) {
      return reply.code(500).send({ message: err instanceof Error ? err.message : "Detect failed" });
    }
  });

  // ── POST /api/takeoff/:projectId/documents/:documentId/extract-legend ──
  // Runs Azure DI prebuilt-layout on the page, then heuristically pairs
  // short-token cells with description cells to recover the drawing's
  // legend / symbol schedule.
  app.post("/api/takeoff/:projectId/documents/:documentId/extract-legend", async (request, reply) => {
    const { projectId, documentId } = request.params as { projectId: string; documentId: string };
    const body = (request.body ?? {}) as { pageNumber?: number };
    const pageNumber = body.pageNumber ?? 1;
    try {
      const azureConfig = await resolveAzureConfig(request);
      const result = await extractLegendFromPage(projectId, documentId, pageNumber, azureConfig);
      return result;
    } catch (err) {
      return reply.code(500).send({ message: err instanceof Error ? err.message : "Legend extraction failed" });
    }
  });

  // ── POST /api/takeoff/:projectId/annotations/:annotationId/suggest-line-items ──
  // Asks the LLM to match a takeoff annotation against the org's catalog
  // and rate-schedule items. Returns ranked line-item suggestions the user
  // can drop into a worksheet with one click.
  app.post(
    "/api/takeoff/:projectId/annotations/:annotationId/suggest-line-items",
    async (request, reply) => {
      const { projectId, annotationId } = request.params as {
        projectId: string;
        annotationId: string;
      };
      try {
        const result = await suggestLineItemsForAnnotation(projectId, annotationId);
        return result;
      } catch (err) {
        return reply.code(500).send({
          message: err instanceof Error ? err.message : "Suggestion failed",
        });
      }
    },
  );

  // ── GET /api/takeoff/:projectId/annotations ───────────────────────────
  app.get("/api/takeoff/:projectId/annotations", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const query = request.query as { documentId?: string; page?: string };
    try {
      const annotations = await request.store!.listTakeoffAnnotations(
        projectId,
        query.documentId,
        query.page !== undefined ? parseInt(query.page, 10) : undefined,
      );
      return annotations;
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : "Not found" });
    }
  });

  // ── POST /api/takeoff/:projectId/annotations ──────────────────────────
  app.post("/api/takeoff/:projectId/annotations", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = request.body as Record<string, unknown>;
    try {
      const annotation = await request.store!.createTakeoffAnnotation(projectId, body as any);
      reply.code(201);
      return annotation;
    } catch (error) {
      console.error("[takeoff:create] Failed:", error instanceof Error ? error.message : error);
      console.error("[takeoff:create] Body:", JSON.stringify(body, null, 2));
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Bad request" });
    }
  });

  // ── PATCH /api/takeoff/:projectId/annotations/:annotationId ───────────
  app.patch("/api/takeoff/:projectId/annotations/:annotationId", async (request, reply) => {
    const { annotationId } = request.params as { projectId: string; annotationId: string };
    const body = request.body as Record<string, unknown>;
    try {
      const annotation = await request.store!.updateTakeoffAnnotation(annotationId, body as any);
      return annotation;
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : "Not found" });
    }
  });

  // ── DELETE /api/takeoff/:projectId/annotations/:annotationId ──────────
  app.delete("/api/takeoff/:projectId/annotations/:annotationId", async (request, reply) => {
    const { annotationId } = request.params as { projectId: string; annotationId: string };
    try {
      await request.store!.deleteTakeoffAnnotation(annotationId);
      return { deleted: true };
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : "Not found" });
    }
  });

  // ── Takeoff Links (Annotation ↔ Line Item) ────────────────────────────

  // ── GET /api/takeoff/:projectId/links ─────────────────────────────────
  app.get("/api/takeoff/:projectId/links", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const query = request.query as { annotationId?: string; worksheetItemId?: string };
    try {
      return await request.store!.listTakeoffLinks(projectId, query.annotationId, query.worksheetItemId);
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : "Not found" });
    }
  });

  // ── POST /api/takeoff/:projectId/links ────────────────────────────────
  app.post("/api/takeoff/:projectId/links", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = request.body as Record<string, unknown>;
    try {
      const link = await request.store!.createTakeoffLink(projectId, body as any);
      reply.code(201);
      return link;
    } catch (error) {
      console.error("[takeoff-link:create] Failed:", error instanceof Error ? error.message : error);
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Bad request" });
    }
  });

  // ── PATCH /api/takeoff/:projectId/links/:linkId ───────────────────────
  app.patch("/api/takeoff/:projectId/links/:linkId", async (request, reply) => {
    const { linkId } = request.params as { projectId: string; linkId: string };
    const body = request.body as Record<string, unknown>;
    try {
      return await request.store!.updateTakeoffLink(linkId, body as any);
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : "Not found" });
    }
  });

  // ── DELETE /api/takeoff/:projectId/links/:linkId ──────────────────────
  app.delete("/api/takeoff/:projectId/links/:linkId", async (request, reply) => {
    const { linkId } = request.params as { projectId: string; linkId: string };
    try {
      await request.store!.deleteTakeoffLink(linkId);
      return { deleted: true };
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : "Not found" });
    }
  });

  // ── DWG Entity Links (CAD Entity ↔ Line Item) ─────────────────────────

  // ── GET /api/takeoff/:projectId/dwg-links ─────────────────────────────
  app.get("/api/takeoff/:projectId/dwg-links", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const query = request.query as {
      documentId?: string;
      entityId?: string;
      worksheetItemId?: string;
    };
    try {
      return await request.store!.listDwgEntityLinks(projectId, {
        documentId: query.documentId,
        entityId: query.entityId,
        worksheetItemId: query.worksheetItemId,
      });
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : "Not found" });
    }
  });

  // ── POST /api/takeoff/:projectId/dwg-links ────────────────────────────
  app.post("/api/takeoff/:projectId/dwg-links", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = request.body as Record<string, unknown>;
    try {
      const link = await request.store!.createDwgEntityLink(projectId, body as any);
      reply.code(201);
      return link;
    } catch (error) {
      console.error("[dwg-link:create] Failed:", error instanceof Error ? error.message : error);
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Bad request" });
    }
  });

  // ── DELETE /api/takeoff/:projectId/dwg-links/:linkId ──────────────────
  app.delete("/api/takeoff/:projectId/dwg-links/:linkId", async (request, reply) => {
    const { linkId } = request.params as { projectId: string; linkId: string };
    try {
      await request.store!.deleteDwgEntityLink(linkId);
      return { deleted: true };
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : "Not found" });
    }
  });

  // ── POST /api/takeoff/:projectId/photo-bom ────────────────────────────
  //
  // Hand site photos off to the project's configured agent runtime. The
  // agent already runs every other AI workflow in the estimate; instead
  // of duplicating that path with a separate direct-LLM vision call (and
  // a separate API-key contract), we save the photos under the project's
  // working dir and inject a prompt into the agent session telling it to
  // read them and create worksheet items via the createWorksheetItem MCP
  // tool. The agent handles vision via whatever auth the CLI is using —
  // OAuth, stored key, whatever — no separate vision adapter needed here.
  //
  // If the agent session isn't running, the photos are still persisted
  // and the response is { status: "needs-agent-session" } so the UI can
  // tell the estimator to start the agent without losing their uploads.
  app.post("/api/takeoff/:projectId/photo-bom", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };

    const bodySchema = z.object({
      images: z
        .array(
          z.object({
            data: z.string().min(8, "Image data is required"),
            mimeType: z.string().min(3),
            caption: z.string().max(500).optional(),
          }),
        )
        .min(1, "At least one image is required")
        .max(8, "At most 8 images per request"),
      focusPrompt: z.string().max(2000).optional(),
      projectContext: z.array(z.string().max(500)).max(20).optional(),
      worksheetId: z.string().min(1, "worksheetId is required"),
      categoryId: z.string().min(1, "categoryId is required"),
    });

    const parsed = bodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: parsed.error.message });
    }

    try {
      const project = await request.store!.getProject(projectId);
      if (!project) return reply.code(404).send({ message: "Project not found" });

      // Look up worksheet + category names for the prompt so the agent
      // (and the run log the user reads later) gets readable context.
      const workspace = await request.store!.getWorkspace(projectId);
      const worksheet = workspace?.worksheets?.find((w: { id: string }) => w.id === parsed.data.worksheetId);
      if (!worksheet) {
        return reply.code(400).send({ message: "Target worksheet not found in this project." });
      }
      const categories = await request.store!.listEntityCategories();
      const category = (categories as Array<{ id: string; name: string }>).find(
        (c) => c.id === parsed.data.categoryId,
      );
      if (!category) {
        return reply.code(400).send({ message: "Target category not found in this project." });
      }

      // Persist the photos under <projectDir>/.bidwright/photo-bom/<runId>/.
      // The agent's CWD is the project dir, so the prompt can reference
      // these by their project-relative path and Read will find them.
      const runId = `photo-bom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const projectDir = resolveProjectDir(projectId);
      const photoDirRel = path.posix.join(".bidwright", "photo-bom", runId);
      const photoDirAbs = path.join(projectDir, ".bidwright", "photo-bom", runId);
      await mkdir(photoDirAbs, { recursive: true });

      const savedPhotos: { relPath: string; mimeType: string; caption?: string }[] = [];
      for (let i = 0; i < parsed.data.images.length; i++) {
        const image = parsed.data.images[i];
        const commaIdx = image.data.indexOf(",");
        const base64 = image.data.startsWith("data:") && commaIdx > 0
          ? image.data.slice(commaIdx + 1)
          : image.data;
        const ext = PHOTO_MIME_TO_EXT[image.mimeType.toLowerCase()] ?? "jpg";
        const fileName = `photo-${String(i + 1).padStart(2, "0")}.${ext}`;
        const filePathAbs = path.join(photoDirAbs, fileName);
        await writeFile(filePathAbs, Buffer.from(base64, "base64"));
        savedPhotos.push({
          relPath: path.posix.join(photoDirRel, fileName),
          mimeType: image.mimeType,
          caption: image.caption,
        });
      }

      const promptLines = [
        "SITE PHOTO BOM REQUEST",
        "",
        `The estimator just dropped ${savedPhotos.length} site photo${savedPhotos.length === 1 ? "" : "s"} into ${photoDirRel}/.`,
        `Each photo is captured below by its project-relative path:`,
        ...savedPhotos.map((p, idx) => {
          const captionPart = p.caption ? ` — caption: ${p.caption.replace(/\n/g, " ")}` : "";
          return `  ${idx + 1}. ${p.relPath}${captionPart}`;
        }),
        "",
        parsed.data.focusPrompt?.trim()
          ? `Estimator focus / measurement hints:\n${parsed.data.focusPrompt.trim()}`
          : "(no additional focus prompt)",
        "",
        ...(parsed.data.projectContext?.length
          ? ["Project context:", ...parsed.data.projectContext.map((line) => `  - ${line}`), ""]
          : []),
        "Task:",
        `  1. Read each photo file using your Read tool.`,
        `  2. Identify the construction scope visible — work items, quantities, materials, conditions.`,
        `  3. For each distinct line item, call createWorksheetItem against:`,
        `       worksheetId: ${worksheet.id}   (named "${worksheet.name}")`,
        `       categoryId:  ${category.id}    (named "${category.name}")`,
        `     Populate entityName, description, quantity, uom, and sourceNotes that name the source photos`,
        `     by their relative paths above so the line stays auditable.`,
        `  4. When you've created the items, post a one-paragraph summary describing what you found and any`,
        `     uncertainty. Do not invent measurements; if a photo is ambiguous, say so and lower the qty or`,
        `     skip the item entirely.`,
        "",
        "Do NOT recreate worksheets, packages, or items that already exist. Only add new line items derived",
        "from these photos.",
      ];
      const prompt = promptLines.join("\n");

      const reason = `Site photo BOM (${savedPhotos.length} photo${savedPhotos.length === 1 ? "" : "s"})`;
      const result = await interruptAndResumeSession(projectId, prompt, reason);

      if (result.interrupted || result.resumed) {
        return reply.send({
          status: "handed-off" as const,
          runId,
          photosSaved: savedPhotos.length,
          message:
            `Sent ${savedPhotos.length} photo${savedPhotos.length === 1 ? "" : "s"} to the agent. ` +
            `Watch the agent chat panel for progress.`,
        });
      }

      // The agent isn't running. Photos are saved; tell the user to start
      // the agent and re-run instead of failing with a generic error.
      return reply.send({
        status: "needs-agent-session" as const,
        runId,
        photosSaved: savedPhotos.length,
        message:
          `Saved ${savedPhotos.length} photo${savedPhotos.length === 1 ? "" : "s"} to ${photoDirRel}. ` +
          `Start the agent for this project (Agent panel → Start), then re-run to hand them off.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Photo takeoff hand-off failed";
      request.log.error({ err: error }, "photo-bom hand-off failed");
      return reply.code(500).send({ message });
    }
  });
}
