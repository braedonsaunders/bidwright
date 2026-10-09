import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sourceRefArray } from "./source-refs.js";
import { clipText, compactRateItem, compactScheduleSummary, paginate, shouldIncludeRates } from "./response-compaction.js";
const clipCatalogText = (value: unknown) => clipText(value, 80);
import { apiGet, apiPost, apiPatch, apiDelete, projectPath, getRevisionId } from "../api-client.js";
import {
  rollupWorksheetUnits,
  normalizeLineDerivation,
  validateLineDerivation,
  collectBatchOperationProblems,
  evaluateProcurementLink,
  type LineDerivation,
} from "@bidwright/domain";
import { getProjectId } from "../api-client.js";

/**
 * Convert plain text with newlines to HTML paragraphs.
 * Handles markdown-style headers (### → h3), bullet lists (- → li), and bold (**text**).
 */
function plainTextToHtml(text: string): string {
  const lines = text.split("\n");
  const htmlParts: string[] = [];
  let inUl = false;
  let inOl = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inUl) { htmlParts.push("</ul>"); inUl = false; }
      if (inOl) { htmlParts.push("</ol>"); inOl = false; }
      continue;
    }

    // Inline formatting: bold and italic
    const formatted = trimmed
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(.+?)__/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/_(.+?)_/g, "<em>$1</em>");

    // Unordered list: "- item", "* item", "• item"
    const ulMatch = formatted.match(/^[-*•]\s+(.*)/);
    // Ordered list: "1. item"
    const olMatch = formatted.match(/^\d+\.\s+(.*)/);

    if (ulMatch) {
      if (inOl) { htmlParts.push("</ol>"); inOl = false; }
      if (!inUl) { htmlParts.push("<ul>"); inUl = true; }
      htmlParts.push(`<li>${ulMatch[1]}</li>`);
    } else if (olMatch) {
      if (inUl) { htmlParts.push("</ul>"); inUl = false; }
      if (!inOl) { htmlParts.push("<ol>"); inOl = true; }
      htmlParts.push(`<li>${olMatch[1]}</li>`);
    } else if (formatted.startsWith("### ")) {
      if (inUl) { htmlParts.push("</ul>"); inUl = false; }
      if (inOl) { htmlParts.push("</ol>"); inOl = false; }
      htmlParts.push(`<h3>${formatted.slice(4)}</h3>`);
    } else if (formatted.startsWith("## ")) {
      if (inUl) { htmlParts.push("</ul>"); inUl = false; }
      if (inOl) { htmlParts.push("</ol>"); inOl = false; }
      htmlParts.push(`<h2>${formatted.slice(3)}</h2>`);
    } else if (formatted.startsWith("# ")) {
      if (inUl) { htmlParts.push("</ul>"); inUl = false; }
      if (inOl) { htmlParts.push("</ol>"); inOl = false; }
      htmlParts.push(`<h1>${formatted.slice(2)}</h1>`);
    } else {
      if (inUl) { htmlParts.push("</ul>"); inUl = false; }
      if (inOl) { htmlParts.push("</ol>"); inOl = false; }
      htmlParts.push(`<p>${formatted}</p>`);
    }
  }
  if (inUl) htmlParts.push("</ul>");
  if (inOl) htmlParts.push("</ol>");
  return htmlParts.join("");
}

function toolUiText(message: string, uiEvent: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    success: true,
    message,
    uiEvent,
    sideEffects: [String(uiEvent.kind || "workspace.updated")],
    ...extra,
  }, null, 2);
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function compactText(value: unknown, maxLength = 180) {
  if (value == null) return value;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}...` : text;
}

function compactTags(value: unknown, limit = 8) {
  return asArray(value)
    .map((tag) => String(tag ?? "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function stripLeakedToolParameterMarkup(value: unknown) {
  if (typeof value !== "string") return value;
  return value
    .replace(/\s*<\/[a-zA-Z][^>]*>\s*<parameter\b[\s\S]*$/i, "")
    .replace(/\s*<parameter\b[\s\S]*$/i, "")
    .trim();
}

function normalizedText(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function matchesText(value: unknown, query?: string | null) {
  const q = normalizedText(query);
  if (!q) return true;
  return normalizedText(value).includes(q);
}

function matchesAllTerms(value: unknown, query?: string | null) {
  const q = normalizedText(query);
  if (!q) return true;
  const haystack = normalizedText(value);
  return q.split(/\s+/).filter(Boolean).every((term) => haystack.includes(term));
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function findCreatedWorksheetItem(data: unknown, worksheetId: string, input: Record<string, any>) {
  const direct = asRecord(data);
  const directItem = asRecord(direct.item);
  if (directItem.id) return directItem;
  if (direct.id && (direct.worksheetId === worksheetId || !direct.worksheetId)) return direct;

  const workspace = asRecord(direct.workspace ?? direct.data?.workspace ?? direct.data ?? direct);
  const worksheet = asArray(workspace.worksheets).map(asRecord).find((entry) => String(entry.id ?? "") === worksheetId);
  const items = asArray(worksheet?.items).map(asRecord);
  if (items.length === 0) return {};

  const entityName = String(input.entityName ?? "");
  const description = String(input.description ?? "");
  const candidates = items.filter((item) =>
    (!entityName || String(item.entityName ?? item.name ?? "") === entityName) &&
    (!description || String(item.description ?? "") === description)
  );
  return candidates[candidates.length - 1] ?? items[items.length - 1] ?? {};
}

function isIgnoredSourceDocument(fileName: unknown) {
  const name = String(fileName ?? "").toLowerCase();
  return /(^|\/)__macosx(\/|$)|(^|\/)\._|(^|\/)\.ds_store$|(^|\/)thumbs\.db$/.test(name);
}

function isDrawingLikeSourceDocument(doc: any) {
  if (!doc || isIgnoredSourceDocument(doc.fileName) || isIgnoredSourceDocument(doc.storagePath)) return false;
  const documentType = normalizedText(doc.documentType);
  const fileType = normalizedText(doc.fileType);
  const fileName = normalizedText(doc.fileName);

  if (fileType !== "application/pdf" && fileType !== "pdf" && !fileName.endsWith(".pdf")) return false;
  return documentType === "drawing";
}

function normalizedToolId(toolId: unknown) {
  return String(toolId ?? "")
    .replace(/^mcp__bidwright__/, "")
    .trim();
}

function drawingEvidenceEngine(strategy: any) {
  return asRecord(asRecord(strategy?.summary).drawingEvidenceEngine);
}

const LINE_EVIDENCE_BASIS_TYPES = [
  "drawing_quantity",
  "visual_takeoff",
  "drawing_table",
  "drawing_note",
  "document_quantity",
  "vendor_quote",
  "knowledge_labor",
  "rate_schedule",
  "allowance",
  "indirect",
  "subcontract",
  "equipment_rental",
  "material_quote",
  "assumption",
  "mixed",
] as const;

/** Zod shape for a per-line derivation (see LineDerivation in @bidwright/domain). */
const derivationSchema = z.object({
  target: z.enum(["quantity", "tierUnits", "cost", "price"]).default("quantity").describe("Which row value the formula reproduces. Default quantity; use tierUnits for rate-schedule hours."),
  formula: z.string().describe("Arithmetic over input names, e.g. 'basePlates * anchorsPerPlate' or 'ceil(anchors / anchorsPerCartridge)'. Supports + - * / ^ ( ) ceil floor round min max sqrt."),
  inputs: z.array(z.object({
    name: z.string().describe("Identifier used in the formula."),
    value: z.coerce.number(),
    unit: z.string().nullable().optional(),
    perInstance: z.boolean().optional().describe("true when this is a per-instance factor (per plate, per column, per valve). These are checked against explicit callouts in the cited text."),
    instanceOf: z.string().nullable().optional().describe("Noun the per-instance factor applies to, e.g. 'base plate'."),
    source: z.object({
      kind: z.enum(["view", "claim", "text", "document", "rateItem", "laborUnit", "dataset", "book", "catalog", "vendorQuote", "assumption", "user", "web", "item", "manual"]),
      ref: z.string().describe("viewId, claimId, documentId#page, rate/labour/dataset/book id, assumption id, askUser questionId, URL, worksheet item id, or 'estimator' for manual."),
      excerpt: z.string().nullable().optional().describe("Short quote of the text/value that supplied this input."),
    }),
    note: z.string().nullable().optional(),
  })).min(1),
  result: z.object({ value: z.coerce.number(), unit: z.string().nullable().optional() }),
  status: z.enum(["draft", "verified", "reviewed"]).default("draft"),
  notes: z.string().nullable().optional(),
  procurement: z.object({
    suppliesItemId: z.string().nullable().optional().describe("Worksheet item id of the installed/labour row this purchase supplies."),
    installedFromInput: z.string().nullable().optional().describe("Derivation input name on that row holding the installed count (default: the row's quantity)."),
    installedQuantity: z.coerce.number().nullable().optional().describe("Explicit installed requirement when there is no row to link."),
    installedUom: z.string().nullable().optional(),
    packSize: z.coerce.number().nullable().optional().describe("Base units per purchase unit: rods per pack, anchors per cartridge, ft3 per bag. REQUIRED when the row UOM is a package (PK, BOX, CARTRIDGE, BAG, ...)."),
    wasteFactor: z.coerce.number().nullable().optional().describe("Fraction added for waste, e.g. 0.15."),
    surplusRationale: z.string().nullable().optional().describe("Required (>= 20 chars) when supplied base units exceed twice the requirement, e.g. 'minimum one cartridge; remainder is spares'."),
  }).passthrough().nullable().optional().describe("Optional link from a purchased material row to the row whose installed quantity it supplies. When given, pack size, units and shortfall are checked arithmetically."),
}).passthrough();

function evidenceBasisClaimIds(evidenceBasis?: Record<string, any> | null) {
  const basis = asRecord(evidenceBasis);
  const quantityBasis = asRecord(basis.quantity);
  return [
    ...asArray(basis.drawingClaimIds),
    ...asArray(quantityBasis.drawingClaimIds),
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function evidenceAxisType(evidenceBasis: Record<string, any>, axis: "quantity" | "pricing") {
  const nested = asRecord(evidenceBasis[axis]);
  return normalizedText(nested.type ?? evidenceBasis[`${axis}Type`] ?? evidenceBasis.type);
}

/**
 * Agents often cite sources as objects ({kind, ref, page}) rather than
 * strings. String() turned those into "[object Object]", so a real document
 * cite counted as zero structured refs and the row was rejected for a missing
 * cite it had supplied. Objects are flattened to "kind:ref pN" so the same
 * string rules apply.
 */
function evidenceRefToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value).trim();
  const ref = value as Record<string, unknown>;
  const id = [ref.ref, ref.id, ref.documentId, ref.url, ref.uri].find((candidate) => typeof candidate === "string" && candidate.trim());
  if (typeof id !== "string") return "";
  const kind = typeof ref.kind === "string" ? ref.kind.trim() : typeof ref.type === "string" ? ref.type.trim() : "";
  const page = ref.page ?? ref.pageNumber;
  const base = kind && !id.trim().toLowerCase().startsWith(`${kind.toLowerCase()}:`) ? `${kind}:${id.trim()}` : id.trim();
  return page !== undefined && page !== null && String(page).trim() ? `${base} p${String(page).trim()}` : base;
}

function collectEvidenceAxisArray(evidenceBasis: Record<string, any>, key: string) {
  return [
    ...asArray(evidenceBasis[key]),
    ...asArray(asRecord(evidenceBasis.quantity)[key]),
    ...asArray(asRecord(evidenceBasis.pricing)[key]),
  ]
    .map(evidenceRefToString)
    .filter(Boolean);
}

/**
 * Document ids cited in sourceRefs ("doc_<id>", "document:<id>", "doc:<id>")
 * that are not SourceDocuments of this project. A pattern-only check let any
 * well-formed id count as evidence; an invented or copied id must not.
 * Only checked when the workspace lists its documents.
 */
function unresolvedDocumentRefs(ws: any, basis: Record<string, any>): string[] {
  const docs = asArray(ws?.sourceDocuments).map((doc) => String(asRecord(doc).id ?? "").trim()).filter(Boolean);
  if (docs.length === 0) return [];
  const known = new Set(docs);
  const unresolved: string[] = [];
  for (const ref of collectEvidenceAxisArray(basis, "sourceRefs")) {
    const match = /^(?:(?:doc|document):\s*)?(doc_[A-Za-z0-9-]{6,})/i.exec(ref);
    if (match && !known.has(match[1])) unresolved.push(match[1]);
  }
  return [...new Set(unresolved)];
}

/** Fields that carry the substance of a row. A real row sets at least one. */
const WORKSHEET_ITEM_PAYLOAD_FIELDS = [
  "categoryId", "category", "entityType", "cost", "price", "markup", "tierUnits",
  "rateScheduleItemId", "itemId", "costResourceId", "effectiveCostId", "laborUnitId",
  "resourceComposition", "sourceEvidence", "evidenceBasis", "classification",
  "costCode", "phaseId",
] as const;

/**
 * Did this call arrive carrying nothing but its two required fields?
 *
 * `worksheetId` and `entityName` are the only parameters without a default, so
 * a tool call cut off partway through serialization lands here with exactly
 * those two and everything else defaulted. That used to be reported as "Line
 * evidence basis is required", which is technically true and diagnostically
 * useless: it sent the agent off rewriting evidenceBasis 39 times when the real
 * problem was that its arguments never arrived intact.
 */
function looksLikeTruncatedItemPayload(input: Record<string, any>): boolean {
  const carriesPayload = WORKSHEET_ITEM_PAYLOAD_FIELDS.some((key) => {
    const value = input[key];
    if (value === undefined || value === null || value === "") return false;
    if (typeof value === "object" && Object.keys(value).length === 0) return false;
    return true;
  });
  if (carriesPayload) return false;
  return !String(input.description ?? "").trim() && !String(input.sourceNotes ?? "").trim();
}

const TRUNCATED_ITEM_PAYLOAD_MESSAGE = [
  "This call arrived with only worksheetId and entityName — no category, quantity basis, cost/rate, sourceNotes, or evidenceBasis came through.",
  "That normally means the tool call was cut off while being written, not that the row is missing evidence. Do not retry the same way; the arguments will be cut off again.",
  "Re-send as one row per call with a smaller payload: categoryId + quantity + uom, then either cost/price (freeform categories) or rateScheduleItemId + tierUnits (rate categories), plus sourceNotes and evidenceBasis.",
  "For Labour, Equipment, Rental Equipment, and General Conditions rows prefer createRateScheduleWorksheetItem — it takes a much smaller payload for the same result.",
].join(" ");

function categoryEntityType(ws: any, categoryId?: string | null, categoryName?: string | null) {
  if (!categoryId && !categoryName) return "";
  const cats = asArray(ws.entityCategories).map(asRecord);
  const byId = categoryId ? cats.find((c: any) => String(c.id ?? "") === String(categoryId)) : null;
  if (byId) return String(byId.entityType ?? byId.name ?? "").toLowerCase();
  if (categoryName) {
    const byName = cats.find((c: any) => String(c.name ?? "").toLowerCase() === String(categoryName).toLowerCase());
    if (byName) return String(byName.entityType ?? byName.name ?? "").toLowerCase();
    return String(categoryName).toLowerCase();
  }
  return "";
}

interface EvidenceViewRecord {
  id: string;
  documentId?: string | null;
  fileNodeId?: string | null;
  sourceChecksum?: string | null;
  pageNumber?: number | null;
  tool?: string | null;
  imageHash?: string | null;
  textSnippet?: string | null;
  bbox?: Record<string, unknown> | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
}

/**
 * A view is only evidence for the document version it was rendered from.
 * Reject views whose source document is gone from the project (replaced or
 * deleted) or whose recorded checksum no longer matches the current file.
 */
function staleEvidenceViewError(views: EvidenceViewRecord[], ws: any): string | null {
  const docs = asArray(ws.sourceDocuments).map(asRecord);
  for (const view of views) {
    const documentId = String(view.documentId ?? "").trim();
    if (!documentId) {
      // A Files-area (FileNode) view has no SourceDocument identity or
      // checksum to compare, so its source version cannot be established.
      // Fail closed rather than treat it as equivalent to document evidence.
      const fileNodeId = String(view.fileNodeId ?? "").trim();
      return `evidenceBasis.quantity.viewIds includes ${view.id}, rendered from a Files-area file${fileNodeId ? ` (${fileNodeId})` : ""} that is not a registered source document, so its version cannot be verified. Register it first — readDrawingPage / readDrawingTile / promotePdfToDrawingEvidence accept the FileNode id and promote it to a SourceDocument — then re-read the page from the resulting documentId and cite that viewId.`;
    }
    const doc = docs.find((entry) => String(entry.id ?? "") === documentId);
    if (!doc) {
      return `evidenceBasis.quantity.viewIds includes ${view.id}, taken of document ${documentId}, which is no longer a source document in this project (replaced or removed). Re-read the current document with readDrawingPage / readDrawingTile and cite the new viewId.`;
    }
    const current = String(doc.checksum ?? "").trim();
    const recorded = String(view.sourceChecksum ?? "").trim();
    if (current && recorded && current !== recorded) {
      return `evidenceBasis.quantity.viewIds includes ${view.id}, which was rendered from an earlier version of "${String(doc.fileName ?? documentId)}" (source checksum changed). Re-read the current page and cite the new viewId; prior-run views are valid only while the source file is unchanged.`;
    }
  }
  return null;
}

/**
 * Fetch EvidenceView rows (images the server actually delivered to the model).
 * Fails closed: a cited viewId that cannot be looked up is not accepted.
 */
type EvidenceViewFetcher = (viewIds: string[]) => Promise<{ views: EvidenceViewRecord[]; missingIds: string[] } | { error: string }>;

async function fetchEvidenceViews(viewIds: string[]): Promise<{ views: EvidenceViewRecord[]; missingIds: string[] } | { error: string }> {
  if (viewIds.length === 0) return { views: [], missingIds: [] };
  try {
    const params = new URLSearchParams({ projectId: getProjectId(), ids: viewIds.join(",") });
    const data = await apiGet<any>(`/api/vision/views?${params}`);
    const views = asArray(data?.views).map(asRecord) as EvidenceViewRecord[];
    const found = new Set(views.map((view) => String(view.id ?? "")));
    const missingIds = [
      ...asArray(data?.missingIds).map((id) => String(id ?? "")),
      ...viewIds.filter((id) => !found.has(id)),
    ].filter((id, index, all) => id && all.indexOf(id) === index);
    return { views, missingIds };
  } catch (error) {
    return { error: (error as Error)?.message ?? String(error) };
  }
}

let evidenceViewFetcher: EvidenceViewFetcher = fetchEvidenceViews;

/** Test seam: replace the EvidenceView lookup so integrity checks can run without an API. */
export function __setEvidenceViewFetcherForTests(fetcher: EvidenceViewFetcher | null) {
  evidenceViewFetcher = fetcher ?? fetchEvidenceViews;
}

/**
 * The only checks a worksheet row write has to pass: what the row cites is
 * real (in this project and the current source version), and the arithmetic
 * and explicit unit conversions it states are right. How good the evidence
 * is, which assumptions were made and in what order the work was done are
 * the estimator's and reviewer's to judge from the row's own fields.
 */
export async function rowWriteIntegrityProblem(ws: any, input: {
  evidenceBasis?: Record<string, any> | null;
  derivation?: Record<string, any> | null;
  quantity?: number | null;
  uom?: string | null;
  tierUnits?: Record<string, number> | null;
  cost?: number | null;
  price?: number | null;
  strategy?: any;
}): Promise<string | null> {
  const basis = asRecord(input.evidenceBasis);
  for (const [label, value] of [["type", normalizedText(basis.type)], ["quantity.type", evidenceAxisType(basis, "quantity")], ["pricing.type", evidenceAxisType(basis, "pricing")]] as const) {
    if (value && !(LINE_EVIDENCE_BASIS_TYPES as readonly string[]).includes(value)) {
      return `Unsupported evidenceBasis.${label} '${value}'. Use one of: ${LINE_EVIDENCE_BASIS_TYPES.join(", ")}.`;
    }
  }

  const assumptionIds = collectEvidenceAxisArray(basis, "assumptionIds");
  if (assumptionIds.length > 0) {
    const saved = new Set(asArray(input.strategy?.assumptions).map((entry) => String(asRecord(entry).id ?? "").trim()).filter(Boolean));
    const unknown = assumptionIds.filter((id) => !saved.has(id));
    if (unknown.length > 0) return `assumptionIds not found among saved assumptions: ${unknown.join(", ")}. Save them with saveEstimateAssumptions, or drop the reference.`;
  }

  const unresolvedDocs = unresolvedDocumentRefs(ws, basis);
  if (unresolvedDocs.length > 0) return `sourceRefs cite documents that are not in this project: ${unresolvedDocs.join(", ")}.`;

  const derivation: LineDerivation | null = normalizeLineDerivation(input.derivation);
  const derivationRefs = (kind: string) => (derivation?.inputs ?? []).filter((entry) => entry.source?.kind === kind).map((entry) => String(entry.source?.ref ?? "").trim()).filter(Boolean);

  const claimIds = [...new Set([...evidenceBasisClaimIds(basis), ...derivationRefs("claim")])];
  if (claimIds.length > 0) {
    const known = new Set(asArray(drawingEvidenceEngine(input.strategy).claims).map((claim) => String(asRecord(claim).claimId ?? asRecord(claim).id ?? "")));
    const unknown = claimIds.filter((id) => !known.has(id));
    if (unknown.length > 0) return `Drawing evidence claim id(s) not found in this project: ${unknown.join(", ")}.`;
  }

  const viewIds = [...new Set([...collectEvidenceAxisArray(basis, "viewIds"), ...derivationRefs("view")])];
  if (viewIds.length > 0) {
    const result = await evidenceViewFetcher(viewIds);
    if ("error" in result) return `Could not verify the cited viewIds against the evidence view service (${result.error}); retry when it responds.`;
    if (result.missingIds.length > 0) return `viewIds not found for this project: ${result.missingIds.join(", ")}. Cite only viewIds returned by readDrawingPage / readDrawingTile / inspectDrawingRegion here.`;
    const stale = staleEvidenceViewError(result.views, ws);
    if (stale) return stale;
  }

  if (derivation) {
    const quantity = Number.isFinite(input.quantity) ? Number(input.quantity) : 1;
    const tierUnitTotal = Object.values(input.tierUnits ?? {}).reduce((sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);
    const target = derivation.target ?? "quantity";
    const expectedValue = target === "tierUnits" ? tierUnitTotal * (quantity || 1)
      : target === "cost" ? (Number.isFinite(input.cost) ? Number(input.cost) : null)
      : target === "price" ? (Number.isFinite(input.price) ? Number(input.price) : null)
      : quantity;
    const issues = validateLineDerivation(derivation, { expectedValue }).filter((issue) => issue.severity === "error");
    if (issues.length > 0) return `Derivation is not valid: ${issues.slice(0, 4).map((issue) => issue.message).join(" ")}`;
    if (derivation.procurement) {
      const items = asArray(ws.worksheets).map(asRecord).flatMap((worksheet) => asArray(worksheet.items).map(asRecord));
      const procurement = evaluateProcurementLink(derivation.procurement, {
        purchaseQuantity: quantity,
        purchaseUom: input.uom ?? null,
        resolveItem: (itemId) => {
          const linked = items.find((entry) => String(entry.id ?? "") === itemId);
          return linked ? { quantity: Number(linked.quantity ?? 0), uom: String(linked.uom ?? "") || null, derivation: normalizeLineDerivation(linked.derivation), entityName: String(linked.entityName ?? "") || null } : null;
        },
      });
      const errors = procurement.issues.filter((issue) => issue.severity === "error");
      if (errors.length > 0) return `Procurement does not reconcile: ${errors.map((issue) => issue.message).join(" ")}`;
    }
  }
  return null;
}

function pageSlice<T>(items: T[], input: { limit?: number; offset?: number }, maxLimit = 100) {
  const offset = Math.max(0, input.offset ?? 0);
  const limit = Math.max(1, Math.min(input.limit ?? 25, maxLimit));
  const page = items.slice(offset, offset + limit);
  return { page, offset, limit, total: items.length, hasMore: offset + page.length < items.length };
}

function scheduleTiers(schedule: any) {
  return asArray(schedule.tiers).map((tier: any) => ({
    id: tier.id,
    name: tier.name,
    multiplier: tier.multiplier,
    uom: tier.uom ?? null,
  }));
}

function summarizeRateSchedule(schedule: any, options: { includeSampleItems?: boolean } = {}) {
  const items = asArray(schedule.items);
  return {
    id: schedule.id,
    name: schedule.name,
    description: compactText(schedule.description, 160),
    category: schedule.category,
    scope: schedule.scope,
    itemCount: items.length || schedule.itemCount || 0,
    tierCount: asArray(schedule.tiers).length,
    tiers: scheduleTiers(schedule),
    sampleItems: options.includeSampleItems === false
      ? undefined
      : items.slice(0, 5).map((item: any) => ({
          id: item.id,
          name: item.name,
          code: item.code,
          unit: item.unit,
        })),
  };
}

function rateScheduleItemMatches(item: any, schedule: any, input: { q?: string | null; category?: string | null; scheduleId?: string | null }) {
  if (input.scheduleId && schedule.id !== input.scheduleId) return false;
  if (input.category && normalizedText(schedule.category) !== normalizedText(input.category)) return false;
  const q = normalizedText(input.q);
  if (!q) return true;
  return [
    item.name,
    item.code,
    item.unit,
    schedule.name,
    schedule.category,
    item.description,
  ].some((value) => matchesText(value, q));
}

function compactRateScheduleItem(item: any, schedule: any, options: { includeRates?: boolean } = {}) {
  // Schedule name/category/tier ids are emitted once per schedule next to the
  // page (see listRateScheduleItems); repeating them per row cost ~40% of
  // every rate listing on the 2026-10-07 matrix runs.
  return compactRateItem(item, schedule, { includeRates: options.includeRates !== false });
}

/** Parameter shape of createWorksheetItem; shared with batchEditWorksheetItems. */
const createWorksheetItemShape = {
  worksheetId: z.string().describe("ID of the worksheet"),
  entityName: z.string().describe("Item name — for rate_schedule items, use ONLY the rate item name (e.g. 'Trade Labour'). Put task details in description."),
  categoryId: z.string().optional().describe("Stable EntityCategory ID from getItemConfig. Prefer this over category name so renames cannot affect the row."),
  category: z.string().optional().describe("Category name from getItemConfig (e.g. 'Labour', 'Equipment', 'Material', 'Consumables'). Use categoryId when available."),
  entityType: z.string().optional().describe("Legacy entity type/category type. The server canonicalizes this from categoryId when provided."),
  description: z.string().default("").describe("Description with document reference and assumptions"),
  quantity: z.coerce.number().default(1).describe("Quantity multiplier. For rate_schedule categories this is a multiplier on the unit values (e.g. crew size). Total = Σ(units × rate) × quantity. Check the category config from getItemConfig to understand what quantity means for each category."),
  uom: z.string().default("EA").describe("Unit of measure — MUST be from the category's validUoms (see getItemConfig). Server rejects invalid UOMs and auto-corrects to the category default."),
  cost: z.coerce.number().optional().describe("Editable unit cost for freeform/unit-cost categories only. Do not pass for tiered/rate categories; Bidwright calculates those from rateScheduleItemId and tierUnits."),
  markup: z.coerce.number().optional().describe("Markup percentage for markup-eligible categories only. Do not pass for tiered/rate categories."),
  price: z.coerce.number().optional().describe("Optional unit price override. If omitted, server uses cost plus markup."),
  tierUnits: z.record(z.coerce.number()).optional().describe("Units per rate tier. Keys are tier IDs from getItemConfig, values are units PER quantity. The calc engine multiplies these by the tier rate, then by quantity. REQUIRED for rate_schedule categories."),
  rateScheduleItemId: z.string().optional().describe("Rate schedule item ID for rate_schedule-backed categories"),
  itemId: z.string().optional().describe("Catalog item ID for catalog-backed categories"),
  costResourceId: z.string().nullable().optional().describe("Cost intelligence resource ID from queryLibrary/recommendCostSource."),
  effectiveCostId: z.string().nullable().optional().describe("Effective cost ID from cost intelligence. Preserve this when a priced effective_cost candidate is selected."),
  laborUnitId: z.string().nullable().optional().describe("Labor unit ID for labour productivity sources."),
  resourceComposition: z.record(z.unknown()).optional().describe("Structured resource rollup from a search candidate, recommendation, or assembly expansion."),
  sourceEvidence: z.record(z.unknown()).optional().describe("Structured provenance from a search candidate, recommendation, or source document."),
  evidenceBasis: z.object({
    type: z.enum(LINE_EVIDENCE_BASIS_TYPES).optional().describe("Legacy single-source shorthand. Prefer quantity.type plus pricing.type when quantity and price/rate come from different sources."),
    quantity: z.object({
      type: z.enum(LINE_EVIDENCE_BASIS_TYPES).describe("Source class that justifies the row quantity, labour hours, duration, or count."),
      drawingClaimIds: z.array(z.string()).default([]).describe("Saved drawing evidence claim ids this quantity relies on. Each must exist in this project."),
      viewIds: z.array(z.string()).default([]).describe("REQUIRED for drawing-driven quantities: viewId(s) returned with the image by readDrawingPage / readDrawingTile / inspectDrawingRegion that visually prove the count or measurement."),
      userConfirmation: z.object({ questionId: z.string(), answer: z.string() }).passthrough().optional().describe("askUser questionId + answer when the estimator confirmed an assumption-based quantity."),
      quantityDriver: z.string().optional().describe("Formula or driver behind quantity/hours/duration."),
      sourceRefs: sourceRefArray(),
      assumptionIds: z.array(z.string()).default([]),
      rationale: z.string().optional(),
    }).passthrough().optional(),
    pricing: z.object({
      type: z.enum(LINE_EVIDENCE_BASIS_TYPES).describe("Source class that justifies unit cost, rate, productivity, markup basis, or allowance value."),
      sourceRefs: sourceRefArray(),
      assumptionIds: z.array(z.string()).default([]),
      rationale: z.string().optional(),
    }).passthrough().optional(),
    quantityDriver: z.string().optional().describe("Short explanation of what drives quantity, hours, duration, or allowance."),
    drawingClaimIds: z.array(z.string()).default([]).describe("Legacy location for drawing quantity claim IDs. Prefer evidenceBasis.quantity.drawingClaimIds."),
    sourceRefs: sourceRefArray("Document, quote, manual, library, web, schedule, or model refs supporting non-drawing rows."),
    assumptionIds: z.array(z.string()).default([]).describe("Saved assumption IDs when the row is assumption-backed."),
    rationale: z.string().optional().describe("Why this source class is appropriate and how it supports the line."),
  }).passthrough().optional().describe("Optional line-level evidence: sources, assumptions, claims and views behind the quantity and the price. Use quantity/pricing axes when they differ."),
  derivation: derivationSchema.nullable().optional().describe("How the quantity was derived: formula + sourced inputs + result. When present, the formula must reproduce the row."),
  classification: z.record(z.unknown()).optional().describe("Optional construction classification JSON, e.g. { masterformat: '03 30 00' }."),
  costCode: z.string().nullable().optional().describe("Optional internal cost code used by cost-code rollups."),
  phaseId: z.string().optional().describe("Phase ID"),
  sourceNotes: z.string().default("").describe(
    "Basis for this item: knowledge book refs, dataset lookups, correction factors applied, web search URLs/findings, assumptions"
  ),
};

/** Parameter shape of updateWorksheetItem; shared with batchEditWorksheetItems. */
const updateWorksheetItemShape = {
  itemId: z.string().describe("Line item ID"),
  entityName: z.string().optional(),
  categoryId: z.string().nullable().optional().describe("Stable EntityCategory ID from getItemConfig. Prefer this when changing category."),
  category: z.string().optional(),
  description: z.string().optional(),
  quantity: z.coerce.number().optional(),
  uom: z.string().optional(),
  cost: z.coerce.number().optional(),
  markup: z.coerce.number().optional(),
  price: z.coerce.number().optional(),
  rateScheduleItemId: z.string().nullable().optional().describe("Rate schedule item ID. Pass null to clear. When changing this, also pass tierUnits."),
  costResourceId: z.string().nullable().optional().describe("Cost intelligence resource ID. Pass null to clear."),
  effectiveCostId: z.string().nullable().optional().describe("Effective cost ID. Pass null to clear."),
  laborUnitId: z.string().nullable().optional().describe("Labor unit ID. Pass null to clear."),
  resourceComposition: z.record(z.unknown()).optional(),
  sourceEvidence: z.record(z.unknown()).optional(),
  tierUnits: z.record(z.coerce.number()).optional().describe("Units per rate tier — keys are tier IDs (or tier names; server resolves) for the rate schedule referenced by rateScheduleItemId. REQUIRED when rateScheduleItemId changes."),
  classification: z.record(z.unknown()).optional().describe("Construction classification JSON, e.g. { masterformat: '03 30 00' }."),
  costCode: z.string().nullable().optional().describe("Internal cost code. Pass null to clear."),
  phaseId: z.string().nullable().optional().describe("Phase ID. Pass null to clear."),
  sourceNotes: z.string().optional(),
  catalogItemId: z.string().nullable().optional().describe("Catalog item ID for catalog-backed categories. Pass null to clear."),
  evidenceBasis: z.record(z.unknown()).optional().describe("Replace the row's line-level evidence contract (same shape as createWorksheetItem.evidenceBasis)."),
  derivation: derivationSchema.nullable().optional().describe("Replace the row's derivation (formula + sourced inputs + result) so it reproduces the new quantity/hours. Pass null to clear. If quantity/uom/tierUnits change without a new derivation, the existing one is marked stale."),
};

export function registerQuoteTools(server: McpServer) {

  // ── Cached workspace fetcher (shared across tool handlers) ──────────
  let cachedWs: { data: any; at: number } | null = null;

  async function getWs(): Promise<any> {
    if (cachedWs && Date.now() - cachedWs.at < 5000) return cachedWs.data;
    const raw = await apiGet(projectPath("/workspace"));
    const ws = raw.workspace || raw;
    cachedWs = { data: ws, at: Date.now() };
    return ws;
  }

  function invalidateWs() { cachedWs = null; }

  async function resolveRevisionId(): Promise<string | undefined> {
    const pinnedRevisionId = getRevisionId();
    if (pinnedRevisionId) return pinnedRevisionId;
    const ws = await getWs();
    return ws.currentRevision?.id || ws.currentRevisionId || ws.quote?.currentRevisionId || ws.revisions?.[0]?.id;
  }

  function normalizeCategoryToolKey(value: unknown) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
  }

  function findEntityCategory(
    categories: any[],
    input: { categoryId?: string | null; category?: string | null; entityType?: string | null },
  ) {
    const categoryId = normalizeCategoryToolKey(input.categoryId);
    if (categoryId) {
      const byId = categories.find((category: any) => normalizeCategoryToolKey(category.id) === categoryId);
      if (byId) return byId;
      return null;
    }

    const names = [input.category, input.entityType].map(normalizeCategoryToolKey).filter(Boolean);
    for (const name of names) {
      const match = categories.find((category: any) =>
        normalizeCategoryToolKey(category.name) === name ||
        normalizeCategoryToolKey(category.entityType) === name
      );
      if (match) return match;
    }

    return null;
  }

  function folderPath(ws: any, folderId?: string | null): string {
    if (!folderId) return "";
    const folders: any[] = ws.worksheetFolders || [];
    const byId = new Map<string, any>(folders.map((folder: any) => [folder.id, folder]));
    const parts: string[] = [];
    const seen = new Set<string>();
    let cursor = byId.get(folderId);
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      parts.unshift(cursor.name);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : null;
    }
    return parts.join(" / ");
  }

  /**
 * Resolved labour hours for a worksheet, split by the ratebook's own tier
 * names. Exposed because the raw payload only carries tier-id keyed maps, and
 * a caller without these ends up deriving hours from cost — which produces
 * invented numbers.
 */
function worksheetLabourHours(ws: any, worksheet: any) {
  const rollup = rollupWorksheetUnits(
    (worksheet.items || []).map((item: any) => ({ ...item, quantity: item.quantity ?? 1 })),
    ws.rateSchedules ?? [],
    ws.entityCategories ?? [],
  );
  return {
    total: rollup.labourHours.total,
    tiers: rollup.labourHours.tiers.map((tier: any) => ({ name: tier.name, hours: tier.total })),
  };
}

function worksheetTreeSummary(ws: any) {
    const folders = ws.worksheetFolders || [];
    const worksheets = ws.worksheets || [];
    return {
      folders: folders.map((folder: any) => {
        const childWorksheetIds = worksheets
          .filter((worksheet: any) => worksheet.folderId === folder.id)
          .map((worksheet: any) => worksheet.id);
        return {
          id: folder.id,
          name: folder.name,
          parentId: folder.parentId ?? null,
          path: folderPath(ws, folder.id),
          childWorksheetIds,
        };
      }),
      worksheets: worksheets.map((worksheet: any) => ({
        id: worksheet.id,
        name: worksheet.name,
        folderId: worksheet.folderId ?? null,
        path: [folderPath(ws, worksheet.folderId), worksheet.name].filter(Boolean).join(" / "),
        itemCount: (worksheet.items || []).length,
        priceTotal: (worksheet.items || []).reduce((sum: number, item: any) => sum + (item.price || 0), 0),
      })),
    };
  }

  async function ensureWorksheetFolderPath(path?: string | null): Promise<string | null> {
    if (!path?.trim()) return null;
    const parts = path.split("/").map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) return null;

    let ws = await getWs();
    let parentId: string | null = null;
    for (const part of parts) {
      const existing = (ws.worksheetFolders || []).find(
        (folder: any) => folder.name.toLowerCase() === part.toLowerCase() && (folder.parentId ?? null) === parentId,
      );
      if (existing) {
        parentId = existing.id;
        continue;
      }
      const data = await apiPost(projectPath("/worksheet-folders"), { name: part, parentId });
      ws = (data as any).workspace || data;
      cachedWs = { data: ws, at: Date.now() };
      const created = (ws.worksheetFolders || []).find(
        (folder: any) => folder.name === part && (folder.parentId ?? null) === parentId,
      );
      parentId = created?.id ?? null;
    }
    return parentId;
  }

  // ── Row write integrity ─────────────────────────────────────────────
  // Worksheet rows are checked for real references, arithmetic and explicit
  // units only (rowWriteIntegrityProblem). There are no prerequisite steps.

  async function rowIntegrity(row: {
    evidenceBasis?: Record<string, any> | null;
    derivation?: Record<string, any> | null;
    tierUnits?: Record<string, number> | null;
    cost?: number | null;
    price?: number | null;
    uom?: string | null;
    quantity?: number | null;
  }): Promise<string | null> {
    const ws = await getWs();
    return rowWriteIntegrityProblem(ws, {
      evidenceBasis: row.evidenceBasis ?? null,
      derivation: row.derivation ?? null,
      quantity: row.quantity ?? null,
      uom: row.uom ?? null,
      tierUnits: row.tierUnits ?? null,
      cost: row.cost ?? null,
      price: row.price ?? null,
      strategy: ws.estimateStrategy ?? null,
    });
  }

  /**
   * Everything createWorksheetItem does before the POST: truncation check,
   * row integrity, category/rate/catalog resolution, UOM and markup normalisation.
   * Shared with batchEditWorksheetItems so batched rows get identical checks.
   */
  async function prepareCreateWorksheetItem(input: any): Promise<{ error: string } | { worksheetId: string; body: Record<string, any>; rest: Record<string, any>; cat: string; autoWarnings: string[] }> {
  if (looksLikeTruncatedItemPayload(input as Record<string, any>)) {
    return { error: TRUNCATED_ITEM_PAYLOAD_MESSAGE };
  }
  const wsForItem = await getWs();
  const integrityError = await rowIntegrity({
    evidenceBasis: input.evidenceBasis ?? null,
    derivation: input.derivation ?? null,
    tierUnits: input.tierUnits ?? null,
    cost: input.cost ?? null,
    price: input.price ?? null,
    uom: input.uom ?? null,
    quantity: input.quantity ?? null,
  });
  if (integrityError) return { error: integrityError };

  const { worksheetId, evidenceBasis, ...rest } = input;
  if (evidenceBasis) {
    rest.sourceEvidence = {
      ...asRecord(rest.sourceEvidence),
      evidenceBasis,
    };
  }
  const autoWarnings: string[] = [];
  for (const key of ["entityName", "description", "sourceNotes"] as const) {
    (rest as any)[key] = stripLeakedToolParameterMarkup((rest as any)[key]);
  }
  if (!rest.category && !rest.categoryId && rest.rateScheduleItemId) {
    const matchingSchedule = asArray(wsForItem.rateSchedules).map(asRecord).find((schedule) =>
      asArray(schedule.items).some((item) => String(asRecord(item).id ?? "") === String(rest.rateScheduleItemId))
    );
    if (matchingSchedule) {
      const scheduleCategory = String(matchingSchedule.category ?? "");
      const categoryMatch = asArray(wsForItem.entityCategories).map(asRecord).find((category) =>
        normalizeCategoryToolKey(category.name) === normalizeCategoryToolKey(scheduleCategory) ||
        normalizeCategoryToolKey(category.entityType) === normalizeCategoryToolKey(scheduleCategory)
      );
      if (categoryMatch) {
        rest.categoryId = String(categoryMatch.id ?? "");
        rest.category = String(categoryMatch.name ?? scheduleCategory);
        rest.entityType = String(categoryMatch.entityType ?? scheduleCategory);
        autoWarnings.push(`Inferred category "${rest.category}" from rateScheduleItemId ${rest.rateScheduleItemId}.`);
      }
    }
  }
  const requestedCategory = rest.category;
  const requestedCategoryId = rest.categoryId;
  if (!requestedCategory && !requestedCategoryId) {
    return { error: "ERROR: categoryId or category is required. Prefer the stable categoryId from getItemConfig." };
  }
  let resolvedCategory: any = null;

  // ── Dynamic validation from workspace (entity categories + rate schedules) ──
  try {
    const ws = await getWs(); // reuses cached fetch from the integrity check
    const entityCategories = ws.entityCategories || [];
    const catConfig = findEntityCategory(entityCategories, {
      categoryId: requestedCategoryId,
      category: requestedCategory,
      entityType: rest.entityType,
    });

    if (catConfig) {
      resolvedCategory = catConfig;
      rest.categoryId = catConfig.id;
      rest.category = catConfig.name;
      rest.entityType = catConfig.entityType;
      const src = catConfig.itemSource || "freeform";
      const calcType = catConfig.calculationType || "manual";
      const requiresRateSchedule = src === "rate_schedule" || calcType === "tiered_rate" || calcType === "duration_rate";

      // Validate UOM against category's validUoms
      const validUoms: string[] = catConfig.validUoms || [];
      if (validUoms.length > 0) {
        if (!rest.uom || rest.uom === "EA") {
          // Auto-correct to category default if UOM was omitted or left as generic default
          if (!validUoms.includes(rest.uom || "EA")) {
            rest.uom = catConfig.defaultUom || validUoms[0];
          }
        } else if (!validUoms.includes(rest.uom)) {
          const requestedUom = rest.uom;
          rest.uom = catConfig.defaultUom || validUoms[0];
          autoWarnings.push(`UOM "${requestedUom}" is not valid for category "${catConfig.name}"; used "${rest.uom}" instead. Valid UOMs: ${validUoms.join(", ")}.`);
        }
      }

      // Validate itemSource requirements
      if (requiresRateSchedule && !rest.rateScheduleItemId) {
        return { error: `ERROR: Category "${catConfig.name}" is system-calculated from a rate schedule — rateScheduleItemId is required.\n1. Call listRateScheduleItems with q/category filters\n2. Set rateScheduleItemId to a valid item ID\n3. Provide quantity and positive tierUnits only; Bidwright calculates cost and price.` };
      }
      if (src === "catalog" && !rest.itemId) {
        return { error: `ERROR: Category "${catConfig.name}" is configured with itemSource=catalog — itemId is required. Call queryLibrary or getItemConfig, then retry with a valid itemId.` };
      }

      // Validate rateScheduleItemId actually exists in revision rate schedules
      if (rest.rateScheduleItemId) {
        const rateSchedules = ws.rateSchedules || [];
        const allRsItems = rateSchedules.flatMap((rs: any) => (rs.items || []).map((i: any) => ({ id: i.id, name: i.name, code: i.code })));
        const match = allRsItems.find((ri: any) => ri.id === rest.rateScheduleItemId);
        if (!match) {
          const available = allRsItems.slice(0, 15).map((ri: any) => `"${ri.name}" (${ri.id})`).join(", ");
          return { error: `ERROR: rateScheduleItemId "${rest.rateScheduleItemId}" does not match any rate schedule item in this revision.` +
            (available ? `\nAvailable items: ${available}` : `\nNo rate schedule items found. Call getItemConfig to check available items.`) +
            `\nFix the rateScheduleItemId and retry.` };
        }
      }

      // Validate itemId actually exists in catalogs
      if (rest.itemId) {
        const catalogItems = (ws.catalogItems || []);
        const catalogs = ws.catalogs || [];
        const allCatItems = catalogs.flatMap((c: any) => [
          ...(c.items || []).map((ci: any) => ({ id: ci.id, name: ci.name })),
          ...catalogItems.filter((ci: any) => ci.catalogId === c.id).map((ci: any) => ({ id: ci.id, name: ci.name })),
        ]);
        const match = allCatItems.find((ci: any) => ci.id === rest.itemId);
        if (!match) {
          return { error: `ERROR: itemId "${rest.itemId}" does not match any catalog item. Call getItemConfig to check available catalog items, then retry with a valid itemId.` };
        }
      }

      // Validate calculationType requirements
      const hasTierUnits = !!rest.tierUnits && Object.values(rest.tierUnits).some((value) => Number(value) !== 0);
      if (requiresRateSchedule && !hasTierUnits) {
        return { error: `ERROR: Category "${catConfig.name}" uses ${calcType} calculation with rate-schedule pricing, so positive tierUnits are required. Provide rateScheduleItemId, quantity, and tierUnits only; Bidwright calculates cost and price.` };
      }
      if (requiresRateSchedule) {
        const suppliedCalculatedValue = [rest.cost, rest.markup, rest.price].some((value) => value !== undefined && Number(value) !== 0);
        if (suppliedCalculatedValue) {
          return { error: `ERROR: Do not pass cost, markup, or price for "${catConfig.name}" rows. They are calculated by Bidwright from rateScheduleItemId, quantity, and tierUnits.` };
        }
        delete rest.cost;
        delete rest.markup;
        delete rest.price;
      }

      // Auto-apply default markup for markup-eligible categories when not explicitly set
      if (!requiresRateSchedule && catConfig.editableFields?.markup && rest.markup === undefined) {
        const rev = ws.currentRevision || {};
        const revMarkup: number = rev.defaultMarkup ?? 0;
        if (revMarkup > 0) {
          // Revision stores markup as decimal (0.15 for 15%) — pass through directly
          rest.markup = revMarkup > 1 ? revMarkup / 100 : revMarkup;
        }
      }
    }
  } catch {
    // Workspace not available — let API-level validation handle it
  }

  // Normalize markup to decimal: agent may send 15 for 15%, DB stores 0.15
  if (rest.markup !== undefined) {
    rest.markup = rest.markup > 1 ? rest.markup / 100 : rest.markup;
  }
  const cat = resolvedCategory?.name ?? requestedCategory ?? rest.category;
  if (!cat) {
    return { error: "ERROR: categoryId could not be resolved from the current workspace. Call getItemConfig and retry with a valid categoryId or category name." };
  }
  const body = { ...rest, category: cat, categoryId: resolvedCategory?.id ?? rest.categoryId, entityType: resolvedCategory?.entityType ?? rest.entityType ?? cat };
    return { worksheetId, body, rest, cat, autoWarnings };
  }

  /**
   * Everything updateWorksheetItem does before the PATCH: markup
   * normalisation, empty-patch rejection, row lookup, re-gating of claim or
   * cost changes, and nesting evidenceBasis into sourceEvidence. Shared with
   * batchEditWorksheetItems.
   */
  async function prepareUpdateWorksheetItem(itemId: string, catalogItemId: string | null | undefined, patchInput: Record<string, any>): Promise<{ error: string } | { patch: Record<string, any> }> {
    let patch: Record<string, any> = { ...patchInput };
  if (catalogItemId !== undefined) (patch as any).itemId = catalogItemId;
  // Normalize markup to decimal: agent sends 15 for 15%, DB stores 0.15
  if ((patch as any).markup !== undefined && (patch as any).markup > 1) {
    (patch as any).markup = (patch as any).markup / 100;
  }

  // Reject empty / no-op updates. Kimi-class runtimes have been observed
  // dropping every argument but itemId; those calls used to return
  // "Updated item" while changing nothing, which hid the failure.
  const providedKeys = Object.keys(patch).filter((key) => (patch as any)[key] !== undefined);
  if (providedKeys.length === 0) {
    return { error: `updateWorksheetItem for ${itemId} arrived with no fields to change — only itemId came through. Nothing was updated. Re-send with the fields you intend to change (for example quantity + derivation, or price + sourceNotes); if the arguments keep being dropped, send one field per call.` };
  }

  const ws = await getWs();
  const existing: Record<string, any> | undefined = asArray(ws.worksheets).map(asRecord)
    .flatMap((worksheet) => asArray(worksheet.items).map(asRecord).map((item): Record<string, any> => ({ ...item, worksheetName: worksheet.name })))
    .find((item) => String(item.id ?? "") === itemId);
  if (!existing) {
    return { error: `Worksheet item ${itemId} was not found in the current revision. Call getWorkspace or searchItems to find the right itemId.` };
  }

  // Re-check integrity when the change touches what the row cites or computes.
  const integrityFields = ["quantity", "uom", "tierUnits", "cost", "price", "markup", "rateScheduleItemId", "laborUnitId", "evidenceBasis", "derivation", "categoryId", "category"];
  const existingSourceEvidence = asRecord(existing.sourceEvidence);
  const mergedEvidenceBasis = (patch as any).evidenceBasis !== undefined
    ? asRecord((patch as any).evidenceBasis)
    : asRecord(existingSourceEvidence.evidenceBasis);
  const mergedDerivation = (patch as any).derivation !== undefined ? (patch as any).derivation : existing.derivation ?? null;
  if (providedKeys.some((key) => integrityFields.includes(key))) {
    const merged: Record<string, any> = { ...existing, ...patch };
    const integrityError = await rowIntegrity({
      evidenceBasis: Object.keys(mergedEvidenceBasis).length > 0 ? mergedEvidenceBasis : null,
      derivation: mergedDerivation,
      tierUnits: (merged.tierUnits as Record<string, number> | undefined) ?? null,
      cost: Number.isFinite(merged.cost) ? Number(merged.cost) : null,
      price: Number.isFinite(merged.price) ? Number(merged.price) : null,
      uom: merged.uom ?? null,
      quantity: Number.isFinite(merged.quantity) ? Number(merged.quantity) : null,
    });
    if (integrityError) return { error: integrityError };
  }

  // evidenceBasis lives inside sourceEvidence on the persisted row.
  if ((patch as any).evidenceBasis !== undefined) {
    const { evidenceBasis, ...restPatch } = patch as any;
    (restPatch as any).sourceEvidence = {
      ...existingSourceEvidence,
      ...asRecord((patch as any).sourceEvidence),
      evidenceBasis,
    };
    patch = restPatch;
  }

    return { patch };
  }

  // ── getWorkspace ──────────────────────────────────────────
  server.tool(
    "getWorkspace",
    "Get the current quote workspace — saved revision description (Setup → General → Description / Scope of Work), customer-facing notes and lead letter, worksheets, items, phases, estimate factors, modifiers, conditions, totals. Read revision.description to preserve existing wording and verify the customer-facing scope narrative after saving it.",
    {},
    async () => {
      const data = await apiGet(projectPath("/workspace"));
      // Return a compact summary to avoid context bloat
      const ws = data.workspace || data;
      const rev = ws.currentRevision || ws.revisions?.[0] || {};
      const summary = {
        quote: { name: (ws.project || ws.projects?.[0])?.name, client: (ws.project || ws.projects?.[0])?.clientName },
        revision: {
          id: rev.id, title: rev.title, status: rev.status, type: rev.type,
          breakoutStyle: rev.breakoutStyle, defaultMarkup: rev.defaultMarkup,
          description: rev.description ?? "", notes: rev.notes ?? "", leadLetter: rev.leadLetter ?? "",
        },
        worksheets: (ws.worksheets || []).map((w: any) => ({
          id: w.id,
          name: w.name,
          folderId: w.folderId ?? null,
          path: [folderPath(ws, w.folderId), w.name].filter(Boolean).join(" / "),
          itemCount: (w.items || []).length,
          labourHours: worksheetLabourHours(ws, w),
          structuredSourceCount: (w.items || []).filter((item: any) =>
            item.rateScheduleItemId ||
            item.itemId ||
            item.costResourceId ||
            item.effectiveCostId ||
            item.laborUnitId ||
            (Array.isArray(item.resourceComposition?.resources) && item.resourceComposition.resources.length > 0)
          ).length,
        })),
        worksheetFolders: (ws.worksheetFolders || []).map((folder: any) => ({
          id: folder.id,
          name: folder.name,
          parentId: folder.parentId ?? null,
          path: folderPath(ws, folder.id),
        })),
        totalItems: (ws.worksheets || []).reduce((sum: number, w: any) => sum + (w.items || []).length, 0),
        totalStructuredSourceItems: (ws.worksheets || []).reduce((sum: number, w: any) => sum + (w.items || []).filter((item: any) =>
          item.rateScheduleItemId ||
          item.itemId ||
          item.costResourceId ||
          item.effectiveCostId ||
          item.laborUnitId ||
          (Array.isArray(item.resourceComposition?.resources) && item.resourceComposition.resources.length > 0)
        ).length, 0),
        phases: (ws.phases || []).map((p: any) => ({ id: p.id, name: p.name })),
        estimateFactors: (ws.estimateFactors || []).map((f: any) => ({
          id: f.id,
          name: f.name,
          code: f.code,
          impact: f.impact,
          value: f.value,
          active: f.active,
          appliesTo: f.appliesTo,
          scope: f.scope,
          confidence: f.confidence,
          sourceType: f.sourceType,
          sourceId: f.sourceId,
        })),
        factorTotals: (ws.estimate?.totals?.factorTotals || []).map((entry: any) => ({
          id: entry.id,
          label: entry.label,
          targetCount: entry.targetCount,
          valueDelta: entry.valueDelta,
          costDelta: entry.costDelta,
          hoursDelta: entry.hoursDelta,
        })),
        modifiers: (ws.modifiers || []).map((m: any) => ({
          id: m.id, name: m.name, type: m.type, appliesTo: m.appliesTo,
          percentage: m.percentage, amount: m.amount, show: m.show,
        })),
        additionalLineItems: (ws.additionalLineItems || []).map((a: any) => ({
          id: a.id, name: a.name, type: a.type, amount: a.amount, description: a.description,
        })),
        conditions: (ws.conditions || []).map((c: any) => ({ id: c.id, type: c.type, text: c.text })),
        reportSections: (ws.reportSections || []).map((s: any) => ({
          id: s.id, sectionType: s.sectionType, title: s.title, order: s.order,
        })),
        rateScheduleCount: (ws.rateSchedules || []).length,
        estimateStrategy: ws.estimateStrategy ? {
          currentStage: ws.estimateStrategy.currentStage,
          status: ws.estimateStrategy.status,
          reviewCompleted: ws.estimateStrategy.reviewCompleted,
          benchmarkCandidateCount: ws.estimateStrategy.benchmarkProfile?.candidateCount ?? 0,
        } : null,
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
    }
  );

  // ── getWorksheetTree ──────────────────────────────────────
  server.tool(
    "getWorksheetTree",
    "Get the worksheet folder tree for the current quote. Folders organize worksheets; line items still belong to worksheets.",
    {},
    async () => {
      const ws = await getWs();
      return { content: [{ type: "text" as const, text: JSON.stringify(worksheetTreeSummary(ws), null, 2) }] };
    }
  );

  // ── getItemConfig ─────────────────────────────────────────
  server.tool(
    "getItemConfig",
    `Discover how line items work in this organization. Returns compact entity category config plus bounded summaries of imported rate schedules, catalog items, and available org schedules. CALL THIS FIRST before creating line items, then call listRateScheduleItems with q/category/scheduleId when you need specific rateScheduleItemId values.`,
    {
      includeRateScheduleItems: z.boolean().default(false).describe("Return a bounded page of imported revision rate items. Default false keeps this config response compact."),
      q: z.string().optional().describe("Optional search terms for rate schedule items when includeRateScheduleItems=true."),
      category: z.string().optional().describe("Optional schedule/category filter for rate schedule items and org schedules."),
      scheduleId: z.string().optional().describe("Optional imported revision schedule id filter for rate schedule items."),
      limit: z.coerce.number().int().positive().max(100).default(25),
      offset: z.coerce.number().int().min(0).default(0),
      includeRates: z.boolean().optional().describe("Include rate/cost-rate maps in the item page. Default: included when q/category/scheduleId narrows or the page is <= 25 rows."),
      catalogLimit: z.coerce.number().int().positive().max(100).default(25).describe("Max catalog items returned; the omitted count is reported."),
    },
    async (input) => {
      const data = await apiGet(projectPath("/workspace"));
      const ws = data.workspace || data;

      const entityCategories = (ws.entityCategories || []).map((ec: any) => ({
        id: ec.id,
        name: ec.name,
        entityType: ec.entityType,
        defaultUom: ec.defaultUom,
        validUoms: ec.validUoms,
        calculationType: ec.calculationType,
        editableFields: ec.editableFields,
        unitLabels: ec.unitLabels ?? {},
        itemSource: ec.itemSource ?? "freeform",
        catalogId: ec.catalogId ?? null,
        usesRateSchedule: (ec.itemSource ?? "freeform") === "rate_schedule",
      }));

      const allRateMatches: Array<{ item: any; schedule: any }> = [];
      for (const rs of (ws.rateSchedules || [])) {
        for (const item of (rs.items || [])) {
          if (rateScheduleItemMatches(item, rs, input)) allRateMatches.push({ item, schedule: rs });
        }
      }
      const rateMatchPage = paginate(allRateMatches, input, { defaultLimit: 25, maxLimit: 100 });
      const rateNarrowed = !!(input.q || input.category || input.scheduleId);
      const rateIncludeRates = shouldIncludeRates({ includeRates: input.includeRates, narrowed: rateNarrowed, returned: rateMatchPage.page.length });
      const rateItemPage = {
        ...rateMatchPage,
        page: rateMatchPage.page.map((entry) => compactRateItem(entry.item, entry.schedule, { includeRates: rateIncludeRates })),
      };

      const allCatalogItems: any[] = [];
      for (const cat of (ws.catalogs || [])) {
        for (const item of (ws.catalogItems || []).filter((ci: any) => ci.catalogId === cat.id)) {
          allCatalogItems.push({
            catalogItemId: item.id, name: clipCatalogText(item.name), code: item.code,
            unit: item.unit, unitCost: item.unitCost, unitPrice: item.unitPrice,
            catalogName: cat.name, catalogKind: cat.kind,
          });
        }
      }
      const catalogPage = paginate(allCatalogItems, { limit: input.catalogLimit, offset: 0 }, { defaultLimit: 25, maxLimit: 100 });
      const catalogItems = catalogPage.page;

      // Fetch org-level rate schedules available for import
      let orgSchedules: any[] = [];
      try {
        const orgData = await apiGet("/api/rate-schedules");
        orgSchedules = (orgData.schedules || orgData || [])
          .filter((s: any) => !input.category || normalizedText(s.category) === normalizedText(input.category))
          .filter((s: any) => !input.q || [s.name, s.description, s.category, ...(s.items || []).slice(0, 10).map((item: any) => item.name)].some((value) => matchesText(value, input.q)))
          .map((s: any) => compactScheduleSummary(s, { includeTiers: "names" }));
      } catch {}
      const orgSchedulePage = paginate(orgSchedules, { limit: Math.min(input.limit, 10), offset: input.offset }, { defaultLimit: 10, maxLimit: 25 });

      const rateScheduleCats = entityCategories.filter((c: any) => c.itemSource === "rate_schedule");
      const catalogCats = entityCategories.filter((c: any) => c.itemSource === "catalog");
      const freeformCats = entityCategories.filter((c: any) => c.itemSource === "freeform");
      let instructions = "";
      if (rateScheduleCats.length > 0) {
        const names = rateScheduleCats.map((c: any) => c.name).join(", ");
        if (allRateMatches.length > 0 || (ws.rateSchedules || []).length > 0) {
          instructions += `Categories [${names}] use rate schedules. Link items via rateScheduleItemId. Use listRateScheduleItems with q/category/scheduleId to fetch specific item IDs instead of dumping every rate item. `;
        } else if (orgSchedules.length > 0) {
          instructions += `Categories [${names}] use rate schedules but NONE are imported into this quote yet. ` +
            `You MUST import a rate schedule before creating items in these categories. Steps:\n` +
            `1. Review the compact available org schedules listed below, using q/category filters if needed\n` +
            `2. Call importRateSchedule with the appropriate schedule ID\n` +
            `3. Call listRateScheduleItems with q/category to get specific item IDs\n` +
            `4. Set rateScheduleItemId on each item you create\n` +
            `DO NOT create items with made-up rates — import the schedule first.\n`;
        } else {
          instructions += `Categories [${names}] use rate schedules but no org schedules exist. Create items with estimated costs and note "NEEDS RATE SCHEDULE" in description. `;
        }
      }
      if (catalogCats.length > 0) {
        const names = catalogCats.map((c: any) => c.name).join(", ");
        instructions += `Categories [${names}] use catalog items. Set itemId to link to a catalog item. `;
      }
      if (freeformCats.length > 0) {
        instructions += `Categories [${freeformCats.map((c: any) => c.name).join(", ")}] use freeform input — set cost and quantity directly.`;
      }

      // Canonical cost-source workflow + line-evidence-basis are already in the
      // startup prompt; re-injecting them on every getItemConfig call burned
      // ~3KB per call of the agent's context for no incremental signal.

      // If no categories configured, provide default guidance
      if (entityCategories.length === 0) {
        instructions = `No entity categories configured for this organization. Use these standard categories when creating items:\n` +
          `- "Material" — physical materials, supplies, consumables\n` +
          `- "Labour" — labour hours, crew costs (set tierUnits with the schedule's tier ids)\n` +
          `- "Equipment" — equipment rental, tools, machinery\n` +
          `- "Subcontractor" — subcontracted work (lump sum or per-unit)\n` +
          `All categories use freeform input — set cost and quantity directly. ` +
          `IMPORTANT: Use the correct category for each item. Do NOT put labour under Material.`;
      }

      // UOM validation instructions
      if (entityCategories.length > 0) {
        instructions += `\n\nUOM RULES: Each category has a validUoms list. You MUST use one of those UOMs — the server will REJECT invalid UOMs. `;
        for (const c of entityCategories) {
          if (c.validUoms?.length > 0) {
            instructions += `${c.name}: ${c.validUoms.join(", ")}. `;
          }
        }
      }

      // Markup instructions
      const rev = ws.currentRevision || {};
      const revisionDefaultMarkup: number = rev.defaultMarkup ?? 0;
      const markupPct = revisionDefaultMarkup > 1 ? revisionDefaultMarkup : revisionDefaultMarkup * 100;
      const markupCats = entityCategories.filter((c: any) => c.editableFields?.markup);
      if (markupCats.length > 0 && revisionDefaultMarkup > 0) {
        const noMarkupCats = entityCategories.filter((c: any) => !c.editableFields?.markup).map((c: any) => c.name);
        instructions += `\n\nMARKUP: The revision default markup is ${markupPct.toFixed(1)}%. Apply this to categories with editable markup: ${markupCats.map((c: any) => c.name).join(", ")}. Set markup=${markupPct} (e.g. 15 for 15%) on items in these categories unless you have a specific reason not to.`;
        if (noMarkupCats.length > 0) {
          instructions += ` Categories WITHOUT markup (pricing set by rate/catalog/direct entry): ${noMarkupCats.join(", ")}.`;
        }
      }

      // Quantity × units clarification — derive from actual category configs
      const rateSchedCatNames = rateScheduleCats.map((c: any) => c.name);
      if (rateSchedCatNames.length > 0) {
        instructions += `\n\nQUANTITY × UNITS (CRITICAL for rate_schedule categories: ${rateSchedCatNames.join(", ")}): `;
        instructions += `For these categories, quantity is a MULTIPLIER on the tierUnits values. tierUnits is a JSON map keyed by RateScheduleTier id with hours per quantity. `;
        instructions += `The calc engine computes cost/price from rateScheduleItemId, quantity, and tierUnits; do not pass cost, price, or markup. `;
        instructions += `Get tier ids from the rate schedule. Do NOT confuse quantity with total tier hours — quantity × tier hours must make logical sense for the item. `;
        instructions += `Example: 1 person for 80 regular hours → quantity=1, tierUnits={"<reg-tier-id>": 80}. 4 people for 200 regular hours each → quantity=4, tierUnits={"<reg-tier-id>": 200}.`;
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          categories: entityCategories.length > 0 ? entityCategories : [
            { name: "Material", entityType: "Material", defaultUom: "EA", calculationType: "manual", itemSource: "freeform", usesRateSchedule: false },
            { name: "Labour", entityType: "Labour", defaultUom: "HR", calculationType: "manual", itemSource: "freeform", usesRateSchedule: false },
            { name: "Equipment", entityType: "Equipment", defaultUom: "DAY", calculationType: "manual", itemSource: "freeform", usesRateSchedule: false },
            { name: "Subcontractor", entityType: "Subcontractor", defaultUom: "LS", calculationType: "manual", itemSource: "freeform", usesRateSchedule: false },
          ],
          importedRateSchedules: (ws.rateSchedules || []).map((schedule: any) => summarizeRateSchedule(schedule, { includeSampleItems: true })),
          rateScheduleItems: input.includeRateScheduleItems ? {
            total: rateItemPage.total,
            offset: rateItemPage.offset,
            limit: rateItemPage.limit,
            hasMore: rateItemPage.hasMore,
            nextOffset: rateItemPage.nextOffset,
            omitted: rateItemPage.omitted,
            ratesIncluded: rateIncludeRates,
            ratesOmitted: rateIncludeRates ? 0 : rateItemPage.page.length,
            schedules: (ws.rateSchedules || [])
              .filter((schedule: any) => rateItemPage.page.some((row: any) => row.scheduleId === String(schedule.id ?? "")))
              .map((schedule: any) => compactScheduleSummary(schedule, { includeTiers: "full" })),
            items: rateItemPage.page,
            note: rateIncludeRates
              ? "Paginated; rates keyed by tier name, tier ids in schedules[].tiers. Use listRateScheduleItems with q/category/scheduleId for focused lookups."
              : "Paginated; rates omitted on this broad page — narrow with q/category/scheduleId or pass includeRates:true.",
          } : undefined,
          availableOrgSchedules: orgSchedulePage.total > 0 && (ws.rateSchedules || []).length === 0 ? {
            total: orgSchedulePage.total,
            offset: orgSchedulePage.offset,
            limit: orgSchedulePage.limit,
            hasMore: orgSchedulePage.hasMore,
            nextOffset: orgSchedulePage.nextOffset,
            omitted: orgSchedulePage.omitted,
            schedules: orgSchedulePage.page,
          } : undefined,
          catalogItems: {
            total: allCatalogItems.length,
            shown: catalogItems.length,
            omitted: catalogPage.omitted,
            items: catalogItems,
            note: catalogPage.omitted > 0 ? `${catalogPage.omitted} catalog items not shown; use searchCatalogs or raise catalogLimit.` : undefined,
          },
          defaultMarkup: revisionDefaultMarkup,
          instructions,
        }, null, 2) }],
      };
    }
  );

  // ── createWorksheet ───────────────────────────────────────
  server.tool(
    "createWorksheet",
    "Create a new worksheet (cost breakdown section) in the quote. Use folderId or folderPath for large estimates. Folders organize worksheets; line items still belong to worksheets.",
    {
      name: z.string().describe("Worksheet name"),
      description: z.string().optional().describe("Optional description"),
      folderId: z.string().nullable().optional().describe("Existing worksheet folder ID"),
      folderPath: z.string().optional().describe("Folder path to create/use, e.g. 'Mechanical / Field Install'"),
    },
    async ({ name, description, folderId, folderPath }) => {
      const resolvedFolderId = folderId ?? await ensureWorksheetFolderPath(folderPath);
      const data = await apiPost(projectPath("/worksheets"), { name, description, folderId: resolvedFolderId });
      // Extract the worksheet ID from the response
      const worksheets = (data as any)?.workspace?.worksheets ?? [];
      const created = worksheets.find((w: any) => w.name === name && (w.folderId ?? null) === (resolvedFolderId ?? null));
      const wsId = created?.id ?? "unknown";
      invalidateWs();
      const path = created ? [folderPath || "", name].filter(Boolean).join(" / ") : name;
      return { content: [{ type: "text" as const, text: toolUiText(`Created worksheet: ${path}`, {
        kind: "worksheet.created",
        worksheetId: wsId,
        name,
        path,
        folderId: resolvedFolderId ?? null,
      }) }] };
    }
  );

  // ── createWorksheetFolder ─────────────────────────────────
  server.tool(
    "createWorksheetFolder",
    "Create a worksheet folder for organizing large estimates. Folders do not contain line items directly; worksheets do.",
    {
      name: z.string().describe("Folder name"),
      parentId: z.string().nullable().optional().describe("Optional parent folder ID"),
      parentPath: z.string().optional().describe("Optional parent path to create/use, e.g. 'Mechanical'"),
    },
    async ({ name, parentId, parentPath }) => {
      const resolvedParentId = parentId ?? await ensureWorksheetFolderPath(parentPath);
      const data = await apiPost(projectPath("/worksheet-folders"), { name, parentId: resolvedParentId });
      const ws = (data as any).workspace || data;
      const folder = (ws.worksheetFolders || []).find((entry: any) => entry.name === name && (entry.parentId ?? null) === (resolvedParentId ?? null));
      invalidateWs();
      return { content: [{ type: "text" as const, text: `Created worksheet folder: ${folder ? folderPath(ws, folder.id) : name}${folder?.id ? ` (folderId: ${folder.id})` : ""}` }] };
    }
  );

  // ── updateWorksheetFolder ─────────────────────────────────
  server.tool(
    "updateWorksheetFolder",
    "Rename or move a worksheet folder.",
    {
      folderId: z.string(),
      name: z.string().optional(),
      parentId: z.string().nullable().optional(),
      parentPath: z.string().optional().describe("Destination parent path to create/use"),
    },
    async ({ folderId, name, parentId, parentPath }) => {
      const patch: Record<string, unknown> = {};
      if (name) patch.name = name;
      if (parentId !== undefined || parentPath !== undefined) {
        patch.parentId = parentId !== undefined ? parentId : await ensureWorksheetFolderPath(parentPath);
      }
      await apiPatch(projectPath(`/worksheet-folders/${folderId}`), patch);
      invalidateWs();
      return { content: [{ type: "text" as const, text: `Updated worksheet folder ${folderId}` }] };
    }
  );

  // ── deleteWorksheetFolder ─────────────────────────────────
  server.tool(
    "deleteWorksheetFolder",
    "Delete a worksheet folder. Child folders and worksheets are moved up one level; line items are not deleted.",
    { folderId: z.string() },
    async ({ folderId }) => {
      await apiDelete(projectPath(`/worksheet-folders/${folderId}`));
      invalidateWs();
      return { content: [{ type: "text" as const, text: `Deleted worksheet folder ${folderId}` }] };
    }
  );

  // ── deleteWorksheet ───────────────────────────────────────
  server.tool(
    "deleteWorksheet",
    "Delete a worksheet (an entire cost section) from the current revision. Cascades to any remaining line items — only call this once the worksheet is empty or you intentionally want to drop its lines and recalc totals.",
    { worksheetId: z.string().describe("ID of the worksheet to remove") },
    async ({ worksheetId }) => {
      await apiDelete(projectPath(`/worksheets/${worksheetId}`));
      invalidateWs();
      return { content: [{ type: "text" as const, text: toolUiText(`Deleted worksheet ${worksheetId}`, {
        kind: "worksheet.deleted",
        worksheetId,
      }) }] };
    }
  );

  // ── moveWorksheet ─────────────────────────────────────────
  server.tool(
    "moveWorksheet",
    "Move a worksheet into a folder, or to the top level with folderId=null. This does not change line items.",
    {
      worksheetId: z.string(),
      folderId: z.string().nullable().optional(),
      folderPath: z.string().optional().describe("Destination folder path to create/use"),
    },
    async ({ worksheetId, folderId, folderPath }) => {
      const resolvedFolderId = folderId !== undefined ? folderId : await ensureWorksheetFolderPath(folderPath);
      await apiPatch(projectPath(`/worksheets/${worksheetId}`), { folderId: resolvedFolderId ?? null });
      invalidateWs();
      return { content: [{ type: "text" as const, text: `Moved worksheet ${worksheetId}` }] };
    }
  );

  // ── moveWorksheetFolder ───────────────────────────────────
  server.tool(
    "moveWorksheetFolder",
    "Move a worksheet folder under another folder, or to the top level with parentId=null.",
    {
      folderId: z.string(),
      parentId: z.string().nullable().optional(),
      parentPath: z.string().optional().describe("Destination parent path to create/use"),
    },
    async ({ folderId, parentId, parentPath }) => {
      const resolvedParentId = parentId !== undefined ? parentId : await ensureWorksheetFolderPath(parentPath);
      await apiPatch(projectPath(`/worksheet-folders/${folderId}`), { parentId: resolvedParentId ?? null });
      invalidateWs();
      return { content: [{ type: "text" as const, text: `Moved worksheet folder ${folderId}` }] };
    }
  );

  // ── createWorksheetItem ───────────────────────────────────
  server.tool(
    "createWorksheetItem",
    `Create a line item in a worksheet. IMPORTANT: categoryId is preferred; category name is accepted for backward compatibility and must resolve to an EntityCategory from getItemConfig. For tiered/rate categories, provide rateScheduleItemId, quantity, and tierUnits only; Bidwright calculates cost and price. Use the rate item name as entityName and put task details in the description field, NOT in entityName. For freeform categories, provide quantity plus the editable unit cost/price basis. UOM must be from the category's validUoms list. evidenceBasis is optional and records the basis for review. Two-axis form: evidenceBasis.quantity declares where the quantity/hours/duration came from, and evidenceBasis.pricing declares where the unit cost/rate/productivity came from. Drawing/takeoff quantities use drawing_quantity/visual_takeoff/drawing_table/drawing_note under evidenceBasis.quantity and can cite saved claim IDs and viewIds; pricing can separately be material_quote, rate_schedule, knowledge_labor, vendor_quote, equipment_rental, subcontract, allowance, indirect, assumption, document_quantity, or mixed.`,
    createWorksheetItemShape,
    async (input) => {
      const prepared = await prepareCreateWorksheetItem(input);
      if ("error" in prepared) return { content: [{ type: "text" as const, text: prepared.error }], isError: true };
      const { worksheetId, body, rest, cat, autoWarnings } = prepared;
      try {
        const data = await apiPost(projectPath(`/worksheets/${worksheetId}/items`), body);
        invalidateWs();
        const createdItem = findCreatedWorksheetItem(data, worksheetId, rest);
        const itemId = String(createdItem.id ?? (data as any)?.id ?? (data as any)?.item?.id ?? "");
        return { content: [{ type: "text" as const, text: toolUiText(`Created item: ${rest.entityName} (${cat})`, {
          kind: "worksheet_item.created",
          worksheetId,
          itemId,
          entityName: rest.entityName,
          category: cat,
          categoryId: body.categoryId ?? null,
          quantity: rest.quantity,
          uom: rest.uom,
          calculation: "system_calculated",
          sourceNotes: rest.sourceNotes ?? "",
          warnings: autoWarnings,
        }) }] };
      } catch (err: any) {
        const msg = err?.message || String(err);
        return { content: [{ type: "text" as const, text: `ERROR creating item "${rest.entityName}": ${msg}. Check field values and try again.` }], isError: true };
      }
    }
  );

  server.tool(
    "createRateScheduleWorksheetItem",
    "Create a system-calculated rate-schedule worksheet row with a smaller safer payload. Use this for Labour, Equipment, Rental Equipment, and General Conditions rate-card rows instead of the broad createWorksheetItem tool. Provide a concrete rateScheduleItemId and positive tierUnits; Bidwright derives the category/name from the imported rate schedule and calculates cost/sell. Do not pass cost, price, or markup.",
    {
      worksheetId: z.string().describe("ID of the worksheet"),
      rateScheduleItemId: z.string().describe("Concrete imported revision rate schedule item ID from listRateScheduleItems/getItemConfig"),
      tierUnits: z.record(z.coerce.number()).describe("Units per rate tier. Keys are tier IDs from getItemConfig/listRateScheduleItems, values are positive units per quantity."),
      quantity: z.coerce.number().default(1).describe("Quantity multiplier. Usually 1 for total hours on a row."),
      uom: z.string().optional().describe("Optional UOM. Defaults to the category default or HR."),
      phaseId: z.string().optional(),
      description: z.string().default("").describe("Task/scope description; do not put task details in entityName."),
      sourceNotes: z.string().default("").describe("Source basis, productivity logic, assumptions, and document/library refs."),
      laborUnitId: z.string().nullable().optional().describe("Labor unit ID when a labour manual/unit informed the tierUnits."),
      resourceComposition: z.record(z.unknown()).optional(),
      sourceEvidence: z.record(z.unknown()).optional(),
      evidenceBasis: z.object({
        type: z.enum(LINE_EVIDENCE_BASIS_TYPES).optional(),
        quantity: z.object({
          type: z.enum(LINE_EVIDENCE_BASIS_TYPES),
          drawingClaimIds: z.array(z.string()).default([]),
          viewIds: z.array(z.string()).default([]).describe("REQUIRED for drawing-driven quantities: viewId(s) from readDrawingPage / readDrawingTile / inspectDrawingRegion."),
          userConfirmation: z.object({ questionId: z.string(), answer: z.string() }).passthrough().optional(),
          quantityDriver: z.string().optional(),
          sourceRefs: sourceRefArray(),
          assumptionIds: z.array(z.string()).default([]),
          rationale: z.string().optional(),
        }).passthrough().optional(),
        pricing: z.object({
          type: z.enum(LINE_EVIDENCE_BASIS_TYPES),
          sourceRefs: sourceRefArray(),
          assumptionIds: z.array(z.string()).default([]),
          rationale: z.string().optional(),
        }).passthrough().optional(),
        quantityDriver: z.string().optional(),
        drawingClaimIds: z.array(z.string()).default([]),
        sourceRefs: sourceRefArray(),
        assumptionIds: z.array(z.string()).default([]),
        rationale: z.string().optional(),
      }).passthrough().describe("Line-level evidence contract. Use quantity/pricing axes."),
      derivation: derivationSchema.nullable().optional().describe("How the hours/quantity were derived: formula + sourced inputs + result (e.g. 'units * hoursPerUnit'). When present, the formula must reproduce the hours."),
      classification: z.record(z.unknown()).optional(),
      costCode: z.string().nullable().optional(),
    },
    async (input) => {
      const ws = await getWs();
      const rateSchedules = asArray(ws.rateSchedules).map(asRecord);
      let matchedSchedule: Record<string, any> | null = null;
      let matchedItem: Record<string, any> | null = null;
      for (const schedule of rateSchedules) {
        const item = asArray(schedule.items).map(asRecord).find((entry) => String(entry.id ?? "") === input.rateScheduleItemId);
        if (item) {
          matchedSchedule = schedule;
          matchedItem = item;
          break;
        }
      }
      if (!matchedSchedule || !matchedItem) {
        const available = rateSchedules
          .flatMap((schedule) => asArray(schedule.items).map(asRecord).map((item) => `${String(item.name ?? "rate item")} (${String(item.id ?? "")})`))
          .slice(0, 15)
          .join(", ");
        return {
          content: [{ type: "text" as const, text: `ERROR: rateScheduleItemId "${input.rateScheduleItemId}" does not match any imported rate schedule item in this revision.${available ? ` Available: ${available}` : " Import a rate schedule and call listRateScheduleItems first."}` }],
          isError: true,
        };
      }

      const scheduleCategory = String(matchedSchedule.category ?? matchedItem.category ?? "");
      const categoryMatch = asArray(ws.entityCategories).map(asRecord).find((category) =>
        normalizeCategoryToolKey(category.name) === normalizeCategoryToolKey(scheduleCategory) ||
        normalizeCategoryToolKey(category.entityType) === normalizeCategoryToolKey(scheduleCategory)
      );
      if (!categoryMatch) {
        return {
          content: [{ type: "text" as const, text: `ERROR: Could not resolve entity category for rate schedule category "${scheduleCategory}". Call getItemConfig and use createWorksheetItem with a valid categoryId if this schedule is custom.` }],
          isError: true,
        };
      }

      const positiveTierUnits = Object.fromEntries(
        Object.entries(input.tierUnits || {})
          .map(([key, value]) => [key, Number(value)] as const)
          .filter(([, value]) => Number.isFinite(value) && value > 0)
      );
      if (Object.keys(positiveTierUnits).length === 0) {
        return {
          content: [{ type: "text" as const, text: "ERROR: positive tierUnits are required. Provide tier IDs from the imported rate schedule, for example {\"rst-...\": 120}." }],
          isError: true,
        };
      }

      const integrityError = await rowIntegrity({
        evidenceBasis: input.evidenceBasis,
        derivation: input.derivation ?? null,
        tierUnits: positiveTierUnits,
        uom: input.uom ?? null,
        quantity: input.quantity ?? null,
      });
      if (integrityError) return { content: [{ type: "text" as const, text: integrityError }], isError: true };

      const body: Record<string, unknown> = {
        entityName: String(matchedItem.name ?? "Rate Schedule Item"),
        categoryId: String(categoryMatch.id ?? ""),
        category: String(categoryMatch.name ?? scheduleCategory),
        entityType: String(categoryMatch.entityType ?? scheduleCategory),
        description: stripLeakedToolParameterMarkup(input.description),
        quantity: input.quantity,
        uom: input.uom || String(categoryMatch.defaultUom ?? "HR"),
        tierUnits: positiveTierUnits,
        rateScheduleItemId: input.rateScheduleItemId,
        laborUnitId: input.laborUnitId,
        resourceComposition: input.resourceComposition,
        sourceEvidence: {
          ...asRecord(input.sourceEvidence),
          evidenceBasis: input.evidenceBasis,
        },
        derivation: input.derivation ?? undefined,
        classification: input.classification,
        costCode: input.costCode,
        phaseId: input.phaseId,
        sourceNotes: stripLeakedToolParameterMarkup(input.sourceNotes),
      };

      try {
        const data = await apiPost(projectPath(`/worksheets/${input.worksheetId}/items`), body);
        invalidateWs();
        const createdItem = findCreatedWorksheetItem(data, input.worksheetId, body);
        const itemId = String(createdItem.id ?? (data as any)?.id ?? (data as any)?.item?.id ?? "");
        return { content: [{ type: "text" as const, text: toolUiText(`Created rate-schedule item: ${body.entityName} (${body.category})`, {
          kind: "worksheet_item.created",
          worksheetId: input.worksheetId,
          itemId,
          entityName: body.entityName,
          category: body.category,
          categoryId: body.categoryId,
          quantity: body.quantity,
          uom: body.uom,
          calculation: "system_calculated",
          sourceNotes: body.sourceNotes ?? "",
          warnings: [],
        }) }] };
      } catch (err: any) {
        const msg = err?.message || String(err);
        return { content: [{ type: "text" as const, text: `ERROR creating rate-schedule item "${String(matchedItem.name ?? "")}": ${msg}. Check worksheetId, tierUnits, and evidenceBasis, then retry.` }], isError: true };
      }
    }
  );

  // ── updateWorksheetItem ───────────────────────────────────
  server.tool(
    "updateWorksheetItem",
    "Update an existing line item. Only provided fields are changed. When re-pointing an item at a different rate-schedule item (e.g. swapping MECH labour for SHOP labour), pass BOTH rateScheduleItemId AND tierUnits in the same call — the server keeps the previously persisted tierUnits otherwise, leaving stale tier IDs that price to $0.",
    updateWorksheetItemShape,
    async ({ itemId, catalogItemId, ...patch }) => {
      const prepared = await prepareUpdateWorksheetItem(itemId, catalogItemId, patch);
      if ("error" in prepared) return { content: [{ type: "text" as const, text: prepared.error }], isError: true };
      patch = prepared.patch as any;
      const data = await apiPatch(projectPath(`/worksheet-items/${itemId}`), patch);
      invalidateWs();
      const updated = (data as any)?.item || (data as any)?.worksheetItem || data || {};
      return { content: [{ type: "text" as const, text: toolUiText(`Updated item ${itemId}`, {
        kind: "worksheet_item.updated",
        worksheetId: updated.worksheetId ?? (patch as any).worksheetId ?? null,
        itemId,
        entityName: updated.entityName ?? (patch as any).entityName ?? null,
        category: updated.category ?? (patch as any).category ?? null,
        quantity: updated.quantity ?? (patch as any).quantity ?? null,
        uom: updated.uom ?? (patch as any).uom ?? null,
        unitCost: updated.cost ?? (patch as any).cost ?? null,
        unitPrice: updated.price ?? (patch as any).price ?? null,
        fields: Object.keys(patch),
        patch,
      }) }] };
    }
  );

  // ── deleteWorksheetItem ───────────────────────────────────
  server.tool(
    "deleteWorksheetItem",
    "Delete a line item from a worksheet.",
    { itemId: z.string() },
    async ({ itemId }) => {
      await apiDelete(projectPath(`/worksheet-items/${itemId}`));
      invalidateWs();
      return { content: [{ type: "text" as const, text: `Deleted item ${itemId}` }] };
    }
  );

  // ── getLineDerivation ─────────────────────────────────────
  server.tool(
    "getLineDerivation",
    [
      "Read the persisted derivation ledger for one worksheet row: the formula, every input with its source (viewId, claimId, document text, rate item, labour unit, assumption, user answer), the result, its status (draft | verified | reviewed | stale), and the full version/invalidation history.",
      "Use this to answer 'how did you get this number?'. Answer FROM the trace. If the row has no derivation, say so and re-derive with evidence instead of reconstructing from memory.",
    ].join(" "),
    { itemId: z.string().describe("Worksheet item ID") },
    async ({ itemId }) => {
      try {
        const data = await apiGet<any>(`/api/estimate/${getProjectId()}/items/${encodeURIComponent(itemId)}/derivation`);
        const derivation = data?.derivation ?? null;
        const guidance = derivation
          ? derivation.status === "stale"
            ? "This derivation is STALE: an input or the row itself changed after it was recorded (see invalidatedBy / history). Re-derive before quoting the number."
            : "Answer from this trace: quote the formula, each input value with its source ref, and the result."
          : "No derivation is recorded for this row. Do not reconstruct a rationale from memory; say the basis is unrecorded, then re-derive it with evidence (readDrawingTile viewIds, document text, rate/labour ids) and save it via updateWorksheetItem.derivation.";
        return { content: [{ type: "text" as const, text: JSON.stringify({ ...data, guidance }, null, 2) }] };
      } catch (error) {
        const message = (error as Error)?.message ?? String(error);
        return { content: [{ type: "text" as const, text: `Could not read derivation for ${itemId}: ${message}` }], isError: true };
      }
    }
  );

  // ── batchEditWorksheetItems ───────────────────────────────
  server.tool(
    "batchEditWorksheetItems",
    [
      "Create, update, and delete several worksheet lines in ONE atomic call.",
      "Every operation gets the same integrity checks as createWorksheetItem / updateWorksheetItem (cited ids exist, derivation arithmetic, explicit units, category/rate config) before anything is sent; if any operation fails, the whole batch is rejected with every problem listed and nothing is applied.",
      "The server then applies all operations in one database transaction; a server-side failure rolls back the entire batch.",
      "Use it to add a worksheet's rows together, or to apply a correction that touches several dependent rows at once. Max 100 operations.",
      'Exact shapes (worksheetId sits beside item, not inside it; there is no "type" or "data" key): {"operations":[{"op":"create","worksheetId":"worksheet-…","item":{"category":"Labour","entityName":"…","quantity":1,"uom":"HR","evidenceBasis":{…}}},{"op":"update","itemId":"li-…","patch":{"quantity":5}},{"op":"delete","itemId":"li-…"}]}.',
    ].join(" "),
    {
      operations: z.array(z.discriminatedUnion("op", [
        z.object({ op: z.literal("create"), ref: z.string().optional().describe("Your label for this operation, echoed in results/problems."), worksheetId: z.string(), item: z.object(createWorksheetItemShape).omit({ worksheetId: true }) }),
        z.object({ op: z.literal("update"), ref: z.string().optional(), itemId: z.string(), patch: z.object(updateWorksheetItemShape).omit({ itemId: true }) }),
        z.object({ op: z.literal("delete"), ref: z.string().optional(), itemId: z.string() }),
      ])).min(1).max(100),
    },
    async ({ operations }) => {
      const prepared: Array<Record<string, unknown>> = [];
      const problems = await collectBatchOperationProblems(operations, async (operation) => {
        if (operation.op === "create") {
          const result = await prepareCreateWorksheetItem({ ...operation.item, worksheetId: operation.worksheetId });
          if ("error" in result) return result.error;
          prepared.push({ op: "create", ref: operation.ref, worksheetId: result.worksheetId, item: result.body });
          return null;
        }
        if (operation.op === "update") {
          const { catalogItemId, ...patch } = operation.patch as Record<string, any>;
          const result = await prepareUpdateWorksheetItem(operation.itemId, catalogItemId, patch);
          if ("error" in result) return result.error;
          prepared.push({ op: "update", ref: operation.ref, itemId: operation.itemId, patch: result.patch });
          return null;
        }
        prepared.push({ op: "delete", ref: operation.ref, itemId: operation.itemId });
        return null;
      });
      if (problems.length > 0) {
        return { content: [{ type: "text" as const, text: JSON.stringify({
          applied: 0,
          rejected: operations.length,
          message: `${problems.length} of ${operations.length} operations failed validation; nothing was applied. Fix every listed problem and resend the whole batch.`,
          problems,
        }, null, 2) }], isError: true };
      }
      try {
        const data = await apiPost<any>(projectPath("/worksheet-items/batch"), { operations: prepared });
        invalidateWs();
        const results = asArray(data?.results).map(asRecord);
        return { content: [{ type: "text" as const, text: toolUiText(`Applied ${results.length} worksheet operations atomically.`, {
          kind: "worksheet_items.batch_applied",
          applied: results.length,
          results: results.map((entry) => ({ index: entry.index, ref: entry.ref ?? null, op: entry.op, itemId: entry.itemId })),
          estimateTotals: data?.estimateTotals ?? null,
        }) }] };
      } catch (error) {
        const message = (error as Error)?.message ?? String(error);
        return { content: [{ type: "text" as const, text: `Batch rolled back; nothing was applied. ${message}` }], isError: true };
      }
    }
  );

  // ── updateQuote ───────────────────────────────────────────
  server.tool(
    "updateQuote",
    "Update the quote metadata and save the customer-facing front-of-quote introduction in Setup → General → Description / Scope of Work. Write a substantive paragraph for a small job, multiple paragraphs for larger work, and up to about a page for a complex project, grounded in the saved estimate and agreed commercial scope. Replace seeded placeholders; preserve substantive human wording. The description supports HTML, or plain text with newlines auto-converted to paragraphs. Read getWorkspace.revision.description to verify it was saved. Use updateRevision.scratchpad for internal estimator notes or scratch work.",
    {
      projectName: z.string().optional(),
      clientName: z.string().optional(),
      clientEmail: z.string().optional(),
      projectAddress: z.string().optional(),
      notes: z.string().optional().describe("Customer-facing estimate notes that may appear in quote/PDF output. Do not put internal reasoning, TODOs, or private estimator scratch work here."),
      description: z.string().optional().describe("Customer-facing quote introduction / scope narrative saved to revision.description, shown in Setup → General and the quote PDF. Explain included work, deliverables, responsibilities and material qualifications in paragraphs proportional to project complexity; not a one-line title, TBA, or unassigned-client placeholder. Plain text is auto-converted to HTML, or supply <p> paragraphs directly."),
    },
    async (input) => {
      // Convert plain text description to HTML if it doesn't contain HTML tags
      if (input.description && !/<[a-z][\s\S]*>/i.test(input.description)) {
        input.description = plainTextToHtml(input.description);
      }

      // Update project-level fields (name, client, address)
      const projectFields: Record<string, unknown> = {};
      if (input.projectName) projectFields.projectName = input.projectName;
      if (input.clientName) projectFields.clientName = input.clientName;
      if (input.clientEmail) projectFields.clientEmail = input.clientEmail;
      if (input.projectAddress) projectFields.projectAddress = input.projectAddress;

      // Narrative fields belong only to this revision. The legacy project route
      // chooses the first project quote, which may be a different quote.
      const revisionFields: Record<string, unknown> = {};
      if (input.projectName) revisionFields.title = input.projectName;
      if (input.description) revisionFields.description = input.description;
      if (input.notes) revisionFields.notes = input.notes;

      const hasRevisionFields = Object.keys(revisionFields).length > 0;
      const revisionId = hasRevisionFields ? await resolveRevisionId() : undefined;
      if (hasRevisionFields && !revisionId) {
        return { content: [{ type: "text" as const, text: "Error: Could not determine current revision ID; quote description and notes were not saved." }], isError: true };
      }

      invalidateWs();
      if (Object.keys(projectFields).length > 0) {
        await apiPatch(projectPath(""), projectFields);
      }
      if (hasRevisionFields) {
        await apiPatch(projectPath(`/revisions/${revisionId}`), revisionFields);
      }

      invalidateWs();
      return { content: [{ type: "text" as const, text: toolUiText("Quote updated", {
        kind: "quote.updated",
        fields: Object.keys(input),
        projectName: input.projectName ?? null,
        clientName: input.clientName ?? null,
        descriptionUpdated: Boolean(input.description),
        notesUpdated: Boolean(input.notes),
      }) }] };
    }
  );

  // ── createCondition ───────────────────────────────────────
  server.tool(
    "createCondition",
    "Add a condition to the quote — exclusions, inclusions, clarifications, assumptions, or terms.",
    {
      type: z.enum(["inclusion", "exclusion", "clarification", "assumption", "term"]),
      text: z.string().describe("Condition text"),
    },
    async ({ type, text }) => {
      await apiPost(projectPath("/conditions"), { type, value: text, sortOrder: 0 });
      return { content: [{ type: "text" as const, text: `Added ${type}: ${text.substring(0, 60)}...` }] };
    }
  );

  // ── createPhase ───────────────────────────────────────────
  server.tool(
    "createPhase",
    "Create a project phase for organizing line items. Returns the phase ID — use it as phaseId when creating worksheet items.",
    { name: z.string(), description: z.string().optional() },
    async ({ name, description }) => {
      const data = await apiPost(projectPath("/phases"), { name, description });
      // Extract the newly created phase ID from the workspace response
      const phases = (data as any)?.workspace?.phases ?? [];
      const created = phases.find((p: any) => p.name === name);
      const phaseId = created?.id ?? "unknown";
      invalidateWs();
      return { content: [{ type: "text" as const, text: `Created phase: ${name} (phaseId: ${phaseId})` }] };
    }
  );

  // ── createScheduleTask ──────────────────────────────────
  server.tool(
    "createScheduleTask",
    "Create a schedule task or milestone for the project Gantt chart. Link to a phase for grouping. Set startDate/endDate (ISO strings) and duration (days).",
    {
      name: z.string().describe("Task name"),
      description: z.string().optional().describe("Task description"),
      phaseId: z.string().optional().describe("Phase ID to group under"),
      taskType: z.enum(["task", "milestone"]).default("task"),
      startDate: z.string().optional().describe("Start date (ISO string, e.g. '2026-04-01')"),
      endDate: z.string().optional().describe("End date (ISO string)"),
      duration: z.coerce.number().optional().describe("Duration in days"),
      order: z.coerce.number().optional().describe("Sort order"),
    },
    async (input) => {
      await apiPost(projectPath("/schedule-tasks"), input);
      return { content: [{ type: "text" as const, text: `Created schedule task: ${input.name}` }] };
    }
  );

  // ── listScheduleTasks ─────────────────────────────────────
  server.tool(
    "listScheduleTasks",
    "List all schedule tasks and milestones for the project.",
    {},
    async () => {
      const data = await apiGet(projectPath("/schedule-tasks"));
      const tasks = (Array.isArray(data) ? data : data.tasks || []).map((t: any) => ({
        id: t.id, name: t.name, phaseId: t.phaseId, taskType: t.taskType,
        startDate: t.startDate, endDate: t.endDate, duration: t.duration, order: t.order,
      }));
      return { content: [{ type: "text" as const, text: JSON.stringify(tasks, null, 2) }] };
    }
  );

  // ── recalculateTotals ─────────────────────────────────────
  server.tool(
    "recalculateTotals",
    [
      "Recalculate all financial totals for the quote and return the authoritative figures.",
      "These are the SAME numbers finalizeEstimateStrategy validates a claimed summary against (within 2%), so quote them verbatim in that summary instead of adding up line items yourself.",
    ].join(" "),
    {},
    async () => {
      const result = await apiPost<{ computedSummary?: Record<string, unknown> | null }>(
        projectPath("/recalculate"),
        {},
      );
      // Returning only "Totals recalculated" left the caller with no way to read
      // totalHours or per-bucket labourHours, so it estimated them and finalize
      // rejected the claim.
      const summary = result?.computedSummary;
      if (!summary) {
        return { content: [{ type: "text" as const, text: "Totals recalculated (summary unavailable)" }] };
      }
      return {
        content: [{
          type: "text" as const,
          text: `Totals recalculated. Authoritative summary (use these exact values):\n${JSON.stringify(summary, null, 2)}`,
        }],
      };
    }
  );

  // ── listRateSchedules (org-level discovery) ──────────────
  server.tool(
    "listRateSchedules",
    "List available org-level rate schedules as a compact, paginated index. Use q/category filters to find the schedule to import; this tool intentionally does not dump every rate item.",
    {
      q: z.string().optional().describe("Search schedule name, description, category, or a small sample of item names."),
      category: z.string().optional().describe("Filter by schedule category/entity type, e.g. Labour or Equipment."),
      scope: z.string().default("global").describe("Rate schedule scope. Usually global for importable org schedules."),
      limit: z.coerce.number().int().positive().max(25).default(12),
      offset: z.coerce.number().int().min(0).default(0),
      includeSampleItems: z.boolean().default(false).describe("Include up to 3 item names per schedule for orientation (only applied when q or category narrows the list)."),
      includeTiers: z.boolean().default(false).describe("Include tier ids/names per schedule. Default returns tier names only; ids come with the imported schedule via listRateScheduleItems."),
    },
    async (input) => {
      const data = await apiGet(`/api/rate-schedules${input.scope ? `?scope=${encodeURIComponent(input.scope)}` : ""}`);
      const filtered = (data.schedules || data || [])
        .filter((schedule: any) => !input.category || normalizedText(schedule.category) === normalizedText(input.category))
        .filter((schedule: any) => {
          if (!input.q) return true;
          return [
            schedule.name,
            schedule.description,
            schedule.category,
            ...asArray(schedule.items).slice(0, 20).map((item: any) => `${item.name} ${item.code ?? ""}`),
          ].some((value) => matchesText(value, input.q));
        })
        .map((schedule: any) => compactScheduleSummary(schedule, {
          includeTiers: input.includeTiers ? "ids" : "names",
          sampleItemCount: input.includeSampleItems && (!!input.q || !!input.category) ? 3 : 0,
        }));
      const page = paginate(filtered, input, { defaultLimit: 12, maxLimit: 25 });
      return { content: [{ type: "text" as const, text: JSON.stringify({
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        hasMore: page.hasMore,
        nextOffset: page.nextOffset,
        omitted: page.omitted,
        schedules: page.page,
        note: "Compact index: tier names and item counts only. Call importRateSchedule with a schedule ID to import it; inspect an org schedule's items first with getRateSchedule (scheduleId + q/limit/offset). Pass includeTiers:true for tier ids.",
      }, null, 2) }] };
    }
  );

  server.tool(
    "getRateSchedule",
    "Get one org-level rate schedule with paginated item details. Use this only after listRateSchedules identifies a likely schedule.",
    {
      scheduleId: z.string().describe("Org-level rate schedule id from listRateSchedules."),
      q: z.string().optional().describe("Optional item search within this schedule."),
      limit: z.coerce.number().int().positive().max(100).default(25),
      offset: z.coerce.number().int().min(0).default(0),
      includeRates: z.boolean().optional().describe("Include rate/cost-rate maps. Default: included when q narrows or the page is <= 25 rows; omitted (with ratesOmitted count) for broad pages. Pass true to force."),
    },
    async (input) => {
      const schedule = await apiGet(`/api/rate-schedules/${encodeURIComponent(input.scheduleId)}`);
      const matchingItems = asArray((schedule as any).items)
        .filter((item: any) => rateScheduleItemMatches(item, schedule, { q: input.q }));
      const page = paginate(matchingItems, input, { defaultLimit: 25, maxLimit: 100 });
      const includeRates = shouldIncludeRates({ includeRates: input.includeRates, narrowed: !!input.q, returned: page.page.length });
      return { content: [{ type: "text" as const, text: JSON.stringify({
        schedule: compactScheduleSummary(schedule, { includeTiers: "full" }),
        items: {
          total: page.total,
          offset: page.offset,
          limit: page.limit,
          hasMore: page.hasMore,
          nextOffset: page.nextOffset,
          omitted: page.omitted,
          ratesIncluded: includeRates,
          ratesOmitted: includeRates ? 0 : page.page.length,
          rows: page.page.map((item: any) => compactRateItem(item, schedule, { includeRates })),
        },
        note: includeRates
          ? "Rates are keyed by tier name; tier ids are in schedule.tiers. Use q/offset/limit to inspect more."
          : "Broad page: rates omitted to keep the response small. Narrow with q or pass includeRates:true to see rates.",
      }, null, 2) }] };
    },
  );

  // ── importRateSchedule ───────────────────────────────────
  server.tool(
    "importRateSchedule",
    "Import a global (org-level) rate schedule into the current quote revision. This creates a revision-scoped copy with all tiers and items. Required before Labour/rate_schedule items can be created.",
    {
      globalScheduleId: z.string().optional().describe("ID of the global rate schedule to import"),
      scheduleId: z.string().optional().describe("Alias for globalScheduleId."),
    },
    async ({ globalScheduleId, scheduleId }) => {
      const id = globalScheduleId ?? scheduleId;
      if (!id) {
        return { content: [{ type: "text" as const, text: "ERROR: importRateSchedule requires globalScheduleId. Use the id returned by listRateSchedules." }], isError: true };
      }

      const data = await apiPost(projectPath("/rate-schedules/import"), { scheduleId: id });
      invalidateWs();
      return { content: [{ type: "text" as const, text: `Imported rate schedule into current revision` }] };
    }
  );

  // ── listRateScheduleItems ──────────────────────────────
  server.tool(
    "listRateScheduleItems",
    "List imported revision rate schedule items as a compact, paginated search result. Use q/category/scheduleId to find the exact rateScheduleItemId for worksheet rows.",
    {
      category: z.string().optional().describe("Filter by schedule category (e.g. 'labour', 'equipment')"),
      q: z.string().optional().describe("Search item name, code, unit, schedule name, or category."),
      scheduleId: z.string().optional().describe("Filter by imported revision schedule id."),
      limit: z.coerce.number().int().positive().max(100).default(25),
      offset: z.coerce.number().int().min(0).default(0),
      includeRates: z.boolean().optional().describe("Include rate/cost-rate maps. Default: included when q/category/scheduleId narrows the query or the page is <= 25 rows; omitted (with ratesOmitted count) for broad pages. Pass true to force."),
    },
    async (input) => {
      const data = await apiGet(projectPath("/workspace"));
      const ws = data.workspace || data;
      const matched: Array<{ item: any; schedule: any }> = [];
      for (const rs of (ws.rateSchedules || [])) {
        if (input.scheduleId && rs.id !== input.scheduleId) continue;
        if (input.category && normalizedText(rs.category) !== normalizedText(input.category)) continue;
        for (const item of (rs.items || [])) {
          if (rateScheduleItemMatches(item, rs, input)) matched.push({ item, schedule: rs });
        }
      }
      const page = paginate(matched, input, { defaultLimit: 25, maxLimit: 100 });
      const narrowed = !!(input.q || input.scheduleId || input.category);
      const includeRates = shouldIncludeRates({ includeRates: input.includeRates, narrowed, returned: page.page.length });
      const scheduleIdsOnPage = new Set(page.page.map((entry) => String(entry.schedule.id ?? "")));
      return { content: [{ type: "text" as const, text: JSON.stringify({
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        hasMore: page.hasMore,
        nextOffset: page.nextOffset,
        omitted: page.omitted,
        ratesIncluded: includeRates,
        ratesOmitted: includeRates ? 0 : page.page.length,
        // Schedule-level fields (tier ids for tierUnits, category) once per schedule on this page.
        schedules: (ws.rateSchedules || [])
          .filter((schedule: any) => scheduleIdsOnPage.has(String(schedule.id ?? "")))
          .map((schedule: any) => compactScheduleSummary(schedule, { includeTiers: "full" })),
        items: page.page.map((entry) => compactRateItem(entry.item, entry.schedule, { includeRates })),
        note: [
          page.hasMore ? `More items exist (${page.omitted} not shown). Refine with q/category/scheduleId or pass offset=${page.nextOffset}.` : "All matching items shown.",
          includeRates ? "Rates are keyed by tier name; tier ids for tierUnits are in schedules[].tiers." : "Broad page: rates omitted. Narrow with q/category/scheduleId or pass includeRates:true.",
          "Use rateScheduleItemId plus tierUnits when creating rate-backed worksheet rows.",
        ].join(" "),
      }, null, 2) }] };
    }
  );

  // ── searchItems ───────────────────────────────────────────
  server.tool(
    "searchItems",
    "Search existing line items across all worksheets. Returns compact paginated summaries; use a focused query/category/worksheetId for detail. Each row carries `units` = the resolved labour hours / equipment duration for that row, broken down by the ratebook's own tier names. Read hours from `units.total` and `units.tiers`; `quantity` is a multiplier (commonly 1), NOT the hour count, and hours must never be inferred by dividing cost by an assumed rate.",
    {
      query: z.string().optional(),
      category: z.string().optional(),
      worksheetId: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional().describe("Maximum compact results to return. Defaults to 20."),
    },
    async ({ query, category, worksheetId, limit }) => {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (category) params.set("category", category);
      if (worksheetId) params.set("worksheetId", worksheetId);
      params.set("limit", String(limit ?? 20));
      const data = await apiGet(projectPath(`/worksheet-items/search?${params}`));
      const payload = asRecord(data);
      const items = asArray(payload.items).map((itemValue) => {
        const item = asRecord(itemValue);
        return {
          id: item.id,
          worksheetId: item.worksheetId,
          worksheetName: item.worksheetName,
          category: item.category,
          entityName: compactText(item.entityName, 90),
          description: compactText(item.description, 140),
          quantity: item.quantity,
          uom: item.uom,
          cost: item.cost,
          markup: item.markup,
          price: item.price,
          totalPrice: item.totalPrice ?? item.extendedPrice,
          rateScheduleItemId: item.rateScheduleItemId ?? null,
          itemId: item.itemId ?? null,
          laborUnitId: item.laborUnitId ?? null,
          // Authoritative resolved hours/duration. `quantity` is a multiplier,
          // NOT the hour count — read hours from here, never from cost/rate.
          units: item.units ?? null,
          sourceNotes: compactText(item.sourceNotes, 220),
        };
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          totalMatches: payload.totalMatches ?? items.length,
          returned: items.length,
          query: query || null,
          category: category || null,
          worksheetId: worksheetId || null,
          items,
          note: (payload.totalMatches ?? items.length) > items.length
            ? "More matches exist. Re-run with a focused query, category, or worksheetId."
            : undefined,
        }, null, 2) }],
      };
    }
  );

  // ═══════════════════════════════════════════════════════════
  // ESTIMATE FACTORS — productivity, weather, access, conditions
  // ═══════════════════════════════════════════════════════════

  const factorImpactSchema = z.enum(["labor_hours", "resource_units", "direct_cost", "sell_price"]);
  const factorConfidenceSchema = z.enum(["high", "medium", "low"]);
  const factorSourceTypeSchema = z.enum(["library", "knowledge", "labor_unit", "project_condition", "condition_difficulty", "neca_difficulty", "custom", "agent"]);
  const factorApplicationScopeSchema = z.enum(["global", "line", "both"]);
  const factorFormulaTypeSchema = z.enum(["fixed_multiplier", "per_unit_scale", "condition_score", "temperature_productivity", "neca_condition_score", "extended_duration"]);
  const factorScopeSchema = z.object({
    mode: z.enum(["all", "line", "category", "phase", "worksheet", "classification", "labor_unit", "cost_code", "text"]).optional(),
    worksheetItemIds: z.array(z.string()).optional(),
    categoryIds: z.array(z.string()).optional(),
    categoryNames: z.array(z.string()).optional(),
    analyticsBuckets: z.array(z.string()).optional(),
    phaseIds: z.array(z.string()).optional(),
    worksheetIds: z.array(z.string()).optional(),
    classificationCodes: z.array(z.string()).optional(),
    laborUnitIds: z.array(z.string()).optional(),
    costCodes: z.array(z.string()).optional(),
    text: z.array(z.string()).optional(),
  }).passthrough();

  server.tool(
    "listEstimateFactorLibrary",
    "Search a compact index of built-in and organization estimate factors. Use this after reading knowledge books, labor units, datasets, and project documents to seed weather, access, safety, schedule, method, condition, escalation, or productivity multipliers. The agent decides whether a factor is relevant and whether it belongs globally/scoped or on specific line items. This returns compact rows only; do not expect the full library payload.",
    {
      q: z.string().optional().describe("Search terms such as winter, access, overtime, piping, productivity, weather, escalation, safety."),
      category: z.string().optional().describe("Optional category filter, e.g. Productivity, Weather, Access, Schedule."),
      impact: factorImpactSchema.optional(),
      applicationScope: factorApplicationScopeSchema.optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    },
    async ({ q, category, impact, applicationScope, limit }) => {
      const data = await apiGet(projectPath("/factors/library"));
      const entries = asArray(data).map(asRecord);
      const filtered = entries.filter((entry) => {
        if (category && normalizedText(entry.category) !== normalizedText(category)) return false;
        if (impact && String(entry.impact ?? "") !== impact) return false;
        if (applicationScope && String(entry.applicationScope ?? "") !== applicationScope) return false;
        const searchable = [
          entry.id,
          entry.name,
          entry.code,
          entry.description,
          entry.category,
          entry.impact,
          entry.appliesTo,
          entry.applicationScope,
          entry.formulaType,
          entry.confidence,
          entry.sourceType,
          entry.sourceId,
          JSON.stringify(entry.sourceRef ?? {}),
          JSON.stringify(entry.scope ?? {}),
          ...compactTags(entry.tags, 24),
        ].join(" ");
        return matchesAllTerms(searchable, q);
      });
      const factors = filtered.slice(0, limit).map((entry) => ({
        id: String(entry.id ?? ""),
        name: String(entry.name ?? ""),
        code: entry.code ? String(entry.code) : undefined,
        description: compactText(entry.description, 220),
        category: String(entry.category ?? ""),
        impact: String(entry.impact ?? ""),
        value: Number(entry.value ?? 1),
        appliesTo: String(entry.appliesTo ?? ""),
        applicationScope: String(entry.applicationScope ?? ""),
        formulaType: String(entry.formulaType ?? ""),
        confidence: String(entry.confidence ?? ""),
        sourceType: String(entry.sourceType ?? ""),
        sourceId: entry.sourceId ? String(entry.sourceId) : undefined,
        sourceRef: {
          title: compactText(asRecord(entry.sourceRef).title, 90),
          locator: compactText(asRecord(entry.sourceRef).locator, 100),
          basis: compactText(asRecord(entry.sourceRef).basis, 180),
          formula: compactText(asRecord(entry.sourceRef).formula, 140),
          fileName: compactText(asRecord(entry.sourceRef).fileName, 100),
        },
        scope: entry.scope,
        tags: compactTags(entry.tags),
      }));
      const categories = [...new Set(entries.map((entry) => String(entry.category ?? "").trim()).filter(Boolean))].sort();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            total: entries.length,
            matched: filtered.length,
            returned: factors.length,
            hasMore: filtered.length > factors.length,
            filters: { q: q ?? null, category: category ?? null, impact: impact ?? null, applicationScope: applicationScope ?? null, limit },
            categories,
            factors,
            guidance: [
              "This is a compact retrieval index. The agent decides whether a factor applies from project evidence; the library does not recommend automatically.",
              "Use createEstimateFactor with sourceRef evidence after worksheet rows exist for line-level factors, or with scope filters for global/scoped factors.",
              "If the result set is broad, search again with q/category/impact/applicationScope instead of reading the full library payload.",
            ],
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    "createEstimateFactorLibraryEntry",
    "Create a reusable organization factor library entry. Use this when a researched factor should be available on future estimates; include sourceRef evidence from books, labor units, condition score sheets, or human-approved assumptions.",
    {
      name: z.string(),
      code: z.string().optional(),
      description: z.string().optional(),
      category: z.string().default("Productivity"),
      impact: factorImpactSchema.default("labor_hours"),
      value: z.coerce.number().min(0.05).max(10).describe("Multiplier, e.g. 1.10 for +10% or 0.92 for -8%"),
      appliesTo: z.string().default("Labour"),
      applicationScope: factorApplicationScopeSchema.default("both"),
      scope: factorScopeSchema.default({ mode: "all" }),
      formulaType: factorFormulaTypeSchema.default("fixed_multiplier"),
      parameters: z.record(z.unknown()).default({}),
      confidence: factorConfidenceSchema.default("medium"),
      sourceType: factorSourceTypeSchema.default("agent"),
      sourceId: z.string().nullable().optional(),
      sourceRef: z.record(z.unknown()).default({}),
      tags: z.array(z.string()).default([]),
    },
    async (input) => {
      const data = await apiPost("/factor-library", input);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "updateEstimateFactorLibraryEntry",
    "Update an editable organization factor library entry. Factory research presets are returned by the library listing as templates; organization entries are fully editable.",
    {
      entryId: z.string(),
      name: z.string().optional(),
      code: z.string().optional(),
      description: z.string().optional(),
      category: z.string().optional(),
      impact: factorImpactSchema.optional(),
      value: z.coerce.number().min(0.05).max(10).optional(),
      appliesTo: z.string().optional(),
      applicationScope: factorApplicationScopeSchema.optional(),
      scope: factorScopeSchema.optional(),
      formulaType: factorFormulaTypeSchema.optional(),
      parameters: z.record(z.unknown()).optional(),
      confidence: factorConfidenceSchema.optional(),
      sourceType: factorSourceTypeSchema.optional(),
      sourceId: z.string().nullable().optional(),
      sourceRef: z.record(z.unknown()).optional(),
      tags: z.array(z.string()).optional(),
    },
    async ({ entryId, ...patch }) => {
      const data = await apiPatch(`/factor-library/${entryId}`, patch);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "deleteEstimateFactorLibraryEntry",
    "Delete an editable organization factor library entry.",
    { entryId: z.string() },
    async ({ entryId }) => {
      await apiDelete(`/factor-library/${entryId}`);
      return { content: [{ type: "text" as const, text: `Deleted factor library entry ${entryId}` }] };
    }
  );

  server.tool(
    "listEstimateFactors",
    "List estimate factors already applied to the current revision, including calculated target counts, target line item IDs, and value/cost/hour deltas. Use this after creating global or line-level factors to verify they affected the intended worksheet rows.",
    {},
    async () => {
      const ws = await getWs();
      const data = {
        factors: ws.estimateFactors || [],
        factorTotals: ws.estimate?.totals?.factorTotals || [],
        beforeFactors: {
          lineSubtotal: ws.estimate?.totals?.lineSubtotalBeforeFactors,
          cost: ws.estimate?.totals?.costBeforeFactors,
          hours: ws.estimate?.totals?.totalHoursBeforeFactors,
        },
        afterFactors: {
          lineSubtotal: ws.estimate?.totals?.pricingLadder?.lineSubtotal ?? ws.estimate?.totals?.subtotal,
          cost: ws.estimate?.totals?.cost,
          hours: ws.estimate?.totals?.totalHours,
        },
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "createEstimateFactor",
    `Create an estimate factor. Factors affect worksheet-derived production/cost before rollups and quote modifiers. Use sourceType/sourceRef to cite the basis: knowledge book page, labor unit, dataset, project condition evidence, library preset, or custom assumption; prefer sourceType "project_condition" for project-specific access/weather/site/method constraints. For a global/scoped factor set applicationScope="global" and scope filters such as {mode:"all"}, {mode:"category", analyticsBuckets:["labour"]}, {mode:"phase", phaseIds:[...]}, or {mode:"worksheet", worksheetIds:[...]}. For a line-level factor, first create/read worksheet items, then set applicationScope="line" and scope:{mode:"line", worksheetItemIds:[...]}. Do not bake factor effects into worksheet quantities, tierUnits, unit costs, or hand-calculated labour values when an explicit factor should carry the adjustment. value is a multiplier: 1.10 = +10%, 0.92 = -8%. After creating a factor, call recalculateTotals/listEstimateFactors/getWorkspace to verify target counts and deltas.`,
    {
      name: z.string().describe("Factor name, e.g. Winter Weather, Confined Space, Shop Prefabrication"),
      code: z.string().optional(),
      description: z.string().optional(),
      category: z.string().default("Productivity"),
      impact: factorImpactSchema.default("labor_hours"),
      value: z.coerce.number().min(0.05).max(10).describe("Multiplier, e.g. 1.10 for +10% or 0.92 for -8%"),
      active: z.boolean().default(true),
      appliesTo: z.string().default("Labour"),
      applicationScope: factorApplicationScopeSchema.default("global"),
      scope: factorScopeSchema.default({ mode: "all" }).describe("Scope filters. Global examples: {mode:'all'} or {mode:'category', analyticsBuckets:['labour']}. Line-level example: {mode:'line', worksheetItemIds:['...']}. Phase example: {mode:'phase', phaseIds:['...']}."),
      formulaType: factorFormulaTypeSchema.default("fixed_multiplier"),
      parameters: z.record(z.unknown()).default({}).describe("Formula inputs. For line factors use scope.worksheetItemIds; for condition scores use score/maxScore; for temperature use temperature, temperatureUnit, humidity."),
      confidence: factorConfidenceSchema.default("medium"),
      sourceType: factorSourceTypeSchema.default("agent"),
      sourceId: z.string().nullable().optional(),
      sourceRef: z.record(z.unknown()).default({}).describe("Evidence such as {bookId,page,quote,reasoning,presetId,laborUnitId}"),
      tags: z.array(z.string()).default([]),
    },
    async (input) => {
      const data = await apiPost(projectPath("/factors"), input);
      invalidateWs();
      const factors = Array.isArray((data as any)?.estimateFactors) ? (data as any).estimateFactors : [];
      const createdFactor = [...factors]
        .reverse()
        .find((factor: any) => factor?.name === input.name && Number(factor?.value) === Number(input.value))
        ?? null;
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            message: `Created estimate factor: ${input.name}`,
            createdFactor,
            factorCount: factors.length,
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    "updateEstimateFactor",
    "Update an estimate productivity factor. Use this to refine scope, multiplier, evidence, confidence, active state, or source references.",
    {
      factorId: z.string(),
      name: z.string().optional(),
      code: z.string().optional(),
      description: z.string().optional(),
      category: z.string().optional(),
      impact: factorImpactSchema.optional(),
      value: z.coerce.number().min(0.05).max(10).optional(),
      active: z.boolean().optional(),
      appliesTo: z.string().optional(),
      applicationScope: factorApplicationScopeSchema.optional(),
      scope: factorScopeSchema.optional(),
      formulaType: factorFormulaTypeSchema.optional(),
      parameters: z.record(z.unknown()).optional(),
      confidence: factorConfidenceSchema.optional(),
      sourceType: factorSourceTypeSchema.optional(),
      sourceId: z.string().nullable().optional(),
      sourceRef: z.record(z.unknown()).optional(),
      tags: z.array(z.string()).optional(),
    },
    async ({ factorId, ...patch }) => {
      await apiPatch(projectPath(`/factors/${factorId}`), patch);
      invalidateWs();
      return { content: [{ type: "text" as const, text: `Updated estimate factor ${factorId}` }] };
    }
  );

  server.tool(
    "deleteEstimateFactor",
    "Delete an estimate factor from the current revision.",
    { factorId: z.string() },
    async ({ factorId }) => {
      await apiDelete(projectPath(`/factors/${factorId}`));
      invalidateWs();
      return { content: [{ type: "text" as const, text: `Deleted estimate factor ${factorId}` }] };
    }
  );

/**
 * Modifier percentages are stored as a ratio (0.05 = 5%), which is what the
 * pricing engine multiplies by — the UI divides its input by 100 for exactly
 * this reason. Agents were handed a percent-shaped contract with no conversion,
 * so a 5% contingency was written as the ratio 5 and priced at 500%.
 */
function percentToRatio(percent: number | null | undefined): number | null | undefined {
  if (percent === null || percent === undefined) return percent;
  const value = Number(percent);
  return Number.isFinite(value) ? value / 100 : percent;
}

  // ═══════════════════════════════════════════════════════════
  // MODIFIERS — overhead, profit, contingency, discounts
  // ═══════════════════════════════════════════════════════════

  // ── createModifier ──────────────────────────────────────────
  server.tool(
    "createModifier",
    `Create a financial modifier on the quote — overhead, profit, contingency, discount, fuel surcharge, etc. Modifiers adjust the quote total by percentage or fixed amount. Use appliesTo to control scope (All, Labour Only, Materials Only, Equipment Only). Set show="Yes" to display on the client-facing quote, "No" to hide (distribute into line items).`,
    {
      name: z.string().describe("Modifier name, e.g. 'Overhead', '10% Contingency', 'Volume Discount'"),
      type: z.enum(["Contingency", "Surcharge", "Discount", "Other"]).default("Other").describe("Modifier type"),
      appliesTo: z.enum(["All", "Labour Only", "Materials Only", "Equipment Only"]).default("All").describe("What the modifier applies to"),
      percentage: z.coerce.number().optional().describe("Percentage adjustment as a PERCENT, not a fraction: pass 5 for 5%, 10 for 10%. Use this OR amount, not both."),
      amount: z.coerce.number().optional().describe("Fixed dollar amount. Use this OR percentage, not both."),
      show: z.enum(["Yes", "No"]).default("Yes").describe("Show on client quote ('Yes') or hide/distribute ('No')"),
    },
    async (input) => {
      const payload = { ...input, percentage: percentToRatio(input.percentage) };
      await apiPost(projectPath("/modifiers"), payload);
      const applied = input.percentage !== undefined ? ` at ${input.percentage}%` : "";
      return { content: [{ type: "text" as const, text: `Created modifier: ${input.name}${applied}` }] };
    }
  );

  // ── updateModifier ──────────────────────────────────────────
  server.tool(
    "updateModifier",
    "Update an existing modifier. Only provided fields are changed.",
    {
      modifierId: z.string().describe("Modifier ID"),
      name: z.string().optional(),
      type: z.enum(["Contingency", "Surcharge", "Discount", "Other"]).optional(),
      appliesTo: z.enum(["All", "Labour Only", "Materials Only", "Equipment Only"]).optional(),
      percentage: z.coerce.number().nullable().optional().describe("New percentage as a PERCENT, not a fraction: pass 5 for 5%. Set to null to clear."),
      amount: z.coerce.number().nullable().optional().describe("Set to null to clear amount"),
      show: z.enum(["Yes", "No"]).optional(),
    },
    async ({ modifierId, ...patch }) => {
      const payload = "percentage" in patch ? { ...patch, percentage: percentToRatio(patch.percentage) } : patch;
      await apiPatch(projectPath(`/modifiers/${modifierId}`), payload);
      return { content: [{ type: "text" as const, text: `Updated modifier ${modifierId}` }] };
    }
  );

  // ── deleteModifier ──────────────────────────────────────────
  server.tool(
    "deleteModifier",
    "Delete a modifier from the quote.",
    { modifierId: z.string().describe("Modifier ID") },
    async ({ modifierId }) => {
      await apiDelete(projectPath(`/modifiers/${modifierId}`));
      return { content: [{ type: "text" as const, text: `Deleted modifier ${modifierId}` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════
  // ADDITIONAL LINE ITEMS (ALIs) — options, standalone items, custom totals
  // ═══════════════════════════════════════════════════════════

  // ── createALI ───────────────────────────────────────────────
  server.tool(
    "createALI",
    `Create an additional line item (ALI) — items outside worksheets like options, bonds, permits, or allowances. Types:
- OptionStandalone: a priced option the client can accept/decline (excluded from base total)
- OptionAdditional: an add-on option (adds to base total if accepted)
- LineItemAdditional: extra cost added to the base total
- LineItemStandalone: standalone item not in any worksheet
- CustomTotal: override or custom total line`,
    {
      name: z.string().describe("ALI name, e.g. 'Performance Bond', 'Option: Expedited Schedule'"),
      type: z.enum(["OptionStandalone", "OptionAdditional", "LineItemAdditional", "LineItemStandalone", "CustomTotal"]).describe("ALI type"),
      description: z.string().optional().describe("Description or notes"),
      amount: z.coerce.number().default(0).describe("Dollar amount"),
    },
    async (input) => {
      await apiPost(projectPath("/ali"), input);
      return { content: [{ type: "text" as const, text: `Created ALI: ${input.name} ($${input.amount})` }] };
    }
  );

  // ── updateALI ───────────────────────────────────────────────
  server.tool(
    "updateALI",
    "Update an existing additional line item. Only provided fields are changed.",
    {
      aliId: z.string().describe("ALI ID"),
      name: z.string().optional(),
      type: z.enum(["OptionStandalone", "OptionAdditional", "LineItemAdditional", "LineItemStandalone", "CustomTotal"]).optional(),
      description: z.string().optional(),
      amount: z.coerce.number().optional(),
    },
    async ({ aliId, ...patch }) => {
      await apiPatch(projectPath(`/ali/${aliId}`), patch);
      return { content: [{ type: "text" as const, text: `Updated ALI ${aliId}` }] };
    }
  );

  // ── deleteALI ───────────────────────────────────────────────
  server.tool(
    "deleteALI",
    "Delete an additional line item from the quote.",
    { aliId: z.string().describe("ALI ID") },
    async ({ aliId }) => {
      await apiDelete(projectPath(`/ali/${aliId}`));
      return { content: [{ type: "text" as const, text: `Deleted ALI ${aliId}` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════
  // REPORT SECTIONS — cover letter, scope narrative, schedule
  // ═══════════════════════════════════════════════════════════

  // ── createReportSection ─────────────────────────────────────
  server.tool(
    "createReportSection",
    `Create a report section for the quote PDF. Sections appear in the generated PDF document in order. Common types: cover_letter, scope, methodology, schedule, safety, assumptions, team. Content supports markdown.`,
    {
      sectionType: z.string().default("custom").describe("Section type: cover_letter, scope, methodology, schedule, safety, assumptions, team, custom"),
      title: z.string().describe("Section heading, e.g. 'Scope of Work', 'Project Schedule'"),
      content: z.string().describe("Section body text (markdown supported)"),
      order: z.coerce.number().optional().describe("Sort order (lower = earlier in PDF)"),
    },
    async (input) => {
      await apiPost(projectPath("/report-sections"), input);
      return { content: [{ type: "text" as const, text: `Created report section: ${input.title}` }] };
    }
  );

  // ── updateReportSection ─────────────────────────────────────
  server.tool(
    "updateReportSection",
    "Update a report section. Only provided fields are changed.",
    {
      sectionId: z.string().describe("Report section ID"),
      sectionType: z.string().optional(),
      title: z.string().optional(),
      content: z.string().optional(),
      order: z.coerce.number().optional(),
    },
    async ({ sectionId, ...patch }) => {
      await apiPatch(projectPath(`/report-sections/${sectionId}`), patch);
      return { content: [{ type: "text" as const, text: `Updated report section ${sectionId}` }] };
    }
  );

  // ── deleteReportSection ─────────────────────────────────────
  server.tool(
    "deleteReportSection",
    "Delete a report section from the quote.",
    { sectionId: z.string().describe("Report section ID") },
    async ({ sectionId }) => {
      await apiDelete(projectPath(`/report-sections/${sectionId}`));
      return { content: [{ type: "text" as const, text: `Deleted report section ${sectionId}` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════
  // BREAKOUT STYLE & REVISION SETTINGS
  // ═══════════════════════════════════════════════════════════

  // ── updateRevision ──────────────────────────────────────────
  server.tool(
    "updateRevision",
    `Update revision-level settings — breakout style, dates, status, quote type, print options, customer-facing notes, internal scratchpad, and more. Use this to configure how the quote is presented to the client.`,
    {
      breakoutStyle: z.enum(["grand_total", "category", "phase", "phase_detail"]).optional()
        .describe("How costs are organized on the quote: grand_total (lump sum), category (by material/labour/etc), phase (by project phase), phase_detail (phases with category breakdown)"),
      status: z.enum(["Open", "Pending", "Awarded", "DidNotGet", "Declined", "Cancelled", "Closed", "Other"]).optional(),
      type: z.enum(["Firm", "Budget", "BudgetDNE"]).optional().describe("Quote type: Firm (binding), Budget (estimate), BudgetDNE (do not exceed)"),
      title: z.string().optional().describe("Revision title"),
      description: z.string().optional().describe("Customer-facing front-of-quote scope narrative for Setup → General → Description / Scope of Work. Use substantive paragraphs scaled to project complexity; HTML or plain text with blank lines. This is separate from leadLetter and internal scratchpad."),
      notes: z.string().optional().describe("Customer-facing estimate notes that may appear in quote/PDF output."),
      scratchpad: z.string().optional().describe("Internal estimator/agent notes and scratch work. Not customer-facing."),
      defaultMarkup: z.coerce.number().optional().describe("Default markup percentage for new items"),
      dateQuote: z.string().nullable().optional().describe("Quote date (ISO string)"),
      dateDue: z.string().nullable().optional().describe("Due date (ISO string)"),
      dateWalkdown: z.string().nullable().optional().describe("Walkdown date (ISO string)"),
      dateWorkStart: z.string().nullable().optional().describe("Work start date (ISO string)"),
      dateWorkEnd: z.string().nullable().optional().describe("Work end date (ISO string)"),
      dateEstimatedShip: z.string().nullable().optional().describe("Estimated ship date (ISO string)"),
      shippingMethod: z.string().optional(),
      shippingTerms: z.string().optional(),
      leadLetter: z.string().optional().describe("Cover letter / lead-in text for the quote"),
      grandTotal: z.coerce.number().optional().describe("Manual grand total"),
      printEmptyNotesColumn: z.boolean().optional(),
      printPhaseTotalOnly: z.boolean().optional().describe("Show only phase totals, hide individual items"),
    },
    async (input) => {
      const revisionId = await resolveRevisionId();
      if (!revisionId) {
        return { content: [{ type: "text" as const, text: "Error: Could not determine current revision ID" }], isError: true };
      }
      if (input.description && !/<[a-z][\s\S]*>/i.test(input.description)) {
        input.description = plainTextToHtml(input.description);
      }
      invalidateWs();
      await apiPatch(projectPath(`/revisions/${revisionId}`), input);
      const updated: string[] = Object.keys(input).filter(k => (input as any)[k] !== undefined);
      return { content: [{ type: "text" as const, text: `Updated revision: ${updated.join(", ")}` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════
  // PDF GENERATION
  // ═══════════════════════════════════════════════════════════

  // ── generateQuotePdf ────────────────────────────────────────
  server.tool(
    "generateQuotePdf",
    `Generate the quote PDF and return a download URL. Uses saved PDF preferences for layout. Template types:
- main: Full client-facing quote with cover letter, breakout, conditions
- backup: Detailed backup/internal version with all line items
- sitecopy: Simplified site copy for field use
- closeout: Closeout/as-built version
- schedule: Project schedule/Gantt chart PDF`,
    {
      templateType: z.enum(["main", "backup", "sitecopy", "closeout", "schedule"]).default("main")
        .describe("PDF template to generate"),
    },
    async ({ templateType }) => {
      // Build URL with saved preferences
      let url = projectPath(`/pdf/${templateType}`);
      try {
        const prefData = await apiGet(projectPath("/pdf-preferences"));
        const prefs = prefData.pdfPreferences ?? {};
        if (Object.keys(prefs).length > 0) {
          url += `?layout=${encodeURIComponent(JSON.stringify(prefs))}`;
        }
      } catch { /* use defaults */ }
      return { content: [{ type: "text" as const, text: `PDF ready for download at: ${url}\n\nThe quote PDF has been generated using the "${templateType}" template with saved layout preferences. The user can download it from the application.` }] };
    }
  );

  // ── getPdfPreferences ──────────────────────────────────────
  server.tool(
    "getPdfPreferences",
    "Get the saved PDF layout preferences for this quote — sections, branding, page setup, template, and custom sections.",
    {},
    async () => {
      const data = await apiGet(projectPath("/pdf-preferences"));
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── updatePdfPreferences ───────────────────────────────────
  server.tool(
    "updatePdfPreferences",
    `Update PDF layout preferences for this quote. Supports partial updates. Available keys:
- sections: { coverPage, scopeOfWork, leadLetter, lineItems, phases, modifiers, conditions, hoursSummary, labourSummary, notes, reportSections } (all boolean)
- sectionOrder: array of section keys controlling display order
- lineItemOptions: { showCostColumn, showMarkupColumn, groupBy: none/phase/worksheet }
- branding: { accentColor: hex, headerBgColor: hex, fontFamily: sans/serif/mono }
- pageSetup: { orientation: portrait/landscape, pageSize: letter/a4/legal }
- coverPageOptions: { companyName, tagline, logoUrl }
- headerFooter: { showHeader, showFooter, headerText, footerText, showPageNumbers }
- customSections: array of { id, title, content, order }
- activeTemplate: standard/detailed/summary/client`,
    {
      sections: z.record(z.boolean()).optional().describe("Toggle sections on/off"),
      sectionOrder: z.array(z.string()).optional().describe("Section display order"),
      lineItemOptions: z.object({
        showCostColumn: z.boolean().optional(),
        showMarkupColumn: z.boolean().optional(),
        groupBy: z.enum(["none", "phase", "worksheet"]).optional(),
      }).optional(),
      branding: z.object({
        accentColor: z.string().optional(),
        headerBgColor: z.string().optional(),
        fontFamily: z.enum(["sans", "serif", "mono"]).optional(),
      }).optional(),
      pageSetup: z.object({
        orientation: z.enum(["portrait", "landscape"]).optional(),
        pageSize: z.enum(["letter", "a4", "legal"]).optional(),
      }).optional(),
      coverPageOptions: z.object({
        companyName: z.string().optional(),
        tagline: z.string().optional(),
        logoUrl: z.string().optional(),
      }).optional(),
      headerFooter: z.object({
        showHeader: z.boolean().optional(),
        showFooter: z.boolean().optional(),
        headerText: z.string().optional(),
        footerText: z.string().optional(),
        showPageNumbers: z.boolean().optional(),
      }).optional(),
      activeTemplate: z.enum(["standard", "detailed", "summary", "client"]).optional(),
    },
    async (input) => {
      // Fetch existing preferences and deep merge
      let current: any = {};
      try {
        const existing = await apiGet(projectPath("/pdf-preferences"));
        current = existing.pdfPreferences ?? {};
      } catch { /* start fresh */ }

      const merged = { ...current };
      if (input.sections) merged.sections = { ...(current.sections ?? {}), ...input.sections };
      if (input.sectionOrder) merged.sectionOrder = input.sectionOrder;
      if (input.lineItemOptions) merged.lineItemOptions = { ...(current.lineItemOptions ?? {}), ...input.lineItemOptions };
      if (input.branding) merged.branding = { ...(current.branding ?? {}), ...input.branding };
      if (input.pageSetup) merged.pageSetup = { ...(current.pageSetup ?? {}), ...input.pageSetup };
      if (input.coverPageOptions) merged.coverPageOptions = { ...(current.coverPageOptions ?? {}), ...input.coverPageOptions };
      if (input.headerFooter) merged.headerFooter = { ...(current.headerFooter ?? {}), ...input.headerFooter };
      if (input.activeTemplate) merged.activeTemplate = input.activeTemplate;

      await apiPatch(projectPath("/pdf-preferences"), merged);
      const updated = Object.keys(input).filter(k => (input as any)[k] !== undefined);
      return { content: [{ type: "text" as const, text: `PDF preferences updated: ${updated.join(", ")}` }] };
    }
  );

  // ── applySummaryPreset ──────────────────────────────────────
  server.tool(
    "applySummaryPreset",
    "Apply a summary preset to configure quote breakout. Presets: quick_total (single total), by_category (per category), by_phase (per phase), by_worksheet (per worksheet), by_masterformat_division, by_uniformat_division, by_omniclass_division, by_uniclass_division, by_din276_division, by_nrm_division, by_icms_division, by_cost_code, phase_x_category (phases with category detail), custom (empty). After applying, rows can be individually customized.",
    {
      preset: z.enum(["quick_total", "by_category", "by_phase", "by_worksheet", "by_masterformat_division", "by_uniformat_division", "by_omniclass_division", "by_uniclass_division", "by_din276_division", "by_nrm_division", "by_icms_division", "by_cost_code", "phase_x_category", "custom"]).describe("Preset name"),
    },
    async ({ preset }) => {
      await apiPost(projectPath("/summary-rows/apply-preset"), { preset });
      return { content: [{ type: "text" as const, text: toolUiText(`Applied summary preset: ${preset}`, {
        kind: "summary_preset.applied",
        preset,
      }) }] };
    }
  );

  // ── createSummaryRow ────────────────────────────────────────
  // Mirrors the API's summary-row contract exactly. The previous schema
  // offered row types the API rejects and value fields it silently drops, so
  // every call either 400'd or created an empty row.
  server.tool(
    "createSummaryRow",
    "Add a row to the quote summary. A row either aggregates a source (category, phase, worksheet, classification, adjustment) or is structural (heading, separator, subtotal). Values come from the aggregated source, not from this call.",
    {
      type: z.enum(["category", "phase", "worksheet", "classification", "adjustment", "heading", "separator", "subtotal"]).describe("Row type"),
      label: z.string().describe("Display label"),
      order: z.coerce.number().int().optional().describe("Position in the summary"),
      visible: z.boolean().optional().describe("Visible on PDF (default true)"),
      style: z.enum(["normal", "bold", "indent", "highlight"]).optional().describe("Display style"),
      sourceCategoryId: z.string().optional().describe("For type=category: EntityCategory id to aggregate"),
      sourcePhaseId: z.string().optional().describe("For type=phase: phase id to aggregate"),
      sourceWorksheetId: z.string().optional().describe("For type=worksheet: worksheet id to aggregate"),
      sourceClassificationId: z.string().optional().describe("For type=classification: classification id to aggregate"),
      sourceAdjustmentId: z.string().optional().describe("For type=adjustment: adjustment id to show"),
    },
    async (input) => {
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input)) {
        if (v !== undefined) body[k] = v;
      }
      await apiPost(projectPath("/summary-rows"), body);
      return { content: [{ type: "text" as const, text: `Created summary row: ${input.label}` }] };
    }
  );

  // ── updateSummaryRow ────────────────────────────────────────
  server.tool(
    "updateSummaryRow",
    "Update an existing summary row. Only provided fields are changed.",
    {
      rowId: z.string().describe("Summary row ID"),
      label: z.string().optional().describe("New label"),
      order: z.coerce.number().int().optional().describe("New position in the summary"),
      visible: z.boolean().optional().describe("Visible on PDF"),
      style: z.enum(["normal", "bold", "indent", "highlight"]).optional().describe("Display style"),
    },
    async (input) => {
      const { rowId, ...patch } = input;
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) body[k] = v;
      }
      await apiPatch(projectPath(`/summary-rows/${rowId}`), body);
      return { content: [{ type: "text" as const, text: "Updated summary row" }] };
    }
  );

  // ── deleteSummaryRow ────────────────────────────────────────
  server.tool(
    "deleteSummaryRow",
    "Delete a summary row from the quote.",
    {
      rowId: z.string().describe("Summary row ID to delete"),
    },
    async ({ rowId }) => {
      await apiDelete(projectPath(`/summary-rows/${rowId}`));
      return { content: [{ type: "text" as const, text: "Deleted summary row" }] };
    }
  );
}
