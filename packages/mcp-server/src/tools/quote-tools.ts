import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, apiPatch, apiDelete, projectPath, getRevisionId } from "../api-client.js";

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

function collectVisualToolEvidence(ws: any) {
  const evidence = {
    renderedPages: 0,
    zoomedRegions: 0,
    symbolScans: 0,
    imageSymbolScans: 0,
    renderedPageCalls: [] as Array<{ documentId: string; pageNumber: number }>,
    zoomRegionCalls: [] as Array<{
      documentId: string;
      pageNumber: number;
      region: Record<string, any>;
    }>,
  };

  for (const run of asArray(ws.aiRuns)) {
    const events = asArray(asRecord(run.output).events);
    for (const event of events) {
      if (!event || (event.type !== "tool_call" && event.type !== "tool")) continue;
      const data = asRecord(event.data);
      const toolId = normalizedToolId(data.toolId ?? event.toolId);
      const input = asRecord(data.input ?? event.input);
      if (toolId === "renderDrawingPage") {
        evidence.renderedPages += 1;
        const documentId = String(input.documentId ?? "").trim();
        const pageNumber = Number(input.pageNumber);
        if (documentId && Number.isFinite(pageNumber)) {
          evidence.renderedPageCalls.push({ documentId, pageNumber });
        }
      }
      if (toolId === "zoomDrawingRegion") {
        evidence.zoomedRegions += 1;
        const documentId = String(input.documentId ?? "").trim();
        const pageNumber = Number(input.pageNumber);
        const region = asRecord(input.region);
        if (documentId && Number.isFinite(pageNumber) && Object.keys(region).length > 0) {
          evidence.zoomRegionCalls.push({ documentId, pageNumber, region });
        }
      }
      if (toolId === "scanDrawingSymbols") {
        evidence.symbolScans += 1;
        if (input.includeImage === true || String(input.includeImage ?? "").toLowerCase() === "true") {
          evidence.imageSymbolScans += 1;
        }
      }
    }
  }

  return evidence;
}

function evidenceDocumentIdsMatch(a: unknown, b: unknown) {
  const left = String(a ?? "").trim();
  const right = String(b ?? "").trim();
  if (!left || !right) return false;
  if (left === right) return true;

  const normalize = (value: string) => value.replace(/\.\.\.|…/g, "");
  const compactLeft = normalize(left);
  const compactRight = normalize(right);
  if (compactLeft.length >= 12 && right.startsWith(compactLeft)) return true;
  if (compactRight.length >= 12 && left.startsWith(compactRight)) return true;
  return false;
}

function visualPageEvidenceMatchesActual(
  evidence: unknown,
  actualCalls: Array<{ documentId: string; pageNumber: number }>,
) {
  const entry = asRecord(evidence);
  const pageNumber = Number(entry.pageNumber);
  if (!Number.isFinite(pageNumber)) return false;
  return actualCalls.some((call) =>
    call.pageNumber === pageNumber &&
    evidenceDocumentIdsMatch(entry.documentId, call.documentId)
  );
}

function numericRegionValue(region: Record<string, any>, key: string) {
  const value = Number(region[key]);
  return Number.isFinite(value) ? value : null;
}

function isTargetedZoomRegion(regionValue: unknown) {
  const region = asRecord(regionValue);
  const width = numericRegionValue(region, "width");
  const height = numericRegionValue(region, "height");
  const imageWidth = numericRegionValue(region, "imageWidth");
  const imageHeight = numericRegionValue(region, "imageHeight");
  if (!width || !height || width <= 0 || height <= 0) return false;
  if (!imageWidth || !imageHeight || imageWidth <= 0 || imageHeight <= 0) return true;
  const areaRatio = (width * height) / (imageWidth * imageHeight);
  return areaRatio < 0.75 && width < imageWidth * 0.95 && height < imageHeight * 0.95;
}

function regionsApproximatelyMatch(aValue: unknown, bValue: unknown) {
  const a = asRecord(aValue);
  const b = asRecord(bValue);
  const keys = ["x", "y", "width", "height"];
  return keys.every((key) => {
    const left = numericRegionValue(a, key);
    const right = numericRegionValue(b, key);
    if (left === null || right === null) return false;
    const tolerance = Math.max(8, Math.abs(right) * 0.03);
    return Math.abs(left - right) <= tolerance;
  });
}

function visualZoomEvidenceMatchesActual(
  evidence: unknown,
  actualCalls: Array<{ documentId: string; pageNumber: number; region: Record<string, any> }>,
) {
  const entry = asRecord(evidence);
  const pageNumber = Number(entry.pageNumber);
  if (!Number.isFinite(pageNumber) || !isTargetedZoomRegion(entry.region)) return false;
  return actualCalls.some((call) =>
    call.pageNumber === pageNumber &&
    evidenceDocumentIdsMatch(entry.documentId, call.documentId) &&
    isTargetedZoomRegion(call.region) &&
    regionsApproximatelyMatch(entry.region, call.region)
  );
}

function hasAuditArrayEvidence(entry: Record<string, any>, keys: string[]) {
  return keys.some((key) => asArray(entry[key]).length > 0);
}

function drawingEvidenceEngine(strategy: any) {
  return asRecord(asRecord(strategy?.summary).drawingEvidenceEngine);
}

function normalizeEvidenceClaimKey(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(number|qty|quantity|count|total|each|ea|of|the|drawing|source|visual|bom|spec|table|ocr|text|governing|alternate|older|newer|orientation|plan|sheet|shop|schedule|quote|vendor|manufacturer|revision|rev|issued|production|baseline|primary|per|as|built|actual|fabrication|detail|order|line|dated|date|model|document|doc|reference|superseded|supersedes)\b/g, " ")
    .replace(/\b(?:[a-z]+\d+[a-z0-9]*|\d+[a-z]+[a-z0-9]*)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function comparableEvidenceClaimValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const match = value.match(/-?\d[\d,]*(?:\.\d+)?/);
    if (match) {
      const parsed = Number(String(match[0]).replace(/,/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function evidenceClaimGroupKey(claim: Record<string, any>) {
  return [
    String(claim.packageId ?? claim.packageName ?? "unknown").toLowerCase(),
    normalizeEvidenceClaimKey(claim.quantityName ?? claim.claim),
    String(claim.unit ?? "").toLowerCase(),
  ].join("|");
}

const HIGH_AUTHORITY_EVIDENCE_TERMS = [
  "bill of material",
  "bill of materials",
  "bom",
  "parts list",
  "part list",
  "schedule",
  "spec sheet",
  "specification sheet",
  "accessories quantity description",
  "vendor quote",
  "vendor quotation",
  "model bom",
  "model quantity",
  "quantity table",
  "material table",
];

function hasHighAuthorityEvidenceLanguage(text: string) {
  const normalized = ` ${normalizedText(text)} `;
  return HIGH_AUTHORITY_EVIDENCE_TERMS.some((term) => normalized.includes(` ${term} `));
}

function isHighAuthorityEvidenceClaim(claim: Record<string, any>) {
  const method = normalizedText(claim.method);
  const evidenceText = evidenceClaimEvidenceText(claim);
  if (method === "vendor_quote") return true;
  return hasHighAuthorityEvidenceLanguage(evidenceText);
}

function evidenceClaimEvidenceText(claim: Record<string, any>) {
  const evidenceText = asArray(claim.evidence).flatMap((entryValue) => {
    const entry = asRecord(entryValue);
    return [
      entry.result,
      entry.sourceText,
      entry.quotedText,
      entry.quote,
      entry.ocrText,
      entry.rawText,
      entry.tool,
      entry.regionType,
      entry.fileName,
      entry.documentTitle,
    ];
  });
  return normalizedText([
    claim.quantityName,
    claim.claim,
    claim.rationale,
    claim.assumption,
    claim.method,
    claim.packageName,
    ...evidenceText,
  ].join(" "));
}

function hasExplicitEvidenceOverride(entries: Array<Record<string, any>>) {
  const sourceText = normalizedText(entries.flatMap((claim) =>
    asArray(claim.evidence).flatMap((entryValue) => {
      const entry = asRecord(entryValue);
      return [entry.sourceText, entry.quotedText, entry.quote, entry.ocrText, entry.rawText];
    })
  ).join(" "));
  return [
    "supersedes",
    "superseded by",
    "replaces",
    "replaced by",
    "obsolete",
    "void",
    "addendum",
    "revision history",
    "order of precedence",
    "client confirmed",
    "vendor confirmed",
    "approved submittal",
    "change order",
    "rfi response",
    "field directive",
  ].some((term) => sourceText.includes(term));
}

function textReferencesEvidenceClaimValue(text: string, claim: Record<string, any>) {
  const value = comparableEvidenceClaimValue(claim.value);
  if (value === null) return false;
  return new RegExp(`(^|[^0-9.])${String(value).replace(".", "\\.")}([^0-9.]|$)`).test(text);
}

function resolutionSelectsHighAuthorityEvidence(entries: Array<Record<string, any>>) {
  const resolutionText = normalizedText(entries.map((claim) =>
    asRecord(claim.reconciliation).resolution ?? ""
  ).join(" "));
  if (!resolutionText) return false;

  const highAuthorityEntries = entries.filter(isHighAuthorityEvidenceClaim);
  const lowerAuthorityEntries = entries.filter((claim) => !isHighAuthorityEvidenceClaim(claim));
  const mentionsHighValue = highAuthorityEntries.some((claim) => textReferencesEvidenceClaimValue(resolutionText, claim));
  const mentionsLowerValue = lowerAuthorityEntries.some((claim) => textReferencesEvidenceClaimValue(resolutionText, claim));
  const mentionsHighAuthoritySource = [
    "bom",
    "bill of material",
    "parts list",
    "schedule",
    "spec sheet",
    "vendor quote",
    "table",
  ].some((term) => resolutionText.includes(term));
  const lowerSourceGoverns = [
    "drawing governs",
    "shop drawing governs",
    "new drawing governs",
    "newer drawing",
    "visual governs",
    "visual count governs",
    "shop drawing supersedes",
    "drawing supersedes",
    "superseded by shop drawing",
    "superseded by drawing",
  ].some((term) => resolutionText.includes(term)) ||
    [/drawing.{0,90}supersed/, /supersed.{0,90}drawing/, /as\s*built\s+drawing/].some((pattern) => pattern.test(resolutionText));

  if (lowerSourceGoverns || (mentionsLowerValue && !mentionsHighValue)) return false;
  if (mentionsHighValue && mentionsHighAuthoritySource) return true;
  return mentionsHighAuthoritySource && [
    "governing",
    "governs",
    "baseline",
    "use",
    "carry",
    "prevail",
    "selected",
  ].some((term) => resolutionText.includes(term));
}

function resolutionKeepsHighAuthorityEvidence(entries: Array<Record<string, any>>) {
  return resolutionSelectsHighAuthorityEvidence(entries);
}

function evidenceContradictionIsResolved(entries: Array<Record<string, any>>) {
  const hasCarriedAssumption = entries.some((claim) => normalizedText(asRecord(claim.reconciliation).status) === "carried_assumption");
  if (hasCarriedAssumption) {
    const hasHighAuthority = entries.some(isHighAuthorityEvidenceClaim);
    const hasLowerAuthority = entries.some((claim) => !isHighAuthorityEvidenceClaim(claim));
    if (!hasHighAuthority || !hasLowerAuthority) return true;
    return resolutionKeepsHighAuthorityEvidence(entries) || hasExplicitEvidenceOverride(entries);
  }

  const hasResolved = entries.some((claim) => normalizedText(asRecord(claim.reconciliation).status) === "resolved");
  if (!hasResolved) return false;

  const hasHighAuthority = entries.some(isHighAuthorityEvidenceClaim);
  const hasLowerAuthority = entries.some((claim) => !isHighAuthorityEvidenceClaim(claim));
  if (!hasHighAuthority || !hasLowerAuthority) return true;

  return resolutionKeepsHighAuthorityEvidence(entries) || hasExplicitEvidenceOverride(entries);
}

function detectDrawingEvidenceClaimContradictions(claimsValue: unknown) {
  const claims = asArray(claimsValue).map(asRecord);
  const groups = new Map<string, Array<Record<string, any>>>();
  for (const claim of claims) {
    const key = evidenceClaimGroupKey(claim);
    if (!normalizeEvidenceClaimKey(claim.quantityName ?? claim.claim)) continue;
    groups.set(key, [...(groups.get(key) ?? []), claim]);
  }

  const contradictions: string[] = [];
  for (const [key, claimsInGroup] of groups.entries()) {
    const values = claimsInGroup
      .map((claim) => comparableEvidenceClaimValue(claim.value))
      .filter((value): value is number => value !== null);
    const distinct = [...new Set(values)];
    if (distinct.length <= 1) continue;
    if (!evidenceContradictionIsResolved(claimsInGroup)) {
      const authorityConflict = claimsInGroup.some(isHighAuthorityEvidenceClaim) && claimsInGroup.some((claim) => !isHighAuthorityEvidenceClaim(claim));
      contradictions.push(
        authorityConflict
          ? `${claimsInGroup[0]?.quantityName ?? key}: ${distinct.join(" vs ")}. BOM/spec/schedule/vendor-table conflict needs explicit supersession/order-of-precedence evidence or high-authority table selection. A carried assumption cannot price the lower-context drawing value unless an explicit override is cited.`
          : `${claimsInGroup[0]?.quantityName ?? key}: ${distinct.join(" vs ")}`
      );
    }
  }
  return contradictions;
}

function packageMatchesClaim(entry: Record<string, any>, claim: Record<string, any>) {
  const packageKeys = [entry.packageId, entry.packageName].map(packageEvidenceKey).filter(Boolean);
  const claimKeys = [claim.packageId, claim.packageName].map(packageEvidenceKey).filter(Boolean);
  if (packageKeys.some((left) => claimKeys.some((right) => packageEvidenceKeysMatch(left, right)))) return true;
  return false;
}

function packageEvidenceKey(value: unknown) {
  return normalizedText(value)
    .split("-")
    .filter((token) => token && !["pkg", "package", "scope", "drawing", "visual", "takeoff"].includes(token))
    .join("-");
}

function packageEvidenceKeysMatch(left: string, right: string) {
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  const leftTokens = left.split("-").filter((token) => token.length >= 3);
  const rightTokens = right.split("-").filter((token) => token.length >= 3);
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;
  const shared = leftTokens.filter((token) => rightTokens.includes(token)).length;
  const required = Math.min(2, Math.min(leftTokens.length, rightTokens.length));
  return shared >= required && shared / Math.min(leftTokens.length, rightTokens.length) >= 0.67;
}

function claimHasUsableDrawingEvidence(claimValue: unknown) {
  const claim = asRecord(claimValue);
  const method = normalizedText(claim.method);
  const evidence = asArray(claim.evidence).map(asRecord);
  if (!normalizeEvidenceClaimKey(claim.quantityName ?? claim.claim)) return false;
  if (claim.value === undefined || claim.value === null || claim.value === "") return false;
  if (method === "assumption") return String(claim.assumption ?? claim.rationale ?? "").trim().length >= 20;
  if (evidence.length === 0) return false;
  if (method === "visual_count" || method === "takeoff") {
    return evidence.some((entry) =>
      (entry.regionId || Object.keys(asRecord(entry.bbox)).length > 0) &&
      String(entry.imageHash ?? "").trim().length >= 16 &&
      ["inspectdrawingregion", "zoomdrawingregion", "scandrawingsymbols"].some((name) =>
        normalizedText(entry.tool).includes(name)
      )
    );
  }
  if (method === "bom_table" || method === "drawing_table" || method === "ocr_text") {
    return evidence.some((entry) => entry.regionId || String(entry.sourceText ?? "").trim().length >= 20);
  }
  return evidence.length > 0 || String(claim.rationale ?? "").trim().length >= 20;
}

function targetMatchesDrawingDrivenPackage(entry: Record<string, any>, targetText: string, strategy: any) {
  const target = normalizedText(targetText);
  if (!target) return true;

  const packageId = normalizedText(entry.packageId);
  const packageName = normalizedText(entry.packageName);
  const packagePlan = asArray(strategy?.packagePlan).map(asRecord).find((plan) => {
    const planId = normalizedText(plan.id ?? plan.packageId);
    const planName = normalizedText(plan.name ?? plan.packageName);
    return (packageId && planId === packageId) || (packageName && planName === packageName);
  });
  const bindings = asRecord(packagePlan?.bindings);
  const candidates = [
    packageId,
    packageName,
    normalizedText(packagePlan?.name),
    ...asArray(bindings.worksheetNames).map(normalizedText),
    ...asArray(bindings.textMatchers).map(normalizedText),
  ].filter((value) => value.length >= 3);

  return candidates.some((candidate) => target.includes(candidate) || candidate.includes(target));
}

function validateDrawingEvidenceEngineForPricing(
  strategy: any,
  drawingDrivenPackages: Array<Record<string, any>>,
  targetText = "",
  evidenceBasis?: Record<string, any> | null,
) {
  if (drawingDrivenPackages.length === 0) return null;
  const claimIds = evidenceBasisClaimIds(evidenceBasis);
  const targetPackages = targetText
    ? drawingDrivenPackages.filter((entry) => targetMatchesDrawingDrivenPackage(entry, targetText, strategy))
    : drawingDrivenPackages;
  const packagesToCheck = targetPackages.length > 0 ? targetPackages : drawingDrivenPackages;

  const engine = drawingEvidenceEngine(strategy);
  const atlas = asRecord(engine.atlas);
  const claims = asArray(engine.claims).map(asRecord);
  const latestVerification = asRecord(asArray(engine.verifications)[0]);
  const unresolvedStoredContradictions = asArray(engine.contradictions)
    .map(asRecord)
    .filter((entry) => !["resolved", "carried_assumption"].includes(normalizedText(entry.status)));
  const detectedContradictions = detectDrawingEvidenceClaimContradictions(claims);

  if (Object.keys(atlas).length === 0 || Number(atlas.regionCount ?? 0) <= 0) {
    return "Drawing Evidence Engine atlas is missing. Call buildDrawingAtlas before creating worksheets/items from drawing-driven scope.";
  }

  if (claims.length === 0) {
    return "Drawing evidence ledger is empty. For each drawing-driven quantity, call searchDrawingRegions, inspectDrawingRegion, then saveDrawingEvidenceClaim before creating worksheets/items.";
  }

  if (lineEvidenceBasisRequiresDrawing(evidenceBasis)) {
    if (claimIds.length === 0) {
      return "This line is marked as drawing/takeoff quantity driven, so evidenceBasis.quantity.drawingClaimIds must name the Drawing Evidence Engine claim(s) that prove the quantity. Put labour manual, rate schedule, vendor quote, allowance model, indirect-cost model, document reference, or assumption support under evidenceBasis.pricing when those sources justify price/rate/productivity instead of quantity.";
    }
    const selectedClaims = claimIds
      .map((id) => claims.find((claim) => String(claim.claimId ?? claim.id ?? "") === id))
      .filter((claim): claim is Record<string, any> => !!claim);
    const missingClaimIds = claimIds.filter((id) => !selectedClaims.some((claim) => String(claim.claimId ?? claim.id ?? "") === id));
    if (missingClaimIds.length > 0) {
      return `Drawing evidence claim id(s) not found for this line: ${missingClaimIds.join(", ")}. Call getDrawingEvidenceLedger or saveDrawingEvidenceClaim, then retry with valid claim ids.`;
    }
    const unusable = selectedClaims.filter((claim) => !claimHasUsableDrawingEvidence(claim));
    if (unusable.length > 0) {
      return `Selected drawing evidence claim(s) are not usable for pricing: ${unusable.map((claim) => String(claim.claimId ?? claim.quantityName ?? "unknown")).join(", ")}. Repair the claim evidence first.`;
    }

    const selectedKeys = new Set(selectedClaims.map(evidenceClaimGroupKey));
    const relevantStoredContradictions = unresolvedStoredContradictions.filter((entry) => {
      const contradictionClaimIds = asArray(entry.claimIds).map((id) => String(id ?? ""));
      const contradictionKey = String(entry.key ?? "");
      return contradictionClaimIds.some((id) => claimIds.includes(id)) || selectedKeys.has(contradictionKey);
    });
    const relevantDetectedContradictions = detectDrawingEvidenceClaimContradictions(
      claims.filter((claim) => selectedKeys.has(evidenceClaimGroupKey(claim))),
    );
    if (relevantStoredContradictions.length > 0 || relevantDetectedContradictions.length > 0) {
      const stored = relevantStoredContradictions.map((entry) => String(entry.message ?? entry.quantityName ?? entry.id)).slice(0, 5);
      const detected = relevantDetectedContradictions.slice(0, 5);
      return `Selected drawing evidence has unresolved contradictions: ${[...stored, ...detected].join("; ")}. Reconcile the specific selected claim(s), choose the governing claim, or carry an explicit assumption before pricing this drawing-driven line.`;
    }

    if (!latestVerification || !latestVerification.status) {
      return "Independent drawing evidence verification has not run. Call verifyDrawingEvidenceLedger before pricing drawing-driven quantity lines.";
    }
    if (normalizedText(latestVerification.status) === "failed") {
      const verificationText = normalizedText(JSON.stringify(latestVerification));
      const selectedFailure = claimIds.some((id) => verificationText.includes(normalizedText(id)));
      if (selectedFailure) {
        return `Independent drawing evidence verification failed for a selected claim. Repair: ${asArray(latestVerification.failures).slice(0, 5).join("; ")}`;
      }
    }

    return null;
  }

  const packagesWithoutClaims = packagesToCheck.filter((entry) =>
    !claims.some((claim) => packageMatchesClaim(entry, claim) && claimHasUsableDrawingEvidence(claim)),
  );
  if (packagesWithoutClaims.length > 0) {
    const names = packagesWithoutClaims
      .slice(0, 6)
      .map((entry) => String(entry.packageId ?? entry.packageName ?? "unnamed package"))
      .join(", ");
    return `Drawing evidence ledger is missing usable claims for drawing-driven package(s): ${names}. SaveDrawingEvidenceClaim must include document/page/region/bbox/tool/result/imageHash for visual quantities, or BOM/OCR/assumption evidence for non-visual quantities.`;
  }

  if (unresolvedStoredContradictions.length > 0 || detectedContradictions.length > 0) {
    const stored = unresolvedStoredContradictions.map((entry) => String(entry.message ?? entry.quantityName ?? entry.id)).slice(0, 5);
    const detected = detectedContradictions.slice(0, 5);
    return `Drawing evidence ledger has unresolved contradictions: ${[...stored, ...detected].join("; ")}. Reconcile sources or carry an explicit assumption before creating worksheets/items.`;
  }

  if (!latestVerification || !latestVerification.status) {
    return "Independent drawing evidence verification has not run. Call verifyDrawingEvidenceLedger before creating worksheets/items from drawing-driven quantities.";
  }
  if (normalizedText(latestVerification.status) === "failed") {
    return `Independent drawing evidence verification failed. Repair: ${asArray(latestVerification.failures).slice(0, 5).join("; ")}`;
  }

  return null;
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

const DRAWING_QUANTITY_BASIS_TYPES = [
  "drawing_quantity",
  "visual_takeoff",
  "drawing_table",
  "drawing_note",
] as const;

function lineEvidenceBasisRequiresDrawing(evidenceBasis?: Record<string, any> | null) {
  const quantityBasis = asRecord(evidenceBasis?.quantity);
  const type = normalizedText(quantityBasis.type ?? evidenceBasis?.quantityType ?? evidenceBasis?.type);
  return (DRAWING_QUANTITY_BASIS_TYPES as readonly string[]).includes(type);
}

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

function collectEvidenceAxisArray(evidenceBasis: Record<string, any>, key: string) {
  return [
    ...asArray(evidenceBasis[key]),
    ...asArray(asRecord(evidenceBasis.quantity)[key]),
    ...asArray(asRecord(evidenceBasis.pricing)[key]),
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function claimIdsMentionedInLine(input: {
  evidenceBasis?: Record<string, any> | null;
  sourceNotes?: string;
  sourceEvidence?: Record<string, any>;
  targetText?: string;
}) {
  const text = [
    input.targetText,
    input.sourceNotes,
    JSON.stringify(input.evidenceBasis ?? {}),
    JSON.stringify(input.sourceEvidence ?? {}),
  ].join("\n");
  return [...new Set([...text.matchAll(/\bclaim-[0-9a-f]{12}\b/gi)].map((match) => match[0]))];
}

function looksLikeStructuredSourceRef(ref: unknown): boolean {
  if (typeof ref !== "string") return false;
  const value = ref.trim();
  if (value.length < 4) return false;
  // Accept "doc:<id>:<page>", "dataset:<id>:<row>", "book:<id>:<page>", "lu:<id>", "vendor:<id>", "uri:..."
  if (/^(doc|document|dataset|ds|book|kb|knowledge|lu|labor|vendor|invoice|quote|catalog|cat|costres|effcost|sku|standard|spec|page|sheet|cell|row|atlas|claim)[-:]/i.test(value)) return true;
  // Accept hyphenated DB ids like ds-<uuid>, lu-<uuid>, doc-<uuid>, etc.
  if (/^[a-z]{2,8}-[a-z0-9]{6,}/i.test(value)) return true;
  // Accept URIs
  if (/^https?:\/\//i.test(value)) return true;
  // Accept document filename + page/section "Foo.pdf p.12" or "Foo.xlsx Sheet 'x' row 4"
  if (/\.(pdf|xlsx|xls|csv|tsv|md|txt|docx|doc)\b/i.test(value)) return true;
  return false;
}

function structuredSourceRefCount(basis: Record<string, any>): number {
  const all = collectEvidenceAxisArray(basis, "sourceRefs");
  return all.filter(looksLikeStructuredSourceRef).length;
}

function resourceCompositionEntryCount(composition: unknown): number {
  if (!composition || typeof composition !== "object") return 0;
  const obj = composition as Record<string, unknown>;
  const resources = Array.isArray(obj.resources) ? obj.resources : [];
  return resources.length;
}

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

function compositeMaterialThreshold(): number {
  return 5000; // applies to Material/Subcontractor rows priced at >= $5K with no structured pricing link
}

function validateLineEvidenceBasisForPricing(ws: any, input: {
  evidenceBasis?: Record<string, any> | null;
  sourceNotes?: string;
  laborUnitId?: string | null;
  rateScheduleItemId?: string | null;
  sourceEvidence?: Record<string, any>;
  targetText?: string;
  categoryId?: string | null;
  category?: string | null;
  costResourceId?: string | null;
  effectiveCostId?: string | null;
  itemId?: string | null;
  resourceComposition?: Record<string, unknown> | null;
  cost?: number | null;
  price?: number | null;
  uom?: string | null;
  quantity?: number | null;
}) {
  const drawingDocs = asArray(ws.sourceDocuments).filter(isDrawingLikeSourceDocument);
  if (drawingDocs.length === 0) return null;

  const basis = asRecord(input.evidenceBasis);
  const type = normalizedText(basis.type);
  const quantityType = evidenceAxisType(basis, "quantity");
  const pricingType = evidenceAxisType(basis, "pricing");
  const declaredClaimIds = evidenceBasisClaimIds(basis);
  const mentionedClaimIds = claimIdsMentionedInLine(input);
  const missingDeclaredClaimIds = mentionedClaimIds.filter((id) => !declaredClaimIds.includes(id));
  if (!type && !quantityType && !pricingType) {
    return [
      "Line evidence basis is required because this project contains drawings.",
      "Prefer evidenceBasis.quantity.type and evidenceBasis.pricing.type so quantity provenance and pricing/rate provenance are separate.",
      "Legacy evidenceBasis.type is still accepted as a single-source shorthand. Use one of:",
      LINE_EVIDENCE_BASIS_TYPES.join(", "),
      "Use drawing_quantity/visual_takeoff/drawing_table/drawing_note in evidenceBasis.quantity only when this row's quantity is directly driven by drawing evidence and include drawingClaimIds.",
      "Use indirect, rate_schedule, knowledge_labor, vendor_quote, allowance, subcontract, equipment_rental, material_quote, document_quantity, assumption, or mixed when the row is justified by a non-drawing estimating basis.",
    ].join(" ");
  }
  for (const [label, value] of [["type", type], ["quantity.type", quantityType], ["pricing.type", pricingType]] as const) {
    if (value && !(LINE_EVIDENCE_BASIS_TYPES as readonly string[]).includes(value)) {
      return `Unsupported evidenceBasis.${label} '${String(value)}'. Use one of: ${LINE_EVIDENCE_BASIS_TYPES.join(", ")}.`;
    }
  }
  if (type && !(LINE_EVIDENCE_BASIS_TYPES as readonly string[]).includes(type)) {
    return `Unsupported evidenceBasis.type '${String(basis.type ?? "")}'. Use one of: ${LINE_EVIDENCE_BASIS_TYPES.join(", ")}.`;
  }

  if (missingDeclaredClaimIds.length > 0) {
    return `Drawing evidence claim id(s) are mentioned in line text/sourceEvidence but not attached to the quantity evidence basis: ${missingDeclaredClaimIds.join(", ")}. Put them in evidenceBasis.quantity.drawingClaimIds and set evidenceBasis.quantity.type to drawing_quantity, visual_takeoff, drawing_table, or drawing_note; use evidenceBasis.pricing for the material/rate/vendor basis.`;
  }

  if (declaredClaimIds.length > 0 && !lineEvidenceBasisRequiresDrawing(basis)) {
    return "Drawing evidence claim IDs belong to quantity provenance. Set evidenceBasis.quantity.type to drawing_quantity, visual_takeoff, drawing_table, or drawing_note and place the claim IDs in evidenceBasis.quantity.drawingClaimIds. Put material_quote, knowledge_labor, rate_schedule, subcontract, equipment_rental, or allowance under evidenceBasis.pricing when that source sets the price/rate.";
  }

  if (lineEvidenceBasisRequiresDrawing(basis)) {
    if (!pricingType || (DRAWING_QUANTITY_BASIS_TYPES as readonly string[]).includes(pricingType)) {
      return "Drawing quantity evidence proves count/measurement, not price/rate/productivity. Add evidenceBasis.pricing.type with the rate schedule, labour manual, vendor/material quote, equipment/subcontract source, allowance model, or assumption that supports the unit cost/hours.";
    }
    return null;
  }

  const notes = String(input.sourceNotes ?? "").trim();
  const quantityBasis = asRecord(basis.quantity);
  const pricingBasis = asRecord(basis.pricing);
  const rationale = [
    basis.rationale,
    quantityBasis.rationale,
    pricingBasis.rationale,
  ].map((value) => String(value ?? "").trim()).filter(Boolean).join(" ");
  const sourceRefs = collectEvidenceAxisArray(basis, "sourceRefs");
  const assumptionIds = collectEvidenceAxisArray(basis, "assumptionIds");
  const hasStructuredEvidence = Object.keys(asRecord(input.sourceEvidence)).length > 0 || sourceRefs.length > 0 || assumptionIds.length > 0;
  if (notes.length < 40 && rationale.length < 40 && !hasStructuredEvidence) {
    return "Non-drawing line items still need evidence. Provide sourceNotes, evidenceBasis.rationale, sourceRefs, assumptionIds, or sourceEvidence explaining the labour/manual/rate/vendor/allowance/indirect basis.";
  }
  if ((type === "rate_schedule" || pricingType === "rate_schedule") && !input.rateScheduleItemId) {
    return "evidenceBasis.pricing.type='rate_schedule' requires a concrete rateScheduleItemId from listRateScheduleItems/getItemConfig.";
  }
  if ((type === "knowledge_labor" || pricingType === "knowledge_labor") && !input.laborUnitId && !hasStructuredEvidence && !/knowledge|manual|page|labor|labour/i.test(notes)) {
    return "evidenceBasis.pricing.type='knowledge_labor' requires laborUnitId or source evidence/notes naming the labour manual, page, or analog used.";
  }
  if ((type === "assumption" || quantityType === "assumption" || pricingType === "assumption") && assumptionIds.length === 0 && rationale.length < 40) {
    return "evidenceBasis assumption basis requires assumptionIds from saveEstimateAssumptions or a substantive rationale.";
  }

  // Category-aware citation discipline (domain-agnostic)
  const entityType = categoryEntityType(ws, input.categoryId, input.category);
  const structuredRefs = structuredSourceRefCount(basis);
  const hasAssumptionIds = assumptionIds.length > 0;
  const compositionCount = resourceCompositionEntryCount(input.resourceComposition);
  const cost = Number.isFinite(input.cost) ? Number(input.cost) : 0;
  const price = Number.isFinite(input.price) ? Number(input.price) : 0;
  const quantity = Number.isFinite(input.quantity) ? Number(input.quantity) : 1;
  const rowDollar = Math.max(cost * Math.max(quantity, 1), price * Math.max(quantity, 1), cost, price);

  // #1: Labour rows must have laborUnitId OR structured sourceRefs
  if (entityType === "labour" || entityType === "labor") {
    const hasLaborUnit = !!input.laborUnitId;
    const hasStructuredRef = structuredRefs > 0;
    if (!hasLaborUnit && !hasStructuredRef && !hasAssumptionIds) {
      return "Labour rows require either laborUnitId (from listLaborUnits/listLaborUnitTree/getLaborUnit) OR evidenceBasis.pricing.sourceRefs containing at least one structured citation (e.g., 'ds-<id>', 'lu-<id>', 'doc-<id>:p<page>', 'kb-<id>:p<page>'), OR evidenceBasis.pricing.assumptionIds linked to a saved assumption documenting that the library was searched and no usable analog exists. Free-text sourceNotes alone is not enough.";
    }
  }

  // #1: Material / Subcontractor rows must have a structured pricing link OR equivalent
  const isMaterialish = entityType === "material" || entityType === "subcontractor" || entityType === "consumables" || entityType === "consumable" || entityType === "rental equipment" || entityType === "rental_equipment" || entityType === "equipment" || entityType === "other charges" || entityType === "allowance";
  if (isMaterialish) {
    const hasStructuredLink = !!(input.costResourceId || input.effectiveCostId || input.itemId);
    const hasStructuredRef = structuredRefs > 0;
    const hasComposition = compositionCount > 0;
    if (!hasStructuredLink && !hasStructuredRef && !hasAssumptionIds && !hasComposition) {
      return "Material/Subcontractor/Equipment/Allowance rows require either a structured pricing link (costResourceId, effectiveCostId, or itemId from searchLineItemCandidates/recommendCostSource), OR evidenceBasis.pricing.sourceRefs with at least one structured citation (vendor invoice/quote, dataset row, knowledge-book page, catalog SKU, document+page reference), OR evidenceBasis.pricing.assumptionIds linked to a saved assumption documenting the search-attempt and that vendor finalization is required, OR resourceComposition.resources populated with cited components. Free-text sourceNotes alone is not enough.";
    }

    // #3: Composite (LS / high-value) Material/Sub rows need component-level evidence
    const isLumpSum = String(input.uom ?? "").toUpperCase() === "LS";
    if ((isLumpSum || rowDollar >= compositeMaterialThreshold()) && !hasStructuredLink) {
      const hasComponentEvidence = compositionCount >= 2 || structuredRefs >= 2;
      if (!hasComponentEvidence) {
        return `Composite Material/Subcontractor rows priced at $${compositeMaterialThreshold().toLocaleString()}+ or with uom=LS need component-level evidence: either a single structured pricing link (costResourceId/effectiveCostId/itemId) OR resourceComposition.resources with 2+ cited components OR 2+ structured entries in evidenceBasis.pricing.sourceRefs (one per cost component such as pipe, fittings, flanges, fasteners, supports, etc., each citing a vendor/dataset/catalog reference). Adders/multipliers (e.g. "+30%") in description must be backed by a citation in sourceRefs, not invented.`;
      }
    }
  }

  return null;
}

function validateVisualTakeoffAuditForPricing(ws: any, strategy: any, targetText = "", evidenceBasis?: Record<string, any> | null): string | null {
  const drawingDocs = asArray(ws.sourceDocuments).filter(isDrawingLikeSourceDocument);
  if (drawingDocs.length === 0) return null;
  if (!lineEvidenceBasisRequiresDrawing(evidenceBasis)) return null;

  const scopeGraph = asRecord(strategy?.scopeGraph);
  const audit = asRecord(scopeGraph.visualTakeoffAudit);
  const evidence = collectVisualToolEvidence(ws);
  const engine = drawingEvidenceEngine(strategy);
  const hasLedgerEvidence = Object.keys(asRecord(engine.atlas)).length > 0 && asArray(engine.claims).some(claimHasUsableDrawingEvidence);
  const drawingNames = drawingDocs.slice(0, 5).map((doc: any) => doc.fileName).join("; ");
  const sampleLine = drawingNames ? ` Detected drawing PDFs include: ${drawingNames}.` : "";

  if (Object.keys(audit).length === 0) {
    return `Visual drawing takeoff audit is missing from saveEstimateScopeGraph.${sampleLine} Before creating worksheets/items, call buildDrawingAtlas, searchDrawingRegions, inspectDrawingRegion on the specific detail/symbol/table region that drives scope, saveDrawingEvidenceClaim, verifyDrawingEvidenceLedger, and re-save saveEstimateScopeGraph with visualTakeoffAudit.`;
  }

  if (!hasLedgerEvidence && evidence.renderedPages === 0) {
    return `No actual atlas/render evidence is recorded for this drawing package.${sampleLine} Build the Drawing Evidence Engine atlas or render at least one relevant drawing page, then re-save saveEstimateScopeGraph.visualTakeoffAudit before creating worksheets/items.`;
  }

  if (!hasLedgerEvidence && evidence.zoomedRegions === 0) {
    return `Full-page drawing evidence is only overview evidence. No targeted crop/region evidence is recorded yet. Inspect the specific detail, symbol, schedule, dimension, or table region that drives scope, save a drawing evidence claim, then re-save saveEstimateScopeGraph.visualTakeoffAudit before creating worksheets/items.`;
  }

  if (audit.completedBeforePricing !== true) {
    return `saveEstimateScopeGraph.visualTakeoffAudit.completedBeforePricing must be true before creating worksheets/items. Re-save the scope graph after the atlas search, targeted inspection, evidence claims, and ledger verification are complete.`;
  }

  const drawingDrivenPackages = asArray(audit.drawingDrivenPackages).filter(
    (entry: any) => entry && typeof entry === "object" && !Array.isArray(entry),
  ) as Array<Record<string, any>>;
  const notDrawingDrivenReason = String(audit.notDrawingDrivenReason ?? "").trim();

  if (drawingDrivenPackages.length === 0) {
    if (notDrawingDrivenReason.length >= 40) return null;
    return `Drawing PDFs exist, but visualTakeoffAudit has no drawingDrivenPackages and no substantive notDrawingDrivenReason. Identify the drawing-driven packages, or explain why the drawings do not drive quantity/scope, before creating worksheets/items.`;
  }

  const packagesMissingOverview = drawingDrivenPackages.filter((entry) =>
    !hasLedgerEvidence && !hasAuditArrayEvidence(entry, ["renderedPages"]),
  );
  const packagesMissingDeepEvidence = drawingDrivenPackages.filter((entry) =>
    !hasLedgerEvidence && !hasAuditArrayEvidence(entry, ["zoomEvidence"]),
  );
  const packagesMissingActualOverview = drawingDrivenPackages.filter((entry) =>
    !hasLedgerEvidence &&
    asArray(entry.renderedPages).length > 0 &&
    !asArray(entry.renderedPages).some((page) => visualPageEvidenceMatchesActual(page, evidence.renderedPageCalls)),
  );
  const packagesMissingActualZoom = drawingDrivenPackages.filter((entry) =>
    !hasLedgerEvidence &&
    asArray(entry.zoomEvidence).length > 0 &&
    !asArray(entry.zoomEvidence).some((zoom) => visualZoomEvidenceMatchesActual(zoom, evidence.zoomRegionCalls)),
  );

  if (
    packagesMissingOverview.length > 0 ||
    packagesMissingDeepEvidence.length > 0 ||
    packagesMissingActualOverview.length > 0 ||
    packagesMissingActualZoom.length > 0
  ) {
    const summarize = (entries: Array<Record<string, any>>) => entries
      .slice(0, 5)
      .map((entry) => String(entry.packageId ?? entry.packageName ?? "unnamed package"))
      .join(", ");
    const overview = packagesMissingOverview.length > 0
      ? ` Missing atlas/page evidence: ${summarize(packagesMissingOverview)}.`
      : "";
    const deep = packagesMissingDeepEvidence.length > 0
      ? ` Missing targeted crop evidence: ${summarize(packagesMissingDeepEvidence)}.`
      : "";
    const actualOverview = packagesMissingActualOverview.length > 0
      ? ` Page evidence does not match an actual atlas/render record: ${summarize(packagesMissingActualOverview)}.`
      : "";
    const actualDeep = packagesMissingActualZoom.length > 0
      ? ` Targeted crop evidence does not match an actual inspected/zoomed region, or is effectively full-page: ${summarize(packagesMissingActualZoom)}.`
      : "";
    return `visualTakeoffAudit is incomplete for drawing-driven packages.${overview}${deep}${actualOverview}${actualDeep} Re-save saveEstimateScopeGraph after recording atlas/page evidence plus targeted crop/ledger evidence for each drawing-driven package. Symbol scan/count evidence is optional and only belongs after a specific small symbol or cropped region has been identified.`;
  }

  const drawingEvidenceGate = validateDrawingEvidenceEngineForPricing(strategy, drawingDrivenPackages, targetText, evidenceBasis);
  if (drawingEvidenceGate) return drawingEvidenceGate;

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
  return {
    rateScheduleItemId: item.id,
    scheduleId: schedule.id,
    scheduleName: schedule.name,
    forCategory: schedule.category,
    name: item.name,
    code: item.code,
    unit: item.unit,
    description: compactText(item.description, 160),
    rates: options.includeRates === false ? undefined : item.rates,
    costRates: options.includeRates === false ? undefined : item.costRates,
    burden: item.burden,
    perDiem: item.perDiem,
    tierIds: scheduleTiers(schedule).map((tier) => tier.id),
  };
}

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

  // ── Tool gating — state-based prerequisite checks ───────────────────
  // Gates check actual workspace state, not session history.
  // Resumed sessions / existing quotes pass automatically if data exists.
  //
  // Chain: updateQuote → importRateSchedule → createWorksheet → createWorksheetItem

  type GateTarget = "importRateSchedule" | "createWorksheet" | "createWorksheetItem";

  async function checkGate(
    gate: GateTarget,
    targetText = "",
    lineEvidence?: {
      evidenceBasis?: Record<string, any> | null;
      sourceNotes?: string;
      laborUnitId?: string | null;
      rateScheduleItemId?: string | null;
      sourceEvidence?: Record<string, any>;
      categoryId?: string | null;
      category?: string | null;
      costResourceId?: string | null;
      effectiveCostId?: string | null;
      itemId?: string | null;
      resourceComposition?: Record<string, unknown> | null;
      cost?: number | null;
      price?: number | null;
      uom?: string | null;
      quantity?: number | null;
    },
  ): Promise<string | null> {
    const ws = await getWs();
    const project = ws.project || {};
    const revision = ws.currentRevision || {};
    const worksheets = ws.worksheets || [];
    const rateSchedules = ws.rateSchedules || [];
    const entityCategories = ws.entityCategories || [];
    const strategy = ws.estimateStrategy || null;

    // Has the agent (or user) filled in quote basics?
    const hasQuoteInfo = !!(
      (project.name && project.name !== "Untitled Project" && project.name !== "New Project")
      || revision.description
    );

    // Do any categories require rate schedules?
    const rsCats = entityCategories.filter((c: any) => c.itemSource === "rate_schedule");
    const needsRateSchedules = rsCats.length > 0;
    const hasRateSchedules = rateSchedules.length > 0;
    const hasWorksheets = worksheets.length > 0;

    // Gate 3: quote info required for all gated tools
    if (!hasQuoteInfo) {
      const action = gate === "importRateSchedule" ? "importing rate schedules"
        : gate === "createWorksheet" ? "creating worksheets" : "creating items";
      return `Quote setup required first. Call updateQuote with projectName and description before ${action}.`;
    }

    const hasScopeGraph = !!strategy && Object.keys(strategy.scopeGraph || {}).length > 0;
    const hasExecutionPlan = !!strategy && Object.keys(strategy.executionPlan || {}).length > 0;
    const hasAssumptions = !!strategy && Array.isArray(strategy.assumptions) && strategy.assumptions.length > 0;
    const hasPackagePlan = !!strategy && Array.isArray(strategy.packagePlan) && strategy.packagePlan.length > 0;
    const benchmarkingEnabled = (ws as any)?.meta?.benchmarkingEnabled === true;
    const hasBenchmarks = !!strategy && Object.keys(strategy.benchmarkProfile || {}).length > 0;

    if ((gate === "createWorksheet" || gate === "createWorksheetItem") && !hasScopeGraph) {
      return `Estimate strategy is incomplete. Call saveEstimateScopeGraph before creating worksheets or items.`;
    }
    if ((gate === "createWorksheet" || gate === "createWorksheetItem") && !hasExecutionPlan) {
      return `Execution model not saved yet. Call saveEstimateExecutionPlan before creating worksheets or items.`;
    }
    if ((gate === "createWorksheet" || gate === "createWorksheetItem") && !hasAssumptions) {
      return `Assumptions are not persisted yet. Call saveEstimateAssumptions before creating worksheets or items.`;
    }
    if ((gate === "createWorksheet" || gate === "createWorksheetItem") && !hasPackagePlan) {
      return `Commercial/package structure is missing. Call saveEstimatePackagePlan before creating worksheets or items.`;
    }
    if (benchmarkingEnabled && gate === "createWorksheetItem" && !hasBenchmarks) {
      return `Historical benchmark pass has not been run. Call recomputeEstimateBenchmarks and saveEstimateAdjustments before creating detailed line items.`;
    }

    if (gate === "createWorksheetItem") {
      const lineBasisGate = validateLineEvidenceBasisForPricing(ws, {
        evidenceBasis: lineEvidence?.evidenceBasis ?? null,
        sourceNotes: lineEvidence?.sourceNotes,
        laborUnitId: lineEvidence?.laborUnitId,
        rateScheduleItemId: lineEvidence?.rateScheduleItemId,
        sourceEvidence: lineEvidence?.sourceEvidence,
        targetText,
        categoryId: lineEvidence?.categoryId ?? null,
        category: lineEvidence?.category ?? null,
        costResourceId: lineEvidence?.costResourceId ?? null,
        effectiveCostId: lineEvidence?.effectiveCostId ?? null,
        itemId: lineEvidence?.itemId ?? null,
        resourceComposition: lineEvidence?.resourceComposition ?? null,
        cost: lineEvidence?.cost ?? null,
        price: lineEvidence?.price ?? null,
        uom: lineEvidence?.uom ?? null,
        quantity: lineEvidence?.quantity ?? null,
      });
      if (lineBasisGate) return lineBasisGate;

      const visualTakeoffGate = validateVisualTakeoffAuditForPricing(
        ws,
        strategy,
        targetText,
        lineEvidence?.evidenceBasis ?? null,
      );
      if (visualTakeoffGate) return visualTakeoffGate;
    }

    // Gate 2: rate schedules required for createWorksheet and createWorksheetItem
    if ((gate === "createWorksheet" || gate === "createWorksheetItem") && needsRateSchedules && !hasRateSchedules) {
      const names = rsCats.map((c: any) => c.name).join(", ");
      return `Rate schedules must be imported first. Categories [${names}] require rate schedules. Call listRateSchedules to see available schedules, then importRateSchedule to import them.`;
    }

    // Gate 1: worksheets required for createWorksheetItem
    if (gate === "createWorksheetItem" && !hasWorksheets) {
      return `No worksheets exist yet. Call createWorksheet to create at least one worksheet before adding items.`;
    }

    return null; // all gates passed
  }

  // ── getWorkspace ──────────────────────────────────────────
  server.tool(
    "getWorkspace",
    "Get the current quote workspace — all worksheets, items, phases, estimate factors, modifiers, conditions, totals. Call this to understand the current state of the estimate.",
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
        },
        worksheets: (ws.worksheets || []).map((w: any) => ({
          id: w.id,
          name: w.name,
          folderId: w.folderId ?? null,
          path: [folderPath(ws, w.folderId), w.name].filter(Boolean).join(" / "),
          itemCount: (w.items || []).length,
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
      includeRates: z.boolean().default(true).describe("Include rate/cost-rate maps in the item page."),
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

      const allRateItems: any[] = [];
      for (const rs of (ws.rateSchedules || [])) {
        for (const item of (rs.items || [])) {
          if (rateScheduleItemMatches(item, rs, input)) {
            allRateItems.push(compactRateScheduleItem(item, rs, { includeRates: input.includeRates }));
          }
        }
      }
      const rateItemPage = pageSlice(allRateItems, input, 100);

      const catalogItems: any[] = [];
      for (const cat of (ws.catalogs || [])) {
        for (const item of (ws.catalogItems || []).filter((ci: any) => ci.catalogId === cat.id)) {
          catalogItems.push({
            catalogItemId: item.id, name: item.name, code: item.code,
            unit: item.unit, unitCost: item.unitCost, unitPrice: item.unitPrice,
            catalogName: cat.name, catalogKind: cat.kind,
          });
        }
      }

      // Fetch org-level rate schedules available for import
      let orgSchedules: any[] = [];
      try {
        const orgData = await apiGet("/api/rate-schedules");
        orgSchedules = (orgData.schedules || orgData || [])
          .filter((s: any) => !input.category || normalizedText(s.category) === normalizedText(input.category))
          .filter((s: any) => !input.q || [s.name, s.description, s.category, ...(s.items || []).slice(0, 10).map((item: any) => item.name)].some((value) => matchesText(value, input.q)))
          .map((s: any) => summarizeRateSchedule(s, { includeSampleItems: true }));
      } catch {}
      const orgSchedulePage = pageSlice(orgSchedules, { limit: Math.min(input.limit, 25), offset: input.offset }, 50);

      const rateScheduleCats = entityCategories.filter((c: any) => c.itemSource === "rate_schedule");
      const catalogCats = entityCategories.filter((c: any) => c.itemSource === "catalog");
      const freeformCats = entityCategories.filter((c: any) => c.itemSource === "freeform");
      let instructions = "";
      if (rateScheduleCats.length > 0) {
        const names = rateScheduleCats.map((c: any) => c.name).join(", ");
        if (allRateItems.length > 0 || (ws.rateSchedules || []).length > 0) {
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

      instructions += `\n\nCANONICAL COST SOURCE WORKFLOW: Before creating a priced line item, search the runtime first-party library corpora with rg/searchLibraryCorpus, then call searchLineItemCandidates/recommendEstimateBasis with the scope phrase and preferred category for structured IDs. The search tools use the same indexed search surface as the worksheet line-level library picker and return candidates only; the estimating agent decides relevance, authority, exact/similar/context/manual basis, and final rationale. For rate-schedule rows, prefer createRateScheduleWorksheetItem with the selected rateScheduleItemId, tierUnits, and evidenceBasis; it derives category/name and keeps the payload smaller. For non-rate rows, preserve itemId/costResourceId/effectiveCostId/laborUnitId plus sourceEvidence and resourceComposition when calling createWorksheetItem. Use listLaborUnitTree/listLaborUnits for compact labour productivity candidates, getLaborUnit for focused details on one shortlisted unit, and previewAssembly for assembly-backed scope. If you choose a labor-unit analog, explain why the operation/unit/context is defensible and record the limitation in sourceNotes. Use WebSearch/WebFetch alongside internal sources for high-value, volatile, regional, unfamiliar, or vendor-specific items. Create freeform priced rows only when no first-party structured candidate is usable, or when current web/vendor evidence is materially better than stale internal data; write both the internal search and web/vendor basis in sourceNotes.`;
      instructions += `\n\nLINE EVIDENCE BASIS: When drawings exist, createWorksheetItem requires evidenceBasis. Prefer the two-axis form: evidenceBasis.quantity.type explains where the quantity/hours/duration/count came from, while evidenceBasis.pricing.type explains where unit cost/rate/productivity/allowance came from. If quantity comes from a drawing/table/takeoff, set evidenceBasis.quantity.type to drawing_quantity, visual_takeoff, drawing_table, or drawing_note and put claim IDs in evidenceBasis.quantity.drawingClaimIds. If the price comes from a material quote, labour manual, rate item, vendor quote, equipment/subcontract source, allowance model, indirect model, document quantity, assumption, or mixed basis, put that under evidenceBasis.pricing with refs/rationale. Do not hide a drawing-derived quantity behind material_quote/vendor_quote/knowledge_labor; split the quantity and pricing bases.`;

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
            items: rateItemPage.page,
            note: "This is paginated. Use listRateScheduleItems with q/category/scheduleId to retrieve focused item IDs.",
          } : undefined,
          availableOrgSchedules: orgSchedulePage.total > 0 && (ws.rateSchedules || []).length === 0 ? {
            total: orgSchedulePage.total,
            offset: orgSchedulePage.offset,
            limit: orgSchedulePage.limit,
            hasMore: orgSchedulePage.hasMore,
            schedules: orgSchedulePage.page,
          } : undefined,
          catalogItems: {
            total: catalogItems.length,
            shown: Math.min(catalogItems.length, 50),
            items: catalogItems.slice(0, 50),
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
      const gateError = await checkGate("createWorksheet", [folderPath, name, description].filter(Boolean).join(" "));
      if (gateError) return { content: [{ type: "text" as const, text: gateError }], isError: true };

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
    `Create a line item in a worksheet. IMPORTANT: categoryId is preferred; category name is accepted for backward compatibility and must resolve to an EntityCategory from getItemConfig. For tiered/rate categories, provide rateScheduleItemId, quantity, and tierUnits only; Bidwright calculates cost and price. Use the rate item name as entityName and put task details in the description field, NOT in entityName. For freeform categories, provide quantity plus the editable unit cost/price basis. UOM must be from the category's validUoms list. When drawings exist, every row must include evidenceBasis. Prefer the two-axis form: evidenceBasis.quantity declares where the quantity/hours/duration came from, and evidenceBasis.pricing declares where the unit cost/rate/productivity came from. Drawing/takeoff quantities use drawing_quantity/visual_takeoff/drawing_table/drawing_note under evidenceBasis.quantity and must cite Drawing Evidence Engine claim IDs; pricing can separately be material_quote, rate_schedule, knowledge_labor, vendor_quote, equipment_rental, subcontract, allowance, indirect, assumption, document_quantity, or mixed.`,
    {
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
      costResourceId: z.string().nullable().optional().describe("Cost intelligence resource ID from searchLineItemCandidates/recommendCostSource."),
      effectiveCostId: z.string().nullable().optional().describe("Effective cost ID from cost intelligence. Preserve this when a priced effective_cost candidate is selected."),
      laborUnitId: z.string().nullable().optional().describe("Labor unit ID for labour productivity sources."),
      resourceComposition: z.record(z.unknown()).optional().describe("Structured resource rollup from a search candidate, recommendation, or assembly expansion."),
      sourceEvidence: z.record(z.unknown()).optional().describe("Structured provenance from a search candidate, recommendation, or source document."),
      evidenceBasis: z.object({
        type: z.enum(LINE_EVIDENCE_BASIS_TYPES).optional().describe("Legacy single-source shorthand. Prefer quantity.type plus pricing.type when quantity and price/rate come from different sources."),
        quantity: z.object({
          type: z.enum(LINE_EVIDENCE_BASIS_TYPES).describe("Source class that justifies the row quantity, labour hours, duration, or count."),
          drawingClaimIds: z.array(z.string()).default([]).describe("Required when quantity.type is drawing_quantity, visual_takeoff, drawing_table, or drawing_note."),
          quantityDriver: z.string().optional().describe("Formula or driver behind quantity/hours/duration."),
          sourceRefs: z.array(z.string()).default([]),
          assumptionIds: z.array(z.string()).default([]),
          rationale: z.string().optional(),
        }).passthrough().optional(),
        pricing: z.object({
          type: z.enum(LINE_EVIDENCE_BASIS_TYPES).describe("Source class that justifies unit cost, rate, productivity, markup basis, or allowance value."),
          sourceRefs: z.array(z.string()).default([]),
          assumptionIds: z.array(z.string()).default([]),
          rationale: z.string().optional(),
        }).passthrough().optional(),
        quantityDriver: z.string().optional().describe("Short explanation of what drives quantity, hours, duration, or allowance."),
        drawingClaimIds: z.array(z.string()).default([]).describe("Legacy location for drawing quantity claim IDs. Prefer evidenceBasis.quantity.drawingClaimIds."),
        sourceRefs: z.array(z.string()).default([]).describe("Document, quote, manual, library, web, schedule, or model refs supporting non-drawing rows."),
        assumptionIds: z.array(z.string()).default([]).describe("Saved assumption IDs when the row is assumption-backed."),
        rationale: z.string().optional().describe("Why this source class is appropriate and how it supports the line."),
      }).passthrough().optional().describe("Line-level evidence contract. Required when drawings exist. Use quantity/pricing axes when quantity evidence and price/rate evidence differ."),
      classification: z.record(z.unknown()).optional().describe("Optional construction classification JSON, e.g. { masterformat: '03 30 00' }."),
      costCode: z.string().nullable().optional().describe("Optional internal cost code used by cost-code rollups."),
      phaseId: z.string().optional().describe("Phase ID"),
      sourceNotes: z.string().default("").describe(
        "MANDATORY: knowledge book refs, dataset lookups, correction factors applied, web search URLs/findings, assumptions for this item"
      ),
    },
    async (input) => {
      const wsForGate = await getWs();
      const targetWorksheet = asArray(wsForGate.worksheets).map(asRecord).find((worksheet) => String(worksheet.id ?? "") === input.worksheetId);
      const gateError = await checkGate("createWorksheetItem", [
        targetWorksheet?.name,
        input.entityName,
        input.description,
        input.sourceNotes,
      ].filter(Boolean).join(" "), {
        evidenceBasis: input.evidenceBasis ?? null,
        sourceNotes: input.sourceNotes,
        laborUnitId: input.laborUnitId,
        rateScheduleItemId: input.rateScheduleItemId,
        sourceEvidence: input.sourceEvidence,
        categoryId: input.categoryId ?? null,
        category: input.category ?? null,
        costResourceId: input.costResourceId ?? null,
        effectiveCostId: input.effectiveCostId ?? null,
        itemId: input.itemId ?? null,
        resourceComposition: input.resourceComposition ?? null,
        cost: input.cost ?? null,
        price: input.price ?? null,
        uom: input.uom ?? null,
        quantity: input.quantity ?? null,
      });
      if (gateError) return { content: [{ type: "text" as const, text: gateError }], isError: true };

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
        const matchingSchedule = asArray(wsForGate.rateSchedules).map(asRecord).find((schedule) =>
          asArray(schedule.items).some((item) => String(asRecord(item).id ?? "") === String(rest.rateScheduleItemId))
        );
        if (matchingSchedule) {
          const scheduleCategory = String(matchingSchedule.category ?? "");
          const categoryMatch = asArray(wsForGate.entityCategories).map(asRecord).find((category) =>
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
        return { content: [{ type: "text" as const, text: "ERROR: categoryId or category is required. Prefer the stable categoryId from getItemConfig." }], isError: true };
      }
      let resolvedCategory: any = null;

      // ── Dynamic validation from workspace (entity categories + rate schedules) ──
      try {
        const ws = await getWs(); // reuses cached fetch from gate check
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
            return { content: [{ type: "text" as const, text: `ERROR: Category "${catConfig.name}" is system-calculated from a rate schedule — rateScheduleItemId is required.\n1. Call listRateScheduleItems with q/category filters\n2. Set rateScheduleItemId to a valid item ID\n3. Provide quantity and positive tierUnits only; Bidwright calculates cost and price.` }], isError: true };
          }
          if (src === "catalog" && !rest.itemId) {
            return { content: [{ type: "text" as const, text: `ERROR: Category "${catConfig.name}" is configured with itemSource=catalog — itemId is required. Call searchLineItemCandidates or getItemConfig, then retry with a valid itemId.` }], isError: true };
          }

          // Validate rateScheduleItemId actually exists in revision rate schedules
          if (rest.rateScheduleItemId) {
            const rateSchedules = ws.rateSchedules || [];
            const allRsItems = rateSchedules.flatMap((rs: any) => (rs.items || []).map((i: any) => ({ id: i.id, name: i.name, code: i.code })));
            const match = allRsItems.find((ri: any) => ri.id === rest.rateScheduleItemId);
            if (!match) {
              const available = allRsItems.slice(0, 15).map((ri: any) => `"${ri.name}" (${ri.id})`).join(", ");
              return { content: [{ type: "text" as const, text: `ERROR: rateScheduleItemId "${rest.rateScheduleItemId}" does not match any rate schedule item in this revision.` +
                (available ? `\nAvailable items: ${available}` : `\nNo rate schedule items found. Call getItemConfig to check available items.`) +
                `\nFix the rateScheduleItemId and retry.` }], isError: true };
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
              return { content: [{ type: "text" as const, text: `ERROR: itemId "${rest.itemId}" does not match any catalog item. Call getItemConfig to check available catalog items, then retry with a valid itemId.` }], isError: true };
            }
          }

          // Validate calculationType requirements
          const hasTierUnits = !!rest.tierUnits && Object.values(rest.tierUnits).some((value) => Number(value) !== 0);
          if (requiresRateSchedule && !hasTierUnits) {
            return { content: [{ type: "text" as const, text: `ERROR: Category "${catConfig.name}" uses ${calcType} calculation with rate-schedule pricing, so positive tierUnits are required. Provide rateScheduleItemId, quantity, and tierUnits only; Bidwright calculates cost and price.` }], isError: true };
          }
          if (requiresRateSchedule) {
            const suppliedCalculatedValue = [rest.cost, rest.markup, rest.price].some((value) => value !== undefined && Number(value) !== 0);
            if (suppliedCalculatedValue) {
              return { content: [{ type: "text" as const, text: `ERROR: Do not pass cost, markup, or price for "${catConfig.name}" rows. They are calculated by Bidwright from rateScheduleItemId, quantity, and tierUnits.` }], isError: true };
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
        return { content: [{ type: "text" as const, text: "ERROR: categoryId could not be resolved from the current workspace. Call getItemConfig and retry with a valid categoryId or category name." }], isError: true };
      }
      const body = { ...rest, category: cat, categoryId: resolvedCategory?.id ?? rest.categoryId, entityType: resolvedCategory?.entityType ?? rest.entityType ?? cat };
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
          quantityDriver: z.string().optional(),
          sourceRefs: z.array(z.string()).default([]),
          assumptionIds: z.array(z.string()).default([]),
          rationale: z.string().optional(),
        }).passthrough().optional(),
        pricing: z.object({
          type: z.enum(LINE_EVIDENCE_BASIS_TYPES),
          sourceRefs: z.array(z.string()).default([]),
          assumptionIds: z.array(z.string()).default([]),
          rationale: z.string().optional(),
        }).passthrough().optional(),
        quantityDriver: z.string().optional(),
        drawingClaimIds: z.array(z.string()).default([]),
        sourceRefs: z.array(z.string()).default([]),
        assumptionIds: z.array(z.string()).default([]),
        rationale: z.string().optional(),
      }).passthrough().describe("Line-level evidence contract. Use quantity/pricing axes."),
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

      const targetWorksheet = asArray(ws.worksheets).map(asRecord).find((worksheet) => String(worksheet.id ?? "") === input.worksheetId);
      const gateError = await checkGate("createWorksheetItem", [
        targetWorksheet?.name,
        matchedItem.name,
        input.description,
        input.sourceNotes,
      ].filter(Boolean).join(" "), {
        evidenceBasis: input.evidenceBasis,
        sourceNotes: input.sourceNotes,
        laborUnitId: input.laborUnitId,
        rateScheduleItemId: input.rateScheduleItemId,
        sourceEvidence: input.sourceEvidence,
        categoryId: String(categoryMatch.id ?? "") || null,
        category: String(categoryMatch.name ?? scheduleCategory) || null,
        resourceComposition: input.resourceComposition ?? null,
        uom: input.uom ?? null,
        quantity: input.quantity ?? null,
      });
      if (gateError) return { content: [{ type: "text" as const, text: gateError }], isError: true };

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
    {
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
    },
    async ({ itemId, catalogItemId, ...patch }) => {
      if (catalogItemId !== undefined) (patch as any).itemId = catalogItemId;
      // Normalize markup to decimal: agent sends 15 for 15%, DB stores 0.15
      if ((patch as any).markup !== undefined && (patch as any).markup > 1) {
        (patch as any).markup = (patch as any).markup / 100;
      }
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

  // ── updateQuote ───────────────────────────────────────────
  server.tool(
    "updateQuote",
    "Update the quote metadata — project name, client info, scope description, and customer-facing estimate notes. The description supports rich text (HTML). If you provide plain text with newlines, it will be auto-converted to HTML paragraphs. Use updateRevision.scratchpad for internal estimator notes or scratch work.",
    {
      projectName: z.string().optional(),
      clientName: z.string().optional(),
      clientEmail: z.string().optional(),
      projectAddress: z.string().optional(),
      notes: z.string().optional().describe("Customer-facing estimate notes that may appear in quote/PDF output. Do not put internal reasoning, TODOs, or private estimator scratch work here."),
      description: z.string().optional().describe("Scope of work description. Can be plain text (auto-converted to HTML) or HTML. Use \\n for line breaks in plain text, or provide HTML directly with <p>, <ul>, <li>, <strong>, <h3> tags."),
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
      if (input.description) projectFields.description = input.description;
      if (input.notes) projectFields.notes = input.notes;

      if (Object.keys(projectFields).length > 0) {
        await apiPatch(projectPath(""), projectFields);
      }

      // Also update revision title and description so the Setup tab reflects changes
      const revisionFields: Record<string, unknown> = {};
      if (input.projectName) revisionFields.title = input.projectName;
      if (input.description) revisionFields.description = input.description;
      if (input.notes) revisionFields.notes = input.notes;

      const revisionId = getRevisionId();
      if (revisionId && Object.keys(revisionFields).length > 0) {
        try {
          await apiPatch(projectPath(`/revisions/${revisionId}`), revisionFields);
        } catch {
          // Non-fatal — project-level update already succeeded
        }
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
    "Recalculate all financial totals for the quote.",
    {},
    async () => {
      await apiPost(projectPath("/recalculate"), {});
      return { content: [{ type: "text" as const, text: "Totals recalculated" }] };
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
      includeSampleItems: z.boolean().default(true).describe("Include up to 5 item names per schedule for orientation."),
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
        .map((schedule: any) => summarizeRateSchedule(schedule, { includeSampleItems: input.includeSampleItems && (!!input.q || !!input.category) }));
      const page = pageSlice(filtered, input, 25);
      return { content: [{ type: "text" as const, text: JSON.stringify({
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        hasMore: page.hasMore,
        schedules: page.page,
        note: "This is a compact index. Call importRateSchedule with a schedule ID to import it. If you need to inspect an org schedule's items first, call getRateSchedule with scheduleId plus q/limit/offset.",
      }, null, 2) }] };
    }
  );

  server.tool(
    "getRateSchedule",
    "Get one org-level rate schedule with paginated item details. Use this only after listRateSchedules identifies a likely schedule.",
    {
      scheduleId: z.string().describe("Org-level rate schedule id from listRateSchedules."),
      q: z.string().optional().describe("Optional item search within this schedule."),
      limit: z.coerce.number().int().positive().max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
      includeRates: z.boolean().default(true).describe("Include rate/cost-rate maps for returned items."),
    },
    async (input) => {
      const schedule = await apiGet(`/api/rate-schedules/${encodeURIComponent(input.scheduleId)}`);
      const matchingItems = asArray((schedule as any).items)
        .filter((item: any) => rateScheduleItemMatches(item, schedule, { q: input.q }));
      const page = pageSlice(matchingItems, input, 200);
      return { content: [{ type: "text" as const, text: JSON.stringify({
        schedule: summarizeRateSchedule(schedule, { includeSampleItems: false }),
        items: {
          total: page.total,
          offset: page.offset,
          limit: page.limit,
          hasMore: page.hasMore,
          rows: page.page.map((item: any) => compactRateScheduleItem(item, schedule, { includeRates: input.includeRates })),
        },
        note: "Items are paginated. Use q/offset/limit to inspect more without overflowing the tool response.",
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
      const gateError = await checkGate("importRateSchedule");
      if (gateError) return { content: [{ type: "text" as const, text: gateError }], isError: true };
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
      limit: z.coerce.number().int().positive().max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
      includeRates: z.boolean().default(true).describe("Include rate/cost-rate maps for returned items."),
    },
    async (input) => {
      const data = await apiGet(projectPath("/workspace"));
      const ws = data.workspace || data;
      const items: any[] = [];
      for (const rs of (ws.rateSchedules || [])) {
        if (input.scheduleId && rs.id !== input.scheduleId) continue;
        if (input.category && normalizedText(rs.category) !== normalizedText(input.category)) continue;
        for (const item of (rs.items || [])) {
          if (rateScheduleItemMatches(item, rs, input)) {
            items.push(compactRateScheduleItem(item, rs, { includeRates: input.includeRates }));
          }
        }
      }
      const page = pageSlice(items, input, 200);
      return { content: [{ type: "text" as const, text: JSON.stringify({
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        hasMore: page.hasMore,
        schedules: (ws.rateSchedules || [])
          .filter((schedule: any) => !input.scheduleId || schedule.id === input.scheduleId)
          .filter((schedule: any) => !input.category || normalizedText(schedule.category) === normalizedText(input.category))
          .map((schedule: any) => ({
            id: schedule.id,
            name: schedule.name,
            category: schedule.category,
            itemCount: asArray(schedule.items).length,
            tiers: scheduleTiers(schedule),
          })),
        items: page.page,
        note: page.hasMore
          ? "More items exist. Refine with q/category/scheduleId or increase offset."
          : "Use rateScheduleItemId plus tierIds/tierUnits when creating rate-backed worksheet rows.",
      }, null, 2) }] };
    }
  );

  // ── searchItems ───────────────────────────────────────────
  server.tool(
    "searchItems",
    "Search existing line items across all worksheets. Returns compact paginated summaries; use a focused query/category/worksheetId for detail.",
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
      percentage: z.coerce.number().optional().describe("Percentage adjustment (e.g. 10 for 10%). Use this OR amount, not both."),
      amount: z.coerce.number().optional().describe("Fixed dollar amount. Use this OR percentage, not both."),
      show: z.enum(["Yes", "No"]).default("Yes").describe("Show on client quote ('Yes') or hide/distribute ('No')"),
    },
    async (input) => {
      await apiPost(projectPath("/modifiers"), input);
      return { content: [{ type: "text" as const, text: `Created modifier: ${input.name}` }] };
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
      percentage: z.coerce.number().nullable().optional().describe("Set to null to clear percentage"),
      amount: z.coerce.number().nullable().optional().describe("Set to null to clear amount"),
      show: z.enum(["Yes", "No"]).optional(),
    },
    async ({ modifierId, ...patch }) => {
      await apiPatch(projectPath(`/modifiers/${modifierId}`), patch);
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
      breakoutStyle: z.enum(["grand_total", "category", "phase", "phase_detail", "labour_material_equipment"]).optional()
        .describe("How costs are organized on the quote: grand_total (lump sum), category (by material/labour/etc), phase (by project phase), phase_detail (phases with category breakdown), labour_material_equipment (L/M/E columns)"),
      status: z.enum(["Open", "Pending", "Awarded", "DidNotGet", "Declined", "Cancelled", "Closed", "Other"]).optional(),
      type: z.enum(["Firm", "Budget", "BudgetDNE"]).optional().describe("Quote type: Firm (binding), Budget (estimate), BudgetDNE (do not exceed)"),
      title: z.string().optional().describe("Revision title"),
      description: z.string().optional(),
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
      const wsData = await apiGet(projectPath("/workspace"));
      const ws = wsData.workspace || wsData;
      const revisionId = ws.revisions?.[0]?.id || ws.currentRevisionId;
      if (!revisionId) {
        return { content: [{ type: "text" as const, text: "Error: Could not determine current revision ID" }] };
      }
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
  server.tool(
    "createSummaryRow",
    "Add a row to the quote summary. Types: auto_category, auto_phase, manual, modifier, subtotal, separator.",
    {
      type: z.enum(["auto_category", "auto_phase", "manual", "modifier", "subtotal", "separator"]).describe("Row type"),
      label: z.string().describe("Display label"),
      sourceCategory: z.string().optional().describe("For auto_category: EntityCategory name to aggregate"),
      sourcePhase: z.string().optional().describe("For auto_phase: phase name to aggregate"),
      manualValue: z.coerce.number().optional().describe("For manual: sell/price value"),
      manualCost: z.coerce.number().optional().describe("For manual: cost value"),
      modifierPercent: z.coerce.number().optional().describe("For modifier: percentage"),
      modifierAmount: z.coerce.number().optional().describe("For modifier: fixed dollar amount"),
      visible: z.boolean().optional().describe("Visible on PDF (default true)"),
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
    "Update an existing summary row.",
    {
      rowId: z.string().describe("Summary row ID"),
      label: z.string().optional().describe("New label"),
      manualValue: z.coerce.number().optional().describe("New value (manual rows)"),
      manualCost: z.coerce.number().optional().describe("New cost (manual rows)"),
      modifierPercent: z.coerce.number().optional().describe("New percentage (modifier rows)"),
      modifierAmount: z.coerce.number().optional().describe("New amount (modifier rows)"),
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
      return { content: [{ type: "text" as const, text: `Updated summary row ${rowId}` }] };
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
