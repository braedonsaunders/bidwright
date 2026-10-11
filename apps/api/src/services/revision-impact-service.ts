import { prisma } from "@bidwright/db";

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord => value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
interface ImpactPickup {
  id: string; documentId: string; pageNumber: number; modelId: string | null; modelElementId: string | null;
  metadata: unknown; selection: unknown; createdBy: string | null; pickupLinks: Array<{ id: string; worksheetItemId: string; worksheetItem: { id: string }; [key: string]: unknown }>;
  [key: string]: unknown;
}
interface ImpactContext {
  document?: { id: string; checksum: string; priorDocumentId?: string; priorChecksum?: string; pageNumbers?: number[] };
  diff?: { baseModelId: string; headModelId: string; rows: unknown };
  views?: Array<{ id: string; sourceChecksum: string | null }>;
}

export function revisionImpactForPickups(pickups: ImpactPickup[], context: ImpactContext) {
  const views = new Map((context.views ?? []).map(v => [v.id, v.sourceChecksum]));
  const changes = Array.isArray(context.diff?.rows) ? context.diff.rows.map(record) : [];
  const affected = pickups.flatMap(pickup => {
    const metadata = record(pickup.metadata), selection = record(pickup.selection);
    const reasons: string[] = [];
    const doc = context.document;
    if (doc && [doc.id, doc.priorDocumentId].includes(pickup.documentId) && (!doc.pageNumbers?.length || doc.pageNumbers.includes(pickup.pageNumber))) {
      const viewIds = [metadata.viewId, ...(Array.isArray(metadata.viewIds) ? metadata.viewIds : [])].filter((id): id is string => typeof id === "string");
      const checksums = [metadata.sourceChecksum, ...viewIds.map(id => views.get(id))].filter((v): v is string => typeof v === "string" && v.length > 0);
      if (checksums.some(c => doc.checksum && c !== doc.checksum)) reasons.push("recorded source checksum differs from current source");
      else if (checksums.length && doc.checksum) return [];
      else if (doc.priorDocumentId && doc.priorDocumentId !== doc.id && pickup.documentId === doc.priorDocumentId) reasons.push("pickup references the prior document");
      else if (doc.priorChecksum && doc.checksum && doc.priorChecksum !== doc.checksum) reasons.push("source checksum changed; pickup has no recorded source version");
      else if (!doc.priorChecksum || !doc.checksum) reasons.push("source version is unrecorded; document-level candidate");
    }
    const diff = context.diff;
    if (diff && [diff.baseModelId, diff.headModelId].includes(pickup.modelId ?? "")) {
      const matches = changes.filter(change => pickup.modelElementId && [change.baseElementId, change.headElementId].includes(pickup.modelElementId) || typeof selection.externalId === "string" && change.externalId === selection.externalId);
      if (matches.length) reasons.push(...matches.map(change => `model element ${change.externalId ?? pickup.modelElementId}: ${change.changeType}`));
      else if (!pickup.modelElementId && changes.length) reasons.push("model changed; pickup element reference is unavailable");
    }
    if (!reasons.length) return [];
    const measuredBy = metadata.measuredBy;
    const humanMade = measuredBy === "person" || measuredBy === "human" ? true : measuredBy === "agent" ? false : null;
    return [{ ...pickup, humanMade, provenance: humanMade === null ? "unrecorded" : humanMade ? "person" : "agent", reasons }];
  });
  const links = [...new Map(affected.flatMap(p => p.pickupLinks).map(l => [l.id, l])).values()];
  const worksheetItems = [...new Map(links.map(l => [l.worksheetItem.id, l.worksheetItem])).values()];
  return { pickups: affected, links, worksheetItems, modelChanges: changes, summary: { pickups: affected.length, links: links.length, worksheetItems: worksheetItems.length, humanPickups: affected.filter(p => p.humanMade === true).length, unrecordedProvenance: affected.filter(p => p.humanMade === null).length } };
}

export interface RevisionImpactInput { documentId?: string; priorDocumentId?: string; priorChecksum?: string; pageNumbers?: number[]; diffId?: string }
export async function getRevisionImpact(projectId: string, input: RevisionImpactInput) {
  if (Boolean(input.documentId) === Boolean(input.diffId)) throw new Error("Provide documentId or diffId");
  const context: ImpactContext = {};
  if (input.documentId) {
    const doc = await prisma.sourceDocument.findFirst({ where: { id: input.documentId, projectId } });
    if (!doc) throw new Error("Source document not found in project");
    const prior = input.priorDocumentId ? await prisma.sourceDocument.findFirst({ where: { id: input.priorDocumentId, projectId } }) : null;
    if (input.priorDocumentId && !prior) throw new Error("Prior source document not found in project");
    context.document = { id: doc.id, checksum: doc.checksum, priorDocumentId: prior?.id, priorChecksum: input.priorChecksum ?? prior?.checksum, pageNumbers: input.pageNumbers };
    context.views = await prisma.evidenceView.findMany({ where: { projectId, documentId: { in: [doc.id, ...(prior ? [prior.id] : [])] } }, select: { id: true, sourceChecksum: true } });
  } else {
    const diff = await prisma.modelRevisionDiff.findFirst({ where: { id: input.diffId, projectId } });
    if (!diff) throw new Error("Model revision diff not found in project");
    context.diff = diff;
  }
  const pickups = await prisma.pickup.findMany({
    where: { projectId, ...(context.document ? { documentId: { in: [context.document.id, ...(context.document.priorDocumentId ? [context.document.priorDocumentId] : [])] }, ...(input.pageNumbers?.length ? { pageNumber: { in: input.pageNumbers } } : {}) } : { modelId: { in: [context.diff!.baseModelId, context.diff!.headModelId] } }) },
    include: { pickupLinks: { where: { projectId }, include: { worksheetItem: true } } },
  });
  return { source: context.document ?? { diffId: input.diffId, baseModelId: context.diff!.baseModelId, headModelId: context.diff!.headModelId }, ...revisionImpactForPickups(pickups, context) };
}
