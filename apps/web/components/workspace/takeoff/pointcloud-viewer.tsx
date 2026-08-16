"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@appkit/ui";
import type * as THREE from "three";
import type { OrbitControls as OrbitControlsType } from "three/examples/jsm/controls/OrbitControls.js";
import { cn } from "@/lib/utils";
import type {
  PointCloudViewerApi,
  ScanMeasureTool,
  ScanMeasurementDisplay,
  ScanMeasurementDraft,
  ScanPointCloudInfo,
  ScanSegment,
} from "@/lib/scan-types";
import {
  SpatialPointIndex,
  dedupeConsecutivePoints,
  distance3,
  fitPlaneToPoints,
  formatMeasureValue,
  gridCellSize,
  planarPolygonArea,
  polylineLength,
  subsampleStride,
  type PcVec3,
} from "@/lib/pointcloud-viewer-utils";

/* ─── Constants ─── */

const BYTES_PER_POINT = 16;
const PICK_PIXEL_RADIUS = 12;
const DEFAULT_POINT_SIZE = 0.015;
const SEGMENT_COLORS: Record<ScanSegment["kind"], number> = {
  "pipe-run": 0xf59e0b,
  plane: 0x3b82f6,
  cluster: 0x10b981,
};

interface PointCloudViewerProps {
  cloud: ScanPointCloudInfo;
  segments?: ScanSegment[];
  /** null/undefined = all segments visible. */
  visibleSegmentIds?: string[] | null;
  selectedSegmentId?: string | null;
  onSelectSegment?: (id: string | null) => void;
  tool: ScanMeasureTool;
  onMeasurement?: (draft: ScanMeasurementDraft) => void;
  measurements?: ScanMeasurementDisplay[];
  /** Point size in world meters (sizeAttenuation). */
  pointSize?: number;
  onReady?: (api: PointCloudViewerApi) => void;
  onLoadProgress?: (loaded: number, total: number) => void;
  className?: string;
}

/* ─── Viewer hooks (component → viewer bridge, always reads latest props) ─── */

interface ViewerHooks {
  getTool(): ScanMeasureTool;
  getSegments(): ScanSegment[];
  getVisibleSegmentIds(): string[] | null | undefined;
  getSelectedSegmentId(): string | null | undefined;
  getMeasurements(): ScanMeasurementDisplay[];
  onSelectSegment(id: string | null): void;
  onMeasurement(draft: ScanMeasurementDraft): void;
  onLoadProgress(loaded: number, total: number): void;
  setReadout(text: string | null, clientX: number, clientY: number): void;
}

interface ViewerHandle {
  api: PointCloudViewerApi;
  /** Starts (and awaits) the binary point stream. */
  stream(): Promise<void>;
  resetDraft(): void;
  updateSegments(): void;
  updateMeasurements(): void;
  setPointSize(size: number): void;
  dispose(): void;
}

/* ─── Viewer construction ─── */

async function createPointCloudViewer(
  container: HTMLDivElement,
  cloud: ScanPointCloudInfo,
  hooks: ViewerHooks,
  signal: AbortSignal,
): Promise<ViewerHandle> {
  const T = await import("three");
  const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");

  const bboxMin = cloud.bbox.min;
  const bboxMax = cloud.bbox.max;
  const center = new T.Vector3(
    (bboxMin[0] + bboxMax[0]) / 2,
    (bboxMin[1] + bboxMax[1]) / 2,
    (bboxMin[2] + bboxMax[2]) / 2,
  );
  const extent = new T.Vector3(
    Math.max(bboxMax[0] - bboxMin[0], 0),
    Math.max(bboxMax[1] - bboxMin[1], 0),
    Math.max(bboxMax[2] - bboxMin[2], 0),
  );
  const maxDim = Math.max(extent.x, extent.y, extent.z, 0.5);
  const diagonal = Math.max(extent.length(), 0.5);
  const markerRadius = Math.min(Math.max(maxDim * 0.004, 0.02), 0.15);

  const scene = new T.Scene();
  scene.background = new T.Color(0x1a1a2e);

  // No grid floor — the scan carries its own floor. Just a subtle axes helper.
  const axes = new T.AxesHelper(Math.max(maxDim * 0.12, 0.5));
  axes.position.set(bboxMin[0], bboxMin[1], bboxMin[2]);
  const axesMaterial = axes.material as InstanceType<typeof T.LineBasicMaterial>;
  axesMaterial.transparent = true;
  axesMaterial.opacity = 0.45;
  axes.raycast = () => undefined;
  scene.add(axes);

  // Lights only affect the segment/measurement overlay meshes, not the points.
  scene.add(new T.AmbientLight(0xffffff, 0.85));
  const keyLight = new T.DirectionalLight(0xffffff, 0.6);
  keyLight.position.set(1, -1, 2);
  scene.add(keyLight);

  // LiDAR scans are Z-up (floor/ceiling normals in the segmentation pipeline).
  const camera = new T.PerspectiveCamera(
    50,
    Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1),
    Math.max(maxDim * 0.001, 0.01),
    Math.max(diagonal * 20, 100),
  );
  camera.up.set(0, 0, 1);

  let renderer: InstanceType<typeof T.WebGLRenderer>;
  try {
    renderer = new T.WebGLRenderer({ antialias: true });
  } catch {
    throw new Error("WebGL is not available in this browser, so the point cloud cannot be displayed.");
  }
  renderer.setSize(Math.max(container.clientWidth, 1), Math.max(container.clientHeight, 1));
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  const canvas = renderer.domElement;

  const controls = new OrbitControls(camera, canvas) as OrbitControlsType;
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  /* ── Point cloud geometry (streamed into a preallocated interleaved buffer) ── */

  const totalPoints = Math.max(cloud.pointCount, 0);
  const totalBytes = totalPoints * BYTES_PER_POINT;
  const backing = new ArrayBuffer(Math.max(totalBytes, BYTES_PER_POINT));
  const f32 = new Float32Array(backing);
  const u8 = new Uint8Array(backing);

  const positionBuffer = new T.InterleavedBuffer(f32, 4);
  positionBuffer.setUsage(T.DynamicDrawUsage);
  const colorBuffer = new T.InterleavedBuffer(u8, BYTES_PER_POINT);
  colorBuffer.setUsage(T.DynamicDrawUsage);

  const pointsGeometry = new T.BufferGeometry();
  pointsGeometry.setAttribute("position", new T.InterleavedBufferAttribute(positionBuffer, 3, 0));
  pointsGeometry.setAttribute("color", new T.InterleavedBufferAttribute(colorBuffer, 3, 12, true));
  pointsGeometry.setDrawRange(0, 0);
  // Bounds come from the manifest — never recomputed over half-filled buffers.
  pointsGeometry.boundingSphere = new T.Sphere(center.clone(), diagonal / 2 + 1);
  pointsGeometry.boundingBox = new T.Box3(
    new T.Vector3(bboxMin[0], bboxMin[1], bboxMin[2]),
    new T.Vector3(bboxMax[0], bboxMax[1], bboxMax[2]),
  );

  const pointsMaterial = new T.PointsMaterial({
    size: DEFAULT_POINT_SIZE,
    sizeAttenuation: true,
    vertexColors: cloud.hasColor,
  });
  if (!cloud.hasColor) pointsMaterial.color.setHex(0xb8c2cf);

  const points = new T.Points(pointsGeometry, pointsMaterial);
  points.frustumCulled = false;
  points.raycast = () => undefined;
  scene.add(points);

  /* ── Overlay groups ── */

  const segmentGroup = new T.Group();
  segmentGroup.name = "scan-segments";
  scene.add(segmentGroup);
  const measurementGroup = new T.Group();
  measurementGroup.name = "scan-measurements";
  scene.add(measurementGroup);
  const draftGroup = new T.Group();
  draftGroup.name = "scan-measure-draft";
  scene.add(draftGroup);

  const sharedMarkerGeometry = new T.SphereGeometry(markerRadius, 12, 8);
  const sharedCountGeometry = new T.OctahedronGeometry(markerRadius * 1.6);
  const draftMarkerMaterial = new T.MeshBasicMaterial({ color: 0x22d3ee });
  const draftLineMaterial = new T.LineBasicMaterial({ color: 0x22d3ee });
  const hoverMarkerMaterial = new T.MeshBasicMaterial({ color: 0xf8fafc, transparent: true, opacity: 0.8 });

  function disposeObject(object: THREE.Object3D) {
    object.traverse((child) => {
      const mesh = child as Partial<THREE.Mesh> & THREE.Object3D;
      const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
      if (geometry && geometry !== sharedMarkerGeometry && geometry !== sharedCountGeometry) {
        geometry.dispose();
      }
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (!material) return;
      const materials = Array.isArray(material) ? material : [material];
      for (const item of materials) {
        if (item === draftMarkerMaterial || item === draftLineMaterial || item === hoverMarkerMaterial) continue;
        item.dispose();
      }
    });
  }

  function clearGroup(group: THREE.Group) {
    for (const child of [...group.children]) {
      disposeObject(child);
      group.remove(child);
    }
  }

  /* ── Spatial pick index (subsampled, built while streaming) ── */

  const cellSize = gridCellSize(bboxMin, bboxMax, 96);
  const pickStride = subsampleStride(totalPoints);
  const pickIndex = new SpatialPointIndex(cellSize);

  let bytesReceived = 0;
  let recordsIndexed = 0;

  function ingestChunk(chunk: Uint8Array) {
    const room = totalBytes - bytesReceived;
    if (room <= 0) return;
    const usable = Math.min(chunk.byteLength, room);
    u8.set(usable === chunk.byteLength ? chunk : chunk.subarray(0, usable), bytesReceived);
    bytesReceived += usable;
    // Records split across network chunks complete on a later ingest; only
    // whole records are drawn/uploaded/indexed.
    const records = Math.floor(bytesReceived / BYTES_PER_POINT);
    const previous = pointsGeometry.drawRange.count;
    if (records <= previous) return;
    pointsGeometry.setDrawRange(0, records);
    positionBuffer.addUpdateRange(previous * 4, (records - previous) * 4);
    positionBuffer.needsUpdate = true;
    colorBuffer.addUpdateRange(previous * BYTES_PER_POINT, (records - previous) * BYTES_PER_POINT);
    colorBuffer.needsUpdate = true;
    for (let i = recordsIndexed; i < records; i += 1) {
      if (i % pickStride === 0) {
        pickIndex.insert(f32[i * 4], f32[i * 4 + 1], f32[i * 4 + 2]);
      }
    }
    recordsIndexed = records;
  }

  async function stream(): Promise<void> {
    if (totalPoints === 0) {
      hooks.onLoadProgress(0, 0);
      return;
    }
    hooks.onLoadProgress(0, totalPoints);
    const response = await fetch(cloud.pointsUrl, { credentials: "include", signal });
    if (!response.ok) throw new Error(`Failed to fetch point stream: ${response.status}`);
    if (!response.body) {
      ingestChunk(new Uint8Array(await response.arrayBuffer()));
    } else {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          ingestChunk(value);
          hooks.onLoadProgress(Math.floor(bytesReceived / BYTES_PER_POINT), totalPoints);
        }
      }
    }
    hooks.onLoadProgress(Math.floor(bytesReceived / BYTES_PER_POINT), totalPoints);
  }

  /* ── Camera framing ── */

  function frameSphere(target: THREE.Vector3, radius: number) {
    const distance = Math.max(radius, 0.5) * 2.2;
    const direction = camera.position.clone().sub(controls.target);
    if (direction.lengthSq() < 1e-6) direction.set(1, -1, 0.8);
    direction.normalize();
    controls.target.copy(target);
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    controls.update();
  }

  function fitToContent() {
    controls.target.copy(center);
    camera.position.set(
      center.x + maxDim * 0.9,
      center.y - maxDim * 0.9,
      center.z + maxDim * 0.7,
    );
    camera.lookAt(center);
    controls.update();
  }
  fitToContent();

  function focusSegment(segmentId: string) {
    const segment = hooks.getSegments().find((item) => item.id === segmentId);
    if (!segment) return;
    let target: THREE.Vector3 | null = null;
    if (segment.centroid) {
      target = new T.Vector3(...segment.centroid);
    } else if (segment.bbox) {
      target = new T.Vector3(
        (segment.bbox.min[0] + segment.bbox.max[0]) / 2,
        (segment.bbox.min[1] + segment.bbox.max[1]) / 2,
        (segment.bbox.min[2] + segment.bbox.max[2]) / 2,
      );
    } else if (segment.polyline && segment.polyline.length > 0) {
      const mid = segment.polyline[Math.floor(segment.polyline.length / 2)];
      target = new T.Vector3(...mid);
    }
    if (!target) return;
    let radius = 1;
    if (segment.bbox) {
      radius = Math.max(
        Math.hypot(
          segment.bbox.max[0] - segment.bbox.min[0],
          segment.bbox.max[1] - segment.bbox.min[1],
          segment.bbox.max[2] - segment.bbox.min[2],
        ) / 2,
        0.5,
      );
    } else if (segment.length) {
      radius = Math.max(segment.length / 2, 0.5);
    }
    frameSphere(target, radius);
  }

  /* ── Ray picking against the point index ── */

  const raycaster = new T.Raycaster();
  const ndc = new T.Vector2();

  function setRayFromEvent(event: { clientX: number; clientY: number }): number {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
    ndc.y = -((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    return Math.max(rect.height, 1);
  }

  function pickScanPoint(event: { clientX: number; clientY: number }): PcVec3 | null {
    if (pickIndex.size === 0) return null;
    const viewportHeight = setRayFromEvent(event);
    const worldPerPixelAtUnitDepth =
      (2 * Math.tan(T.MathUtils.degToRad(camera.fov) / 2)) / viewportHeight;
    const origin = raycaster.ray.origin;
    const direction = raycaster.ray.direction;
    const maxT = origin.distanceTo(center) + diagonal;
    const hit = pickIndex.pickAlongRay(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: direction.x, y: direction.y, z: direction.z },
      {
        maxT,
        radiusPerUnitDepth: worldPerPixelAtUnitDepth * PICK_PIXEL_RADIUS,
        minRadius: pointsMaterial.size,
      },
    );
    return hit ? hit.point : null;
  }

  /* ── Measure draft state ── */

  let draftPoints: PcVec3[] = [];
  let hoverPoint: PcVec3 | null = null;
  let lastPointer: { clientX: number; clientY: number } | null = null;

  function draftReadoutText(tool: ScanMeasureTool, pts: PcVec3[]): string | null {
    if (tool === "measure-area") {
      if (pts.length < 3) return null;
      return formatMeasureValue(planarPolygonArea(pts), "m2");
    }
    if (tool === "measure-line" || tool === "measure-polyline") {
      if (pts.length < 2) return null;
      return formatMeasureValue(polylineLength(pts), "m");
    }
    return null;
  }

  function refreshDraft() {
    clearGroup(draftGroup);
    const tool = hooks.getTool();
    const preview = hoverPoint ? [...draftPoints, hoverPoint] : [...draftPoints];

    for (const point of draftPoints) {
      const marker = new T.Mesh(sharedMarkerGeometry, draftMarkerMaterial);
      marker.position.set(point.x, point.y, point.z);
      draftGroup.add(marker);
    }
    if (hoverPoint && tool !== "orbit") {
      const marker = new T.Mesh(sharedMarkerGeometry, hoverMarkerMaterial);
      marker.position.set(hoverPoint.x, hoverPoint.y, hoverPoint.z);
      draftGroup.add(marker);
    }
    if (preview.length >= 2) {
      const geometry = new T.BufferGeometry().setFromPoints(
        preview.map((p) => new T.Vector3(p.x, p.y, p.z)),
      );
      const line =
        tool === "measure-area" && preview.length >= 3
          ? new T.LineLoop(geometry, draftLineMaterial)
          : new T.Line(geometry, draftLineMaterial);
      line.raycast = () => undefined;
      draftGroup.add(line);
    }

    if (lastPointer) {
      hooks.setReadout(draftReadoutText(tool, preview), lastPointer.clientX, lastPointer.clientY);
    }
  }

  function resetDraft() {
    draftPoints = [];
    hoverPoint = null;
    clearGroup(draftGroup);
    if (lastPointer) hooks.setReadout(null, lastPointer.clientX, lastPointer.clientY);
  }

  function finishDraft() {
    const tool = hooks.getTool();
    const pts = dedupeConsecutivePoints(draftPoints);
    if (tool === "measure-polyline" && pts.length >= 2) {
      hooks.onMeasurement({
        type: "linear-polyline",
        points: pts.map((p) => ({ ...p })),
        value: polylineLength(pts),
        unit: "m",
      });
    } else if (tool === "measure-area" && pts.length >= 3) {
      const area = planarPolygonArea(pts);
      hooks.onMeasurement({
        type: "area-polygon",
        points: pts.map((p) => ({ ...p })),
        value: area,
        area,
        unit: "m2",
      });
    }
    resetDraft();
  }

  function handleMeasureClick(event: PointerEvent) {
    const tool = hooks.getTool();
    const snapped = pickScanPoint(event);
    if (!snapped) return; // no point near the ray → ignore the click
    if (tool === "count") {
      hooks.onMeasurement({ type: "count", points: [{ ...snapped }], value: 1, unit: "count" });
      return;
    }
    if (tool === "measure-line") {
      draftPoints.push(snapped);
      if (draftPoints.length >= 2) {
        const pts = draftPoints.slice(0, 2);
        hooks.onMeasurement({
          type: "linear",
          points: pts.map((p) => ({ ...p })),
          value: distance3(pts[0], pts[1]),
          unit: "m",
        });
        resetDraft();
      } else {
        refreshDraft();
      }
      return;
    }
    // measure-polyline / measure-area accumulate vertices.
    draftPoints.push(snapped);
    refreshDraft();
  }

  /* ── Orbit-mode segment selection ── */

  function segmentIdForObject(object: THREE.Object3D | null): string | null {
    let current: THREE.Object3D | null = object;
    while (current) {
      const id = current.userData?.segmentId;
      if (typeof id === "string" && id) return id;
      current = current.parent;
    }
    return null;
  }

  function handleOrbitClick(event: PointerEvent) {
    setRayFromEvent(event);
    const hits = raycaster.intersectObjects(segmentGroup.children, true);
    for (const hit of hits) {
      const id = segmentIdForObject(hit.object);
      if (id) {
        hooks.onSelectSegment(id);
        return;
      }
    }
    hooks.onSelectSegment(null);
  }

  /* ── Pointer / keyboard wiring ── */

  let downAt: { x: number; y: number; t: number } | null = null;
  let pendingHover: { clientX: number; clientY: number } | null = null;

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    downAt = { x: event.clientX, y: event.clientY, t: performance.now() };
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!downAt) return;
    const moved = Math.max(Math.abs(event.clientX - downAt.x), Math.abs(event.clientY - downAt.y));
    const elapsed = performance.now() - downAt.t;
    downAt = null;
    // Drags and long presses are orbit/pan gestures, not clicks.
    if (moved > 4 || elapsed > 350) return;
    if (hooks.getTool() === "orbit") handleOrbitClick(event);
    else handleMeasureClick(event);
  };
  const onPointerMove = (event: PointerEvent) => {
    lastPointer = { clientX: event.clientX, clientY: event.clientY };
    if (hooks.getTool() !== "orbit") {
      // Coalesce hover picking to one lookup per animation frame.
      pendingHover = { clientX: event.clientX, clientY: event.clientY };
    }
  };
  const onPointerLeave = () => {
    pendingHover = null;
    if (hoverPoint) {
      hoverPoint = null;
      refreshDraft();
    }
    if (lastPointer) hooks.setReadout(null, lastPointer.clientX, lastPointer.clientY);
  };
  const onDoubleClick = (event: MouseEvent) => {
    const tool = hooks.getTool();
    if (tool !== "measure-polyline" && tool !== "measure-area") return;
    event.preventDefault();
    finishDraft();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const tool = hooks.getTool();
    if (tool === "orbit") return;
    if (event.key === "Escape") {
      if (draftPoints.length > 0 || hoverPoint) {
        event.preventDefault();
        resetDraft();
      }
    } else if (event.key === "Enter" && (tool === "measure-polyline" || tool === "measure-area")) {
      if (draftPoints.length > 0) {
        event.preventDefault();
        finishDraft();
      }
    }
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("dblclick", onDoubleClick);
  window.addEventListener("keydown", onKeyDown);

  /* ── Segment overlays ── */

  function buildPipeOverlay(segment: ScanSegment, selected: boolean, color: number): THREE.Object3D | null {
    const polyline = segment.polyline;
    if (!polyline || polyline.length < 2) return null;
    const group = new T.Group();
    group.userData.segmentId = segment.id;
    const vertices = polyline.map(([x, y, z]) => new T.Vector3(x, y, z));

    const path = new T.CurvePath<THREE.Vector3>();
    for (let i = 1; i < vertices.length; i += 1) {
      path.add(new T.LineCurve3(vertices[i - 1], vertices[i]));
    }
    const radius = Math.min(Math.max(segment.radius ?? 0.05, 0.01), 0.3);
    const tubularSegments = Math.min(Math.max((vertices.length - 1) * 4, 8), 512);
    const tube = new T.Mesh(
      new T.TubeGeometry(path, tubularSegments, radius, 12, false),
      new T.MeshLambertMaterial({
        color,
        transparent: true,
        opacity: selected ? 0.95 : 0.35,
        depthWrite: false,
        emissive: selected ? color : 0x000000,
        emissiveIntensity: selected ? 0.45 : 0,
      }),
    );
    tube.userData.segmentId = segment.id;
    group.add(tube);

    const centerline = new T.Line(
      new T.BufferGeometry().setFromPoints(vertices),
      new T.LineBasicMaterial({ color, transparent: true, opacity: selected ? 1 : 0.7 }),
    );
    centerline.raycast = () => undefined;
    group.add(centerline);
    return group;
  }

  function buildPlaneOverlay(segment: ScanSegment, selected: boolean, color: number): THREE.Object3D | null {
    const normal = segment.normal
      ? new T.Vector3(...segment.normal).normalize()
      : new T.Vector3(0, 0, 1);
    if (normal.lengthSq() < 1e-9) normal.set(0, 0, 1);
    let position: THREE.Vector3 | null = null;
    if (segment.centroid) {
      position = new T.Vector3(...segment.centroid);
    } else if (segment.bbox) {
      position = new T.Vector3(
        (segment.bbox.min[0] + segment.bbox.max[0]) / 2,
        (segment.bbox.min[1] + segment.bbox.max[1]) / 2,
        (segment.bbox.min[2] + segment.bbox.max[2]) / 2,
      );
    }
    if (!position) return null;

    // Size the patch from the bbox extents projected onto the plane basis.
    const zAxis = new T.Vector3(0, 0, 1);
    const quaternion = new T.Quaternion().setFromUnitVectors(zAxis, normal);
    const u = new T.Vector3(1, 0, 0).applyQuaternion(quaternion);
    const v = new T.Vector3(0, 1, 0).applyQuaternion(quaternion);
    let width = 1;
    let height = 1;
    if (segment.bbox) {
      const sx = segment.bbox.max[0] - segment.bbox.min[0];
      const sy = segment.bbox.max[1] - segment.bbox.min[1];
      const sz = segment.bbox.max[2] - segment.bbox.min[2];
      width = Math.abs(sx * u.x) + Math.abs(sy * u.y) + Math.abs(sz * u.z);
      height = Math.abs(sx * v.x) + Math.abs(sy * v.y) + Math.abs(sz * v.z);
    } else if (segment.area && segment.area > 0) {
      width = height = Math.sqrt(segment.area);
    }
    width = Math.min(Math.max(width, 0.1), 100);
    height = Math.min(Math.max(height, 0.1), 100);

    const geometry = new T.PlaneGeometry(width, height);
    const patch = new T.Mesh(
      geometry,
      new T.MeshLambertMaterial({
        color,
        transparent: true,
        opacity: selected ? 0.55 : 0.22,
        depthWrite: false,
        side: T.DoubleSide,
        emissive: selected ? color : 0x000000,
        emissiveIntensity: selected ? 0.4 : 0,
      }),
    );
    patch.quaternion.copy(quaternion);
    patch.position.copy(position);
    patch.userData.segmentId = segment.id;

    const outline = new T.LineSegments(
      new T.EdgesGeometry(geometry),
      new T.LineBasicMaterial({ color, transparent: true, opacity: selected ? 1 : 0.6 }),
    );
    outline.raycast = () => undefined;
    patch.add(outline);
    return patch;
  }

  function buildClusterOverlay(segment: ScanSegment, selected: boolean, color: number): THREE.Object3D | null {
    if (!segment.bbox) return null;
    const box = new T.Box3(
      new T.Vector3(...segment.bbox.min),
      new T.Vector3(...segment.bbox.max),
    );
    const size = box.getSize(new T.Vector3());
    const boxCenter = box.getCenter(new T.Vector3());
    const group = new T.Group();
    group.userData.segmentId = segment.id;

    const fill = new T.Mesh(
      new T.BoxGeometry(Math.max(size.x, 0.01), Math.max(size.y, 0.01), Math.max(size.z, 0.01)),
      new T.MeshLambertMaterial({
        color,
        transparent: true,
        opacity: selected ? 0.3 : 0.1,
        depthWrite: false,
        emissive: selected ? color : 0x000000,
        emissiveIntensity: selected ? 0.4 : 0,
      }),
    );
    fill.position.copy(boxCenter);
    fill.userData.segmentId = segment.id;
    group.add(fill);

    const helper = new T.Box3Helper(box, new T.Color(color));
    helper.raycast = () => undefined;
    group.add(helper);
    return group;
  }

  function updateSegments() {
    clearGroup(segmentGroup);
    const segments = hooks.getSegments();
    const visibleIds = hooks.getVisibleSegmentIds();
    const visibleSet = visibleIds == null ? null : new Set(visibleIds);
    const selectedId = hooks.getSelectedSegmentId() ?? null;
    for (const segment of segments) {
      if (visibleSet && !visibleSet.has(segment.id)) continue;
      const selected = segment.id === selectedId;
      const color = SEGMENT_COLORS[segment.kind];
      let object: THREE.Object3D | null = null;
      if (segment.kind === "pipe-run") object = buildPipeOverlay(segment, selected, color);
      else if (segment.kind === "plane") object = buildPlaneOverlay(segment, selected, color);
      else object = buildClusterOverlay(segment, selected, color);
      if (object) segmentGroup.add(object);
    }
  }

  /* ── Persisted measurements ── */

  function updateMeasurements() {
    clearGroup(measurementGroup);
    for (const measurement of hooks.getMeasurements()) {
      if (!measurement.visible || measurement.points.length === 0) continue;
      const color = new T.Color(measurement.color || "#f97316");
      const group = new T.Group();
      group.userData.measurementId = measurement.id;
      const vertices = measurement.points.map((p) => new T.Vector3(p.x, p.y, p.z));

      if (measurement.type === "count") {
        const material = new T.MeshBasicMaterial({ color });
        for (const vertex of vertices) {
          const marker = new T.Mesh(sharedCountGeometry, material);
          marker.position.copy(vertex);
          group.add(marker);
        }
        measurementGroup.add(group);
        continue;
      }

      const markerMaterial = new T.MeshBasicMaterial({ color });
      for (const vertex of vertices) {
        const marker = new T.Mesh(sharedMarkerGeometry, markerMaterial);
        marker.position.copy(vertex);
        group.add(marker);
      }

      if (vertices.length >= 2) {
        const lineGeometry = new T.BufferGeometry().setFromPoints(vertices);
        const lineMaterial = new T.LineBasicMaterial({ color });
        const line =
          measurement.type === "area-polygon"
            ? new T.LineLoop(lineGeometry, lineMaterial)
            : new T.Line(lineGeometry, lineMaterial);
        line.raycast = () => undefined;
        group.add(line);
      }

      if (measurement.type === "area-polygon" && vertices.length >= 3) {
        // Translucent triangle fan around the vertex centroid.
        const fanCenter = vertices
          .reduce((sum, vertex) => sum.add(vertex), new T.Vector3())
          .divideScalar(vertices.length);
        const positions: number[] = [];
        for (let i = 0; i < vertices.length; i += 1) {
          const a = vertices[i];
          const b = vertices[(i + 1) % vertices.length];
          positions.push(fanCenter.x, fanCenter.y, fanCenter.z, a.x, a.y, a.z, b.x, b.y, b.z);
        }
        const fillGeometry = new T.BufferGeometry();
        fillGeometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
        fillGeometry.computeVertexNormals();
        const fill = new T.Mesh(
          fillGeometry,
          new T.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.15,
            depthWrite: false,
            side: T.DoubleSide,
          }),
        );
        fill.raycast = () => undefined;
        group.add(fill);
      }

      measurementGroup.add(group);
    }
  }

  /* ── Render loop / resize / dispose ── */

  let animationFrame = 0;
  function animate() {
    animationFrame = requestAnimationFrame(animate);
    if (pendingHover) {
      const event = pendingHover;
      pendingHover = null;
      const tool = hooks.getTool();
      if (tool !== "orbit") {
        hoverPoint = pickScanPoint(event);
        refreshDraft();
      }
    }
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  const resizeObserver = new ResizeObserver(() => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width > 0 && height > 0) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    }
  });
  resizeObserver.observe(container);

  const api: PointCloudViewerApi = {
    fitToContent,
    setPointSize: (size: number) => {
      pointsMaterial.size = Math.max(size, 0.0001);
      pointsMaterial.needsUpdate = true;
    },
    focusSegment,
  };

  return {
    api,
    stream,
    resetDraft,
    updateSegments,
    updateMeasurements,
    setPointSize: api.setPointSize,
    dispose: () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("dblclick", onDoubleClick);
      window.removeEventListener("keydown", onKeyDown);
      clearGroup(draftGroup);
      clearGroup(measurementGroup);
      clearGroup(segmentGroup);
      sharedMarkerGeometry.dispose();
      sharedCountGeometry.dispose();
      draftMarkerMaterial.dispose();
      draftLineMaterial.dispose();
      hoverMarkerMaterial.dispose();
      pointsGeometry.dispose();
      pointsMaterial.dispose();
      axes.geometry.dispose();
      axesMaterial.dispose();
      controls.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}

/* ─── Component ─── */

type ViewerState = "loading" | "ready" | "error";

export function PointCloudViewer({
  cloud,
  segments,
  visibleSegmentIds,
  selectedSegmentId,
  onSelectSegment,
  tool,
  onMeasurement,
  measurements,
  pointSize = DEFAULT_POINT_SIZE,
  onReady,
  onLoadProgress,
  className,
}: PointCloudViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ViewerHandle | null>(null);
  const [state, setState] = useState<ViewerState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [progressPct, setProgressPct] = useState<number | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  // Latest-prop refs so viewer event handlers never see stale values. This
  // effect has no deps, so it runs before the reactive effects below on every
  // commit (definition order).
  const latest = useRef({
    cloud,
    tool,
    segments: segments ?? [],
    visibleSegmentIds,
    selectedSegmentId,
    measurements: measurements ?? [],
    pointSize,
    onSelectSegment,
    onMeasurement,
    onReady,
    onLoadProgress,
  });
  useEffect(() => {
    latest.current = {
      cloud,
      tool,
      segments: segments ?? [],
      visibleSegmentIds,
      selectedSegmentId,
      measurements: measurements ?? [],
      pointSize,
      onSelectSegment,
      onMeasurement,
      onReady,
      onLoadProgress,
    };
  });

  const setReadout = useCallback((text: string | null, clientX: number, clientY: number) => {
    const element = readoutRef.current;
    const container = containerRef.current;
    if (!element || !container) return;
    if (!text) {
      element.style.display = "none";
      return;
    }
    const rect = container.getBoundingClientRect();
    element.style.display = "block";
    element.style.left = `${Math.round(clientX - rect.left + 14)}px`;
    element.style.top = `${Math.round(clientY - rect.top + 14)}px`;
    element.textContent = text;
  }, []);

  const hooksRef = useRef<ViewerHooks | null>(null);
  if (!hooksRef.current) {
    hooksRef.current = {
      getTool: () => latest.current.tool,
      getSegments: () => latest.current.segments,
      getVisibleSegmentIds: () => latest.current.visibleSegmentIds,
      getSelectedSegmentId: () => latest.current.selectedSegmentId,
      getMeasurements: () => latest.current.measurements,
      onSelectSegment: (id) => latest.current.onSelectSegment?.(id),
      onMeasurement: (draft) => latest.current.onMeasurement?.(draft),
      onLoadProgress: () => undefined, // replaced below (needs setState in scope)
      setReadout,
    };
  }
  hooksRef.current.onLoadProgress = useCallback((loaded: number, total: number) => {
    latest.current.onLoadProgress?.(loaded, total);
    const pct = total > 0 ? Math.min(100, Math.floor((loaded / total) * 100)) : 100;
    setProgressPct((previous) => (previous === pct ? previous : pct));
  }, []);

  /* Scene lifecycle — rebuilt when the point stream changes. */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let viewer: ViewerHandle | null = null;
    const abortController = new AbortController();
    setState("loading");
    setErrorMessage("");
    setProgressPct(null);

    (async () => {
      try {
        viewer = await createPointCloudViewer(
          container,
          latest.current.cloud,
          hooksRef.current as ViewerHooks,
          abortController.signal,
        );
        if (cancelled) {
          viewer.dispose();
          viewer = null;
          return;
        }
        viewerRef.current = viewer;
        viewer.setPointSize(latest.current.pointSize);
        viewer.updateSegments();
        viewer.updateMeasurements();
        setState("ready");
        latest.current.onReady?.(viewer.api);
        await viewer.stream();
      } catch (error) {
        const aborted =
          cancelled ||
          abortController.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError");
        if (!aborted) {
          setErrorMessage(error instanceof Error ? error.message : "Failed to load the point cloud.");
          setState("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      abortController.abort();
      viewerRef.current = null;
      viewer?.dispose();
      viewer = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud.pointsUrl, cloud.pointCount, retryNonce]);

  /* Reactive prop → viewer updates. */
  useEffect(() => {
    viewerRef.current?.resetDraft();
  }, [tool]);

  useEffect(() => {
    viewerRef.current?.updateSegments();
  }, [segments, visibleSegmentIds, selectedSegmentId]);

  useEffect(() => {
    viewerRef.current?.updateMeasurements();
  }, [measurements]);

  useEffect(() => {
    viewerRef.current?.setPointSize(pointSize);
  }, [pointSize]);

  const measuring = tool !== "orbit";
  const streaming = state === "ready" && progressPct !== null && progressPct < 100;

  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-[#1a1a2e]", className)}>
      <div
        ref={containerRef}
        className={cn("h-full w-full", measuring ? "cursor-crosshair" : "cursor-grab")}
      />

      {/* Floating measurement readout (imperatively positioned near the cursor). */}
      <div
        ref={readoutRef}
        style={{ display: "none" }}
        className="pointer-events-none absolute z-20 rounded border border-zinc-700 bg-zinc-900/85 px-2 py-1 text-[11px] font-medium text-zinc-100"
      />

      {state === "loading" && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#1a1a2e] text-zinc-400">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
          <p className="text-sm font-medium">Preparing point cloud…</p>
        </div>
      )}

      {state === "error" && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-[#1a1a2e] text-zinc-400">
          <div className="flex max-w-md flex-col items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-8">
            <AlertCircle className="h-10 w-10 text-red-400/60" />
            <div className="text-center">
              <p className="text-sm font-medium text-zinc-300">Failed to load the point cloud</p>
              <p className="mt-1 text-xs text-zinc-500">{errorMessage}</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setRetryNonce((value) => value + 1)}>
              <RotateCcw className="mr-2 h-3.5 w-3.5" />
              Retry
            </Button>
          </div>
        </div>
      )}

      {streaming && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/80 px-2.5 py-1.5 backdrop-blur-sm">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />
          <span className="text-[11px] font-medium text-zinc-300">
            Streaming points… {progressPct}%
          </span>
        </div>
      )}

      {state === "ready" && measuring && (
        <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-md border border-zinc-800 bg-zinc-900/70 px-3 py-1.5 backdrop-blur-sm">
          <p className="text-[11px] text-zinc-500">
            {tool === "count"
              ? "Click a point to add a count marker"
              : tool === "measure-line"
                ? "Click two points to measure"
                : "Click to add vertices · Double-click or Enter to finish · Esc to cancel"}
          </p>
        </div>
      )}
    </div>
  );
}
