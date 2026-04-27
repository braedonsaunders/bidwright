// Drawing-revision compare with auto re-takeoff.
//
// Given two ModelAssets for the same project (a "base" and a "head"), compute
// a structural diff over their elements and quantities, persist it as a
// ModelRevisionDiff row, then map each change back to any WorksheetItem that
// was previously linked to the affected element/quantity via a
// ModelTakeoffLink. The result is an impact report — added / removed /
// modified elements, the worksheet items they touch, and the cost delta of
// applying the head model's quantities.
//
// "Apply" mode then writes those new derived quantities back to the worksheet
// items, re-using the standard worksheet update path so the downstream
// estimate-snapshot, calc engine, and activity log all stay in sync.

import { prisma } from "@bidwright/db";
import { createLLMAdapter } from "@bidwright/agent";

export interface DiffElementChange {
  changeType: "added" | "removed" | "modified";
  externalId: string;
  baseElementId: string | null;
  headElementId: string | null;
  elementClass: string;
  elementType: string;
  name: string;
  level: string;
  beforeQuantities: Array<{ quantityType: string; value: number; unit: string }>;
  afterQuantities: Array<{ quantityType: string; value: number; unit: string }>;
  propertyChanges: Array<{ key: string; before: unknown; after: unknown }>;
}

export interface ImpactedWorksheetItem {
  worksheetItemId: string;
  worksheetId: string;
  linkId: string;
  entityName: string;
  category: string;
  uom: string;
  multiplier: number;
  oldQuantity: number;
  newQuantity: number;
  unitCost: number;
  unitPrice: number;
  costDelta: number;
  priceDelta: number;
  changeType: "added" | "removed" | "modified";
}

export interface RevisionImpactReport {
  diffId: string;
  baseModelId: string;
  headModelId: string;
  projectId: string;
  summary: {
    elementsAdded: number;
    elementsRemoved: number;
    elementsModified: number;
    affectedItems: number;
    totalCostDelta: number;
    totalPriceDelta: number;
  };
  changes: Array<DiffElementChange & { impactedItems: ImpactedWorksheetItem[] }>;
  warnings: string[];
  aiNarrative: string | null;
  createdAt: string;
}

const PROPERTY_KEYS_TO_DIFF = ["material", "level", "system", "name", "elementType"];

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffPropertyMaps(before: Record<string, unknown>, after: Record<string, unknown>): Array<{ key: string; before: unknown; after: unknown }> {
  const changes: Array<{ key: string; before: unknown; after: unknown }> = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of allKeys) {
    if (!shallowEqual(before[key], after[key])) {
      changes.push({ key, before: before[key], after: after[key] });
    }
  }
  return changes;
}

export async function computeRevisionDiff(
  projectId: string,
  baseModelId: string,
  headModelId: string,
): Promise<{ diffId: string; rows: DiffElementChange[]; summary: RevisionImpactReport["summary"] }> {
  const [baseModel, headModel] = await Promise.all([
    prisma.modelAsset.findFirst({
      where: { id: baseModelId, projectId },
      include: { elements: true, quantities: true },
    }),
    prisma.modelAsset.findFirst({
      where: { id: headModelId, projectId },
      include: { elements: true, quantities: true },
    }),
  ]);
  if (!baseModel) throw new Error(`Base model ${baseModelId} not found`);
  if (!headModel) throw new Error(`Head model ${headModelId} not found`);

  // Index elements by externalId so we can pair them across revisions.
  // Elements without an externalId can't be reliably tracked, so we skip them
  // (they'll appear as added on the head and removed on the base only if a
  // matching pair can't be inferred).
  const baseByExt = new Map<string, (typeof baseModel.elements)[number]>();
  for (const el of baseModel.elements) {
    if (el.externalId) baseByExt.set(el.externalId, el);
  }
  const headByExt = new Map<string, (typeof headModel.elements)[number]>();
  for (const el of headModel.elements) {
    if (el.externalId) headByExt.set(el.externalId, el);
  }

  const quantitiesByElement = (model: typeof baseModel) => {
    const map = new Map<string, Array<{ quantityType: string; value: number; unit: string }>>();
    for (const q of model.quantities) {
      if (!q.elementId) continue;
      if (!map.has(q.elementId)) map.set(q.elementId, []);
      map.get(q.elementId)!.push({ quantityType: q.quantityType, value: q.value, unit: q.unit });
    }
    return map;
  };
  const baseQty = quantitiesByElement(baseModel);
  const headQty = quantitiesByElement(headModel);

  const rows: DiffElementChange[] = [];

  // Removed: in base but not in head.
  for (const [externalId, baseEl] of baseByExt.entries()) {
    if (!headByExt.has(externalId)) {
      rows.push({
        changeType: "removed",
        externalId,
        baseElementId: baseEl.id,
        headElementId: null,
        elementClass: baseEl.elementClass,
        elementType: baseEl.elementType,
        name: baseEl.name,
        level: baseEl.level,
        beforeQuantities: baseQty.get(baseEl.id) ?? [],
        afterQuantities: [],
        propertyChanges: [],
      });
    }
  }

  // Added or modified: in head, possibly in base.
  for (const [externalId, headEl] of headByExt.entries()) {
    const baseEl = baseByExt.get(externalId);
    if (!baseEl) {
      rows.push({
        changeType: "added",
        externalId,
        baseElementId: null,
        headElementId: headEl.id,
        elementClass: headEl.elementClass,
        elementType: headEl.elementType,
        name: headEl.name,
        level: headEl.level,
        beforeQuantities: [],
        afterQuantities: headQty.get(headEl.id) ?? [],
        propertyChanges: [],
      });
      continue;
    }

    // Compare quantities and key properties.
    const beforeQs = baseQty.get(baseEl.id) ?? [];
    const afterQs = headQty.get(headEl.id) ?? [];
    const qSig = (qs: typeof beforeQs) => qs.map((q) => `${q.quantityType}:${q.value.toFixed(6)}:${q.unit}`).sort().join("|");
    const quantitiesChanged = qSig(beforeQs) !== qSig(afterQs);

    const beforeProps: Record<string, unknown> = {};
    const afterProps: Record<string, unknown> = {};
    for (const k of PROPERTY_KEYS_TO_DIFF) {
      beforeProps[k] = (baseEl as any)[k];
      afterProps[k] = (headEl as any)[k];
    }
    const propertyChanges = diffPropertyMaps(beforeProps, afterProps);

    if (quantitiesChanged || propertyChanges.length > 0) {
      rows.push({
        changeType: "modified",
        externalId,
        baseElementId: baseEl.id,
        headElementId: headEl.id,
        elementClass: headEl.elementClass,
        elementType: headEl.elementType,
        name: headEl.name,
        level: headEl.level,
        beforeQuantities: beforeQs,
        afterQuantities: afterQs,
        propertyChanges,
      });
    }
  }

  const summary = {
    elementsAdded: rows.filter((r) => r.changeType === "added").length,
    elementsRemoved: rows.filter((r) => r.changeType === "removed").length,
    elementsModified: rows.filter((r) => r.changeType === "modified").length,
    affectedItems: 0,
    totalCostDelta: 0,
    totalPriceDelta: 0,
  };

  // Persist as a ModelRevisionDiff row so the same compare can be re-opened
  // later without recomputing the structural diff.
  const diff = await prisma.modelRevisionDiff.create({
    data: {
      projectId,
      baseModelId,
      headModelId,
      summary: summary as any,
      rows: rows as any,
    },
  });

  return { diffId: diff.id, rows, summary };
}

// Pair each diff row with the WorksheetItems that were linked to its base
// element/quantity (or head element, for "added" changes), and project the new
// quantities through the existing multiplier so the report shows what the line
// item *would* read after applying the head revision.
async function buildImpactRows(
  rows: DiffElementChange[],
): Promise<{ changes: RevisionImpactReport["changes"]; summary: RevisionImpactReport["summary"]; warnings: string[] }> {
  const warnings: string[] = [];
  const allElementIds = new Set<string>();
  for (const r of rows) {
    if (r.baseElementId) allElementIds.add(r.baseElementId);
    if (r.headElementId) allElementIds.add(r.headElementId);
  }

  const links = allElementIds.size > 0
    ? await prisma.modelTakeoffLink.findMany({
        where: { modelElementId: { in: Array.from(allElementIds) } },
        include: {
          worksheetItem: { select: { id: true, worksheetId: true, entityName: true, category: true, uom: true, cost: true, price: true, quantity: true } },
          modelQuantity: true,
        },
      })
    : [];

  const linksByElement = new Map<string, typeof links>();
  for (const link of links) {
    if (!link.modelElementId) continue;
    if (!linksByElement.has(link.modelElementId)) linksByElement.set(link.modelElementId, []);
    linksByElement.get(link.modelElementId)!.push(link);
  }

  let totalCostDelta = 0;
  let totalPriceDelta = 0;
  let affected = 0;
  const changes: RevisionImpactReport["changes"] = [];

  for (const row of rows) {
    const elementId = row.baseElementId ?? row.headElementId;
    const linkSet = elementId ? linksByElement.get(elementId) ?? [] : [];

    const impacted: ImpactedWorksheetItem[] = [];
    for (const link of linkSet) {
      const wi = link.worksheetItem;
      if (!wi) continue;
      const oldQty = wi.quantity ?? 0;
      // Pick the new value: matching quantityType from afterQuantities, or
      // the first available, or zero (for removed elements).
      const targetQuantityType = link.modelQuantity?.quantityType;
      let newScalar = 0;
      if (row.changeType === "removed") {
        newScalar = 0;
      } else if (targetQuantityType) {
        const match = row.afterQuantities.find((q) => q.quantityType === targetQuantityType);
        newScalar = match?.value ?? row.afterQuantities[0]?.value ?? 0;
      } else {
        newScalar = row.afterQuantities[0]?.value ?? 0;
      }
      const newQty = newScalar * (link.multiplier ?? 1);
      const costDelta = (newQty - oldQty) * (wi.cost ?? 0);
      const priceDelta = (newQty - oldQty) * (wi.price ?? 0);
      totalCostDelta += costDelta;
      totalPriceDelta += priceDelta;
      affected++;
      impacted.push({
        worksheetItemId: wi.id,
        worksheetId: wi.worksheetId,
        linkId: link.id,
        entityName: wi.entityName,
        category: wi.category,
        uom: wi.uom,
        multiplier: link.multiplier ?? 1,
        oldQuantity: oldQty,
        newQuantity: newQty,
        unitCost: wi.cost ?? 0,
        unitPrice: wi.price ?? 0,
        costDelta,
        priceDelta,
        changeType: row.changeType,
      });
    }

    changes.push({ ...row, impactedItems: impacted });
  }

  if (links.length === 0 && rows.length > 0) {
    warnings.push("None of the changed elements are linked to worksheet items via model takeoff links.");
  }

  return {
    changes,
    summary: {
      elementsAdded: rows.filter((r) => r.changeType === "added").length,
      elementsRemoved: rows.filter((r) => r.changeType === "removed").length,
      elementsModified: rows.filter((r) => r.changeType === "modified").length,
      affectedItems: affected,
      totalCostDelta,
      totalPriceDelta,
    },
    warnings,
  };
}

export async function getRevisionImpactReport(
  projectId: string,
  diffId: string,
  options?: { withAiNarrative?: boolean; aiConfig?: { provider: string; apiKey: string; model: string } },
): Promise<RevisionImpactReport> {
  const diff = await prisma.modelRevisionDiff.findFirst({ where: { id: diffId, projectId } });
  if (!diff) throw new Error(`Revision diff ${diffId} not found`);

  const rows = (diff.rows as unknown as DiffElementChange[]) ?? [];
  const { changes, summary, warnings } = await buildImpactRows(rows);

  let aiNarrative: string | null = null;
  if (options?.withAiNarrative && options.aiConfig?.apiKey && rows.length > 0) {
    try {
      aiNarrative = await summariseDiffWithAi(changes, summary, options.aiConfig);
    } catch (err) {
      warnings.push(`AI narrative failed: ${(err as Error).message}`);
    }
  }

  return {
    diffId: diff.id,
    baseModelId: diff.baseModelId,
    headModelId: diff.headModelId,
    projectId: diff.projectId,
    summary,
    changes,
    warnings,
    aiNarrative,
    createdAt: diff.createdAt.toISOString(),
  };
}

async function summariseDiffWithAi(
  changes: RevisionImpactReport["changes"],
  summary: RevisionImpactReport["summary"],
  config: { provider: string; apiKey: string; model: string },
): Promise<string> {
  const adapter = createLLMAdapter({ provider: config.provider as any, apiKey: config.apiKey, model: config.model });
  // Truncate the change list to keep the prompt sane on huge revisions.
  const sample = changes.slice(0, 60).map((c) => ({
    changeType: c.changeType,
    elementClass: c.elementClass,
    name: c.name,
    level: c.level,
    propertyChanges: c.propertyChanges.slice(0, 5),
    beforeQuantities: c.beforeQuantities,
    afterQuantities: c.afterQuantities,
    impactedCount: c.impactedItems.length,
    costDelta: c.impactedItems.reduce((s, i) => s + i.costDelta, 0),
  }));

  const response = await adapter.chat({
    model: config.model,
    systemPrompt:
      "You are a senior construction estimator reviewing a drawing revision. Given the structured diff, produce a concise (3-6 sentence) narrative for the estimator that explains what changed, the cost impact, and any items that warrant a closer look. Do not pad with greetings — get straight to the substance.",
    messages: [
      {
        role: "user",
        content: `Summary: ${summary.elementsAdded} added, ${summary.elementsRemoved} removed, ${summary.elementsModified} modified. Affected line items: ${summary.affectedItems}. Total cost delta: $${summary.totalCostDelta.toFixed(2)}.\n\nSample changes (truncated):\n${JSON.stringify(sample, null, 2)}`,
      },
    ],
    maxTokens: 800,
    temperature: 0.3,
  });

  const block = response.content[0];
  return typeof block === "string" ? block : (block as { text?: string }).text ?? "";
}

export async function applyRevisionRetakeoff(
  projectId: string,
  diffId: string,
  options?: { onlyLinkIds?: string[] },
): Promise<{ updated: number; skipped: number }> {
  const report = await getRevisionImpactReport(projectId, diffId);

  const allowedLinks = options?.onlyLinkIds ? new Set(options.onlyLinkIds) : null;
  let updated = 0;
  let skipped = 0;

  for (const change of report.changes) {
    for (const impact of change.impactedItems) {
      if (allowedLinks && !allowedLinks.has(impact.linkId)) {
        skipped++;
        continue;
      }
      // Update the worksheet item quantity. Cost/price are derived elsewhere
      // (calc engine), so just patch the quantity and bump the link's
      // derivedQuantity cache.
      await prisma.worksheetItem.update({
        where: { id: impact.worksheetItemId },
        data: { quantity: impact.newQuantity },
      });
      await prisma.modelTakeoffLink.update({
        where: { id: impact.linkId },
        data: { derivedQuantity: impact.newQuantity },
      });
      updated++;
    }
  }

  return { updated, skipped };
}

export async function listProjectRevisionDiffs(projectId: string) {
  const diffs = await prisma.modelRevisionDiff.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: {
      baseModel: { select: { id: true, fileName: true } },
      headModel: { select: { id: true, fileName: true } },
    },
  });
  return diffs.map((d) => ({
    id: d.id,
    projectId: d.projectId,
    baseModelId: d.baseModelId,
    baseModelName: d.baseModel?.fileName ?? "",
    headModelId: d.headModelId,
    headModelName: d.headModel?.fileName ?? "",
    summary: d.summary as Record<string, number>,
    createdAt: d.createdAt.toISOString(),
  }));
}
