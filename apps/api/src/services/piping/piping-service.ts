import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { extname } from "node:path";
import { prisma } from "@bidwright/db";
import type { PrismaApiStore } from "../../prisma-store.js";
import { resolveApiPath } from "../../paths.js";
import { parsePcf } from "./pcf-parser.js";
import { parseSpoolyard } from "./spoolyard-parser.js";

export const MAX_PROJECT_SOURCE_BYTES = 8_000_000;
export async function readBoundedProjectFile(storagePath: string): Promise<Buffer> {
  const file = await open(resolveApiPath(storagePath), "r");
  try {
    const { size } = await file.stat();
    if (size > MAX_PROJECT_SOURCE_BYTES) throw new Error(`Source is ${size} bytes; the read limit is 8 MB (${MAX_PROJECT_SOURCE_BYTES} bytes).`);
    // Read at most the limit plus one byte even if the file grows after stat.
    const bytes = Buffer.alloc(Math.min(size + 1, MAX_PROJECT_SOURCE_BYTES + 1));
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > size) throw new Error("Source grew while reading; retry using the current source (8 MB read limit).");
    return bytes.subarray(0, length);
  } finally { await file.close(); }
}

export type ProjectSource = { sourceId: string; sourceKind: "source_document" | "file_node" };
export async function readProjectSource(projectId: string, input: ProjectSource) {
  if (input.sourceKind === "source_document") {
    const doc = await prisma.sourceDocument.findFirst({ where: { id: input.sourceId, projectId } });
    if (!doc) throw new Error("Source document not found in project");
    if (!doc.storagePath) throw new Error("Source document has no stored file");
    return { bytes: await readBoundedProjectFile(doc.storagePath), fileName: doc.fileName, documentId: doc.id, fileNodeId: null };
  }
  const file = await prisma.fileNode.findFirst({ where: { id: input.sourceId, projectId, type: "file" } });
  if (!file) throw new Error("File not found in project");
  const doc = file.documentId ? await prisma.sourceDocument.findFirst({ where: { id: file.documentId, projectId } }) : null;
  if (file.documentId && !doc) throw new Error("File references a source document outside this project or a missing document");
  const storagePath = file.storagePath || doc?.storagePath;
  if (!storagePath) throw new Error("File has no stored content");
  return { bytes: await readBoundedProjectFile(storagePath), fileName: file.name, documentId: `file-${file.id}`, fileNodeId: file.id };
}

export async function getPipingMto(projectId: string, input: ProjectSource) {
  const source = await readProjectSource(projectId, input);
  const format = extname(source.fileName).toLowerCase();
  if (format !== ".pcf" && format !== ".piping") throw new Error("Piping source extension is not .pcf or .piping");
  const text = source.bytes.toString("utf8");
  return { ...((format === ".piping") ? parseSpoolyard(text) : parsePcf(text)), source: { ...input, documentId: source.documentId, fileNodeId: source.fileNodeId, fileName: source.fileName, checksum: createHash("sha256").update(source.bytes).digest("hex") } };
}

export async function readProjectImages(projectId: string, sources: ProjectSource[]) {
  return Promise.all(sources.map(async source => {
    const file = await readProjectSource(projectId, source);
    const mimeType = ({ ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" } as Record<string, string>)[extname(file.fileName).toLowerCase()];
    if (!mimeType) throw new Error(`Unsupported image type: ${file.fileName}`);
    return { data: file.bytes.toString("base64"), mimeType, caption: file.fileName };
  }));
}

export interface PipingSelection { lineId: string; worksheetItemId?: string; unit?: "m" | "mm" | "ft" | "in" | "EA" }
const units: Record<string, string> = { m: "m", metre: "m", meter: "m", metres: "m", meters: "m", lm: "m", mm: "mm", ft: "ft", lf: "ft", feet: "ft", foot: "ft", in: "in", inch: "in", inches: "in", ea: "EA", each: "EA", count: "EA" };
export const canonicalPipingUnit = (unit: string) => units[unit.trim().toLowerCase()] ?? unit;
export function pipingPickupInput(mto: Awaited<ReturnType<typeof getPipingMto>>, selection: PipingSelection) {
  const line = mto.lines.find(l => l.id === selection.lineId);
  if (!line) throw new Error(`MTO line ${selection.lineId} not found`);
  if (line.quantity === null || !Number.isFinite(line.quantity)) throw new Error(`MTO line ${line.id} has unknown quantity`);
  const unit = selection.unit ?? line.unit;
  if ((unit === "EA") !== (line.unit === "EA")) throw new Error("Cannot convert between pipe length and component count");
  const factor = ({ m: 1, mm: 1000, ft: 1 / 0.3048, in: 1 / 0.0254, EA: 1 })[unit];
  return {
    documentId: mto.source.documentId, pageNumber: 1, sourceKind: "annotation", annotationType: line.unit === "m" ? "linear" : "count",
    label: `${line.description} · ${line.size}`, groupName: "Piping MTO", points: [],
    measurement: { value: line.quantity * factor, unit, ...(unit === "EA" ? { count: line.quantity } : {}) },
    metadata: { source: "piping", measuredBy: "agent", method: "deterministic-piping-mto", sourceChecksum: mto.source.checksum, sourceId: mto.source.sourceId, fileNodeId: mto.source.fileNodeId, format: mto.format, mtoLineId: line.id, itemRefs: line.refs, basis: line.basis, spec: line.spec, material: line.material, size: line.size, skey: line.skey, scope: line.scope, nativeQuantity: line.quantity, nativeUnit: line.unit, conversionFactor: factor },
  };
}

export async function savePipingMto(store: Pick<PrismaApiStore, "createPickup" | "createPickupLink">, projectId: string, mto: Awaited<ReturnType<typeof getPipingMto>>, selections: PipingSelection[]) {
  if (new Set(selections.map(s => s.lineId)).size !== selections.length) throw new Error("Duplicate MTO line ids in selection");
  const inputs = selections.map(s => pipingPickupInput(mto, s));
  const saved = [];
  for (const [i, input] of inputs.entries()) {
    const pickup = await store.createPickup(projectId, input);
    const worksheetItemId = selections[i].worksheetItemId;
    const link = worksheetItemId ? await store.createPickupLink(projectId, { pickupId: pickup.id, worksheetItemId, quantityField: "value", multiplier: 1 }) : null;
    saved.push({ pickup, link });
  }
  return { saved };
}

export async function savePipingTakeoff(store: Pick<PrismaApiStore, "createPickup" | "createPickupLink">, projectId: string, input: ProjectSource & { lines: PipingSelection[]; sourceChecksum?: string }) {
  const mto = await getPipingMto(projectId, input);
  if (input.sourceChecksum && input.sourceChecksum !== mto.source.checksum) throw new Error("Source checksum changed; the selected MTO is stale");
  for (const selection of input.lines) {
    const pickup = pipingPickupInput(mto, selection);
    if (!selection.worksheetItemId) continue;
    const row = await prisma.worksheetItem.findFirst({ where: { id: selection.worksheetItemId, worksheet: { revision: { quote: { projectId } } } }, include: { worksheet: { include: { revision: { include: { quote: true } } } } } });
    if (!row) throw new Error("Worksheet item not found in project");
    if (row.worksheet.revision.quote.currentRevisionId !== row.worksheet.revisionId) throw new Error("Worksheet item is not in the current revision");
    if (canonicalPipingUnit(row.uom) !== pickup.measurement.unit) throw new Error(`Worksheet unit ${row.uom} differs from ${pickup.measurement.unit}; choose an explicit unit conversion`);
  }
  return savePipingMto(store, projectId, mto, input.lines);
}
