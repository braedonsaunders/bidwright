import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnPythonCommand } from "./python-runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_DIR = path.resolve(__dirname, "..", "python");

const POINTCLOUD_INGEST_SCRIPT = path.join(PYTHON_DIR, "tools", "pointcloud_ingest.py");
const SEGMENT_POINTCLOUD_SCRIPT = path.join(PYTHON_DIR, "tools", "segment_pointcloud.py");

const INGEST_TIMEOUT_MS = 600_000;
const SEGMENTATION_TIMEOUT_MS = 600_000;

export interface PointCloudBBox {
  min: [number, number, number];
  max: [number, number, number];
}

export interface PointCloudIngestRequest {
  inputPath: string;
  outDir: string;
  maxPoints?: number;
  /** Unit label recorded in the result (default "m"). */
  units?: string;
}

export interface PointCloudIngestResult {
  pointCount: number;
  stride: number;
  /** File name inside outDir (currently always "points.bin"). */
  file: string;
  /** Axis-aligned bounds in local (offset-subtracted) space. */
  bbox: PointCloudBBox;
  /** World-space offset subtracted from every point (bbox center of source). */
  offset: [number, number, number];
  hasColor: boolean;
  units: string;
  sourceFormat: string;
  sourcePointCount: number;
  durationMs: number;
}

export type PointCloudSegmentKind = "pipe-run" | "plane" | "cluster";
export type PointCloudPlaneDetail = "floor" | "ceiling" | "wall" | "";

export interface PointCloudSegment {
  id: string;
  kind: PointCloudSegmentKind;
  label: string;
  confidence: number;
  /** Original points.bin points belonging to this segment. */
  pointCount: number;
  /** Pipe-run centerline vertices in local space; empty for planes/clusters. */
  polyline: [number, number, number][];
  /** Pipe radius in metres (pipe runs only). */
  radius: number | null;
  /** Centerline length in metres (pipe runs only). */
  length: number | null;
  /** Occupancy-grid surface area in m² (planes only). */
  area: number | null;
  /** Unit plane normal (planes only). */
  normal: [number, number, number] | null;
  kindDetail: PointCloudPlaneDetail;
  centroid: [number, number, number];
  bbox: PointCloudBBox;
  /** Up to 5000 indices into points.bin for viewer highlighting. */
  sampleIndices: number[];
}

export interface PointCloudSegmentationStats {
  workingPoints: number;
  planesRemoved: number;
  durationMs: number;
}

export interface PointCloudSegmentationRequest {
  pointsPath: string;
  pointCount: number;
  stride?: number;
  voxel?: number;
  maxPlanes?: number;
  minPipeRadius?: number;
  maxPipeRadius?: number;
}

export interface PointCloudSegmentationResult {
  segments: PointCloudSegment[];
  stats: PointCloudSegmentationStats;
}

class PointCloudToolError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "PointCloudToolError";
    this.code = code;
  }
}

function buildPythonEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PDF_BASE_PATH: process.env.DATA_DIR ?? "",
  };
}

async function runPointCloudTool<T>(args: {
  scriptPath: string;
  toolName: string;
  payload: unknown;
  timeoutMs: number;
}): Promise<T> {
  const { stdout, stderr, code } = await spawnPythonCommand({
    scriptArgs: [args.scriptPath],
    cwd: PYTHON_DIR,
    timeoutMs: args.timeoutMs,
    env: buildPythonEnv(),
    stdin: JSON.stringify(args.payload),
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    const detail = stderr.trim() || stdout.slice(0, 500) || `exit code ${code}`;
    throw new PointCloudToolError(`${args.toolName} produced invalid output: ${detail}`, "invalid-output");
  }

  const record = parsed as { error?: string; code?: string };
  if (record.error) {
    throw new PointCloudToolError(record.error, record.code ?? "tool-failed");
  }
  if (code !== 0) {
    throw new PointCloudToolError(
      `${args.toolName} exited with code ${code}: ${stderr.trim() || stdout.slice(0, 500)}`,
      "tool-failed",
    );
  }
  return parsed as T;
}

export async function runPointCloudIngest(
  req: PointCloudIngestRequest,
): Promise<PointCloudIngestResult> {
  const payload: Record<string, unknown> = {
    path: req.inputPath,
    outDir: req.outDir,
    maxPoints: req.maxPoints ?? 8_000_000,
  };
  if (req.units !== undefined) {
    payload.units = req.units;
  }
  return runPointCloudTool<PointCloudIngestResult>({
    scriptPath: POINTCLOUD_INGEST_SCRIPT,
    toolName: "pointcloud_ingest",
    payload,
    timeoutMs: INGEST_TIMEOUT_MS,
  });
}

export async function runPointCloudSegmentation(
  req: PointCloudSegmentationRequest,
): Promise<PointCloudSegmentationResult> {
  const payload = {
    pointsPath: req.pointsPath,
    pointCount: req.pointCount,
    stride: req.stride ?? 16,
    voxel: req.voxel ?? 0.02,
    maxPlanes: req.maxPlanes ?? 8,
    minPipeRadius: req.minPipeRadius ?? 0.008,
    maxPipeRadius: req.maxPipeRadius ?? 0.4,
  };
  return runPointCloudTool<PointCloudSegmentationResult>({
    scriptPath: SEGMENT_POINTCLOUD_SCRIPT,
    toolName: "segment_pointcloud",
    payload,
    timeoutMs: SEGMENTATION_TIMEOUT_MS,
  });
}
