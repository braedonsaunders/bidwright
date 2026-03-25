/**
 * Seed plugin templates from JSON files in packages/db/seed-plugins/.
 * Each JSON file is a full plugin definition. Plugins are upserted by slug — existing ones are replaced.
 * Seed datasets embedded in the plugin JSON are also created.
 */
import type { PrismaClient } from "@prisma/client";
import { readFileSync, readdirSync, existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

function createId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

const SEED_DIR = path.resolve(import.meta.dirname ?? __dirname, "../seed-plugins");

export async function seedPluginTemplates(prisma: PrismaClient, organizationId: string) {
  if (!existsSync(SEED_DIR)) {
    console.log("No seed-plugins directory found, skipping plugin seeding.");
    return;
  }

  const files = readdirSync(SEED_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("No plugin JSON files found in seed-plugins/, skipping.");
    return;
  }

  console.log(`Seeding ${files.length} plugin(s)...`);

  for (const file of files) {
    const raw = readFileSync(path.join(SEED_DIR, file), "utf-8");
    const data = JSON.parse(raw) as {
      slug: string;
      name: string;
      icon?: string;
      category: string;
      description: string;
      llmDescription?: string;
      version: string;
      author?: string;
      tags?: string[];
      supportedCategories?: string[];
      defaultOutputType?: string;
      documentation?: string;
      config?: Record<string, unknown>;
      configSchema?: unknown[];
      toolDefinitions: unknown[];
      seedDatasets?: Array<{
        id?: string;
        name: string;
        description: string;
        category: string;
        columns: unknown[];
        rows: Record<string, unknown>[];
        tags?: string[];
      }>;
    };

    // Seed embedded datasets first
    if (data.seedDatasets && data.seedDatasets.length > 0) {
      for (const ds of data.seedDatasets) {
        const existingDs = await prisma.dataset.findFirst({
          where: { name: ds.name, organizationId },
        });
        if (existingDs) {
          console.log(`  Dataset "${ds.name}" already exists, skipping.`);
          continue;
        }

        const dsId = createId("ds");
        const now = new Date();

        await prisma.dataset.create({
          data: {
            id: dsId,
            organizationId,
            name: ds.name,
            description: ds.description,
            category: ds.category,
            scope: "global",
            columns: ds.columns as any,
            rowCount: 0,
            source: "library",
            sourceDescription: `Seed data for plugin: ${data.name}`,
            tags: ds.tags ?? [],
            isTemplate: false,
            createdAt: now,
            updatedAt: now,
          },
        });

        const BATCH = 500;
        for (let i = 0; i < ds.rows.length; i += BATCH) {
          const batch = ds.rows.slice(i, i + BATCH);
          await prisma.datasetRow.createMany({
            data: batch.map((rowData, idx) => ({
              id: createId("dr"),
              datasetId: dsId,
              data: rowData as any,
              order: i + idx,
              createdAt: now,
              updatedAt: now,
            })),
          });
        }

        await prisma.dataset.update({
          where: { id: dsId },
          data: { rowCount: ds.rows.length, updatedAt: now },
        });

        console.log(`  Dataset "${ds.name}": ${ds.rows.length} rows`);
      }
    }

    // Delete existing plugin with same slug (idempotent)
    const existing = await prisma.plugin.findFirst({
      where: { slug: data.slug, organizationId },
    });
    if (existing) {
      await prisma.pluginExecution.deleteMany({ where: { pluginId: existing.id } });
      await prisma.plugin.delete({ where: { id: existing.id } });
    }

    const now = new Date();
    await prisma.plugin.create({
      data: {
        id: createId("plugin"),
        organizationId,
        name: data.name,
        slug: data.slug,
        icon: data.icon ?? null,
        category: data.category,
        description: data.description,
        llmDescription: data.llmDescription ?? null,
        version: data.version ?? "1.0.0",
        author: data.author ?? null,
        enabled: true,
        config: (data.config ?? {}) as any,
        configSchema: (data.configSchema ?? null) as any,
        toolDefinitions: (data.toolDefinitions ?? []) as any,
        defaultOutputType: data.defaultOutputType ?? null,
        supportedCategories: data.supportedCategories ?? [],
        tags: data.tags ?? [],
        documentation: data.documentation ?? null,
        createdAt: now,
        updatedAt: now,
      },
    });

    const toolCount = Array.isArray(data.toolDefinitions) ? data.toolDefinitions.length : 0;
    console.log(`  Plugin "${data.name}": ${toolCount} tools`);
  }
}
