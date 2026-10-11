import type { PrismaApiStore } from "../prisma-store.js";
import { runPdfTakeoff } from "@bidwright/vision";
import { resolveApiPath } from "../paths.js";
import {
  measureGeometry,
  selectCalibration,
  viewToPdf,
  type Box,
  type CalibrationCache,
  type Point,
} from "./pdf-takeoff-geometry.js";

export type PdfSource = {
  documentId?: string;
  pageNumber?: number;
  viewId?: string;
  coordinateSpace?: "view-normalized" | "pdf-points";
};
export type MeasureInput = PdfSource & {
  type: "linear" | "polyline" | "area" | "count";
  points: Point[];
  snap?: boolean;
  tolerance?: number;
  canvas?: { width: number; height: number };
};
type Store = Pick<
  PrismaApiStore,
  | "getDocument"
  | "getFileNode"
  | "getWorkspaceState"
  | "updateTakeoffCalibrationKeys"
  | "createPickup"
  | "updatePickup"
  | "listPickups"
  | "createPickupLink"
>;
const annotationTypes = {
  linear: "linear",
  polyline: "linear-polyline",
  area: "area-polygon",
  count: "count",
};

export class PdfTakeoffService {
  constructor(
    readonly store: Store,
    readonly getView: (projectId: string, id: string) => Promise<any>,
    readonly engine = runPdfTakeoff,
  ) {}

  async resolve(projectId: string, input: PdfSource) {
    const view = input.viewId
      ? await this.getView(projectId, input.viewId)
      : null;
    if (input.viewId && (!view || view.projectId !== projectId))
      throw new Error("View not found in project");
    if (view && input.pageNumber && input.pageNumber !== view.pageNumber)
      throw new Error("View belongs to a different page");
    let documentId =
      input.documentId ??
      (view?.fileNodeId ? `file-${view.fileNodeId}` : view?.documentId);
    const pageNumber = view?.pageNumber ?? input.pageNumber ?? 1;
    if (!documentId) throw new Error("documentId or viewId is required");
    let doc: {
      id: string;
      storagePath?: string | null;
      checksum?: string;
      source?: string;
      fileName?: string;
    } | null = documentId.startsWith("file-")
      ? null
      : await this.store.getDocument(projectId, documentId);
    let nodeId: string | undefined;
    if (!doc && this.store.getFileNode) {
      const node = await this.store.getFileNode(
        documentId.replace(/^file-/, ""),
      );
      if (node?.projectId === projectId && node.type !== "directory") {
        nodeId = node.id;
        documentId = `file-${node.id}`;
        const linked = node.documentId
          ? await this.store.getDocument(projectId, node.documentId)
          : null;
        doc = linked ?? {
          id: node.id,
          storagePath: node.storagePath,
          fileName: node.name,
          source: "file_node",
        };
      }
    }
    if (
      view &&
      (view.fileNodeId
        ? view.fileNodeId !== nodeId
        : view.documentId !== doc?.id)
    )
      throw new Error("View belongs to a different document");
    if (!doc?.storagePath)
      throw new Error("Document not found in project or has no PDF");
    const pdfPath = resolveApiPath(doc.storagePath);
    return {
      doc,
      documentId: String(documentId),
      pageNumber: Number(pageNumber),
      pdfPath,
      view,
    };
  }

  async context(
    projectId: string,
    input: PdfSource,
    operation: Record<string, unknown> = { operation: "info" },
  ) {
    const source = await this.resolve(projectId, input);
    const result = await this.engine({
      ...operation,
      pdfPath: source.pdfPath,
      pageNumber: source.pageNumber,
      view: source.view,
      coordinateSpace:
        input.coordinateSpace ??
        (input.viewId ? "view-normalized" : "pdf-points"),
    });
    return {
      ...source,
      page: result.page as { width: number; height: number },
      facts: result.facts ?? [],
      geometry: result,
    };
  }

  points(
    input: PdfSource,
    ctx: Awaited<ReturnType<PdfTakeoffService["context"]>>,
    points: Point[],
  ) {
    const space =
      input.coordinateSpace ??
      (input.viewId ? "view-normalized" : "pdf-points");
    if (space === "view-normalized" && !ctx.view)
      throw new Error("view-normalized coordinates require viewId");
    if (space === "view-normalized" && ctx.view && ctx.view.rotation % 90 !== 0)
      throw new Error(
        "Coordinate conversion supports orthogonal EvidenceView rotations; use PDF points with documentId for this view",
      );
    // Legacy render-page views store image-pixel bboxes; native page-reader views store normalized bboxes.
    let bbox = ctx.view?.bbox as
      | (Box & { imageWidth?: number; imageHeight?: number })
      | null;
    if (bbox?.imageWidth && bbox.imageHeight)
      bbox = {
        x: bbox.x / bbox.imageWidth,
        y: bbox.y / bbox.imageHeight,
        width: bbox.width / bbox.imageWidth,
        height: bbox.height / bbox.imageHeight,
      };
    const result =
      space === "pdf-points"
        ? points
        : points.map((p) =>
            viewToPdf(
              p,
              ctx.page.width,
              ctx.page.height,
              ctx.view.rotation,
              bbox,
            ),
          );
    if (
      result.some(
        (p) =>
          !Number.isFinite(p.x) ||
          !Number.isFinite(p.y) ||
          p.x < -0.001 ||
          p.y < -0.001 ||
          p.x > ctx.page.width + 0.001 ||
          p.y > ctx.page.height + 0.001,
      )
    )
      throw new Error("Coordinates outside PDF page");
    return result;
  }

  async calibrations(projectId: string, documentId: string) {
    const state = (await this.store.getWorkspaceState(projectId))?.state ?? {};
    const all = (state.takeoffCalibrations ?? {}) as Record<
      string,
      CalibrationCache
    >;
    return { all, cache: all[documentId] ?? {} };
  }

  async getCalibration(projectId: string, input: PdfSource) {
    const ctx = await this.context(projectId, input);
    const { cache } = await this.calibrations(projectId, ctx.documentId);
    return {
      documentId: ctx.documentId,
      pageNumber: ctx.pageNumber,
      coordinateSpace: "pdf-points",
      calibrations: Object.fromEntries(
        Object.entries(cache).filter(
          ([k, c]) =>
            k === "__default" ||
            k === String(ctx.pageNumber) ||
            c.pageNumber === ctx.pageNumber,
        ),
      ),
    };
  }

  async setCalibration(
    projectId: string,
    input: PdfSource & {
      points: Point[];
      knownDistance: number;
      unit: string;
      source: string;
      region?: Box;
      regionId?: string;
      replaceHuman?: boolean;
    },
  ) {
    const ctx = await this.context(projectId, input);
    const points = this.points(input, ctx, input.points);
    const pixelsPerUnit =
      Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) /
      input.knownDistance;
    if (!(pixelsPerUnit > 0) || !Number.isFinite(pixelsPerUnit))
      throw new Error(
        "Calibration needs distinct points and a positive known distance",
      );
    let region: Box | undefined;
    if (input.region) {
      const b = input.region;
      const corners = this.points(input, ctx, [
        { x: b.x, y: b.y },
        { x: b.x + b.width, y: b.y },
        { x: b.x + b.width, y: b.y + b.height },
        { x: b.x, y: b.y + b.height },
      ]);
      const x = Math.min(...corners.map((p) => p.x)),
        y = Math.min(...corners.map((p) => p.y));
      region = {
        x,
        y,
        width: Math.max(...corners.map((p) => p.x)) - x,
        height: Math.max(...corners.map((p) => p.y)) - y,
      };
    }
    const key = region
      ? `region:${ctx.pageNumber}:${input.regionId ?? [region.x, region.y, region.width, region.height].map((n) => n.toFixed(3)).join(",")}`
      : String(ctx.pageNumber);
    const calibration = {
      pixelsPerUnit,
      unit: input.unit,
      measuredBy: "agent",
      source: input.source,
      pageNumber: ctx.pageNumber,
      ...(region ? { region } : {}),
      points,
      knownDistance: input.knownDistance,
      viewId: input.viewId ?? null,
      updatedAt: new Date().toISOString(),
    };
    await this.store.updateTakeoffCalibrationKeys(
      projectId,
      ctx.documentId,
      [{ key, calibration }],
      { agent: true, replaceHuman: input.replaceHuman },
    );
    return { calibrationKey: key, calibration };
  }

  async measure(projectId: string, input: MeasureInput) {
    const ctx = await this.context(projectId, input, {
      operation: input.snap ? "snap" : "info",
      points: input.points,
      canvas: input.canvas,
      tolerance: input.tolerance ?? 3,
    });
    const points = ctx.geometry.points as Point[];
    const snapped = input.snap ? ctx.geometry : null;
    const { cache } = await this.calibrations(projectId, ctx.documentId);
    const selected = selectCalibration(cache, ctx.pageNumber, points);
    return {
      documentId: ctx.documentId,
      pageNumber: ctx.pageNumber,
      type: input.type,
      annotationType: annotationTypes[input.type],
      coordinateSpace: "pdf-points",
      points,
      measurement: measureGeometry(input.type, points, selected.calibration),
      ...selected,
      facts: [...selected.facts, ...ctx.facts, ...(snapped?.facts ?? [])],
      snaps: snapped?.snaps,
      unsnappedVertices: snapped?.unsnappedVertices,
      page: ctx.page,
      viewId: input.viewId ?? null,
      sourceChecksum: ctx.doc.checksum ?? null,
    };
  }

  async save(
    projectId: string,
    input: MeasureInput & {
      label?: string;
      color?: string;
      comparisonGroup?: string;
      linkToItemId?: string;
      quantityField?: string;
      multiplier?: number;
    },
  ) {
    const result = await this.measure(projectId, input);
    const pickup = await this.store.createPickup(projectId, {
      documentId: result.documentId,
      pageNumber: result.pageNumber,
      annotationType: result.annotationType,
      points: result.points,
      measurement: result.measurement,
      calibration: result.calibration,
      label: input.label ?? "",
      color: input.color ?? "#0ea5e9",
      groupName: input.comparisonGroup ?? "",
      metadata: {
        measuredBy: "agent",
        source: "pdf-takeoff",
        coordinateSpace: "pdf-points",
        viewId: result.viewId,
        sourceChecksum: result.sourceChecksum,
        calibrationKey: result.calibrationKey,
        comparisonGroup: input.comparisonGroup,
        canvasWidth: result.page.width,
        canvasHeight: result.page.height,
        pdfPageWidth: result.page.width,
        pdfPageHeight: result.page.height,
      },
    });
    // Link validation and derived quantity use the same service as Takeoff Studio.
    // Return a saved pickup even if the explicit link fails, so retries need not duplicate it.
    if (input.linkToItemId) {
      if (
        result.measurement.unit === "px" ||
        result.measurement.unit === "px²"
      ) {
        return {
          pickup,
          link: null,
          linkError:
            "Pixel measurements have no physical-unit conversion; pickup saved without a worksheet link",
          facts: result.facts,
        };
      }
      try {
        const link = await this.store.createPickupLink(projectId, {
          pickupId: pickup.id,
          worksheetItemId: input.linkToItemId,
          quantityField: input.quantityField ?? "value",
          multiplier: input.multiplier ?? 1,
        });
        return { pickup, link, facts: result.facts };
      } catch (error) {
        return {
          pickup,
          link: null,
          linkError: error instanceof Error ? error.message : String(error),
          facts: result.facts,
        };
      }
    }
    return { pickup, link: null, facts: result.facts };
  }

  async update(
    projectId: string,
    input: {
      pickupId: string;
      points?: Point[];
      viewId?: string;
      coordinateSpace?: "view-normalized" | "pdf-points";
      label?: string;
      color?: string;
      editHuman?: boolean;
      snap?: boolean;
      tolerance?: number;
    },
  ) {
    const pickup = (await this.store.listPickups(projectId)).find(
      (p) => p.id === input.pickupId,
    );
    if (!pickup) throw new Error("Pickup not found in project");
    const expectedUpdatedAt = pickup.updatedAt;
    const metadata = pickup.metadata as Record<string, unknown>;
    if (
      (metadata.measuredBy !== "agent" || metadata.lastEditedBy === "person") &&
      !input.editHuman
    )
      throw new Error("Human pickup exists; use editHuman:true to edit it");
    const type = Object.entries(annotationTypes).find(
      ([, t]) => t === pickup.annotationType,
    )?.[0] as MeasureInput["type"] | undefined;
    if (!type)
      throw new Error(
        "Pickup annotation type is not supported by PDF measurement",
      );
    const points = input.points ?? pickup.points;
    const result = await this.measure(projectId, {
      documentId: pickup.documentId,
      pageNumber: pickup.pageNumber,
      type,
      points,
      viewId: input.points ? input.viewId : undefined,
      coordinateSpace: input.points ? input.coordinateSpace : "pdf-points",
      snap: input.snap,
      tolerance: input.tolerance,
      canvas:
        !input.points &&
        Number(metadata.canvasWidth) > 0 &&
        Number(metadata.canvasHeight) > 0
          ? {
              width: Number(metadata.canvasWidth),
              height: Number(metadata.canvasHeight),
            }
          : undefined,
    });
    const updated = await this.store.updatePickup(
      pickup.id,
      {
        points: result.points,
        measurement: result.measurement,
        calibration: result.calibration,
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        metadata: {
          ...metadata,
          lastEditedBy: "agent",
          calibrationKey: result.calibrationKey,
          sourceChecksum: result.sourceChecksum,
          viewId: result.viewId,
          canvasWidth: result.page.width,
          canvasHeight: result.page.height,
          pdfPageWidth: result.page.width,
          pdfPageHeight: result.page.height,
        },
      },
      expectedUpdatedAt,
    );
    return { pickup: updated, facts: result.facts };
  }

  async trace(
    projectId: string,
    input: PdfSource & {
      seed: Point;
      tolerance?: number;
      maxSegments?: number;
    },
  ) {
    const ctx = await this.context(projectId, input, {
      operation: "trace",
      seed: input.seed,
      tolerance: input.tolerance ?? 3,
      maxSegments: input.maxSegments ?? 1000,
    });
    const result = ctx.geometry;
    const { cache } = await this.calibrations(projectId, ctx.documentId);
    const paths = (result.paths as Point[][]).map((points) => {
      const selected = selectCalibration(cache, ctx.pageNumber, points);
      return {
        points,
        ...selected,
        measurement: measureGeometry("polyline", points, selected.calibration),
      };
    });
    const units = [...new Set(paths.map((p) => p.measurement.unit))];
    return {
      ...result,
      documentId: ctx.documentId,
      pageNumber: ctx.pageNumber,
      paths,
      totalLength:
        units.length === 1
          ? paths.reduce((n, p) => n + p.measurement.value, 0)
          : null,
      unit: units.length === 1 ? units[0] : null,
    };
  }
}
