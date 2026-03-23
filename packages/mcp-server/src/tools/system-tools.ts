import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, projectPath } from "../api-client.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Agent memory lives in the project directory (CWD of the CLI)
const MEMORY_PATH = join(process.cwd(), "agent-memory.json");

export function registerSystemTools(server: McpServer) {

  // ── readMemory ────────────────────────────────────────────
  server.tool(
    "readMemory",
    "Read the persistent agent memory for this project. Contains notes, progress tracking, decisions from prior sessions. Always check this at the start of a session.",
    {},
    async () => {
      try {
        const raw = await readFile(MEMORY_PATH, "utf-8");
        const memory = JSON.parse(raw);
        return { content: [{ type: "text" as const, text: JSON.stringify(memory, null, 2) }] };
      } catch {
        return { content: [{ type: "text" as const, text: "{}" }] };
      }
    }
  );

  // ── writeMemory ───────────────────────────────────────────
  server.tool(
    "writeMemory",
    "Write to the persistent agent memory. Use sections to organize: scope_plan, progress, decisions, worksheets_created, etc. This persists across sessions.",
    {
      section: z.string().describe("Memory section name (e.g. 'scope_plan', 'progress', 'decisions')"),
      content: z.string().describe("Content to write to this section"),
    },
    async ({ section, content }) => {
      let memory: Record<string, string> = {};
      try {
        const raw = await readFile(MEMORY_PATH, "utf-8");
        memory = JSON.parse(raw);
      } catch {}
      memory[section] = content;
      await writeFile(MEMORY_PATH, JSON.stringify(memory, null, 2), "utf-8");
      return { content: [{ type: "text" as const, text: `Saved to memory section: ${section}` }] };
    }
  );

  // ── getProjectSummary ─────────────────────────────────────
  server.tool(
    "getProjectSummary",
    "Get a compact summary of the current project — name, client, location, revision info, estimate totals, item count.",
    {},
    async () => {
      const data = await apiGet(projectPath("/workspace"));
      const ws = data.workspace || data;
      const project = ws.projects?.[0] || {};
      const revision = ws.revisions?.[0] || {};
      const summary = {
        projectName: project.name,
        clientName: project.clientName,
        location: project.projectAddress,
        quoteNumber: ws.quotes?.[0]?.quoteNumber,
        status: revision.status,
        worksheetCount: (ws.worksheets || []).length,
        lineItemCount: (ws.worksheetItems || []).length,
        phaseCount: (ws.phases || []).length,
        conditionCount: (ws.conditions || []).length,
        subtotal: revision.subtotal,
        estimatedCost: revision.cost,
        estimatedProfit: revision.estimatedProfit,
        estimatedMargin: revision.estimatedMargin,
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
    }
  );

  // ── reportProgress ────────────────────────────────────────
  server.tool(
    "reportProgress",
    "Report progress to the user interface. Use this to communicate what you're doing — the user sees these updates in real-time in the AI drawer.",
    {
      phase: z.string().describe("Current phase (e.g. 'Reading Spec', 'Creating Worksheets', 'Populating Items')"),
      detail: z.string().describe("What specifically you're doing right now"),
    },
    async ({ phase, detail }) => {
      // POST to a progress endpoint that the API forwards as SSE
      try {
        await apiPost("/agent/progress", { phase, detail });
      } catch {
        // Non-critical — don't fail if progress reporting fails
      }
      return { content: [{ type: "text" as const, text: `Progress reported: [${phase}] ${detail}` }] };
    }
  );
}
