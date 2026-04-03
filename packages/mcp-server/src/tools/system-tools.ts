import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, projectPath } from "../api-client.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Agent memory lives in the project directory (CWD of the CLI)
const MEMORY_PATH = join(process.cwd(), "agent-memory.json");

// Timeout for waiting for user answer (5 minutes)
const ASK_USER_TIMEOUT_MS = 5 * 60 * 1000;

export function registerSystemTools(server: McpServer) {

  // ── askUser — block until the user responds ──────────────
  server.tool(
    "askUser",
    "MANDATORY: Ask the user a clarifying question and WAIT for their response. Use this BEFORE making any assumptions about scope, subcontracting, labour basis, scheduling, or other ambiguous details. The question will appear in the UI and the user can respond. This tool BLOCKS until the user answers — do not proceed without the answer.",
    {
      question: z.string().describe("The question to ask. Bundle multiple related questions into one call."),
      options: z.array(z.string()).optional().describe("Optional suggested answer choices the user can click"),
      context: z.string().optional().describe("Brief context explaining why you need this information"),
    },
    async ({ question, options, context }) => {
      const projectId = process.env.BIDWRIGHT_PROJECT_ID || "";
      if (!projectId) {
        return { content: [{ type: "text" as const, text: "Error: No project ID configured" }] };
      }

      try {
        // POST the question to the API — this will long-poll until the user answers
        const resp = await fetch(`${process.env.BIDWRIGHT_API_URL || "http://localhost:4001"}/api/cli/${projectId}/question`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(process.env.BIDWRIGHT_AUTH_TOKEN ? { "Authorization": `Bearer ${process.env.BIDWRIGHT_AUTH_TOKEN}` } : {}),
          },
          body: JSON.stringify({ question, options, context }),
          signal: AbortSignal.timeout(ASK_USER_TIMEOUT_MS),
        });

        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          return { content: [{ type: "text" as const, text: `Error asking user: ${resp.status} ${text}` }] };
        }

        const data = await resp.json() as { answer: string };
        return { content: [{ type: "text" as const, text: `User answered: ${data.answer}` }] };
      } catch (err: any) {
        if (err?.name === "TimeoutError" || err?.name === "AbortError") {
          return { content: [{ type: "text" as const, text: "User did not respond within 5 minutes. Proceed with your best judgment and note assumptions." }] };
        }
        return { content: [{ type: "text" as const, text: `Error: ${err?.message || "Failed to ask user"}` }] };
      }
    }
  );

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
      const project = ws.project || ws.projects?.[0] || {};
      const revision = ws.currentRevision || ws.revisions?.[0] || {};
      const summary = {
        projectName: project.name,
        clientName: project.clientName,
        location: project.projectAddress,
        quoteNumber: (ws.quote || ws.quotes?.[0])?.quoteNumber,
        status: revision.status,
        worksheetCount: (ws.worksheets || []).length,
        lineItemCount: (ws.worksheets || []).reduce((sum: number, w: any) => sum + (w.items || []).length, 0),
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
