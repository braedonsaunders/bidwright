import { rollupWorksheetUnits } from "./worksheet-hours";
import { normalizeLineDerivation, validateLineDerivation, lineDerivationExpectedValue, formulaIdentifiers, uomsEquivalent } from "./line-derivation";

/** A rate-card price is not a productivity source; only a current, reproducible unit derivation qualifies. */
export function summarizeLaborBasis(workspace: any) {
  let sourcedHours = 0, adjustedHours = 0, assumedHours = 0;
  const adjusted: { id: string; label: string; hours: number; factor: number; laborUnitId: string }[] = [];
  const unsourced: { id: string; label: string; hours: number; reason: string }[] = [];
  for (const worksheet of workspace.worksheets ?? []) for (const item of worksheet.items ?? []) {
    const hours = rollupWorksheetUnits([item], workspace.rateSchedules ?? [], workspace.entityCategories ?? []).labourHours.total;
    if (!hours) continue;
    const derivation = normalizeLineDerivation(item.derivation);
    const expected = derivation ? lineDerivationExpectedValue(derivation.target, item) : null;
    const reproducible = item.laborUnitId && derivation && derivation.status !== "stale"
      && ["tierUnits", "quantity"].includes(derivation.target)
      && derivation.inputs.some((input) => input.source.kind === "laborUnit" && input.source.ref === item.laborUnitId)
      && !validateLineDerivation(derivation, { expectedValue: expected }).some((issue) => issue.severity === "error");
    // Compare actual hours with the source baseline, rather than accepting an arbitrary authored factor.
    const used = new Set(formulaIdentifiers(derivation?.formula ?? ""));
    const sources = derivation?.inputs.filter(input => used.has(input.name) && input.source.kind === "laborUnit" && input.source.ref === item.laborUnitId && input.value > 0) ?? [];
    // Source identity and units matter, not the agent's variable name (baseline, hoursNormal, ...).
    const source = sources.length === 1 ? sources[0] : undefined;
    const outputUom = source?.unit?.match(/^(?:h|hr|hrs|hours?)\s*\/\s*(.+)$/i)?.[1];
    const conversion = derivation?.inputs.find(input => used.has(input.name) && input.name === "conversion")?.value ?? 1;
    const counts = outputUom ? derivation?.inputs.filter(input => used.has(input.name) && input !== source && input.unit && uomsEquivalent(input.unit, outputUom)) ?? [] : [];
    // Total-hours rows can carry the installed count inside the formula: joints × baseline × factor.
    // Otherwise a per-unit trace uses the priced row's installed quantity (and explicit conversion).
    const count = counts.length === 1 ? counts[0].value * (derivation?.target === "tierUnits" ? Number(item.quantity ?? 1) : 1)
      : derivation?.target === "tierUnits" && (conversion !== 1 || (outputUom && item.uom && uomsEquivalent(item.uom, outputUom))) ? Number(item.quantity ?? 1) * conversion : NaN;
    const baseline = count * Number(source?.value);
    const authoredHours = Number(lineDerivationExpectedValue("tierUnits", item)) * Number(item.quantity ?? 1);
    const factor = baseline > 0 ? authoredHours / baseline : NaN;
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
