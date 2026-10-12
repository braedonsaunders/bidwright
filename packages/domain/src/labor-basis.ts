import { rollupWorksheetUnits } from "./worksheet-hours";
import { normalizeLineDerivation, validateLineDerivation } from "./line-derivation";

/** A rate-card price is not a productivity source; only a current, reproducible unit derivation qualifies. */
export function summarizeLaborBasis(workspace: any) {
  let sourcedHours = 0, adjustedHours = 0, assumedHours = 0;
  const adjusted: { id: string; label: string; hours: number; factor: number; laborUnitId: string }[] = [];
  const unsourced: { id: string; label: string; hours: number; reason: string }[] = [];
  for (const worksheet of workspace.worksheets ?? []) for (const item of worksheet.items ?? []) {
    const hours = rollupWorksheetUnits([item], workspace.rateSchedules ?? [], workspace.entityCategories ?? []).labourHours.total;
    if (!hours) continue;
    const derivation = normalizeLineDerivation(item.derivation);
    const expected = derivation?.target === "tierUnits" ? Object.values(item.tierUnits ?? {}).reduce<number>((sum, value) => sum + Number(value || 0), 0) * Number(item.quantity ?? 1) : Number(item.quantity ?? 1);
    const reproducible = item.laborUnitId && derivation && derivation.status !== "stale"
      && ["tierUnits", "quantity"].includes(derivation.target)
      && derivation.inputs.some((input) => input.source.kind === "laborUnit" && input.source.ref === item.laborUnitId)
      && !validateLineDerivation(derivation, { expectedValue: expected }).some((issue) => issue.severity === "error");
    // Compare actual hours with the source baseline, rather than accepting an arbitrary authored factor.
    const normal = derivation?.inputs.find(input => input.name === "hoursNormal" && input.source.kind === "laborUnit" && input.source.ref === item.laborUnitId)?.value;
    const conversion = derivation?.inputs.find(input => input.name === "conversion")?.value ?? 1;
    const baseline = Number(item.quantity) * Number(normal) * conversion;
    const factor = baseline > 0 ? hours / baseline : NaN;
    if (reproducible && Number.isFinite(factor) && factor > 0 && Math.abs(factor - 1) <= .100000001) sourcedHours += hours;
    else if (reproducible && Number.isFinite(factor) && factor > 0) {
      adjustedHours += hours;
      adjusted.push({ id: item.id, label: item.description || item.entityName, hours, factor, laborUnitId: item.laborUnitId });
    }
    else {
      assumedHours += hours;
      unsourced.push({ id: item.id, label: item.description || item.entityName, hours,
        reason: item.laborUnitId ? "Unit cited without a current reproducible hours derivation and source baseline" : "No labour unit linked" });
    }
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  const totalHours = sourcedHours + adjustedHours + assumedHours;
  return { sourcedHours: round(sourcedHours), adjustedHours: round(adjustedHours), assumedHours: round(assumedHours), totalHours: round(totalHours),
    sourcedPercent: totalHours ? round(100 * sourcedHours / totalHours) : null,
    adjustedPercent: totalHours ? round(100 * adjustedHours / totalHours) : null,
    adjustedRowCount: adjusted.length, topAdjustedRows: adjusted.sort((a, b) => b.hours - a.hours).slice(0, 5),
    topUnsourcedRows: unsourced.sort((a, b) => b.hours - a.hours).slice(0, 5),
    fact: "Row labour hours before estimate factors. Sourced: current reproducible unit basis within ±10% of its normal hours. Adjusted: reproducible basis with a factor outside that range (reported per row). Assumed: no current reproducible source baseline." };
}
