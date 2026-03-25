import { randomUUID } from "node:crypto";
import type { WorksheetItem, QuoteRevision, CalculationType } from "@bidwright/domain";
import { calculateItem, type CalcContext, type RateScheduleContext, type LabourCostContext, type TravelPolicyContext } from "./services/calc-engine.js";

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface CalcLineItemOptions {
  labourCost?: LabourCostContext;
  travelPolicy?: TravelPolicyContext;
}

export function calculateLineItem(
  item: WorksheetItem,
  _revision: QuoteRevision,
  calculationType: CalculationType,
  rateSchedules?: Array<{
    tiers?: Array<{ id: string; name: string; multiplier: number; sortOrder: number }>;
    items: Array<{ id: string; name: string; code: string; rates: Record<string, number>; costRates: Record<string, number>; burden: number; perDiem: number }>;
  }>,
  options?: CalcLineItemOptions,
): Partial<WorksheetItem> {
  // Build a CalcContext and delegate to the universal calc engine
  const ctx: CalcContext = {
    rateSchedules: rateSchedules?.map((s) => ({
      id: "",
      category: "labour",
      tiers: s.tiers ?? [],
      items: s.items,
    })) as RateScheduleContext[],
    labourCost: options?.labourCost,
    travelPolicy: options?.travelPolicy,
  };

  // Build a fake EntityCategory to pass calculationType
  const category = { calculationType } as any;

  const result = calculateItem(item, category, ctx);
  const patch: Partial<WorksheetItem> = {};
  if (result.cost !== undefined) patch.cost = result.cost;
  if (result.price !== undefined) patch.price = result.price;
  if (result.markup !== undefined) patch.markup = result.markup;
  return patch;
}

export function documentTypeFromIngestion(kind: string): "rfq" | "spec" | "drawing" | "addendum" | "vendor" | "reference" {
  switch (kind) {
    case "rfq":
    case "spec":
    case "drawing":
    case "addendum":
      return kind as "rfq" | "spec" | "drawing" | "addendum";
    default:
      return "reference";
  }
}

export function makeQuoteNumber(): string {
  const now = new Date();
  const year = String(now.getUTCFullYear()).slice(-2);
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const suffix = randomUUID().slice(0, 4).toUpperCase();
  return `BW-${year}${month}${day}-${suffix}`;
}

export function createId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function defaultProjectSummary(packageName: string, clientName: string): string {
  return `${packageName} for ${clientName}`;
}
