import { z } from "zod";
import type { Tool, ToolDefinition, ToolExecutionContext, ToolParameter, ToolResult } from "../types.js";
import { apiFetch } from "./api-fetch.js";

/**
 * Integration tool registrar — separate namespace from plugins.
 *
 *   Agent tool id: `integration.{slug}.{actionId}`
 *   Agent tool category: "integration"
 *   Agent tool tags: ["integration", slug, manifestCategory, ...actionTags]
 *
 * Integrations differ from plugins in three ways:
 *   1. They talk to outside systems, not the worksheet.
 *   2. They never appear in the workspace plugin flyout.
 *   3. They share a single execution endpoint (`/integrations/:id/actions/:actionId`)
 *      that handles credential decryption, retry, and audit server-side.
 *
 * The agent loop calls these tools through `apiFetch` so all auth, rate
 * limiting, and tenancy are enforced by the API.
 */

interface ActionParam {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required: boolean;
  enum?: string[];
  default?: unknown;
}

interface ActionInfo {
  id: string;
  name: string;
  description: string;
  llmDescription?: string;
  input: ActionParam[];
  mutates: boolean;
  requiresConfirmation: boolean;
  tags: string[];
}

export interface IntegrationToolBinding {
  /** Integration row id (cuid). */
  integrationId: string;
  /** Slug from the Integration row — used in the tool id. */
  slug: string;
  /** Display name of the integration (e.g. "Slack — Production"). */
  displayName: string;
  /** Manifest category (e.g. "crm", "comms"). Used as a tag. */
  category: string;
  /** Action descriptor pulled from manifest.capabilities.actions. */
  action: ActionInfo;
}

function toZod(type: ActionParam["type"]): z.ZodTypeAny {
  switch (type) {
    case "number":  return z.number();
    case "boolean": return z.boolean();
    case "object":  return z.record(z.unknown());
    case "array":   return z.array(z.unknown());
    default:        return z.string();
  }
}

function makeSchema(params: ActionParam[]): z.ZodType {
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

function toToolParams(params: ActionParam[]): ToolParameter[] {
  return params.map((p) => ({
    name: p.name,
    type: p.type,
    description: p.description,
    required: p.required,
    enum: p.enum,
    default: p.default,
  }));
}

function toolIdFor(slug: string, actionId: string): string {
  return `integration.${slug}.${actionId}`;
}

function buildDefinition(b: IntegrationToolBinding): ToolDefinition {
  return {
    id: toolIdFor(b.slug, b.action.id),
    name: `${b.displayName} — ${b.action.name}`,
    category: "integration",
    description: b.action.llmDescription ?? b.action.description,
    parameters: toToolParams(b.action.input),
    inputSchema: makeSchema(b.action.input),
    requiresConfirmation: b.action.requiresConfirmation,
    mutates: b.action.mutates,
    tags: ["integration", b.slug, b.category, ...b.action.tags],
  };
}

function makeTool(b: IntegrationToolBinding): Tool {
  return {
    definition: buildDefinition(b),
    async execute(input: unknown, context: ToolExecutionContext): Promise<ToolResult> {
      const start = Date.now();
      try {
        const res = await apiFetch(context, `${context.apiBaseUrl}/integrations/${b.integrationId}/actions/${b.action.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input }),
        });
        const data = await res.json().catch(() => ({})) as {
          success?: boolean;
          output?: unknown;
          error?: string;
          httpStatus?: number;
          runId?: string;
        };
        if (!res.ok || data.success === false) {
          return {
            success: false,
            error: data.error ?? `Integration call failed (${res.status})`,
            duration_ms: Date.now() - start,
          };
        }
        return {
          success: true,
          data: data.output,
          sideEffects: [
            `Invoked ${b.displayName} → ${b.action.name}`,
            ...(data.runId ? [`Run id: ${data.runId}`] : []),
          ],
          duration_ms: Date.now() - start,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          duration_ms: Date.now() - start,
        };
      }
    },
  };
}

/**
 * Convert a list of integration bindings (typically from
 * `integrationsService.listExposedActions(orgId, "agent")`) into agent tools.
 */
export function createIntegrationTools(bindings: IntegrationToolBinding[]): Tool[] {
  return bindings.map(makeTool);
}
