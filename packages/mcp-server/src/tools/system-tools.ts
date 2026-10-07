import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, projectPath } from "../api-client.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Agent memory lives in the project directory (CWD of the CLI)
const MEMORY_PATH = join(process.cwd(), "agent-memory.json");

const ASK_USER_POLL_MS = Number(process.env.BIDWRIGHT_ASK_USER_POLL_MS) > 0 ? Number(process.env.BIDWRIGHT_ASK_USER_POLL_MS) : 1500;
// ~30 s of the server reporting the question as neither pending nor answered.
const ASK_USER_DROPPED_POLLS = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registerSystemTools(server: McpServer) {
  const askUserQuestionSchema = z.object({
    id: z.string().optional().describe("Stable identifier for this question"),
    prompt: z.string().describe("Question shown to the user"),
    options: z.array(z.string()).optional().describe("2-4 suggested answer choices"),
    allowMultiple: z.boolean().optional().describe("Set true when the user can choose more than one option"),
    placeholder: z.string().optional().describe("Optional textbox placeholder for extra detail"),
    context: z.string().optional().describe("Optional short context for this individual question"),
  });

  // ── askUser — block until the user responds ──────────────
  server.tool(
    "askUser",
    "MANDATORY: Ask the user a clarifying question and WAIT for their response. Use this BEFORE making any assumptions about scope, subcontracting, labour basis, scheduling, or other ambiguous details. When the question is about something on a drawing (a count, a note, a detail), pass the viewId of the image you are looking at so the user sees the same thing. The question will appear in the UI and the user can respond. This tool BLOCKS until the user answers — do not proceed without the answer.",
    {
      // Optional because this tool tells the model to prefer `questions` for
      // multi-part asks, and it then omits the singular field — which failed
      // validation outright ("question: Required") and cost a round trip. When
      // it is missing we derive it from the structured list below.
      question: z.string().optional().describe("Short overall prompt or summary for this ask. If using `questions`, keep this concise."),
      options: z.array(z.string()).optional().describe("Optional suggested answer choices the user can click"),
      allowMultiple: z.boolean().optional().describe("Set true when the top-level options support multiple selections"),
      context: z.string().optional().describe("Brief context explaining why you need this information"),
      questions: z.array(askUserQuestionSchema).optional().describe("Optional structured list of related questions. Prefer this when asking more than one thing at a time."),
      viewId: z.string().optional().describe("viewId of a drawing image you are asking about (from readDrawingPage/readDrawingTile). The user sees that exact image next to the question."),
      regionRef: z.object({
        documentId: z.string(),
        pageNumber: z.coerce.number().int().min(1),
        bbox: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
        viewId: z.string().optional(),
      }).optional().describe("Where on a drawing the question is about, so the user can open the page at that spot."),
    },
    async ({ question, options, allowMultiple, context, questions, viewId, regionRef }) => {
      const projectId = process.env.BIDWRIGHT_PROJECT_ID || "";
      if (!projectId) {
        return { content: [{ type: "text" as const, text: "Error: No project ID configured" }] };
      }

      // Everything downstream keys off a non-empty `question` — the drawer hides
      // any askUser event without one. Since the field is now optional, derive a
      // summary from the structured list rather than posting a blank prompt.
      const resolvedQuestion =
        question?.trim() ||
        (questions?.length === 1
          ? questions[0]?.prompt?.trim()
          : questions?.length
            ? `${questions.length} questions about scope and pricing basis`
            : "");
      if (!resolvedQuestion) {
        return { content: [{ type: "text" as const, text: "Error: askUser needs either `question` or a non-empty `questions` list" }] };
      }

      try {
        const created = await apiPost<{ ok: boolean; questionId: string }>(`/api/cli/${projectId}/question`, {
          question: resolvedQuestion,
          options,
          allowMultiple,
          context,
          questions,
          ...(viewId ? { viewId } : {}),
          ...(regionRef ? { regionRef: { ...regionRef, viewId: regionRef.viewId ?? viewId } } : {}),
        });

        const questionId = created.questionId;
        let unknownPolls = 0;

        while (true) {
          await sleep(ASK_USER_POLL_MS);
          const status = await apiGet<{
            pending: boolean;
            answered?: boolean;
            answer?: string;
            questionId?: string | null;
          }>(`/api/cli/${projectId}/pending-question?questionId=${encodeURIComponent(questionId)}`);

          if (status.answered && typeof status.answer === "string") {
            return { content: [{ type: "text" as const, text: `User answered: ${status.answer}` }] };
          }

          // A question the server no longer knows about will never be answered.
          // Waiting on it hangs the run with nothing visible to the user, so
          // hand control back after a short grace period.
          unknownPolls = status.pending ? 0 : unknownPolls + 1;
          if (unknownPolls >= ASK_USER_DROPPED_POLLS) {
            return {
              isError: true,
              content: [{
                type: "text" as const,
                text: "Your question is no longer pending on the server, so no answer will arrive. Ask it again with askUser, or continue with the most defensible option and record it as an explicit assumption.",
              }],
            };
          }
        }
      } catch (err: any) {
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
        await apiPost("/agent/progress", { projectId: process.env.BIDWRIGHT_PROJECT_ID || "", phase, detail });
      } catch {
        // Non-critical — don't fail if progress reporting fails
      }
      return { content: [{ type: "text" as const, text: `Progress reported: [${phase}] ${detail}` }] };
    }
  );
}
