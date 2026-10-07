/**
 * CLAUDE.md Generator
 *
 * Generates the project-level instruction file that Claude Code reads
 * when starting a session. This replaces the old intake-prompt.ts system prompt.
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

function isDrawingLikeDocument(doc: ClaudeDocument): boolean {
  const documentType = (doc.documentType ?? "").toLowerCase();
  const fileType = (doc.fileType ?? "").toLowerCase();
  const fileName = (doc.fileName ?? "").toLowerCase();

  if (documentType === "drawing") return true;
  if (fileType !== "application/pdf") return false;

  return /(p&?id|pid|drawing|plan|sheet|layout|elevation|section|detail|isometric|(?:^|[^a-z])iso(?:[^a-z]|$)|schematic|one[- ]?line|single[- ]?line|riser|reflected ceiling|general arrangement|\bga\b)/.test(fileName);
}

function buildDrawingAnalysisSection(documents: ClaudeDocument[], mode: "estimate" | "review" = "estimate"): string {
  return `## Native drawing reading

You are the page reader. No separate perception model interprets the sheets for you. Positioned text and layout are navigation aids, not verified takeoff.
1. Inventory the source documents, schedules, revisions, and exclusions. Register missing source PDFs through the document tools; generated summaries are derived material, never independent evidence.
2. Use readDrawingPage(documentId, pageNumber) for a sheet overview, positioned text, and tile map. Use readDrawingTile for details, notes, schedules, dimensions, and repeated elements. These tools return image pixels AND a viewId. Inspect the returned images yourself; rendering a file or reading OCR alone is not visual inspection.
3. Identify components and physical instances across plan/elevation/detail views; do not count multiple views of one object twice. Distinguish per-instance callouts from totals. An explicit one-hole note cannot justify a four-anchor-per-plate factor.
4. Preserve document/page/bbox, revision, viewId, source text, and uncertainties for each derived quantity. Cite evidenceBasis.quantity.viewIds and claim IDs where applicable. Do not invent IDs or claim inspection when the image was not delivered. Existing region-search and inspection tools remain available for targeted navigation.
5. ${mode === "review" ? "Independently derive high-risk counts and dimensions from source pages before reading the estimator's quantities; then compare, record discrepancies with both sources, and save review findings only." : "Save drawing claims and per-line derivations with formula, typed inputs, source references, and result. Mark per-component factors with perInstance:true and instanceOf (for example anchors per base plate); keep the physically counted instance input separate. Use calculateMath for arithmetic; reconcile per-instance factors, physical instance counts, and purchased pack quantities separately."}
6. When sources conflict, preserve both. A newer date alone does not prove a partial note supersedes a complete schedule; look for explicit supersession, governing scope, or askUser with regionRef/viewId. Carry unresolved quantities as assumptions, never verified facts.
7. Stop zooming once the controlling detail and instance count are supported. Ask for missing dimensions, scale, or scope when they materially affect price. Image delivery is auditable; correctness still requires interpretation and reconciliation.

Project source documents: ${documents.length}. All relevant drawing PDFs may be read even when their classifier is wrong.`;
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

  return `## Library Snapshots (Start Here)

Bidwright materializes searchable text snapshots in \`${rootDir}/\`. These are discovery indexes only; MCP tools remain authoritative.

Before pricing, reviewing, or delegating worksheet work, use the three first-class search lanes:

| Need | Tool | What it searches |
|---|---|---|
| THIS project's RFQ/spec/drawing/vendor docs | \`queryProjectFile\` | SourceDocument extracted text + Azure structured tables + key-value pairs |
| Cross-project estimator manuals & codes | \`queryKnowledgeBook\` | Global KnowledgeBooks (Estimators Piping/Mechanical/Equipment Manual, ASME B31.1/B31.3, etc.) |
| Productivity/rate/weight tables | \`queryKnowledgeDataset\` | Structured Dataset rows |

For cost candidates use \`queryLibrary\` / \`recommendCostSource\`; for labour-unit lookups use \`listLaborUnitTree\` / \`listLaborUnits\` / \`getLaborUnit\`; for catalog SKUs use \`searchCatalogs\`; for rate-schedule items use \`listRateScheduleItems\`. Drill into a hit with \`readDocumentText\` (any document) or \`getDocumentStructured\` (project docs only). Use \`getBookPage\` then \`Read\` to view a knowledge-book PDF page visually.

The \`${rootDir}/\` folder still contains compact text dumps you can \`rg\` for raw cross-cutting greps, but the canonical MCP tools above are the agent's primary search surface.
5. The agent is the intelligence layer: search tools retrieve candidates only. You decide relevance, source authority, exact/similar/context/manual basis, and the final worksheet source rationale.
6. Every priced row must cite the actual source used in \`sourceNotes\`.

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
  const benchmarkingEnabled = params.estimateDefaults?.benchmarkingEnabled !== false;
  const personaSection = params.persona ? buildEstimatingPlaybookSection(params.persona) : "";
  const scopeSection = params.scope
    ? `## Scope (User Instruction - Authoritative)\n\n${truncateInstructionText(params.scope, MAX_PLAYBOOK_TEXT_CHARS)}\n\nInterpret commercial directives literally. If scope says subcontracted, externally priced, owner/client supplied, fixed price, allowance, or already quoted, carry that treatment instead of rebuilding it as self-perform labour unless the user asks for validation.`
    : "## Scope\n\nNo specific scope was entered. Estimate the full bid package after reading all documents.";

  return `${personaSection}# Bidwright Estimating Agent

You are building quote **${params.quoteNumber || "(new quote)"}** for **${params.projectName || "Untitled Project"}**.

- Client: ${params.clientName || "Unassigned"}
- Location: ${params.location || "TBD"}
- Project directory: use files here as local working context, but use Bidwright MCP tools for authoritative reads/writes.

${scopeSection}

## Hard Limits

- Do not read giant files wholesale. Use \`readDocumentText\` with pages/maxChars/offset, the three search lanes (\`queryProjectFile\` / \`queryKnowledgeBook\` / \`queryKnowledgeDataset\`), and \`rg\` on \`library-snapshots/search/\` only when you need a raw cross-cutting grep.
- Do not read \`library-snapshots/files-manifest.jsonl\` or large JSONL row files end-to-end.
- If a tool says a file is too large, narrow the request by page/range/search term instead of retrying the same read.
- Any document you produce FOR THE USER — a BOM, takeoff summary, scope narrative, quantity spreadsheet — must be saved with \`createProjectFile\` so it lands in the project's Files area. Writing it to your working directory does not count as delivering it: the user cannot see those files and they are discarded when the run ends.
- When the artifact is already a file, pass \`sourcePath\` and let it be copied byte-for-byte. Writing it to the project's files directory with a shell command does NOT register it — the user's file browser lists registered files, so a file you only wrote to disk is invisible to them. Do NOT convert a spreadsheet to CSV to save it, and do not paste a file's contents through the conversation — both lose fidelity and are far slower than a direct copy.
- Use only Bidwright \`readMemory\` / \`writeMemory\` for project memory. Do not read, grep, inspect, write, or edit Claude global/project memory files under \`~/.claude\`, previous-run memory folders, or prior harness summaries unless the user explicitly provided them as current project inputs.

## Startup Checklist

1. Call \`getWorkspace\` and \`getEstimateStrategy\` before making changes. Resume existing worksheets/strategy instead of duplicating them.
2. Read \`library-snapshots/README.md\` and \`library-snapshots/library-index.md\` only. They are the compact map. Use the three search lanes (\`queryProjectFile\`, \`queryKnowledgeBook\`, \`queryKnowledgeDataset\`) for canonical retrieval; \`rg\` over \`library-snapshots/search/\` is a raw fallback for cross-cutting greps.
3. Read the main RFQ/spec first, then every project document using MCP tools. Use \`.bidwright/document-manifest.jsonl\` only as a searchable manifest if the inline list is truncated.
4. Inventory spreadsheet/BOM/parts-list/takeoff artifacts before visual takeoff. Read spreadsheets with \`readSpreadsheet\`; read table-heavy PDF BOMs/parts lists with \`getDocumentStructured\` and \`readDocumentText\`. Treat those as gold-standard quantity sources when present.
5. Read drawing overviews with \`readDrawingPage\`, then inspect controlling details with \`readDrawingTile\`. Keep returned viewIds and per-line derivations. Use the atlas for targeted search when helpful. Save and verify drawing claims before pricing; OCR alone is not a visual takeoff.
6. Update quote name/client/scope with \`updateQuote\` as soon as the RFQ/spec identifies them.
7. Save coherent strategy stages without repeated ceremonial calls. Skip benchmark adjustments when no comparables exist, but always complete final reconciliation. Save strategy before detailed pricing: \`saveEstimateScopeGraph\`, \`saveEstimateExecutionPlan\`, \`saveEstimateAssumptions\`, \`saveEstimatePackagePlan\`${benchmarkingEnabled ? ", `recomputeEstimateBenchmarks`" : ""}, \`saveEstimateAdjustments\`.
8. Use \`askUser\` for unresolved scope or commercial questions that materially affect price; do not re-confirm clear user instructions.
9. Before worksheets/items, search the three lanes for the major cost and production drivers: \`queryProjectFile\` for project documents, \`queryKnowledgeBook\` for global manuals, \`queryKnowledgeDataset\` for productivity tables. Then drill into the structured cost/labour/rate tools for IDs: \`queryLibrary\`, \`recommendCostSource\`, \`listLaborUnitTree\`, \`listLaborUnits\`, \`getLaborUnit\`, \`listRateScheduleItems\`, \`searchCatalogs\`. You decide the basis from the evidence.
10. Create worksheets/items only after the staged strategy is saved and evidence is collected.
11. Use estimate factors for productivity, access, weather, safety, schedule, method, condition, escalation, or other multiplicative adjustments. Use \`listEstimateFactorLibrary\` / \`listEstimateFactors\`; create global factors with \`applicationScope: "global"\` and scoped filters, and after worksheet items exist create line-level factors with \`applicationScope: "line"\` plus \`scope: { mode: "line", worksheetItemIds: [...] }\`. Cite the basis in \`sourceRef\`, then \`recalculateTotals\` / \`getWorkspace\` to verify target lines and factor deltas. Do not hide factor effects inside worksheet quantities, tierUnits, unit costs, or hand-calculated labour values.
12. Before finalizing: call \`getWorkspace\`, perform a line-item QA pass, then deliberately return to source evidence for the highest-risk quantities and labour drivers: re-search/inspect the governing drawing/model/takeoff evidence or re-read the governing BOM/spec/knowledge source behind the largest or riskiest rows. Repair rows and factors before \`recalculateTotals\`, ${benchmarkingEnabled ? "`recomputeEstimateBenchmarks`, " : ""}re-save \`saveEstimatePackagePlan\` with exact worksheet bindings, \`saveEstimateReconcile\`, \`applySummaryPreset\`, and only then \`finalizeEstimateStrategy\`.

## Project Documents

Use document IDs below with \`readDocumentText\`, \`readSpreadsheet\`, and \`getDocumentStructured\`.

${buildDocumentManifestRows(params.documents)}

Document rules:
- Read every listed document. For long PDFs, read by page ranges.
- Use \`readSpreadsheet\` for XLS/XLSX files.
- Use \`getDocumentStructured\` for table-heavy PDFs/forms, especially BOMs, parts lists, schedules, quote sheets, and takeoff tables.
- Before doing visual takeoff, explicitly search the manifest for filenames or extracted text containing BOM, bill of materials, parts list, material list, schedule, takeoff, or quantity. If one exists, use it as the quantity baseline and use drawings to verify coverage/detail.
- For drawing-driven quantities, use \`readDrawingPage\`, \`readDrawingTile\`, \`saveDrawingEvidenceClaim\`, and \`verifyDrawingEvidenceLedger\` before quantity assumptions. Use \`renderDrawingPage\` / \`zoomDrawingRegion\` only as lower-level fallbacks, and use \`countSymbols\` only after you have identified a specific small representative symbol/bounding box.

${buildDrawingAnalysisSection(params.documents, "estimate")}

## Knowledge And Library Use

${params.knowledgeBookFiles?.length
  ? `Knowledge books are available through MCP and symlinked under \`knowledge/\`. Search/list first, read table of contents, then relevant chapters only. Priority files: ${params.knowledgeBookFiles.slice(0, 20).map((f) => `\`${f}\``).join(", ")}${params.knowledgeBookFiles.length > 20 ? `, plus ${params.knowledgeBookFiles.length - 20} more` : ""}.`
  : "Use `queryKnowledgeBook` and `listKnowledgeBooks` for global knowledge books."}

${params.knowledgeDocumentFiles?.length
  ? `Manual knowledge pages are available through MCP and snapshots under \`knowledge-pages/\`. Search first, then read relevant pages only.`
  : "Manual knowledge pages may still be available through `queryKnowledgeBook` and `listKnowledgeDocuments`."}

${buildLibrarySnapshotSection(params.librarySnapshot)}

## Core MCP Tools

- Project-wide search: \`queryProjectFile\` (ranked hits across THIS project's PDFs/spreadsheets/Azure tables/key-values in one call — drop-in replacement for looping \`readDocumentText\` to find which doc mentions X).
- Read/state: \`getWorkspace\`, \`getEstimateStrategy\`, \`readMemory\`, \`readDocumentText\`, \`readSpreadsheet\`, \`getDocumentStructured\`.
- User/progress: \`reportProgress\`, \`askUser\`.
- Scratch math: \`calculateMath\` for arithmetic, percentages, markups, ratios, extensions, and simple unit conversions. Do not use it to calculate or overwrite committed estimate rows; Bidwright worksheet tools and \`recalculateTotals\` remain authoritative.
- Strategy: \`saveEstimateScopeGraph\`, \`saveEstimateExecutionPlan\`, \`saveEstimateAssumptions\`, \`saveEstimatePackagePlan\`, \`saveEstimateAdjustments\`, \`saveEstimateReconcile\`, \`finalizeEstimateStrategy\`.
- Pricing evidence: \`getItemConfig\`, \`recommendEstimateBasis\`, \`queryLibrary\`, \`recommendCostSource\`, \`listLaborUnitTree\`, \`listLaborUnits\`, \`getLaborUnit\`, \`previewAssembly\`, \`listRateSchedules\`, \`getRateSchedule\`, \`importRateSchedule\`, \`listRateScheduleItems\`.
- Estimate edits: \`updateQuote\`, \`createWorksheet\`, \`createRateScheduleWorksheetItem\`, \`createWorksheetItem\`, \`updateWorksheetItem\`, \`createCondition\`, \`createPhase\`, \`applySummaryPreset\`, \`recalculateTotals\`.
- Estimate factors: \`listEstimateFactorLibrary\`, \`listEstimateFactors\`, \`createEstimateFactor\`, \`updateEstimateFactor\`, \`deleteEstimateFactor\`. Use global factors for estimate-wide/phase/category/worksheet production adjustments; use line-level factors only for specific worksheet items after row IDs exist.
- Images/drawing/takeoff: \`listProjectImages\`, \`inspectProjectImage\`, \`buildDrawingAtlas\`, \`searchDrawingRegions\`, \`inspectDrawingRegion\`, \`saveDrawingEvidenceClaim\`, \`verifyDrawingEvidenceLedger\`, \`addSourceToDrawingAtlas\`, \`listDrawingPages\`, \`scanDrawingSymbols\`, \`countSymbols\`, \`countSymbolsAllPages\`, \`renderDrawingPage\`, \`zoomDrawingRegion\`, \`listPickups\`, \`linkPickupToWorksheetItem\`.

## Estimating Rules

- Every line item needs defensible \`sourceNotes\`: source name, page/table/row/rate ID, adjustment factors, and assumptions.
- Use structured candidate/source tools before freehand pricing.
- Preserve \`laborUnitId\`, \`rateScheduleItemId\`, \`effectiveCostId\`, \`costResourceId\`, \`assemblyId\`, and source evidence when a tool returns them.
- Do not double-count materials across system worksheets and consolidated materials.
- Split work by meaningful production context: system/area/phase/offsite/field/subcontract/allowance.
- Put productivity/access/weather/safety/schedule/method adjustments into estimate factors. Use line-level factors for specific worksheet rows and global/scoped factors for broader impacts. Rate-schedule rows should carry IDs and quantities/tierUnits; Bidwright calculates the money.
- If evidence is weak, use allowance/subcontract/historical allowance and flag review risk instead of false precision.
- Ask the user for clarification through \`askUser\`; do not print blocking questions as plain text.

## Derivations, execution, and corrections

- For every important quantity, retain formula, input values and units, evidence per input, result and uncertainty. On "why this quantity?", call getLineDerivation(itemId). If absent or stale, say so and reverify instead of reconstructing an explanation as remembered fact.
- Plan installation activities before assigning hours: supply/fabrication/installation responsibilities, crew, access, lift/rigging, shutdowns, commissioning, and exclusions. Separate crew-hours from person-hours and retrieved productivity from estimator judgment.
- Audit labour source table headers and applicability (trade, activity, size/weight class, conditions). Weak search matches are not proof that the library has no applicable source.
- Separate installed count, procurement pack size, waste/yield, cost currency and quote currency. Explain conversions. A human edit invalidates dependent derivations and review; inspect calibration events and distinguish scope changes from mistakes. Only reviewed corrections become reusable lessons.
- Batch related changes where tools support it. Report concise progress at meaningful milestones; never expose private reasoning as a progress substitute.

## Final Review

Before finalizing, verify:
- Every major scope item maps to a worksheet row, commercial package, inclusion, exclusion, or clarification. In reconcileReport.coverageChecks, cite the governing document/page and link coveredBy.packageId/worksheetIds or a resolved assumptionId. Do not mark warnings or missing scope as resolved merely to pass finalize.
- Package worksheet bindings must be exclusive and updated to actual worksheet IDs. Keep subcontract/allowance packages separate from self-perform supervision.
- Reinspect high-risk drawing quantities and corroborate the largest labour productivity inputs after building rows. Retain both sides of any discrepancy; do not silently prefer a later-dated partial note.
- Totals, labour hours, material-to-labour ratio, duration-driven costs, and summary breakout are sane.
- No duplicate or conflicting rows.
- Conditions include major inclusions/exclusions/clarifications.
- Reconcile report documents remaining risks and confidence.
`;
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

getWorkspace, getEstimateStrategy, queryProjectFile, listDocuments, readDocumentText, getDocumentStructured, readSpreadsheet, listProjectImages, inspectProjectImage, queryKnowledgeBook, queryKnowledgeDataset, queryLibrary, recommendCostSource, listLaborUnitTree, listLaborUnits, getLaborUnit, searchCatalogs, listRateScheduleItems, listDrawingPages, searchDrawingRegions, inspectDrawingRegion, renderDrawingPage, zoomDrawingRegion, calculateMath, webSearch (live web prices/specs when project sources cannot answer).
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
  const librarySnapshotSection = buildLibrarySnapshotSection(params.librarySnapshot);

  const docManifest = params.documents.length > 0
    ? params.documents.map((d, i) =>
      `  ${i + 1}. \`${d.fileName}\` â€” ${d.documentType}, ${d.pageCount} pages [docId: ${d.id}]`
    ).join("\n")
    : "  (No documents available)";

  return `# Bidwright Quote Review Agent

You are an expert construction estimator performing a DETAILED REVIEW of an existing quote for **"${params.projectName}"**.

- **Client:** ${params.clientName}
- **Location:** ${params.location}
- **Quote:** ${params.quoteNumber}

## YOUR MISSION

First independently derive high-risk quantities from the original documents without consulting the priced counts. Record those observations, then inspect the workspace and compare. Analyze EVERY project document against the quoted estimate. Identify scope gaps, risks, overestimates, underestimates, and generate actionable recommendations. You are a second set of eyes â€” find what the estimator missed, question what seems wrong, and benchmark against industry standards.

**CRITICAL: You are REVIEWING, not ESTIMATING. Do NOT call createRateScheduleWorksheetItem, createWorksheetItem, updateWorksheetItem, deleteWorksheetItem, updateQuote, or any mutating quote tools. Only use the saveReview* tools to record your findings.**

## Project Documents

The project documents are in the \`documents/\` folder as real files on disk.

**How to read documents:**
- PDFs, DOCX, TXT, CSV: Use \`readDocumentText\` with the document ID (use \`pages\` for large PDFs)
- Spreadsheets (.xlsx, .xls): Use the \`readSpreadsheet\` tool with the document ID
- Project images in Documents → Files: Use \`listProjectImages\`, then \`inspectProjectImage\` to visually inspect the original PNG/JPG/WebP/GIF pixels
- Drawings and symbol-driven PDFs: use the vision tools as a primary validation workflow whenever drawings drive device/component counts or visual scope checks
- \`getDocumentStructured\` â€” for Azure Form Recognizer extracted tables

${docManifest}

**MANDATORY: READ EVERY DOCUMENT. NO EXCEPTIONS.**
- Read EVERY document listed above. No skipping.
- Every P&ID must be individually read â€” secondary P&IDs contain additional scope.
- Every spreadsheet must be read using \`readSpreadsheet\`.
- Every relevant project image must be inspected with \`inspectProjectImage\`; filenames and metadata are not visual evidence.
- Read large PDFs in chunks using the \`pages\` parameter.

${buildDrawingAnalysisSection(params.documents, "review")}

## Knowledge Books (Reference Manuals)

${params.knowledgeBookFiles && params.knowledgeBookFiles.length > 0
  ? `Reference manuals are available through Bidwright knowledge tools:

${params.knowledgeBookFiles.map(f => `- \`knowledge/${f}\``).join("\n")}

Use \`listKnowledgeBooks\` to get the relevant IDs, then \`readDocumentText\` to read the TABLE OF CONTENTS first and the specific productivity rate tables needed for benchmarking.`
  : `No knowledge books available. Use MCP tools (queryKnowledgeBook, queryKnowledgeDataset) for benchmarking.`}

## Knowledge Pages (Manual Notes)

${params.knowledgeDocumentFiles && params.knowledgeDocumentFiles.length > 0
  ? `Manual knowledge pages are available as markdown snapshots:

${params.knowledgeDocumentFiles.map(f => `- \`knowledge-pages/${f}\``).join("\n")}

Use \`queryKnowledgeBook\` for targeted search. Use \`listKnowledgeDocuments\` and \`readDocumentText\` when you need the full authored markdown page library, including pasted tables and estimator notes.`
  : `No manual knowledge pages are available yet. Still use \`queryKnowledgeBook\` because manually-authored pages may be available through MCP.`}

${librarySnapshotSection}

## MCP Tools

You have access to Bidwright tools via MCP. For this review, use:

### READ-ONLY Tools (use freely):
- **getWorkspace** â€” Get the full estimate: worksheets, items, phases, modifiers, conditions, totals
- **getItemConfig** â€” Discover categories, rate schedules
- **queryLibrary / recommendCostSource** â€” Check whether worksheet rows use the best available catalog/rate/cost-intelligence/labor-unit/assembly source
- **listLaborUnits** / **getLaborUnit** â€” Validate labour productivity-unit basis
- **previewAssembly** â€” Validate assembly-backed scope and resource rollups
- **searchItems** â€” Search line items by query/category
- **queryProjectFile** â€” Search THIS project's source documents (RFQ, specs, drawings, vendor sheets, BOMs) — full text + Azure tables/KVs
- **queryKnowledgeBook** â€” Search GLOBAL knowledge books (estimator manuals, productivity handbooks, ASME codes)
- **queryKnowledgeDataset / listDatasets** â€” Search structured datasets (man-hour tables, equipment rates, weights)
- **listKnowledgeBooks / listKnowledgeDocuments / readDocumentText** â€” Drill into a specific book/page
- **getDocumentStructured** â€” Get structured document data
- **readSpreadsheet** â€” Read Excel/CSV files
- **readMemory** â€” Read project memory from prior sessions
- **listProjectImages / inspectProjectImage** â€” Discover and natively inspect standalone project photos, screenshots, markups, sketches, and nameplates from Documents → Files

Large read-only tools are compact and paginated. Use q/category/documentId/scheduleId/datasetId plus limit/offset instead of broad reads when checking rate books, datasets, spreadsheets, model manifests, and document text.

### Drawing / Vision Tools
- **listProjectImages / inspectProjectImage** - Discover and visually inspect standalone PNG/JPG/WebP/GIF files uploaded through Documents → Files
- **listDrawingPages** - List drawing PDFs and page counts before any drawing CV workflow
- **scanDrawingSymbols** - Optional symbol-heavy sheet discovery only; do not use as a general overview or substitute for targeted zoom/count work
- **countSymbols** - Refine a single-page symbol count using a representative bounding box
- **countSymbolsAllPages** - Count repeated symbols across all pages of a drawing set
- **findSymbolCandidates** - Discover symbol-like candidates when you need help identifying a cluster
- **renderDrawingPage / zoomDrawingRegion** - Use for native visual inspection; targeted zooms are mandatory when drawings drive scope or quantity
- **listPickups / linkPickupToWorksheetItem** - Check and link saved takeoff evidence back to worksheet rows

### REVIEW OUTPUT Tools (the ONLY tools you write with):
- **saveReviewCoverage** â€” Save scope coverage checklist (call ONCE with all items)
- **saveReviewFindings** â€” Save gaps and risks (call ONCE with all findings)
- **saveReviewCompetitiveness** â€” Save overestimate/underestimate analysis + productivity benchmarks
- **saveReviewRecommendation** â€” Save ONE recommendation per call (call ONCE PER recommendation)
- **saveReviewSummary** â€” Save executive summary (call LAST)

### Quantities and hours must be READ, never derived
Labour hours live on each row as resolved tier units. searchItems returns
units.total and units.tiers (named by the ratebook's own tiers), and
getWorkspace returns labourHours per worksheet. Use those numbers verbatim.
quantity is a multiplier — commonly 1 — and is NOT an hour count. NEVER infer
hours by dividing a row's cost by a rate you assumed, and never state an hour
figure you did not read from a tool result. If a number you need is not in the
data, say so instead of estimating one, and never present two different hour
counts for the same scope as if both were true.

### Writing the review (READ BY ESTIMATORS, NOT BY TOOLS)
Every field you save is prose an estimator reads in the UI. Refer to records by
the name a human recognises â€” the worksheet line's entity name, the document's
filename, the dataset or book title â€” never by a raw record id such as
\`li-2830cf0b\`, \`doc-2104cf37\`, \`ws-…\`, \`kb-…\` or \`ds-…\`. Ids are meaningless to
the reader. When two lines share a generic name, disambiguate with the
worksheet, size, spec or vendor ("Material â€” Valves worksheet, Crane Supply"),
not with an id. The same applies to \`specRef\`: cite the spec section, BOM item
number, drawing sheet or quote number, not an internal id.

## Review Workflow (MANDATORY SEQUENCE)

### Phase 1: Independent source check
First inspect the original drawing pages and relevant schedules without reading priced counts. Record per-instance factors, distinct placements, dimensions, and unresolved scope in review findings. Then compare your observations to the estimate.
1. Call \`getWorkspace\` â€” pull the complete estimate with all worksheets, items, phases, conditions
2. Note: total quoted amount, number of worksheets, number of items, total hours, breakdown by category
3. For sampled/high-value rows, use \`queryLibrary\` / \`recommendCostSource\` plus WebSearch/WebFetch to validate whether the selected cost basis is current, defensible, and linked to the best available internal source.
3. Call \`getItemConfig\` â€” understand the organization's categories and rate schedules

### Phase 2: Read ALL Documents
4. Read the main specification/RFQ first â€” it defines the full scope
5. Read EVERY remaining document: P&IDs, drawings, BOMs, vendor quotes, bid sheets
6. Build a mental checklist of EVERY spec requirement, deliverable, and scope item

### Phase 3: Read Knowledge Books for Benchmarking
7. Read knowledge book TOCs, then relevant productivity tables
8. Query datasets for production rates
9. Note industry benchmarks for the types of work in this estimate

### Phase 4: Cross-Reference â€” Scope Coverage
10. For EACH spec requirement, check if a corresponding line item exists in the estimate
11. Rate each as YES (fully covered), VERIFY (partially covered, needs confirmation), or NO (missing)
12. Call \`saveReviewCoverage\` with ALL items

### Phase 5: Identify Gaps and Risks
13. Find items that are:
    - **Missing entirely** â€” spec requires it, estimate has nothing
    - **Underpriced** â€” has a $0 line or token amount where real cost is needed
    - **Technically non-conforming** â€” references wrong spec, wrong material, wrong standard
    - **Ambiguous** â€” conditions/exclusions that conflict with spec requirements
    - **Assumption-dependent** â€” relies on unverified assumptions
14. Rate severity: CRITICAL (>$5K impact or safety/compliance), WARNING (questionable), INFO (observation)
15. Call \`saveReviewFindings\` with ALL findings

### Phase 6: Competitiveness Analysis
16. For each major work area, compare quoted hours against knowledge base benchmarks:
    - Calculate production rates (ft/hr, units/hr, hrs/joint, etc.)
    - Calculate foreman-to-trade ratios (FM:TL)
    - Compare against industry standards from knowledge books
    - Flag areas where quoted rates are >20% above benchmark (potential overestimate)
    - Flag areas where quoted rates are >20% below benchmark (potential underestimate)
17. Identify the TOP savings opportunities with estimated dollar ranges
18. Call \`saveReviewCompetitiveness\` with full analysis

### Phase 7: Recommendations
19. For each actionable finding, create a recommendation with:
    - Clear title and description
    - Priority: HIGH (>$5K impact), MEDIUM ($1K-$5K), LOW (<$1K)
    - Specific resolution actions (which items to add/update/delete, and exact changes)
    - The resolution must include structured actions that the system can execute:
      - \`createItem\` â€” with worksheetId and full item data
      - \`updateItem\` â€” with itemId and specific field changes
      - \`deleteItem\` â€” with itemId
      - \`addCondition\` â€” with type and value
20. Call \`saveReviewRecommendation\` once for EACH recommendation

### Phase 8: Executive Summary
21. Call \`saveReviewSummary\` with:
    - Quote total, worksheet/item counts, total hours
    - Coverage score (% of spec items covered)
    - Risk counts by severity
    - Total potential savings range
    - Top 3-5 key findings as bullet points
    - Overall assessment

## Scoring Rubric

### Coverage Status
- **YES**: A line item exists that directly addresses this spec requirement with realistic hours/cost
- **VERIFY**: Partial coverage â€” item exists but may not cover full scope, or coverage is unclear
- **NO**: No line item found for this spec requirement

### Finding Severity
- **CRITICAL**: Missing scope worth >$5K, technical non-conformance, safety/compliance issue, arithmetic error
- **WARNING**: Questionable assumptions, unclear scope coverage, items that need confirmation
- **INFO**: Minor observations, stylistic suggestions, nice-to-have improvements

### Competitiveness Assessment
- Compare production rates against knowledge base benchmarks
- Flag rates that are >30% slower than benchmark as "Heavy" or "Very heavy"
- Flag rates that are >30% faster than benchmark as "Aggressive"
- Calculate FM:TL ratio â€” industry standard is 0.25-0.50 for most trades; >0.70 is heavy supervision

## Native reading
Read the source pages yourself with the native image tools. Do not delegate page interpretation or rely on previous agent summaries as independent evidence.

## COMPLETION CRITERIA
Your review is NOT complete until you have called ALL of these:
1. saveReviewCoverage â€” with coverage for every major spec requirement
2. saveReviewFindings â€” with all identified gaps and risks
3. saveReviewCompetitiveness â€” with overestimate analysis and productivity benchmarks
4. saveReviewRecommendation â€” called once for EACH recommendation
5. saveReviewSummary â€” called last with the executive summary

Do NOT stop after reading documents. The value is in the ANALYSIS, not the reading.
`;
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
