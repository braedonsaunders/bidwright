import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { CreateUserInput, PrismaApiStore, UserPatchInput } from "../prisma-store.js";
import { testEmailConnection, type EmailConfig } from "../services/email-service.js";

const personaSchema = z.object({
  name: z.string().min(1),
  trade: z.string().default("mechanical"),
  description: z.string().default(""),
  systemPrompt: z.string().default(""),
  knowledgeBookIds: z.array(z.string()).default([]),
  knowledgeDocumentIds: z.array(z.string()).default([]),
  datasetTags: z.array(z.string()).default([]),
  packageBuckets: z.array(z.string()).default([]),
  defaultAssumptions: z.record(z.unknown()).default({}),
  productivityGuidance: z.record(z.unknown()).default({}),
  commercialGuidance: z.record(z.unknown()).default({}),
  reviewFocusAreas: z.array(z.string()).default([]),
  isDefault: z.boolean().default(false),
  enabled: z.boolean().default(true),
  order: z.number().int().default(0),
});

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/personas", async (request) => {
    return request.store!.listEstimatorPersonas();
  });

  app.post("/personas", async (request, reply) => {
    const parsed = personaSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return request.store!.createEstimatorPersona(parsed.data);
  });

  app.patch("/personas/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = personaSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return request.store!.updateEstimatorPersona(id, parsed.data);
  });

  app.delete("/personas/:id", async (request) => {
    const { id } = request.params as { id: string };
    await request.store!.deleteEstimatorPersona(id);
    return { deleted: true };
  });

  app.get("/settings", async (request) => request.store!.getSettings());

  app.patch("/settings", async (request) => {
    const patch = request.body as Record<string, unknown>;
    return request.store!.updateSettings(patch as Parameters<PrismaApiStore["updateSettings"]>[0]);
  });

  app.post("/settings/integrations/test-key", async (request, reply) => {
    const { provider, apiKey, baseUrl } = request.body as { provider: string; apiKey: string; baseUrl?: string };
    if (!provider) return reply.code(400).send({ success: false, message: "provider is required" });
    if (!apiKey && provider !== "lmstudio") return reply.code(400).send({ success: false, message: "apiKey is required" });
    try {
      let ok = false;
      if (provider === "anthropic") {
        const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        });
        ok = res.ok;
      } else if (provider === "openai") {
        const res = await fetch("https://api.openai.com/v1/models?limit=1", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        ok = res.ok;
      } else if (provider === "openrouter") {
        const res = await fetch("https://openrouter.ai/api/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        ok = res.ok;
      } else if (provider === "gemini") {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        ok = res.ok;
      } else if (provider === "lmstudio") {
        const url = baseUrl || "http://localhost:1234/v1";
        const res = await fetch(`${url}/models`);
        ok = res.ok;
      }
      if (ok) return { success: true, message: "Connection successful" };
      return reply.code(400).send({ success: false, message: "Invalid API key or connection failed" });
    } catch (err: any) {
      return reply.code(400).send({ success: false, message: err.message || "Connection failed" });
    }
  });

  app.post("/settings/integrations/models", async (request, reply) => {
    const { provider, apiKey, baseUrl } = request.body as { provider: string; apiKey: string; baseUrl?: string };
    if (!provider) return reply.code(400).send({ message: "provider is required" });
    try {
      let models: { id: string; name: string }[] = [];
      if (provider === "anthropic") {
        const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        });
        if (!res.ok) return reply.code(400).send({ message: "Failed to fetch models" });
        const data = await res.json() as { data: { id: string; display_name?: string }[] };
        models = (data.data || []).map((m) => ({ id: m.id, name: m.display_name || m.id }));
      } else if (provider === "openai") {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) return reply.code(400).send({ message: "Failed to fetch models" });
        const data = await res.json() as { data: { id: string }[] };
        models = (data.data || []).map((m) => ({ id: m.id, name: m.id }));
      } else if (provider === "openrouter") {
        const res = await fetch("https://openrouter.ai/api/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) return reply.code(400).send({ message: "Failed to fetch models" });
        const data = await res.json() as { data: { id: string; name?: string }[] };
        models = (data.data || []).map((m) => ({ id: m.id, name: m.name || m.id }));
      } else if (provider === "gemini") {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (!res.ok) return reply.code(400).send({ message: "Failed to fetch models" });
        const data = await res.json() as { models: { name: string; displayName?: string }[] };
        models = (data.models || []).map((m) => ({
          id: m.name.replace("models/", ""),
          name: m.displayName || m.name.replace("models/", ""),
        }));
      } else if (provider === "lmstudio") {
        const url = baseUrl || "http://localhost:1234/v1";
        const res = await fetch(`${url}/models`);
        if (!res.ok) return reply.code(400).send({ message: "Failed to fetch models" });
        const data = await res.json() as { data: { id: string }[] };
        models = (data.data || []).map((m) => ({ id: m.id, name: m.id }));
      }
      return { models };
    } catch (err: any) {
      return reply.code(400).send({ message: err.message || "Failed to fetch models" });
    }
  });

  app.get("/settings/brand", async (request) => {
    const settings = await request.store!.getSettings();
    return settings.brand;
  });

  app.patch("/settings/brand", async (request) => {
    const patch = request.body as Record<string, unknown>;
    const settings = await request.store!.getSettings();
    const merged = { ...settings.brand, ...patch };
    await request.store!.updateSettings({ brand: merged as any });
    return merged;
  });

  app.post("/settings/brand/capture", async (request, reply) => {
    const { websiteUrl } = request.body as { websiteUrl: string };
    if (!websiteUrl) return reply.code(400).send({ message: "websiteUrl is required" });

    const settings = await request.store!.getSettings();
    const provider = settings.integrations.llmProvider || "anthropic";
    const model = settings.integrations.llmModel || "claude-sonnet-4-20250514";
    const providerKeyMap: Record<string, string> = {
      anthropic: settings.integrations.anthropicKey,
      openai: settings.integrations.openaiKey,
      openrouter: settings.integrations.openrouterKey,
      gemini: settings.integrations.geminiKey,
      lmstudio: "lm-studio",
    };
    const apiKey = providerKeyMap[provider] || settings.integrations.anthropicKey || settings.integrations.openaiKey;

    if (!apiKey) return reply.code(400).send({ message: "No API key configured. Set an API key in Integrations settings first." });

    try {
      const { captureBrand } = await import("../services/brand-capture.js");
      const brand = await captureBrand(websiteUrl, { provider, apiKey, model });
      await request.store!.updateSettings({ brand: brand as any });
      return brand;
    } catch (err: any) {
      request.log.error({ err, websiteUrl }, "Brand capture failed");
      return reply.code(500).send({ message: err.message || "Brand capture failed" });
    }
  });

  app.post("/settings/test-email", async (request) => {
    const settings = await request.store!.getSettings();
    const email = settings.email;
    const config: EmailConfig = {
      host: email.host || "",
      port: email.port || 587,
      user: email.username || "",
      pass: email.password || "",
      from: email.fromAddress || "",
      fromName: email.fromName || "",
      authMethod: (email as any).authMethod || "smtp",
      oauth2TenantId: (email as any).oauth2TenantId || "",
      oauth2ClientId: (email as any).oauth2ClientId || "",
      oauth2ClientSecret: (email as any).oauth2ClientSecret || "",
    };
    return testEmailConnection(config);
  });

  app.get("/users", async (request) => {
    const users = await request.store!.listUsers();
    return users.map(({ passwordHash, ...u }: any) => u);
  });

  app.post("/users", async (request, reply) => {
    const body = request.body as CreateUserInput;
    if (!body.email || !body.name || !body.role) {
      return reply.code(400).send({ message: "email, name, and role are required" });
    }
    try {
      const user = await request.store!.createUser(body);
      const { passwordHash, ...safeUser } = user as any;
      reply.code(201);
      return safeUser;
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Create failed" });
    }
  });

  app.patch("/users/:userId", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const patch = request.body as UserPatchInput;
    try {
      const user = await request.store!.updateUser(userId, patch);
      const { passwordHash, ...safeUser } = user as any;
      return safeUser;
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : "User not found" });
    }
  });

  app.delete("/users/:userId", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    try {
      const user = await request.store!.deleteUser(userId);
      const { passwordHash, ...safeUser } = user as any;
      return safeUser;
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : "User not found" });
    }
  });
}
