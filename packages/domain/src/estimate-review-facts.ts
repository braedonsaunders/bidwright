import { resolveRateCurrency } from "./rate-book-pricing";
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
  const rows = (workspace.worksheets ?? []).flatMap((sheet: any) => sheet.items ?? []).map((row: any) => ({
    row, references: new Set(JSON.stringify([row.derivation, row.sourceEvidence]).split(/[^a-zA-Z0-9_-]+/)), dimension: quantityDimension(row.uom), terms: words(label(row)),
    evidence: JSON.stringify([row.sourceEvidence, row.derivation?.inputs?.map((i: any) => i.source)]),
  }));
  const linked = new Set((workspace.pickupLinks ?? []).map((link: any) => link.pickupId));
  const unlinked = pickups.filter(p => !linked.has(p.id) && !p.linkedRows?.length && !p._count?.pickupLinks
    && !/note|text|calibrat|highlight|arrow|cloud/i.test(p.annotationType ?? "")
    && number(p.measurement?.value) !== null && typeof p.measurement?.unit === "string");
  const rowLinks = new Set((workspace.pickupLinks ?? []).map((link: any) => `${link.pickupId}:${link.itemId}`));
  const snapshotDependencies = pickups.flatMap(p => rows.flatMap(({ row, references, evidence, dimension }: any) => {
    if (rowLinks.has(`${p.id}:${row.id}`)) return [];
    const explicit = references.has(p.id);
    const sameValue = number(p.measurement?.value) !== null && number(row.quantity) === p.measurement.value;
    const compatible = !!dimension && dimension === quantityDimension(p.measurement?.unit);
    const sameSource = !!p.documentId && evidence.includes(p.documentId);
    if (!explicit && !(sameValue && compatible && sameSource)) return [];
    return [{ rowId: row.id, label: label(row), pickupId: p.id, quantity: p.measurement?.value, unit: p.measurement?.unit,
      basis: explicit ? "pickup cited without live link" : "same-source quantity equals pickup; possible snapshot copy",
      fact: "updateWorksheetItem accepts takeoff:[{pickupId, multiplier?}]. Partial measurements or formulas with allowances need an explicit conversion/combined quantity basis; a direct link replaces the row quantity." }];
  }));
  return { snapshotDependencies: { count: snapshotDependencies.length, rows: snapshotDependencies.slice(0, 20) }, count: unlinked.length, shown: Math.min(20, unlinked.length), pickups: unlinked.slice(0, 20).map(p => {
    const dimension = quantityDimension(p.measurement?.unit), terms = words(p.label ?? "");
    const candidates = rows.flatMap(({ row, dimension: rowDimension, terms: rowTerms, evidence }: any) => {
      if (!dimension || dimension !== rowDimension) return [];
      const sameSource = !!p.documentId && evidence.includes(p.documentId);
      const matches = [...rowTerms].filter(term => terms.has(term));
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
  const staleEvidence: any[] = [], durationChecks: any[] = [];
  const hours = (row: any) => rollupWorksheetUnits([row], workspace.rateSchedules ?? [], workspace.entityCategories ?? []).labourHours.total;
  for (const sheet of workspace.worksheets ?? []) {
    const items = sheet.items ?? [];
    for (const row of items) {
      const quantity = number(row.quantity) ?? 0;
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
        const tierTotal = Object.values(row.tierUnits ?? {}).reduce<number>((n, x) => n + Number(x || 0), 0);
        const current = quantity * (tierTotal || 1);
        if (unit === durationUnit(String(row.uom)) && Math.abs(saved - current) > .01) differences.push({ field: `extended ${unit}`, savedEvidence: saved, current });
      }
      if (row.derivation?.status === "stale") differences.push({ field: "derivation", savedEvidence: "stale", current: row.derivation.invalidatedBy ?? [] });
      if (differences.length) staleEvidence.push({ rowId: row.id, label: label(row), status: "stale evidence", differences, evidence: text.slice(0, 350), fact: "Saved evidence numbers differ from current values; review their intended scope." });
    }
  }
  durationChecks.push(...summarizeDurationCoverage(workspace));
  const quoteCurrency = resolveRateCurrency(workspace.quoteCurrency ?? workspace.revision?.currency ?? workspace.currentRevision?.currency ?? workspace.quote?.currency);
  const rateCurrencies = (workspace.worksheets ?? []).flatMap((sheet: any) => (sheet.items ?? []).filter((row: any) => row.rateScheduleItemId || row.rateResolution || row.costSnapshot?.currency).map((row: any) => {
    const book = (workspace.rateSchedules ?? []).find((s: any) => s.id === row.rateResolution?.rateBookId || s.items?.some((i: any) => i.id === row.rateScheduleItemId));
    const sourceCurrency = book ? resolveRateCurrency(book.metadata?.currency, book.sourceCurrency ?? quoteCurrency)
      : resolveRateCurrency(row.rateResolution?.currency ?? row.costSnapshot?.currency, quoteCurrency);
    return { rowId: row.id, label: label(row), sourceCurrency, quoteCurrency, status: "currency differs" };
  }));
  const currencyRows = rateCurrencies.filter((row: any) => row.sourceCurrency && quoteCurrency && row.sourceCurrency !== quoteCurrency);
  const unknownCount = rateCurrencies.filter((row: any) => !row.sourceCurrency).length;
  return { currency: { quoteCurrency: quoteCurrency ?? "unknown", count: currencyRows.length, unknownCount, unknownSummary: unknownCount ? `Rate currency unknown for ${unknownCount} rows; set the org or rate-book currency.` : null, rows: currencyRows.slice(0, 20), fact: "Quote currency follows organization settings. Source currencies are not converted. Different or unknown source/quote currencies need an explicit pricing basis." },
    staleEvidence: { count: staleEvidence.length, rows: staleEvidence.sort((a, b) => Number(b.differences.some((d: any) => d.field !== "derivation")) - Number(a.differences.some((d: any) => d.field !== "derivation"))).slice(0, 10) }, durationChecks: durationChecks.slice(0, 10),
    fact: "Advisory facts before estimate factors. No quote values were changed. Unstructured prose beyond explicit numeric drivers may need an independent review." };
}

/** Cross-worksheet support scope is explicit where available, otherwise labelled as a comparison. */
export function summarizeDurationCoverage(workspace: any) {
  const rows = (workspace.worksheets ?? []).flatMap((sheet: any) => (sheet.items ?? []).map((row: any) => ({ ...row, worksheetId: sheet.id })));
  const hours = (row: any) => rollupWorksheetUnits([row], workspace.rateSchedules ?? [], workspace.entityCategories ?? []).labourHours.total;
  const support = rows.filter((row: any) => getWorksheetUnitKind(row, workspace.entityCategories ?? []) === "equipment_duration" || /foreman|supervis/i.test(label(row)));
  return support.map((row: any) => {
    const basis = row.sourceEvidence?.durationBasis ?? {};
    const production = rows.filter((r: any) => hours(r) > 0 && !support.includes(r)
      && (!Array.isArray(basis.supportsWorksheetIds) || basis.supportsWorksheetIds.includes(r.worksheetId))
      && (!Array.isArray(basis.supportsRowIds) || basis.supportsRowIds.includes(r.id)));
    const inputs = [row, ...production].flatMap((r: any) => r.derivation?.inputs ?? []);
    const value = (name: string) => {
      if (number(basis[name]) !== null) return basis[name] > 0 ? basis[name] : null;
      const values = [...new Set(inputs.filter((i: any) => i.name === name && i.value > 0).map((i: any) => i.value))];
      return values.length === 1 ? Number(values[0]) : null;
    };
    const crewSize = value("crewSize"), shiftHours = value("shiftHours"), workdaysPerWeek = value("workdaysPerWeek");
    const productionHours = production.reduce((sum: number, r: any) => sum + hours(r), 0);
    const requiredDays = crewSize && shiftHours ? productionHours / crewSize / shiftHours : null;
    const tierTotal = Object.values(row.tierUnits ?? {}).reduce<number>((sum, n) => sum + Number(n || 0), 0);
    const schedule = (workspace.rateSchedules ?? []).find((s: any) => s.items?.some((i: any) => i.id === row.rateScheduleItemId));
    const populatedTiers = (schedule?.tiers ?? []).filter((t: any) => Number(row.tierUnits?.[t.id]) > 0);
    const units = [...new Set(populatedTiers.map((t: any) => String(t.uom ?? "").toUpperCase()))];
    const unit = units.length > 1 ? "mixed (not converted)" : units.length === 1 ? String(units[0]) : String(row.uom ?? "").toUpperCase();
    const durationPerUnit = tierTotal || Number(row.quantity ?? 0);
    const coverageDays = /^(DAY|DAYS|D)$/.test(unit) ? durationPerUnit : /^(WK|WEEK|WEEKS)$/.test(unit) && workdaysPerWeek ? durationPerUnit * workdaysPerWeek : /^(H|HR|HOUR|HOURS)$/.test(unit) && shiftHours ? durationPerUnit / shiftHours : null;
    return { rowId: row.id, label: label(row), worksheetId: row.worksheetId, productionHours: round(productionHours),
      scope: basis.supportsRowIds || basis.supportsWorksheetIds ? "authored support scope" : "project-wide comparison; support scope unconfirmed",
      crewSize, shiftHours, workdaysPerWeek, durationPerUnit, unit, coverageDays,
      requiredDays: requiredDays === null ? null : round(requiredDays), differs: coverageDays !== null && requiredDays !== null ? Math.abs(coverageDays-requiredDays) > .1 : null,
      fact: "Different durations may reflect partial attendance or shared equipment. sourceEvidence.durationBasis can record supportsWorksheetIds/supportsRowIds and an authored crew/calendar; no workweek or crew size is assumed." };
  });
}
