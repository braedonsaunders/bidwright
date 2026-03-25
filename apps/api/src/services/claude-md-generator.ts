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

The project documents are in the \`documents/\` folder as real files on disk.

**How to read documents:**
- PDFs: Use the \`Read\` tool on \`documents/<filename>.pdf\` — it reads PDFs natively (use \`pages\` param for large PDFs, e.g. pages: "1-5"). This is faster and gives you the full content.
- Spreadsheets (.xlsx, .csv): Use the \`Read\` tool directly
- Images: Use the \`Read\` tool (you are multimodal and can see images)
- \`getDocumentStructured\` — use this for Azure Form Recognizer extracted tables and structured data (useful for tabular content)
- **Do NOT use renderDrawingPage to read document text.** That tool renders a PDF page as an image — it's for visual drawing inspection and symbol counting, not for reading specs. Use \`Read\` instead.

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

### Vision & Drawing Takeoff Tools (for symbol counting ONLY)

These tools are for **automated symbol counting on construction drawings**, NOT for reading documents. To read documents, use the Read tool on files in documents/.

- **scanDrawingSymbols** — Scans a drawing page and returns an inventory of repeating symbols with counts and locations
- **countSymbols** — Refine a count with a specific bounding box and threshold
- **countSymbolsAllPages** — Count a symbol across ALL pages of a document
- **renderDrawingPage** — Render a drawing page as an image for visual symbol inspection (NOT for reading spec text — use Read tool instead)
- **zoomDrawingRegion** — Zoom into a small region for tiny text or symbol details
- **listDrawingPages** — List all PDF drawings with page counts

**Symbol counting workflow (MANDATORY):**
1. \`listDrawingPages\` → find the document
2. \`scanDrawingSymbols(documentId, pageNumber)\` → get the full symbol inventory + page image in ONE call
3. Interpret the clusters: "Cluster 0 is valve tags (46 found), Cluster 1 is instrument bubbles (3 found)" etc.
4. Report the relevant count directly from the scan results
5. If you need to adjust threshold or search cross-document, call \`countSymbols\` with the cluster's \`representativeBox\`

**Do NOT:**
- Zoom around the page trying to visually count symbols — the scan does this automatically
- Call renderDrawingPage + zoomDrawingRegion repeatedly — scanDrawingSymbols replaces this entire workflow
- Manually identify bounding boxes when scan clusters already provide them

## How To Work

You decide your own workflow. Here's the MANDATORY sequence:

1. **Read the main spec/RFQ** — find and read the primary specification document using the Read tool on the documents/ folder
2. **IMMEDIATELY update the quote — THIS IS YOUR #1 PRIORITY, DO IT BEFORE ANYTHING ELSE.** As soon as you read the main spec, call \`updateQuote\` with:
   - \`projectName\`: The real project name from the spec
   - \`description\`: A PROFESSIONAL estimator-quality scope of work (see below)
   - \`customerId\`: If you can identify the client from the available customers, set the customer ID
   - \`clientName\`: The client/owner name from the documents
   - \`notes\`: Key exclusions and assumptions

   **MANDATORY GATE: You MUST call updateQuote with projectName, description, and clientName BEFORE calling createWorksheet or createWorksheetItem. The user is watching the page live and sees an empty quote until you do this. Creating worksheets without first setting the project name, scope description, and client is NOT ALLOWED.**

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
4. **Search the knowledge base** — Now that you understand the scope, call \`searchBooks\` and \`listDatasets\` to find reference data relevant to THIS project (man-hour tables, production rates, historical pricing, trade handbooks). Write the available knowledge sources and their relevance to memory so you can refer back to them repeatedly.
5. **IMPORT RATE SCHEDULES** — If getItemConfig shows categories with itemSource="rate_schedule", call \`listRateSchedules\` to see available schedules. Review the schedule names and pick the ones most relevant to this project — match by client name, project location, trade type, or any other identifying info in the schedule name. Import the best-matching schedule for each required trade category. Call \`importRateSchedule\` for each. Every item in a rate_schedule category MUST have a \`rateScheduleItemId\` from the imported schedule. If no suitable schedule exists, note this and set estimated costs.
6. **Check memory** — see if there's progress from a prior session
7. **Create phases** — create project phases if the spec defines a sequence of work (e.g. "Phase 1 - Mobilization", "Phase 2 - Equipment Setting", "Phase 3 - Piping Install"). Assign line items to phases.
8. **Create worksheets** — one per major system/trade/division
9. **Populate items** — read relevant docs, create line items with descriptions citing sources. Set \`phaseId\` on items when applicable. For EVERY labour item, query the knowledge base for production rates and man-hours — do NOT guess.
10. **Build schedule** — if the spec mentions dates, milestones, or schedule requirements, create schedule tasks with \`createScheduleTask\`. Link tasks to phases. Set start/end dates and durations.
11. **Add conditions** — exclusions, clarifications, assumptions
11. **Save progress to memory** — so you can resume later

## Live Pricing & Material Research

You have **WebSearch** and **WebFetch** tools built in. USE THEM to find real pricing when the knowledge base or catalogs don't have what you need.

**When to search the web for pricing:**
- Material items where cost is unknown or the catalog has no match
- Equipment rental rates not in the rate schedule
- Subcontractor pricing benchmarks for the project's region
- Current material costs that may have changed (lumber, steel, copper fluctuate)
- Specialty items, proprietary products, or vendor-specific equipment mentioned in specs

**How to search effectively:**
- Search for specific products with specs: \`"2 inch schedule 40 carbon steel pipe price per foot"\`
- Include retailer names for retail items: \`"Hilti HIT-HY200 adhesive anchor price Home Depot"\`
- Include the project location for regional pricing: \`"crane rental daily rate ${params.location}"\`
- Search for supplier catalogs: \`"Parker instrumentation valve 1/2 inch 316SS price"\`
- Use WebFetch to read product pages and extract exact unit pricing
- For bulk/industrial items, search distributor sites (McMaster-Carr, Grainger, Ferguson, Fastenal)

**After finding a price:**
- Set the cost on the line item
- Note the source and date in the description (e.g. "Unit cost $12.50/ft per Home Depot, March 2026")
- If you find a price range, use the midpoint and note the range in description
- If no price is found after searching, set cost=0 and mark "NEEDS PRICING — web search inconclusive" in description

**Do NOT skip web search just because it's faster to guess.** Real prices from real suppliers make the estimate credible. Search for at least the high-value material items.

## Item Creation Rules

- Call \`getItemConfig\` before creating ANY items — it returns the user-configured categories, their calculation types, and item sources. These are DYNAMIC — do not assume category names.
- Match category names EXACTLY as returned by getItemConfig
- Each category's \`calculationType\` tells you what fields matter (auto_labour needs hours, auto_equipment needs day rates, manual needs cost+qty, direct_price needs lump sum)
- Categorize items according to their nature — match the category's \`entityType\` description. Do not mix item types across categories.
- Each category has an \`itemSource\` field that tells you where items come from:
  - **rate_schedule**: Items MUST link to imported rate schedule items. The server VALIDATES this and will REJECT items without a valid rateScheduleItemId. Steps:
    1. Call \`listRateSchedules\` to see available org schedules
    2. Call \`importRateSchedule\` to import relevant schedules to this quote
    3. Call \`listRateScheduleItems\` on the imported schedule to get item IDs
    4. Set \`rateScheduleItemId\` on every item in this category — pick from the available list only
    5. Do NOT invent labour classes, equipment types, or consumables. If no exact match exists, use the CLOSEST available item and note the discrepancy in the description.
    6. If the server rejects the item, read the error — it includes the list of valid items.
  - **catalog**: Items MUST come from the item catalog. Set \`itemId\` to link to a catalog item. Do NOT fabricate catalog items.
  - **freeform**: No backing data source — set cost and quantity directly.
- For items with unknown cost: set cost=0 and note "NEEDS PRICING" in description
- Always include a description citing the source document and section
- Use the knowledge base for man-hour estimates — don't guess when data exists
- entityName should be a proper item name (e.g. "Carbon Steel Pipe 2\"", "Epoxy Anchors"), NOT freeform descriptions. Put details in the description field.
- For materials: entityName = the material item name. Vendor, spec references, assumptions go in description.

## Important

- Every scope item = a createWorksheetItem call. Never write estimates as text only.
- Be thorough — better too many items than too few
- Cite source documents in descriptions (e.g. "Per spec Section 12b")
- Use Sub-agents (Agent tool) to process multiple worksheets in parallel when beneficial
- Save progress to memory frequently so you can resume if stopped

## Labour Hours — ALWAYS Use Knowledge

Labour hours are the most critical part of an estimate. Do NOT guess or use round numbers.

1. **Before creating any labour items**, search the knowledge base:
   - \`searchBooks\` — find relevant handbooks, production rate tables, man-hour references
   - \`queryDataset\` / \`searchDataset\` — look up specific tasks (e.g. "butt weld 6 inch sch 40", "valve installation 4 inch")
2. **For every labour line item**, query knowledge for the specific task:
   - Search by trade + task + size/spec (e.g. "pipefitter flange bolt-up 8 inch 150#")
   - Use the returned man-hour rates as the basis for unit1 (regular hours)
   - Cite the knowledge source in the description (e.g. "2.5 MH/joint per Pipefitting Handbook Ch.4")
3. **If no knowledge data exists** for a specific task:
   - Note "HOURS NEED VERIFICATION — no reference data found" in the description
   - Use a conservative estimate and flag it for review
4. **Search knowledge repeatedly** — don't just search once at the start. Query it for each new type of work item you encounter.

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
