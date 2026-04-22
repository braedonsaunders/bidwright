/**
 * Seed plugin templates from JSON files in packages/db/seed-plugins/.
 * Each JSON file is a full plugin definition. Plugins are upserted by slug — existing ones are replaced.
 * Seed datasets embedded in the plugin JSON are also created.
 */
import type { PrismaClient } from "@prisma/client";
import { firstPartyPlugins } from "@bidwright/domain";
import { readFileSync, readdirSync, existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

function createId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

const SEED_DIR = path.resolve(import.meta.dirname ?? __dirname, "../seed-plugins");
type SeedPluginDefinition = {
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

function loadJsonSeedPlugins(): SeedPluginDefinition[] {
  if (!existsSync(SEED_DIR)) {
    return [];
  }

  const files = readdirSync(SEED_DIR).filter((f) => f.endsWith(".json"));
  return files.map((file) => {
    const raw = readFileSync(path.join(SEED_DIR, file), "utf-8");
    return JSON.parse(raw) as SeedPluginDefinition;
  });
}

export async function seedPluginTemplates(prisma: PrismaClient, organizationId: string) {
  const bundledPlugins = firstPartyPlugins.map((plugin) => structuredClone(plugin)) as SeedPluginDefinition[];
  const jsonPlugins = loadJsonSeedPlugins();
  const seedPlugins = [...bundledPlugins, ...jsonPlugins];

  if (seedPlugins.length === 0) {
    console.log("No bundled or JSON plugin definitions found, skipping plugin seeding.");
    return;
  }

  console.log(`Seeding ${seedPlugins.length} plugin(s)...`);

  for (const data of seedPlugins) {
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

    const existing = await prisma.plugin.findFirst({
      where: { slug: data.slug, organizationId },
    });

    const now = new Date();
    const mergedConfig = {
      ...((data.config ?? {}) as Record<string, unknown>),
      ...(((existing?.config as Record<string, unknown> | null) ?? {})),
    };
    const payload = {
      organizationId,
      name: data.name,
      slug: data.slug,
      icon: data.icon ?? null,
      category: data.category,
      description: data.description,
      llmDescription: data.llmDescription ?? null,
      version: data.version ?? "1.0.0",
      author: data.author ?? null,
      enabled: existing?.enabled ?? true,
      config: mergedConfig as any,
      configSchema: (data.configSchema ?? null) as any,
      toolDefinitions: (data.toolDefinitions ?? []) as any,
      defaultOutputType: data.defaultOutputType ?? null,
      supportedCategories: data.supportedCategories ?? [],
      tags: data.tags ?? [],
      documentation: data.documentation ?? null,
      updatedAt: now,
    };

    if (existing) {
      await prisma.plugin.update({
        where: { id: existing.id },
        data: payload,
      });
    } else {
      await prisma.plugin.create({
        data: {
          id: createId("plugin"),
          ...payload,
          createdAt: now,
        },
      });
    }

    const toolCount = Array.isArray(data.toolDefinitions) ? data.toolDefinitions.length : 0;
    console.log(`  Plugin "${data.name}": ${toolCount} tools`);
  }
}
