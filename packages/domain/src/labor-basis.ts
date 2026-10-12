import { rollupWorksheetUnits } from "./worksheet-hours";
import { normalizeLineDerivation, validateLineDerivation } from "./line-derivation";

/** A rate-card price is not a productivity source; only a current, reproducible unit derivation qualifies. */
export function summarizeLaborBasis(workspace: any) {
  let sourcedHours = 0, assumedHours = 0;
  const unsourced: { id: string; label: string; hours: number; reason: string }[] = [];
  for (const worksheet of workspace.worksheets ?? []) for (const item of worksheet.items ?? []) {
    const hours = rollupWorksheetUnits([item], workspace.rateSchedules ?? [], workspace.entityCategories ?? []).labourHours.total;
    if (!hours) continue;
    const derivation = normalizeLineDerivation(item.derivation);
    const expected = derivation?.target === "tierUnits" ? Object.values(item.tierUnits ?? {}).reduce<number>((sum, value) => sum + Number(value || 0), 0) * Number(item.quantity ?? 1) : Number(item.quantity ?? 1);
    const sourced = item.laborUnitId && derivation && derivation.status !== "stale"
      && ["tierUnits", "quantity"].includes(derivation.target)
      && derivation.inputs.some((input) => input.source.kind === "laborUnit" && input.source.ref === item.laborUnitId)
      && !validateLineDerivation(derivation, { expectedValue: expected }).some((issue) => issue.severity === "error");
    if (sourced) sourcedHours += hours;
    else {
      assumedHours += hours;
      unsourced.push({ id: item.id, label: item.description || item.entityName, hours,
        reason: item.laborUnitId ? "Unit cited without a current reproducible hours derivation" : "No labour unit linked" });
    }
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return { sourcedHours: round(sourcedHours), assumedHours: round(assumedHours), totalHours: round(sourcedHours + assumedHours),
    sourcedPercent: sourcedHours + assumedHours ? round(100 * sourcedHours / (sourcedHours + assumedHours)) : null,
    topUnsourcedRows: unsourced.sort((a, b) => b.hours - a.hours).slice(0, 5),
    fact: "Row labour hours before estimate factors. Sourced means a linked labour unit and a current reproducible derivation; other hours are reported as assumed, including estimator judgments." };
}
