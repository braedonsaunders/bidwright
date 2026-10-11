import { prisma, prismaSql, type Prisma } from "@bidwright/db";

type Facts = Record<string, unknown>;
export interface OverviewSourceInput {
  id: string;
  name: string;
  fileType: string | null;
  documentId: string | null;
  source: "document" | "file";
  facts: Facts;
}
interface OverviewModelInput {
  id: string;
  sourceDocumentId: string | null;
  fileNodeId: string | null;
  status: string;
  units: string;
  facts: Facts;
}
interface PickupSummary {
  documentId: string;
  pageNumber: number;
  measuredBy: string;
  count: number;
  linked: number;
  unlinked: number;
}
interface DocumentProgress {
  id: string;
  status: string;
  extractionProvider?: string;
}

function sourceKind(name: string, fileType: string | null, facts: Facts): string {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : fileType?.toLowerCase();
  if (ext === "pdf" || fileType === "application/pdf") {
    // Positioned OCR text does not establish a native text layer or vector geometry.
    return facts.pdfKind === "vector" ? "pdf-vector" : facts.pdfKind === "scanned" ? "pdf-scanned" : "pdf";
  }
  if (["dwg", "dxf", "ifc", "rvt", "nwd"].includes(ext || "")) return ext!;
  if (["step", "stp", "iges", "igs"].includes(ext || "")) return "step";
  if (["e57", "las", "laz", "xyz", "pts", "pcd", "ply"].includes(ext || "")) return "pointcloud";
  if (["obj", "stl", "gltf", "glb", "3mf", "fbx"].includes(ext || "")) return "mesh";
  if (["pcf", "piping"].includes(ext || "")) return "piping";
  if (["png", "jpg", "jpeg", "webp", "tif", "tiff", "bmp"].includes(ext || "")) return "image";
  if (["xlsx", "xls", "csv", "ods"].includes(ext || "")) return "spreadsheet";
  if (["zip", "7z", "rar", "tar", "gz"].includes(ext || "")) return "archive";
  return "other";
}

function toolFamilies(kind: string): string[] {
  if (kind.startsWith("pdf")) return ["drawing read/tile", "calibrated takeoff", "symbol count/legend", "pickups"];
  if (["dwg", "dxf"].includes(kind)) return ["CAD entity query/render", "CAD takeoff", "pickups"];
  if (["ifc", "rvt", "nwd"].includes(kind)) return ["model elements/groups/BOM", "model revisions", "pickups"];
  if (["step", "mesh"].includes(kind)) return ["model solid metrics/BOM", "pickups"];
  if (kind === "pointcloud") return ["model scan/segmentation", "pickups"];
  if (kind === "piping") return ["piping MTO", "pickups"];
  if (kind === "image") return ["photo BOM", "symbol count"];
  return ["source text/structured data"];
}

export function buildSourceOverview(input: {
  sources: OverviewSourceInput[];
  models: OverviewModelInput[];
  pickups: PickupSummary[];
  calibrations?: unknown;
  documentProgress?: DocumentProgress[];
  modelScan?: { status: string; sourceCount: number; startedAt: string | null; finishedAt: string | null; error: string | null };
}) {
  const documents = new Set(input.sources.filter(s => s.source === "document").map(s => s.id));
  const sources = input.sources.filter(s => s.source === "document" || !s.documentId || !documents.has(s.documentId)).map(source => {
    const files = input.sources.filter(s => s.source === "file" && s.documentId === source.id);
    const fileIds = source.source === "file" ? [source.id] : files.map(f => f.id);
    const documentId = source.source === "document" ? source.id : source.documentId && documents.has(source.documentId) ? source.documentId : null;
    const facts = Object.fromEntries([...Object.entries(files[0]?.facts ?? {}), ...Object.entries(source.facts)].filter(([, v]) => v != null));
    const progress = input.documentProgress?.find(p => p.id === source.id);
    if (progress) {
      facts.extractionStatus = progress.status;
      facts.extractionProvider = progress.extractionProvider ?? "unknown";
    }
    const kind = sourceKind(source.name, source.fileType, facts);
    const pickups = input.pickups.filter(p => p.documentId === documentId || fileIds.includes(p.documentId));
    const models = input.models.filter(m => (documentId && m.sourceDocumentId === documentId) || (m.fileNodeId && fileIds.includes(m.fileNodeId))).map(m => ({
      id: m.id, status: m.status,
      units: m.units && m.units !== "model" ? m.units : "unknown",
      ...m.facts,
      qtoCoveragePercent: Number(m.facts.elementCount) > 0 && typeof m.facts.qtoElementCount === "number"
        ? 100 * m.facts.qtoElementCount / Number(m.facts.elementCount) : null,
    }));
    return {
      id: source.id, name: source.name, fileType: source.fileType || "unknown",
      extension: source.name.includes(".") ? source.name.split(".").pop()!.toLowerCase() : null,
      kind, documentId, fileNodeIds: fileIds,
      extractionStatus: facts.extractionStatus ?? "unknown",
      facts, models, toolFamilies: toolFamilies(kind),
      pickups: pickups.reduce((sum, p) => sum + p.count, 0),
      humanPickups: pickups.filter(p => p.measuredBy === "person").reduce((sum, p) => sum + p.count, 0),
    };
  });
  return {
    generatedAt: new Date().toISOString(), sources,
    modelScan: input.modelScan ?? null,
    takeoff: { byDocumentPage: input.pickups, calibrations: input.calibrations ?? {} },
  };
}

export type SourceOverview = ReturnType<typeof buildSourceOverview>;

// Project only compact persisted facts: no text bodies, entity arrays, meshes or ingest work.
function sourceFacts(column: Prisma.Sql) {
  return prismaSql`jsonb_build_object(
    'extractionStatus', ${column}->'extractionStatus',
    'positionedTextAvailable', (${column}->'pageText') IS NOT NULL,
    'pdfKind', ${column}->'pdfKind',
    'detectedScale', ${column}->'detectedScale',
    'cadStatus', ${column}->'dwgTakeoff'->'status',
    'converterStatus', ${column}->'dwgTakeoff'->'converter'->'status',
    'layers', CASE WHEN jsonb_typeof(${column}->'dwgTakeoff'->'layers') = 'array' THEN jsonb_array_length(${column}->'dwgTakeoff'->'layers') END,
    'entities', CASE WHEN jsonb_typeof(${column}->'dwgTakeoff'->'entities') = 'array' THEN jsonb_array_length(${column}->'dwgTakeoff'->'entities') END,
    'cadUnits', ${column}->'dwgTakeoff'->'units',
    'blockInserts', ${column}->'dwgTakeoff'->'blockExpansion'->'insertCount'
  )`;
}

export async function getSourceOverview(projectId: string): Promise<SourceOverview> {
  const [documents, files, models, pickups, workspace, jobs] = await Promise.all([
    prisma.$queryRaw<OverviewSourceInput[]>(prismaSql`
      SELECT id, "fileName" AS name, "fileType", id AS "documentId", 'document' AS source,
        ${sourceFacts(prismaSql`"structuredData"`)} || jsonb_build_object('pages', "pageCount", 'extractedTextAvailable', length("extractedText") > 0) AS facts
      FROM "SourceDocument" WHERE "projectId" = ${projectId} ORDER BY "createdAt", id`),
    prisma.$queryRaw<OverviewSourceInput[]>(prismaSql`
      SELECT id, name, "fileType", "documentId", 'file' AS source,
        ${sourceFacts(prismaSql`metadata`)} AS facts
      FROM "FileNode" WHERE "projectId" = ${projectId} AND type = 'file' AND scope = 'project' ORDER BY "createdAt", id`),
    prisma.$queryRaw<OverviewModelInput[]>(prismaSql`
      SELECT m.id, m."sourceDocumentId", m."fileNodeId", m.status, m.units,
        jsonb_build_object('schema', m.manifest->'schema', 'parts', m.manifest->'meshCount',
          'solidCount', m.manifest->'solidCount', 'pointCount', m.manifest->'pointCount',
          'issueCount', CASE WHEN jsonb_typeof(m.manifest->'modelIngest'->'issues') = 'array' THEN jsonb_array_length(m.manifest->'modelIngest'->'issues') END,
          'elementCount', (SELECT count(*)::int FROM "ModelElement" e WHERE e."modelId" = m.id),
          'qtoElementCount', (SELECT count(DISTINCT q."elementId")::int FROM "ModelQuantity" q WHERE q."modelId" = m.id AND q.method = 'ifc_declared_quantity'),
          'ingestStatus', m.manifest->'modelIngest'->'runStatus') AS facts
      FROM "ModelAsset" m WHERE m."projectId" = ${projectId} ORDER BY m."createdAt", m.id`),
    prisma.$queryRaw<PickupSummary[]>(prismaSql`
      SELECT "documentId", "pageNumber", COALESCE(NULLIF(metadata->>'measuredBy', ''), 'unrecorded') AS "measuredBy",
        count(*)::int AS count, count(*) FILTER (WHERE linked)::int AS linked, count(*) FILTER (WHERE NOT linked)::int AS unlinked
      FROM (SELECT p.*, EXISTS(SELECT 1 FROM "PickupLink" l WHERE l."pickupId" = p.id AND l."projectId" = ${projectId}) AS linked
        FROM "Pickup" p WHERE p."projectId" = ${projectId}) p
      GROUP BY "documentId", "pageNumber", COALESCE(NULLIF(metadata->>'measuredBy', ''), 'unrecorded') ORDER BY "documentId", "pageNumber"`),
    prisma.$queryRaw<Array<{ calibrations: unknown }>>(prismaSql`
      SELECT state->'takeoffCalibrations' AS calibrations FROM "WorkspaceState" WHERE "projectId" = ${projectId}`),
    prisma.$queryRaw<Array<{ documents: DocumentProgress[] | null }>>(prismaSql`
      SELECT output->'documentProgress' AS documents FROM "IngestionJob"
      WHERE "projectId" = ${projectId} AND kind = 'package_ingest' ORDER BY "createdAt" DESC LIMIT 1`),
  ]);
  const { getProjectModelScanStatus } = await import("./model-service.js");
  const { status, sourceCount, startedAt, finishedAt, error } = getProjectModelScanStatus(projectId);
  return buildSourceOverview({ sources: [...documents, ...files], models, pickups, calibrations: workspace[0]?.calibrations,
    modelScan: { status, sourceCount, startedAt, finishedAt, error },
    documentProgress: Array.isArray(jobs[0]?.documents) ? jobs[0].documents : [] });
}
