import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";
import { apiGet, apiPost } from "../api-client.js";

/**
 * MCP integration registrar.
 *
 * Two surfaces:
 *
 * 1. **Static helper tools** for agents that want to discover what's
 *    available — `listIntegrations`, `describeIntegration`. Always
 *    registered.
 *
 * 2. **Dynamic per-action tools** named `integration_{slug}_{actionId}`,
 *    one per (installed integration × manifest action). Registered at
 *    boot time by querying the API. The MCP SDK does not (today) support
 *    runtime tool advertisement, so this list is a snapshot — clients
 *    that connect after a new integration is installed will see it on
 *    next reconnect.
 */

interface ManifestActionDescriptor {
  id: string;
  name: string;
  description: string;
  llmDescription?: string;
  input: Array<{
    name: string;
    type: "string" | "number" | "boolean" | "object" | "array";
    description: string;
    required: boolean;
    enum?: string[];
    default?: unknown;
  }>;
  mutates: boolean;
  requiresConfirmation: boolean;
  tags: string[];
}

interface ManifestSnapshot {
  capabilities: { actions: ManifestActionDescriptor[]; triggers: unknown[]; syncs: unknown[] };
}

interface IntegrationListItem {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  category: string;
  status: string;
  enabled: boolean;
  exposeToMcp: boolean;
}

interface IntegrationDetail {
  integration: IntegrationListItem & { manifestSnapshot: ManifestSnapshot };
  manifest: ManifestSnapshot;
}

function paramShape(input: ManifestActionDescriptor["input"]): ZodRawShape {
  const shape: ZodRawShape = {};
  for (const p of input) {
    let field: z.ZodTypeAny;
    switch (p.type) {
      case "number":  field = z.number().describe(p.description); break;
      case "boolean": field = z.boolean().describe(p.description); break;
      case "object":  field = z.record(z.unknown()).describe(p.description); break;
      case "array":   field = z.array(z.unknown()).describe(p.description); break;
      default:
        field = p.enum
          ? z.enum(p.enum as [string, ...string[]]).describe(p.description)
          : z.string().describe(p.description);
    }
    if (!p.required) field = field.optional();
    if (p.default !== undefined) field = field.default(p.default as never);
    shape[p.name] = field;
  }
  return shape;
}

export async function registerIntegrationTools(server: McpServer): Promise<void> {
  // ── Discovery tools (always registered) ──────────────────────────────

  server.tool(
    "listIntegrations",
    "List the external integrations connected to this Bidwright organization (NetSuite, Procore, Slack, custom REST, etc.). Use BEFORE invoking any integration_* tool to confirm an integration is connected and which actions it exposes.",
    {},
    async () => {
      try {
        const res = await apiGet<{ integrations: IntegrationListItem[] }>("/integrations");
        const filtered = (res.integrations ?? []).filter((i) => i.enabled && i.exposeToMcp);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(filtered.map((i) => ({
              id: i.id,
              slug: i.slug,
              name: i.displayName,
              description: i.description,
              category: i.category,
              status: i.status,
            })), null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }] };
      }
    },
  );

  server.tool(
    "describeIntegration",
    "Return the manifest of a connected integration including all available actions, their inputs, and outputs. Pair with `listIntegrations`.",
    { integrationId: z.string().describe("Integration row id (cuid) returned by listIntegrations") },
    async ({ integrationId }) => {
      try {
        const detail = await apiGet<IntegrationDetail>(`/integrations/${integrationId}`);
        const summary = {
          id: detail.integration.id,
          slug: detail.integration.slug,
          name: detail.integration.displayName,
          status: detail.integration.status,
          actions: detail.manifest.capabilities.actions.map((a) => ({
            id: a.id,
            name: a.name,
            description: a.description,
            input: a.input,
            mutates: a.mutates,
            requiresConfirmation: a.requiresConfirmation,
          })),
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }] };
      }
    },
  );

  // ── Generic invoke (fallback when per-action tools aren't registered) ──

  server.tool(
    "invokeIntegrationAction",
    "Invoke any action on a connected integration. Prefer the dedicated `integration_{slug}_{actionId}` tools when available — this generic invoker is the fallback.",
    {
      integrationId: z.string(),
      actionId: z.string(),
      input: z.record(z.unknown()).optional(),
      idempotencyKey: z.string().optional(),
    },
    async ({ integrationId, actionId, input, idempotencyKey }) => {
      try {
        const result = await apiPost(`/integrations/${integrationId}/actions/${actionId}`, {
          input: input ?? {},
          ...(idempotencyKey ? { idempotencyKey } : {}),
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }] };
      }
    },
  );

  // ── Per-action tools (snapshot at boot) ─────────────────────────────

  let installed: IntegrationListItem[] = [];
  try {
    const res = await apiGet<{ integrations: IntegrationListItem[] }>("/integrations");
    installed = (res.integrations ?? []).filter((i) => i.enabled && i.exposeToMcp);
  } catch {
    return; // API unreachable — discovery tools alone are still useful
  }

  for (const integ of installed) {
    let detail: IntegrationDetail;
    try { detail = await apiGet<IntegrationDetail>(`/integrations/${integ.id}`); }
    catch { continue; }

    for (const action of detail.manifest.capabilities.actions) {
      const toolName = `integration_${integ.slug}_${action.id}`.replace(/-/g, "_");
      const description = `[${integ.displayName}] ${action.llmDescription ?? action.description}`;
      try {
        server.tool(
          toolName,
          description,
          paramShape(action.input),
          async (params) => {
            try {
              const result = await apiPost(`/integrations/${integ.id}/actions/${action.id}`, {
                input: params,
              });
              return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
            } catch (err) {
              return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }] };
            }
          },
        );
      } catch {
        // Name collision — fall back to the generic invoker for this action.
      }
    }
  }
}
