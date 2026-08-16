// Shared types for the LiDAR scan takeoff surface (point-cloud viewer,
// measure tools, and segmentation overlays). The API mirrors these shapes in
// segments.json artifacts produced by segment_pointcloud.py.

export type ScanVec3 = [number, number, number];

export interface ScanPointCloudInfo {
  /** Streaming binary: interleaved stride-16 records (x,y,z float32 LE + r,g,b,a uint8). */
  pointsUrl: string;
  pointCount: number;
  stride: 16;
  bbox: { min: ScanVec3; max: ScanVec3 };
  /** World-space offset subtracted at ingest so points fit float32 (add back for absolute coords). */
  offset: ScanVec3;
  hasColor: boolean;
  units: "m";
}

export type ScanSegmentKind = "pipe-run" | "plane" | "cluster";

export interface ScanSegment {
  id: string;
  kind: ScanSegmentKind;
  label: string;
  /** 0..1 fit confidence from the segmentation pipeline. */
  confidence: number;
  pointCount: number;
  /** pipe-run: ordered centerline vertices (local/offset space, meters). */
  polyline?: ScanVec3[];
  /** pipe-run: fitted cylinder radius in meters. */
  radius?: number;
  /** pipe-run: total centerline length in meters. */
  length?: number;
  /** plane: fitted surface area in m². */
  area?: number;
  /** plane: unit normal; kindDetail floor|ceiling|wall from normal direction. */
  normal?: ScanVec3;
  kindDetail?: "floor" | "ceiling" | "wall" | "";
  centroid?: ScanVec3;
  bbox?: { min: ScanVec3; max: ScanVec3 };
  /** Sampled point indices (≤ 5000) for highlight rendering. */
  sampleIndices?: number[];
  /** Optional identification from photo fusion (material / service / size). */
  identification?: Record<string, unknown>;
}

export type ScanMeasureTool =
  | "orbit"
  | "measure-line"
  | "measure-polyline"
  | "measure-area"
  | "count";

export interface ScanMeasurementDraft {
  type: "linear" | "linear-polyline" | "area-polygon" | "count";
  /** Points in local/offset space, meters. */
  points: Array<{ x: number; y: number; z: number }>;
  /** linear/polyline: length in meters; area: m²; count: marker count. */
  value: number;
  area?: number;
  unit: "m" | "m2" | "count";
}

export interface ScanMeasurementDisplay {
  id: string;
  type: ScanMeasurementDraft["type"];
  points: Array<{ x: number; y: number; z: number }>;
  color: string;
  label: string;
  visible: boolean;
}

export interface PointCloudViewerApi {
  fitToContent(): void;
  setPointSize(size: number): void;
  focusSegment(segmentId: string): void;
}
