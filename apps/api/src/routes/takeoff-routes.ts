import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { getDwgProcessingResult } from "../services/dwg-processing-service.js";
import { detectTitleBlockScale } from "../services/titleblock-scale-service.js";
import { extractLegendFromPage } from "../services/symbol-legend-service.js";
import { suggestLineItemsForAnnotation } from "../services/auto-takeoff-service.js";
import { generatePhotoTakeoff } from "../services/photo-takeoff-service.js";

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
  // Site-photo intake: accept one or more base64-encoded photographs plus
  // an optional focus prompt and return a structured BOM the estimator can
  // review and convert into worksheet line items.
  //
  // Runtime-agnostic: the LLM provider/model is resolved via the same
  // getEffectiveIntegrations() chain every other AI feature uses — there is
  // no Claude-specific fallback. If the user has selected an OpenAI or
  // OpenRouter model with vision support, that's what gets called.
  app.post("/api/takeoff/:projectId/photo-bom", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };

    const bodySchema = z.object({
      images: z
        .array(
          z.object({
            // The client sends a data URL OR a raw base64 string. Either is
            // accepted — the server splits the prefix off before sending to
            // the adapter (which only wants the base64 payload).
            data: z.string().min(8, "Image data is required"),
            mimeType: z.string().min(3),
            caption: z.string().max(500).optional(),
          }),
        )
        .min(1, "At least one image is required")
        .max(8, "At most 8 images per request"),
      focusPrompt: z.string().max(2000).optional(),
      projectContext: z.array(z.string().max(500)).max(20).optional(),
    });

    const parsed = bodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: parsed.error.message });
    }

    // Declared outside the try so the catch block can echo them in the
    // error message. Populated by the resolution chain below.
    let provider = "";
    let model = "";
    try {
      // Verify the project exists / the user can see it before spending
      // tokens on the LLM.
      const project = await request.store!.getProject(projectId);
      if (!project) return reply.code(404).send({ message: "Project not found" });

      // Resolve effective LLM credentials. Resolves the API key BY provider
      // (anthropic→anthropicKey, gemini→geminiKey, ...) so a Gemini- or
      // OpenRouter-only setup doesn't dead-end on the anthropic check. If
      // the user only configured the agent runtime (claude-code / opencode
      // CLI) with a shared anthropic key, fall back through that runtime
      // to the matching direct adapter so the vision call still works
      // without forcing a second key field.
      const integrations = await request.store!.getEffectiveIntegrations(request.user?.id);
      const directProviders = new Set(["anthropic", "openai", "openrouter", "gemini", "lmstudio"]);
      const llmKeyByProvider: Record<string, string> = {
        anthropic: (integrations.anthropicKey as string | undefined) ?? process.env.ANTHROPIC_API_KEY ?? "",
        openai: (integrations.openaiKey as string | undefined) ?? process.env.OPENAI_API_KEY ?? "",
        openrouter: (integrations.openrouterKey as string | undefined) ?? process.env.OPENROUTER_API_KEY ?? "",
        gemini:
          (integrations.geminiKey as string | undefined) ??
          process.env.GEMINI_API_KEY ??
          process.env.GOOGLE_GENAI_API_KEY ??
          "",
        lmstudio: "lm-studio",
      };

      provider =
        typeof integrations.llmProvider === "string" && directProviders.has(integrations.llmProvider)
          ? integrations.llmProvider
          : "";
      if (!provider && typeof integrations.agentRuntime === "string") {
        const runtimeMap: Record<string, string> = {
          "claude-code": "anthropic",
          "opencode": "anthropic",
        };
        provider = runtimeMap[integrations.agentRuntime] ?? "";
      }
      if (!provider) {
        provider = process.env.LLM_PROVIDER ?? "";
        if (provider && !directProviders.has(provider)) provider = "";
      }
      if (!provider) {
        provider = (Object.entries(llmKeyByProvider).find(([, key]) => Boolean(key))?.[0]) ?? "anthropic";
      }

      const apiKey = llmKeyByProvider[provider] ?? "";
      // Vision-capable defaults per provider. The OpenRouter identifier
      // matches what the opencode CLI adapter uses, which is the format
      // OpenRouter actually serves (the older "anthropic/claude-sonnet-4"
      // returned "404 No endpoints found that support image input"
      // because it doesn't exist as a vision endpoint on the OpenRouter
      // model catalog).
      const defaultModelByProvider: Record<string, string> = {
        anthropic: "claude-sonnet-4-5",
        openai: "gpt-4o",
        openrouter: "anthropic/claude-sonnet-4-5",
        gemini: "gemini-2.0-flash",
        lmstudio: "lmstudio-community/Llama-3.2-11B-Vision-Instruct-GGUF",
      };
      model =
        ((integrations.llmModel as string | undefined)?.trim() ||
          undefined) ??
        process.env.LLM_MODEL ??
        defaultModelByProvider[provider] ??
        "claude-sonnet-4-5";

      if (!apiKey) {
        return reply.code(400).send({
          message:
            `No API key found for provider "${provider}". Open Settings > Integrations and either add an API key for ${provider} or pick a different LLM provider that has one.`,
        });
      }

      request.log.info({ provider, model }, "photo-bom resolved LLM config");

      // Organization category taxonomy. Passed into the LLM so it tags rows
      // with the user's actual category buckets instead of inventing one
      // (or worse, defaulting to a code system the org doesn't use).
      const categories = await request.store!.listEntityCategories();

      // Strip any "data:image/...;base64," prefix the browser may have sent.
      const normalizedImages = parsed.data.images.map((image) => {
        const commaIdx = image.data.indexOf(",");
        const payload = image.data.startsWith("data:") && commaIdx > 0
          ? image.data.slice(commaIdx + 1)
          : image.data;
        return {
          data: payload,
          mimeType: image.mimeType,
          caption: image.caption,
        };
      });

      const result = await generatePhotoTakeoff({
        images: normalizedImages,
        focusPrompt: parsed.data.focusPrompt,
        projectContext: parsed.data.projectContext,
        categories: (categories as Array<{ id: string; name: string; entityType: string; defaultUom?: string | null; shortform?: string | null }>).map((c) => ({
          id: c.id,
          name: c.name,
          entityType: c.entityType,
          defaultUom: c.defaultUom ?? "EA",
          shortform: c.shortform ?? null,
        })),
        llm: { provider, apiKey, model },
      });
      return result;
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "Photo takeoff failed";
      // Echo the resolved provider + model so the user can see what the
      // server actually sent without rummaging through server logs. The
      // OpenRouter "no endpoints support image input" failure mode in
      // particular is opaque without it.
      const llmContext = `provider=${provider}, model=${model}`;
      const message = rawMessage.includes(llmContext) ? rawMessage : `${rawMessage} (${llmContext})`;
      const status = rawMessage.includes("not configured") || rawMessage.includes("Settings >") ? 400 : 500;
      request.log.error({ err: error, provider, model }, "photo-bom failed");
      return reply.code(status).send({ message });
    }
  });
}
