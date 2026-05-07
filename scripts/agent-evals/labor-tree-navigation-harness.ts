#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { prisma } from "../../packages/db/src/client.js";
import type { LaborUnit } from "@bidwright/domain";
import { PrismaApiStore } from "../../apps/api/src/prisma-store.js";
import type { LaborUnitTreeGroup, LaborUnitTreeParentType } from "../../apps/api/src/prisma-store.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(REPO_ROOT);

interface Args {
  orgId?: string;
  outDir: string;
  queries: string[];
  casesPath?: string;
  topBranches: number;
  unitLimit: number;
  variantCount: number;
  beamWidth: number;
  maxUnitPaths: number;
  help: boolean;
}

interface ProbeCase {
  name?: string;
  query: string;
  queries?: string[];
  expectedTerms?: string[];
  notes?: string;
}

interface ToolTrace {
  name: "listLaborUnitTree" | "listLaborUnits";
  input: Record<string, unknown>;
  durationMs: number;
  summary: Record<string, unknown>;
}

interface ExploredPath {
  library: LaborUnitTreeGroup;
  category?: LaborUnitTreeGroup;
  classNode?: LaborUnitTreeGroup;
  subClassNode?: LaborUnitTreeGroup;
  units: LaborUnit[];
  totalUnits: number;
}

interface ProbeResult {
  probe: ProbeCase;
  directUnits: LaborUnit[];
  directTotal: number;
  directDiagnostics?: any;
  variants: QueryVariantResult[];
  paths: ExploredPath[];
  traces: ToolTrace[];
  observations: string[];
}

interface QueryVariantResult {
  query: string;
  directUnits: LaborUnit[];
  directTotal: number;
  directDiagnostics?: any;
  rootNodes: LaborUnitTreeGroup[];
  rootTotal: number;
}

const DEFAULT_PROBES: ProbeCase[] = [
  {
    name: "Broad tank installation language",
    query: "FRP tank installation labor",
    expectedTerms: ["tank", "vessel"],
    notes: "Checks whether broad scope terms can still navigate toward library-native tank/vessel branches.",
  },
  {
    name: "Equipment setting",
    query: "equipment setting",
    expectedTerms: ["setting", "equipment"],
  },
  {
    name: "Footing formwork",
    query: "concrete footing form labor",
    expectedTerms: ["footing", "form"],
  },
  {
    name: "Pipe installation",
    query: "carbon steel pipe installation",
    expectedTerms: ["pipe", "carbon"],
  },
  {
    name: "Weak/possibly absent analog",
    query: "crane runway steel installation",
    expectedTerms: ["crane", "steel"],
    notes: "Useful when no perfect labor unit exists; the trace should make that visible instead of forcing a match.",
  },
];

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "labor",
  "labour",
  "of",
  "on",
  "or",
  "per",
  "the",
  "to",
  "unit",
  "with",
]);

function usage() {
  return `Labor unit tree navigation harness

Runs a small, fast loop around listLaborUnitTree/listLaborUnits so we can see
how an estimating agent would search, browse, refine, and either find or reject
labor-unit candidates.

Usage:
  pnpm eval:labor-tree
  pnpm eval:labor-tree -- --q "equipment setting" --q "pump installation"
  pnpm eval:labor-tree -- --cases ./scripts/agent-evals/labor-tree-cases.json

Options:
  --q <query>             Add one query probe. Can be repeated.
  --cases <path>          JSON array of { query, name?, expectedTerms?, notes? }.
  --org-id <id>           Organization id. Defaults to BIDWRIGHT_ORG_ID or first org.
  --out <dir>             Output dir. Defaults to .bidwright/evals/labor-tree/latest.
  --top-branches <n>      Number of branches to explore at each level. Default 3.
  --unit-limit <n>        Units to request per listLaborUnits call. Default 8.
  --variant-count <n>     Narrow follow-up queries to smoke-test per probe. Default 5.
  --beam-width <n>        Branches retained between tree levels. Default 8.
  --max-unit-paths <n>    Final tree paths to inspect with listLaborUnits. Default 10.
  --help                  Show this message.
`;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    outDir: path.resolve(".bidwright/evals/labor-tree/latest"),
    queries: [],
    topBranches: 3,
    unitLimit: 8,
    variantCount: 5,
    beamWidth: 8,
    maxUnitPaths: 10,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      index += 1;
      return value;
    };
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--q") args.queries.push(next());
    else if (arg === "--cases") args.casesPath = path.resolve(next());
    else if (arg === "--org-id") args.orgId = next();
    else if (arg === "--out") args.outDir = path.resolve(next());
    else if (arg === "--top-branches") args.topBranches = Math.max(1, Number(next()) || 3);
    else if (arg === "--unit-limit") args.unitLimit = Math.max(1, Number(next()) || 8);
    else if (arg === "--variant-count") args.variantCount = Math.max(0, Number(next()) || 0);
    else if (arg === "--beam-width") args.beamWidth = Math.max(1, Number(next()) || 8);
    else if (arg === "--max-unit-paths") args.maxUnitPaths = Math.max(1, Number(next()) || 10);
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    else args.queries.push(arg);
  }
  return args;
}

async function loadEnvFile(filePath: string) {
  let text = "";
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals <= 0) continue;
    const key = trimmed.slice(0, equals).trim();
    if (process.env[key]) continue;
    let value = trimmed.slice(equals + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function loadLocalEnv() {
  for (const file of [".env", ".env.local", "apps/api/.env", "apps/api/.env.local"]) {
    await loadEnvFile(path.resolve(file));
  }
}

async function loadCases(args: Args): Promise<ProbeCase[]> {
  const cases: ProbeCase[] = [];
  if (args.casesPath) {
    const parsed = JSON.parse(await readFile(args.casesPath, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("--cases must be a JSON array");
    for (const entry of parsed) {
      if (!entry?.query || typeof entry.query !== "string") {
        throw new Error("Each case must include a string query");
      }
      cases.push({
        name: typeof entry.name === "string" ? entry.name : undefined,
        query: entry.query,
        queries: Array.isArray(entry.queries)
          ? entry.queries.map((query: unknown) => String(query)).filter(Boolean)
          : undefined,
        expectedTerms: Array.isArray(entry.expectedTerms)
          ? entry.expectedTerms.map((term: unknown) => String(term)).filter(Boolean)
          : undefined,
        notes: typeof entry.notes === "string" ? entry.notes : undefined,
      });
    }
  }
  for (const query of args.queries) cases.push({ query });
  return cases.length > 0 ? cases : DEFAULT_PROBES;
}

function normalize(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: unknown) {
  return normalize(value)
    .split(" ")
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function searchTextForUnit(unit: LaborUnit) {
  return [
    unit.name,
    unit.code,
    unit.description,
    unit.discipline,
    unit.category,
    unit.className,
    unit.subClassName,
    unit.outputUom,
    unit.tags?.join(" "),
  ].filter(Boolean).join(" | ");
}

function searchTextForNode(node?: LaborUnitTreeGroup) {
  if (!node) return "";
  return [node.label, node.category, node.className, node.subClassName].filter(Boolean).join(" | ");
}

function nodeSearchScore(query: string, node: LaborUnitTreeGroup) {
  const haystack = normalize(searchTextForNode(node));
  const queryTokens = tokens(query);
  const matched = queryTokens.filter((token) => haystack.includes(token));
  const search = (node as LaborUnitTreeGroup & { search?: { score?: number; matchedUnitCount?: number } }).search;
  const serverScore = Number(search?.score ?? 0);
  return serverScore + matched.length * 8 + Math.log10(Math.max(1, Number(search?.matchedUnitCount ?? node.unitCount)));
}

function unitSearchScore(query: string, unit: LaborUnit) {
  const haystack = normalize(searchTextForUnit(unit));
  const queryTokens = tokens(query);
  const matched = queryTokens.filter((token) => haystack.includes(token));
  const metadataScore = Number((unit.metadata as any)?.searchMatch?.score ?? 0);
  return metadataScore + matched.length * 8;
}

function expectedHit(expectedTerms: string[] | undefined, value: unknown) {
  if (!expectedTerms || expectedTerms.length === 0) return false;
  const haystack = normalize(value);
  return expectedTerms.some((term) => haystack.includes(normalize(term)));
}

function pathLabel(pathHit: ExploredPath) {
  return [
    pathHit.library.label,
    pathHit.category?.label,
    pathHit.classNode?.label,
    pathHit.subClassNode?.label,
  ].filter(Boolean).join(" > ");
}

function summarizeNode(node: LaborUnitTreeGroup) {
  const search = (node as LaborUnitTreeGroup & { search?: Record<string, unknown> }).search;
  return {
    label: node.label,
    level: node.level,
    unitCount: node.unitCount,
    libraryId: node.libraryId,
    category: node.category || undefined,
    className: node.className || undefined,
    subClassName: node.subClassName || undefined,
    search,
  };
}

function summarizeUnit(unit: LaborUnit) {
  return {
    id: unit.id,
    code: unit.code || undefined,
    name: unit.name,
    category: unit.category || undefined,
    className: unit.className || undefined,
    subClassName: unit.subClassName || undefined,
    outputUom: unit.outputUom,
    hoursNormal: unit.hoursNormal,
    searchMatch: (unit.metadata as any)?.searchMatch,
  };
}

function selectNodes(query: string, nodes: LaborUnitTreeGroup[], limit: number) {
  return nodes
    .slice()
    .sort((left, right) => nodeSearchScore(query, right) - nodeSearchScore(query, left))
    .slice(0, limit);
}

function selectUnits(query: string, units: LaborUnit[], limit: number) {
  return units
    .slice()
    .sort((left, right) => unitSearchScore(query, right) - unitSearchScore(query, left))
    .slice(0, limit);
}

function buildQueryVariants(probe: ProbeCase, limit: number, diagnostics?: any) {
  if (limit <= 0) return [];
  const provided = probe.queries?.filter((query) => normalize(query) !== normalize(probe.query)) ?? [];
  const queryTokens = tokens(probe.query);
  const generated: string[] = [];
  for (const slice of diagnostics?.querySlices ?? []) {
    if (typeof slice?.query === "string" && slice.query.trim()) generated.push(slice.query);
  }
  for (let index = 0; index < queryTokens.length - 1; index += 1) {
    generated.push(`${queryTokens[index]} ${queryTokens[index + 1]}`);
  }
  for (const token of queryTokens) {
    if (token.length >= 4) generated.push(token);
  }
  return unique([...provided, ...generated])
    .filter((query) => query && normalize(query) !== normalize(probe.query))
    .slice(0, limit);
}

function diagnosticsSummary(diagnostics: any) {
  if (!diagnostics) return undefined;
  return {
    scoredRows: diagnostics.scoredRows,
    scoredRowsCapped: diagnostics.scoredRowsCapped,
    terms: Array.isArray(diagnostics.terms) ? diagnostics.terms.slice(0, 8) : [],
    querySlices: Array.isArray(diagnostics.querySlices) ? diagnostics.querySlices.slice(0, 8) : [],
  };
}

function treeSummary(result: { nodes: LaborUnitTreeGroup[]; units: LaborUnit[]; total: number; diagnostics?: any }) {
  return {
    total: result.total,
    nodes: result.nodes.slice(0, 5).map(summarizeNode),
    units: result.units.slice(0, 5).map(summarizeUnit),
    diagnostics: diagnosticsSummary(result.diagnostics),
  };
}

function unitsSummary(result: { units: LaborUnit[]; total: number; diagnostics?: any }) {
  return {
    total: result.total,
    units: result.units.slice(0, 5).map(summarizeUnit),
    diagnostics: diagnosticsSummary(result.diagnostics),
  };
}

async function timed<T>(
  traces: ToolTrace[],
  name: ToolTrace["name"],
  input: Record<string, unknown>,
  fn: () => Promise<T>,
  summarize: (value: T) => Record<string, unknown>,
) {
  const started = performance.now();
  const result = await fn();
  traces.push({
    name,
    input,
    durationMs: Math.round(performance.now() - started),
    summary: summarize(result),
  });
  return result;
}

async function runProbe(store: PrismaApiStore, probe: ProbeCase, args: Args): Promise<ProbeResult> {
  const traces: ToolTrace[] = [];
  const query = probe.query;
  const direct = await timed(
    traces,
    "listLaborUnits",
    { q: query, limit: args.unitLimit },
    () => store.listLaborUnits({ q: query, limit: args.unitLimit }),
    unitsSummary,
  );
  const root = await timed(
    traces,
    "listLaborUnitTree",
    { parentType: "root", q: query, limit: args.topBranches },
    () => store.listLaborUnitTree({ parentType: "root", q: query, limit: args.topBranches }),
    treeSummary,
  );
  const variants: QueryVariantResult[] = [];
  for (const variantQuery of buildQueryVariants(probe, args.variantCount, (direct as any).diagnostics)) {
    const variantDirect = await timed(
      traces,
      "listLaborUnits",
      { q: variantQuery, limit: args.unitLimit, variantOf: query },
      () => store.listLaborUnits({ q: variantQuery, limit: args.unitLimit }),
      unitsSummary,
    );
    const variantRoot = await timed(
      traces,
      "listLaborUnitTree",
      { parentType: "root", q: variantQuery, limit: args.topBranches, variantOf: query },
      () => store.listLaborUnitTree({ parentType: "root", q: variantQuery, limit: args.topBranches }),
      treeSummary,
    );
    variants.push({
      query: variantQuery,
      directUnits: selectUnits(variantQuery, variantDirect.units, args.unitLimit),
      directTotal: variantDirect.total,
      directDiagnostics: (variantDirect as any).diagnostics,
      rootNodes: selectNodes(variantQuery, variantRoot.nodes, args.topBranches),
      rootTotal: variantRoot.total,
    });
  }

  const rootNodes = selectNodes(query, root.nodes, args.topBranches);
  type PathBeam = {
    library: LaborUnitTreeGroup;
    category?: LaborUnitTreeGroup;
    classNode?: LaborUnitTreeGroup;
    subClassNode?: LaborUnitTreeGroup;
  };
  const beamScore = (beam: PathBeam) =>
    nodeSearchScore(query, beam.library) +
    nodeSearchScore(query, beam.category ?? beam.library) +
    nodeSearchScore(query, beam.classNode ?? beam.category ?? beam.library) +
    nodeSearchScore(query, beam.subClassNode ?? beam.classNode ?? beam.category ?? beam.library);
  const prune = (beams: PathBeam[], limit: number) =>
    beams
      .sort((left, right) => beamScore(right) - beamScore(left))
      .slice(0, limit);

  let categoryBeams: PathBeam[] = [];
  for (const library of rootNodes) {
    const categoryResult = await browseTree(store, traces, {
      parentType: "catalog",
      libraryId: library.libraryId ?? undefined,
      q: query,
      limit: args.topBranches,
    });
    for (const category of selectNodes(query, categoryResult.nodes, args.topBranches)) {
      categoryBeams.push({ library, category });
    }
  }
  categoryBeams = prune(categoryBeams, args.beamWidth);

  let classBeams: PathBeam[] = [];
  for (const beam of categoryBeams) {
    const classResult = await browseTree(store, traces, {
      parentType: "category",
      libraryId: beam.library.libraryId ?? undefined,
      q: query,
      category: beam.category?.category,
      limit: args.topBranches,
    });
    for (const classNode of selectNodes(query, classResult.nodes, args.topBranches)) {
      classBeams.push({ ...beam, classNode });
    }
  }
  classBeams = prune(classBeams, args.beamWidth);

  let unitBeams: PathBeam[] = [];
  for (const beam of classBeams) {
    const subClassResult = await browseTree(store, traces, {
      parentType: "class",
      libraryId: beam.library.libraryId ?? undefined,
      q: query,
      category: beam.category?.category,
      className: beam.classNode?.className,
      limit: args.topBranches,
    });
    const subClassNodes = selectNodes(query, subClassResult.nodes, args.topBranches);
    if (subClassNodes.length === 0) {
      unitBeams.push(beam);
      continue;
    }
    for (const subClassNode of subClassNodes) {
      unitBeams.push({ ...beam, subClassNode });
    }
  }
  unitBeams = prune(unitBeams, args.maxUnitPaths);

  const paths: ExploredPath[] = [];
  for (const beam of unitBeams) {
    const units = await listUnits(store, traces, {
      libraryId: beam.library.libraryId ?? undefined,
      q: query,
      category: beam.category?.category,
      className: beam.classNode?.className,
      subClassName: beam.subClassNode?.subClassName,
      limit: args.unitLimit,
    });
    paths.push({
      library: beam.library,
      category: beam.category,
      classNode: beam.classNode,
      subClassNode: beam.subClassNode,
      units: selectUnits(query, units.units, args.unitLimit),
      totalUnits: units.total,
    });
  }

  const rankedVariants = variants
    .sort((left, right) => variantScore(probe, right) - variantScore(probe, left))
    .slice(0, args.variantCount);
  const observations = buildObservations(probe, direct.units, (direct as any).diagnostics, rankedVariants, paths, traces);
  return {
    probe,
    directUnits: selectUnits(query, direct.units, args.unitLimit),
    directTotal: direct.total,
    directDiagnostics: (direct as any).diagnostics,
    variants: rankedVariants,
    paths: paths
      .sort((left, right) => bestPathScore(query, right) - bestPathScore(query, left))
      .slice(0, args.topBranches * args.topBranches),
    traces,
    observations,
  };
}

async function browseTree(
  store: PrismaApiStore,
  traces: ToolTrace[],
  input: {
    parentType: LaborUnitTreeParentType;
    libraryId?: string;
    q?: string;
    category?: string;
    className?: string;
    subClassName?: string;
    limit?: number;
  },
) {
  return timed(
    traces,
    "listLaborUnitTree",
    input,
    () => store.listLaborUnitTree(input),
    treeSummary,
  );
}

async function listUnits(
  store: PrismaApiStore,
  traces: ToolTrace[],
  input: {
    libraryId?: string;
    q?: string;
    category?: string;
    className?: string;
    subClassName?: string;
    limit?: number;
  },
) {
  return timed(
    traces,
    "listLaborUnits",
    input,
    () => store.listLaborUnits(input),
    unitsSummary,
  );
}

function bestPathScore(query: string, pathHit: ExploredPath) {
  const nodeScore =
    nodeSearchScore(query, pathHit.library) +
    nodeSearchScore(query, pathHit.category ?? pathHit.library) +
    nodeSearchScore(query, pathHit.classNode ?? pathHit.library) +
    nodeSearchScore(query, pathHit.subClassNode ?? pathHit.classNode ?? pathHit.library);
  const unitScore = Math.max(0, ...pathHit.units.map((unit) => unitSearchScore(query, unit)));
  return nodeScore + unitScore;
}

function exactSliceMatchCount(query: string, diagnostics: any) {
  const normalized = normalize(query);
  const slices = Array.isArray(diagnostics?.querySlices) ? diagnostics.querySlices : [];
  const exact = slices.find((slice: any) => normalize(slice?.query) === normalized);
  if (exact?.matchedRows != null) return Number(exact.matchedRows) || 0;
  const termCount = tokens(query).length;
  if (termCount <= 1) return Number(diagnostics?.terms?.[0]?.matchedRows ?? 0) || 0;
  return 0;
}

function variantScore(probe: ProbeCase, variant: QueryVariantResult) {
  const unitScore = Math.min(25, Math.max(0, ...variant.directUnits.map((unit) => unitSearchScore(variant.query, unit))));
  const nodeScore = Math.min(25, Math.max(0, ...variant.rootNodes.map((node) => nodeSearchScore(variant.query, node))));
  const variantTokenCount = tokens(variant.query).length;
  const exactCount = exactSliceMatchCount(variant.query, variant.directDiagnostics);
  const effectiveCount = exactCount > 0 ? exactCount : variant.directTotal;
  const selectivityScore = effectiveCount > 0
    ? Math.max(0, 90 - Math.log1p(effectiveCount) * 12)
    : 0;
  const coOccurrenceScore = exactCount > 0 || variantTokenCount === 1
    ? selectivityScore + variantTokenCount * 14
    : 0;
  const noCoOccurrencePenalty = variantTokenCount > 1 && exactCount === 0 ? 80 : 0;
  const expectedQueryCoverage = probe.expectedTerms?.length
    ? probe.expectedTerms.filter((term) => normalize(variant.query).includes(normalize(term))).length / probe.expectedTerms.length
    : 0;
  const expectedBonus = probe.expectedTerms?.length && (
    variant.directUnits.some((unit) => expectedHit(probe.expectedTerms, searchTextForUnit(unit))) ||
    variant.rootNodes.some((node) => expectedHit(probe.expectedTerms, searchTextForNode(node)))
  ) ? 30 : 0;
  return expectedBonus + expectedQueryCoverage * 80 + coOccurrenceScore + unitScore + nodeScore - noCoOccurrencePenalty;
}

function buildObservations(
  probe: ProbeCase,
  directUnits: LaborUnit[],
  directDiagnostics: any,
  variants: QueryVariantResult[],
  paths: ExploredPath[],
  traces: ToolTrace[],
) {
  const observations: string[] = [];
  const query = probe.query;
  const expectedTerms = probe.expectedTerms;
  const directExpected = directUnits.some((unit) => expectedHit(expectedTerms, searchTextForUnit(unit)));
  const pathExpected = paths.some((pathHit) =>
    expectedHit(expectedTerms, pathLabel(pathHit)) ||
    pathHit.units.some((unit) => expectedHit(expectedTerms, searchTextForUnit(unit))),
  );
  if (expectedTerms?.length) {
    observations.push(
      pathExpected || directExpected
        ? `Expected calibration terms surfaced: ${expectedTerms.join(", ")}.`
        : `Expected calibration terms did not surface in explored direct/tree results: ${expectedTerms.join(", ")}.`,
    );
  }
  if (directUnits.length === 0) {
    observations.push("Direct listLaborUnits search returned no units.");
  } else {
    const topCoverage = Number((directUnits[0]?.metadata as any)?.searchMatch?.coverage ?? 0);
    if (topCoverage > 0 && topCoverage < 0.5) {
      observations.push(`Top direct unit only matched ${(topCoverage * 100).toFixed(0)}% of query term weight; tree browsing/refinement is probably needed.`);
    }
  }
  if (paths.length === 0) {
    observations.push("Tree navigation produced no explored unit paths.");
  }
  const bestVariant = variants[0];
  if (bestVariant) {
    const topNode = bestVariant.rootNodes[0];
    const topUnit = bestVariant.directUnits[0];
    const label = topNode?.label ?? topUnit?.category ?? topUnit?.name;
    const exactCount = exactSliceMatchCount(bestVariant.query, bestVariant.directDiagnostics);
    observations.push(`Best narrow follow-up query: "${bestVariant.query}"${label ? ` surfaced ${label}` : ""}${tokens(bestVariant.query).length > 1 ? ` (${exactCount} full-slice matches)` : ""}.`);
  }
  const directMultiSlices = Array.isArray(directDiagnostics?.querySlices) ? directDiagnostics.querySlices as any[] : [];
  const zeroCompositeSlices = directMultiSlices.filter((slice) => Array.isArray(slice.tokens) && slice.tokens.length > 1 && Number(slice.matchedRows ?? 0) === 0);
  if (zeroCompositeSlices.length > 0) {
    observations.push(`Some multi-term query slices had zero co-occurring unit matches (${zeroCompositeSlices.slice(0, 3).map((slice) => `"${slice.query}"`).join(", ")}); treat separate-token hits as analog candidates.`);
  }
  const slowest = traces.slice().sort((left, right) => right.durationMs - left.durationMs)[0];
  if (slowest && slowest.durationMs > 750) {
    observations.push(`Slowest tool call was ${slowest.name} at ${slowest.durationMs}ms.`);
  }
  const exactSubclassUnitCalls = traces.filter((trace) => trace.name === "listLaborUnits" && trace.input.subClassName);
  if (exactSubclassUnitCalls.length > 0) {
    observations.push(`Full subclass-level listLaborUnits narrowing was exercised ${exactSubclassUnitCalls.length} time(s).`);
  }
  if (probe.notes) observations.push(probe.notes);
  return observations;
}

function renderMarkdown(results: ProbeResult[], orgId: string) {
  const lines: string[] = [];
  lines.push("# Labor Unit Tree Navigation Harness");
  lines.push("");
  lines.push(`Organization: \`${orgId}\``);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("This is a limited harness for iterating on the agent's labor-library search behavior. It traces only `listLaborUnitTree` and `listLaborUnits`; judgments here are review signals, not production gates.");
  lines.push("");
  for (const result of results) {
    lines.push(`## ${result.probe.name ?? result.probe.query}`);
    lines.push("");
    lines.push(`Query: \`${result.probe.query}\``);
    lines.push(`Tool calls: ${result.traces.length}`);
    lines.push(`Direct units: ${result.directTotal}`);
    lines.push("");
    if (result.observations.length > 0) {
      lines.push("Observations:");
      for (const observation of result.observations) lines.push(`- ${observation}`);
      lines.push("");
    }
    lines.push("Top direct units:");
    if (result.directUnits.length === 0) {
      lines.push("- None");
    } else {
      for (const unit of result.directUnits.slice(0, 5)) {
        lines.push(`- ${formatUnit(unit)}`);
      }
    }
    lines.push("");
    const diagnostics = result.directDiagnostics;
    if (diagnostics) {
      const termSummary = Array.isArray(diagnostics.terms)
        ? diagnostics.terms.slice(0, 8).map((term: any) => `${term.token}:${term.matchedRows}`).join(", ")
        : "";
      const sliceSummary = Array.isArray(diagnostics.querySlices)
        ? diagnostics.querySlices.slice(0, 8).map((slice: any) => `${slice.query}:${slice.matchedRows}`).join(", ")
        : "";
      lines.push("Query diagnostics:");
      if (termSummary) lines.push(`- Term hit counts in scored corpus: ${termSummary}`);
      if (sliceSummary) lines.push(`- Candidate query slices: ${sliceSummary}`);
      if (diagnostics.scoredRowsCapped) lines.push(`- Scored row set hit the cap at ${diagnostics.scoredRows} rows.`);
      lines.push("");
    }
    lines.push("Narrow follow-up probes:");
    if (result.variants.length === 0) {
      lines.push("- None");
    } else {
      for (const variant of result.variants.slice(0, 5)) {
        const nodeLabels = variant.rootNodes.slice(0, 3).map((node) => node.label).join(", ") || "no root nodes";
        const unitLabels = variant.directUnits.slice(0, 2).map((unit) => unit.name).join(", ") || "no direct units";
        const exactCount = exactSliceMatchCount(variant.query, variant.directDiagnostics);
        const exactText = tokens(variant.query).length > 1 ? `, full-slice ${exactCount}` : "";
        lines.push(`- \`${variant.query}\`: root ${variant.rootTotal}, direct ${variant.directTotal}${exactText}; top branches: ${nodeLabels}; top units: ${unitLabels}`);
      }
    }
    lines.push("");
    lines.push("Top explored paths:");
    if (result.paths.length === 0) {
      lines.push("- None");
    } else {
      for (const pathHit of result.paths.slice(0, 6)) {
        lines.push(`- ${pathLabel(pathHit)} (${pathHit.totalUnits} units)`);
        for (const unit of pathHit.units.slice(0, 3)) {
          lines.push(`  - ${formatUnit(unit)}`);
        }
      }
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function formatUnit(unit: LaborUnit) {
  const match = (unit.metadata as any)?.searchMatch;
  const score = match?.score != null ? ` score=${match.score}` : "";
  const pathBits = [unit.category, unit.className, unit.subClassName].filter(Boolean).join(" / ");
  const code = unit.code ? `${unit.code} ` : "";
  return `${code}${unit.name} [${pathBits || "uncategorized"}] ${unit.hoursNormal} hr/${unit.outputUom}${score}`;
}

function renderTraceNdjson(results: ProbeResult[]) {
  const rows: string[] = [];
  for (const result of results) {
    for (const trace of result.traces) {
      rows.push(JSON.stringify({ query: result.probe.query, ...trace }));
    }
  }
  return `${rows.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  await loadLocalEnv();
  const probes = await loadCases(args);
  const orgId = args.orgId
    ?? process.env.BIDWRIGHT_ORG_ID
    ?? (await prisma.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }))?.id;
  if (!orgId) throw new Error("No organization found. Provide --org-id or seed the database.");

  const store = new PrismaApiStore(prisma as any, orgId);
  const results: ProbeResult[] = [];
  for (const probe of probes) {
    process.stdout.write(`\n[probe] ${probe.name ?? probe.query}\n`);
    const result = await runProbe(store, probe, args);
    results.push(result);
    for (const observation of result.observations) process.stdout.write(`  - ${observation}\n`);
    const bestPath = result.paths[0];
    if (bestPath) process.stdout.write(`  best path: ${pathLabel(bestPath)}\n`);
    const bestVariant = result.variants[0];
    if (bestVariant) process.stdout.write(`  best follow-up query: "${bestVariant.query}"\n`);
    const bestUnit = bestPath?.units[0] ?? result.directUnits[0];
    if (bestUnit) process.stdout.write(`  best unit: ${formatUnit(bestUnit)}\n`);
  }

  await mkdir(args.outDir, { recursive: true });
  await writeFile(path.join(args.outDir, "labor-tree-harness.md"), renderMarkdown(results, orgId), "utf8");
  await writeFile(path.join(args.outDir, "labor-tree-harness.json"), JSON.stringify({ orgId, probes: results }, null, 2), "utf8");
  await writeFile(path.join(args.outDir, "tool-trace.ndjson"), renderTraceNdjson(results), "utf8");
  process.stdout.write(`\n[wrote] ${path.join(args.outDir, "labor-tree-harness.md")}\n`);
  process.stdout.write(`[wrote] ${path.join(args.outDir, "tool-trace.ndjson")}\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
