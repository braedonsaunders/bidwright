"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  Camera,
  Check,
  Eye,
  EyeOff,
  Hash,
  Loader2,
  Maximize2,
  MousePointer2,
  PanelRight,
  Ruler,
  ScanSearch,
  Spline,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "@appkit/ui";
import { EmptyState } from "@/components/legacy-controls";
import {
  createModelTakeoffLink,
  createPickup,
  createPickupLink,
  createWorksheetItemFast,
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
  selectedSegmentId?: string | null;
  onSelectSegment?: (id: string | null) => void;
  tool: ScanMeasureTool;
  onMeasurement?: (draft: ScanMeasurementDraft) => void;
  measurements?: ScanMeasurementDisplay[];
  pointSize?: number;
  onReady?: (api: PointCloudViewerApi) => void;
  onLoadProgress?: (loaded: number, total: number) => void;
  className?: string;
}

const PointCloudViewer = dynamic(
  () => import("./takeoff/pointcloud-viewer").then((m) => ({ default: m.PointCloudViewer })),
  { ssr: false },
) as ComponentType<PointCloudViewerProps>;

export interface ScanTakeoffSurfaceProps {
  projectId: string;
  modelAssetId: string;
  fileName: string;
  selectedWorksheetId?: string;
  defaultEstimateCategory?: { id?: string | null; name: string; entityType: string } | null;
  /** Revision default markup — falls back to 0.2 when absent. */
  defaultMarkup?: number;
  /** Called after creating worksheet items / takeoff links. */
  onWorkspaceMutated?: () => void;
  toolbarStart?: ReactNode;
  toolbarEnd?: ReactNode;
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

const SEGMENT_GROUPS: Array<{ kind: ScanSegmentRecord["kind"]; title: string }> = [
  { kind: "pipe-run", title: "Pipe runs" },
  { kind: "plane", title: "Surfaces" },
  { kind: "cluster", title: "Objects" },
];

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

function pickupUom(annotationType: string): string {
  if (annotationType === "area-polygon") return "m²";
  if (annotationType === "count") return "EA";
  return "m";
}

function formatPickupValue(pickup: ScanPickupRecord): string {
  const value = pickup.measurement?.value ?? 0;
  if (pickup.annotationType === "count") return `${Math.round(value)} EA`;
  if (pickup.annotationType === "area-polygon") {
    return `${(pickup.measurement?.area ?? value).toFixed(1)} m²`;
  }
  return `${value.toFixed(2)} m`;
}

function segmentQuantity(segment: ScanSegmentRecord): { quantity: number; uom: string } {
  if (segment.kind === "pipe-run") return { quantity: segment.length ?? 0, uom: "m" };
  if (segment.kind === "plane") return { quantity: segment.area ?? 0, uom: "m²" };
  return { quantity: 1, uom: "EA" };
}

function confidenceChipClass(confidence: number): string {
  if (confidence >= 0.7) return "border-success/30 bg-success/10 text-success";
  if (confidence >= 0.5) return "border-warning/30 bg-warning/10 text-warning";
  return "border-line bg-bg/40 text-fg/45";
}

function identificationSummary(segment: ScanSegmentRecord): string {
  const ident = segment.identification;
  if (!ident) return "";
  return [ident.nominalSize, ident.material, ident.service].filter(Boolean).join(" · ");
}

export function ScanTakeoffSurface({
  projectId,
  modelAssetId,
  fileName,
  selectedWorksheetId,
  defaultEstimateCategory,
  defaultMarkup,
  onWorkspaceMutated,
  toolbarStart,
  toolbarEnd,
}: ScanTakeoffSurfaceProps) {
  const documentId = `model-${modelAssetId}`;

  const [cloud, setCloud] = useState<ScanPointCloudInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [segments, setSegments] = useState<ScanSegmentRecord[]>([]);
  const [pickups, setPickups] = useState<ScanPickupRecord[]>([]);
  /** Segment externalId (= segment.id) → ModelElement.id, for takeoff links. */
  const [elementIdMap, setElementIdMap] = useState<Record<string, string>>({});

  const [tool, setTool] = useState<ScanMeasureTool>("orbit");
  const [pointSize, setPointSize] = useState(0.02);
  const [hiddenSegmentIds, setHiddenSegmentIds] = useState<Set<string>>(new Set());
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number } | null>(null);

  const [segmenting, setSegmenting] = useState(false);
  const [identifyOpen, setIdentifyOpen] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const [photoSources, setPhotoSources] = useState<ScanPhotoSource[] | null>(null);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());

  const [busyPickupId, setBusyPickupId] = useState<string | null>(null);
  const [busySegmentId, setBusySegmentId] = useState<string | null>(null);
  const [bulkAdding, setBulkAdding] = useState(false);

  const viewerApiRef = useRef<PointCloudViewerApi | null>(null);
  /** Active count-tool session — successive clicks accumulate into ONE
   *  pickup. `chain` serializes create/update so rapid clicks can't race. */
  const countSessionRef = useRef<{
    pickupId: string | null;
    points: Array<{ x: number; y: number; z: number }>;
    value: number;
    chain: Promise<void>;
  }>({ pickupId: null, points: [], value: 0, chain: Promise.resolve() });

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

  /* ── Initial load: cloud info + segments + scan pickups + elements ────── */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setCloud(null);
    setSegments([]);
    setPickups([]);
    setElementIdMap({});
    (async () => {
      try {
        const [info, segResponse, pickupRows, elementResponse] = await Promise.all([
          getScanPointCloudInfo(projectId, modelAssetId),
          getScanSegments(projectId, modelAssetId).catch(() => ({ segments: [] as ScanSegmentRecord[] })),
          listPickups(projectId, `model-${modelAssetId}`).catch(() => [] as unknown[]),
          queryModelElements(projectId, modelAssetId, { limit: 2000 }).catch(() => null),
        ]);
        if (cancelled) return;
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
        setPickups(
          (pickupRows as ScanPickupRecord[]).filter(
            (row) => (row.sourceKind ?? "scan-measurement") === "scan-measurement",
          ),
        );
        if (elementResponse) {
          setElementIdMap(() => {
            const map: Record<string, string> = {};
            for (const element of elementResponse.elements) {
              if (element.externalId) map[element.externalId] = element.id;
            }
            return map;
          });
        }
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
      }
    },
    [projectId, reportError],
  );

  /* ── Pickup → worksheet item ──────────────────────────────────────────── */
  const addPickupAsItem = useCallback(
    async (pickup: ScanPickupRecord) => {
      if (!selectedWorksheetId) return;
      setActionError(null);
      setBusyPickupId(pickup.id);
      try {
        const isArea = pickup.annotationType === "area-polygon";
        const quantity = isArea
          ? pickup.measurement?.area ?? pickup.measurement?.value ?? 0
          : pickup.measurement?.value ?? 0;
        const response = await createWorksheetItemFast(projectId, selectedWorksheetId, {
          category: defaultEstimateCategory?.name ?? "",
          entityType: defaultEstimateCategory?.entityType ?? "material",
          categoryId: defaultEstimateCategory?.id ?? null,
          entityName: pickup.label,
          description: "",
          quantity,
          uom: pickupUom(pickup.annotationType),
          cost: 0,
          markup: defaultMarkup ?? 0.2,
          price: 0,
          sourceNotes: `From LiDAR scan (${fileName})`,
        });
        await createPickupLink(projectId, {
          pickupId: pickup.id,
          worksheetItemId: response.item.id,
          quantityField: isArea ? "area" : "value",
        });
        setStatusMsg(`Added "${pickup.label}" to worksheet`);
        onWorkspaceMutated?.();
      } catch (err) {
        reportError(err, "Failed to create worksheet item");
      } finally {
        setBusyPickupId(null);
      }
    },
    [defaultEstimateCategory, defaultMarkup, fileName, onWorkspaceMutated, projectId, reportError, selectedWorksheetId],
  );

  /* ── Segment → worksheet item + model takeoff link ────────────────────── */
  const addSegmentAsItem = useCallback(
    async (segment: ScanSegmentRecord, options?: { deferMutate?: boolean }) => {
      if (!selectedWorksheetId) return false;
      const modelElementId = elementIdMap[segment.id];
      if (!modelElementId) return false;
      setActionError(null);
      try {
        const { quantity, uom } = segmentQuantity(segment);
        const service = segment.identification?.service;
        const response = await createWorksheetItemFast(projectId, selectedWorksheetId, {
          category: defaultEstimateCategory?.name ?? "",
          entityType: defaultEstimateCategory?.entityType ?? "material",
          categoryId: defaultEstimateCategory?.id ?? null,
          entityName: service ? `${segment.label} — ${service}` : segment.label,
          description: "",
          quantity,
          uom,
          cost: 0,
          markup: defaultMarkup ?? 0.2,
          price: 0,
          sourceNotes: `From LiDAR scan (${fileName})`,
        });
        await createModelTakeoffLink(projectId, modelAssetId, {
          worksheetItemId: response.item.id,
          modelElementId,
          quantityField: "quantity",
          multiplier: 1,
          derivedQuantity: quantity,
          selection: { mode: "scan-segment", segmentId: segment.id, label: segment.label },
        });
        if (!options?.deferMutate) {
          setStatusMsg(`Added "${segment.label}" to worksheet`);
          onWorkspaceMutated?.();
        }
        return true;
      } catch (err) {
        reportError(err, "Failed to create worksheet item");
        return false;
      }
    },
    [
      defaultEstimateCategory,
      defaultMarkup,
      elementIdMap,
      fileName,
      modelAssetId,
      onWorkspaceMutated,
      projectId,
      reportError,
      selectedWorksheetId,
    ],
  );

  const handleAddSegment = useCallback(
    async (segment: ScanSegmentRecord) => {
      setBusySegmentId(segment.id);
      try {
        await addSegmentAsItem(segment);
      } finally {
        setBusySegmentId(null);
      }
    },
    [addSegmentAsItem],
  );

  const pipeRuns = useMemo(() => segments.filter((s) => s.kind === "pipe-run"), [segments]);
  const linkablePipeRuns = useMemo(
    () => pipeRuns.filter((s) => Boolean(elementIdMap[s.id])),
    [elementIdMap, pipeRuns],
  );

  const handleAddAllPipeRuns = useCallback(async () => {
    if (!selectedWorksheetId || linkablePipeRuns.length === 0 || bulkAdding) return;
    setBulkAdding(true);
    setActionError(null);
    let added = 0;
    try {
      for (const run of linkablePipeRuns) {
        // Sequential on purpose — keeps line order stable and the API load sane.
        const ok = await addSegmentAsItem(run, { deferMutate: true });
        if (ok) added += 1;
      }
      setStatusMsg(`Added ${added} pipe run${added === 1 ? "" : "s"} to worksheet`);
      if (added > 0) onWorkspaceMutated?.();
    } finally {
      setBulkAdding(false);
    }
  }, [addSegmentAsItem, bulkAdding, linkablePipeRuns, onWorkspaceMutated, selectedWorksheetId]);

  /* ── Detect Geometry (segmentation) ───────────────────────────────────── */
  const handleRunSegmentation = useCallback(async () => {
    if (segmenting) return;
    setSegmenting(true);
    setActionError(null);
    setStatusMsg("Detecting geometry…");
    try {
      const response = await runScanSegmentation(projectId, modelAssetId);
      setSegments(response.segments ?? []);
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
      if (refreshed) setSegments(refreshed.segments ?? []);
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

  const visibleSegmentIds = useMemo(() => {
    if (hiddenSegmentIds.size === 0) return null;
    return segments.filter((s) => !hiddenSegmentIds.has(s.id)).map((s) => s.id);
  }, [hiddenSegmentIds, segments]);

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

  const handleSelectSegment = useCallback((id: string | null) => {
    setSelectedSegmentId(id);
  }, []);

  const handleSegmentRowClick = useCallback((segment: ScanSegmentRecord) => {
    setSelectedSegmentId(segment.id);
    viewerApiRef.current?.focusSegment(segment.id);
  }, []);

  const toggleSegmentVisibility = useCallback((segmentId: string) => {
    setHiddenSegmentIds((prev) => {
      const next = new Set(prev);
      if (next.has(segmentId)) {
        next.delete(segmentId);
      } else {
        next.add(segmentId);
      }
      return next;
    });
  }, []);

  const streaming =
    loadProgress !== null && loadProgress.total > 0 && loadProgress.loaded < loadProgress.total;
  const worksheetTooltip = selectedWorksheetId ? undefined : "Pick a worksheet first";

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
        <Button
          variant={panelOpen ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setPanelOpen((prev) => !prev)}
          title={panelOpen ? "Hide takeoff panel" : "Show takeoff panel"}
          aria-label={panelOpen ? "Hide takeoff panel" : "Show takeoff panel"}
          className="h-7 w-7 shrink-0 px-0"
        >
          <PanelRight className="h-3.5 w-3.5" />
        </Button>
        {toolbarEnd}
      </div>

      {/* ── Surface ─────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 w-full flex-1 overflow-hidden">
        <div className="relative min-w-0 flex-1">
          {streaming && loadProgress && (
            <div className="absolute inset-x-0 top-0 z-10 h-0.5 bg-line/50">
              <div
                className="h-full bg-fg/60 transition-[width]"
                style={{ width: `${Math.min(100, (loadProgress.loaded / loadProgress.total) * 100)}%` }}
              />
            </div>
          )}
          <PointCloudViewer
            cloud={cloud}
            segments={viewerSegments}
            visibleSegmentIds={visibleSegmentIds}
            selectedSegmentId={selectedSegmentId}
            onSelectSegment={handleSelectSegment}
            tool={tool}
            onMeasurement={handleMeasurement}
            measurements={measurements}
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

        {/* ── Right rail: pickups + detected geometry ─────────────────────── */}
        {panelOpen && (
          <div className="flex w-[300px] shrink-0 flex-col overflow-hidden border-l border-line bg-bg/30">
            {/* Measurements */}
            <div className="flex min-h-0 flex-col border-b border-line">
              <div className="flex shrink-0 items-center justify-between border-b border-line bg-bg/40 px-2.5 py-1.5">
                <p className="text-[10px] font-medium uppercase tracking-wider text-fg/50">
                  Measurements · {pickups.length}
                </p>
              </div>
              <div className="max-h-[38%] min-h-[72px] overflow-y-auto">
                {pickups.length === 0 ? (
                  <p className="px-3 py-4 text-center text-[11px] text-fg/40">
                    Use the Distance, Area or Count tools to measure the scan.
                  </p>
                ) : (
                  pickups.map((pickup) => (
                    <div
                      key={pickup.id}
                      className="flex items-center gap-2 border-b border-line/60 px-2.5 py-1.5 last:border-b-0"
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: pickup.color }} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] text-fg/80" title={pickup.label}>
                          {pickup.label}
                        </p>
                        <p className="text-[10px] tabular-nums text-fg/45">{formatPickupValue(pickup)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => addPickupAsItem(pickup)}
                        disabled={!selectedWorksheetId || busyPickupId === pickup.id}
                        title={worksheetTooltip ?? "Create a worksheet line item"}
                        className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-fg/60 hover:border-fg/30 hover:text-fg/85 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {busyPickupId === pickup.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "→ Item"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeletePickup(pickup.id)}
                        title="Delete measurement"
                        aria-label="Delete measurement"
                        className="shrink-0 text-fg/35 hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Detected geometry */}
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center justify-between border-b border-line bg-bg/40 px-2.5 py-1.5">
                <p className="text-[10px] font-medium uppercase tracking-wider text-fg/50">
                  Detected geometry · {segments.length}
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {segments.length === 0 ? (
                  <p className="px-3 py-4 text-center text-[11px] text-fg/40">
                    No segments yet. Run Detect Geometry to find pipes, surfaces and objects.
                  </p>
                ) : (
                  SEGMENT_GROUPS.map((group) => {
                    const rows = segments.filter((s) => s.kind === group.kind);
                    if (rows.length === 0) return null;
                    return (
                      <div key={group.kind}>
                        <div className="flex items-center justify-between bg-bg/50 px-2.5 py-1">
                          <p className="text-[10px] font-medium uppercase tracking-wider text-fg/40">
                            {group.title} · {rows.length}
                          </p>
                          {group.kind === "pipe-run" && (
                            <button
                              type="button"
                              onClick={handleAddAllPipeRuns}
                              disabled={!selectedWorksheetId || linkablePipeRuns.length === 0 || bulkAdding}
                              title={
                                worksheetTooltip ??
                                (linkablePipeRuns.length === 0
                                  ? "Run Detect Geometry first"
                                  : "Create a worksheet line item for every pipe run")
                              }
                              className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-fg/60 hover:border-fg/30 hover:text-fg/85 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {bulkAdding && <Loader2 className="h-3 w-3 animate-spin" />}
                              Add all
                            </button>
                          )}
                        </div>
                        {rows.map((segment) => {
                          const hidden = hiddenSegmentIds.has(segment.id);
                          const linkable = Boolean(elementIdMap[segment.id]);
                          const identSummary = identificationSummary(segment);
                          return (
                            <div
                              key={segment.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => handleSegmentRowClick(segment)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  handleSegmentRowClick(segment);
                                }
                              }}
                              className={cn(
                                "flex cursor-pointer items-center gap-2 border-b border-line/60 px-2.5 py-1.5 last:border-b-0 hover:bg-bg/50",
                                selectedSegmentId === segment.id && "bg-bg/60",
                              )}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <p className="truncate text-[11px] text-fg/80" title={segment.label}>
                                    {segment.label}
                                  </p>
                                  <span
                                    className={cn(
                                      "shrink-0 rounded-full border px-1 py-px text-[9px] font-medium tabular-nums",
                                      confidenceChipClass(segment.confidence),
                                    )}
                                  >
                                    {Math.round(segment.confidence * 100)}%
                                  </span>
                                </div>
                                <p className="truncate text-[10px] tabular-nums text-fg/45">
                                  {segment.kind === "pipe-run" && segment.length != null && `${segment.length.toFixed(2)} m`}
                                  {segment.kind === "plane" &&
                                    segment.area != null &&
                                    `${segment.area.toFixed(1)} m²${segment.kindDetail ? ` · ${segment.kindDetail}` : ""}`}
                                  {segment.kind === "cluster" && `${segment.pointCount.toLocaleString()} pts`}
                                  {identSummary && ` · ${identSummary}`}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleSegmentVisibility(segment.id);
                                }}
                                title={hidden ? "Show segment" : "Hide segment"}
                                aria-label={hidden ? "Show segment" : "Hide segment"}
                                className="shrink-0 text-fg/40 hover:text-fg/70"
                              >
                                {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleAddSegment(segment);
                                }}
                                disabled={!selectedWorksheetId || !linkable || busySegmentId === segment.id || bulkAdding}
                                title={
                                  worksheetTooltip ??
                                  (linkable ? "Create a worksheet line item" : "Run Detect Geometry first")
                                }
                                className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-fg/60 hover:border-fg/30 hover:text-fg/85 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {busySegmentId === segment.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "→ Item"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })
                )}
              </div>
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
