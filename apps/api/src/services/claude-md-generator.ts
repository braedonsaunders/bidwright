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

  // Strategy: symlink the actual project documents directory if it exists.
  // This way, files added/deleted after agent starts are automatically visible.
  // The real documents live at {dataRoot}/projects/{projectId}/documents/
  const projectId = projectDir.split("/").pop() ?? "";
  const realDocsDir = join(dataRoot, "projects", projectId, "documents");

  if (existsSync(realDocsDir) && !existsSync(docsDir)) {
    try {
      await symlink(realDocsDir, docsDir);
      return; // Directory symlink covers everything
    } catch {
      // Fall through to individual file symlinks
    }
  }

  // Fallback: individual file symlinks (for cases where dir symlink fails)
  await mkdir(docsDir, { recursive: true });
  for (const doc of documents) {
    if (!doc.storagePath) continue;
    const sourcePath = join(dataRoot, doc.storagePath);
    const targetPath = join(docsDir, doc.fileName);
    if (existsSync(sourcePath) && !existsSync(targetPath)) {
      try {
        await symlink(sourcePath, targetPath);
      } catch {
        // Skip
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
   - \`description\`: A PROFESSIONAL estimator-quality scope of work (see below)
   - \`notes\`: Key exclusions and assumptions

   **DO THIS BEFORE CREATING WORKSHEETS.** The user is watching the page and needs to see the title and scope update immediately.

   ### How to Write the Description / Scope of Work
   The description should read like a professional construction estimate scope letter. Use bullet points, subheadings per major scope area, and include:
   - **Specific equipment counts and references** — cite P&ID numbers (e.g. "Transfer pump x 2 (PID-PENTANE-N-0003)")
   - **Installation methods and standards** — "Secure using 1\\" epoxy anchors and HIT-HY200 A V3 Adhesive"
   - **Material specifications** — pipe specs, insulation types, grout requirements
   - **Explicit scope inclusions** — what YOUR company does
   - **Explicit scope exclusions** — what OTHERS do or what is NOT included
   - **Assumptions** — distances, access, site conditions
   - **Vendor/supplier responsibilities** — "All valves and instrumentation will be supplied by others"
   Do NOT write a paragraph summary. Write a detailed, section-by-section breakdown that an estimator would present to a client.
3. **Call getItemConfig** — learn the org's categories and available labour/equipment rates
4. **IMPORT RATE SCHEDULES** — If getItemConfig shows categories with itemSource="rate_schedule" (e.g. Labour, Equipment), you MUST call \`listRateSchedules\` to see available schedules, then call \`importRateSchedule\` for each relevant schedule BEFORE creating any line items. Every Labour item MUST have a \`rateScheduleItemId\` linking to an imported rate item (e.g. "Journeyman Pipefitter", "Foreman", "Apprentice"). Every Equipment item with a rate schedule must also link. DO NOT create Labour or Equipment items without first importing schedules and setting rateScheduleItemId.
5. **Check memory** — see if there's progress from a prior session
6. **Create phases** — create project phases if the spec defines a sequence of work (e.g. "Phase 1 - Mobilization", "Phase 2 - Equipment Setting", "Phase 3 - Piping Install"). Assign line items to phases.
7. **Create worksheets** — one per major system/trade/division
8. **Populate items** — read relevant docs, create line items with descriptions citing sources. Set \`phaseId\` on items when applicable.
9. **Query knowledge + datasets** — search for man-hour data, productivity rates as you create items. Use queryDatasets for precise table lookups (e.g. "butt weld 6 inch schedule 40 man hours").
9. **Build schedule** — if the spec mentions dates, milestones, or schedule requirements, create schedule tasks with \`createScheduleTask\`. Link tasks to phases. Set start/end dates and durations.
10. **Add conditions** — exclusions, clarifications, assumptions
11. **Save progress to memory** — so you can resume later

## Item Creation Rules

- Call \`getItemConfig\` before creating ANY items
- Match category names EXACTLY as returned by getItemConfig
- **USE THE CORRECT CATEGORY FOR EACH ITEM:**
  - **Material** — physical materials, pipe, fittings, steel, consumables
  - **Labour** — crew hours, installation labour, supervision (set laborHourReg for hours, cost for hourly rate)
  - **Equipment** — crane rental, scaffolding, welding machines, tools
  - **Subcontractor** — subcontracted work packages (lump sum)
  - **NEVER** put labour costs under Material or equipment under Labour. Categorize correctly.
- Each category has an \`itemSource\` field that tells you where items come from:
  - **rate_schedule**: Items MUST link to imported rate schedule items. Steps:
    1. Call \`listRateSchedules\` to see available org schedules
    2. Call \`importRateSchedule\` to import relevant schedules to this quote
    3. Call \`listRateScheduleItems\` on the imported schedule to get item IDs
    4. Set \`rateScheduleItemId\` on every item in this category (e.g. for Labour: "Journeyman Pipefitter" ID, for Equipment: "10,000 lb Fork Truck" ID)
    5. FAILURE TO SET rateScheduleItemId means the item has NO rate and will show $0
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
- Use Sub-agents (Agent tool) to process multiple worksheets in parallel when beneficial
- Save progress to memory frequently so you can resume if stopped

## Progress Reporting

The user watches your work in real-time. Keep them informed:
- Call \`reportProgress\` before major phases (reading docs, creating worksheets, populating items)
- Output a text message when starting each worksheet (e.g. "Populating worksheet 02 - HCl Tank...")
- After each worksheet, output a summary (e.g. "Worksheet 02 complete: 12 items created")
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
