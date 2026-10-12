import { buildEstimatorSearchProfile, scoreEstimatorSearchText } from "./estimator-search.js";
import type { LaborUnit } from "@bidwright/domain";

export interface LaborWorkLine {
  operation: string;
  material?: string;
  condition?: string;
  size?: string;
  quantity: number;
  uom: string;
}

// Ambiguous units (ton, lot, crew-day) deliberately have no automatic conversion.
const units: Record<string, [string, number]> = {
  ft: ["length", .3048], lf: ["length", .3048], m: ["length", 1], mm: ["length", .001],
  in: ["length", .0254], "lin in": ["length", .0254], tonne: ["mass", 1000], kg: ["mass", 1], lb: ["mass", .45359237],
  ea: ["count", 1], each: ["count", 1], hr: ["time", 1], h: ["time", 1],
};
export function laborUnitConversion(from: string, to: string) {
  const a = from.trim().toLowerCase(), b = to.trim().toLowerCase();
  if (a && a === b) return { multiplier: 1, fact: `Quantity is already in ${to}.` };
  const left = units[a], right = units[b];
  if (left && right && left[0] === right[0]) {
    const multiplier = left[1] / right[1];
    return { multiplier, fact: `Unit differs: ${from} → ${to}; multiply quantity by ${multiplier}.` };
  }
  return { multiplier: null, fact: `Unit differs: ${from || "unspecified"} → ${to || "unspecified"}; a source-backed conversion or a quantity in ${to || "the unit's output basis"} is needed.` };
}

export async function matchLaborBreakdown(
  lines: LaborWorkLine[], context: string | undefined,
  search: (query: string) => Promise<{ units: LaborUnit[] }>,
) {
  const cache = new Map<string, Promise<{ units: LaborUnit[] }>>();
  const results: any[] = new Array(lines.length);
  let next = 0;
  // Bounded DB concurrency, and repeated operations share one indexed search.
  await Promise.all(Array.from({ length: Math.min(4, lines.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= lines.length) return;
      const line = lines[index];
      const query = [line.operation, line.material, line.size].filter(Boolean).join(" ");
      let pending = cache.get(query);
      if (!pending) { pending = search(query); cache.set(query, pending); }
      const { units: found } = await pending;
      const candidates = found.slice(0, 3).map((unit) => {
        const meta = unit.metadata as any;
        const match = meta?.searchMatch ?? {};
        const coverage = scoreEstimatorSearchText(buildEstimatorSearchProfile([line.operation, line.material].filter(Boolean).join(" ")),
          [unit.displayName, unit.name, unit.description, unit.category, unit.className, unit.subClassName, ...(match.matchedTerms ?? [])].filter(Boolean).join(" "))?.coverage ?? 0;
        return { id: unit.id, name: unit.displayName ?? unit.name, hoursNormal: unit.hoursNormal, outputUom: unit.outputUom,
          path: meta?.path ?? unit.name, sourceBook: meta?.sourceBook ?? null, sourcePage: meta?.sourcePage ?? null,
          sourceRef: unit.sourceRef, score: match.score ?? 0, coverage,
          conversion: laborUnitConversion(line.uom, unit.outputUom) };
      });
      results[index] = { index, line, query, status: candidates[0]?.coverage >= .8 ? "candidates" : "no good match", candidates };
    }
  }));
  return { context: context ?? null, lines: results, fact: "Scores measure text relevance, not applicability. hoursNormal is hours per outputUom; conversions and job conditions remain explicit." };
}
