import { getWorksheetUnitKind, rollupWorksheetUnits } from "./worksheet-hours";

const round = (n: number) => Math.round(n * 100) / 100;
const label = (row: any) => row.description || row.entityName || row.id;
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const words = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
export function quantityDimension(unit: unknown) {
  const u = String(unit ?? "").toUpperCase().replace(/\s/g, "");
  if (["M", "LM", "MM", "CM", "FT", "LF", "IN", "YD"].includes(u)) return "length";
  if (["M2", "M²", "SM", "FT2", "FT²", "SF", "SY", "YD2"].includes(u)) return "area";
  if (["M3", "M³", "FT3", "FT³", "CF", "CY", "YD3"].includes(u)) return "volume";
  if (["EA", "EACH", "PC", "PCS", "COUNT"].includes(u)) return "count";
  return "";
}

/** Candidates are suggestions, never automatic links or implicit unit conversions. */
export function summarizeUnlinkedMeasurements(workspace: any, pickups: any[]) {
  const rows = (workspace.worksheets ?? []).flatMap((sheet: any) => sheet.items ?? []);
  const linked = new Set((workspace.pickupLinks ?? []).map((link: any) => link.pickupId));
  const unlinked = pickups.filter(p => !linked.has(p.id) && !p.linkedRows?.length);
  return { count: unlinked.length, shown: Math.min(20, unlinked.length), pickups: unlinked.slice(0, 20).map(p => {
    const dimension = quantityDimension(p.measurement?.unit), terms = words(p.label ?? "");
    const candidates = rows.flatMap((row: any) => {
      if (!dimension || dimension !== quantityDimension(row.uom)) return [];
      const evidence = JSON.stringify([row.sourceEvidence, row.derivation?.inputs?.map((i: any) => i.source)]);
      const sameSource = !!p.documentId && evidence.includes(p.documentId);
      const matches = [...words(label(row))].filter(term => terms.has(term));
      if (!sameSource && !matches.length) return [];
      return [{ rowId: row.id, label: label(row), quantity: row.quantity, unit: row.uom, sameSource, matchedTerms: matches,
        conversion: String(row.uom).toLowerCase() === String(p.measurement.unit).toLowerCase() ? "same unit" : "explicit multiplier needed for conversion",
        score: (sameSource ? 10 : 0) + matches.length }];
    }).sort((a: any, b: any) => b.score - a.score).slice(0, 3);
    return { pickupId: p.id, label: p.label, documentId: p.documentId, quantity: p.measurement?.value, unit: p.measurement?.unit, candidates };
  }), fact: "Unlinked marks do not drive row quantities. updateWorksheetItem accepts takeoff:[{pickupId, multiplier?}]; candidates are label/source and dimension matches, not verified scope matches. listPickups provides the full list." };
}

/** Deterministic facts from saved values. Prose comparisons are explicitly labelled for review. */
export function summarizePricingIntegrity(workspace: any) {
  const costUnknown: any[] = [], staleEvidence: any[] = [], durationChecks: any[] = [];
  const hours = (row: any) => rollupWorksheetUnits([row], workspace.rateSchedules ?? [], workspace.entityCategories ?? []).labourHours.total;
  const plan = workspace.estimateStrategy?.executionPlan ?? {};
  const planText = JSON.stringify(plan);
  for (const sheet of workspace.worksheets ?? []) {
    const items = sheet.items ?? [];
    for (const row of items) {
      const quantity = number(row.quantity) ?? 0, cost = number(row.cost), price = number(row.price);
      // Worksheet price is already extended by the quote engine.
      const sell = price ?? 0;
      if (sell > 0 && (cost === null || cost === 0)) costUnknown.push({ rowId: row.id, label: label(row), status: "cost unknown", sell: round(sell), recordedCost: cost,
        marginImpact: { recordedProfit: round(sell), profitIfCostEqualsSell: 0, profitReductionIfCostEqualsSell: round(sell) },
        fact: "Zero or absent cost is not proof of free/owned supply; cost-equals-sell is a sensitivity, not a vendor price." });
      const evidence = row.sourceEvidence?.evidenceBasis?.quantity ?? {};
      const text = [evidence.rationale, evidence.quantityDriver].filter(Boolean).join("; ");
      const differences: any[] = [];
      // Compare an explicit extended driver, or a standalone total. A rate such
      // as "0.5 person-hours/output unit" is not itself the row's total hours.
      const hourDriver = /^\s*(\d+(?:\.\d+)?)\s+[^×*]*[×*]\s*(\d+(?:\.\d+)?)\s*person[- ]?hours\s*\//i.exec(evidence.quantityDriver ?? "");
      const hourTotal = /^\s*(\d+(?:\.\d+)?)\s+person[- ]?hours\b(?!\s*(?:\/|per\b))/i.exec(evidence.rationale ?? "");
      const savedHours = hourDriver ? Number(hourDriver[1]) * Number(hourDriver[2]) : hourTotal ? Number(hourTotal[1]) : null;
      const currentHours = hours(row);
      if (savedHours !== null && currentHours > 0 && Math.abs(savedHours - currentHours) > Math.max(.1, currentHours * .01)) {
        differences.push({ field: "labourHours", savedEvidence: round(savedHours), current: currentHours });
      }
      const driver = /\b(\d+(?:\.\d+)?)\s*(?:units?|each)\s*[×x*]\s*(\d+(?:\.\d+)?)\s*(WK|weeks?|days?|HR|hours?|MO|months?)\b/i.exec(evidence.quantityDriver ?? "");
      if (driver) {
        const durationUnit = (unit: string) => /^(WK|weeks?)$/i.test(unit) ? "WK" : /^days?$/i.test(unit) ? "DAY" : /^(HR|hours?)$/i.test(unit) ? "HR" : /^(MO|months?)$/i.test(unit) ? "MO" : unit.toUpperCase();
        const unit = durationUnit(driver[3]);
        const saved = Number(driver[1]) * Number(driver[2]);
        const current = quantity * Object.values(row.tierUnits ?? {}).reduce<number>((n, x) => n + Number(x || 0), 0);
        if (unit === durationUnit(String(row.uom)) && Math.abs(saved - current) > .01) differences.push({ field: `extended ${unit}`, savedEvidence: saved, current });
      }
      if (row.derivation?.status === "stale") differences.push({ field: "derivation", savedEvidence: "stale", current: row.derivation.invalidatedBy ?? [] });
      if (differences.length) staleEvidence.push({ rowId: row.id, label: label(row), status: "stale evidence", differences, evidence: text.slice(0, 350), fact: "Saved evidence numbers differ from current values; review their intended scope." });
    }
    const supervision = items.filter((i: any) => /foreman|supervis/i.test(label(i)) && hours(i) > 0);
    const production = items.filter((i: any) => hours(i) > 0 && !supervision.includes(i));
    const productionHours = production.reduce((n: number, i: any) => n + hours(i), 0);
    if (!productionHours) continue;
    // No tenant-specific workweek or crew defaults. Use authored numeric drivers only.
    const inputs = items.flatMap((i: any) => i.derivation?.inputs ?? []);
    const shiftHours = Number(inputs.find((i: any) => /^shiftHours$/i.test(i.name))?.value
      ?? /\b(\d+(?:\.\d+)?)\s*h(?:ours?)?\s+(?:regular|weekday|shift)/i.exec(planText)?.[1]) || null;
    const crewSize = Number(inputs.find((i: any) => /^crewSize$/i.test(i.name))?.value) || null;
    const phase = /\b(shop|field)\b/i.exec(sheet.name ?? "")?.[1];
    const plannedDays = phase ? Number(new RegExp(`${phase}[^.]{0,50}?(\\d+(?:\\.\\d+)?)\\s*(?:crew-)?days`, "i").exec(planText)?.[1]) || null : null;
    const requiredDays = shiftHours && crewSize ? productionHours / shiftHours / crewSize : plannedDays;
    const supervisionRows = supervision.map((i: any) => ({ rowId: i.id, label: label(i), hours: hours(i), coverageDaysAtOnePerson: shiftHours ? round(hours(i) / shiftHours) : null }));
    const workdaysPerWeek = Number(inputs.find((i: any) => /^workdaysPerWeek$/i.test(i.name))?.value) || null;
    const rentals = items.filter((i: any) => getWorksheetUnitKind(i, workspace.entityCategories ?? []) === "equipment_duration").map((i: any) => {
      const durationPerUnit = Object.values(i.tierUnits ?? {}).reduce<number>((n, x) => n + Number(x || 0), 0);
      const unit = String(i.uom ?? "").toUpperCase();
      const coverageDays = ["DAY", "DAYS", "D"].includes(unit) ? durationPerUnit
        : ["WK", "WEEK"].includes(unit) && workdaysPerWeek ? durationPerUnit * workdaysPerWeek
        : ["HR", "H", "HOUR"].includes(unit) && shiftHours ? durationPerUnit / shiftHours : null;
      return { rowId: i.id, label: label(i), quantity: i.quantity, durationPerUnit, unit: i.uom, coverageDays };
    });
    const coverage = [...supervisionRows.map((x: any) => ({ rowId: x.rowId, coverageDays: x.coverageDaysAtOnePerson })), ...rentals];
    const differences = requiredDays ? coverage.filter(x => x.coverageDays !== null && Math.abs(x.coverageDays - requiredDays) > .1)
      .map(x => ({ rowId: x.rowId, coverageDays: round(x.coverageDays!), plannedOrDerivedDays: round(requiredDays) })) : [];
    if (supervisionRows.length || rentals.length) durationChecks.push({ worksheetId: sheet.id, label: sheet.name, productionHours: round(productionHours), crewSize, shiftHours,
      requiredDays: requiredDays ? round(requiredDays) : null, requiredDaysBasis: crewSize ? "production hours / authored crew size / shift hours" : plannedDays ? "authored execution plan" : "not specified",
      supervision: supervisionRows, rentals, workdaysPerWeek, differences,
      fact: "Coverage is a comparison, not a requirement for full-time supervision. Rental weeks/months are not converted to workdays without an authored calendar; partial attendance and equipment-sharing may explain differences." });
  }
  const exposedSell = costUnknown.reduce((n, row) => n + row.sell, 0);
  return { costUnknown: { count: costUnknown.length, sell: round(exposedSell), rows: costUnknown.slice(0, 10), marginFact: `Profit is sensitive to missing costs on ${round(exposedSell)} of row sell. Each added cost dollar reduces profit by one dollar; current markup is unchanged.` },
    staleEvidence: { count: staleEvidence.length, rows: staleEvidence.sort((a, b) => Number(b.differences.some((d: any) => d.field !== "derivation")) - Number(a.differences.some((d: any) => d.field !== "derivation"))).slice(0, 10) }, durationChecks: durationChecks.slice(0, 10),
    fact: "Advisory facts before estimate factors. No quote values were changed. Unstructured prose beyond explicit numeric drivers may need an independent review." };
}
