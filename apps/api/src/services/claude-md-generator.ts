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

function buildDrawingAnalysisSection(documents: ClaudeDocument[], mode: "estimate" | "review"): string {
  const drawingDocs = documents.filter(isDrawingLikeDocument);

  if (drawingDocs.length === 0) {
    return `## Drawing Analysis

No drawing-style PDFs were detected in the manifest. If document review reveals plans, P&IDs, layouts, one-lines, or symbol schedules that drive quantities, use the drawing tools for those specific sheets before making quantity assumptions. Do not run drawing scans as a ceremonial checkbox.`;
  }

  const drawingList = drawingDocs
    .slice(0, 8)
    .map((doc) => `- \`${doc.fileName}\` [docId: ${doc.id}]`)
    .join("\n");

  const moreLine = drawingDocs.length > 8 ? `\n- ... plus ${drawingDocs.length - 8} more drawing files` : "";
  const lead = mode === "estimate"
    ? "before you make quantity assumptions, build line items, or lock labour hours."
    : "before you score coverage, competitiveness, or recommendations.";
  const followThrough = mode === "estimate"
    ? `- Use the resulting counts directly in worksheet quantities, package decisions, and \`sourceNotes\`.\n- If a drawing-driven quantity cannot be validated, record it as an explicit assumption, allowance, or clarification instead of guessing.`
    : `- Use the resulting counts to validate whether the estimate captured the real device/component count.\n- If a drawing-driven quantity cannot be validated, mark it VERIFY/NO and surface it as a risk instead of assuming coverage.`;

  return `## Drawing Analysis

This project includes ${drawingDocs.length} drawing-style PDF${drawingDocs.length === 1 ? "" : "s"}. Use drawing CV when a drawing actually drives quantities or scope coverage ${lead} Do not scan a random sheet just to prove the tool was used.

Detected drawing-style files:
${drawingList}${moreLine}

**Drawing workflow**
1. Read the RFQ/spec/BOM/schedules first and decide which drawing sheets affect quantity or coverage.
2. Call \`buildDrawingAtlas\` once. It renders drawing pages, builds the sheet registry, starts optional LandingAI enrichment in the background when enabled, and creates searchable semantic regions from immediately available Azure/local/PDF-native evidence. Completed cached LandingAI regions can still be reused when present.
3. If relevant PDFs are missing from the atlas, call \`addSourceToDrawingAtlas\` for each with a rationale and leave \`rebuildAtlas\` false while batching; then call \`buildDrawingAtlas({ force: true })\` once or let the next \`searchDrawingRegions\` perform one lazy rebuild. Do not rely on filename guesses; make an estimator decision and persist it.
4. Use \`searchDrawingRegions("specific thing you need")\` before visual inspection. Search for the object/count/BOM/detail/sheet you are trying to prove; do not guess page crops manually. If search returns high-authority table/spec/schedule regions, inspect those before accepting a lower-context visual count.
5. Use \`inspectDrawingRegion(regionId, claim/question)\` on the best candidate regions. This returns the targeted high-res crop, coordinates, crop path, and image hash.
6. For every drawing-driven quantity or scope fact, call \`saveDrawingEvidenceClaim\` with document/page/region/bbox/tool/result/imageHash. A worksheet item cannot price a drawing-driven quantity without a ledger claim.
7. Worksheet rows use a line-level \`evidenceBasis\`. Prefer the two-axis form: \`evidenceBasis.quantity.type\` explains where the quantity/hours/duration/count came from, while \`evidenceBasis.pricing.type\` explains where the unit cost/rate/productivity/allowance came from. Use drawing/takeoff quantity types only under \`evidenceBasis.quantity\` with claim IDs; use the appropriate non-drawing pricing/source basis for rate/manual/vendor/material/equipment/subcontract/document/allowance/indirect/assumption/mixed support.
8. Call \`verifyDrawingEvidenceLedger\` before pricing/finalize. If it finds missing evidence or contradictions, reconcile sources or carry an explicit assumption. If a BOM/spec/schedule and a drawing note disagree, do not blindly prefer the drawing; save evidence for both source values when possible. A later drawing revision/date is not enough to supersede a BOM/spec/schedule because the visible drawing note may be partial-context; use the high-authority table as baseline unless explicit source text, order-of-precedence, addendum/RFI/client/vendor confirmation, or a user answer says otherwise.
9. If you are interrupted/resumed because LandingAI finished, call \`buildDrawingAtlas({ force: true })\`, search the newly available regions, and incorporate changed evidence without duplicating existing work.
10. Use \`renderDrawingPage\` and \`zoomDrawingRegion\` as lower-level fallbacks only when the atlas search does not surface the right region. Use symbol tools only after the visual pass identifies a specific small repeated symbol or cropped region. \`countSymbols\` needs a tight representative bounding box in the \`renderDrawingPage\` coordinate space; do not run symbol tools as a page-wide overview ritual.
11. When you call \`saveEstimateScopeGraph\`, include \`visualTakeoffAudit\`: every drawing-driven package must cite actual region/claim evidence, \`renderedPages\`, and \`completedBeforePricing: true\` only after visual evidence and ledger verification happened. Use \`zoomEvidence\` only for targeted inspected crops; put BOM/schedule/parts-list table extraction in \`tableEvidence\` unless you inspected a targeted table crop.
12. For structural and fabricated assemblies, distinguish unique member marks from physical placements. If one mark appears in multiple locations, price physical occurrences unless the drawing, schedule, or BOM explicitly says the mark list is already a total quantity.

Only call concrete tools returned by ToolSearch. A server namespace without a concrete tool suffix is not callable and counts as a failed tool call. Use the actual returned drawing tools, such as \`searchDrawingRegions\`, \`inspectDrawingRegion\`, and \`saveDrawingEvidenceClaim\`.

**Use drawing CV automatically for these trade patterns**
- Mechanical/process piping: valve tags, instruments, inline devices, actuators, equipment symbols, repetitive support/hanger symbols.
- Plumbing / fire protection: fixtures, drains, cleanouts, sprinkler heads, hose cabinets, valves, specialties.
- HVAC / sheet metal: diffusers, grilles, VAVs, dampers, unit symbols, repetitive accessories.
- Electrical / controls: fixtures, receptacles, devices, panels, instruments, IO points, cable tray drops, one-line symbols.
- Civil / structural / architectural: doors, windows, bollards, embeds, foundations, piles, framing callouts, repetitive details.

${followThrough}

**Do NOT**
- rely only on extracted PDF text for drawing-based counts
- skip native visual drawing inspection just because \`readDocumentText\` returned OCR from a drawing
- manually eyeball repetitive symbol counts when the scan/count tools can answer them
- run one random drawing scan as a token compliance step
- request page images/base64 unless you need visual confirmation`;
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

Before pricing, reviewing, or delegating worksheet work:
1. Read \`${rootDir}/README.md\` and \`${rootDir}/library-index.md\`; both are intentionally small.
2. Do **not** read \`${rootDir}/files-manifest.jsonl\` or large JSONL snapshots wholesale. Search text corpora with \`rg\`/grep, then inspect only relevant lines/ranges.
3. Search \`${rootDir}/search/\` with scope keywords, trade terms, material names, sizes, vendors, codes, and production activities from the bid documents. This is first-party retrieval across cost intelligence, catalogs, rate schedules, labour units, assemblies, datasets, and knowledge indexes.
4. Use matching IDs with MCP tools:
   - Books/manuals: \`listKnowledgeBooks\`, \`queryKnowledge\`, \`queryGlobalLibrary\`, then \`readDocumentText\` for relevant page ranges.
   - Datasets: \`listDatasets\` and \`queryDatasets\`; read JSONL row files only to discover likely dataset IDs/columns/search terms.
   - Cost/catalog/rate/labour/assembly sources: \`searchLibraryCorpus\`, \`searchLineItemCandidates\`, \`searchCatalogs\`, \`listRateScheduleItems\`, \`listLaborUnitTree\`, \`listLaborUnits\`, \`getLaborUnit\`, \`previewAssembly\`.
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

function buildCompactClaudeMdContent(params: ClaudeMdParams): string {
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

- Do not read giant files wholesale. Use \`readDocumentText\` with pages/maxChars/offset, MCP search/list tools, \`searchLibraryCorpus\`, and \`rg\` on \`library-snapshots/search/\`.
- Do not read \`library-snapshots/files-manifest.jsonl\` or large JSONL row files end-to-end.
- If a tool says a file is too large, narrow the request by page/range/search term instead of retrying the same read.
- Use only Bidwright \`readMemory\` / \`writeMemory\` for project memory. Do not read, grep, inspect, write, or edit Claude global/project memory files under \`~/.claude\`, previous-run memory folders, or prior harness summaries unless the user explicitly provided them as current project inputs.

## Startup Checklist

1. Call \`getWorkspace\` and \`getEstimateStrategy\` before making changes. Resume existing worksheets/strategy instead of duplicating them.
2. Read \`library-snapshots/README.md\` and \`library-snapshots/library-index.md\` only. They are the compact map. Then use \`rg\` or \`searchLibraryCorpus\` over \`library-snapshots/search/\` for first-party library discovery.
3. Read the main RFQ/spec first, then every project document using MCP tools. Use \`.bidwright/document-manifest.jsonl\` only as a searchable manifest if the inline list is truncated.
4. Inventory spreadsheet/BOM/parts-list/takeoff artifacts before visual takeoff. Read spreadsheets with \`readSpreadsheet\`; read table-heavy PDF BOMs/parts lists with \`getDocumentStructured\` and \`readDocumentText\`. Treat those as gold-standard quantity sources when present.
5. If drawings exist, build/reuse the Drawing Evidence Engine atlas, use \`searchDrawingRegions\` for the exact detail/table/count you need, and use \`inspectDrawingRegion\` for the high-res crop that proves it. Drawing OCR is context, not a visual takeoff. A drawing pass is not complete until \`saveDrawingEvidenceClaim\` entries exist for drawing-driven quantities, \`verifyDrawingEvidenceLedger\` passes, and \`saveEstimateScopeGraph.visualTakeoffAudit\` records rendered/atlas pages plus targeted crop evidence for each drawing-driven package, or explicitly documents why drawings do not drive quantities.
6. Update quote name/client/scope with \`updateQuote\` as soon as the RFQ/spec identifies them.
7. Save strategy before detailed pricing: \`saveEstimateScopeGraph\`, \`saveEstimateExecutionPlan\`, \`saveEstimateAssumptions\`, \`saveEstimatePackagePlan\`${benchmarkingEnabled ? ", `recomputeEstimateBenchmarks`" : ""}, \`saveEstimateAdjustments\`.
8. Ask the user with \`askUser\` for scope confirmation and commercial unknowns before creating labour-heavy rows.
9. Before worksheets/items, search the first-party runtime corpora for the major cost and production drivers: \`rg -n "<scope terms>" library-snapshots/search\` or \`searchLibraryCorpus\`. Then use the authoritative MCP tools for the relevant IDs/pages/rows. For labour productivity, search \`library-snapshots/search/labor-units.search.txt\`, browse \`listLaborUnitTree\`, call compact \`listLaborUnits\`, and use \`getLaborUnit\` only when one candidate needs deeper source inspection; you decide the basis from the evidence.
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
- For drawing-driven quantities, use \`buildDrawingAtlas\`, \`searchDrawingRegions\`, \`inspectDrawingRegion\`, \`saveDrawingEvidenceClaim\`, and \`verifyDrawingEvidenceLedger\` before quantity assumptions. Use \`renderDrawingPage\` / \`zoomDrawingRegion\` only as lower-level fallbacks, and use \`countSymbols\` only after you have identified a specific small representative symbol/bounding box.

${buildDrawingAnalysisSection(params.documents, "estimate")}

## Knowledge And Library Use

${params.knowledgeBookFiles?.length
  ? `Knowledge books are available through MCP and symlinked under \`knowledge/\`. Search/list first, read table of contents, then relevant chapters only. Priority files: ${params.knowledgeBookFiles.slice(0, 20).map((f) => `\`${f}\``).join(", ")}${params.knowledgeBookFiles.length > 20 ? `, plus ${params.knowledgeBookFiles.length - 20} more` : ""}.`
  : "Use `queryKnowledge`, `queryGlobalLibrary`, and `listKnowledgeBooks` for knowledge books."}

${params.knowledgeDocumentFiles?.length
  ? `Manual knowledge pages are available through MCP and snapshots under \`knowledge-pages/\`. Search first, then read relevant pages only.`
  : "Manual knowledge pages may still be available through `queryKnowledge` and `listKnowledgeDocuments`."}

${buildLibrarySnapshotSection(params.librarySnapshot)}

## Core MCP Tools

- Read/state: \`getWorkspace\`, \`getEstimateStrategy\`, \`readMemory\`, \`readDocumentText\`, \`readSpreadsheet\`, \`getDocumentStructured\`.
- User/progress: \`reportProgress\`, \`askUser\`.
- Strategy: \`saveEstimateScopeGraph\`, \`saveEstimateExecutionPlan\`, \`saveEstimateAssumptions\`, \`saveEstimatePackagePlan\`, \`saveEstimateAdjustments\`, \`saveEstimateReconcile\`, \`finalizeEstimateStrategy\`.
- Pricing evidence: \`getItemConfig\`, \`searchLibraryCorpus\`, \`recommendEstimateBasis\`, \`searchLineItemCandidates\`, \`recommendCostSource\`, \`listLaborUnitTree\`, \`listLaborUnits\`, \`getLaborUnit\`, \`previewAssembly\`, \`listRateSchedules\`, \`getRateSchedule\`, \`importRateSchedule\`, \`listRateScheduleItems\`.
- Estimate edits: \`updateQuote\`, \`createWorksheet\`, \`createRateScheduleWorksheetItem\`, \`createWorksheetItem\`, \`updateWorksheetItem\`, \`createCondition\`, \`createPhase\`, \`applySummaryPreset\`, \`recalculateTotals\`.
- Estimate factors: \`listEstimateFactorLibrary\`, \`listEstimateFactors\`, \`createEstimateFactor\`, \`updateEstimateFactor\`, \`deleteEstimateFactor\`. Use global factors for estimate-wide/phase/category/worksheet production adjustments; use line-level factors only for specific worksheet items after row IDs exist.
- Drawing/takeoff: \`buildDrawingAtlas\`, \`searchDrawingRegions\`, \`inspectDrawingRegion\`, \`saveDrawingEvidenceClaim\`, \`verifyDrawingEvidenceLedger\`, \`addSourceToDrawingAtlas\`, \`listDrawingPages\`, \`scanDrawingSymbols\`, \`countSymbols\`, \`countSymbolsAllPages\`, \`renderDrawingPage\`, \`zoomDrawingRegion\`, \`listTakeoffAnnotations\`, \`linkTakeoffAnnotationToWorksheetItem\`.

## Estimating Rules

- Every line item needs defensible \`sourceNotes\`: source name, page/table/row/rate ID, adjustment factors, and assumptions.
- Use structured candidate/source tools before freehand pricing.
- Preserve \`laborUnitId\`, \`rateScheduleItemId\`, \`effectiveCostId\`, \`costResourceId\`, \`assemblyId\`, and source evidence when a tool returns them.
- Do not double-count materials across system worksheets and consolidated materials.
- Split work by meaningful production context: system/area/phase/offsite/field/subcontract/allowance.
- Put productivity/access/weather/safety/schedule/method adjustments into estimate factors. Use line-level factors for specific worksheet rows and global/scoped factors for broader impacts. Rate-schedule rows should carry IDs and quantities/tierUnits; Bidwright calculates the money.
- If evidence is weak, use allowance/subcontract/historical allowance and flag review risk instead of false precision.
- Ask the user for clarification through \`askUser\`; do not print blocking questions as plain text.

## Final Review

Before finalizing, verify:
- Every major scope item maps to a worksheet row, commercial package, inclusion, exclusion, or clarification.
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

function buildClaudeMdContent(params: ClaudeMdParams): string {
  const maxSubAgents = params.maxConcurrentSubAgents ?? 2;
  const benchmarkingEnabled = params.estimateDefaults?.benchmarkingEnabled !== false;

  const docManifest = params.documents.length > 0
    ? params.documents.map((d, i) =>
      `  ${i + 1}. \`${d.fileName}\` â€” ${d.documentType}, ${d.pageCount} pages [docId: ${d.id}]`
    ).join("\n")
    : "  (Documents are being processed â€” check the documents/ folder)";

  const scopeSection = params.scope
    ? `## Scope (USER INSTRUCTIONS â€” MUST FOLLOW)\n\nThe user specified: **${params.scope}**\n\nFocus on this scope only. If the scope assigns specific activities to an external provider, commercial allowance, owner/client supply, or fixed price, you MUST carry those activities in that commercial treatment rather than rebuilding them as internally executed labour. The scope instruction is AUTHORITATIVE and overrides any default assumptions.`
    : `## Scope\n\nNo specific scope defined â€” estimate the full bid package.`;

  const commercialScopeSection = params.scope
    ? `${scopeSection}\n\nInterpret commercial directives literally:\n- If the scope says an activity is external, subcontracted, vendor-supplied, outsourced, or partner-delivered, create it as an external/commercial package instead of estimating it as internally executed labour.\n- If the scope says a package is already priced, fixed, quoted, budgeted, or otherwise commercially known, carry that package at the stated amount instead of rebuilding it bottom-up.\n- If the scope says something is owner/client-supplied or install/support-only, price only the work that remains.\n- Only produce a bottom-up validation breakdown for a fixed/commercial package if the user explicitly asks for that validation.`
    : scopeSection;

  const personaSection = params.persona ? buildEstimatingPlaybookSection(params.persona) : "";
  const librarySnapshotSection = buildLibrarySnapshotSection(params.librarySnapshot);

  const benchmarkToolLine = benchmarkingEnabled
    ? `- **recomputeEstimateBenchmarks** â€” Compare this revision to prior human quotes and surface distribution outliers`
    : `- **recomputeEstimateBenchmarks** â€” Historical benchmark pass is disabled by organization defaults; only use this if the user explicitly re-enables benchmarking`;

  const stageGateSequence = benchmarkingEnabled
    ? `  1. \`saveEstimateScopeGraph\`
  2. \`saveEstimateExecutionPlan\`
  3. \`saveEstimateAssumptions\`
  4. \`saveEstimatePackagePlan\`
  5. \`recomputeEstimateBenchmarks\`
  6. \`saveEstimateAdjustments\``
    : `  1. \`saveEstimateScopeGraph\`
  2. \`saveEstimateExecutionPlan\`
  3. \`saveEstimateAssumptions\`
  4. \`saveEstimatePackagePlan\`
  5. \`saveEstimateAdjustments\` (record top-down sanity checks and note that org benchmarking is disabled)`;

  const benchmarkGateNarrative = benchmarkingEnabled
    ? `- The package structure must be decided before the pricing structure. The execution model must be decided before labour hours. Run an early benchmark pass after the package plan, then run another benchmark pass after worksheets/items and recalculateTotals so final reconciliation is based on the actual built estimate.`
    : `- The package structure must be decided before the pricing structure. The execution model must be decided before labour hours. Organization-wide historical benchmarking is disabled, so use persona guidance, package-mode discipline, and explicit top-down sanity checks instead of comparable-job heuristics.`;

  return `${personaSection}# Bidwright Estimating Agent

You are an expert estimator building a quote for **"${params.projectName}"**. Adapt your terminology and work breakdown to the selected estimating playbook, project documents, and configured organization library.

- **Client:** ${params.clientName}
- **Location:** ${params.location}
- **Quote:** ${params.quoteNumber}

${commercialScopeSection}

## Project Documents

The project documents are in the \`documents/\` folder as real files on disk.

**How to read documents:**
- PDFs, DOCX, TXT, CSV: Use \`readDocumentText\` with the document ID from the manifest below. It returns Bidwright's extracted text and supports an optional \`pages\` range for long PDFs.
- Spreadsheets (.xlsx, .xls): Use the \`readSpreadsheet\` tool with the document ID from the manifest below â€” this parses the binary file server-side and returns markdown tables.
- Table-heavy PDFs and forms: Use \`getDocumentStructured\` to inspect structured tables, key-value pairs, and section headings. This is mandatory for BOMs, bill-of-materials PDFs, parts lists, equipment schedules, bid forms, vendor quote sheets, and takeoff summaries.
- Drawings and symbol-driven PDFs: use the vision/drawing tools as a primary takeoff workflow whenever drawings drive counts, device quantities, or visual scope validation.
- **Do NOT install local parsers or shell utilities just to read Bidwright project files.** Use the MCP document tools first.
- **Do NOT use renderDrawingPage to read document text.** That tool is for visual drawing inspection and symbol counting, not for spec/RFQ text extraction.

${docManifest}

**MANDATORY: READ EVERY DOCUMENT. NO EXCEPTIONS.**
- You MUST read EVERY document listed above. No skipping, no shortcuts, no "estimated from primary documents."
- **Every P&ID must be individually read** â€” secondary P&IDs often contain additional equipment, piping runs, instruments, tie-ins, and connections NOT shown on the primary P&ID. Skipping them means missing scope.
- **Every spreadsheet must be read** using the \`readSpreadsheet\` tool â€” spreadsheets often contain BOMs, quantity takeoffs, or quotation details that are CRITICAL to accurate pricing.
- **Every BOM/parts-list/takeoff artifact must be elevated** before visual takeoff. If it is a spreadsheet, use \`readSpreadsheet\`. If it is a PDF, use \`getDocumentStructured\` plus focused \`readDocumentText\`. Treat its item quantities as the quantity baseline unless explicit source evidence proves they are superseded. A later drawing date or isolated drawing callout is not enough by itself; the drawing may have missing context. If a BOM/spec/schedule conflicts with a drawing, save both claims and either use the high-authority table, attach explicit supersession/order-of-precedence/client-or-vendor confirmation evidence, or carry an assumption/ask the user. A carried assumption is not permission to price the lower-context drawing value as baseline when the BOM/spec/table carries the higher value; use the high-authority baseline plus a clarification/alternate unless the user/vendor/client explicitly confirms otherwise. For high-risk vendor/component/accessory counts, save dedicated quantity claims instead of burying those counts inside dimensions/weight/source-note prose.
- **Every specification section must be read** â€” use the \`pages\` parameter with \`readDocumentText\` to read large PDFs in chunks (e.g. pages: "1-20", then "21-40", etc.) until you've covered the entire document.
- If a document cannot be read (corrupted, format issue), log it as a HIGH-impact assumption and flag it to the user â€” do NOT silently skip it.
- **Estimation accuracy is directly proportional to document thoroughness.** An estimate built from 60% of the documents will be 30-40% inaccurate.

**Start by reading the main specification or RFQ document.** It defines the full scope of work and is the foundation for your estimate. Then read ALL remaining documents before creating worksheets.

${buildDrawingAnalysisSection(params.documents, "estimate")}

## Knowledge Books (Reference Manuals)

${params.knowledgeBookFiles && params.knowledgeBookFiles.length > 0
  ? `The organization's reference manuals and estimating handbooks are available through Bidwright knowledge tools:

${params.knowledgeBookFiles.map(f => `- \`knowledge/${f}\``).join("\n")}

**HOW TO USE KNOWLEDGE BOOKS:**
- Call \`listKnowledgeBooks\` first to get the knowledge book IDs available to this project.
- Use \`readDocumentText\` with a knowledge book ID and optional \`pages\` range to read the actual handbook text.
- These are FULL books (100-300+ pages). Read the TABLE OF CONTENTS first (usually pages 1-5) to find relevant chapters.
- Then read the specific chapters/tables you need for THIS project's scope.
- **This is your PRIMARY source for man-hour data, production rates, and correction factors.** Reading these books directly gives you full context that chunk-based search cannot.
- The MCP search tools (\`queryKnowledge\`, \`queryGlobalLibrary\`) still work for quick lookups, but for deep research, read the actual handbook text through \`readDocumentText\`.
- When citing in sourceNotes, reference the book name, chapter, table number, and page.`
  : `No knowledge books are available in the project directory. Use the MCP tools (queryKnowledge, queryGlobalLibrary, queryDatasets) to search the knowledge base.`}

## Knowledge Pages (Manual Notes)

${params.knowledgeDocumentFiles && params.knowledgeDocumentFiles.length > 0
  ? `Manual knowledge pages are available as markdown snapshots:

${params.knowledgeDocumentFiles.map(f => `- \`knowledge-pages/${f}\``).join("\n")}

Use \`queryKnowledge\` for targeted search. Use \`listKnowledgeDocuments\` and \`readDocumentText\` when you need the full authored markdown page library, including pasted tables and estimator notes.`
  : `No manual knowledge pages are available as files yet. Still use \`queryKnowledge\` because manually-authored pages may be available through MCP.`}

${librarySnapshotSection}

## MCP Tools (Bidwright)

You have access to Bidwright tools via MCP. Key tools:

- **getEstimateStrategy** â€” Retrieve the persisted estimate strategy, benchmark state, and calibration feedback for this revision
- **saveEstimateScopeGraph** â€” Persist the structured scope graph after document review
- **saveEstimateExecutionPlan** â€” Lock the execution model before assigning hours
- **saveEstimateAssumptions** â€” Persist explicit assumptions with confidence and user-confirmation flags
- **saveEstimatePackagePlan** â€” Define the commercial/package structure before pricing
${benchmarkToolLine}
- **saveEstimateAdjustments** â€” Record how benchmark findings should change the estimate approach
- **saveEstimateReconcile** â€” Save the mandatory final self-review and outlier check
- **finalizeEstimateStrategy** â€” Mark the staged estimate workflow complete after reconcile
- **getItemConfig** â€” CALL THIS FIRST. Discovers item categories, rate schedules, and catalog items configured for this organization. The response tells you exactly how to create items for each category.
- **searchLibraryCorpus** â€” Fast first-party search over the runtime text corpora in \`library-snapshots/search/\`: cost intelligence, catalogs, rates, labour units, assemblies, datasets, and knowledge indexes. Retrieval only; you decide relevance.
- **recommendEstimateBasis** â€” Candidate pack for a priced scope row: cost source candidates, labour units, and takeoff annotation hints in one response. Treat it as retrieval, not authority.
- **searchLineItemCandidates** â€” Search the unified line-item index: catalogs, imported rates, cost-intelligence effective costs/resources, labor units, assemblies, and provider actions. Use this before creating priced rows.
- **recommendCostSource** â€” Pick the best structured cost source for a scope phrase and return a ready-to-use worksheet item patch with provenance.
- **createWorksheetItemFromCandidate** â€” Create a worksheet row directly from a search/recommendation candidate while preserving costResourceId/effectiveCostId/laborUnitId/sourceEvidence/resourceComposition.
- **listLaborUnitTree** â€” Browse labor libraries by catalog/category/class/subclass before searching specific units.
- **listLaborUnits** â€” Find compact labor productivity candidates and laborUnitId values for rows that need hours/unit.
- **getLaborUnit** â€” Inspect one labor productivity candidate in more detail after \`listLaborUnits\`.
- **previewAssembly** â€” Preview assembly expansion and resource rollup before inserting assembly-backed scope.
- **getWorkspace** â€” Get the full workspace: revision, worksheets (with items), phases (with IDs), modifiers, conditions, totals. Use this to retrieve phase IDs after creating phases.
- **createWorksheet** â€” Create a worksheet (cost section) in the quote
- **createRateScheduleWorksheetItem** â€” Preferred for Labour, Equipment, Rental Equipment, and General Conditions rate-card rows. Provide \`worksheetId\`, concrete \`rateScheduleItemId\`, positive \`tierUnits\`, description/source/evidence; Bidwright derives category/name and calculates cost/sell.
- **createWorksheetItem** â€” Add a non-rate-schedule or custom line item to a worksheet. Set phaseId to assign to a phase. When drawings exist, include \`evidenceBasis.quantity\` and \`evidenceBasis.pricing\`; drawing-derived quantity axes need Drawing Evidence Engine claim IDs.
- **updateQuote** â€” Update quote metadata (description, customer-facing estimate notes, scope summary)
- **listRateSchedules** â€” Compact, paginated org-level rate schedule index. Use q/category filters to find the right schedule to import without dumping every item.
- **getRateSchedule** â€” Focused, paginated read of one org-level rate schedule's items after listRateSchedules identifies a likely schedule.
- **importRateSchedule** â€” Import an org rate schedule into the current quote revision
- **listRateScheduleItems** â€” Compact, paginated search of imported revision rate items; use q/category/scheduleId to get exact rateScheduleItemId values.
- **queryKnowledge** â€” Search the knowledge base for man-hour data, pricing references, standards
- **queryGlobalLibrary** â€” Search global knowledge books (estimating manuals, productivity data)
- **listKnowledgeBooks** â€” List available knowledge books and their IDs
- **readDocumentText** â€” Read extracted text for project documents and knowledge books by ID; use pages/maxChars/offset for large docs.
- **queryDatasets / listDatasets** â€” Compact structured dataset search; use datasetId plus rowLimit/offset for row-level evidence.
- **searchCatalogs** â€” Compact, paginated equipment/material catalog pricing search.
- **buildDrawingAtlas** â€” Precompute the Drawing Evidence Engine atlas once per package: rendered page hashes, sheet registry, semantic regions, and searchable drawing evidence targets.
- **addSourceToDrawingAtlas** â€” Agentically request a PDF/DWG/DXF source be added to the atlas with a rationale; starts LandingAI asynchronously for PDFs when enabled.
- **searchDrawingRegions** â€” Retrieve 3-8 candidate regions before visual inspection; search by the actual object/count/detail/BOM you need to prove.
- **inspectDrawingRegion** â€” Render a targeted high-res crop from an atlas region and return coordinates, crop path, and imageHash for evidence.
- **saveDrawingEvidenceClaim** â€” Persist the evidence ledger for each drawing-driven quantity claim before pricing.
- **getDrawingEvidenceLedger / verifyDrawingEvidenceLedger** â€” Review and independently verify evidence claims, missing crops, and contradictions before pricing/finalize.
- **askUser** â€” **MANDATORY** Ask the user a clarifying question and WAIT for their response. Blocks execution until they answer. Use this in Steps 1 and 2 of the Estimation Protocol. Do NOT skip this tool. Do NOT output questions as plain text instead.
- **readMemory / writeMemory** â€” Persistent Bidwright project memory (persists across sessions). Do not read, grep, inspect, write, or edit Claude global/project memory files under \`~/.claude\` or previous-run memory folders.
- **getProjectSummary** â€” Current project context and totals
- **reportProgress** â€” Tell the user what you're doing (shown in real-time UI)
- **createCondition** â€” Add exclusions, inclusions, clarifications
- **createPhase** â€” Create project phases. Use getWorkspace after to retrieve phase IDs.
- **createScheduleTask** â€” Create Gantt chart tasks/milestones linked to phases, with dates and durations
- **listScheduleTasks** â€” View existing schedule
- **recalculateTotals** â€” Recalculate financial totals

- **applySummaryPreset** - Configure the quote summary breakout so the finalized quote has an appropriate line-item rollup

### Tool Output Discipline

Large library tools are intentionally compact and paginated. Treat list tools as indexes, then narrow with q/category/documentId/scheduleId/datasetId and limit/offset. Never call a broad list/read tool expecting it to return an entire rate book, dataset, spreadsheet, model manifest, or document in one response. Continue with offset only for the specific source you have already decided matters.

For first-party library research, prefer \`rg\` over \`library-snapshots/search/\` or \`searchLibraryCorpus\` before opening structured JSONL. Search/recommendation tools return candidates; they do not make estimating relevance decisions. You are responsible for judging exact/similar/context/manual basis and writing that rationale.

Only call concrete tools returned by ToolSearch. A server namespace without a concrete tool suffix is not callable and counts as a failed tool call. Call the actual returned drawing tools, such as \`buildDrawingAtlas\`, \`searchDrawingRegions\`, or \`inspectDrawingRegion\`.

### Vision & Drawing Takeoff Tools (PRIMARY FOR DRAWING-DRIVEN QUANTITIES)

These tools are for automated drawing evidence, takeoff, and symbol counting on construction drawings. Use them before making drawing-driven quantity assumptions. To read document text, still use \`readDocumentText\` / \`getDocumentStructured\`.

- **buildDrawingAtlas** â€” Build/reuse the drawing atlas for the whole package: page render hashes, sheet registry, semantic regions, Azure/local/PDF-native evidence, and any completed LandingAI regions tied to crop coordinates. LandingAI runs asynchronously when enabled and must not block the first estimating pass.
- **addSourceToDrawingAtlas** â€” Add a relevant PDF/DWG/DXF to the atlas during estimating with a rationale. Use this when the pre-classification missed something important. Batch related additions with \`rebuildAtlas:false\`, then rebuild/search once so the agent does not stall on repeated atlas rebuilds.
- **searchDrawingRegions** â€” Ask for regions by intent, e.g. anchor counts, platform or equipment BOMs, vendor accessory tables, footing dimensions, valve symbols, support details, or schedule rows. Do this before inspecting crops, and prioritize high-authority table/spec/schedule matches before visual-only counts.
- **inspectDrawingRegion** â€” High-res visual crop for a selected region. This is the proof primitive; it returns imageHash/cropPath/coords for the evidence ledger.
- **saveDrawingEvidenceClaim** â€” Save every drawing-driven quantity claim with evidence. Do this before a worksheet item prices that quantity.
- **verifyDrawingEvidenceLedger** â€” Independent verifier; samples high-risk claims, checks crops/region IDs/image hashes, and forces contradictions to be reconciled.
- **scanDrawingSymbols** â€” Optional discovery aid for a known symbol-heavy sheet. Do not use it as an overview substitute; for actual counts, first identify a tight representative symbol region and use \`countSymbols\`.
- **countSymbols** â€” Refine a count with a specific bounding box and threshold
- **countSymbolsAllPages** â€” Count a symbol across ALL pages of a document
- **renderDrawingPage** â€” Render a drawing page as an image for visual symbol inspection (NOT for reading spec text â€” use \`readDocumentText\` instead)
- **zoomDrawingRegion** â€” Zoom into a small region for tiny text or symbol details
- **listDrawingPages** â€” List all PDF drawings with page counts
- **listTakeoffAnnotations** â€” List saved PDF/DWG takeoff annotations that can support row quantities
- **linkTakeoffAnnotationToWorksheetItem** â€” Link a saved takeoff annotation to a worksheet item so the row quantity stays tied to the Takeoff tab

**Drawing CV workflow (MANDATORY when drawings drive quantities):**
1. \`buildDrawingAtlas\` -> precompute/reuse the package atlas before manual crops or page guesses.
2. \`addSourceToDrawingAtlas\` -> use when your estimator judgment says a missing PDF/DWG/DXF belongs in visual evidence. Persist the rationale. If adding multiple sources, batch them with \`rebuildAtlas:false\`, then rebuild/search once.
3. \`searchDrawingRegions(query)\` -> retrieve candidate regions by the thing you need to prove.
4. \`inspectDrawingRegion(regionId, claim/question)\` -> inspect the actual high-res crop. OCR/extracted text from drawings is not enough.
5. \`saveDrawingEvidenceClaim\` -> save every drawing-driven claim with doc/page/region/bbox/tool/result/imageHash. BOM tables, visual counts, OCR text, assumptions, and library bases all belong in the same ledger. When sources disagree, save separate claims with the same package/quantity/unit so the contradiction is visible. Do not mark a BOM/spec/schedule table as superseded from drawing date alone; use the table baseline unless explicit override evidence exists, or mark \`carried_assumption\` / ask the user. If you carry an assumption on a BOM/spec-vs-drawing conflict, pricing must still use the high-authority BOM/spec/table baseline unless the user/vendor/client explicitly confirms the drawing value.
6. Worksheet items must carry a line-level \`evidenceBasis\` when drawings exist. Use \`evidenceBasis.quantity\` for quantity/hours/duration provenance and \`evidenceBasis.pricing\` for unit cost/rate/productivity provenance. Only drawing/takeoff quantity types require Drawing Evidence Engine claim IDs; non-drawing quantity/pricing bases must cite their rate/manual/vendor/material/equipment/subcontract/document/allowance/indirect/assumption/mixed support in \`sourceNotes\`, \`sourceEvidence\`, \`sourceRefs\`, or saved assumptions.
7. \`verifyDrawingEvidenceLedger\` -> run the independent verifier before pricing/finalize. If it reports a contradiction, reconcile the sources or carry an explicit assumption.
8. If interrupted/resumed by background LandingAI completion, rebuild/search the atlas and incorporate the new evidence without duplicating existing work.
9. Use \`renderDrawingPage\` / \`zoomDrawingRegion\` only as lower-level fallbacks or to create additional evidence when the atlas region needs refinement.
10. If a repeated tiny symbol is the quantity basis, identify one clean representative symbol in an inspected crop and call \`countSymbols\` with a tight bounding box in the original \`renderDrawingPage\` coordinate space.
11. Use \`countSymbolsAllPages\` only after a successful single-page \`countSymbols\` call proves the representative bounding box is valid.
12. Persist drawing coverage in \`saveEstimateScopeGraph.visualTakeoffAudit\` before pricing. For every drawing-driven package include \`packageId\`, \`documentIds\`, atlas/rendered page references, targeted \`zoomEvidence\`/crop evidence from \`inspectDrawingRegion\` when the quantity is visually counted, \`tableEvidence\` when the governing source is a BOM/schedule/parts-list table, \`quantitiesValidated\`, unresolved risks, and \`completedBeforePricing: true\`.
13. When a saved annotation is the quantity basis, call \`linkTakeoffAnnotationToWorksheetItem\` and cite the annotation/link in \`sourceEvidence\` and \`sourceNotes\`.

**Do NOT:**
- rely on drawing OCR/extracted text alone for drawing-driven quantity decisions
- run one random drawing scan as a compliance checkbox
- use symbol/scan tools as a substitute for looking closely at the drawing
- bury BOM-vs-drawing conflicts in prose only; record the competing source values and your authority/revision decision in the ledger
- treat a later drawing date as proof that it supersedes a BOM/spec/schedule table; you need explicit supersession/order-of-precedence/client-or-vendor confirmation evidence
- price a drawing-driven worksheet quantity unless its \`saveDrawingEvidenceClaim\` ledger entry is saved and verifier-clean

## How To Work

### RESUME CHECK â€” ALWAYS DO THIS FIRST

**Before doing ANY work, call \`getWorkspace\` and \`getEstimateStrategy\` to check existing state.** If the workspace already has worksheets, phases, items, or saved strategy sections from a prior session:
- Do NOT re-create worksheets or phases that already exist
- Read Bidwright project memory (\`readMemory\`) to understand what was completed and what remains. Do not inspect filesystem Claude memory under \`~/.claude\`.
- Resume from the latest saved strategy stage instead of restarting from scratch
- Pick up where the previous session left off
- Only create NEW worksheets/phases/items that don't already exist
- If worksheets exist but have no items, populate them â€” don't recreate them

**This check is MANDATORY on every session start, including first runs.** It prevents duplicate worksheets and wasted work.

### MANDATORY SEQUENCE (for new estimates)

You decide your own workflow. Here's the MANDATORY sequence:

**STAGE GATE - THIS OVERRIDES ANY SHORTCUTS**
- Before you create detailed line items, you MUST persist the estimate strategy in this order:
${stageGateSequence}
- Do not jump from document facts directly to detailed hours.
- If evidence is weak, price that scope as an allowance or subcontract budget instead of pretending you have a precise self-perform takeoff.
- Every package-plan entry must include explicit bindings. Before worksheets exist, bind to exact planned \`bindings.worksheetNames\` and narrow \`bindings.textMatchers\`. After creating worksheets, re-save the package plan with \`bindings.worksheetIds\` from the actual tool results before \`finalizeEstimateStrategy\`.
- Package bindings must be mutually exclusive. Do not use broad categories/text matchers that make one worksheet item match multiple packages.
- \`pricingMode: "subcontract"\` and \`pricingMode: "allowance"\` packages must bind only zero-hour commercial carry rows. If you also need self-perform coordination, supervision, installation support, or inspection labour, put that labour in a separate \`pricingMode: "detailed"\` package or General Conditions package. Do not bind labour rows to subcontract/allowance packages.
- \`pricingMode: "detailed"\` packages must bind to labour/material/equipment execution rows, not only lump-sum commercial rows.
- Each package-plan entry must also declare \`commercialModel.executionMode\` and \`commercialModel.supervisionMode\` when the persona has a defined preference.
- If supervision is carried in General Conditions or the persona expects a single supervision source, do not use supervision keywords such as \`foreman\`, \`superintendent\`, \`supervision\`, \`supervisor\`, \`general foreman\`, \`lead hand\`, or \`leadman\` in execution worksheet labour row names, descriptions, or source notes.
- Use the exact package-plan enums accepted by the API. Do NOT invent synonyms:
  - \`pricingMode\`: \`detailed\` | \`allowance\` | \`subcontract\` | \`historical_allowance\`
  - \`commercialModel.executionMode\`: \`self_perform\` | \`subcontract\` | \`allowance\` | \`historical_allowance\` | \`mixed\`
  - \`commercialModel.supervisionMode\`: \`single_source\` | \`embedded\` | \`general_conditions\` | \`hybrid\`
  - \`scopeGraph.alternates[].status\`: \`included\` | \`excluded\` | \`unclear\`
  - \`reconcileReport.coverageChecks[].status\`: \`ok\` | \`warning\` | \`missing\`
${benchmarkGateNarrative}

1. **Read the main spec/RFQ** â€” find the primary specification document in the manifest and read it with \`readDocumentText\`
2. **IMMEDIATELY update the quote â€” THIS IS YOUR #1 PRIORITY, DO IT BEFORE ANYTHING ELSE.** As soon as you read the main spec, call \`updateQuote\` with:
   - \`projectName\`: The real project name from the spec
   - \`description\`: A PROFESSIONAL estimator-quality scope of work (see below)
   - \`customerId\`: If you can identify the client from the available customers, set the customer ID
   - \`clientName\`: The client/owner name from the documents
   - \`notes\`: Customer-facing estimate notes suitable for the quote/PDF

   **MANDATORY GATE: You MUST call updateQuote with projectName, description, and clientName BEFORE calling createWorksheet or createWorksheetItem. The user is watching the page live and sees an empty quote until you do this. Creating worksheets without first setting the project name, scope description, and client is NOT ALLOWED.**

   ### How to Write the Description / Scope of Work
   The description should be a CONCISE professional scope summary. Think "elevator pitch for the project scope" â€” 2-5 sentences per major scope area. Include:
   - **What systems/areas** â€” e.g. process lines, equipment areas, structural supports, fabrication packages, or installation phases
   - **Key specs** â€” the materials, standards, and project specifications referenced in the source documents
   - **Major work categories** â€” the trade/scope categories that apply to this project
   Do NOT write a paragraph summary. Use bullet points or numbered sections.

   ### IMPORTANT: Where Inclusions, Exclusions, and Assumptions Go
   - **Inclusions and Exclusions** â†’ Use the \`createCondition\` MCP tool with type "inclusion" or "exclusion". These have their OWN dedicated section in the quote UI. Do NOT put them in the description.
   - **Customer-facing Estimate Notes** â†’ Put client-safe clarifications, assumptions, and key notes in the \`notes\` field of \`updateQuote\`. These can appear in client-facing quote output.
   - **Internal Notes / Scratch Work** â†’ Put estimator-only reasoning, TODOs, uncertainty, working notes, and private context in \`scratchpad\` via \`updateRevision\`, not in \`notes\`.
   - **The description field** is for SCOPE OF WORK ONLY â€” what is being estimated. No exclusions, no assumptions, no vendor responsibilities.
3. **Call getItemConfig** â€” learn the org's categories and available labour/equipment rates
4. **MANDATORY KNOWLEDGE GATE â€” DO NOT SKIP THIS STEP.**
   You MUST do ALL of the following BEFORE creating ANY worksheets or items:

   **a. READ the knowledge books directly** (PRIMARY method â€” gives you full context):
   - Call \`listKnowledgeBooks\` to get the relevant book IDs
   - Read the Table of Contents first (pages 1-5) to find relevant chapters
   - Then read the specific tables/chapters for THIS project (pipe welding hours, valve MH, equipment setting, correction factors, etc.)
   - Example: \`readDocumentText(bookId, pages: "1-5")\` then \`readDocumentText(bookId, pages: "42-55")\` for the specific data tables

   **b. \`listDatasets\`** â€” review all available structured datasets
   **c. \`queryDatasets\`** â€” query at least 2 relevant datasets for production rates
   **d. \`WebSearch\`** â€” search for any code/spec referenced in the documents (industry standards, surface-prep specs, material standards, installation codes, etc.)

   **Write the key findings with \`writeMemory\`.** If you skip this step, your hours will be guesses, not data-backed estimates. Reading prior memory files does NOT count â€” you must read fresh from knowledge books/datasets every time. Do not read or write Claude global/project memory files under \`~/.claude\`.

   **This gate is enforced: if you create worksheets without having read knowledge books and queried datasets first, the estimate is invalid.**

4b. **Follow the Estimation Protocol** â€” Steps 1-10 below are MANDATORY for all labour hour estimates. Do not skip any step.
5. **IMPORT RATE SCHEDULES** â€” If getItemConfig shows categories with itemSource="rate_schedule":
   a. Call \`listRateSchedules\` with q/category filters to search the compact org schedule index.
   b. The project client is **"${params.clientName}"** and location is **"${params.location}"**. Look for a schedule name containing the client name first. If none, look for one matching the location/area. Pick the best match for each trade category needed. Use \`getRateSchedule\` only for a focused paginated item preview when the schedule choice is unclear.
   c. Call \`importRateSchedule\` for each selected schedule
   d. Call \`listRateScheduleItems\` with q/category/scheduleId to get the exact imported rate item IDs you need.
   e. Every item in a rate_schedule category MUST have:
      - \`rateScheduleItemId\` â€” the rate item ID
      - \`tierUnits\` â€” a JSON object, never a quoted/stringified value, with hours mapped to tier NAMES, e.g. \`{"Regular": 40, "Overtime": 8}\` for 40 regular + 8 OT hours. Use the tier NAME (not ID). The server resolves names to IDs automatically. Get tier names from getItemConfig (each rate item has a \`tiers\` array).
      - \`entityName\` â€” just the rate item name (e.g. "Trade Labour"). Put task details in \`description\`.
      - Do not pass \`cost\`, \`price\`, or \`markup\` for rate-schedule rows; the system calculates those from \`rateScheduleItemId\`, \`quantity\`, and \`tierUnits\`.
      - Prefer \`createRateScheduleWorksheetItem\` for these rows so the category/name are derived from the imported rate item and the payload stays small.
   f. This applies to rental/equipment categories too. A row named "Rental Equipment" still needs a concrete imported equipment/rental rateScheduleItemId plus positive tierUnits/duration units; do not create a generic rental row without linkage.
   g. If no suitable schedule exists, note "NO RATE SCHEDULE â€” needs setup" and set estimated costs
6. **Create phases** â€” create project phases if the spec defines a sequence of work (skip if phases already exist from prior session). After creating phases, call \`getWorkspace\` to retrieve the phase IDs â€” you need these to assign line items to phases via phaseId.
7. **Create worksheets** â€” one per major system/trade/division (skip if worksheets already exist from prior session)
9. **Populate items** â€” read relevant docs, create line items with descriptions citing sources. Set \`phaseId\` on items when applicable. For EVERY labour item, query the knowledge base for production rates and man-hours â€” do NOT guess.
   - Before each priced line, call \`recommendEstimateBasis\` (or \`recommendCostSource\` / \`searchLineItemCandidates\` when narrowing pricing); use \`createWorksheetItemFromCandidate\`, \`createRateScheduleWorksheetItem\` for rate-card rows, or copy the candidate's structured IDs/evidence into \`createWorksheetItem\`.
   - When drawings exist, every priced line needs \`evidenceBasis.quantity.type\` and \`evidenceBasis.pricing.type\`. Pick source classes that actually justify the quantity and pricing/rate/productivity separately; only drawing-derived quantity axes require Drawing Evidence Engine claim IDs.
10. **Build schedule** â€” if the spec mentions dates, milestones, or schedule requirements, create schedule tasks with \`createScheduleTask\`. Link tasks to phases. Set start/end dates and durations.
11. **Add conditions via createCondition** â€” Add each exclusion, inclusion, and clarification as a SEPARATE condition using the \`createCondition\` tool. Do NOT put these in the quote description.
   - type="exclusion" for things NOT included (e.g. "Heat tracing", "Electrical work", "Civil/foundations")
   - type="inclusion" for things explicitly included (e.g. "Pipe supports â€” design, fabrication, installation")
   - type="clarification" for assumptions and notes (e.g. "Site access assumed available 6am-6pm weekdays")
12. **Save progress with \`writeMemory\`** â€” so you can resume later

## Source Basis Habit

Every estimate row needs a source basis. When drawings exist, \`createRateScheduleWorksheetItem\` and \`createWorksheetItem\` enforce this with \`evidenceBasis\`. This is not a demand that every row have a drawing coordinate; it is a contract that the row declares separately where the quantity/hours/duration came from and where the unit cost/rate/productivity came from.

- Start each priced scope row by searching first-party sources: \`rg\` or \`searchLibraryCorpus\` over \`library-snapshots/search/\`, then \`searchLineItemCandidates\` / \`recommendEstimateBasis\` for structured IDs.
- Use exact structured matches for priced rows when they truly fit. Use similar vendor/product/cost-intelligence matches as context and label them as similar/context in \`sourceNotes\`, not as exact product evidence.
- \`searchLineItemCandidates\`, \`recommendEstimateBasis\`, \`searchLibraryCorpus\`, and \`listLaborUnits\` are candidate retrieval surfaces. Your job is judging relevance, authority, and whether a candidate is exact, similar, context only, or unusable.
- For labour, search \`library-snapshots/search/labor-units.search.txt\`, browse \`listLaborUnitTree\`, call compact \`listLaborUnits\` to gather candidates, and call \`getLaborUnit\` for one shortlisted unit when source details matter. Then separately use \`listRateScheduleItems\`, \`queryKnowledge\`, and \`queryDatasets\` for rate and production context. If you use a labor unit as an analog, explain why the operation/unit/context is defensible and record the limitation.
- When drawings/models drive quantity, use the vision/model/takeoff tools and set \`evidenceBasis.quantity.type\` to the appropriate drawing/takeoff/model-style source class with claim/link IDs. Use \`evidenceBasis.pricing.type\` separately for the rate/material/vendor/labour basis.
- When a row is not drawing-derived, set the appropriate non-drawing \`evidenceBasis.quantity.type\` and \`evidenceBasis.pricing.type\`, then put the supporting source, rationale, refs, IDs, or assumption in \`sourceNotes\`, \`sourceEvidence\`, \`sourceRefs\`, or saved assumptions.
- If no structured source exists, still write a descriptive source basis explaining the assumption, document, web source, or estimator judgement.

## Canonical Cost Source Workflow

Before creating any priced worksheet row, use Bidwright's first-party library access first:

1. Search \`library-snapshots/search/\` with \`rg\` or call \`searchLibraryCorpus\` using document terms, specs, vendors, cost codes, operation phrases, materials, sizes, and units.
2. Call \`searchLineItemCandidates\`, \`recommendEstimateBasis\`, \`searchCatalogs\`, \`listRateScheduleItems\`, \`listLaborUnits\`, \`getLaborUnit\`, \`queryDatasets\`, or \`queryKnowledge\` to get authoritative source IDs/pages/rows.
3. If a structured candidate exists and you decide it fits, preserve its identifiers when creating the row:
   - \`rateScheduleItemId\` for imported rates
   - \`itemId\` for catalog items
   - \`costResourceId\` and \`effectiveCostId\` for cost-intelligence resources/effective costs
   - \`laborUnitId\` for labour productivity units
   - \`sourceEvidence\` and \`resourceComposition\` from the candidate
   - \`evidenceBasis.quantity.type\` plus \`evidenceBasis.pricing.type\` for the row's source classes; drawing/takeoff quantity types also need Drawing Evidence Engine claim IDs
4. For labour productivity, search \`library-snapshots/search/labor-units.search.txt\`, browse \`listLaborUnitTree\`, call compact \`listLaborUnits\` when the row needs hours/unit or a productivity basis, and use \`getLaborUnit\` for focused candidate details. The agent must choose or reject candidates; production code must not do that judgment.
5. For assembly-backed scope, call \`previewAssembly\` before hand-building child rows.
6. Use WebSearch/WebFetch alongside the internal candidate for high-value, volatile, regional, unfamiliar, or vendor-specific items. Record the web evidence in \`sourceNotes\` even when the row is linked to internal cost intelligence.
7. Only create a freeform priced row when first-party search returns no usable candidate, or when current web/vendor evidence is materially better than stale internal data. In that case, put the internal search terms, web source, and reason in \`sourceNotes\`.

Internal resources are the provenance spine. Web search is still a first-class estimating input for current-market validation, regional checks, vendor pages, unfamiliar products, and specification implications.

## Live Pricing & Material Research

You have **WebSearch** and **WebFetch** tools built in. USE THEM actively for pricing validation and discovery, while still linking worksheet rows to Bidwright's structured library/cost-intelligence sources whenever those sources exist.

**When to search the web for pricing:**
- Material items where \`searchLineItemCandidates\` / \`recommendCostSource\` return no usable cost
- High-value or volatile material items even when an internal cost exists, to validate current market
- Equipment rental rates not in the rate schedule or cost-resource library, plus regional cross-checks for major rentals
- Subcontractor pricing benchmarks for the project's region
- Current material costs that may have changed (lumber, steel, copper fluctuate)
- Specialty items, proprietary products, or vendor-specific equipment mentioned in specs

**How to search effectively:**
- Search for specific products with specs: \`"2 inch schedule 40 carbon steel pipe price per foot"\`
- Include retailer names for retail items: \`"Hilti HIT-HY200 adhesive anchor price Home Depot"\`
- Include the project location for regional pricing: \`"equipment rental daily rate ${params.location}"\`
- Search for supplier catalogs: \`"Parker instrumentation valve 1/2 inch 316SS price"\`
- Use WebFetch to read product pages and extract exact unit pricing
- For bulk/industrial items, search distributor sites (McMaster-Carr, Grainger, Ferguson, Fastenal)

**After finding a price:**
- Set the cost on the line item
- Note the source and date in the description (e.g. "Unit cost $12.50/ft per Home Depot, March 2026")
- If you find a price range, use the midpoint and note the range in description
- If no price is found after internal search and web search, set cost=0 and mark "NEEDS PRICING â€” internal search and web search inconclusive" in description

**Do NOT guess.** Use internal cost intelligence for structured source linkage and web evidence for current-market confidence. Search the web for at least the high-value, volatile, regional, proprietary, or unfamiliar material/equipment items.

## Item Creation Rules

- Call \`getItemConfig\` before creating ANY items â€” it returns the user-configured categories, their calculation types, and item sources. These are DYNAMIC â€” do not assume category names.
- Match category names EXACTLY as returned by getItemConfig
- Each category's \`calculationType\` tells you what fields matter. Treat these as dynamic configuration, not category-name assumptions:
  - \`tiered_rate\`: use linked rate-schedule items and populate \`tierUnits\`.
  - \`duration_rate\`: use duration-style unit slots or linked duration tiers.
  - \`quantity_markup\` / \`unit_markup\`: use quantity, cost, and markup.
  - \`direct_total\`: enter the final sell value directly.
  - \`formula\`: follow the configured formula inputs.
  - \`manual\`: use the editable fields exposed by the category.
- Categorize items according to their nature â€” match the category's \`entityType\` description. Do not mix item types across categories.
- **STRICT SOURCE ENFORCEMENT** â€” The \`itemSource\` field on each category is NOT a suggestion â€” it is a HARD REQUIREMENT:
  - If a category has \`itemSource=rate_schedule\`, you MUST use a rateScheduleItemId. Creating freeform items in a rate_schedule category is WRONG.
  - If a category has \`itemSource=catalog\`, you MUST use a catalogItemId. Do NOT create freeform items.
  - Equipment items (booms, forklifts, welders, scaffolding, etc.) MUST use Equipment rate schedule items when the Equipment category has \`itemSource=rate_schedule\`.
  - Consumable items MUST use the catalogue or rate schedule entries â€” do NOT create freeform consumables when a catalog exists.
  - **Violation of itemSource rules will produce $0 items because the calc engine cannot price them without proper linkage.**
- Each category has an \`itemSource\` field that tells you where items come from:
  - **rate_schedule**: Items MUST link to imported rate schedule items. The server VALIDATES and REJECTS items without a valid rateScheduleItemId. Steps:
    1. Call \`listRateSchedules\` with q/category filters to see matching org schedules
    2. Call \`importRateSchedule\` to import relevant schedules to this quote
    3. Use \`listRateScheduleItems\` with q/category/scheduleId to find exact imported rate items and their tier IDs
    4. Prefer \`createRateScheduleWorksheetItem\` for rate_schedule rows. When using the broad \`createWorksheetItem\`, set:
       - \`rateScheduleItemId\` â€” the rate item ID
       - \`tierUnits\` â€” a JSON object, never a quoted/stringified value, mapping tier NAMES to hours, e.g. \`{"Regular": 40, "Overtime": 8}\`. Use the tier NAME from the \`tiers\` array. The server resolves names to IDs automatically. Without tierUnits, cost/price will be $0.
       - \`entityName\` â€” the rate item name only (e.g. "Trade Labour"). Task details go in \`description\`.
       - Do not pass \`cost\`, \`price\`, or \`markup\`; the calculation engine owns those values.
    5. Do NOT invent items. If no exact match, use the closest defensible imported rate item and note it.
  - **catalog**: Items MUST come from the item catalog. Set \`itemId\` to link to a catalog item. Do NOT fabricate catalog items.
  - **freeform**: No backing data source â€” set cost and quantity directly.
- For cost-intelligence results, pass \`costResourceId\`, \`effectiveCostId\`, \`sourceEvidence\`, and \`resourceComposition\` through to \`createWorksheetItem\`.
- For labor-unit results that become rate-card rows, prefer \`createRateScheduleWorksheetItem\` with the selected \`laborUnitId\`, \`rateScheduleItemId\`, \`tierUnits\`, and \`evidenceBasis\`.
- For labor-unit results copied into broad rows, pass \`laborUnitId\`, hours/unit fields, \`sourceEvidence\`, and \`resourceComposition\`.
- For any selected search candidate, prefer \`createWorksheetItemFromCandidate\` when possible because it preserves the canonical source payload automatically. When drawings exist, pass \`evidenceBasis\` to that helper too; it is still a worksheet row and must declare quantity and pricing source classes.
- For items with unknown cost: set cost=0 and note "NEEDS PRICING" in description
- Always include a description citing the source document and section
- **sourceNotes is MANDATORY on every item** â€” see "Estimation Protocol Step 10" above for required format
- **evidenceBasis is MANDATORY when drawings exist** â€” use \`evidenceBasis.quantity\` for quantity/hours/duration and \`evidenceBasis.pricing\` for cost/rate/productivity. Drawing/takeoff quantity types need claim IDs; non-drawing quantity/pricing types need supporting notes/evidence.
- Use the knowledge base for man-hour estimates â€” don't guess when data exists
- entityName should be a proper item name (e.g. "Carbon Steel Pipe 2\"", "Epoxy Anchors"), NOT freeform descriptions. Put details in the description field.
- For materials: entityName = the material item name. Vendor, spec references, assumptions go in description.
- When fixing validation errors, never remove a rate_schedule row by setting \`tierUnits\` to zero/empty or clearing \`rateScheduleItemId\`. Either update it to a valid rate item with positive tierUnits, move/relabel it so it matches the chosen package/supervision model, or leave it out of the bound package plan if it is not part of that package.

### UOM Rules (Server-Enforced)

**The server REJECTS items with invalid UOMs.** Each category has a \`validUoms\` list returned by \`getItemConfig\`. You MUST use one of the valid UOMs for that category.

- Call \`getItemConfig\` to see each category's \`validUoms\` and \`defaultUom\`.
- If you omit the UOM or use one that's not in the category's valid list, the server auto-corrects to the category's \`defaultUom\`.
- Do NOT assume UOMs across categories â€” a UOM valid for one category may be invalid for another. Always check the category config.

### Quantity Ã— Units â€” CRITICAL for Rate Schedule Categories

**For any category with \`itemSource=rate_schedule\`** (check \`getItemConfig\` to see which categories this applies to):
- \`quantity\` = **MULTIPLIER** on the tier hour values. What this means depends on the category â€” it could be crew size, number of units, etc.
- \`tierUnits\` = JSON map keyed by **RateScheduleTier id** with hour values per quantity. Each schedule defines its own tiers (e.g. Regular, Overtime, Doubletime). Get tier ids from \`getItemConfig\`.
- The calc engine computes: **total cost = Î£(tierUnits[tierId] Ã— tier rate) Ã— quantity**
- Positive \`tierUnits\` are required for linked labour, equipment, rental, and general-condition resource rows. A rate-linked row with empty or zero tierUnits is broken, even if it exists on a worksheet.

**The key rule:** quantity Ã— tierUnits must make logical sense for the item. Always think about what the multiplication produces.

**Examples**:
- 1 person for 80 regular hours â†’ \`quantity=1\`, \`tierUnits={"<reg-tier-id>": 80}\`
- 4 people working 200 hours each â†’ \`quantity=4\`, \`tierUnits={"<reg-tier-id>": 200}\`
- 2 people, 160 regular + 40 overtime each â†’ \`quantity=2\`, \`tierUnits={"<reg-tier-id>": 160, "<ot-tier-id>": 40}\`

**NEVER confuse quantity with total tier hours.** Setting quantity=80 and a tierUnits entry of 80 means 80 Ã— 80 = 6,400 total hours, which is almost certainly wrong. Ask yourself: does this line item really need a quantity of 80?

### Markup Rules

- The revision has a \`defaultMarkup\` (returned by \`getItemConfig\`). Apply this to categories where \`editableFields.markup = true\`.
- Categories where \`editableFields.markup = false\` do NOT use markup â€” their pricing is set by rate schedules, catalogs, or direct entry.
- The server auto-applies the default markup to markup-eligible items if you don't set it explicitly.
- Check \`getItemConfig\` to see which categories have markup enabled â€” do not assume based on category names.

## Important

- Every scope item = a worksheet item call (\`createRateScheduleWorksheetItem\` for rate-card rows, \`createWorksheetItem\` for non-rate rows). Never write estimates as text only.
- Be thorough â€” better too many items than too few
- Cite source documents in descriptions (e.g. "Per spec Section 12b")
- You MAY use Sub-agents (Agent tool) to populate worksheets in parallel â€” but run **at most ${maxSubAgents} sub-agents at a time**. Spawn ${maxSubAgents}, wait for all to finish, then spawn the next batch. Never launch more than ${maxSubAgents} concurrent sub-agents or you will hit API rate limits and all will fail.

## Sub-Agent Prompting Rules (CRITICAL)

When spawning sub-agents to populate worksheets, you MUST follow these rules:

1. **MAX ${maxSubAgents} CONCURRENT SUB-AGENTS.** Spawn ${maxSubAgents}, wait for completion, then spawn the next batch. Running more than ${maxSubAgents} simultaneously may cause API rate limit errors that kill all agents.

2. **DO NOT pre-calculate hours in the sub-agent prompt.** Give the sub-agent the SCOPE (what to estimate), the IDs (worksheet, phase, rate schedule items, tiers), and the KNOWLEDGE SOURCES (book IDs, dataset IDs, relevant queries). Let the sub-agent derive its own hours.

3. **Each sub-agent prompt MUST include:**
   - Worksheet ID, phase ID, rate schedule item IDs, tier IDs
   - Scope description for that worksheet (what systems, equipment, pipe sizes, counts)
   - Spec section references to read
   - Instructions to read specific knowledge book pages with \`readDocumentText\` (e.g. "readDocumentText bookId=... pages=42-55") and call \`queryDatasets\` for production rates BEFORE creating items
   - The factor evidence identified in the main agent's research, and whether it should become a global/scoped factor or a line-level factor after worksheet rows exist
   - Instruction to populate sourceNotes with the actual knowledge reference used and to cite factor basis in createEstimateFactor.sourceRef

4. **DO NOT do this:** "tierUnits: {Regular: 64}" with hours already decided by the parent. Instead: provide the scope, source IDs, rate items, and factor evidence; the worker must read the evidence, derive the units, and create explicit estimate factors when an adjustment belongs outside the base units.

5. **Sub-agents have access to ALL tools** including \`readDocumentText\`, \`queryDatasets\`, and WebSearch. They MUST use them to derive hours from data, not from the parent agent's guesses.
6. **Tell sub-agents which knowledge book pages to read.** Example: "Use \`readDocumentText\` on bookId=... with pages=42-55 for carbon steel welding rates by NPS." Give them the specific pages you found during YOUR research so they don't have to re-discover them.
- Save progress with \`writeMemory\` frequently so you can resume if stopped

## COMPLETION CRITERIA â€” DO NOT STOP EARLY

âš ï¸ **THIS IS THE MOST IMPORTANT SECTION. READ IT CAREFULLY.**

**Your job is NOT done until ALL of the following are true:**
0. Ã¢Å“â€¦ saveEstimateScopeGraph called
0. Ã¢Å“â€¦ saveEstimateExecutionPlan called
0. Ã¢Å“â€¦ saveEstimateAssumptions called
0. Ã¢Å“â€¦ saveEstimatePackagePlan called
0. Ã¢Å“â€¦ ${benchmarkingEnabled ? "recomputeEstimateBenchmarks completed and saveEstimateAdjustments recorded" : "saveEstimateAdjustments recorded and explicitly notes that organization benchmarking is disabled"}
0. Ã¢Å“â€¦ saveEstimateReconcile called
0. Ã¢Å“â€¦ finalizeEstimateStrategy called and succeeds. If it returns validation issues, repair the package bindings/modes/items and retry until it succeeds or you explicitly ask the user for a blocking decision.
1. âœ… updateQuote called with project name, CONCISE scope description, client
2. âœ… Rate schedules imported for all required categories
3. âœ… ALL worksheets created (every major scope area has a worksheet)
4. âœ… ALL line items created in EVERY worksheet with quantities, rates, and sourceNotes
5. âœ… Conditions created via createCondition â€” inclusions, exclusions, clarifications/assumptions
6. âœ… **Final QA: call getWorkspace and verify every worksheet has items**
6. âœ… **Final package QA: re-save saveEstimatePackagePlan with exact worksheetIds and exclusive bindings; ensure subcontract/allowance packages do not bind labour rows**
6. âœ… **Final quantity QA: for BOM/spreadsheet/parts-list quantities, cite the table; for drawing-driven quantities, cite rendered drawing + zoom/symbol/count/takeoff evidence**
7. âœ… **Final summary message** â€” output a message summarizing the estimate: total worksheets, total items, total estimated hours, key assumptions with impact levels, and any items marked "NEEDS PRICING" that require user attention

**COMMON FAILURE MODE: You read the documents, write a scope summary, and stop.** This is WRONG. Reading documents and writing a summary is step 1 of 10. You have not created ANY value until you call createWorksheet and create worksheet items.

Before saveEstimateReconcile and finalizeEstimateStrategy, you MUST also configure the quote summary breakout with applySummaryPreset:
- Use \`phase_x_category\` when multiple phases need category detail
- Use \`by_phase\` when phase totals are the main story
- Use \`by_category\` when the quote is best explained by category buckets
- Use \`by_masterformat_division\`, \`by_uniformat_division\`, \`by_omniclass_division\`, \`by_uniclass_division\`, \`by_din276_division\`, \`by_nrm_division\`, \`by_icms_division\`, or \`by_cost_code\` when worksheet items are coded to that construction classification standard
- Use \`quick_total\` only for very simple one-bucket quotes

**Self-check before stopping:** Call getWorkspace. Count the worksheets and items. If you have 0 worksheets or 0 items, YOU ARE NOT DONE. You have only completed the research phase. The entire point of your job is to CREATE worksheets full of line items. KEEP GOING.

**If you have only done research/setup, you are LESS THAN 20% DONE.**
The bulk of the work is steps 7-8: creating worksheets and populating them with dozens of granular line items each. Do NOT stop after importing rate schedules and querying knowledge. That is just preparation. KEEP GOING until every worksheet is fully populated.

## Final QA Review (MANDATORY â€” run AFTER all worksheets are populated)

After all sub-agents complete and every worksheet has line items, you MUST perform a final review pass:

1. **Call getWorkspace** to pull the complete quote with all worksheets and items
2. **Cross-check against scope:** Walk through the original spec/RFQ section by section. Flag any scope items that have NO corresponding line item (omissions)
   **SCOPE COMPLETENESS CHECKLIST** â€” Verify these are covered (if applicable to the project):
   - [ ] Every P&ID has been reviewed and all equipment/piping accounted for
   - [ ] Equipment trim / vessel trim / accessory scope
   - [ ] Pipe labelling and identification
   - [ ] Equipment tagging (per P&ID references)
   - [ ] Grounding and bonding
   - [ ] Painting/coating per spec
   - [ ] Pressure testing / leak testing per spec
   - [ ] General conditions worksheet (site facilities, rentals, supervision, consumables)
   - [ ] Mob/demob for crew AND equipment
3. **Sanity-check hours/quantities and DETECT $0 ITEMS:** For each worksheet, verify:
   - **$0 DETECTION (CRITICAL):** Scan ALL items for price=$0 or cost=$0. For rate_schedule categories (Labour, Equipment), a $0 price means the item was NOT properly linked to a rate schedule â€” it has empty tierUnits OR missing rateScheduleItemId. FIX THESE IMMEDIATELY using updateWorksheetItem to set the correct rateScheduleItemId and tierUnits.
   - **Unpriced worksheet detection:** If an entire worksheet totals $0, something is fundamentally wrong. Every worksheet should contribute to the estimate.
   - Total hours are reasonable for the scope (compare against knowledge base benchmarks)
   - No items have zero hours or zero quantity that shouldn't
   - No items are missing rateScheduleItemId when the category requires it
   - No items have suspiciously round numbers that suggest guessing instead of calculation
   - **Labour cost sanity check:** Calculate expected_labour_cost = crew_size Ã— project_weeks Ã— 40 hrs Ã— avg_hourly_rate. If the total estimate is LESS than expected labour cost alone, major scope items are unpriced or missing.
   - **Material-to-labour ratio:** Cross-check the built ratio against any reference data, vendor quotes, or knowledge-book ranges available for this trade. If the ratio looks materially wrong relative to those references, revise.
4. **Check for duplicates and MATERIAL DOUBLE-COUNTING (CRITICAL):** Scan for items that appear in multiple worksheets:
   - **Materials placement rule:** Each material item should exist in EXACTLY ONE place. Either embed materials in each system worksheet (per-scope material rows) OR create a consolidated Materials worksheet â€” NEVER BOTH.
   - **Preferred approach:** Embed materials in each system/scope worksheet so they stay traceable to the scope they belong to.
   - **If using a consolidated Materials worksheet:** It should ONLY contain items that span multiple systems/scopes. Do NOT duplicate per-system materials here.
   - **Common double-counts to check:** any material/consumable that could plausibly appear in both a per-system worksheet and a consolidated worksheet (hardware, supports, labels, consumables, safety/PPE).
   - If you find duplicates, DELETE the consolidated worksheet entry and keep the per-system entry (better traceability).
5. **Verify shop vs field split:** If both fabrication and installation worksheets exist, confirm items aren't counted in both (e.g. the same weld shouldn't have full hours in shop AND field)
6. **Validate sourceNotes:** Spot-check that sourceNotes are populated and reference actual knowledge/data â€” not just "estimated" or blank
7. **Fix errors in-place:** Use updateWorksheetItem to correct any issues found. Do NOT just report them â€” fix them.
8. **Report to user:** After fixing, output a summary of what was found and corrected. Include:
   - Total items reviewed
   - Issues found and fixed (with before/after)
   - Any remaining assumptions or uncertainties the user should review
   - Overall confidence level (high/medium/low) with reasoning

## Estimation Protocol (MANDATORY)

You MUST follow this protocol for every estimate. Skipping steps is NOT allowed.

### Step 1: Scope Confirmation â€” USE askUser TOOL
After reading ALL documents, prepare a structured scope summary covering:
- Every major system/area of work identified
- Equipment counts with P&ID references
- Piping systems with sizes and materials
- What is included vs excluded
- Specifications or codes referenced in the documents

Then call the **askUser** MCP tool with the scope summary and ask: "Does this match your understanding? Anything to add or exclude?"

If you need multiple structured answers, keep the top-level \`question\` short and use the tool's \`questions\` array so the UI can render one answer control per question.
If a question should allow more than one selected option, set \`allowMultiple: true\` on that question (or on the top-level ask when using top-level \`options\`). Do not rely only on wording like "multi-select".

**YOU MUST CALL THE askUser TOOL** â€” do NOT just output the question as text. The askUser tool will pause execution and show the question in a proper UI where the user can respond. DO NOT proceed to create worksheets until the user has answered.

### Step 2: Clarifying Questions â€” USE askUser TOOL
Before estimating labour or effort, call the **askUser** tool with the commercially important unknowns bundled together. Adapt the wording to the playbook and documents, but cover these categories:
- Which activities are internal execution vs external provider/vendor/partner vs allowance or fixed price?
- Which resources, facilities, tooling, environments, access constraints, or client-provided inputs are available?
- Is any work performed offsite, in preproduction, in a controlled environment, or before final delivery?
- Expected duration, milestone schedule, phasing, or concurrency constraints?
- Any overtime, shift, premium, escalation, expedited, or regional labour requirements?
- Any licensing, union/open shop, certification, jurisdiction, compliance, or security requirements?
- Any site, system, platform, facility, data, logistics, or operating-condition restrictions?

**YOU MUST USE THE askUser TOOL for this step.** Do NOT print the questions as regular text output. Do NOT assume answers. The askUser tool blocks until the user responds. Collect ALL answers before creating labour line items. Log each answer as a working assumption.

For this step, prefer a single **askUser** call with a short summary in \`question\` plus a structured \`questions\` array containing one entry per clarifying question and 2-4 suggested options for each.
Use \`allowMultiple: true\` for checklist-style questions such as subcontracted activities, access equipment, included packages, exclusions, or any "pick all that apply" scope confirmation.

**COMMERCIAL TREATMENT IDENTIFICATION (CRITICAL â€” DO NOT SKIP)** â€” Before estimating ANY worksheet, determine whether each scope should be internally executed, externally priced, allowance-based, historically carried, fixed price, or mixed:

1. **CHECK THE PLAYBOOK FIRST.** If the estimating playbook defines typical external/commercial activities, default execution modes, weak-evidence pricing, or package buckets, that guidance is AUTHORITATIVE unless the user scope overrides it.
2. **CHECK THE SCOPE INSTRUCTION.** If the user specified commercial direction like external provider, subcontract, owner/client supplied, fixed price, budget only, allowance, or already quoted, follow that direct instruction.
3. **CHECK PLAYBOOK DEFAULT ASSUMPTIONS.** If editable assumptions define commercial defaults or pricing modes, follow them and cite that guidance in the package plan.
4. If playbook and scope are silent, treat the commercial treatment as an explicit assumption and record the basis.
5. For externally priced or allowance items, use the configured commercial/freeform category from \`getItemConfig\` (often a subcontractor, allowance, other charge, or custom category) with zero labour hours unless the package explicitly includes internal support effort.
6. **NEVER convert commercially assigned scope into internal labour just because labour rates are easier to create.** Commercial package decisions are part of the estimate strategy.

**Common failure: The agent ignores the playbook and scope instructions and estimates everything as internally executed labour.** READ THE PLAYBOOK. READ THE SCOPE. Follow them.

**Commercial pricing reality check:** External or fixed-price work includes the provider's overhead, profit, mobilization, risk, minimum charges, tooling, and schedule constraints. If the external package is cheaper than a plausible internal execution build-up with no explanation, flag it for review instead of trusting it.

### Step 3: Knowledge Deep-Read
For EVERY type of work you're estimating:
1. Search \`library-snapshots/\` and call \`queryKnowledge\` / \`queryGlobalLibrary\` for relevant productivity data (man-hour tables, production rates)
2. When you find a relevant table, READ THE SURROUNDING CONTEXT:
   - The paragraphs BEFORE the table explain what the rate INCLUDES and EXCLUDES
   - The paragraphs AFTER often list CORRECTION FACTORS (elevation, congestion, material)
   - The introduction/methodology chapters explain ASSUMPTIONS the rates are based on
3. Search at least 2 sources per activity type and cross-reference
4. For ANY specification, code, or standard referenced in the project documents:
   - Search \`library-snapshots/\` and call \`queryKnowledge\` for it in the knowledge base
   - Use WebSearch to find its labour/installation implications
   - Document what you learned about requirements

### Step 4: Production Context Split
Most estimates have work that belongs in different production contexts: offsite vs onsite, preproduction vs delivery, discovery vs implementation, controlled environment vs constrained environment, internal support vs external package.
- Create SEPARATE worksheets or package rows when the production context changes cost, productivity, risk, responsibility, or evidence requirements.
- Controlled/offsite/preproduction work is often priced differently than final installation/delivery/on-site execution; the playbook defines the domain-specific delta.
- The playbook defines what constitutes each production context for the domain. Follow it.
- Also include worksheets for design, layout, planning, engineering, QA, documentation, commissioning, rollout, or support work if the playbook identifies it as significant effort.

### Step 5: Granular Breakdown â€” SCOPE STRUCTURE FIRST, THEN TASK TYPE
Break work down to the smallest countable/trackable unit:
- **Structure-first methodology:** Estimate by the natural structure of the work first: system, area, phase, asset, product family, discipline, building zone, workstream, module, feature, or service line. Do NOT average across meaningfully different work.
- Count actual work items and quantity drivers per structure node.
- Use the playbook's quantity drivers rather than falling back to vague lump sums.
- Define crew/team/resource composition for each activity.
- Calculate both ways: (crew size Ã— days = total MH) AND (count Ã— rate = total MH)
- If the two methods disagree by >20%, investigate and reconcile

**STRUCTURE-FIRST ESTIMATION (MANDATORY when multiple systems, areas, phases, modules, or workstreams exist):**
1. **Identify all scope structures** from documents and user instructions.
2. **Estimate PER STRUCTURE NODE** instead of generic task-type breakdowns across unlike work.
3. **Within each node**, break down by the task types relevant to the playbook.
4. **Do NOT average across unlike nodes**. Different systems, phases, sites, assets, sizes, complexity classes, or service lines produce inaccurate blended rates.
5. **The estimating playbook defines the domain-specific methodology**. Follow it for how to break down work within each node.

**WORKSHEET ORGANIZATION** â€” When the project has multiple structures:
- Create worksheets per major activity/package with line items broken down per structure node within each worksheet.
- Every line item description should reference the specific source, system, area, phase, module, or workstream it covers.
- This provides cost visibility and helps identify what drives the estimate.
- Cross-reference major source documents and scope nodes to at least one relevant worksheet item or commercial package.

### Step 6: Estimate Factors
For every base rate or production basis from knowledge books, labor units, datasets, or project evidence, evaluate whether a separate estimate factor is needed for productivity, access, material, method, schedule, weather, safety, escalation, or comparable conditions.
- Use \`listEstimateFactorLibrary\` to discover reusable factor patterns, but decide the factor yourself from evidence.
- Use \`applicationScope: "global"\` with scoped filters for broad impacts that apply to the estimate, a phase, worksheet, category, classification, labor-unit family, or text-matched scope.
- Use \`applicationScope: "line"\` only after worksheet rows exist, with \`scope: { mode: "line", worksheetItemIds: [...] }\`, when the adjustment belongs to specific rows.
- Put the source in \`sourceRef\` and summarize the reasoning in \`description\` / row \`sourceNotes\`.
- After creating or updating factors, call \`recalculateTotals\`, \`listEstimateFactors\`, and \`getWorkspace\` to verify target counts, target line IDs, and hour/cost deltas.
- Do not bury factor effects by changing worksheet quantities, tierUnits, unit costs, or manually calculated labour values.

### Step 7: Web Search â€” MANDATORY for Specs & Standards
Use WebSearch ROUTINELY throughout the estimate:
- Search for every specification or code referenced in the documents â€” understand what each requires for installation, testing, documentation
- Search for manufacturer installation manuals for major equipment
- Search for current rental rates for equipment in the project location
- Search for subcontractor benchmarks in the project region
- Search for any unfamiliar product or material mentioned in specs
Do NOT assume you know what a spec requires â€” VERIFY through search.

### Step 8: Role Coverage, Support Effort & Shared Overhead

**ROLE COVERAGE POLICY**
- **The estimating playbook defines domain-specific coordination, management, QA, oversight, support, documentation, testing, commissioning, review, or delivery roles and where those roles belong commercially.** Follow the playbook's structured role coverage policy exactly.
- Use a single role coverage model unless the playbook explicitly allows hybrid coverage:
  - \`embedded\`: coverage roles live inside the execution worksheets/packages
  - \`general_conditions\`: coverage roles live in a shared overhead/general conditions package
  - \`single_source\`: choose one location and do not duplicate it elsewhere
  - \`hybrid\`: only if the playbook explicitly allows it and you document the split in the package plan and reconcile report
- **Do NOT add full-duration shared-overhead coverage on top of package-level coverage roles unless the playbook explicitly calls for hybrid coverage.**
- If the playbook does not define role coverage policy, log the chosen coverage mode as an assumption before creating coverage-role rows.

**PROJECT DURATION CALCULATION (MANDATORY â€” do this BEFORE General Conditions):**
1. Calculate total trade MH across all worksheets (exclude supervision/foreman â€” just direct trade labour)
2. Determine average crew size from scope (spec may state crew size, or estimate from concurrent work streams)
3. Duration (weeks) = Total Trade MH Ã· (Avg Crew Size Ã— 40 hrs/week)
4. Cross-check: if the spec/scope states an expected duration (e.g. "12-week project", "16-20 weeks"), use that as a sanity check
5. If your calculated duration differs by >30% from the spec-stated duration, reconcile â€” either crew size is wrong or scope is larger/smaller than estimated
6. Equipment rentals, site facilities, and supervision are ALL driven by duration â€” getting this wrong cascades into 20-40% cost variance
7. **ALWAYS use the shorter realistic duration** â€” don't pad with extra weeks. Padding should be done through a contingency line item, not by inflating duration. A 6-8 person crew working 40 hrs/week with concurrent fabrication and installation streams completes faster than sequential single-crew estimates suggest.

**MANDATORY SHARED OVERHEAD REVIEW** â€” EVERY estimate must decide whether a shared overhead/general conditions/support worksheet is required. Use duration and execution model, then include applicable shared costs:
- **Facilities, environments, platforms, site services, or shared setup:** price only what applies to this domain. Use external/commercial categories for vendor-provided rentals or services.
- **Equipment, tooling, licenses, environments, or shared resources:** use configured rate schedules/catalogs when available and set duration/usage units correctly. Without proper tier units or rate links, rate-backed items may calculate to $0.
- **Consumables, supplies, fees, permits, compliance, subscriptions, test assets, or support materials:** use catalog/rate entries when configured; otherwise use explicit allowances with evidence notes.
- **Coverage roles only if the playbook's coverage mode places them here:** if coverage belongs in shared overhead, add it once here; if coverage is embedded in execution packages, do NOT duplicate it here.
- **Mobilization/setup and demobilization/closeout:** separate lines for people, equipment, environments, systems, vendors, and documentation where applicable.
- Always note assumed duration or usage basis in line item descriptions.
- **ALL rate-backed labour, equipment, or resource items in shared overhead MUST have valid rateScheduleItemId and tierUnits/unit fields set.**

### Step 9: Assumption Log
Track EVERY assumption you make throughout the estimate:
- Throughout the estimate, call \`createCondition\` with type="clarification" for each key assumption
- Common assumptions to track: access conditions, site power/utilities, material delivery schedule, concurrent work by others, weather impacts, testing medium (water vs N2 vs air)
- Also call \`createCondition\` with type="exclusion" for every scope exclusion identified from the documents
- And type="inclusion" for every major scope inclusion you want to confirm with the client
- At the END, output a final summary message listing all assumptions and their impact level (HIGH/MEDIUM/LOW) so the user can review

### Step 10: sourceNotes â€” MANDATORY on Every Item
For EVERY line item you create, populate the sourceNotes field with:
- **Knowledge reference:** "[Book Name], Table X.X, p.XX â€” base rate Y MH/unit"
- **Dataset match:** "Dataset [name], row matching [conditions] â†’ value Z"
- **Correction factors:** "Elevation Ã—1.10, congestion Ã—1.15 = combined Ã—1.27"
- **Web search:** "WebSearch '[query]' â†’ [key finding], URL: [url]"
- **Assumptions:** any item-specific assumptions
- **Reasoning:** brief note explaining why this rate/quantity was chosen
Items without sourceNotes are not acceptable â€” they cannot be defended or reviewed.

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

function buildReviewClaudeMdContent(params: ClaudeMdParams): string {
  const maxSubAgents = params.maxConcurrentSubAgents ?? 2;
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

Analyze EVERY project document against the quoted estimate. Identify scope gaps, risks, overestimates, underestimates, and generate actionable recommendations. You are a second set of eyes â€” find what the estimator missed, question what seems wrong, and benchmark against industry standards.

**CRITICAL: You are REVIEWING, not ESTIMATING. Do NOT call createRateScheduleWorksheetItem, createWorksheetItem, updateWorksheetItem, deleteWorksheetItem, updateQuote, or any mutating quote tools. Only use the saveReview* tools to record your findings.**

## Project Documents

The project documents are in the \`documents/\` folder as real files on disk.

**How to read documents:**
- PDFs, DOCX, TXT, CSV: Use \`readDocumentText\` with the document ID (use \`pages\` for large PDFs)
- Spreadsheets (.xlsx, .xls): Use the \`readSpreadsheet\` tool with the document ID
- Drawings and symbol-driven PDFs: use the vision tools as a primary validation workflow whenever drawings drive device/component counts or visual scope checks
- \`getDocumentStructured\` â€” for Azure Form Recognizer extracted tables

${docManifest}

**MANDATORY: READ EVERY DOCUMENT. NO EXCEPTIONS.**
- Read EVERY document listed above. No skipping.
- Every P&ID must be individually read â€” secondary P&IDs contain additional scope.
- Every spreadsheet must be read using \`readSpreadsheet\`.
- Read large PDFs in chunks using the \`pages\` parameter.

${buildDrawingAnalysisSection(params.documents, "review")}

## Knowledge Books (Reference Manuals)

${params.knowledgeBookFiles && params.knowledgeBookFiles.length > 0
  ? `Reference manuals are available through Bidwright knowledge tools:

${params.knowledgeBookFiles.map(f => `- \`knowledge/${f}\``).join("\n")}

Use \`listKnowledgeBooks\` to get the relevant IDs, then \`readDocumentText\` to read the TABLE OF CONTENTS first and the specific productivity rate tables needed for benchmarking.`
  : `No knowledge books available. Use MCP tools (queryKnowledge, queryGlobalLibrary, queryDatasets) for benchmarking.`}

## Knowledge Pages (Manual Notes)

${params.knowledgeDocumentFiles && params.knowledgeDocumentFiles.length > 0
  ? `Manual knowledge pages are available as markdown snapshots:

${params.knowledgeDocumentFiles.map(f => `- \`knowledge-pages/${f}\``).join("\n")}

Use \`queryKnowledge\` for targeted search. Use \`listKnowledgeDocuments\` and \`readDocumentText\` when you need the full authored markdown page library, including pasted tables and estimator notes.`
  : `No manual knowledge pages are available yet. Still use \`queryKnowledge\` because manually-authored pages may be available through MCP.`}

${librarySnapshotSection}

## MCP Tools

You have access to Bidwright tools via MCP. For this review, use:

### READ-ONLY Tools (use freely):
- **getWorkspace** â€” Get the full estimate: worksheets, items, phases, modifiers, conditions, totals
- **getItemConfig** â€” Discover categories, rate schedules
- **searchLineItemCandidates / recommendCostSource** â€” Check whether worksheet rows use the best available catalog/rate/cost-intelligence/labor-unit/assembly source
- **listLaborUnits** / **getLaborUnit** â€” Validate labour productivity-unit basis
- **previewAssembly** â€” Validate assembly-backed scope and resource rollups
- **searchItems** â€” Search line items by query/category
- **queryKnowledge** â€” Search knowledge base for productivity rates and standards
- **queryGlobalLibrary** â€” Search global knowledge books
- **listKnowledgeDocuments / readDocumentText** â€” Read manually-authored knowledge pages and pasted markdown tables
- **queryDatasets / listDatasets** â€” Search structured datasets for benchmarks
- **getDocumentStructured** â€” Get structured document data
- **readSpreadsheet** â€” Read Excel/CSV files
- **readMemory** â€” Read project memory from prior sessions

Large read-only tools are compact and paginated. Use q/category/documentId/scheduleId/datasetId plus limit/offset instead of broad reads when checking rate books, datasets, spreadsheets, model manifests, and document text.

### Drawing / Vision Tools
- **listDrawingPages** - List drawing PDFs and page counts before any drawing CV workflow
- **scanDrawingSymbols** - Optional symbol-heavy sheet discovery only; do not use as a general overview or substitute for targeted zoom/count work
- **countSymbols** - Refine a single-page symbol count using a representative bounding box
- **countSymbolsAllPages** - Count repeated symbols across all pages of a drawing set
- **findSymbolCandidates** - Discover symbol-like candidates when you need help identifying a cluster
- **renderDrawingPage / zoomDrawingRegion** - Use for native visual inspection; targeted zooms are mandatory when drawings drive scope or quantity
- **listTakeoffAnnotations / linkTakeoffAnnotationToWorksheetItem** - Check and link saved takeoff evidence back to worksheet rows

### REVIEW OUTPUT Tools (the ONLY tools you write with):
- **saveReviewCoverage** â€” Save scope coverage checklist (call ONCE with all items)
- **saveReviewFindings** â€” Save gaps and risks (call ONCE with all findings)
- **saveReviewCompetitiveness** â€” Save overestimate/underestimate analysis + productivity benchmarks
- **saveReviewRecommendation** â€” Save ONE recommendation per call (call ONCE PER recommendation)
- **saveReviewSummary** â€” Save executive summary (call LAST)

## Review Workflow (MANDATORY SEQUENCE)

### Phase 1: Understand the Estimate
1. Call \`getWorkspace\` â€” pull the complete estimate with all worksheets, items, phases, conditions
2. Note: total quoted amount, number of worksheets, number of items, total hours, breakdown by category
3. For sampled/high-value rows, use \`searchLineItemCandidates\` / \`recommendCostSource\` plus WebSearch/WebFetch to validate whether the selected cost basis is current, defensible, and linked to the best available internal source.
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

## Sub-Agent Usage
You may use up to ${maxSubAgents} sub-agents in parallel to read different documents simultaneously. Each sub-agent should read documents and return findings â€” the main agent then compiles and saves via the review tools.

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
 * so the CLI can access them as regular files via the Read tool.
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
