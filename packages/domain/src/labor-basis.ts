import { rollupWorksheetUnits } from "./worksheet-hours";
import { normalizeLineDerivation, validateLineDerivation, lineDerivationExpectedValue, formulaIdentifiers, evaluateDerivationFormula } from "./line-derivation";

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
    const baseline = derivation ? laborSourceBaseline(item, derivation) : null;
    const authoredHours = Number(lineDerivationExpectedValue("tierUnits", item)) * Number(item.quantity ?? 1);
    const factor = baseline && baseline > 0 ? authoredHours / baseline : NaN;
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
    fact: "Row labour hours before estimate factors. Sourced: current reproducible unit basis within ±10% of its normal hours. Adjusted: reproducible basis with a factor outside that range (reported per row, including additional operations above the linked normal-hours contribution). Assumed: no current reproducible source baseline." };
}

/** Evaluate the linked normal-hours contribution through the authored expression, retaining counts
 * and conversions. Other time inputs are zeroed; explicit dimensionless adjustments are neutral.
 * This handles sums, grouped operations and inverse conversions without naming count variables.
 * An unavailable/ambiguous baseline stays assumed; this fact never prevents a row write.
 */
function laborSourceBaseline(item: any, derivation: NonNullable<ReturnType<typeof normalizeLineDerivation>>): number | null {
  const used = new Set(formulaIdentifiers(derivation.formula));
  const inputs = derivation.inputs.filter(input => used.has(input.name));
  const hourRate = (unit?: string | null) => /^(?:(?:person|man)[ -]?)?(?:h|hr|hrs|hour|hours)\s*\/|^ph\s*\//i.test(unit ?? "");
  const linked = inputs.filter(input => input.source.kind === "laborUnit" && input.source.ref === item.laborUnitId && input.value > 0 && hourRate(input.unit));
  const current = item.laborUnitBasis;
  if (current === null) return null;
  // Older/offline snapshots can still establish one unambiguous cited baseline. Live workspaces
  // include the current unit, so changed or incorrectly attributed rates are not accepted.
  const primary = current
    ? linked.filter(input => current.id === item.laborUnitId && Math.abs(input.value - current.hoursNormal) <= Math.max(1e-8, Math.abs(current.hoursNormal) * 1e-6))
    : new Set(linked.map(input => input.value)).size === 1 ? linked : [];
  if (!primary.length) return null;
  const primaryNames = new Set(primary.map(input => input.name));
  const values: Record<string, number> = {};
  for (const input of inputs) {
    const adjustment = /^(factor|multiplier|ratio|dimensionless)$/i.test(input.unit ?? "")
      || (!input.unit && (input.source.ref === "authored-tier-units" || input.name === "factor"));
    values[input.name] = primaryNames.has(input.name) ? input.value
      : hourRate(input.unit) ? 0 : adjustment ? 1 : input.value;
  }
  try {
    const withSource = evaluateDerivationFormula(derivation.formula, values);
    const withoutSource = evaluateDerivationFormula(derivation.formula, { ...values, ...Object.fromEntries(primary.map(input => [input.name, 0])) });
    // tierUnits is per priced unit; a quantity-target trace is extended by its tier hours.
    const extension = derivation.target === "tierUnits" ? Number(item.quantity ?? 1) : Number(lineDerivationExpectedValue("tierUnits", item));
    const baseline = (withSource - withoutSource) * extension;
    return Number.isFinite(baseline) && baseline > 0 ? baseline : null;
  } catch { return null; }
}
