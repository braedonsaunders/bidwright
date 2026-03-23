import type {
  AgentConfig,
  AgentResponse,
  AgentSession,
  LLMAdapter,
  ToolExecutionContext,
  ToolResult,
} from "./types.js";
import { ToolRegistry } from "./registry.js";
import { AgentLoop } from "./loop.js";

// ─── Types ────────────────────────────────────────────────────────────

export interface DocumentInfo {
  id: string;
  fileName: string;
  fileType: string;
  documentType: string;
  pageCount: number;
}

export interface ExtractionResult {
  documentId: string;
  fileName: string;
  scopeItems: ScopeItem[];
  summary: string;
  suggestedWorksheet: string;
  errors: string[];
}

export interface ScopeItem {
  name: string;
  description: string;
  category: "Material" | "Labour" | "Equipment" | "Subcontractor";
  quantity: number;
  uom: string;
  estimatedCost: number;
  sourceReference: string;
  needsPricing: boolean;
  notes: string;
}

export interface IntakeOrchestrationConfig {
  adapter: LLMAdapter;
  registry: ToolRegistry;
  context: ToolExecutionContext;
  documents: DocumentInfo[];
  projectName: string;
  clientName: string;
  location: string;
  quoteNumber: string;
  scope: string;
  maxIterationsPerSubAgent: number;
  maxCoordinatorIterations: number;
  abortSignal?: AbortSignal;
  onToolCall?: AgentConfig["onToolCall"];
  onMessage?: AgentConfig["onMessage"];
  onPhase?: (phase: string, detail: string) => void;
}

// ─── Sub-Agent Prompts ────────────────────────────────────────────────

function buildExtractionPrompt(docs: DocumentInfo[], projectContext: string): string {
  const docList = docs.map((d) => `- ${d.fileName} (id: ${d.id}, type: ${d.documentType}, pages: ${d.pageCount})`).join("\n");

  return `You are a construction document extraction agent. Your ONLY job is to read the assigned documents and extract scope items as structured JSON.

## Project Context
${projectContext}

## Your Documents
${docList}

## Instructions

1. Read each document using project.readFile (use pageRange for large docs)
2. Extract every scope item you can identify
3. Return your findings as a structured summary

For each scope item found, include:
- name: Clear item name (e.g. "2\" Sch 40 CS Pipe - ISO System")
- description: What it is, with document reference (e.g. "Per PID-ISO-0001 Section 3.2")
- category: Material, Labour, Equipment, or Subcontractor
- quantity: Best estimate from the document (use 1 if unclear)
- uom: Unit of measure (EA, LF, SF, HR, LS, etc.)
- estimatedCost: $0 if unknown
- sourceReference: Document name and section
- needsPricing: true if cost is unknown
- notes: Any assumptions or uncertainties

Also determine which worksheet this scope belongs to (e.g. "Division 43 - Process Piping", "Division 26 - Electrical").

Be thorough — extract every item. It's better to over-extract than miss items.

After reading the documents, write your complete findings to agent memory using system.writeMemory with section "extraction_{documentId}" so they persist.

Then provide a final text summary of what you found.`;
}

function buildCoordinatorPrompt(
  projectName: string,
  clientName: string,
  location: string,
  quoteNumber: string,
  scope: string,
  extractionSummaries: string[],
  totalDocs: number,
): string {
  const summaryText = extractionSummaries.join("\n\n---\n\n");

  return `You are a quote-building agent. You ONLY create worksheets and line items. You do NOT read documents — that has already been done.

Project: "${projectName}" | Client: ${clientName} | Location: ${location} | Quote: ${quoteNumber}
${scope ? `Scope: ${scope}` : ""}

## Your ONLY Available Tools

- quote.createWorksheet — Create a worksheet (call this FIRST)
- quote.createWorksheetItem — Add a line item to a worksheet (call this for EVERY item)
- quote.createCondition — Add exclusions/inclusions
- quote.createPhase — Create phases
- system.readMemory — Check what extraction sub-agents found
- system.writeMemory — Track your progress

## Extraction Results (from sub-agents)

${summaryText}

## Instructions

1. Call quote.createWorksheet to create the first worksheet (e.g. "Process Piping")
2. Call quote.createWorksheetItem repeatedly to add every scope item found above
3. Create more worksheets as needed for different trades/systems
4. After all items: call quote.createCondition for exclusions

For each createWorksheetItem call, provide:
- worksheetId: the worksheet ID returned from createWorksheet
- entityName: item name
- description: source document reference + any assumptions
- category: Material, Labour, Equipment, or Subcontractor
- quantity: from extraction results (default 1)
- uom: EA, LF, SF, HR, LS
- cost: $0 if unknown (put "NEEDS PRICING" in description)

DO NOT generate text responses. ONLY call tools. Every turn must be a tool call.`;
}

// ─── Orchestrator ─────────────────────────────────────────────────────

/**
 * Map-reduce intake orchestrator.
 *
 * Phase 1 (Map): Spawns sub-agents to extract scope from documents in parallel batches.
 *   Each sub-agent gets 2-4 related documents, reads them, extracts structured scope items.
 *
 * Phase 2 (Reduce): Coordinator agent takes extraction summaries and builds the actual
 *   quote — creating worksheets, line items, conditions using the quote tools.
 *
 * This keeps raw document content out of the coordinator's context entirely.
 */
export async function runIntakeOrchestration(config: IntakeOrchestrationConfig): Promise<{
  message: string;
  totalToolCalls: number;
  extractionResults: string[];
}> {
  const {
    adapter, registry, context, documents,
    projectName, clientName, location, quoteNumber, scope,
    maxIterationsPerSubAgent, maxCoordinatorIterations,
    onToolCall, onMessage, onPhase,
  } = config;

  const projectContext = `Project: ${projectName}\nClient: ${clientName}\nLocation: ${location}\nQuote: ${quoteNumber}\n${scope ? `Scope: ${scope}` : "Full bid package"}`;

  let totalToolCalls = 0;
  const extractionSummaries: string[] = [];

  // ── Phase 1: Group documents and extract in batches ──────────────

  onPhase?.("extraction", `Starting extraction from ${documents.length} documents`);
  onMessage?.({ role: "assistant", content: `Starting document extraction phase — processing ${documents.length} documents in batches...` });

  // Group related documents (by type or prefix)
  const batches = groupDocuments(documents, 3);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchNames = batch.map((d) => d.fileName).join(", ");

    onPhase?.("extraction", `Batch ${i + 1}/${batches.length}: ${batchNames}`);
    onMessage?.({ role: "assistant", content: `[Extraction ${i + 1}/${batches.length}] Processing: ${batchNames}` });

    // Create a fresh session for this sub-agent (isolated context)
    const subSession: AgentSession = {
      id: `sub-extract-${i}`,
      projectId: context.projectId,
      revisionId: context.revisionId,
      quoteId: context.quoteId,
      userId: "",
      messages: [],
      toolCalls: [],
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Sub-agent gets read + memory + search tools (no quote write tools)
    const subRegistry = new ToolRegistry();
    const readOnlyTools = [
      ...registry.getByCategory("system"),
      ...registry.getByCategory("knowledge"),
    ].filter((t) =>
      ["project.readFile", "project.listFiles", "project.getDocumentManifest",
       "project.searchFiles", "knowledge.queryProjectDocs",
       "system.readMemory", "system.writeMemory"].includes(t.definition.id)
    );
    subRegistry.registerMany(readOnlyTools);

    const subPrompt = buildExtractionPrompt(batch, projectContext);

    const subLoop = new AgentLoop(
      {
        llm: adapter,
        maxIterations: maxIterationsPerSubAgent,
        maxTokens: 4096,
        temperature: 0,
        systemPrompt: subPrompt,
        abortSignal: config.abortSignal,
        onToolCall: (tc) => {
          totalToolCalls++;
          onToolCall?.(tc);
        },
      },
      subRegistry,
    );

    try {
      const result = await subLoop.run(
        subSession,
        `Extract scope items from the assigned documents. Read each document and identify all scope items.`,
        context,
      );

      extractionSummaries.push(
        `## Batch ${i + 1}: ${batchNames}\n\n${result.message}`
      );
      totalToolCalls += result.toolCallsExecuted.length;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      extractionSummaries.push(
        `## Batch ${i + 1}: ${batchNames}\n\n[ERROR] ${errMsg}`
      );
      onMessage?.({ role: "assistant", content: `[Extraction ${i + 1}] Error: ${errMsg}` });
    }
  }

  // ── Phase 2: Coordinator builds the quote ────────────────────────

  onPhase?.("coordination", "Building quote from extraction results");
  onMessage?.({ role: "assistant", content: `Extraction complete. Starting quote building phase with ${extractionSummaries.length} extraction results...` });

  const coordSession: AgentSession = {
    id: `coord-${Date.now()}`,
    projectId: context.projectId,
    revisionId: context.revisionId,
    quoteId: context.quoteId,
    userId: "",
    messages: [],
    toolCalls: [],
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const coordPrompt = buildCoordinatorPrompt(
    projectName, clientName, location, quoteNumber, scope,
    extractionSummaries, documents.length,
  );

  // Coordinator gets ONLY write tools + memory (max ~10 tools, not ~136)
  const coordRegistry = new ToolRegistry();
  const writeTools = [
    ...registry.getByCategory("quote"),
    ...registry.getByCategory("system"),
  ].filter((t) =>
    ["quote.createWorksheet", "quote.createWorksheetItem", "quote.createPhase",
     "quote.createCondition", "quote.createModifier", "quote.createALI",
     "quote.updateQuote", "quote.recalculateTotals", "quote.getWorkspace",
     "system.readMemory", "system.writeMemory"].includes(t.definition.id)
  );
  coordRegistry.registerMany(writeTools);

  const coordLoop = new AgentLoop(
    {
      llm: adapter,
      maxIterations: maxCoordinatorIterations,
      maxTokens: 4096,
      temperature: 0,
      systemPrompt: coordPrompt,
      abortSignal: config.abortSignal,
      prepareStep: (step, history) => {
        // Force tool_choice to "required" so the model MUST call tools
        if (step < 2) {
          // First 2 steps: force createWorksheet
          return { toolChoice: { type: "function", name: "quote.createWorksheet" } };
        }
        // After that: require tool calls but let it choose which
        return { toolChoice: "required" };
      },
      onToolCall: (tc) => {
        totalToolCalls++;
        onToolCall?.(tc);
      },
      onMessage,
    },
    coordRegistry,
  );

  try {
    const result = await coordLoop.run(
      coordSession,
      "Build the complete quote from the extraction results. Create worksheets, add all line items, and add conditions.",
      context,
    );

    return {
      message: result.message,
      totalToolCalls,
      extractionResults: extractionSummaries,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      message: `Coordinator failed: ${errMsg}`,
      totalToolCalls,
      extractionResults: extractionSummaries,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Group documents into batches of related files.
 * Groups by common prefix (e.g. "PID-ISO-*" together, "K5635-059-*" together).
 */
function groupDocuments(docs: DocumentInfo[], maxPerBatch: number): DocumentInfo[][] {
  // Group by prefix (first portion of filename before numbers)
  const groups = new Map<string, DocumentInfo[]>();

  for (const doc of docs) {
    const prefix = doc.fileName
      .replace(/[-_]\d+.*$/, "")  // strip trailing numbers
      .replace(/\.(pdf|xlsx|csv|docx|txt)$/i, "")  // strip extension
      .toLowerCase()
      .slice(0, 20);  // limit prefix length

    const key = prefix || "misc";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(doc);
  }

  // Split large groups and merge tiny ones
  const batches: DocumentInfo[][] = [];
  let currentBatch: DocumentInfo[] = [];

  for (const group of groups.values()) {
    if (group.length > maxPerBatch) {
      // Split large group into chunks
      for (let i = 0; i < group.length; i += maxPerBatch) {
        batches.push(group.slice(i, i + maxPerBatch));
      }
    } else if (currentBatch.length + group.length <= maxPerBatch) {
      currentBatch.push(...group);
    } else {
      if (currentBatch.length > 0) batches.push(currentBatch);
      currentBatch = [...group];
    }
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  return batches;
}
