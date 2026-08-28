import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import {
  buildQuotePdfSegments,
  getPdfAttachmentSectionKey,
  type PdfFileAttachment,
} from "@bidwright/domain";
import { resolveApiPath } from "../paths.js";
import type { PdfLayoutOptions } from "./pdf-service.js";

type StoredFile = {
  name?: string | null;
  fileName?: string | null;
  storagePath?: string | null;
  documentId?: string | null;
  projectId?: string | null;
};

export type QuotePdfAttachmentStore = {
  getFileNode(nodeId: string): Promise<StoredFile | null>;
  getDocument(projectId: string, documentId: string): Promise<StoredFile | null>;
};

function isRemoteStoragePath(storagePath: string) {
  try {
    const url = new URL(storagePath);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function looksLikePdf(bytes: Buffer) {
  return bytes.subarray(0, 5).toString("utf8") === "%PDF-";
}

async function readStoredBytes(storagePath: string): Promise<Buffer | null> {
  if (isRemoteStoragePath(storagePath)) {
    const response = await fetch(storagePath, { redirect: "follow" });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  }
  try {
    return await readFile(resolveApiPath(storagePath));
  } catch {
    return null;
  }
}

export async function loadQuotePdfAttachmentBytes(
  store: QuotePdfAttachmentStore,
  projectId: string,
  attachment: PdfFileAttachment,
): Promise<{ bytes: Buffer | null; warning?: string }> {
  const label = attachment.title || attachment.id;
  if (attachment.fileNodeId) {
    const node = await store.getFileNode(attachment.fileNodeId);
    if (!node || (node.projectId && node.projectId !== projectId)) {
      return { bytes: null, warning: `${label} was not found in Files.` };
    }
    if (node.storagePath) {
      const bytes = await readStoredBytes(node.storagePath);
      if (bytes && looksLikePdf(bytes)) return { bytes };
      if (bytes) return { bytes: null, warning: `${label} is not a PDF.` };
    }
    if (node.documentId) {
      const doc = await store.getDocument(projectId, node.documentId);
      if (doc?.storagePath) {
        const bytes = await readStoredBytes(doc.storagePath);
        if (bytes && looksLikePdf(bytes)) return { bytes };
        if (bytes) return { bytes: null, warning: `${label} is not a PDF.` };
      }
    }
    return { bytes: null, warning: `${label} has no stored PDF.` };
  }
  if (attachment.documentId) {
    const doc = await store.getDocument(projectId, attachment.documentId);
    if (!doc) return { bytes: null, warning: `${label} was not found in Files.` };
    if (!doc.storagePath) return { bytes: null, warning: `${label} has no stored PDF.` };
    const bytes = await readStoredBytes(doc.storagePath);
    if (!bytes) return { bytes: null, warning: `${label} could not be read.` };
    if (!looksLikePdf(bytes)) return { bytes: null, warning: `${label} is not a PDF.` };
    return { bytes };
  }
  return { bytes: null, warning: `${label} has no file reference.` };
}

export async function mergePdfBuffers(parts: Buffer[]): Promise<Buffer> {
  if (parts.length === 0) throw new Error("No PDF parts to merge");
  if (parts.length === 1) return parts[0]!;
  const merged = await PDFDocument.create();
  for (const part of parts) {
    const source = await PDFDocument.load(part, { ignoreEncryption: true });
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  return Buffer.from(await merged.save());
}

export function attachmentsFromLayout(options: Partial<PdfLayoutOptions> | undefined): PdfFileAttachment[] {
  const attachments = Array.isArray(options?.attachments) ? options.attachments : [];
  return attachments.filter((attachment): attachment is PdfFileAttachment => (
    Boolean(attachment)
    && typeof attachment === "object"
    && typeof attachment.id === "string"
    && attachment.id.trim().length > 0
  ));
}

export function sectionOrderWithAttachments(
  sectionOrder: string[] | undefined,
  attachments: PdfFileAttachment[],
): string[] {
  const order = [...(sectionOrder ?? [])];
  for (const attachment of attachments) {
    const key = getPdfAttachmentSectionKey(attachment.id);
    if (!order.includes(key)) {
      const reportIdx = order.indexOf("reportSections");
      const termsIdx = order.indexOf("terms");
      if (reportIdx !== -1) order.splice(reportIdx + 1, 0, key);
      else if (termsIdx !== -1) order.splice(termsIdx, 0, key);
      else order.push(key);
    }
  }
  return order;
}

export function quotePdfSegmentsFromLayout(options: Partial<PdfLayoutOptions> | undefined) {
  const attachments = attachmentsFromLayout(options);
  let sectionOrder = sectionOrderWithAttachments(options?.sectionOrder, attachments);
  if (options?.sections?.schedule !== true) {
    sectionOrder = sectionOrder.filter((key) => key !== "schedule");
  }
  return { attachments, sectionOrder, segments: buildQuotePdfSegments(sectionOrder, attachments) };
}
