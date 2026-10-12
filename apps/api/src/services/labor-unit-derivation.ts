import type { LineDerivation } from "@bidwright/domain";
import { laborUnitConversion } from "./labor-unit-matching.js";

/** tierUnits are hours per row quantity; the persisted trace records extended hours. */
export function buildLaborUnitDerivation(item: { quantity: number; uom: string; tierUnits?: Record<string, number> }, unit: { id: string; name: string; hoursNormal: number; outputUom: string }): LineDerivation | null {
  const conversion = laborUnitConversion(item.uom, unit.outputUom);
  if (conversion.multiplier === null || !(unit.hoursNormal > 0)) return null;
  const hours = Object.values(item.tierUnits ?? {}).reduce((sum, value) => sum + Number(value), 0);
  if (!(hours > 0)) return null;
  const factor = hours / (unit.hoursNormal * conversion.multiplier);
  return { version: 1, target: "tierUnits", status: "draft", formula: "quantity * conversion * hoursNormal * factor",
    inputs: [
      { name: "quantity", value: item.quantity, unit: item.uom, source: { kind: "manual", ref: "row.quantity", excerpt: "Installed row quantity." } },
      { name: "conversion", value: conversion.multiplier, source: { kind: "manual", ref: "unit-conversion", excerpt: conversion.fact } },
      { name: "hoursNormal", value: unit.hoursNormal, unit: `h/${unit.outputUom}`, source: { kind: "laborUnit", ref: unit.id, excerpt: unit.name } },
      { name: "factor", value: factor, source: { kind: "manual", ref: "authored-tier-units", excerpt: "Adjustment implied by the authored tier hours; includes the estimator's conditions and allowances." } },
    ], result: { value: hours * item.quantity, unit: "h" }, notes: "Extended hours = row quantity × hours per output unit × conversion × authored adjustment. Estimate factors apply separately." };
}
