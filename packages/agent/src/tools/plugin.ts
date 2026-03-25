import { z } from "zod";
import type { Tool, ToolExecutionContext, ToolResult, ToolParameter } from "../types.js";
import { apiFetch } from "./api-fetch.js";

// ── Local type shapes ─────────────────────────────────────────────────
// Minimal structural types matching the domain types.
// Defined locally to avoid cross-package rootDir TS issues.

interface PParam {
  name: string;
  type: string;
  description: string;
  required: boolean;
  enum?: string[];
  default?: unknown;
}

interface PToolDef {
  id: string;
  name: string;
  description: string;
  llmDescription?: string;
  parameters: PParam[];
  outputType: string;
  requiresConfirmation?: boolean;
  mutates?: boolean;
  tags?: string[];
  ui?: { sections: Array<{ id: string; type: string; label?: string; fields?: unknown[]; table?: unknown; scoring?: unknown }> };
}

interface PInfo {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  llmDescription?: string;
  enabled: boolean;
  toolDefinitions: PToolDef[];
  defaultOutputType?: string;
  supportedCategories?: string[];
  tags?: string[];
}

// ── Factory ───────────────────────────────────────────────────────────

type ApiExecutor = (
  pluginId: string, toolId: string, projectId: string, revisionId: string,
  input: Record<string, unknown>,
  opts?: { executedBy?: "user" | "agent"; agentSessionId?: string },
) => Promise<{ output: unknown; id: string }>;

function toZod(type: string): z.ZodTypeAny {
  switch (type) {
    case "number": return z.number();
    case "boolean": return z.boolean();
    case "object": return z.record(z.unknown());
    case "array": return z.array(z.unknown());
    default: return z.string();
  }
}

function makeSchema(params: PParam[]): z.ZodType {
  if (params.length === 0) return z.object({});
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const p of params) {
    let field: z.ZodTypeAny = p.enum && p.type === "string"
      ? z.enum(p.enum as [string, ...string[]]).describe(p.description)
      : toZod(p.type).describe(p.description);
    if (!p.required) field = field.optional();
    if (p.default !== undefined) field = field.default(p.default);
    shape[p.name] = field;
  }
  return z.object(shape);
}

function toToolParams(params: PParam[]): ToolParameter[] {
  return params.map((p) => ({
    name: p.name,
    type: (p.type === "number" ? "number" : p.type === "boolean" ? "boolean" : "string") as ToolParameter["type"],
    description: p.description, required: p.required, enum: p.enum, default: p.default,
  }));
}

function makeTool(pi: PInfo, td: PToolDef, exec: ApiExecutor): Tool {
  return {
    definition: {
      id: `plugin.${pi.slug}.${td.id}`,
      name: td.name,
      category: "dynamic",
      description: td.llmDescription ?? td.description,
      parameters: toToolParams(td.parameters),
      inputSchema: makeSchema(td.parameters),
      requiresConfirmation: td.requiresConfirmation ?? false,
      mutates: td.mutates ?? true,
      tags: ["plugin", pi.slug, pi.category, ...(td.tags ?? []), ...(pi.tags ?? [])],
    },
    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
      const start = Date.now();
      try {
        const r = await exec(pi.id, td.id, context.projectId, context.revisionId, input,
          { executedBy: "agent", agentSessionId: context.sessionId });
        return { success: true, data: r.output, sideEffects: [`Executed: ${td.name}`, `ID: ${r.id}`], duration_ms: Date.now() - start };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error), duration_ms: Date.now() - start };
      }
    },
  };
}

/** Convert all enabled plugins into agent Tools. */
export function createPluginTools(plugins: PInfo[], executor: ApiExecutor): Tool[] {
  const tools: Tool[] = [];
  for (const p of plugins) {
    if (!p.enabled) continue;
    for (const td of p.toolDefinitions) tools.push(makeTool(p, td, executor));
  }
  return tools;
}

// ── Discovery Tools ───────────────────────────────────────────────────

function sysTool(
  def: { id: string; name: string; description: string; inputSchema: z.ZodType; tags: string[] },
  op: (ctx: ToolExecutionContext, input: Record<string, unknown>) => Promise<ToolResult>,
): Tool {
  return {
    definition: { id: def.id, name: def.name, category: "system", description: def.description, parameters: [], inputSchema: def.inputSchema, requiresConfirmation: false, mutates: false, tags: def.tags },
    async execute(input: Record<string, unknown>, context: ToolExecutionContext) {
      const start = Date.now();
      try { const r = await op(context, input); return { ...r, duration_ms: Date.now() - start }; }
      catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error), duration_ms: Date.now() - start }; }
    },
  };
}

// ── Plugin Management Tools (static, use apiFetch) ───────────────────

type PluginMgmtResult = { success: boolean; data?: unknown; error?: string; sideEffects?: string[] };

function pluginMgmtTool(def: {
  id: string; name: string; description: string; inputSchema: z.ZodType;
  requiresConfirmation?: boolean; mutates?: boolean; tags: string[];
}, op: (ctx: ToolExecutionContext, input: Record<string, unknown>) => Promise<PluginMgmtResult>): Tool {
  return {
    definition: { id: def.id, name: def.name, category: "system", description: def.description, parameters: [], inputSchema: def.inputSchema, requiresConfirmation: def.requiresConfirmation ?? false, mutates: def.mutates ?? false, tags: def.tags },
    async execute(input: Record<string, unknown>, context: ToolExecutionContext) {
      const start = Date.now();
      try { const r = await op(context, input); return { ...r, duration_ms: Date.now() - start }; }
      catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error), duration_ms: Date.now() - start }; }
    },
  };
}

const pluginToolDefSchema = z.object({
  id: z.string().describe("Unique tool ID within the plugin"),
  name: z.string().describe("Tool display name"),
  description: z.string().describe("What this tool does"),
  llmDescription: z.string().optional().describe("Richer description for LLM discovery"),
  parameters: z.array(z.object({
    name: z.string(), type: z.string(), description: z.string(), required: z.boolean(),
    enum: z.array(z.string()).optional(), default: z.unknown().optional(),
  })).default([]).describe("Tool input parameters"),
  outputType: z.enum(["line_items", "worksheet", "text_content", "revision_patch", "score", "modifier", "summary", "composite"]).describe("Output type"),
  requiresConfirmation: z.boolean().optional().default(false),
  mutates: z.boolean().optional().default(true),
  tags: z.array(z.string()).optional(),
  ui: z.record(z.unknown()).optional().describe("Declarative UI schema (sections, fields, tables, scoring)"),
});

export const pluginManagementTools: Tool[] = [
  pluginMgmtTool({
    id: "plugins.create", name: "Create Plugin",
    description: "Create a new plugin with tool definitions, UI schemas, and configuration. Plugins extend the estimation system with custom calculators, lookups, and scoring tools. Each plugin contains one or more tool definitions with optional declarative UI schemas (fields, tables, scoring sections). Use plugins.list first to check if a similar plugin already exists.",
    inputSchema: z.object({
      name: z.string().describe("Plugin name"),
      slug: z.string().describe("URL-safe slug (e.g. 'neca-labour')"),
      category: z.enum(["labour", "equipment", "material", "travel", "general", "dynamic"]).describe("Plugin category"),
      description: z.string().describe("Short description"),
      llmDescription: z.string().optional().describe("Richer LLM context for tool discovery"),
      icon: z.string().optional().describe("Icon name (e.g. 'HardHat', 'Droplets')"),
      version: z.string().optional().default("1.0.0"),
      tags: z.array(z.string()).optional(),
      supportedCategories: z.array(z.string()).optional().describe("Quote item categories this plugin supports (e.g. ['Labour'])"),
      config: z.record(z.unknown()).optional().default({}).describe("Plugin-level config (API keys, defaults)"),
      configSchema: z.array(z.record(z.unknown())).optional().describe("Config field definitions"),
      toolDefinitions: z.array(pluginToolDefSchema).min(1).describe("Tool definitions (at least one)"),
      documentation: z.string().optional().describe("Markdown documentation"),
    }),
    requiresConfirmation: true, mutates: true,
    tags: ["plugin", "create", "write"],
  }, async (ctx, input) => {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/plugins`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, enabled: true }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `Create failed (${res.status}): ${err}` };
    }
    const plugin = await res.json();
    return { success: true, data: plugin, sideEffects: [`Created plugin "${input.name}" with ${(input.toolDefinitions as any[]).length} tool(s)`] };
  }),

  pluginMgmtTool({
    id: "plugins.update", name: "Update Plugin",
    description: "Update an existing plugin. Supports partial updates — only include fields you want to change. Can update name, description, tools, config, enabled status, etc.",
    inputSchema: z.object({
      pluginId: z.string().describe("Plugin ID to update"),
      name: z.string().optional(),
      description: z.string().optional(),
      llmDescription: z.string().optional(),
      icon: z.string().optional(),
      enabled: z.boolean().optional(),
      tags: z.array(z.string()).optional(),
      config: z.record(z.unknown()).optional(),
      toolDefinitions: z.array(pluginToolDefSchema).optional(),
      documentation: z.string().optional(),
    }),
    requiresConfirmation: true, mutates: true,
    tags: ["plugin", "update", "write"],
  }, async (ctx, input) => {
    const { pluginId, ...patch } = input as any;
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/plugins/${pluginId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `Update failed (${res.status}): ${err}` };
    }
    const plugin = await res.json();
    return { success: true, data: plugin, sideEffects: [`Updated plugin "${(plugin as any).name}"`] };
  }),
];

/** Create system-level tools for plugin discovery. */
export function createPluginSystemTools(getAll: () => Promise<PInfo[]>): Tool[] {
  return [
    sysTool({
      id: "plugins.list", name: "List Available Plugins",
      description: "List all available plugins with their tools, categories, and status. Use this to discover estimation tools, product searches, and content generators.",
      inputSchema: z.object({ category: z.string().optional().describe("Filter: labour, equipment, material, travel, general"), enabledOnly: z.boolean().optional().default(true).describe("Only enabled") }),
      tags: ["plugin", "discovery", "meta"],
    }, async (_ctx, input) => {
      let pl = await getAll();
      if (input.category) pl = pl.filter((p) => p.category === input.category);
      if (input.enabledOnly !== false) pl = pl.filter((p) => p.enabled);
      return { success: true, data: pl.map((p) => ({ id: p.id, name: p.name, slug: p.slug, category: p.category, description: p.llmDescription ?? p.description, enabled: p.enabled, toolCount: p.toolDefinitions.length, tools: p.toolDefinitions.map((t) => ({ id: t.id, name: t.name, description: t.llmDescription ?? t.description, outputType: t.outputType, parameterCount: t.parameters.length })), supportedCategories: p.supportedCategories, tags: p.tags })), duration_ms: 0 };
    }),

    sysTool({
      id: "plugins.getToolDetails", name: "Get Plugin Tool Details",
      description: "Get detailed info about a specific plugin tool including parameters, output type, and UI schema.",
      inputSchema: z.object({ pluginId: z.string().describe("Plugin ID"), toolId: z.string().describe("Tool ID") }),
      tags: ["plugin", "discovery", "detail"],
    }, async (_ctx, input) => {
      const pl = await getAll();
      const p = pl.find((x) => x.id === input.pluginId);
      if (!p) return { success: false, error: `Plugin ${input.pluginId} not found`, duration_ms: 0 };
      const t = p.toolDefinitions.find((x) => x.id === input.toolId);
      if (!t) return { success: false, error: `Tool ${input.toolId} not found`, duration_ms: 0 };
      return { success: true, data: { plugin: { id: p.id, name: p.name, category: p.category }, tool: { id: t.id, name: t.name, description: t.llmDescription ?? t.description, outputType: t.outputType, parameters: t.parameters, requiresConfirmation: t.requiresConfirmation, mutates: t.mutates, hasUI: !!t.ui, uiSections: t.ui?.sections.map((s) => ({ id: s.id, type: s.type, label: s.label, fieldCount: Array.isArray(s.fields) ? s.fields.length : 0, hasTable: !!s.table, hasScoring: !!s.scoring })) } }, duration_ms: 0 };
    }),

    sysTool({
      id: "plugins.searchTools", name: "Search Plugin Tools",
      description: "Search across all plugin tools by keyword to find the right tool.",
      inputSchema: z.object({ query: z.string().describe("Search query") }),
      tags: ["plugin", "discovery", "search"],
    }, async (_ctx, input) => {
      const pl = await getAll();
      const q = String(input.query).toLowerCase();
      const results: Array<{ pluginId: string; pluginName: string; toolId: string; toolName: string; description: string; outputType: string; score: number }> = [];
      for (const p of pl) {
        if (!p.enabled) continue;
        for (const t of p.toolDefinitions) {
          let score = 0;
          const txt = [t.name, t.description, t.llmDescription ?? "", ...(t.tags ?? []), p.name, p.description, p.category, ...(p.tags ?? [])].join(" ").toLowerCase();
          for (const w of q.split(/\s+/)) { if (txt.includes(w)) score += 1; if (t.name.toLowerCase().includes(w)) score += 2; if ((t.tags ?? []).some((x) => x.includes(w))) score += 1.5; }
          if (score > 0) results.push({ pluginId: p.id, pluginName: p.name, toolId: t.id, toolName: t.name, description: t.llmDescription ?? t.description, outputType: t.outputType, score });
        }
      }
      results.sort((a, b) => b.score - a.score);
      return { success: true, data: { query: input.query, results: results.slice(0, 10) }, duration_ms: 0 };
    }),
  ];
}
