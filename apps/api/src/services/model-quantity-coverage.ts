import { prismaSql, type Prisma } from "@bidwright/db";

// Keep overview and manifest counts on the same persisted data, including APS,
// geometry-derived and IFC quantities. A quantityless container is not a denominator.
export function modelQuantityFacts(modelId: Prisma.Sql) {
  return prismaSql`jsonb_build_object(
    'elementCount', (SELECT count(*)::int FROM "ModelElement" e WHERE e."modelId" = ${modelId}),
    'estimateRelevantElementCount', (SELECT count(*)::int FROM "ModelElement" e
      WHERE e."modelId" = ${modelId} AND e.properties->'estimateRelevant' IS DISTINCT FROM 'false'::jsonb),
    'quantityElementCount', (SELECT count(*)::int FROM "ModelElement" e
      WHERE e."modelId" = ${modelId} AND e.properties->'estimateRelevant' IS DISTINCT FROM 'false'::jsonb
        AND EXISTS (SELECT 1 FROM "ModelQuantity" q WHERE q."modelId" = ${modelId} AND q."elementId" = e.id)),
    'quantityCount', (SELECT count(*)::int FROM "ModelQuantity" q WHERE q."modelId" = ${modelId}),
    'quantityMethods', (SELECT COALESCE(jsonb_object_agg(method, count), '{}'::jsonb) FROM (
      SELECT q.method, count(*)::int AS count FROM "ModelQuantity" q WHERE q."modelId" = ${modelId} GROUP BY q.method
    ) methods)
  )`;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

export function buildModelQuantityCoverage(facts: Record<string, unknown>, format: string, status: string) {
  const elementCount = count(facts.elementCount);
  const estimateRelevantElementCount = count(facts.estimateRelevantElementCount);
  const quantityElementCount = count(facts.quantityElementCount);
  const quantityCount = count(facts.quantityCount);
  const available = status === "indexed" || status === "partial";
  const quantityCoveragePercent = available && estimateRelevantElementCount !== null && estimateRelevantElementCount > 0
    && quantityElementCount !== null ? 100 * quantityElementCount / estimateRelevantElementCount : null;
  const methods = facts.quantityMethods && typeof facts.quantityMethods === "object" ? facts.quantityMethods : {};
  const quantitySources = Object.entries(methods).map(([method, value]) => ({
    method, count: count(value),
    label: method === "aps_model_derivative_property"
      ? `authored ${["nwd", "nwf", "nwc"].includes(format.toLowerCase()) ? "Navisworks" : "Autodesk model"} properties`
      : method === "ifc_declared_quantity" ? "authored IFC quantities" : method.replaceAll("_", " ") || "unrecorded source",
  })).sort((a, b) => a.method.localeCompare(b.method));
  const n = (value: number) => value.toLocaleString("en-US");
  let summary = "quantity coverage unknown";
  if (available && quantityCount !== null && quantityElementCount !== null && estimateRelevantElementCount !== null) {
    summary = `${n(quantityCount)} quantities; ${n(quantityElementCount)} of ${n(estimateRelevantElementCount)} estimate-relevant elements have quantities`;
    if (quantityCoveragePercent !== null) summary += ` (${Number(quantityCoveragePercent.toFixed(1))}%)`;
    else summary += " (coverage not applicable)";
    if (quantitySources.length) summary += `; sources: ${quantitySources.map(s => `${s.label}${s.count === null ? "" : ` (${n(s.count)})`}`).join(", ")}`;
  }
  return { elementCount, estimateRelevantElementCount, quantityElementCount, quantityCount, quantityCoveragePercent, quantitySources, summary };
}
