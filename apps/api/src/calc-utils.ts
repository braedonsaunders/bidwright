import { randomUUID } from "node:crypto";
import type { WorksheetItem, QuoteRevision, CalculationType } from "@bidwright/domain";

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateLineItem(
  item: WorksheetItem,
  _revision: QuoteRevision,
  calculationType: CalculationType,
  rateSchedules?: Array<{
    items: Array<{ id: string; name: string; code: string; rates: Record<string, number>; costRates: Record<string, number>; burden: number; perDiem: number }>;
  }>,
): Partial<WorksheetItem> {
  switch (calculationType) {
    case "auto_labour": {
      // Use rate schedule if item has rateScheduleItemId and tierUnits
      if (item.rateScheduleItemId && item.tierUnits && Object.keys(item.tierUnits).length > 0 && rateSchedules?.length) {
        for (const sched of rateSchedules) {
          const rsItem = sched.items.find((i) => i.id === item.rateScheduleItemId);
          if (rsItem) {
            let totalPrice = 0;
            let totalCost = 0;
            let totalHours = 0;
            for (const [tierId, hours] of Object.entries(item.tierUnits)) {
              const h = Number(hours) || 0;
              totalPrice += (rsItem.rates[tierId] ?? 0) * h;
              totalCost += (rsItem.costRates[tierId] ?? 0) * h;
              totalHours += h;
            }
            totalPrice *= item.quantity;
            totalCost *= item.quantity;
            totalCost += rsItem.burden * totalHours * item.quantity;
            totalCost += rsItem.perDiem * Math.ceil(totalHours / 8) * item.quantity;
            return { price: roundMoney(totalPrice), cost: roundMoney(totalCost) };
          }
        }
      }

      return {};
    }
    case "auto_equipment": {
      const days = item.laborHourReg;
      const price = item.cost * days * item.quantity;
      return { price: roundMoney(price) };
    }
    case "direct_price": {
      return { cost: 0, markup: 0 };
    }
    case "auto_consumable": {
      const cost = item.quantity * item.cost;
      const price = cost * (1 + item.markup);
      return { price: roundMoney(price) };
    }
    case "formula":
    case "manual":
    default: {
      const price = item.quantity * item.cost * (1 + item.markup);
      return { price: roundMoney(price) };
    }
  }
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
