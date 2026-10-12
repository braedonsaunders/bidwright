import { buildEstimatorSearchProfile, estimatorTermMatches, normalizeEstimatorSearchText, scoreEstimatorSearchText, type SearchProfile } from "./estimator-search.js";

/** Row identity and the selected column describe the task; repeated table headings describe context. */
export function laborSearchText(unit: any) {
  const ref = unit.sourceRef ?? {};
  const dimensions = Array.isArray(ref.rowDimensions) ? ref.rowDimensions : [];
  const identity = dimensions.filter((d: any, index: number) => index === 0 || /(?:item|task|operation|description|size|diam|nps|material|schedule|spec|thick|gauge|length|width|height|rating|capacity)/i.test(String(d.label ?? d.key ?? "")))
    .map((d: any) => `${d.label ?? d.key ?? ""} ${d.value ?? ""}`);
  const name = String(dimensions[0]?.value ?? unit.name ?? "");
  // "(erected)" describes the surface being painted, not an erection operation.
  const task = [name.replace(/\((?:not )?(?:erected|shop|field)[^)]*\)/gi, ""), ...identity,
    ref.row?.task, ref.valueColumnName, ref.columnName, unit.outputUom].filter(Boolean).join(" ").replace(/\((?:not )?(?:erected|shop|field)[^)]*\)/gi, "");
  const context = [name, unit.category, unit.className, unit.subClassName, ref.datasetName, unit.description].filter(Boolean).join(" ");
  return { task, context };
}

export function laborSearchProfile(query: string): SearchProfile {
  const profile = buildEstimatorSearchProfile(query);
  for (const term of profile.terms) {
    if (term.token === "hydrotest") term.variants.push("hydrostatic", "hydrotesting");
    if (term.token === "sch") term.variants.push("schedule", "scheduled");
  }
  return profile;
}

function dimensionNumber(value: unknown) {
  const text = String(value).trim();
  const fraction = text.match(/^(?:(\d+)-)?(\d+)\/(\d+)/);
  if (fraction) return Number(fraction[1] ?? 0) + Number(fraction[2]) / Number(fraction[3]);
  return Number.parseFloat(text);
}

export function rankLaborCandidates<T>(units: T[], profile: SearchProfile) {
  return units.map((item: any) => {
    const { task, context } = laborSearchText(item);
    const own = scoreEstimatorSearchText(profile, task);
    const all = scoreEstimatorSearchText(profile, `${task} ${context}`);
    const ownTerms = new Set(own?.matchedTerms ?? []);
    const matchedTerms = all?.matchedTerms ?? [];
    const contextOnly = matchedTerms.filter(term => !ownTerms.has(term));
    const coverage = all?.coverage ?? 0;
    // Source-row matches dominate a matching book/category header. SQL FTS is candidate retrieval only.
    let score = (own?.coverage ?? 0) * 100 + coverage * 25 + (own?.score ?? 0) * 2 - contextOnly.length * 3;
    // Exact task words outrank stem-only matches (e.g. structural vs an electrical "structure connector").
    const words = new Set(normalizeEstimatorSearchText(task).split(/\s+/));
    score += profile.terms.filter(term => words.has(term.token)).length * 18;
    const normalized = normalizeEstimatorSearchText(`${task} ${context}`);
    if (profile.terms.some(term => words.has(term.token)) && profile.phrases.some(phrase => normalized.includes(phrase))) score += 45;
    const action = profile.terms.find(term => /^(erect|erection|fabricat\w*|install\w*|weld\w*|cut\w*|hydro\w*|paint\w*|coat\w*)$/.test(term.token));
    if (action) {
      const inTask = estimatorTermMatches(normalizeEstimatorSearchText(task), action);
      const inContext = estimatorTermMatches(normalizeEstimatorSearchText(context), action);
      score += inTask ? 10 : inContext ? 3 : 0;
      // An action in a parenthetical or repeated coat header does not turn painting into that action.
      if (!inTask && /\b(?:coat|paint|spray|brush)\b/i.test(task) && !/^(paint|coat)/.test(action.token)) score -= 45;
    }
    // A schedule number is not a pipe diameter; retain labelled engineering dimensions.
    const requestedSize = profile.raw.match(/(?:nps|dia(?:meter)?)\s+(\d+(?:-\d+\/\d+|[./]\d+)?)/)?.[1]
      ?? profile.raw.match(/(\d+(?:-\d+\/\d+|[./]\d+)?)\s+(?:inch|inches|in)\b/)?.[1];
    const itemSize = task.match(/(?:NPS|Dia(?:meter)?)\s*[-:]?\s*(\d+(?:-\d+\/\d+|[./]\d+)?)/i)?.[1]
      ?? item.sourceRef?.rowDimensions?.find((dimension: any) => /pipe size|diameter/i.test(dimension.label ?? ""))?.value;
    if (requestedSize && itemSize !== undefined && dimensionNumber(requestedSize) !== dimensionNumber(itemSize)) score -= 35;
    const requestedSchedule = profile.raw.match(/(?:sch|schedule)\s+(\d+)/)?.[1];
    const itemSchedule = `${task} ${item.subClassName ?? ""}`.match(/(?:sch|schedule)\s+(\d+)/i)?.[1];
    if (requestedSchedule && itemSchedule && requestedSchedule !== itemSchedule) score -= 35;
    // Semantic candidates can enter without literal overlap, but a weak context-only hit cannot dominate row identity.
    const semantic = Number(item._semanticScore ?? 0);
    score += semantic * 15;
    return { item: item as T, score, coverage, matchedTerms, matchedPhrases: all?.matchedPhrases ?? [], anchorMatches: own?.anchorMatches ?? 0,
      taskMatchedTerms: [...ownTerms], contextOnlyTerms: contextOnly, semanticScore: semantic };
  }).filter(entry => entry.matchedTerms.length || entry.semanticScore > 0).sort((a, b) => b.score - a.score);
}

export function laborGranularityFacts(units: any[]) {
  const groups = new Map<string, { table: string; uom: string; operations: string[] }>();
  for (const unit of units) {
    const library = unit.library?.name ?? unit.metadata?.libraryName ?? unit.libraryId;
    const table = [...new Set([library, unit.category, unit.className].filter(Boolean))].join(" › ");
    const key = `${table}\0${unit.outputUom}`;
    const operation = /^\d+(?:[./-]\d+)*["']?$/.test(String(unit.name)) ? unit.category || unit.sourceRef?.datasetName : unit.name;
    const group = groups.get(key) ?? { table, uom: unit.outputUom, operations: [] as string[] };
    if (operation && !group.operations.includes(operation) && group.operations.length < 3) group.operations.push(String(operation).slice(0, 120));
    groups.set(key, group);
  }
  const pricedOperations = [...groups.values()].slice(0, 8);
  return { pricedOperations, fact: pricedOperations.length ? `Matching tables price: ${pricedOperations.map(group => `${group.table}: ${group.operations.join(", ")} (${group.uom})`).join("; ")}. These are operation quantities, which can differ from an assembly's quantity.` : "No matching table operation/unit examples were available." };
}
