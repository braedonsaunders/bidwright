import { randomUUID } from "node:crypto";
import type { WorksheetItem, QuoteRevision, CalculationType } from "@bidwright/domain";
import { calculateItem, type CalcContext, type RateScheduleContext } from "./services/calc-engine.js";

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateLineItem(
  item: WorksheetItem,
  revision: QuoteRevision,
  calculationType: CalculationType,
  rateSchedules?: Array<{
    id?: string;
    name?: string;
    category?: string;
    defaultMarkup?: number;
    metadata?: Record<string, unknown>;
    tiers?: Array<{ id: string; name: string; multiplier: number; sortOrder: number; uom?: string | null }>;
    items: Array<{
      id: string;
      scheduleId?: string;
      catalogItemId?: string | null;
      resourceId?: string | null;
      name: string;
      code: string;
      unit?: string;
      rates: Record<string, number>;
      costRates: Record<string, number>;
      burden: number;
      perDiem: number;
      metadata?: Record<string, unknown>;
    }>;
  }>,
): Partial<WorksheetItem> {
  const ctx: CalcContext = {
    rateSchedules: rateSchedules?.map((s) => ({
      id: s.id ?? "",
      name: s.name,
      category: s.category ?? "",
      defaultMarkup: s.defaultMarkup,
      metadata: s.metadata,
      tiers: s.tiers ?? [],
      items: s.items,
    })) as RateScheduleContext[],
    revisionId: revision.id,
  };

  const category = { calculationType } as any;

  const result = calculateItem(item, category, ctx);
  const patch: Partial<WorksheetItem> = {};
  if (result.cost !== undefined) patch.cost = result.cost;
  if (result.price !== undefined) patch.price = result.price;
  if (result.markup !== undefined) patch.markup = result.markup;
  if (result.rateResolution !== undefined) patch.rateResolution = result.rateResolution;
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
