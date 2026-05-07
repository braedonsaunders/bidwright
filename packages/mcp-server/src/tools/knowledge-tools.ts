import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, projectPath, getProjectId } from "../api-client.js";

const LIBRARY_SNAPSHOT_ROOT = "library-snapshots";
const SEARCH_FILE_EXTENSIONS = [".search.txt", ".md"];

function truncateText(text: string, maxChars = 12_000, offset = 0) {
  const safeOffset = Math.max(0, offset);
  const safeMax = Math.max(1, Math.min(maxChars, 30_000));
  const slice = text.slice(safeOffset, safeOffset + safeMax);
  return {
    text: slice,
    totalChars: text.length,
    offset: safeOffset,
    maxChars: safeMax,
    hasMore: safeOffset + slice.length < text.length,
  };
}

function paginate<T>(rows: T[], input: { limit?: number; offset?: number }, defaultLimit = 50, maxLimit = 200) {
  const offset = Math.max(0, input.offset ?? 0);
  const limit = Math.max(1, Math.min(input.limit ?? defaultLimit, maxLimit));
  const page = rows.slice(offset, offset + limit);
  return { rows: page, total: rows.length, offset, limit, hasMore: offset + page.length < rows.length };
}

function compactValue(value: unknown, maxChars = 220) {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}...` : text;
}

function compactRow(row: any, maxColumns = 30) {
  const record = row?.data && typeof row.data === "object" ? row.data : row;
  if (!record || typeof record !== "object" || Array.isArray(record)) return compactValue(record);
  return Object.fromEntries(
    Object.entries(record)
      .slice(0, maxColumns)
      .map(([key, value]) => [key, compactValue(value)]),
  );
}

function textMatches(value: unknown, q?: string | null) {
  const query = q?.trim().toLowerCase();
  if (!query) return true;
  return String(value ?? "").toLowerCase().includes(query);
}

function getProjectIdForLibraryQuery() {
  const projectId = getProjectId().trim();
  return projectId.startsWith("project-") ? projectId : null;
}

function apiKnowledgeScope(scope: "project" | "library" | "all") {
  if (scope === "library") return "global";
  return scope;
}

function searchMatchMetadata(hit: any) {
  const match = hit?.metadata?.searchMatch && typeof hit.metadata.searchMatch === "object"
    ? hit.metadata.searchMatch
    : {};
  return Object.keys(match).length > 0 ? {
    matchScore: match.score,
    coverage: match.coverage,
    matchedTerms: Array.isArray(match.matchedTerms) ? match.matchedTerms.slice(0, 12) : undefined,
    matchedPhrases: Array.isArray(match.matchedPhrases) ? match.matchedPhrases.slice(0, 6) : undefined,
    anchorMatches: match.anchorMatches,
  } : {};
}

function columnKeyFromLabel(value: unknown, index: number) {
  const key = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return key || `column_${index + 1}`;
}

function uniqueColumnKey(baseKey: string, usedKeys: Set<string>) {
  let key = baseKey;
  let suffix = 2;
  while (usedKeys.has(key)) {
    key = `${baseKey}_${suffix}`;
    suffix += 1;
  }
  usedKeys.add(key);
  return key;
}

function normalizeColumnType(value: unknown) {
  const type = String(value ?? "text").trim().toLowerCase();
  if (type === "string") return "text";
  if (["text", "number", "currency", "percentage", "date", "boolean", "select"].includes(type)) return type;
  return "text";
}

function normalizeSourcePages(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry ?? "").trim())
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return value.trim();
  return "";
}

function resolveQuery(input: { query?: string; q?: string }) {
  return (input.query ?? input.q ?? "").trim();
}

type LibraryCorpusScope = "all" | "knowledge" | "datasets" | "cost" | "catalogs" | "rates" | "labor" | "assemblies";

function corpusQueryTerms(query: string) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9._#/-]+/g, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 1);
}

function corpusLineScore(line: string, query: string, terms: string[]) {
  const lower = line.toLowerCase();
  const exact = lower.includes(query.toLowerCase()) ? 100 : 0;
  const termScore = terms.reduce((score, term) => score + (lower.includes(term) ? 5 : 0), 0);
  return exact + termScore;
}

function corpusFileInScope(relativePath: string, scope: LibraryCorpusScope) {
  const rel = relativePath.replace(/\\/g, "/").toLowerCase();
  if (scope === "all") return true;
  if (scope === "knowledge") return rel.includes("knowledge") || rel.includes("books");
  if (scope === "datasets") return rel.includes("dataset");
  if (scope === "cost") return rel.includes("cost") || rel.includes("effective");
  if (scope === "catalogs") return rel.includes("catalog");
  if (scope === "rates") return rel.includes("rate");
  if (scope === "labor") return rel.includes("labor") || rel.includes("labour");
  if (scope === "assemblies") return rel.includes("assembl");
  return true;
}

async function listLibraryCorpusFiles(root: string): Promise<string[]> {
  async function walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await walk(path));
      } else if (entry.isFile() && SEARCH_FILE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
        files.push(path);
      }
    }
    return files;
  }

  const searchRoot = join(root, "search");
  try {
    return await walk(searchRoot);
  } catch {
    return await walk(root);
  }
}

async function searchLibraryCorpusFiles(input: {
  query: string;
  scope: LibraryCorpusScope;
  limit: number;
}) {
  const root = resolve(process.cwd(), LIBRARY_SNAPSHOT_ROOT);
  const rootStat = await stat(root).catch(() => null);
  if (!rootStat?.isDirectory()) {
    return {
      root,
      filesSearched: 0,
      linesScanned: 0,
      matches: [],
      warning: `No ${LIBRARY_SNAPSHOT_ROOT} folder exists in the MCP runtime cwd. Start an intake/review run so Bidwright writes the runtime library corpus first.`,
    };
  }

  const terms = corpusQueryTerms(input.query);
  const files = (await listLibraryCorpusFiles(root))
    .map((path) => ({ path, relativePath: relative(root, path).replace(/\\/g, "/") }))
    .filter((file) => corpusFileInScope(file.relativePath, input.scope));
  const matches: Array<{ file: string; lineNumber: number; score: number; text: string }> = [];
  let linesScanned = 0;
  const maxKeep = Math.max(input.limit * 20, 200);

  for (const file of files) {
    const reader = createInterface({
      input: createReadStream(file.path, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    let lineNumber = 0;
    for await (const line of reader) {
      lineNumber += 1;
      linesScanned += 1;
      const score = corpusLineScore(line, input.query, terms);
      if (score <= 0) continue;
      matches.push({
        file: `${LIBRARY_SNAPSHOT_ROOT}/${file.relativePath}`,
        lineNumber,
        score,
        text: line.length > 1800 ? `${line.slice(0, 1800)}...[truncated]` : line,
      });
      if (matches.length > maxKeep) {
        matches.sort((left, right) => right.score - left.score || left.file.localeCompare(right.file) || left.lineNumber - right.lineNumber);
        matches.length = maxKeep;
      }
    }
  }

  matches.sort((left, right) => right.score - left.score || left.file.localeCompare(right.file) || left.lineNumber - right.lineNumber);
  return {
    root,
    filesSearched: files.length,
    linesScanned,
    matches: matches.slice(0, input.limit),
    warning: undefined,
  };
}

export function registerKnowledgeTools(server: McpServer) {

  // ── queryKnowledge ────────────────────────────────────────
  server.tool(
    "queryKnowledge",
    `Search the knowledge base for information. Searches both project documents and the global library (estimating manuals, rate books, standards). Use this to find man-hour estimates, material specs, labour productivity data, pricing references, and any domain knowledge. Returns text snippets with source, page number, and section title.`,
    {
      query: z.string().optional().describe("Search query — be specific about what you need"),
      q: z.string().optional().describe("Alias for query; accepted for consistency with other search tools."),
      scope: z.enum(["project", "library", "all"]).default("all").describe("Search scope: project docs only, global library only, or all"),
      limit: z.coerce.number().int().positive().max(25).default(10).describe("Max results to return"),
    },
    async (input) => {
      const query = resolveQuery(input);
      const { scope, limit } = input;
      if (!query) {
        return {
          content: [{ type: "text" as const, text: "ERROR: query is required. Pass query (or q) with the labour/productivity phrase to search." }],
          isError: true,
        };
      }
      // Use the text-based search which outperforms vector search for this use case
      const params = new URLSearchParams({ q: query, limit: String(limit), scope: apiKnowledgeScope(scope) });
      const data = await apiGet(`/knowledge/search?${params}`);
      const results = Array.isArray(data) ? data : (data.results || []);
      const hits = results.map((h: any) => ({
        text: h.text?.substring(0, 600),
        source: h.source || h.bookName,
        sourceType: h.sourceType,
        bookName: h.bookName,
        documentTitle: h.documentTitle,
        pageTitle: h.pageTitle,
        documentId: h.documentId,
        pageId: h.pageId,
        sectionTitle: h.sectionTitle,
        pageNumber: h.pageNumber,
        score: h.score ?? h.metadata?.searchMatch?.score,
        ...searchMatchMetadata(h),
      }));
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          query,
          scope,
          resultCount: hits.length,
          hits,
          guidance: [
            "Use matchedTerms/matchedPhrases to judge whether the result really matches the work activity.",
            "If top hits are context-only, refine with the trade, material, action verb, size/class, and desired unit such as hours/ton or hours/ea.",
          ],
        }, null, 2) }],
      };
    }
  );

  // ── queryGlobalLibrary ────────────────────────────────────
  server.tool(
    "queryGlobalLibrary",
    "Search the global knowledge library only — estimating manuals, labour productivity data, rate books, material specs, industry standards. Use this for domain knowledge like pipe installation hours per foot, equipment rental rates, etc. Returns text snippets with source, page, and section.",
    {
      query: z.string().optional().describe("What to search for — e.g. 'carbon steel butt weld pipe fittings labor hours'"),
      q: z.string().optional().describe("Alias for query; accepted for consistency with other search tools."),
      limit: z.coerce.number().int().positive().max(25).default(10),
    },
    async (input) => {
      const query = resolveQuery(input);
      const { limit } = input;
      if (!query) {
        return {
          content: [{ type: "text" as const, text: "ERROR: query is required. Pass query (or q) with the labour/productivity phrase to search." }],
          isError: true,
        };
      }
      const params = new URLSearchParams({ q: query, scope: "global", limit: String(limit) });
      const data = await apiGet(`/knowledge/search?${params}`);
      const results = Array.isArray(data) ? data : (data.results || []);
      const hits = results.map((h: any) => ({
        text: h.text?.substring(0, 600),
        source: h.source || h.bookName,
        sourceType: h.sourceType,
        bookName: h.bookName,
        documentTitle: h.documentTitle,
        pageTitle: h.pageTitle,
        documentId: h.documentId,
        pageId: h.pageId,
        sectionTitle: h.sectionTitle,
        pageNumber: h.pageNumber,
        score: h.score ?? h.metadata?.searchMatch?.score,
        ...searchMatchMetadata(h),
      }));
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ query, resultCount: hits.length, hits }, null, 2) }],
      };
    }
  );

  // ── searchLibraryCorpus ───────────────────────────────────
  server.tool(
    "searchLibraryCorpus",
    "Fast first-party search over the plain-text library corpora Bidwright writes into the agent runtime folder at intake start. Searches cost intelligence, catalogs, rate items, labor units, assemblies, datasets, and knowledge indexes. This is retrieval only; the estimating agent decides relevance.",
    {
      query: z.string().optional().describe("Search query, phrase, code, vendor, item, operation, or unit."),
      q: z.string().optional().describe("Alias for query."),
      scope: z.enum(["all", "knowledge", "datasets", "cost", "catalogs", "rates", "labor", "assemblies"]).default("all"),
      limit: z.coerce.number().int().positive().max(100).default(25),
    },
    async (input) => {
      const query = resolveQuery(input);
      if (!query) {
        return {
          content: [{ type: "text" as const, text: "ERROR: query is required. Pass query or q with the first-party library phrase to search." }],
          isError: true,
        };
      }
      const result = await searchLibraryCorpusFiles({
        query,
        scope: input.scope,
        limit: input.limit,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            query,
            scope: input.scope,
            ...result,
            guidance: [
              "This tool only retrieves matching first-party records from runtime text files; it does not decide what source is correct.",
              "Use returned IDs/file/line hits to call the authoritative MCP tools: searchLineItemCandidates, queryKnowledge, queryDatasets, listRateScheduleItems, listLaborUnits, searchCatalogs, or previewAssembly.",
              "For broad investigation, also use shell rg directly against library-snapshots/search.",
            ],
          }, null, 2),
        }],
      };
    },
  );

  // ── queryDatasets ─────────────────────────────────────────
  server.tool(
    "queryDatasets",
    "Search structured datasets for precise values — man hours, material weights, labour rates, equipment specs. Returns matching datasets with context (description, tags, notes) and sample rows. Use for concrete numbers when estimating.",
    {
      query: z.string().optional().describe("Search query — e.g. 'weld neck flange 6 inch 150 lb man hours'"),
      q: z.string().optional().describe("Alias for query; accepted for consistency with other search tools."),
      datasetId: z.string().optional().describe("Search within a specific dataset ID (if known from previous query)"),
      limit: z.coerce.number().int().positive().max(25).optional().default(5).describe("Max datasets to return"),
      offset: z.coerce.number().int().min(0).default(0).describe("Row offset when datasetId is provided."),
      rowLimit: z.coerce.number().int().positive().max(200).default(50).describe("Max matching rows to return when datasetId is provided."),
      sampleRowLimit: z.coerce.number().int().positive().max(10).default(3).describe("Sample rows per dataset in global search."),
    },
    async (input) => {
      const query = resolveQuery(input);
      const { datasetId, limit, offset, rowLimit, sampleRowLimit } = input;
      if (!query) {
        return {
          content: [{ type: "text" as const, text: "ERROR: query is required. Pass query (or q) with the dataset/man-hour phrase to search." }],
          isError: true,
        };
      }
      if (datasetId) {
        // Search within a specific dataset. Keep rows paginated so one dataset cannot consume the tool context.
        const params = new URLSearchParams({ q: query });
        const data = await apiGet(`/datasets/${datasetId}/search?${params}`);
        const dataset = await apiGet(`/datasets/${datasetId}`);
        const rawRows = Array.isArray(data) ? data : (Array.isArray(data.rows) ? data.rows : []);
        const page = paginate(rawRows.map((row: any) => compactRow(row)), { limit: rowLimit, offset }, 50, 200);
        return { content: [{ type: "text" as const, text: JSON.stringify({
          dataset: {
            id: dataset.id,
            name: dataset.name,
            description: compactValue(dataset.description, 500),
            tags: dataset.tags,
            columns: Array.isArray(dataset.columns)
              ? dataset.columns.slice(0, 40).map((column: any) => ({
                  key: column.key,
                  name: column.name || column.label,
                  type: column.type,
                }))
              : dataset.columns,
            columnCount: Array.isArray(dataset.columns) ? dataset.columns.length : undefined,
          },
          rows: {
            total: page.total,
            offset: page.offset,
            limit: page.limit,
            hasMore: page.hasMore,
            values: page.rows,
          },
          note: "Rows are compact and paginated. Use offset/rowLimit or a narrower query to continue. Column names show units and conditions.",
        }, null, 2) }] };
      }

      // Global search — returns matching datasets with sample rows
      const params = new URLSearchParams({ q: query, limit: String(limit || 5) });
      const data = await apiGet(`/datasets/search/global?${params}`);
      const results = (data.results || []).map((r: any) => ({
        datasetId: r.datasetId,
        name: r.datasetName,
        description: compactValue(r.description, 500),
        tags: r.tags,
        columns: r.columns?.slice(0, 30).map((c: any) => ({ key: c.key, name: c.name || c.label, type: c.type })),
        columnCount: r.columns?.length ?? 0,
        rowCount: r.rowCount,
        sampleRows: Array.isArray(r.sampleRows) ? r.sampleRows.slice(0, sampleRowLimit).map((row: any) => compactRow(row)) : [],
        note: "Call queryDatasets again with datasetId plus rowLimit/offset for focused matching rows.",
      }));
      return { content: [{ type: "text" as const, text: JSON.stringify({
        query,
        matchedDatasets: results.length,
        datasets: results,
      }, null, 2) }] };
    }
  );

  // ── createDataset ────────────────────────────────────────
  server.tool(
    "createDataset",
    "Create a new structured dataset with columns and rows. Use this to store extracted table data from knowledge books. Include rich tags for searchability.",
    {
      name: z.string().describe("Descriptive dataset name"),
      description: z.string().describe("What this dataset contains, source section, any conditions/notes"),
      category: z.string().default("custom").describe("Dataset category, e.g. labour_units, equipment_rates, material_prices, productivity, burden_rates, or custom"),
      tags: z.array(z.string()).default([]).describe("Rich search tags: material type, operation, units, etc."),
      sourceBookId: z.string().optional().describe("Knowledge book ID this was extracted from"),
      sourcePages: z.union([z.string(), z.coerce.number(), z.array(z.union([z.string(), z.coerce.number()]))]).optional().describe("Page range(s) e.g. '85-87, 100'. Arrays are accepted and normalized."),
      columns: z.array(z.object({
        key: z.string().optional().describe("Column key (snake_case). If omitted it is generated from label/name."),
        label: z.string().optional().describe("Human-readable column name"),
        name: z.string().optional().describe("Human-readable column name; accepted as an alias for label"),
        type: z.enum(["text", "string", "number", "currency", "percentage", "date", "boolean", "select"]).default("text"),
      })).describe("Column definitions"),
      rows: z.array(z.union([
        z.record(z.string(), z.any()),
        z.array(z.any()),
      ])).describe("Rows as objects keyed by column key. Arrays are accepted and mapped to columns by order."),
    },
    async ({ name, description, category, tags, sourceBookId, sourcePages, columns, rows }) => {
      const usedKeys = new Set<string>();
      const columnAliases: string[][] = [];
      const normalizedColumns = columns.map((col: any, index: number) => {
        const label = String(col.label || col.name || col.key || `Column ${index + 1}`).trim();
        const key = uniqueColumnKey(columnKeyFromLabel(col.key || label, index), usedKeys);
        columnAliases[index] = [key, col.key, col.label, col.name, label]
          .map((alias) => String(alias ?? "").trim())
          .filter((alias, aliasIndex, aliases) => alias && aliases.indexOf(alias) === aliasIndex);
        return {
          key,
          name: label,
          type: normalizeColumnType(col.type),
          required: false,
        };
      });

      const normalizedRows = rows.map((row: any) => {
        if (Array.isArray(row)) {
          return Object.fromEntries(
            normalizedColumns.map((column, index) => [column.key, row[index] ?? null]),
          );
        }
        if (row && typeof row === "object") {
          return Object.fromEntries(
            normalizedColumns.map((column, index) => {
              const aliases = columnAliases[index] ?? [column.key];
              const matchedAlias = aliases.find((alias) => Object.prototype.hasOwnProperty.call(row, alias));
              return [column.key, matchedAlias ? row[matchedAlias] : null];
            }),
          );
        }
        return {};
      });

      // Create the dataset
      const dataset = await apiPost(`/datasets`, {
        name,
        description,
        category,
        scope: "global",
        columns: normalizedColumns,
        source: "book-extraction",
        sourceDescription: sourceBookId ? `Extracted from knowledge book ${sourceBookId}` : "AI extraction",
        sourceBookId,
        sourcePages: normalizeSourcePages(sourcePages),
        tags,
      });

      // Insert rows in batch
      if (normalizedRows.length > 0) {
        await apiPost(`/datasets/${dataset.id}/rows/batch`, { rows: normalizedRows });
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            datasetId: dataset.id,
            name,
            rowCount: normalizedRows.length,
            columnCount: normalizedColumns.length,
            tags,
          }, null, 2),
        }],
      };
    }
  );

  // ── listDatasets ────────────────────────────────────────
  server.tool(
    "listDatasets",
    "List existing datasets in the organization as a compact, paginated index. Use queryDatasets for focused row searches.",
    {
      q: z.string().optional().describe("Optional search across name, description, category, and tags."),
      category: z.string().optional(),
      limit: z.coerce.number().int().positive().max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    },
    async (input) => {
      const data = await apiGet(`/datasets`);
      const q = input.q?.trim().toLowerCase();
      const all = (Array.isArray(data) ? data : data.datasets || [])
        .filter((d: any) => !input.category || String(d.category ?? "").toLowerCase() === input.category!.trim().toLowerCase())
        .filter((d: any) => {
          if (!q) return true;
          return [
            d.name,
            d.description,
            d.category,
            ...(Array.isArray(d.tags) ? d.tags : []),
          ].some((value) => String(value ?? "").toLowerCase().includes(q));
        })
        .map((d: any) => ({
          id: d.id,
          name: d.name,
          description: d.description?.substring(0, 180),
          category: d.category,
          tags: d.tags,
          rowCount: d.rowCount,
          columns: d.columns?.slice(0, 20).map((c: any) => c.label || c.key),
          columnCount: d.columns?.length ?? 0,
          source: d.source,
        }));
      const page = paginate(all, input, 50, 200);
      return { content: [{ type: "text" as const, text: JSON.stringify({
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        hasMore: page.hasMore,
        datasets: page.rows,
      }, null, 2) }] };
    }
  );

  // ── getDocumentStructured ─────────────────────────────────
  server.tool(
    "listKnowledgeBooks",
    "List the available knowledge books for this project and organization. Use this before reading handbook/reference content so you know the IDs to pass into readDocumentText.",
    {
      q: z.string().optional().describe("Optional name/category/source filename search."),
      category: z.string().optional(),
      limit: z.coerce.number().int().positive().max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    },
    async (input) => {
      const params = new URLSearchParams();
      const projectId = getProjectIdForLibraryQuery();
      if (projectId) params.set("projectId", projectId);
      const data = await apiGet(`/knowledge/books?${params}`);
      const books = (Array.isArray(data) ? data : [])
        .filter((book: any) => !input.category || String(book.category ?? "").toLowerCase() === input.category!.trim().toLowerCase())
        .filter((book: any) => textMatches(`${book.name ?? ""} ${book.sourceFileName ?? ""} ${book.category ?? ""}`, input.q))
        .map((book: any) => ({
          id: book.id,
          name: book.name,
          sourceFileName: book.sourceFileName,
          category: book.category,
          pageCount: book.pageCount,
          scope: book.scope,
          projectId: book.projectId,
        }));
      const page = paginate(books, input, 50, 200);
      return { content: [{ type: "text" as const, text: JSON.stringify({
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        hasMore: page.hasMore,
        books: page.rows,
      }, null, 2) }] };
    }
  );

  server.tool(
    "listKnowledgeDocuments",
    "List manually-authored knowledge page libraries in the organization. Use these IDs with readDocumentText when you need full markdown content from a knowledge page search result.",
    {
      q: z.string().optional().describe("Optional title/description/category/tag search."),
      category: z.string().optional(),
      limit: z.coerce.number().int().positive().max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    },
    async (input) => {
      const params = new URLSearchParams();
      const projectId = getProjectIdForLibraryQuery();
      if (projectId) params.set("projectId", projectId);
      const data = await apiGet(`/knowledge/documents?${params}`);
      const documents = (Array.isArray(data) ? data : [])
        .filter((document: any) => !input.category || String(document.category ?? "").toLowerCase() === input.category!.trim().toLowerCase())
        .filter((document: any) => textMatches([
          document.title,
          document.description,
          document.category,
          ...(Array.isArray(document.tags) ? document.tags : []),
        ].join(" "), input.q))
        .map((document: any) => ({
          id: document.id,
          title: document.title,
          description: compactValue(document.description, 240),
          category: document.category,
          tags: document.tags,
          pageCount: document.pageCount,
          chunkCount: document.chunkCount,
          scope: document.scope,
          status: document.status,
        }));
      const page = paginate(documents, input, 50, 200);
      return { content: [{ type: "text" as const, text: JSON.stringify({
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        hasMore: page.hasMore,
        documents: page.rows,
      }, null, 2) }] };
    }
  );

  server.tool(
    "readDocumentText",
    "Read extracted text for a project document, knowledge book, or manually-authored knowledge page library by ID. Use IDs from the project manifest, listKnowledgeBooks, or listKnowledgeDocuments. For spreadsheets, use readSpreadsheet instead. For table-heavy PDFs, pair this with getDocumentStructured.",
    {
      documentId: z.string().describe("SourceDocument ID, KnowledgeBook ID, or KnowledgeDocument ID"),
      pages: z.string().optional().describe("Optional page range like '1-5' or single page like '12'"),
      offset: z.coerce.number().int().min(0).default(0).describe("Character offset for chunking long extracted text."),
      maxChars: z.coerce.number().int().positive().max(30000).default(12000).describe("Maximum characters to return. Default keeps tool output below context limits."),
    },
    async ({ documentId, pages, offset, maxChars }) => {
      const params = pages ? `?pages=${encodeURIComponent(pages)}` : "";
      const data = await apiGet(`/api/knowledge/documents/${getProjectId()}/${documentId}${params}`);
      const doc = data.document || data;
      const sections = Array.isArray(doc.chunks)
        ? [...new Set(doc.chunks.map((chunk: any) => chunk.sectionTitle).filter(Boolean))]
        : [];
      const header = [
        `File: ${doc.fileName || doc.bookName || doc.documentTitle || documentId}`,
        doc.sourceType ? `Source type: ${doc.sourceType}` : null,
        doc.documentType ? `Type: ${doc.documentType}` : null,
        doc.category ? `Category: ${doc.category}` : null,
        doc.pageCount ? `Pages: ${doc.pageCount}` : null,
        pages ? `Requested pages: ${pages}` : null,
      ].filter(Boolean).join("\n");
      const content = typeof doc.content === "string" ? doc.content.trim() : "";
      const chunk = truncateText(content, maxChars, offset);

      let output = `${header}\n\n`;
      if (sections.length > 0) {
        output += `Sections: ${sections.join(", ")}\n\n`;
      }
      output += chunk.text || "(No extracted text available for this document.)";
      if (chunk.hasMore) {
        output += `\n\n[TRUNCATED: returned ${chunk.text.length} of ${chunk.totalChars} chars from offset ${chunk.offset}. Call readDocumentText again with offset=${chunk.offset + chunk.text.length} and the same pages/maxChars to continue, or request a narrower page range.]`;
      }

      return { content: [{ type: "text" as const, text: output }] };
    }
  );

  server.tool(
    "getDocumentStructured",
    "Get the Azure Document Intelligence structured extraction for a project source document: tables (as markdown), key-value pairs, section headings, and page-by-page text. For knowledge books, use readDocumentText and getBookPage instead.",
    {
      documentId: z.string().describe("SourceDocument ID"),
      maxTables: z.coerce.number().int().positive().max(20).default(5),
      maxTableChars: z.coerce.number().int().positive().max(12000).default(3000),
    },
    async ({ documentId, maxTables, maxTableChars }) => {
      const data = await apiGet(`/api/knowledge/documents/${getProjectId()}/${documentId}`);
      // Return structured data if available
      const doc = data.document || data;
      const result: any = {
        fileName: doc.fileName,
        pageCount: doc.pageCount,
        documentType: doc.documentType,
      };
      if (doc.structuredData) {
        const tables = Array.isArray(doc.structuredData.tables) ? doc.structuredData.tables : [];
        result.tableCount = tables.length;
        result.tables = tables.slice(0, maxTables).map((table: any) => {
          const markdown = typeof table.markdown === "string" ? table.markdown : "";
          const chunk = truncateText(markdown, maxTableChars, 0);
          return {
            pageNumber: table.pageNumber ?? table.page,
            rowCount: table.rowCount ?? table.rows,
            columnCount: table.columnCount ?? table.columns,
            caption: compactValue(table.caption ?? table.title, 240),
            markdown: chunk.text,
            truncated: chunk.hasMore,
            totalMarkdownChars: chunk.totalChars,
          };
        });
        result.keyValuePairs = Array.isArray(doc.structuredData.keyValuePairs)
          ? doc.structuredData.keyValuePairs.slice(0, 100)
          : doc.structuredData.keyValuePairs;
      }
      // Include section headings from chunks if available
      if (doc.chunks) {
        result.sections = [...new Set(doc.chunks.map((c: any) => c.sectionTitle).filter(Boolean))];
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── readSpreadsheet ─────────────────────────────────────
  server.tool(
    "readSpreadsheet",
    "Read an xlsx/xls/csv spreadsheet and return its contents as markdown tables. Use this for ANY spreadsheet document — Claude Code cannot natively parse binary xlsx files. Returns all sheets (or a specific sheet) as readable markdown tables with headers.",
    {
      documentId: z.string().describe("SourceDocument ID of the spreadsheet file (from the document manifest in CLAUDE.md)"),
      sheet: z.string().optional().describe("Optional sheet name to read. If omitted, returns all sheets."),
      offset: z.coerce.number().int().min(0).default(0).describe("Character offset for chunking large workbook output."),
      maxChars: z.coerce.number().int().positive().max(30000).default(16000).describe("Maximum output characters. Use sheet to narrow large workbooks."),
    },
    async ({ documentId, sheet, offset, maxChars }) => {
      try {
        const params = sheet ? `?sheet=${encodeURIComponent(sheet)}` : "";
        const data = await apiGet(`/api/knowledge/read-spreadsheet/${documentId}${params}`);
        const result = data as any;

        // Build a readable text output
        let output = `📊 Spreadsheet: ${result.fileName}\n`;
        output += `Sheets: ${result.allSheetNames.join(", ")} (${result.sheetCount} total)\n\n`;

        for (const s of result.sheets) {
          output += `## Sheet: ${s.name} (${s.rowCount} rows)\n\n`;
          output += s.markdown + "\n\n";
        }

        const chunk = truncateText(output, maxChars, offset);
        const suffix = chunk.hasMore
          ? `\n\n[TRUNCATED: returned ${chunk.text.length} of ${chunk.totalChars} chars from offset ${chunk.offset}. Call readSpreadsheet again with offset=${chunk.offset + chunk.text.length} and the same sheet/maxChars to continue, or use sheet to narrow.]`
          : "";
        return { content: [{ type: "text" as const, text: chunk.text + suffix }] };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `ERROR reading spreadsheet: ${err?.message || String(err)}. This may not be a spreadsheet file, or the document ID may be wrong. Check the document manifest for the correct ID.` }],
          isError: true,
        };
      }
    }
  );

  // ── getBookPage ──────────────────────────────────────────
  server.tool(
    "getBookPage",
    "Get the file path and page details for a knowledge book page so you can read it directly. When search results reference a book and page number, use this to get the actual file path, then use the Read tool to view the real PDF page (with vision). This lets you see the original tables, diagrams, and formatting that OCR may have garbled.",
    {
      bookId: z.string().describe("Knowledge book ID (from search results)"),
      pageNumber: z.coerce.number().describe("Page number to view"),
    },
    async ({ bookId, pageNumber }) => {
      const data = await apiGet(`/knowledge/books/${bookId}/info`);
      const book = data.book || data;
      if (!book || !book.storagePath) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Book not found or no file stored" }) }] };
      }
      // Return the file path relative to the project working directory
      // The CLI agent can use Read tool with pages parameter to view it
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          bookName: book.name,
          fileName: book.sourceFileName,
          filePath: `../../${book.storagePath}`, // Relative to project workdir
          pageNumber,
          totalPages: book.pageCount,
          hint: `Use the Read tool on the filePath with pages="${pageNumber}" to view this page visually. The PDF page will be rendered as an image so you can read tables and diagrams directly.`,
        }, null, 2) }],
      };
    }
  );

  // ── searchCatalogs ────────────────────────────────────────
  server.tool(
    "searchCatalogs",
    "Search the equipment and material catalogs for items with pricing. Returns catalog items with name, code, unit, unitCost, unitPrice.",
    {
      query: z.string().describe("Search query — e.g. 'fork truck' or 'welder'"),
      catalogId: z.string().optional(),
      limit: z.coerce.number().int().positive().max(100).default(25),
      offset: z.coerce.number().int().min(0).default(0),
    },
    async ({ query, catalogId, limit, offset }) => {
      const params = new URLSearchParams({ q: query });
      if (catalogId) params.set("catalogId", catalogId);
      const data = await apiGet(`/catalogs/search?${params}`);
      const rows = (Array.isArray(data) ? data : data.items || []).map((item: any) => ({
        id: item.id,
        catalogId: item.catalogId,
        catalogName: item.catalogName ?? item.catalog?.name,
        name: item.name,
        code: item.code,
        unit: item.unit,
        unitCost: item.unitCost,
        unitPrice: item.unitPrice,
        description: compactValue(item.description, 220),
        metadata: item.metadata ? compactValue(item.metadata, 500) : undefined,
      }));
      const page = paginate(rows, { limit, offset }, 25, 100);
      return { content: [{ type: "text" as const, text: JSON.stringify({
        query,
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        hasMore: page.hasMore,
        items: page.rows,
      }, null, 2) }] };
    }
  );

  // ── listDocuments ─────────────────────────────────────────
  server.tool(
    "listDocuments",
    "List all project documents with their metadata — fileName, fileType, documentType, pageCount, whether structured data is available. Use this to understand what documents you have before reading them.",
    {
      q: z.string().optional().describe("Optional file/category/status search."),
      documentType: z.string().optional(),
      limit: z.coerce.number().int().positive().max(200).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    },
    async (input) => {
      const data = await apiGet(`/api/knowledge/documents/${getProjectId()}/enhanced`);
      const docs = (data.documents || data || [])
        .filter((d: any) => !input.documentType || String(d.documentType ?? "").toLowerCase() === input.documentType!.trim().toLowerCase())
        .filter((d: any) => textMatches(`${d.fileName ?? ""} ${d.documentType ?? ""} ${d.category ?? ""} ${d.indexingStatus ?? ""}`, input.q))
        .map((d: any) => ({
          id: d.id,
          fileName: d.fileName,
          fileType: d.fileType,
          documentType: d.documentType,
          pageCount: d.pageCount,
          hasExtractedText: !!d.hasExtractedText,
          hasStructuredData: !!d.hasStructuredData,
          indexingStatus: d.indexingStatus,
          category: d.category ?? null,
          knowledgeBookId: d.knowledgeBookId ?? null,
          knowledgeDocumentId: d.knowledgeDocumentId ?? null,
          chunkCount: d.chunkCount ?? 0,
        }));
      const page = paginate(docs, input, 100, 200);
      return { content: [{ type: "text" as const, text: JSON.stringify({
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        hasMore: page.hasMore,
        documents: page.rows,
      }, null, 2) }] };
    }
  );
}
