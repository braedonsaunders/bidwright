/**
 * Seed dataset templates from JSON files in packages/db/seed-datasets/.
 * Each JSON file contains { name, description, category, source, sourceDescription, columns, rows }.
 * Templates are upserted by name — existing templates are replaced.
 */
import type { PrismaClient } from "@prisma/client";
import { readFileSync, readdirSync, existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

function createId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

const SEED_DIR = path.resolve(import.meta.dirname ?? __dirname, "../seed-datasets");

export async function seedDatasetTemplates(prisma: PrismaClient) {
  if (!existsSync(SEED_DIR)) {
    console.log("No seed-datasets directory found, skipping dataset template seeding.");
    return;
  }

  const files = readdirSync(SEED_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("No dataset JSON files found in seed-datasets/, skipping.");
    return;
  }

  console.log(`Seeding ${files.length} dataset template(s)...`);

  for (const file of files) {
    const raw = readFileSync(path.join(SEED_DIR, file), "utf-8");
    const data = JSON.parse(raw) as {
      name: string;
      description: string;
      category: string;
      source: string;
      sourceDescription: string;
      columns: unknown[];
      rows: Record<string, unknown>[];
    };

    // Delete existing template with same name (idempotent)
    const existing = await prisma.dataset.findFirst({
      where: { name: data.name, isTemplate: true },
    });
    if (existing) {
      await prisma.datasetRow.deleteMany({ where: { datasetId: existing.id } });
      await prisma.dataset.delete({ where: { id: existing.id } });
    }

    const datasetId = createId("ds");
    const now = new Date();

    await prisma.dataset.create({
      data: {
        id: datasetId,
        organizationId: null,
        name: data.name,
        description: data.description,
        category: data.category,
        scope: "global",
        columns: data.columns as any,
        rowCount: 0,
        source: data.source,
        sourceDescription: data.sourceDescription,
        isTemplate: true,
        createdAt: now,
        updatedAt: now,
      },
    });

    // Batch insert rows
    const BATCH = 500;
    for (let i = 0; i < data.rows.length; i += BATCH) {
      const batch = data.rows.slice(i, i + BATCH);
      await prisma.datasetRow.createMany({
        data: batch.map((rowData, idx) => ({
          id: createId("dr"),
          datasetId,
          data: rowData as any,
          order: i + idx,
          createdAt: now,
          updatedAt: now,
        })),
      });
    }

    await prisma.dataset.update({
      where: { id: datasetId },
      data: { rowCount: data.rows.length, updatedAt: now },
    });

    console.log(`  ${data.name}: ${data.rows.length} rows`);
  }
}
