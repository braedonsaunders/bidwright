"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type MutableRefObject,
  type ReactNode,
} from "react";
import {
  Camera,
  Check,
  Hash,
  Loader2,
  Maximize2,
  MousePointer2,
  Ruler,
  ScanSearch,
  Spline,
  Square,
} from "lucide-react";
import { Button } from "@braedonsaunders/appkit-ui";
import { EmptyState } from "@/components/legacy-controls";
import {
  createPickup,
  deletePickup,
  getDocumentDownloadUrl,
  getFileDownloadUrl,
  getFileTree,
  getProjectWorkspace,
  getScanPointCloudInfo,
  getScanPointCloudUrl,
  getScanSegments,
  identifyScanSegments,
  listPickups,
  queryModelElements,
  runScanSegmentation,
  updatePickup,
  type ScanSegmentRecord,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  PointCloudViewerApi,
  ScanMeasureTool,
  ScanMeasurementDisplay,
  ScanMeasurementDraft,
  ScanPointCloudInfo,
  ScanSegment,
} from "@/lib/scan-types";

/** Contract for the point-cloud viewer (owned by pointcloud-viewer.tsx). */
interface PointCloudViewerProps {
  cloud: ScanPointCloudInfo;
  segments?: ScanSegment[];
  visibleSegmentIds?: string[] | null;
  selectedSegmentIds?: string[] | null;
  onSelectSegment?: (id: string | null, opts?: { additive?: boolean }) => void;
  tool: ScanMeasureTool;
  onMeasurement?: (draft: ScanMeasurementDraft) => void;
  measurements?: ScanMeasurementDisplay[];
  selectedMeasurementId?: string | null;
  onSelectMeasurement?: (id: string | null) => void;
  pointSize?: number;
  onReady?: (api: PointCloudViewerApi) => void;
  onLoadProgress?: (loaded: number, total: number) => void;
  className?: string;
}

const PointCloudViewer = dynamic(
  () => import("./takeoff/pointcloud-viewer").then((m) => ({ default: m.PointCloudViewer })),
  { ssr: false },
) as ComponentType<PointCloudViewerProps>;

/** Imperative surface actions exposed to the parent via `actionsRef`. */
export interface ScanSurfaceActions {
  focusSegment(id: string): void;
  deletePickup(id: string): Promise<void>;
  refresh(): Promise<void>;            // reload pickups + segments from server
}

export interface ScanTakeoffSurfaceProps {
  projectId: string;
  modelAssetId: string;
  fileName: string;
  toolbarStart?: ReactNode;
  toolbarEnd?: ReactNode;
  /** Mirror of this scan's measurement pickups (sourceKind scan-measurement), fired on load and after every create/update/delete. */
  onAnnotationsChange?: (pickups: any[]) => void;
  selectedPickupId?: string | null;
  onSelectedPickupChange?: (id: string | null) => void;
  /** Mirror of detected segments + externalId->ModelElement.id map, fired on load and after Detect/Identify. */
  onSegmentsChange?: (data: { segments: import("@/lib/api").ScanSegmentRecord[]; elementIdBySegmentId: Record<string, string>; stats?: Record<string, unknown> }) => void;
  visibleSegmentIds?: string[] | null;   // controlled by parent; null = all visible
  selectedSegmentIds?: string[] | null;  // controlled by parent; empty/null = none
  onSelectSegment?: (id: string | null, opts?: { additive?: boolean }) => void;
  actionsRef?: MutableRefObject<ScanSurfaceActions | null>;
}

/** Server pickup row (subset we render). listPickups is untyped (`any[]`). */
interface ScanPickupRecord {
  id: string;
  annotationType: string;
  label: string;
  color: string;
  visible?: boolean;
  points: Array<{ x: number; y: number; z: number }>;
  measurement?: { value?: number; unit?: string; area?: number };
  sourceKind?: string;
}

interface ScanPhotoSource {
  id: string;
  rawId: string;
  name: string;
  origin: "fileNode" | "sourceDocument";
}

const TOOLS: Array<{ id: ScanMeasureTool; label: string; icon: typeof Ruler }> = [
  { id: "orbit", label: "Orbit", icon: MousePointer2 },
  { id: "measure-line", label: "Distance", icon: Ruler },
  { id: "measure-polyline", label: "Polyline", icon: Spline },
  { id: "measure-area", label: "Area", icon: Square },
  { id: "count", label: "Count", icon: Hash },
];

const TOOL_COLORS: Record<string, string> = {
  linear: "#f59e0b",
  "linear-polyline": "#f59e0b",
  "area-polygon": "#3b82f6",
  count: "#22c55e",
};

const PHOTO_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif", "tif", "tiff"]);
const MAX_IDENTIFY_PHOTOS = 8;

function isPhotoFile(fileName: string): boolean {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return false;
  return PHOTO_EXTENSIONS.has(fileName.slice(dot + 1).toLowerCase());
}

/** Pull a project photo and base64-encode it for the identification call —
 *  raw base64 without the data: prefix, same shape site-photo-intake sends. */
async function fetchPhotoAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const response = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load photo (${response.status})`);
  }
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = reader.result;
      if (typeof value !== "string") return reject(new Error("Unexpected reader result"));
      resolve(value);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read photo"));
    reader.readAsDataURL(blob);
  });
  const commaIdx = dataUrl.indexOf(",");
  return { data: commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl, mimeType: blob.type || "image/jpeg" };
}

function toScanSegment(record: ScanSegmentRecord): ScanSegment {
  return { ...record, identification: record.identification as Record<string, unknown> | undefined };
}

function measurementLabel(draft: ScanMeasurementDraft): string {
  if (draft.type === "area-polygon") return `Scan area ${(draft.area ?? draft.value).toFixed(1)} m²`;
  if (draft.type === "count") return "Scan count";
  return `Scan length ${draft.value.toFixed(2)} m`;
}

function buildElementIdMap(elements: Array<{ externalId: string; id: string }>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const element of elements) {
    if (element.externalId) map[element.externalId] = element.id;
  }
  return map;
}

export function ScanTakeoffSurface({
  projectId,
  modelAssetId,
  fileName,
  toolbarStart,
  toolbarEnd,
  onAnnotationsChange,
  selectedPickupId,
  onSelectedPickupChange,
  onSegmentsChange,
  visibleSegmentIds,
  selectedSegmentIds,
  onSelectSegment,
  actionsRef,
}: ScanTakeoffSurfaceProps) {
  const documentId = `model-${modelAssetId}`;

  const [cloud, setCloud] = useState<ScanPointCloudInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [segments, setSegments] = useState<ScanSegmentRecord[]>([]);
  const [segmentStats, setSegmentStats] = useState<Record<string, unknown> | undefined>(undefined);
  const [pickups, setPickups] = useState<ScanPickupRecord[]>([]);
  /** Segment externalId (= segment.id) → ModelElement.id, for takeoff links. */
  const [elementIdMap, setElementIdMap] = useState<Record<string, string>>({});

  const [tool, setTool] = useState<ScanMeasureTool>("orbit");
  const [pointSize, setPointSize] = useState(0.02);

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number } | null>(null);

  const [segmenting, setSegmenting] = useState(false);
  const [identifyOpen, setIdentifyOpen] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const [photoSources, setPhotoSources] = useState<ScanPhotoSource[] | null>(null);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());

  const viewerApiRef = useRef<PointCloudViewerApi | null>(null);
  /** Active count-tool session — successive clicks accumulate into ONE
   *  pickup. `chain` serializes create/update so rapid clicks can't race. */
  const countSessionRef = useRef<{
    pickupId: string | null;
    points: Array<{ x: number; y: number; z: number }>;
    value: number;
    chain: Promise<void>;
  }>({ pickupId: null, points: [], value: 0, chain: Promise.resolve() });

  /* ── Parent mirrors (pickups + segments) ──────────────────────────────── */
  // Latest-callback refs so the mirror effects never retrigger on identity.
  const onAnnotationsChangeRef = useRef(onAnnotationsChange);
  onAnnotationsChangeRef.current = onAnnotationsChange;
  const onSegmentsChangeRef = useRef(onSegmentsChange);
  onSegmentsChangeRef.current = onSegmentsChange;
  // Armed once the initial server load resolves — pre-load resets don't fire.
  const mirrorsArmedRef = useRef(false);

  useEffect(() => {
    if (!mirrorsArmedRef.current) return;
    onAnnotationsChangeRef.current?.(pickups);
  }, [pickups]);

  // ONE effect keyed on BOTH segments and the element map: whichever resolves
  // or changes last re-fires the mirror, so the parent always converges to
  // { segments, elementIdBySegmentId } with the fully-resolved map
  // (externalId "seg-N" → ModelElement.id).
  useEffect(() => {
    if (!mirrorsArmedRef.current) return;
    onSegmentsChangeRef.current?.({
      segments,
      elementIdBySegmentId: elementIdMap,
      stats: segmentStats,
    });
  }, [segments, elementIdMap, segmentStats]);

  const reportError = useCallback((err: unknown, fallback: string) => {
    setActionError(err instanceof Error ? err.message : fallback);
  }, []);

  const mergeElementIds = useCallback(
    (entries: Array<{ externalId: string; id: string }>) => {
      if (entries.length === 0) return;
      setElementIdMap((prev) => {
        const next = { ...prev };
        for (const entry of entries) {
          if (entry.externalId) next[entry.externalId] = entry.id;
        }
        return next;
      });
    },
    [],
  );

  /* ── Element-map convergence guard ────────────────────────────────────────
   * The initial queryModelElements runs behind `.catch(() => null)`, so a
   * transient failure (or an elements ingest that finishes just after page
   * load) silently left the map empty until runScanSegmentation happened to
   * merge its own response. When segments exist that the map can't resolve,
   * re-query the elements (bounded retries) and MERGE the result — each merge
   * re-fires the segments mirror above. */
  const elementRetryRef = useRef(0);
  useEffect(() => {
    elementRetryRef.current = 0;
  }, [projectId, modelAssetId]);

  useEffect(() => {
    if (!mirrorsArmedRef.current) return;
    if (segments.length === 0) return;
    if (segments.every((segment) => Boolean(elementIdMap[segment.id]))) return;
    if (elementRetryRef.current >= 2) return;
    elementRetryRef.current += 1;
    const timer = setTimeout(() => {
      queryModelElements(projectId, modelAssetId, { limit: 1000 })
        .then((response) => {
          mergeElementIds(
            response.elements.map((element) => ({ externalId: element.externalId, id: element.id })),
          );
        })
        .catch(() => undefined);
    }, 1200);
    return () => clearTimeout(timer);
  }, [segments, elementIdMap, mergeElementIds, modelAssetId, projectId]);

  /* ── Initial load: cloud info + segments + scan pickups + elements ────── */
  useEffect(() => {
    let cancelled = false;
    mirrorsArmedRef.current = false;
    setLoading(true);
    setLoadError(null);
    setCloud(null);
    setSegments([]);
    setSegmentStats(undefined);
    setPickups([]);
    setElementIdMap({});
    (async () => {
      try {
        const [info, segResponse, pickupRows, elementResponse] = await Promise.all([
          getScanPointCloudInfo(projectId, modelAssetId),
          getScanSegments(projectId, modelAssetId).catch(() => ({
            segments: [] as ScanSegmentRecord[],
            stats: undefined as Record<string, unknown> | undefined,
          })),
          listPickups(projectId, `model-${modelAssetId}`).catch(() => [] as unknown[]),
          queryModelElements(projectId, modelAssetId, { limit: 1000 }).catch(() => null),
        ]);
        if (cancelled) return;
        mirrorsArmedRef.current = true;
        setCloud({
          // Resolve against the API origin — the response carries a raw path.
          pointsUrl: getScanPointCloudUrl(projectId, modelAssetId),
          pointCount: info.pointCount,
          stride: 16,
          bbox: info.bbox,
          offset: info.offset,
          hasColor: info.hasColor,
          units: "m",
        });
        setSegments(segResponse.segments ?? []);
        setSegmentStats(segResponse.stats);
        setPickups(
          (pickupRows as ScanPickupRecord[]).filter(
            (row) => (row.sourceKind ?? "scan-measurement") === "scan-measurement",
          ),
        );
        setElementIdMap(elementResponse ? buildElementIdMap(elementResponse.elements) : {});
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load point cloud");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, modelAssetId]);

  /* ── Tool + count session ─────────────────────────────────────────────── */
  const handleToolChange = useCallback((next: ScanMeasureTool) => {
    // Leaving (or re-arming) the count tool ends the batch session — the
    // next count click starts a fresh pickup.
    countSessionRef.current = { pickupId: null, points: [], value: 0, chain: Promise.resolve() };
    setTool(next);
  }, []);

  const handleMeasurement = useCallback(
    (draft: ScanMeasurementDraft) => {
      setActionError(null);
      if (draft.type === "count") {
        const session = countSessionRef.current;
        session.value += draft.value || 1;
        session.points = [...session.points, ...draft.points];
        const points = session.points;
        const value = session.value;
        session.chain = session.chain
          .then(async () => {
            if (!session.pickupId) {
              const record = (await createPickup(projectId, {
                documentId,
                pageNumber: 0,
                annotationType: "count",
                label: "Scan count",
                color: TOOL_COLORS.count,
                points,
                measurement: { value, unit: "count" },
                sourceKind: "scan-measurement",
                modelId: modelAssetId,
                metadata: { source: "scan", method: "scan-manual-measure", measuredBy: "person" },
              })) as ScanPickupRecord;
              session.pickupId = record.id;
              setPickups((prev) => [...prev, record]);
            } else {
              const record = (await updatePickup(projectId, session.pickupId, {
                points,
                measurement: { value, unit: "count" },
              })) as ScanPickupRecord;
              setPickups((prev) => prev.map((p) => (p.id === record.id ? record : p)));
            }
          })
          .catch((err) => reportError(err, "Failed to save count"));
        return;
      }
      void (async () => {
        try {
          const record = (await createPickup(projectId, {
            documentId,
            pageNumber: 0,
            annotationType: draft.type,
            label: measurementLabel(draft),
            color: TOOL_COLORS[draft.type] ?? TOOL_COLORS.linear,
            points: draft.points,
            measurement:
              draft.type === "area-polygon"
                ? { value: draft.value, area: draft.area ?? draft.value, unit: "m" }
                : { value: draft.value, unit: "m" },
            sourceKind: "scan-measurement",
            modelId: modelAssetId,
            metadata: { source: "scan", method: "scan-manual-measure", measuredBy: "person" },
          })) as ScanPickupRecord;
          setPickups((prev) => [...prev, record]);
        } catch (err) {
          reportError(err, "Failed to save measurement");
        }
      })();
    },
    [documentId, modelAssetId, projectId, reportError],
  );

  const handleDeletePickup = useCallback(
    async (pickupId: string) => {
      setActionError(null);
      try {
        await deletePickup(projectId, pickupId);
        setPickups((prev) => prev.filter((p) => p.id !== pickupId));
        if (countSessionRef.current.pickupId === pickupId) {
          countSessionRef.current = { pickupId: null, points: [], value: 0, chain: Promise.resolve() };
        }
      } catch (err) {
        reportError(err, "Failed to delete measurement");
        throw err;
      }
    },
    [projectId, reportError],
  );

  /* ── Refresh (imperative, via actionsRef) ─────────────────────────────── */
  const handleRefresh = useCallback(async () => {
    const [segResponse, pickupRows, elementResponse] = await Promise.all([
      getScanSegments(projectId, modelAssetId).catch(() => ({
        segments: [] as ScanSegmentRecord[],
        stats: undefined as Record<string, unknown> | undefined,
      })),
      listPickups(projectId, documentId).catch(() => [] as unknown[]),
      queryModelElements(projectId, modelAssetId, { limit: 1000 }).catch(() => null),
    ]);
    setSegments(segResponse.segments ?? []);
    setSegmentStats(segResponse.stats);
    setPickups(
      (pickupRows as ScanPickupRecord[]).filter(
        (row) => (row.sourceKind ?? "scan-measurement") === "scan-measurement",
      ),
    );
    if (elementResponse) setElementIdMap(buildElementIdMap(elementResponse.elements));
  }, [documentId, modelAssetId, projectId]);

  useEffect(() => {
    if (!actionsRef) return;
    actionsRef.current = {
      focusSegment: (id: string) => viewerApiRef.current?.focusSegment(id),
      deletePickup: handleDeletePickup,
      refresh: handleRefresh,
    };
    return () => {
      actionsRef.current = null;
    };
  }, [actionsRef, handleDeletePickup, handleRefresh]);

  /* ── Detect Geometry (segmentation) ───────────────────────────────────── */
  const handleRunSegmentation = useCallback(async () => {
    if (segmenting) return;
    setSegmenting(true);
    setActionError(null);
    setStatusMsg("Detecting geometry…");
    try {
      const response = await runScanSegmentation(projectId, modelAssetId);
      setSegments(response.segments ?? []);
      setSegmentStats(response.stats);
      mergeElementIds(response.elements ?? []);
      const runs = (response.segments ?? []).filter((s) => s.kind === "pipe-run").length;
      const planes = (response.segments ?? []).filter((s) => s.kind === "plane").length;
      const clusters = (response.segments ?? []).filter((s) => s.kind === "cluster").length;
      setStatusMsg(`Detected ${runs} pipe runs · ${planes} surfaces · ${clusters} objects`);
    } catch (err) {
      setStatusMsg(null);
      reportError(err, "Segmentation failed");
    } finally {
      setSegmenting(false);
    }
  }, [mergeElementIds, modelAssetId, projectId, reportError, segmenting]);

  /* ── Identify from Photos ─────────────────────────────────────────────── */
  const openIdentifyPanel = useCallback(async () => {
    setIdentifyOpen((prev) => !prev);
    if (photoSources !== null || photosLoading) return;
    setPhotosLoading(true);
    try {
      // Photos live in two places: FileNodes (Documents-tab folders) and
      // SourceDocuments (intake / root drops) — surface both, like
      // site-photo-intake does.
      const [tree, workspaceResponse] = await Promise.all([
        getFileTree(projectId).catch(() => []),
        getProjectWorkspace(projectId).catch(() => null),
      ]);
      const fromFiles: ScanPhotoSource[] = tree
        .filter((node) => node.type === "file" && isPhotoFile(node.name))
        .map((node) => ({ id: `fn-${node.id}`, rawId: node.id, name: node.name, origin: "fileNode" as const }));
      const fromDocs: ScanPhotoSource[] = (workspaceResponse?.workspace?.sourceDocuments ?? [])
        .filter((doc) => isPhotoFile(doc.fileName))
        .map((doc) => ({ id: `src-${doc.id}`, rawId: doc.id, name: doc.fileName, origin: "sourceDocument" as const }));
      setPhotoSources([...fromFiles, ...fromDocs]);
    } catch {
      setPhotoSources([]);
    } finally {
      setPhotosLoading(false);
    }
  }, [photoSources, photosLoading, projectId]);

  const togglePhoto = useCallback((id: string) => {
    setSelectedPhotoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= MAX_IDENTIFY_PHOTOS) return prev;
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleIdentify = useCallback(async () => {
    const selected = (photoSources ?? []).filter((p) => selectedPhotoIds.has(p.id));
    if (selected.length === 0 || identifying) return;
    setIdentifying(true);
    setActionError(null);
    setStatusMsg("Identifying segments from photos…");
    try {
      const images = await Promise.all(
        selected.map(async (photo, idx) => {
          const url =
            photo.origin === "sourceDocument"
              ? getDocumentDownloadUrl(projectId, photo.rawId, true)
              : getFileDownloadUrl(projectId, photo.rawId, true);
          const { data, mimeType } = await fetchPhotoAsBase64(url);
          return { data, mimeType, caption: `Photo ${idx + 1}: ${photo.name}` };
        }),
      );
      const result = await identifyScanSegments(projectId, modelAssetId, { images });
      const refreshed = await getScanSegments(projectId, modelAssetId).catch(() => null);
      if (refreshed) {
        setSegments(refreshed.segments ?? []);
        setSegmentStats(refreshed.stats);
      }
      setStatusMsg(`Identified ${result.matchedCount} of ${result.segmentCount} segments`);
      setIdentifyOpen(false);
    } catch (err) {
      setStatusMsg(null);
      reportError(err, "Photo identification failed");
    } finally {
      setIdentifying(false);
    }
  }, [identifying, modelAssetId, photoSources, projectId, reportError, selectedPhotoIds]);

  /* ── Viewer bindings ──────────────────────────────────────────────────── */
  const viewerSegments = useMemo(() => segments.map(toScanSegment), [segments]);

  const measurements = useMemo<ScanMeasurementDisplay[]>(
    () =>
      pickups.map((pickup) => ({
        id: pickup.id,
        type: (pickup.annotationType as ScanMeasurementDraft["type"]) ?? "linear",
        points: pickup.points ?? [],
        color: pickup.color,
        label: pickup.label,
        visible: pickup.visible ?? true,
      })),
    [pickups],
  );

  const handleReady = useCallback((api: PointCloudViewerApi) => {
    viewerApiRef.current = api;
  }, []);

  const handleLoadProgress = useCallback((loaded: number, total: number) => {
    setLoadProgress({ loaded, total });
  }, []);

  const handlePointSize = useCallback((size: number) => {
    setPointSize(size);
    viewerApiRef.current?.setPointSize(size);
  }, []);

  const streaming =
    loadProgress !== null && loadProgress.total > 0 && loadProgress.loaded < loadProgress.total;

  /* ── Render ───────────────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="flex h-full min-h-[420px] flex-col items-center justify-center border border-line bg-panel">
        <div className="flex items-center gap-2 text-xs text-fg/45">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading point cloud…
        </div>
      </div>
    );
  }

  if (loadError || !cloud) {
    return (
      <div className="flex h-full min-h-[420px] flex-col items-center justify-center border border-line bg-panel">
        <EmptyState className="max-w-sm px-6">
          <ScanSearch className="mx-auto mb-3 h-8 w-8 text-fg/35" />
          <p className="text-sm font-medium text-fg/70">Point cloud unavailable</p>
          <p className="mt-1 text-xs text-fg/45">{loadError ?? "This scan has no streamable point data yet."}</p>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-panel">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex min-h-[42px] shrink-0 items-center gap-2 border-b border-line bg-bg px-2 py-1.5">
        {toolbarStart}
        <div className="min-w-0 max-w-[220px] truncate px-1.5 text-xs font-medium text-fg/75" title={fileName}>
          {fileName}
        </div>
        <div className="hidden h-6 w-px bg-line md:block" />
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {TOOLS.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                key={item.id}
                variant={tool === item.id ? "secondary" : "ghost"}
                size="sm"
                onClick={() => handleToolChange(item.id)}
                title={item.label}
                aria-label={item.label}
                className="h-7 w-7 shrink-0 px-0"
              >
                <Icon className="h-3.5 w-3.5" />
              </Button>
            );
          })}
          <div className="mx-1 flex shrink-0 items-center gap-1.5" title="Point size">
            <span className="text-[10px] text-fg/40">Size</span>
            <input
              type="range"
              min={0.005}
              max={0.05}
              step={0.001}
              value={pointSize}
              onChange={(event) => handlePointSize(Number(event.target.value))}
              className="h-1 w-20 accent-fg/60"
              aria-label="Point size"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => viewerApiRef.current?.fitToContent()}
            title="Fit to content"
            aria-label="Fit to content"
            className="h-7 w-7 shrink-0 px-0"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <div className="mx-1 h-6 w-px shrink-0 bg-line" />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRunSegmentation}
            disabled={segmenting}
            title="Detect pipes, surfaces and objects in the scan"
            className="h-7 shrink-0 gap-1.5 px-2 text-[11px]"
          >
            {segmenting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />}
            Detect Geometry
          </Button>
          <Button
            variant={identifyOpen ? "secondary" : "ghost"}
            size="sm"
            onClick={openIdentifyPanel}
            disabled={identifying}
            title="Identify detected segments from site photos"
            className="h-7 shrink-0 gap-1.5 px-2 text-[11px]"
          >
            {identifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            Identify from Photos
          </Button>
        </div>
        <div className={cn("hidden max-w-[240px] truncate text-[11px] text-fg/45 lg:block", actionError && "text-danger")}>
          {actionError ?? statusMsg}
        </div>
        {toolbarEnd}
      </div>

      {/* ── Surface (full-width viewer — list UI lives in the workspace rail) ── */}
      <div className="relative min-h-0 w-full flex-1 overflow-hidden">
        {streaming && loadProgress && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 bg-line/50">
            <div
              className="h-full bg-fg/60 transition-[width]"
              style={{ width: `${Math.min(100, (loadProgress.loaded / loadProgress.total) * 100)}%` }}
            />
          </div>
        )}
        <PointCloudViewer
          cloud={cloud}
          segments={viewerSegments}
          visibleSegmentIds={visibleSegmentIds ?? null}
          selectedSegmentIds={selectedSegmentIds ?? null}
          onSelectSegment={onSelectSegment}
          tool={tool}
          onMeasurement={handleMeasurement}
          measurements={measurements}
          selectedMeasurementId={selectedPickupId ?? null}
          onSelectMeasurement={onSelectedPickupChange}
          pointSize={pointSize}
          onReady={handleReady}
          onLoadProgress={handleLoadProgress}
          className="h-full w-full"
        />

        {/* Identify-from-photos popover */}
        {identifyOpen && (
          <div className="absolute left-2 top-2 z-20 flex w-[300px] flex-col overflow-hidden rounded-md border border-line bg-bg shadow-lg">
            <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-fg/50">
                Identify from photos · {selectedPhotoIds.size}/{MAX_IDENTIFY_PHOTOS}
              </p>
              <button
                type="button"
                onClick={() => setIdentifyOpen(false)}
                className="text-[10px] font-medium uppercase tracking-wider text-fg/45 hover:text-fg/70"
              >
                Close
              </button>
            </div>
            <div className="max-h-[260px] min-h-[80px] overflow-y-auto p-2">
              {photosLoading || photoSources === null ? (
                <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-fg/40">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading photos…
                </div>
              ) : photoSources.length === 0 ? (
                <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-[11px] text-fg/40">
                  No project photos yet. Add JPG / PNG files in Documents.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {photoSources.map((photo) => {
                    const selected = selectedPhotoIds.has(photo.id);
                    const disabled = !selected && selectedPhotoIds.size >= MAX_IDENTIFY_PHOTOS;
                    const url =
                      photo.origin === "sourceDocument"
                        ? getDocumentDownloadUrl(projectId, photo.rawId, true)
                        : getFileDownloadUrl(projectId, photo.rawId, true);
                    return (
                      <button
                        key={photo.id}
                        type="button"
                        onClick={() => togglePhoto(photo.id)}
                        disabled={disabled}
                        title={photo.name}
                        className={cn(
                          "relative overflow-hidden rounded border bg-panel/60 disabled:cursor-not-allowed disabled:opacity-40",
                          selected ? "border-cyan-500 ring-1 ring-cyan-500/30" : "border-line hover:border-cyan-500/40",
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={photo.name} loading="lazy" className="aspect-square w-full object-cover" />
                        {selected && (
                          <span className="absolute right-0.5 top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-cyan-500 text-white">
                            <Check className="h-2.5 w-2.5" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="border-t border-line p-2">
              <Button
                size="sm"
                disabled={identifying || selectedPhotoIds.size === 0}
                onClick={handleIdentify}
                className="h-7 w-full justify-center gap-1.5 text-[11px]"
              >
                {identifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                Identify {selectedPhotoIds.size || "—"} photo{selectedPhotoIds.size === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Status line ─────────────────────────────────────────────────── */}
      <div className="flex h-6 shrink-0 items-center gap-2 border-t border-line bg-bg px-2 text-[10px] text-fg/45">
        <span className="tabular-nums">{cloud.pointCount.toLocaleString()} points</span>
        <span className="text-fg/25">·</span>
        <span className="min-w-0 truncate" title={fileName}>
          {fileName}
        </span>
        {streaming && loadProgress && (
          <>
            <span className="text-fg/25">·</span>
            <span className="tabular-nums">
              streaming {Math.min(100, Math.round((loadProgress.loaded / loadProgress.total) * 100))}%
            </span>
          </>
        )}
        {statusMsg && (
          <>
            <span className="text-fg/25">·</span>
            <span className="min-w-0 truncate">{statusMsg}</span>
          </>
        )}
      </div>
    </div>
  );
}

export default ScanTakeoffSurface;
