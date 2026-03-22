import { randomUUID } from "node:crypto";
import type { WorksheetItem, QuoteRevision } from "@bidwright/domain";

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateLineItem(
  item: WorksheetItem,
  _revision: QuoteRevision,
  labourRates: { name: string; regularRate: number; overtimeRate: number; doubleRate: number }[]
): Partial<WorksheetItem> {
  const category = item.category;

  switch (category) {
    case "Labour": {
      const rate = labourRates.find((r) => r.name === item.entityName) ?? labourRates[0];
      if (!rate) return {};
      const price =
        ((rate.regularRate * item.laborHourReg) +
          (rate.overtimeRate * item.laborHourOver) +
          (rate.doubleRate * item.laborHourDouble)) *
        item.quantity;
      return { price, cost: roundMoney(price * 0.7) };
    }
    case "Equipment": {
      const days = item.laborHourReg;
      const price = item.cost * days * item.quantity;
      return { price: roundMoney(price) };
    }
    case "Other Charges": {
      return { cost: 0, markup: 0 };
    }
    case "Consumables": {
      const cost = item.quantity * item.cost;
      const price = cost * (1 + item.markup);
      return { price: roundMoney(price) };
    }
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
