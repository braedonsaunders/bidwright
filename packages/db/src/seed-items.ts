/**
 * Seed catalog templates from JSON files in packages/db/seed-items/.
 * Each JSON file contains { name, description, kind, source, sourceDescription, items[] }.
 * Templates are upserted by name — existing templates are replaced.
 */
import type { PrismaClient } from "@prisma/client";
import { readFileSync, readdirSync, existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

function createId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

const SEED_DIR = path.resolve(import.meta.dirname ?? __dirname, "../seed-items");

interface SeedItem {
  name: string;
  code?: string;
  category?: string;
  unit?: string;
  unitCost?: number;
  unitPrice?: number;
  description?: string;
  // AdminApp2-specific fields stored in metadata
  netsuiteId?: number;
  type?: string;
  billableTimesheet?: boolean;
  poundsPerFoot?: number;
  materialType?: string;
  calculationStyle?: string;
  pricePerPound?: number;
  categoryNetsuiteId?: number;
  dailyRate?: number;
  weeklyRate?: number;
  monthlyRate?: number;
  appliesTo?: string | null;
  [key: string]: unknown;
}

interface SeedFile {
  name: string;
  description: string;
  kind: string;
  source: string;
  sourceDescription: string;
  items: SeedItem[];
}

export async function seedCatalogTemplates(prisma: PrismaClient) {
  if (!existsSync(SEED_DIR)) {
    console.log("No seed-items directory found, skipping catalog template seeding.");
    return;
  }

  const files = readdirSync(SEED_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("No item JSON files found in seed-items/, skipping.");
    return;
  }

  console.log(`Seeding ${files.length} catalog template(s)...`);

  for (const file of files) {
    const raw = readFileSync(path.join(SEED_DIR, file), "utf-8");
    const data = JSON.parse(raw) as SeedFile;

    // Skip non-catalog files (like stock-categories reference)
    if (!data.items || !Array.isArray(data.items)) {
      console.log(`  Skipping ${file} (no items array)`);
      continue;
    }

    // Delete existing template with same name (idempotent)
    const existing = await prisma.catalog.findFirst({
      where: { name: data.name, isTemplate: true },
    });
    if (existing) {
      await prisma.catalogItem.deleteMany({ where: { catalogId: existing.id } });
      await prisma.catalog.delete({ where: { id: existing.id } });
    }

    const catalogId = createId("cat");
    const now = new Date();

    await prisma.catalog.create({
      data: {
        id: catalogId,
        organizationId: null,
        name: data.name,
        description: data.description,
        kind: data.kind,
        scope: "global",
        source: data.source,
        sourceDescription: data.sourceDescription,
        isTemplate: true,
        createdAt: now,
        updatedAt: now,
      },
    });

    // Build catalog items from seed data
    const BATCH = 500;
    const items = data.items;

    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);
      await prisma.catalogItem.createMany({
        data: batch.map((item, idx) => {
          // Extract known fields, put the rest in metadata
          const {
            name, code, category, unit, unitCost, unitPrice, description,
            dailyRate, weeklyRate, monthlyRate,
            poundsPerFoot, pricePerPound,
            ...extra
          } = item;

          const metadata: Record<string, unknown> = { ...extra };
          if (category) metadata.category = category;
          if (description) metadata.description = description;

          // Compute cost/price from domain-specific fields when not explicitly set
          let resolvedCost = unitCost || 0;
          let resolvedPrice = unitPrice || 0;

          // Equipment rates: use dailyRate as unitCost/unitPrice
          if (dailyRate && !resolvedCost) {
            resolvedCost = dailyRate;
            resolvedPrice = resolvedPrice || dailyRate;
            metadata.dailyRate = dailyRate;
            if (weeklyRate) metadata.weeklyRate = weeklyRate;
            if (monthlyRate) metadata.monthlyRate = monthlyRate;
          }

          // Stock items: compute from poundsPerFoot * pricePerPound
          if (poundsPerFoot && pricePerPound && !resolvedCost) {
            const computed = Math.round(poundsPerFoot * pricePerPound * 100) / 100;
            resolvedCost = computed;
            resolvedPrice = resolvedPrice || computed;
            metadata.poundsPerFoot = poundsPerFoot;
            metadata.pricePerPound = pricePerPound;
          }

          return {
            id: createId("ci"),
            catalogId,
            code: code || "",
            name: name || "",
            unit: unit || "EA",
            unitCost: resolvedCost,
            unitPrice: resolvedPrice,
            metadata: metadata as any,
            order: i + idx,
            createdAt: now,
            updatedAt: now,
          };
        }),
      });
    }

    console.log(`  ${data.name}: ${items.length} items`);
  }
}
