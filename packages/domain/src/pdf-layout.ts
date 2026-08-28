export const PDF_SECTION_KEYS = [
  "coverPage",
  "scopeOfWork",
  "leadLetter",
  "lineItems",
  "phases",
  "conditions",
  "terms",
  "pricingSummary",
  "hoursSummary",
  "labourSummary",
  "notes",
  "reportSections",
  "schedule",
] as const;

export type PdfSectionKey = (typeof PDF_SECTION_KEYS)[number];
export type PdfDocumentType = "main" | "backup" | "sitecopy";

export interface PdfSectionCapability {
  label: string;
  available: boolean;
  defaultEnabled: boolean;
  locked?: boolean;
  reason?: string;
}

export interface PdfDocumentProfile {
  id: PdfDocumentType;
  label: string;
  description: string;
  customerFacing: boolean;
  sections: Record<PdfSectionKey, PdfSectionCapability>;
}

const LABELS: Record<PdfSectionKey, string> = {
  coverPage: "Cover Page",
  scopeOfWork: "Scope of Work",
  leadLetter: "Lead Letter",
  lineItems: "Line Items",
  phases: "Phases",
  conditions: "Conditions",
  terms: "Terms & Conditions",
  pricingSummary: "Price Build",
  hoursSummary: "Labour Hours Summary",
  labourSummary: "Labour by Phase",
  notes: "Notes",
  reportSections: "Report Sections",
  schedule: "Schedule (Gantt)",
};

function sections(
  available: PdfSectionKey[],
  enabled: PdfSectionKey[],
  locked: Partial<Record<PdfSectionKey, string>> = {},
): Record<PdfSectionKey, PdfSectionCapability> {
  return Object.fromEntries(PDF_SECTION_KEYS.map((key) => {
    const isAvailable = available.includes(key);
    return [key, {
      label: LABELS[key],
      available: isAvailable,
      defaultEnabled: isAvailable && enabled.includes(key),
      locked: key in locked,
      reason: locked[key],
    }];
  })) as Record<PdfSectionKey, PdfSectionCapability>;
}

const ALL_SECTIONS = [...PDF_SECTION_KEYS];

export const PDF_DOCUMENT_PROFILES: Record<PdfDocumentType, PdfDocumentProfile> = {
  main: {
    id: "main",
    label: "Proposal",
    description: "Client-facing quote with the approved Price Build and no internal costs.",
    customerFacing: true,
    sections: sections(
      ALL_SECTIONS,
      ["coverPage", "scopeOfWork", "leadLetter", "conditions", "terms", "pricingSummary", "notes", "reportSections"],
      { pricingSummary: "Every proposal includes the client-facing Price Build." },
    ),
  },
  backup: {
    id: "backup",
    label: "Cost",
    description: "Internal estimating copy with costs, markups, labour, and operational detail.",
    customerFacing: false,
    sections: sections(
      ALL_SECTIONS,
      ["coverPage", "scopeOfWork", "lineItems", "phases", "conditions", "terms", "pricingSummary", "hoursSummary", "labourSummary", "notes", "reportSections"],
    ),
  },
  sitecopy: {
    id: "sitecopy",
    label: "Site Copy",
    description: "Field copy with scope, quantities, configured labour tiers, and equipment usage; no pricing.",
    customerFacing: true,
    sections: sections(
      ["coverPage", "scopeOfWork", "lineItems", "phases", "conditions", "hoursSummary", "labourSummary", "notes", "reportSections", "schedule"],
      ["coverPage", "scopeOfWork", "lineItems", "phases", "conditions", "hoursSummary", "labourSummary", "notes", "reportSections"],
      { lineItems: "Site copies require operational line-item detail." },
    ),
  },
};

export function normalizePdfDocumentType(value: unknown): PdfDocumentType {
  if (value === "backup" || value === "sitecopy" || value === "main") return value;
  if (value === "detailed") return "backup";
  return "main";
}

export const PDF_ATTACHMENT_PREFIX = "attachment:";

export type PdfFileAttachment = {
  id: string;
  title: string;
  fileNodeId?: string;
  documentId?: string;
};

export function getPdfAttachmentSectionKey(id: string) {
  return `${PDF_ATTACHMENT_PREFIX}${id}`;
}

export function getPdfAttachmentSectionId(sectionKey: string): string | null {
  return sectionKey.startsWith(PDF_ATTACHMENT_PREFIX)
    ? sectionKey.slice(PDF_ATTACHMENT_PREFIX.length)
    : null;
}

export function pdfAttachmentIdForSource(input: { fileNodeId?: string; documentId?: string }) {
  if (input.fileNodeId) return `att_${input.fileNodeId}`;
  if (input.documentId) return `att_${input.documentId}`;
  return `att_${Date.now()}`;
}

export function insertPdfAttachmentAfterReport(order: string[], key: string) {
  if (order.includes(key)) return;
  const reportIdx = order.indexOf("reportSections");
  const termsIdx = order.indexOf("terms");
  if (reportIdx !== -1) order.splice(reportIdx + 1, 0, key);
  else if (termsIdx !== -1) order.splice(termsIdx, 0, key);
  else order.push(key);
}

export type QuotePdfSegment =
  | { kind: "html"; sectionKeys: string[] }
  | { kind: "attachment"; attachment: PdfFileAttachment }
  | { kind: "schedule" };

export function buildQuotePdfSegments(
  sectionOrder: string[],
  attachments: PdfFileAttachment[],
): QuotePdfSegment[] {
  const byId = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  const segments: QuotePdfSegment[] = [];
  let htmlKeys: string[] = [];

  const flushHtml = () => {
    if (htmlKeys.length === 0) return;
    segments.push({ kind: "html", sectionKeys: htmlKeys });
    htmlKeys = [];
  };

  for (const key of sectionOrder) {
    if (key === "schedule") {
      flushHtml();
      segments.push({ kind: "schedule" });
      continue;
    }
    const attachmentId = getPdfAttachmentSectionId(key);
    if (attachmentId) {
      const attachment = byId.get(attachmentId);
      if (!attachment) continue;
      flushHtml();
      segments.push({ kind: "attachment", attachment });
      continue;
    }
    htmlKeys.push(key);
  }
  flushHtml();
  return segments;
}
