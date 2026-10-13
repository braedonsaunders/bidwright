import type { LineDerivation } from "@bidwright/domain";
import { laborUnitConversion } from "./labor-unit-matching.js";

/** tierUnits are hours per row quantity; the persisted tierUnits trace records the same per-unit hours. */
export function buildLaborUnitDerivation(item: { quantity: number; uom: string; tierUnits?: Record<string, number> }, unit: { id: string; name: string; hoursNormal: number; outputUom: string }): LineDerivation | null {
  const conversion = laborUnitConversion(item.uom, unit.outputUom);
  if (conversion.multiplier === null || !(unit.hoursNormal > 0)) return null;
  const hours = Object.values(item.tierUnits ?? {}).reduce((sum, value) => sum + Number(value), 0);
  if (!(hours > 0)) return null;
  const factor = hours / (unit.hoursNormal * conversion.multiplier);
  return { version: 1, target: "tierUnits", status: "draft", formula: "conversion * hoursNormal * factor",
    inputs: [
      { name: "conversion", value: conversion.multiplier, source: { kind: "manual", ref: "unit-conversion", excerpt: conversion.fact } },
      { name: "hoursNormal", value: unit.hoursNormal, unit: `h/${unit.outputUom}`, source: { kind: "laborUnit", ref: unit.id, excerpt: unit.name } },
      { name: "factor", value: factor, source: { kind: "manual", ref: "authored-tier-units", excerpt: "Adjustment implied by the authored tier hours; includes the estimator's conditions and allowances." } },
    ], result: { value: hours, unit: `h/${item.uom}` }, notes: "Tier hours per row quantity = hours per output unit × conversion × authored adjustment. Extended hours = row quantity × tier hours; estimate factors apply separately." };
}

/** A linked productivity source cannot silently produce a zero-hour priced row. */
export function assertLaborUnitHours(item: { laborUnitId?: string | null; rateScheduleItemId?: string | null; tierUnits?: Record<string, number> }, schedules: any[]) {
  if (!item.laborUnitId) return;
  const hourlyTierIds = new Set(schedules.filter(schedule => schedule.items?.some((row: any) => row.id === item.rateScheduleItemId)).flatMap(schedule => schedule.tiers ?? []).filter((tier: any) => /^(h|hr|hrs|hour|hours)$/i.test(tier.uom ?? "HR")).map((tier: any) => tier.id));
  if (!Object.entries(item.tierUnits ?? {}).some(([id, hours]) => hourlyTierIds.has(id) && Number.isFinite(hours) && hours > 0)) {
    throw Object.assign(new Error("A labour-unit row has no positive tier hours. Its quantity/UOM must convert to the source output UOM and its rate schedule must have an hourly tier, or provide positive hourly tierUnits explicitly."), { statusCode: 400 });
  }
}
