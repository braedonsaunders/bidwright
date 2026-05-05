import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { costIntelligenceService } from "./cost-intelligence-service.js";
import type { LibrarySnapshotFile, LibrarySnapshotInfo } from "./claude-md-generator.js";

type JsonRecord = Record<string, unknown>;

interface AgentLibraryStore {
  listKnowledgeBooks?: (projectId?: string) => Promise<unknown[]>;
  listKnowledgeDocuments?: (projectId?: string) => Promise<unknown[]>;
  listDatasets?: (projectId?: string) => Promise<unknown[]>;
  listDatasetRows?: (
    datasetId: string,
    filter?: string,
    sort?: string,
    limit?: number,
    offset?: number,
  ) => Promise<{ rows: unknown[]; total: number }>;
  listCatalogs?: () => Promise<unknown[]>;
  listCatalogItems?: (catalogId: string) => Promise<unknown[]>;
  listRateSchedules?: (scope?: string) => Promise<unknown[]>;
  listRevisionRateSchedules?: (projectId: string) => Promise<unknown[]>;
  listLaborUnitLibraries?: (scope?: "organization" | "all") => Promise<unknown[]>;
  listLaborUnits?: (input?: {
    libraryId?: string;
    q?: string;
    provider?: string;
    category?: string;
    className?: string;
    limit?: number;
    offset?: number;
  }) => Promise<{ units: unknown[]; total: number }>;
  listAssemblies?: () => Promise<unknown[]>;
  getAssembly?: (assemblyId: string) => Promise<unknown | null>;
  rebuildLineItemSearchIndex?: (projectId?: string) => Promise<{ indexed: number }>;
}

interface WriteAgentLibrarySnapshotOptions {
  projectDir: string;
  projectId: string;
  organizationId?: string | null;
  store: AgentLibraryStore;
}

const SNAPSHOT_ROOT = "library-snapshots";
const DATASET_ROW_PAGE_SIZE = 1000;
const MAX_DATASET_ROWS_PER_FILE = envPositiveInt("AGENT_LIBRARY_SNAPSHOT_MAX_DATASET_ROWS", 10000);
const MAX_LABOR_UNITS = envPositiveInt("AGENT_LIBRARY_SNAPSHOT_MAX_LABOR_UNITS", 25000);
const MAX_CATALOG_ITEMS = envPositiveInt("AGENT_LIBRARY_SNAPSHOT_MAX_CATALOG_ITEMS", 25000);
const MAX_COST_ROWS = envPositiveInt("AGENT_LIBRARY_SNAPSHOT_MAX_COST_ROWS", 50000);

function envPositiveInt(key: string, fallback: number) {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function safeFileName(value: unknown, fallback = "library") {
  const raw = String(value ?? "").trim() || fallback;
  const slug = raw
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return slug || fallback;
}

function truncateString(value: string, max = 2000) {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...[truncated ${value.length - max} chars]`;
}

function jsonReplacer(_key: string, value: unknown) {
  if (typeof value === "string") return truncateString(value);
  return value;
}

function toJsonLine(value: unknown) {
  return JSON.stringify(value, jsonReplacer);
}

function toJsonLines(values: unknown[]) {
  return values.map(toJsonLine).join("\n") + (values.length > 0 ? "\n" : "");
}

function compact(value: unknown, max = 320) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function arrayCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function asRecordArray(value: unknown[]): JsonRecord[] {
  return value.map(asRecord);
}

async function safeCall<T>(
  label: string,
  warnings: string[],
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`${label}: ${message}`);
    return fallback;
  }
}

async function writeSnapshotFile(
  rootPath: string,
  files: LibrarySnapshotFile[],
  relativePath: string,
  label: string,
  content: string,
  options: { description?: string; count?: number; truncated?: boolean } = {},
) {
  const path = join(rootPath, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf-8");
  files.push({
    path: `${SNAPSHOT_ROOT}/${relativePath}`,
    label,
    description: options.description,
    count: options.count,
    truncated: options.truncated,
  });
}

function datasetRowFileName(dataset: JsonRecord) {
  return `datasets/${safeFileName(dataset.name, "dataset")}-${safeFileName(dataset.id, "rows")}.jsonl`;
}

async function writeDatasetRows(
  rootPath: string,
  store: AgentLibraryStore,
  dataset: JsonRecord,
  warnings: string[],
) {
  if (!store.listDatasetRows || typeof dataset.id !== "string") {
    return { relativePath: datasetRowFileName(dataset), written: 0, total: 0, truncated: false };
  }

  let offset = 0;
  let total = 0;
  const rows: JsonRecord[] = [];
  while (offset < MAX_DATASET_ROWS_PER_FILE) {
    const page = await safeCall(
      `dataset rows ${dataset.name ?? dataset.id}`,
      warnings,
      () => store.listDatasetRows!(String(dataset.id), undefined, undefined, DATASET_ROW_PAGE_SIZE, offset),
      { rows: [], total },
    );
    total = page.total;
    if (page.rows.length === 0) break;
    rows.push(...page.rows.map(asRecord).map((row) => ({
      id: row.id,
      datasetId: row.datasetId,
      order: row.order,
      data: row.data,
      metadata: row.metadata,
    })));
    offset += page.rows.length;
    if (offset >= total) break;
  }

  const relativePath = datasetRowFileName(dataset);
  await mkdir(join(rootPath, "datasets"), { recursive: true });
  await writeFile(join(rootPath, relativePath), toJsonLines(rows), "utf-8");
  return {
    relativePath,
    written: rows.length,
    total,
    truncated: rows.length < total,
  };
}

function datasetIndexRecord(dataset: JsonRecord, rowSnapshot: Awaited<ReturnType<typeof writeDatasetRows>>) {
  return {
    id: dataset.id,
    name: dataset.name,
    description: compact(dataset.description),
    category: dataset.category,
    scope: dataset.scope,
    projectId: dataset.projectId,
    columns: dataset.columns,
    rowCount: dataset.rowCount,
    source: dataset.source,
    sourceDescription: compact(dataset.sourceDescription),
    sourceBookId: dataset.sourceBookId,
    sourcePages: dataset.sourcePages,
    tags: dataset.tags,
    rowsFile: `${SNAPSHOT_ROOT}/${rowSnapshot.relativePath}`,
    rowsWritten: rowSnapshot.written,
    rowsTotal: rowSnapshot.total || dataset.rowCount || 0,
    truncated: rowSnapshot.truncated,
  };
}

function flattenRateScheduleItems(schedules: JsonRecord[], scopeLabel: string) {
  return schedules.flatMap((schedule) => {
    const tiers = Array.isArray(schedule.tiers) ? schedule.tiers as JsonRecord[] : [];
    const items = Array.isArray(schedule.items) ? schedule.items as JsonRecord[] : [];
    return items.map((item) => ({
      scope: scopeLabel,
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      scheduleCategory: schedule.category,
      scheduleDescription: compact(schedule.description),
      scheduleEffectiveDate: schedule.effectiveDate,
      scheduleExpiryDate: schedule.expiryDate,
      tiers: tiers.map((tier) => ({
        id: tier.id,
        name: tier.name,
        multiplier: tier.multiplier,
        uom: tier.uom,
      })),
      id: item.id,
      code: item.code,
      name: item.name,
      unit: item.unit,
      rates: item.rates,
      costRates: item.costRates,
      burden: item.burden,
      perDiem: item.perDiem,
      metadata: item.metadata,
    }));
  });
}

function buildIndexMarkdown(snapshot: LibrarySnapshotInfo) {
  const countRows = Object.entries(snapshot.counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `- ${key}: ${value.toLocaleString()}`)
    .join("\n") || "- No library counts available";
  const fileRows = snapshot.files
    .map((file) => {
      const count = typeof file.count === "number" ? ` (${file.count.toLocaleString()} records${file.truncated ? ", truncated" : ""})` : "";
      const description = file.description ? ` - ${file.description}` : "";
      return `- \`${file.path}\` - ${file.label}${count}${description}`;
    })
    .join("\n");
  const warningRows = snapshot.warnings.length > 0
    ? `\n\n## Warnings\n\n${snapshot.warnings.map((warning) => `- ${warning}`).join("\n")}`
    : "";

  return `# Bidwright Library Index

Generated: ${snapshot.generatedAt}

## Counts

${countRows}

## Files

${fileRows}
${warningRows}
`;
}

function buildReadme(snapshot: LibrarySnapshotInfo) {
  return `# Bidwright Library Snapshots

These files are generated for the CLI estimating/review agent. They are optimized for fast text search from the project workdir.

Use them like this:

1. Search this folder for scope terms from the bid package, for example material names, equipment names, sizes, cost codes, vendors, locations, spec sections, and production activities.
2. Treat matches as discovery hints, not final pricing authority.
3. Use MCP tools to read the authoritative source and preserve source IDs:
   - \`listKnowledgeBooks\`, \`queryKnowledge\`, \`queryGlobalLibrary\`, \`readDocumentText\`
   - \`listDatasets\`, \`queryDatasets\`
   - \`searchLineItemCandidates\`, \`recommendCostSource\`, \`createWorksheetItemFromCandidate\`
   - \`listLaborUnits\`, \`previewAssembly\`
4. Put the actual source IDs and page/table/row references in \`sourceNotes\`.

JSONL files contain one searchable record per line. Large datasets may be truncated in these snapshots; when that happens, use \`queryDatasets\` or the relevant MCP list/search tool for the full source.

Start with \`${SNAPSHOT_ROOT}/library-index.md\`.

Generated: ${snapshot.generatedAt}
`;
}

export async function writeAgentLibrarySnapshot({
  projectDir,
  projectId,
  organizationId,
  store,
}: WriteAgentLibrarySnapshotOptions): Promise<LibrarySnapshotInfo> {
  const rootPath = join(projectDir, SNAPSHOT_ROOT);
  await rm(rootPath, { recursive: true, force: true });
  await mkdir(rootPath, { recursive: true });

  const files: LibrarySnapshotFile[] = [];
  const warnings: string[] = [];
  const counts: Record<string, number> = {};

  await safeCall(
    "line item search index rebuild",
    warnings,
    () => store.rebuildLineItemSearchIndex ? store.rebuildLineItemSearchIndex(projectId) : Promise.resolve({ indexed: 0 }),
    { indexed: 0 },
  ).then((result) => {
    counts.lineItemSearchDocuments = result.indexed;
  });

  const [
    rawBooks,
    rawKnowledgeDocuments,
    rawDatasets,
    rawCatalogs,
    rawGlobalRateSchedules,
    rawRevisionRateSchedules,
    rawLaborLibraries,
    rawLaborUnitsResult,
    rawAssemblySummaries,
  ] = await Promise.all([
    safeCall("knowledge books", warnings, () => store.listKnowledgeBooks ? store.listKnowledgeBooks(projectId) : Promise.resolve([]), []),
    safeCall("knowledge documents", warnings, () => store.listKnowledgeDocuments ? store.listKnowledgeDocuments(projectId) : Promise.resolve([]), []),
    safeCall("datasets", warnings, () => store.listDatasets ? store.listDatasets(projectId) : Promise.resolve([]), []),
    safeCall("catalogs", warnings, () => store.listCatalogs ? store.listCatalogs() : Promise.resolve([]), []),
    safeCall("global rate schedules", warnings, () => store.listRateSchedules ? store.listRateSchedules("global") : Promise.resolve([]), []),
    safeCall("revision rate schedules", warnings, () => store.listRevisionRateSchedules ? store.listRevisionRateSchedules(projectId) : Promise.resolve([]), []),
    safeCall("labor unit libraries", warnings, () => store.listLaborUnitLibraries ? store.listLaborUnitLibraries("all") : Promise.resolve([]), []),
    safeCall("labor units", warnings, () => store.listLaborUnits ? store.listLaborUnits({ limit: MAX_LABOR_UNITS }) : Promise.resolve({ units: [], total: 0 }), { units: [], total: 0 }),
    safeCall("assemblies", warnings, () => store.listAssemblies ? store.listAssemblies() : Promise.resolve([]), []),
  ]);

  const books = asRecordArray(rawBooks);
  const knowledgeDocuments = asRecordArray(rawKnowledgeDocuments);
  const datasets = asRecordArray(rawDatasets);
  const catalogs = asRecordArray(rawCatalogs);
  const globalRateSchedules = asRecordArray(rawGlobalRateSchedules);
  const revisionRateSchedules = asRecordArray(rawRevisionRateSchedules);
  const laborLibraries = asRecordArray(rawLaborLibraries);
  const laborUnitsResult = {
    units: asRecordArray(rawLaborUnitsResult.units),
    total: rawLaborUnitsResult.total,
  };
  const assemblySummaries = asRecordArray(rawAssemblySummaries);

  counts.knowledgeBooks = books.length;
  counts.knowledgeDocuments = knowledgeDocuments.length;
  counts.datasets = datasets.length;
  counts.catalogs = catalogs.length;
  counts.globalRateSchedules = globalRateSchedules.length;
  counts.revisionRateSchedules = revisionRateSchedules.length;
  counts.laborUnitLibraries = laborLibraries.length;
  counts.laborUnits = laborUnitsResult.total;
  counts.assemblies = assemblySummaries.length;

  await writeSnapshotFile(
    rootPath,
    files,
    "books.jsonl",
    "Knowledge books/manuals",
    toJsonLines(books.map((book) => ({
      id: book.id,
      name: book.name,
      description: compact(book.description),
      category: book.category,
      scope: book.scope,
      projectId: book.projectId,
      sourceFileName: book.sourceFileName,
      pageCount: book.pageCount,
      chunkCount: book.chunkCount,
      status: book.status,
    }))),
    { count: books.length, description: "Use IDs with listKnowledgeBooks/readDocumentText." },
  );

  await writeSnapshotFile(
    rootPath,
    files,
    "knowledge-pages.jsonl",
    "Manual knowledge page libraries",
    toJsonLines(knowledgeDocuments.map((document) => ({
      id: document.id,
      title: document.title,
      description: compact(document.description),
      category: document.category,
      tags: document.tags,
      scope: document.scope,
      projectId: document.projectId,
      pageCount: document.pageCount,
      chunkCount: document.chunkCount,
      status: document.status,
    }))),
    { count: knowledgeDocuments.length, description: "Full markdown snapshots are in knowledge-pages/ when available." },
  );

  const datasetIndexes: JsonRecord[] = [];
  for (const dataset of datasets) {
    const rowSnapshot = await writeDatasetRows(rootPath, store, dataset, warnings);
    datasetIndexes.push(datasetIndexRecord(dataset, rowSnapshot));
  }
  await writeSnapshotFile(
    rootPath,
    files,
    "datasets/index.jsonl",
    "Dataset index",
    toJsonLines(datasetIndexes),
    {
      count: datasetIndexes.length,
      description: "Each record points to that dataset's searchable row JSONL file.",
      truncated: datasetIndexes.some((dataset) => dataset.truncated === true),
    },
  );
  for (const dataset of datasetIndexes) {
    files.push({
      path: String(dataset.rowsFile),
      label: `Dataset rows: ${String(dataset.name ?? dataset.id)}`,
      description: "One row per line; use queryDatasets for authoritative search.",
      count: numberValue(dataset.rowsWritten),
      truncated: dataset.truncated === true,
    });
  }

  const catalogItems: JsonRecord[] = [];
  for (const catalog of catalogs) {
    if (catalogItems.length >= MAX_CATALOG_ITEMS) break;
    const items = await safeCall(
      `catalog items ${catalog.name ?? catalog.id}`,
      warnings,
      () => store.listCatalogItems && typeof catalog.id === "string" ? store.listCatalogItems(catalog.id) : Promise.resolve([]),
      [],
    );
    for (const item of asRecordArray(items)) {
      if (catalogItems.length >= MAX_CATALOG_ITEMS) break;
      catalogItems.push({
        catalogId: catalog.id,
        catalogName: catalog.name,
        catalogKind: catalog.kind,
        id: item.id,
        code: item.code,
        name: item.name,
        unit: item.unit,
        unitCost: item.unitCost,
        unitPrice: item.unitPrice,
        metadata: item.metadata,
      });
    }
  }
  counts.catalogItems = catalogItems.length;
  await writeSnapshotFile(
    rootPath,
    files,
    "catalogs/index.jsonl",
    "Catalog index",
    toJsonLines(catalogs.map((catalog) => ({
      id: catalog.id,
      name: catalog.name,
      kind: catalog.kind,
      scope: catalog.scope,
      projectId: catalog.projectId,
      description: compact(catalog.description),
      source: catalog.source,
      sourceDescription: compact(catalog.sourceDescription),
      itemCount: catalog.itemCount,
    }))),
    { count: catalogs.length },
  );
  await writeSnapshotFile(
    rootPath,
    files,
    "catalogs/items.jsonl",
    "Catalog item rows",
    toJsonLines(catalogItems),
    {
      count: catalogItems.length,
      description: "Use searchLineItemCandidates/recommendCostSource before creating rows.",
      truncated: catalogItems.length >= MAX_CATALOG_ITEMS,
    },
  );

  const rateScheduleItems = [
    ...flattenRateScheduleItems(globalRateSchedules, "global"),
    ...flattenRateScheduleItems(revisionRateSchedules, "revision"),
  ];
  counts.rateScheduleItems = rateScheduleItems.length;
  await writeSnapshotFile(
    rootPath,
    files,
    "rate-schedules/schedules.jsonl",
    "Rate schedule index",
    toJsonLines([...globalRateSchedules, ...revisionRateSchedules].map((schedule) => ({
      id: schedule.id,
      name: schedule.name,
      description: compact(schedule.description),
      category: schedule.category,
      scope: schedule.scope,
      projectId: schedule.projectId,
      revisionId: schedule.revisionId,
      sourceScheduleId: schedule.sourceScheduleId,
      effectiveDate: schedule.effectiveDate,
      expiryDate: schedule.expiryDate,
      tierCount: arrayCount(schedule.tiers),
      itemCount: arrayCount(schedule.items),
    }))),
    { count: globalRateSchedules.length + revisionRateSchedules.length },
  );
  await writeSnapshotFile(
    rootPath,
    files,
    "rate-schedules/items.jsonl",
    "Rate schedule items",
    toJsonLines(rateScheduleItems),
    { count: rateScheduleItems.length, description: "Use importRateSchedule/getItemConfig for revision-safe item IDs." },
  );

  await writeSnapshotFile(
    rootPath,
    files,
    "labor-units/libraries.jsonl",
    "Labor unit library index",
    toJsonLines(laborLibraries.map((library) => ({
      id: library.id,
      name: library.name,
      description: compact(library.description),
      provider: library.provider,
      discipline: library.discipline,
      source: library.source,
      sourceDescription: compact(library.sourceDescription),
      sourceDatasetId: library.sourceDatasetId,
      tags: library.tags,
      unitCount: library.unitCount,
    }))),
    { count: laborLibraries.length },
  );
  await writeSnapshotFile(
    rootPath,
    files,
    "labor-units/units.jsonl",
    "Labor productivity units",
    toJsonLines(laborUnitsResult.units.map((unit) => ({
      id: unit.id,
      libraryId: unit.libraryId,
      catalogItemId: unit.catalogItemId,
      code: unit.code,
      name: unit.name,
      description: compact(unit.description),
      discipline: unit.discipline,
      category: unit.category,
      className: unit.className,
      subClassName: unit.subClassName,
      outputUom: unit.outputUom,
      hoursNormal: unit.hoursNormal,
      hoursDifficult: unit.hoursDifficult,
      hoursVeryDifficult: unit.hoursVeryDifficult,
      defaultDifficulty: unit.defaultDifficulty,
      entityCategoryType: unit.entityCategoryType,
      tags: unit.tags,
      sourceRef: unit.sourceRef,
    }))),
    {
      count: laborUnitsResult.units.length,
      description: "Use IDs with listLaborUnits and preserve laborUnitId/sourceNotes.",
      truncated: laborUnitsResult.units.length < laborUnitsResult.total,
    },
  );

  const assemblies = await Promise.all(
    assemblySummaries.map((assembly) => safeCall(
      `assembly ${assembly.name ?? assembly.id}`,
      warnings,
      () => store.getAssembly && typeof assembly.id === "string" ? store.getAssembly(assembly.id) : Promise.resolve(null),
      null,
    )),
  );
  await writeSnapshotFile(
    rootPath,
    files,
    "assemblies/index.jsonl",
    "Assembly index",
    toJsonLines(assemblySummaries),
    { count: assemblySummaries.length, description: "Use previewAssembly before inserting assembly-backed scope." },
  );
  await writeSnapshotFile(
    rootPath,
    files,
    "assemblies/full.jsonl",
    "Assembly definitions",
    toJsonLines(assemblies.filter((assembly): assembly is JsonRecord => !!assembly)),
    { count: assemblies.filter(Boolean).length, description: "Includes parameters and component source IDs." },
  );

  if (organizationId) {
    const [costSummary, resources, effectiveCosts] = await Promise.all([
      safeCall("cost intelligence summary", warnings, () => costIntelligenceService.getSummary(organizationId), { resources: 0, observations: 0, effectiveCosts: 0, vendors: 0 }),
      safeCall("cost resources", warnings, () => costIntelligenceService.listResources(organizationId, { limit: MAX_COST_ROWS }), []),
      safeCall("effective costs", warnings, () => costIntelligenceService.listEffectiveCosts(organizationId, { projectId, limit: MAX_COST_ROWS, scope: "all" }), []),
    ]);
    counts.costResources = numberValue((costSummary as JsonRecord).resources);
    counts.costObservations = numberValue((costSummary as JsonRecord).observations);
    counts.effectiveCosts = numberValue((costSummary as JsonRecord).effectiveCosts);
    counts.costVendors = numberValue((costSummary as JsonRecord).vendors);
    await writeSnapshotFile(
      rootPath,
      files,
      "cost-intelligence/summary.json",
      "Cost intelligence summary",
      JSON.stringify(costSummary, null, 2),
      { description: "Counts for resources, observations, vendors, and effective costs." },
    );
    await writeSnapshotFile(
      rootPath,
      files,
      "cost-intelligence/resources.jsonl",
      "Cost intelligence resources",
      toJsonLines((resources as JsonRecord[]).map((resource) => ({
        id: resource.id,
        catalogItemId: resource.catalogItemId,
        resourceType: resource.resourceType,
        category: resource.category,
        code: resource.code,
        name: resource.name,
        description: compact(resource.description),
        manufacturer: resource.manufacturer,
        manufacturerPartNumber: resource.manufacturerPartNumber,
        defaultUom: resource.defaultUom,
        aliases: resource.aliases,
        tags: resource.tags,
        metadata: resource.metadata,
        active: resource.active,
      }))),
      {
        count: (resources as JsonRecord[]).length,
        description: "Use searchLineItemCandidates/recommendCostSource for linked worksheet rows.",
        truncated: (resources as JsonRecord[]).length < counts.costResources,
      },
    );
    await writeSnapshotFile(
      rootPath,
      files,
      "cost-intelligence/effective-costs.jsonl",
      "Effective cost bases",
      toJsonLines((effectiveCosts as JsonRecord[]).map((cost) => ({
        id: cost.id,
        resourceId: cost.resourceId,
        resourceName: (cost.resource as JsonRecord | null | undefined)?.name,
        resourceType: (cost.resource as JsonRecord | null | undefined)?.resourceType,
        category: (cost.resource as JsonRecord | null | undefined)?.category,
        projectId: cost.projectId,
        vendorName: cost.vendorName,
        region: cost.region,
        uom: cost.uom,
        unitCost: cost.unitCost,
        unitPrice: cost.unitPrice,
        currency: cost.currency,
        effectiveDate: cost.effectiveDate,
        expiresAt: cost.expiresAt,
        sourceObservationId: cost.sourceObservationId,
        method: cost.method,
        sampleSize: cost.sampleSize,
        confidence: cost.confidence,
        metadata: cost.metadata,
      }))),
      {
        count: (effectiveCosts as JsonRecord[]).length,
        description: "Preserve effectiveCostId/costResourceId when used.",
        truncated: (effectiveCosts as JsonRecord[]).length < counts.effectiveCosts,
      },
    );
  } else {
    warnings.push("No organizationId on request; cost intelligence snapshots were skipped.");
  }

  const snapshot: LibrarySnapshotInfo = {
    rootDir: SNAPSHOT_ROOT,
    generatedAt: new Date().toISOString(),
    files: [],
    counts,
    warnings,
  };

  const readmeFile: LibrarySnapshotFile = {
    path: `${SNAPSHOT_ROOT}/README.md`,
    label: "How to use these snapshots",
  };
  const indexFile: LibrarySnapshotFile = {
    path: `${SNAPSHOT_ROOT}/library-index.md`,
    label: "Counts and file manifest",
  };
  snapshot.files = [readmeFile, indexFile, ...files];

  await writeFile(join(rootPath, "README.md"), buildReadme(snapshot), "utf-8");
  await writeFile(join(rootPath, "library-index.md"), buildIndexMarkdown(snapshot), "utf-8");

  return snapshot;
}
