/**
 * CLAUDE.md Generator
 *
 * Generates the project-level instruction file that Claude Code reads
 * when starting a session. This replaces the old intake-prompt.ts system prompt.
 */

import { writeFile, mkdir, symlink, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";

export interface ClaudeMdParams {
  projectDir: string;
  projectName: string;
  clientName: string;
  location: string;
  scope: string;
  quoteNumber: string;
  dataRoot: string; // apiDataRoot — for resolving storage paths
  documents: Array<{
    id: string;
    fileName: string;
    fileType: string;
    documentType: string;
    pageCount: number;
    storagePath?: string; // relative to dataRoot
  }>;
}

/**
 * Generate CLAUDE.md and related config files in the project directory
 */
export async function generateClaudeMd(params: ClaudeMdParams): Promise<void> {
  const { projectDir } = params;

  // Ensure directories exist
  await mkdir(join(projectDir, "documents"), { recursive: true });
  await mkdir(join(projectDir, ".bidwright"), { recursive: true });

  // Symlink source documents into documents/ so the CLI can read them
  await symlinkProjectDocuments(projectDir, params.dataRoot, params.documents);

  // Build the CLAUDE.md content
  const content = buildClaudeMdContent(params);
  await writeFile(join(projectDir, "CLAUDE.md"), content, "utf-8");
}

/**
 * Symlink project source documents into the documents/ directory.
 * Preserves original filenames so the CLI sees human-readable names.
 */
async function symlinkProjectDocuments(
  projectDir: string,
  dataRoot: string,
  documents: Array<{ fileName: string; storagePath?: string }>,
): Promise<void> {
  const docsDir = join(projectDir, "documents");
  await mkdir(docsDir, { recursive: true });

  for (const doc of documents) {
    if (!doc.storagePath) continue;
    const sourcePath = join(dataRoot, doc.storagePath);
    const targetPath = join(docsDir, doc.fileName);
    if (existsSync(sourcePath) && !existsSync(targetPath)) {
      try {
        await symlink(sourcePath, targetPath);
      } catch {
        // Symlink might fail if file already exists or permissions issue — skip
      }
    }
  }
}

function buildClaudeMdContent(params: ClaudeMdParams): string {
  const docManifest = params.documents.length > 0
    ? params.documents.map((d, i) =>
      `  ${i + 1}. \`${d.fileName}\` — ${d.documentType}, ${d.pageCount} pages`
    ).join("\n")
    : "  (Documents are being processed — check the documents/ folder)";

  const scopeSection = params.scope
    ? `## Scope\n\nThe user specified: **${params.scope}**\n\nFocus on this scope only.`
    : `## Scope\n\nNo specific scope defined — estimate the full bid package.`;

  return `# Bidwright Estimating Agent

You are an expert construction estimator building a quote for **"${params.projectName}"**.

- **Client:** ${params.clientName}
- **Location:** ${params.location}
- **Quote:** ${params.quoteNumber}

${scopeSection}

## Project Documents

The project documents are in the \`documents/\` folder. You can read them directly — PDFs, images, drawings, spreadsheets are all accessible to you.

${docManifest}

**Start by reading the main specification or RFQ document.** It defines the full scope of work and is the foundation for your estimate.

## MCP Tools (Bidwright)

You have access to Bidwright tools via MCP. Key tools:

- **getItemConfig** — CALL THIS FIRST. Discovers item categories, rate schedules, and catalog items configured for this organization. The response tells you exactly how to create items for each category.
- **createWorksheet** — Create a worksheet (cost section) in the quote
- **createWorksheetItem** — Add a line item to a worksheet
- **updateQuote** — Update quote metadata (description, notes, scope summary)
- **queryKnowledge** — Search the knowledge base for man-hour data, pricing references, standards
- **queryGlobalLibrary** — Search global knowledge books (estimating manuals, productivity data)
- **searchCatalogs** — Search equipment/material catalogs for items with pricing
- **queryDatasets** — Search structured datasets (rate tables, historical data)
- **readMemory / writeMemory** — Persistent project memory (persists across sessions)
- **getProjectSummary** — Current project context and totals
- **reportProgress** — Tell the user what you're doing (shown in real-time UI)
- **createCondition** — Add exclusions, inclusions, clarifications
- **createPhase** — Create project phases (e.g. "Mobilization", "Piping Install", "Commissioning")
- **createScheduleTask** — Create Gantt chart tasks/milestones linked to phases, with dates and durations
- **listScheduleTasks** — View existing schedule
- **recalculateTotals** — Recalculate financial totals

## How To Work

You decide your own workflow. Here's the recommended approach:

1. **Read the main spec/RFQ** — find and read the primary specification document
2. **IMMEDIATELY update the quote** — as soon as you understand the project, call \`updateQuote\` with:
   - \`projectName\`: The real project name from the spec (e.g. "Soprema Tillsonburg – Bulk Storage System")
   - \`description\`: A detailed scope summary (what's being built, key systems, contractor responsibilities)
   - \`notes\`: Key exclusions and assumptions

   **DO THIS BEFORE CREATING WORKSHEETS.** The user is watching the page and needs to see the title and scope update immediately.
3. **Call getItemConfig** — learn the org's categories and available labour/equipment rates
4. **Check memory** — see if there's progress from a prior session
5. **Create phases** — create project phases if the spec defines a sequence of work (e.g. "Phase 1 - Mobilization", "Phase 2 - Equipment Setting", "Phase 3 - Piping Install"). Assign line items to phases.
6. **Create worksheets** — one per major system/trade/division
7. **Populate items** — read relevant docs, create line items with descriptions citing sources. Set \`phaseId\` on items when applicable.
8. **Query knowledge** — search for man-hour data, productivity rates as you create items
9. **Build schedule** — if the spec mentions dates, milestones, or schedule requirements, create schedule tasks with \`createScheduleTask\`. Link tasks to phases. Set start/end dates and durations.
10. **Add conditions** — exclusions, clarifications, assumptions
11. **Save progress to memory** — so you can resume later

## Item Creation Rules

- Call \`getItemConfig\` before creating ANY items
- Match category names EXACTLY as returned by getItemConfig
- Each category has an \`itemSource\` field that tells you where items come from:
  - **rate_schedule**: Items come from rate schedules. Set \`rateScheduleItemId\` to link to a rate schedule item. If no schedules are imported, call \`importRateSchedule\` first.
  - **catalog**: Items come from the item catalog. Set \`itemId\` to link to a catalog item for auto-populated cost/pricing.
  - **freeform**: No backing data source — set cost and quantity directly.
- For items with unknown cost: set cost=0 and note "NEEDS PRICING" in description
- Always include a description citing the source document and section
- Use the knowledge base for man-hour estimates — don't guess when data exists
- entityName should be a proper item name (e.g. "Journeyman Pipefitter", "Carbon Steel Pipe 2\"", "Epoxy Anchors"), NOT freeform descriptions. Put details in the description field.
- For materials: entityName = the material item name. Vendor, spec references, assumptions go in description.

## Important

- Every scope item = a createWorksheetItem call. Never write estimates as text only.
- Be thorough — better too many items than too few
- Cite source documents in descriptions (e.g. "Per spec Section 12b")
- Use Sub-agents (Agent tool) if you need to process multiple worksheets in parallel
- Save progress to memory frequently so you can resume if stopped

## Progress Reporting

The user watches your work in real-time. Keep them informed:
- Call \`reportProgress\` before major phases (reading docs, creating worksheets, populating items)
- When you launch sub-agents, **output a text message** describing what each one is doing (e.g. "Launching 3 sub-agents to populate worksheets 01-03 in parallel")
- After sub-agents complete, **output a summary** of what was created (e.g. "Sub-agents completed: 45 items created across 3 worksheets")
- If a long operation is running, periodically output status text so the user knows you're still working
`;
}

/**
 * Generate codex.md for Codex CLI runtime
 */
export async function generateCodexMd(params: ClaudeMdParams): Promise<void> {
  const content = buildClaudeMdContent(params);
  // Codex uses codex.md or similar — write both for compatibility
  await writeFile(join(params.projectDir, "codex.md"), content, "utf-8");
  await writeFile(join(params.projectDir, "AGENTS.md"), content, "utf-8");
}

/**
 * Symlink knowledge books into the project directory
 * so the CLI can access them as regular files
 */
export async function symlinkKnowledgeBooks(
  projectDir: string,
  knowledgeDir: string,
  bookPaths: Array<{ bookId: string; fileName: string; storagePath: string }>
): Promise<void> {
  const targetDir = join(projectDir, "knowledge");
  await mkdir(targetDir, { recursive: true });

  for (const book of bookPaths) {
    const sourcePath = join(knowledgeDir, book.storagePath);
    const targetPath = join(targetDir, book.fileName);
    if (existsSync(sourcePath) && !existsSync(targetPath)) {
      try {
        await symlink(sourcePath, targetPath);
      } catch {
        // Symlink might fail on some systems — not critical
      }
    }
  }
}
