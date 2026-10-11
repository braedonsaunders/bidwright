import { z } from "zod";
import { prisma } from "@bidwright/db";
import type { PrismaApiStore } from "../prisma-store.js";

export const sourceQuantitySchema = z.object({
  documentId: z.string().min(1).describe("Source document id, or file-<nodeId> for a FileNode"),
  quantity: z.number().finite().nonnegative(),
  unit: z.string().trim().min(1),
  label: z.string().trim().min(1),
  description: z.string().optional(),
  sourceRefs: z.array(z.object({
    sheet: z.string().optional(), row: z.number().int().positive().optional(),
    page: z.number().int().positive().optional(), cell: z.string().optional(), text: z.string().optional(),
  }).refine(ref => Object.values(ref).some(value => value !== undefined && value !== ""), "Source reference is empty")).min(1),
  linkToItemId: z.string().optional(),
  quantityField: z.enum(["value", "area", "volume", "count"]).default("value"),
  multiplier: z.number().finite().positive().optional(),
});

export function sourceQuantityPickup(input: z.infer<typeof sourceQuantitySchema>) {
  const unit = input.unit.toLowerCase().replace(/[.\s]/g, "");
  const dimension = /^(ea|each|pcs?|count|units?)$/.test(unit) ? "count"
    : /^(sf|sm|sy|ft2|ft²|m2|m²|sqft|sqm|px2|px²)$/.test(unit) ? "area"
      : /^(cf|cy|ft3|ft³|m3|m³|cuft|cum)$/.test(unit) ? "volume"
        : /^(lf|lm|ft|m|mm|cm|in|yd|px)$/.test(unit) ? "linear" : "quantity";
  return {
    documentId: input.documentId, pageNumber: input.sourceRefs.find(ref => ref.page)?.page ?? 1,
    annotationType: dimension, label: input.label, groupName: "Source quantities", points: [],
    measurement: { value: input.quantity, unit: input.unit,
      ...(["area", "volume", "count"].includes(dimension) ? { [dimension]: input.quantity } : {}) },
    metadata: { source: "source-quantity", measuredBy: "agent", description: input.description,
      sourceRefs: input.sourceRefs, method: "authored-source-quantity" },
  };
}

export async function saveSourceQuantityTakeoff(
  store: Pick<PrismaApiStore, "createPickup" | "createPickupLink">,
  projectId: string,
  input: z.infer<typeof sourceQuantitySchema>,
) {
  const fileNodeId = input.documentId.startsWith("file-") ? input.documentId.slice(5) : null;
  const source = fileNodeId
    ? await prisma.fileNode.findFirst({ where: { id: fileNodeId, projectId, type: "file" } })
    : await prisma.sourceDocument.findFirst({ where: { id: input.documentId, projectId } });
  if (!source) throw new Error("Source not found in project");
  const pickup = await store.createPickup(projectId, sourceQuantityPickup(input));
  if (!input.linkToItemId) return { pickup, link: null };
  // As with PDF takeoff, a failed optional link leaves a visible, saved pickup.
  try {
    if (/^px(?:[²³23])?$/i.test(input.unit.trim())) throw new Error("Pixel quantities have no physical-unit conversion");
    const row = await prisma.worksheetItem.findFirst({ where: { id: input.linkToItemId, worksheet: { revision: { quote: { projectId } } } } });
    if (!row) throw new Error("Worksheet item not found in project");
    const normalize = (unit: string) => ({ ea: "ea", each: "ea", count: "ea", ft: "ft", lf: "ft", m: "m", lm: "m" }[unit.toLowerCase().trim()] ?? unit.toLowerCase().trim());
    if (normalize(row.uom) !== normalize(input.unit) && input.multiplier === undefined) {
      throw new Error(`Explicit multiplier required to convert ${input.unit} to ${row.uom}`);
    }
    const link = await store.createPickupLink(projectId, {
      pickupId: pickup.id, worksheetItemId: input.linkToItemId,
      quantityField: input.quantityField, multiplier: input.multiplier ?? 1,
    });
    return { pickup, link };
  } catch (error) {
    return { pickup, link: null, linkError: error instanceof Error ? error.message : String(error) };
  }
}
