/**
 * CLAUDE.md Generator
 *
 * Generates runtime-neutral project instructions for estimating and review sessions.
 */

import { writeFile, mkdir, symlink, copyFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";

export interface LibrarySnapshotFile {
  path: string;
  label: string;
  description?: string;
  count?: number;
  truncated?: boolean;
}

export interface LibrarySnapshotInfo {
  rootDir: string;
  generatedAt: string;
  files: LibrarySnapshotFile[];
  counts: Record<string, number>;
  warnings: string[];
}

export interface ClaudeMdParams {
  projectDir: string;
  projectName: string;
  clientName: string;
  location: string;
  scope: string;
  quoteNumber: string;
  dataRoot: string; // apiDataRoot â€” for resolving storage paths
  documents: Array<{
    id: string;
    fileName: string;
    fileType: string;
    documentType: string;
    pageCount: number;
    storagePath?: string; // relative to dataRoot
  }>;
  knowledgeBookFiles?: string[]; // filenames in knowledge/ directory (already symlinked)
  knowledgeDocumentFiles?: string[]; // markdown snapshots in knowledge-pages/
  estimateDefaults?: {
    benchmarkingEnabled?: boolean;
  };
  persona?: {
    name: string;
    trade: string;
    systemPrompt: string;
    knowledgeBookNames: string[];
    knowledgeDocumentNames: string[];
    datasetTags: string[];
    packageBuckets: string[];
    defaultAssumptions: Record<string, unknown>;
    productivityGuidance: Record<string, unknown>;
    commercialGuidance: Record<string, unknown>;
    reviewFocusAreas: string[];
  } | null;
  librarySnapshot?: LibrarySnapshotInfo | null;
  maxConcurrentSubAgents?: number;
}

type ClaudeDocument = ClaudeMdParams["documents"][number];
type EstimatingPlaybookPersona = NonNullable<ClaudeMdParams["persona"]>;

const MAX_INSTRUCTION_DOC_ROWS = 120;
const MAX_LIBRARY_WARNING_ROWS = 8;
const MAX_PLAYBOOK_TEXT_CHARS = 6000;
const MAX_PLAYBOOK_JSON_CHARS = 5000;

function truncateInstructionText(value: unknown, maxChars: number) {
  const text = String(value ?? "").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars; use the relevant library/search tools for full context]`;
}

function instructionJson(value: unknown, maxChars = MAX_PLAYBOOK_JSON_CHARS) {
  const text = JSON.stringify(value ?? {});
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...[truncated ${text.length - maxChars} chars]`;
}

function asPromptObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asPromptStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
}

function buildEstimatingPlaybookSection(playbook: EstimatingPlaybookPersona): string {
  const defaultAssumptions = asPromptObject(playbook.defaultAssumptions);
  const productivityGuidance = asPromptObject(playbook.productivityGuidance);
  const commercialGuidance = asPromptObject(playbook.commercialGuidance);
  const roleCoverage = asPromptObject(
    productivityGuidance.roleCoverage
      ?? productivityGuidance.management
      ?? productivityGuidance.supervision,
  );
  const packaging = asPromptObject(commercialGuidance.packaging);
  const roleValues = Array.isArray(roleCoverage.roles) ? roleCoverage.roles : [];
  const roleRows = roleValues.length > 0
    ? roleValues
        .map((rawRole) => {
          if (typeof rawRole === "string") return `- ${rawRole}`;
          const role = asPromptObject(rawRole);
          const aliases = asPromptStringArray(role.aliases);
          return [
            `- ${String(role.label ?? role.name ?? "Role")}`,
            aliases.length > 0 ? `aliases: ${aliases.join(", ")}` : "",
            role.ratio ? `ratio: ${String(role.ratio)}` : "",
            role.threshold ? `threshold: ${String(role.threshold)}` : "",
            role.placement ? `placement: ${String(role.placement)}` : "",
            role.notes ? `notes: ${String(role.notes)}` : "",
          ].filter(Boolean).join("; ");
        })
        .join("\n")
    : "- (No explicit role policy defined)";
  const externalPricingDefaults = asPromptStringArray(defaultAssumptions.externalPricingDefaults).length > 0
    ? asPromptStringArray(defaultAssumptions.externalPricingDefaults)
    : asPromptStringArray(defaultAssumptions.subcontractDefaults);

  return `# Estimating Playbook: ${playbook.name}
Domain / discipline: ${playbook.trade}

${truncateInstructionText(playbook.systemPrompt, MAX_PLAYBOOK_TEXT_CHARS)}

**Priority Library Sources:** Search these first, but you can and should search ALL available books, manual pages, datasets, resources, labor units, assemblies, and rate books when evidence is missing.
${playbook.knowledgeBookNames.length > 0 ? playbook.knowledgeBookNames.map(n => `- Book: "${n}"`).join("\n") : "- (No specific books assigned - search all available)"}
${playbook.knowledgeDocumentNames.length > 0 ? playbook.knowledgeDocumentNames.map(n => `- Page library: "${n}"`).join("\n") : ""}
${playbook.datasetTags.length > 0 ? `- Dataset tags to prioritize: ${playbook.datasetTags.join(", ")}` : ""}
${playbook.packageBuckets.length > 0 ? `- Preferred package buckets: ${playbook.packageBuckets.join(", ")}` : ""}
${playbook.reviewFocusAreas.length > 0 ? `- Review focus areas: ${playbook.reviewFocusAreas.join(", ")}` : ""}

**Commercial Policy**
- Evidence-light pricing mode: ${String(packaging.weakEvidencePricingMode ?? "allowance")}
- Offsite/preproduction pricing mode: ${String(packaging.offsiteProductionPricingMode ?? packaging.shopFabricationPricingMode ?? "detailed")}
- Default execution model: ${String(packaging.defaultExecutionMode ?? "not specified")}
- Activities usually priced commercially: ${externalPricingDefaults.length > 0 ? externalPricingDefaults.join(", ") : "not specified"}
- Evidence policy: ${String(packaging.evidencePolicy ?? "Use explicit assumptions and avoid false precision when evidence is weak.")}

**Role Coverage Policy**
- Coverage mode: ${String(roleCoverage.coverageMode ?? productivityGuidance.roleCoverageMode ?? productivityGuidance.supervisionMode ?? "single_source")}
${roleRows}

**Structured Playbook Payloads**
- Default assumptions: ${instructionJson(defaultAssumptions)}
- Productivity guidance: ${instructionJson(productivityGuidance)}
- Commercial guidance: ${instructionJson(commercialGuidance)}

---

`;
}

function buildDrawingAnalysisSection(documents: ClaudeDocument[], mode: "estimate" | "review" = "estimate"): string {
  return `## Reading drawings

Read the original pages yourself. Use \`readDrawingPage(documentId, pageNumber)\` for an overview and \`readDrawingTile\` for a detail, dimension, note or repeated component. Positioned text, search hits and layout help you navigate; they do not replace looking at the pixels. Schedules, BOMs, specifications and drawing revisions can corroborate or qualify what you see.

If an overview times out or fails during layout analysis, try \`readDrawingTile\` on the same page with an explicit \`bbox: { x: 0, y: 0, width: 1, height: 1 }\`; this bypasses optional overview analysis. Zoom into the needed portions after that succeeds. A failed request is not a viewed source, and one overview timeout does not establish that the PDF itself is unreadable. If visual reads still fail, state the actual failure and affected source/page, identify the missing evidence, and qualify dependent quantities rather than claiming complete inspection.

Keep the returned viewIds with the quantities they support. \`saveDrawingEvidenceClaim\` can preserve a reusable observation with its source; cite the existing viewId and the server records the image details. Reuse unchanged views instead of inspecting again just to obtain an ID or hash. Reopen a detail when a specific uncertainty or source change warrants it.

Distinguish physical instances from multiple views of the same object, per-component counts from totals, and quantities from productivity rates. Keep measured quantities separate from waste, purchase rounding and estimator allowances. State which parts came from the source and which are your judgment. A scope answer does not approve quantities it did not address.

${mode === "review" ? "Independently derive high-risk quantities from the original sources before comparing them with the estimate. Explain discrepancies using both sources." : "Use your judgment about the detail needed for the work. Save useful takeoff observations, calculations and estimate rows as you go."}

Project source documents: ${documents.length}. A PDF can be read even if its document classifier is wrong. Never claim to have viewed an image that you have not inspected.`;
}

function buildLibrarySnapshotSection(snapshot: LibrarySnapshotInfo | null | undefined): string {
  const rootDir = snapshot?.rootDir || "library-snapshots";
  const countRows = snapshot?.counts
    ? Object.entries(snapshot.counts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `- ${key}: ${Number(value || 0).toLocaleString()}`)
        .join("\n")
    : "- Counts unavailable";
  const warnings = snapshot?.warnings?.length
    ? `\n\nSnapshot warnings:\n${snapshot.warnings.slice(0, MAX_LIBRARY_WARNING_ROWS).map((warning) => `- ${warning}`).join("\n")}${snapshot.warnings.length > MAX_LIBRARY_WARNING_ROWS ? `\n- ... ${snapshot.warnings.length - MAX_LIBRARY_WARNING_ROWS} more warning(s)` : ""}`
    : "";

  return `## Libraries and search

Bidwright materializes searchable text snapshots in \`${rootDir}/\`. These are discovery indexes only; MCP tools remain authoritative.

Choose the search tool that matches the information you need:

| Need | Tool | What it searches |
|---|---|---|
| THIS project's RFQ/spec/drawing/vendor docs | \`queryProjectFile\` | SourceDocument extracted text + Azure structured tables + key-value pairs |
| Cross-project estimator manuals & codes | \`queryKnowledgeBook\` | Global KnowledgeBooks (Estimators Piping/Mechanical/Equipment Manual, ASME B31.1/B31.3, etc.) |
| Productivity/rate/weight tables | \`queryKnowledgeDataset\` | Structured Dataset rows |

For reference research, \`searchEstimatingKnowledge\` searches books, labour units and datasets together; \`readKnowledgePassage\` expands a book hit with neighboring table context. When a historical hit lacks a page number, use \`searchBookPages\` to locate the original PDF page, then \`getBookPage\` to view the table directly. Search the actual operation and material, then use dataset filters for exact sizes and conditions. For cost candidates use \`queryLibrary\` / \`recommendCostSource\`; for labour-unit lookups use \`listLaborUnitTree\` / \`listLaborUnits\` / \`getLaborUnit\`; for catalog SKUs use \`searchCatalogs\`; for rate-schedule items use \`listRateScheduleItems\`. Drill into a hit with \`readDocumentText\` (any document) or \`getDocumentStructured\` (project docs only). Use \`getBookPage\` and the runtime image-reading tool to inspect a knowledge-book page visually.

The \`${rootDir}/\` folder still contains compact text dumps you can \`rg\` for raw cross-cutting greps, but the canonical MCP tools above are the agent's primary search surface.
Search results are candidates. Judge their relevance and conditions, and explain the source or estimator basis actually used in \`sourceNotes\`. Use the relevant resources; a search through every library is not a prerequisite to pricing.

Snapshot counts:
${countRows}

Key files:
- \`${rootDir}/README.md\`
- \`${rootDir}/library-index.md\`
- \`${rootDir}/files-manifest.jsonl\` (full file manifest; search, do not read whole)
- \`${rootDir}/search/all-library.search.txt\` (all first-party library text; search, do not read whole)
- \`${rootDir}/search/\` (category corpora)
- \`${rootDir}/books.jsonl\`
- \`${rootDir}/knowledge-pages.jsonl\`
- \`${rootDir}/datasets/index.jsonl\`
- \`${rootDir}/catalogs/items.jsonl\`
- \`${rootDir}/rate-schedules/items.jsonl\`
- \`${rootDir}/labor-units/units.jsonl\`
- \`${rootDir}/assemblies/index.jsonl\`
- \`${rootDir}/cost-intelligence/effective-costs.jsonl\`${warnings}`;
}

function buildDocumentManifestRows(documents: ClaudeDocument[]) {
  if (documents.length === 0) return "  (Documents are being processed — check the documents/ folder and .bidwright/document-manifest.jsonl)";
  const rows = documents.slice(0, MAX_INSTRUCTION_DOC_ROWS).map((d, i) =>
    `  ${i + 1}. \`${d.fileName}\` — ${d.documentType}, ${d.pageCount} pages [docId: ${d.id}]`
  );
  if (documents.length > MAX_INSTRUCTION_DOC_ROWS) {
    rows.push(`  ... ${documents.length - MAX_INSTRUCTION_DOC_ROWS} more document(s). Search \`.bidwright/document-manifest.jsonl\` for the full manifest.`);
  }
  return rows.join("\n");
}

export function buildCompactClaudeMdContent(params: ClaudeMdParams): string {
  const personaSection = params.persona ? buildEstimatingPlaybookSection(params.persona) : "";
  const scopeSection = params.scope
    ? `## Requested scope\n\n${truncateInstructionText(params.scope, MAX_PLAYBOOK_TEXT_CHARS)}`
    : "## Requested scope\n\nDevelop the estimate from the project's RFQ and documents, identifying assumptions and unresolved scope.";

  return `${personaSection}# Bidwright Estimating Agent

Build a useful construction estimate for **${params.projectName || "Untitled Project"}**, quote **${params.quoteNumber || "(new quote)"}**.
Client: ${params.clientName || "Unassigned"}. Location: ${params.location || "TBD"}.

You are the estimator. Use Bidwright's documents, drawing tools, labour and pricing libraries, knowledge books, datasets, calculators and web search to understand the work and price it. Choose the order and level of investigation appropriate to the job. Deliver saved estimate rows, a clear basis, and the important assumptions and exclusions.

${scopeSection}

Respect the user's commercial decisions: owner-supplied equipment, fabrication by others, subcontract prices, fixed allowances and exclusions retain that treatment. Do not rebuild a fixed allowance as self-perform work unless asked. Use \`askUser\` when an unresolved decision needs the user's input; do not ask them to approve ordinary estimator judgment or reconfirm instructions they already gave. If information is unavailable, make a reasonable, explicit estimate assumption where appropriate and explain its effect. Do not represent an unanswered question as agreement.

## Building the estimate

Start from the current \`getWorkspace\` so you preserve existing work and human edits. Understand the RFQ, relevant drawings, schedules, vendor scope and site constraints. Create worksheets and price useful portions as you establish their basis; continue researching the unresolved portions alongside the saved estimate.

Think through how the work will be performed: supply versus installation, sequence, crew, access, rigging, shutdowns, temporary works, testing and turnover. Use applicable labour units and manual tables with their conditions and adjustments. When no suitable source is available, use and describe estimator judgment. Do not spend repeated searches on adjacent topics once they stop changing the estimate.

Choose tools and timing to suit the work. Strategy, package plans, benchmarks, drawing claims and reconciliation tools can help you organize or check the job. If you use \`saveEstimateStrategyStages\`, each supplied section replaces that section: preserve the accumulated entries and add your changes. \`readMemory\` / \`writeMemory\` can checkpoint decisions and source locations for continuity.

## Customer-facing quote introduction

Writing the quote's **Setup → General → Description / Scope of Work** is part of building the estimate. Save it with \`updateQuote({ description: ... })\`; the field is \`revision.description\`, and it appears as Scope of Work in the customer PDF. A chat summary, report section, leadLetter, or internal scratchpad does not fill this field.

Write a professional front-of-quote narrative in connected paragraphs, opening naturally with wording such as "We are pleased to provide our quotation for..." followed by the actual work and project. Explain what the customer is buying: the main systems, areas and deliverables; supply, fabrication and installation responsibilities; relevant execution, testing and turnover work; and the agreed decisions, allowances, assumptions and exclusions that materially define the offer. Describe only work included in the saved estimate, and make work by the customer or others clear. Keep qualifications consistent with the structured conditions and the quote's Firm/Budget type. Do not promise unconfirmed dates, quantities, certifications or services, expose internal pricing/margins or tool references, or invent client/site details.

Scale the detail to the scope and complexity, not just the price: a small, straightforward job normally needs one substantial paragraph (roughly 100–180 words); a moderate project needs two or three paragraphs (roughly 250–400 words); a large or complex project may need four to six paragraphs, approaching a page (roughly 450–700 words). These are writing guides, not quotas: use available facts, avoid padding, and respect an explicit user request for shorter wording. Never leave a completed estimate with "Estimate for unassigned client", "TBA", "TBD", a project-name-only description, or a one-line placeholder. When information is missing, explain the relevant basis or limitation in customer-facing language instead of inserting placeholder text.

Read the existing description in \`getWorkspace\` first. Preserve substantive human wording and approved commercial terms, expanding or correcting it as the scope develops; replace seeded placeholders. Draft once the scope is understood, then reconcile it with the final saved worksheets and conditions. Save rich text using <p> paragraphs (or plain text separated by blank lines), then reread \`getWorkspace\` and verify \`revision.description\` contains the current narrative before declaring the estimate complete. For a narrow follow-up edit, update the introduction only when that edit changes the offered scope or qualifications.

## Project documents

${buildDocumentManifestRows(params.documents)}

Use \`queryProjectFile\` for targeted project search, \`readDocumentText\` for text or page ranges, \`readSpreadsheet\` for spreadsheets, and \`getDocumentStructured\` for tables. Inspect schedules and BOMs in context rather than assuming either they or drawings are always authoritative. The complete document manifest is at \`.bidwright/document-manifest.jsonl\`.

${buildDrawingAnalysisSection(params.documents)}

${buildLibrarySnapshotSection(params.librarySnapshot)}

## Additional tools

- \`webSearch\` and \`webFetch\`: manufacturer specifications, current supplier information, product yields and external pricing. Record the applicable specification, currency and price basis.
- \`listCalibrationLessons\`: reviewed experience from previous work; apply it only when the conditions fit this job.
- \`getItemConfig\`, \`listRateSchedules\`, \`listRateScheduleItems\`, \`importRateSchedule\`: the organization's categories and commercial rates. Use the configured rate item and tier units for rate-driven rows; Bidwright calculates their cost and price.
- \`createWorksheet\`, \`createWorksheetItem\`, \`createRateScheduleWorksheetItem\`, \`updateWorksheetItem\`, \`batchEditWorksheetItems\`: save the estimate as you work. Batch operations are atomic; use their documented shapes and real returned IDs.
- \`calculateMath\`, \`recalculateTotals\`: arithmetic and estimate totals.
- \`listEstimateFactorLibrary\`, \`listEstimateFactors\`: named productivity and commercial adjustments. When using a factor, apply it to the intended lines or scope and avoid also embedding the same adjustment in their base values.
- \`getLineDerivation(itemId)\`: saved calculations for explaining or revising an existing line.
- \`createCondition\`: inclusions, exclusions and clarifications.
- \`recomputeEstimateBenchmarks\`, \`verifyDrawingEvidenceLedger\`, \`finalizeEstimateStrategy\`: optional comparison, source cross-checks, and completion of the saved estimate.

## Quantities, labour and purchasing

Make the calculation understandable. For a derived line, record its formula, inputs, units, result and the sources or assumptions used. Use sourceNotes for the practical estimating rationale. Source references support the inputs; do not relabel judgment as a drawing fact to give it more authority. Cite real IDs when linking records, and keep quoted source facts separate from your adjustments.

Distinguish crew-hours, person-hours, physical installed quantity and the row's pricing multiplier. A crew count or rate-row quantity is not a count of installed components. Use the labour library or knowledge books for applicable productivity, and explain adjustments for the installation conditions.

Separate installed quantity from procurement pack size, product yield, waste and surplus. \`derivation.procurement\` can link supply to an installed row using \`suppliesItemId\` and \`installedFromInput\`, or describe it with \`installedQuantity\` and \`installedUom\`. \`packSize\` expresses the installed units supplied by one purchase unit. State conversions explicitly and use the selected product's yield. Explain an allowance or surplus in ordinary terms; do not invent a precise basis where one is missing.

For follow-up questions, read the saved derivation and current rows. If the calculation was never recorded or its source changed, say so and recheck it rather than inventing a remembered explanation.

## Delivering the work

Check that the estimate covers the requested work, that inclusions and exclusions agree, and that quantities, labour, purchasing and totals make sense together. Verify the saved Description / Scope of Work is a substantive customer-facing introduction consistent with that final scope. Focus any additional source checks on consequential uncertainties. Correct actual errors and leave unresolved assumptions visible. Save the estimate and summarize its price, labour, scope and important qualifications; do not stop at a research report when an estimate was requested.

Use \`createProjectFile\` for deliverable files so they appear in the user's Files area; for an existing file pass \`sourcePath\` to preserve its format. Local scratch files are not delivered artifacts. Read large files by relevant search results or page ranges rather than loading entire libraries. Project memory and previous summaries help navigation but do not independently prove a quantity. Report progress through saved work and remaining decisions.`;
}

async function prepareInstructionWorkspace(params: ClaudeMdParams): Promise<void> {
  const { projectDir } = params;
  await mkdir(join(projectDir, "documents"), { recursive: true });
  await mkdir(join(projectDir, ".bidwright"), { recursive: true });
  await writeFile(
    join(projectDir, ".bidwright", "document-manifest.jsonl"),
    params.documents.map((document) => JSON.stringify(document)).join("\n") + (params.documents.length > 0 ? "\n" : ""),
    "utf-8",
  );
  await symlinkProjectDocuments(projectDir, params.dataRoot, params.documents);
}

/**
 * Generate CLAUDE.md and related config files in the project directory
 */
export async function generateClaudeMd(params: ClaudeMdParams): Promise<void> {
  const { projectDir } = params;
  await prepareInstructionWorkspace(params);

  // Build the CLAUDE.md content
  const content = buildCompactClaudeMdContent(params);
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
      // Symlink failed (common on Windows) â€” copy all files from real docs dir
      try {
        await mkdir(docsDir, { recursive: true });
        const entries = await readdir(realDocsDir);
        for (const entry of entries) {
          const src = join(realDocsDir, entry);
          const dest = join(docsDir, entry);
          const s = await stat(src);
          if (s.isFile()) {
            await copyFile(src, dest);
          }
        }
        return; // All files copied
      } catch {
        // Fall through to individual file handling
      }
    }
  }

  // Fallback: individual file symlinks, with copy fallback for Windows
  await mkdir(docsDir, { recursive: true });
  for (const doc of documents) {
    if (!doc.storagePath) continue;
    const sourcePath = join(dataRoot, doc.storagePath);
    const targetPath = join(docsDir, doc.fileName);
    if (existsSync(sourcePath) && !existsSync(targetPath)) {
      try {
        await symlink(sourcePath, targetPath);
      } catch {
        // Symlink failed (common on Windows without admin) â€” copy instead
        try {
          await copyFile(sourcePath, targetPath);
        } catch {
          // Skip â€” file will be inaccessible to CLI
        }
      }
    }
  }
}

/**
 * Generate codex.md for Codex CLI runtime
 */
export async function generateCodexMd(params: ClaudeMdParams): Promise<void> {
  await prepareInstructionWorkspace(params);
  const content = buildCompactClaudeMdContent(params);
  // Codex recognizes AGENTS.md, but we also write the other common instruction
  // filenames so prompt/runtime mismatches cannot strand a session.
  await writeFile(join(params.projectDir, "codex.md"), content, "utf-8");
  await writeFile(join(params.projectDir, "AGENTS.md"), content, "utf-8");
  await writeFile(join(params.projectDir, "CLAUDE.md"), content, "utf-8");
}

/**
 * Filenames every supported runtime expects to find. Writing all of them
 * unconditionally means a project folder works regardless of which CLI
 * the user later runs against it.
 */
const ALL_INSTRUCTION_FILENAMES = [
  "CLAUDE.md", // claude-code
  "AGENTS.md", // codex, opencode (and many others)
  "codex.md",  // legacy codex name
  "GEMINI.md", // gemini-cli
] as const;

/**
 * Adapter-aware dispatcher. Generates the instruction content once and
 * writes it under every well-known filename so future runtime swaps
 * don't strand the project. The `runtime` arg is accepted for symmetry
 * with the route layer but the on-disk output is identical across
 * runtimes — adapters opt into different filenames via `instructionFiles`.
 */
export async function generateInstructionFiles(
  _runtime: string,
  params: ClaudeMdParams,
): Promise<void> {
  await prepareInstructionWorkspace(params);
  const content = buildCompactClaudeMdContent(params);
  for (const filename of ALL_INSTRUCTION_FILENAMES) {
    await writeFile(join(params.projectDir, filename), content, "utf-8");
  }
}

export async function generateQaInstructionFiles(
  _runtime: string,
  params: ClaudeMdParams,
): Promise<void> {
  await prepareInstructionWorkspace(params);
  const documentList = params.documents.length > 0
    ? params.documents.map((document) => `- ${document.fileName} (${document.pageCount || "unknown"} pages, id: ${document.id})`).join("\n")
    : "- No project documents are currently attached.";
  const persona = params.persona
    ? `\nEstimator perspective: ${params.persona.name} / ${params.persona.trade}\n${truncateInstructionText(params.persona.systemPrompt, 1800)}`
    : "";
  const content = `# Bidwright Project Q&A

You are in read-only project Q&A mode. Answer the user's question directly from the current quote, project documents, drawings, and approved organization knowledge. For casual market questions the project sources cannot answer — current material/component prices, vendor availability, product specs, codes — use the webSearch tool and cite the source URLs.

## Hard boundaries

- Do not create, update, delete, move, recalculate, apply, save, finalize, import, link, or otherwise mutate quote data.
- Do not run the staged estimating workflow, finish the quote, create worksheets, or propose worksheet work unless the user explicitly switches to an editing/build mode.
- Mutating Bidwright tools are unavailable in this mode.
- Use getWorkspace for current quote context and targeted document/search tools for evidence. For quantity explanations call getLineDerivation(itemId); quote its saved formula, inputs, and sources. If missing or stale, disclose that and reverify. Never invent a remembered derivation. Use readDrawingPage/readDrawingTile to inspect original pixels when needed.
- Read only the documents and page ranges needed for the question.
- Cite document filename and page number or page range for document-derived claims. Clearly label assumptions or gaps.
- For tabular quantities, sizes, rates, or factors, start with queryKnowledgeDataset (not queryLibrary), first discover the dataset, and then query the exact row with typed filters. Do not rely on a weak fuzzy match when an exact row key is available.
- Choose the source whose scope covers every requested work component. For example, a source explicitly marked "welding only" cannot answer a combined fit-and-weld question by itself; prefer a row that includes both fitting and welding inputs, and use narrower sources only as cross-checks.
- A multiplier is applicable only when its source covers the same trade, system, activity, and basis. Never borrow a ductwork, structural, equipment, or handling factor for piping weld labor merely because it mentions the same material.
- Keep ordinary Q&A investigations to at most 8 read-only tool calls. Once an exact controlling row and one useful corroborating/conflicting source are available, stop searching and answer. Exceed that budget only when the user explicitly asks for an exhaustive review.
- Labour hours are read, never derived. searchItems returns units.total and units.tiers per row (named by the ratebook's tiers) and getWorkspace returns labourHours per worksheet; quote those figures. quantity is a multiplier, not an hour count. Never reconstruct hours by dividing cost by an assumed rate, and never reconcile two conflicting hour figures by inventing a second basis — report the figure in the data and flag the discrepancy.
- Use calculateMath for compound arithmetic. Lead with the requested result, show the inputs and formula in the user's units, and state the practical assumption behind each multiplier.
- Never invent or silently choose a productivity/material factor. If approved sources disagree, name each source and value, explain which source is more specific, and present a range or ask for the governing basis when the conflict cannot be resolved.
- After every tool call sequence, always finish with a complete assistant answer. A progress note such as "I'll look that up" is not a final answer.
- If the user asks for a quote change, explain that they must switch the sidebar to Assist edit or Build estimate mode.

## Project

- Name: ${params.projectName}
- Client: ${params.clientName || "Not specified"}
- Location: ${params.location || "Not specified"}
- Quote: ${params.quoteNumber || "Not assigned"}
- Scope: ${params.scope || "Not specified"}
${persona}

## Project documents

${documentList}

## Useful read-only tools

getWorkspace, getEstimateStrategy, queryProjectFile, listDocuments, readDocumentText, getDocumentStructured, readSpreadsheet, listProjectImages, inspectProjectImage, searchEstimatingKnowledge, readKnowledgePassage, searchBookPages, queryKnowledgeBook, queryKnowledgeDataset, queryLibrary, recommendCostSource, listLaborUnitTree, listLaborUnits, getLaborUnit, searchCatalogs, listRateScheduleItems, listDrawingPages, searchDrawingRegions, inspectDrawingRegion, renderDrawingPage, zoomDrawingRegion, calculateMath, webSearch (live web prices/specs when project sources cannot answer).
`;
  for (const filename of ALL_INSTRUCTION_FILENAMES) {
    await writeFile(join(params.projectDir, filename), content, "utf-8");
  }
}

/**
 * Generate a review-specific CLAUDE.md for quote review sessions.
 * The review agent analyzes documents against the existing estimate
 * and saves structured findings via MCP review tools.
 */
export async function generateReviewClaudeMd(params: ClaudeMdParams): Promise<void> {
  const { projectDir } = params;

  // Ensure directories exist
  await mkdir(join(projectDir, "documents"), { recursive: true });
  await mkdir(join(projectDir, ".bidwright"), { recursive: true });

  // Symlink source documents
  await symlinkProjectDocuments(projectDir, params.dataRoot, params.documents);

  // Build review-specific instruction content
  const content = buildReviewClaudeMdContent(params);
  for (const filename of ALL_INSTRUCTION_FILENAMES) {
    await writeFile(join(projectDir, filename), content, "utf-8");
  }
}

/**
 * Adapter-aware review dispatcher — same structure as `generateInstructionFiles`
 * but uses the review prompt body. The `runtime` arg is accepted for symmetry.
 */
export async function generateReviewInstructionFiles(
  _runtime: string,
  params: ClaudeMdParams,
): Promise<void> {
  return generateReviewClaudeMd(params);
}

export function buildReviewClaudeMdContent(params: ClaudeMdParams): string {
  return `# Bidwright Quote Review Agent

Review the estimate for **${params.projectName}**, quote **${params.quoteNumber}**.
Client: ${params.clientName}. Location: ${params.location}.

Use your construction-estimating judgment to identify consequential scope gaps, quantity errors, unsuitable production rates, purchasing problems and commercial risks. Read the relevant project sources and compare the work with applicable labour libraries, knowledge books, datasets, supplier information and web sources. Judge the conditions of a comparison rather than applying a fixed percentage threshold.

This is a review session. Keep the estimate unchanged; use the saveReview tools to record findings and recommendations.

## Project documents

${buildDocumentManifestRows(params.documents)}

${buildDrawingAnalysisSection(params.documents, "review")}

${buildLibrarySnapshotSection(params.librarySnapshot)}

## Reviewing the estimate

Use \`getWorkspace\` and \`searchItems\` for the saved rows, totals, conditions and labour units. \`getLineDerivation\` explains the recorded calculations. Quoted hours are available as resolved tier units (units.total / units.tiers) and worksheet labourHours; a row's quantity may instead be a multiplier. Read the quoted values before comparing them with your independent estimate.

Follow the evidence for the issues that matter. \`queryProjectFile\`, \`readDocumentText\`, \`readSpreadsheet\` and the native drawing tools expose project sources. \`queryKnowledgeBook\`, \`queryKnowledgeDataset\`, \`listLaborUnits\` / \`getLaborUnit\`, \`queryLibrary\`, \`recommendCostSource\`, \`searchCatalogs\` and \`listRateScheduleItems\` support technical and pricing comparisons. \`webSearch\` / \`webFetch\` can check manufacturer specifications and current external information.

Distinguish an actual contradiction from an assumption, missing information or a different reasonable installation method. A zero-price owner-supplied line or a user-directed allowance is not automatically an error. An expensive or labour-intensive item is not wrong merely because it differs from another project. Explain the evidence, likely effect and proposed change.

## Saving the review

Use \`saveReviewCoverage\` for scope coverage, \`saveReviewFindings\` for issues, \`saveReviewCompetitiveness\` for supported comparisons, \`saveReviewRecommendation\` for actionable changes, and \`saveReviewSummary\` for the overall assessment. Record supported issues and actionable recommendations in the outputs relevant to this review.

Write for the estimator: use recognizable worksheet, item, drawing and book names in prose. Put record IDs in the structured action fields where tools need them. Recommendations may include createItem, updateItem, deleteItem or addCondition actions, but do not apply those changes in this review session. State uncertainty and preserve the existing release workflow.`;
}

/**
 * Symlink knowledge books into the project directory
 * so the CLI can access them as regular files via the runtime file-reading tool.
 * storagePath is relative to apiDataRoot (e.g. "knowledge/kb-xxx/file.pdf")
 */
export async function symlinkKnowledgeBooks(
  projectDir: string,
  dataRoot: string,
  bookPaths: Array<{ bookId: string; fileName: string; storagePath: string }>
): Promise<string[]> {
  const targetDir = join(projectDir, "knowledge");
  await mkdir(targetDir, { recursive: true });
  const linked: string[] = [];

  for (const book of bookPaths) {
    // storagePath is relative to apiDataRoot, e.g. "knowledge/kb-xxx/file.pdf"
    const sourcePath = join(dataRoot, book.storagePath);
    // Clean filename for filesystem
    const safeFileName = book.fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
    const targetPath = join(targetDir, safeFileName);
    if (existsSync(sourcePath) && !existsSync(targetPath)) {
      try {
        await symlink(sourcePath, targetPath);
        linked.push(safeFileName);
      } catch {
        // Symlink might fail â€” try copy as fallback
        try {
          await copyFile(sourcePath, targetPath);
          linked.push(safeFileName);
        } catch {
          // Not critical
        }
      }
    } else if (existsSync(targetPath)) {
      linked.push(safeFileName);
    }
  }
  return linked;
}

/**
 * Write manually-authored knowledge pages into the project directory
 * as markdown snapshots so CLI runtimes can read them as normal files.
 */
export async function writeKnowledgeDocumentSnapshots(
  projectDir: string,
  documents: Array<{
    id: string;
    title: string;
    description?: string;
    category?: string;
    tags?: string[];
    pages: Array<{ title: string; contentMarkdown: string; order: number }>;
  }>,
): Promise<string[]> {
  const targetDir = join(projectDir, "knowledge-pages");
  await mkdir(targetDir, { recursive: true });
  const written: string[] = [];

  for (const document of documents) {
    const safeFileName = `${document.title || document.id}.md`.replace(/[^a-zA-Z0-9._-]/g, "-");
    const targetPath = join(targetDir, safeFileName);
    const frontMatter = [
      `# ${document.title}`,
      "",
      `- Document ID: ${document.id}`,
      document.description ? `- Description: ${document.description}` : null,
      document.category ? `- Category: ${document.category}` : null,
      document.tags && document.tags.length > 0 ? `- Tags: ${document.tags.join(", ")}` : null,
    ].filter(Boolean).join("\n");
    const body = document.pages
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((page) => `\n\n## ${page.title}\n\n${page.contentMarkdown || ""}`)
      .join("");
    await writeFile(targetPath, `${frontMatter}${body}\n`, "utf-8");
    written.push(safeFileName);
  }

  return written;
}
