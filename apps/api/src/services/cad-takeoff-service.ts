import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { cadPolylineLength, cadSignedPolylineArea } from "@bidwright/domain";
import type { DwgEntityMetadata, ParsedDrawing } from "./dwg-processing-service.js";

export type CadBounds = { minX: number; minY: number; maxX: number; maxY: number };
export type CadQuery = { layers?: string[]; blockName?: string; entityTypes?: string[]; layout?: string; bounds?: CadBounds; groupBy?: "layer" | "block" | "type" | "attributes"; offset?: number; limit?: number; groupOffset?: number; groupLimit?: number };

export function cadEntityMetrics(entity: DwgEntityMetadata) {
  let length: number | null = null, area: number | null = null;
  const facts: string[] = [];
  if (entity.raw.nonUniformTransform) facts.push("Non-uniform block transform: curved metrics unavailable");
  if (entity.type === "LINE" && entity.start && entity.end) length = Math.hypot(entity.end.x - entity.start.x, entity.end.y - entity.start.y);
  if (["LWPOLYLINE", "POLYLINE"].includes(entity.type) && entity.vertices) {
    if (!entity.raw.nonUniformTransform || !entity.vertices.some((v) => v.bulge)) {
      length = cadPolylineLength(entity.vertices, entity.closed);
      if (entity.closed) area = Math.abs(cadSignedPolylineArea(entity.vertices, true));
    }
  }
  if (!entity.raw.nonUniformTransform && entity.radius != null) {
    if (entity.type === "CIRCLE") { length = 2 * Math.PI * entity.radius; area = Math.PI * entity.radius ** 2; }
    if (entity.type === "ARC") {
      const sweep = ((Number(entity.raw.endAngle) - Number(entity.raw.startAngle)) % 360 + 360) % 360;
      length = entity.radius * sweep * Math.PI / 180;
    }
  }
  if (length == null && !["INSERT", "TEXT", "MTEXT", "POINT"].includes(entity.type)) facts.push("Length not extracted for this geometry");
  return { length, area, facts };
}

export function selectCadEntities(drawing: ParsedDrawing, query: CadQuery) {
  return drawing.entities.filter((entity) => {
    if (entity.layoutName !== (query.layout ?? "Model")) return false;
    if (query.layers && !query.layers.includes(entity.layer)) return false;
    if (query.entityTypes && !query.entityTypes.includes(entity.type)) return false;
    if (query.blockName && entity.raw.blockName !== query.blockName) return false;
    const b = query.bounds, e = entity.bounds;
    return !b || (e.maxX >= b.minX && e.minX <= b.maxX && e.maxY >= b.minY && e.minY <= b.maxY);
  });
}

export function queryCadDrawing(drawing: ParsedDrawing, query: CadQuery) {
  const factor = drawing.unitScaleFactor || 1;
  const rows = selectCadEntities(drawing, query).map((entity) => {
    const metrics = cadEntityMetrics(entity);
    return { handle: entity.id, nativeHandle: entity.raw.handle, type: entity.type, layer: entity.layer, layout: entity.layoutName,
      blockName: entity.raw.blockName, insertCount: entity.type === "INSERT" ? Number(entity.raw.insertCount ?? 1) : 0, attributes: entity.raw.attributes, text: entity.text,
      bounds: Object.fromEntries(Object.entries(entity.bounds).map(([k, v]) => [k, v / factor])),
      length: metrics.length == null ? null : metrics.length / factor,
      area: metrics.area == null ? null : metrics.area / factor ** 2, facts: metrics.facts };
  });
  const groups = new Map<string, { key: string; count: number; insertCount: number; length: number; area: number; lengthCount: number; areaCount: number }>();
  for (const row of rows) {
    const key = String(query.groupBy === "attributes" ? JSON.stringify([row.blockName, Object.entries((row.attributes ?? {}) as object).sort(([a], [b]) => a.localeCompare(b))]) : query.groupBy === "block" ? row.blockName ?? "(not INSERT)" : query.groupBy === "type" ? row.type : row.layer);
    const group = groups.get(key) ?? { key, count: 0, insertCount: 0, length: 0, area: 0, lengthCount: 0, areaCount: 0 };
    group.count++; if (row.type === "INSERT") group.insertCount += row.insertCount;
    if (row.length != null) { group.length += row.length; group.lengthCount++; }
    if (row.area != null) { group.area += row.area; group.areaCount++; }
    groups.set(key, group);
  }
  const offset = query.offset ?? 0, limit = query.limit ?? 100;
  const groupOffset = query.groupOffset ?? 0, groupLimit = query.groupLimit ?? 100;
  return { coordinateSpace: "native drawing units, x right, y up", units: drawing.originalUnits, areaUnits: `${drawing.originalUnits}^2`,
    unitFacts: { insunits: drawing.originalUnits, canonicalUnits: drawing.units, canonicalUnitsPerDrawingUnit: factor },
    total: rows.length, offset, limit, hasMore: offset + limit < rows.length, entities: rows.slice(offset, offset + limit),
    groupCount: groups.size, groupOffset, groupLimit, groupsHasMore: groupOffset + groupLimit < groups.size,
    groups: [...groups.values()].slice(groupOffset, groupOffset + groupLimit),
    facts: drawing.originalUnits === "unitless" ? ["Drawing units unknown ($INSUNITS missing or unitless)"] : [] };
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function cadDrawingSvg(drawing: ParsedDrawing, query: CadQuery) {
  const entities = selectCadEntities(drawing, query);
  const b = query.bounds ?? drawing.layouts.find((l) => l.name === (query.layout ?? "Model"))?.bounds ?? drawing.extents;
  const width = 1400, height = 1000, pad = 24;
  const scale = Math.min((width - 2 * pad) / Math.max(1e-9, b.maxX - b.minX), (height - 2 * pad) / Math.max(1e-9, b.maxY - b.minY));
  const originX = b.minX - pad / scale, originY = b.maxY + pad / scale;
  const point = (p: { x: number; y: number }) => `${(p.x - originX) * scale},${(originY - p.y) * scale}`;
  const body = entities.map((e) => {
    const color = xml(e.color);
    if (e.text && e.start) return `<text x="${(e.start.x - originX) * scale}" y="${(originY - e.start.y) * scale}" fill="${color}" font-size="12">${xml(e.text)}</text>`;
    if (e.start && e.end) return `<polyline points="${point(e.start)} ${point(e.end)}" stroke="${color}"/>`;
    if (e.vertices?.length) {
      const verts = e.vertices, segments = e.closed ? verts.length : verts.length - 1;
      let d = `M ${point(verts[0])}`;
      for (let i = 0; i < segments; i++) {
        const a = verts[i], next = verts[(i + 1) % verts.length], bulge = a.bulge ?? 0;
        if (bulge) {
          const radius = Math.hypot(next.x - a.x, next.y - a.y) * (1 + bulge * bulge) / (4 * Math.abs(bulge)) * scale;
          d += ` A ${radius} ${radius} 0 ${Math.abs(bulge) > 1 ? 1 : 0} ${bulge > 0 ? 0 : 1} ${point(next)}`;
        } else d += ` L ${point(next)}`;
      }
      return `<path d="${d}" stroke="${color}"/>`;
    }
    if (e.center && e.radius) {
      if (e.type === "ARC") {
        const start = Number(e.raw.startAngle) * Math.PI / 180;
        const sweep = ((Number(e.raw.endAngle) - Number(e.raw.startAngle)) % 360 + 360) % 360 * Math.PI / 180;
        const points = Array.from({ length: 97 }, (_, i) => point({ x: e.center!.x + e.radius! * Math.cos(start + sweep * i / 96), y: e.center!.y + e.radius! * Math.sin(start + sweep * i / 96) }));
        return `<polyline points="${points.join(" ")}" stroke="${color}"/>`;
      }
      if (e.type === "CIRCLE") return `<circle cx="${(e.center.x - originX) * scale}" cy="${(originY - e.center.y) * scale}" r="${e.radius * scale}" stroke="${color}"/>`;
    }
    return "";
  }).join("");
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#101522"/><g fill="none" stroke-width="1">${body}</g></svg>`,
    width, height, entityCount: entities.length,
    transform: { originX, originY, xPerNormalized: width / scale, yPerNormalized: -height / scale },
    facts: ["Lines, arcs, circles, polylines and text rendered; other entity geometry may be absent."] };
}

export async function renderCadPng(svg: string) {
  const dir = await mkdtemp(join(tmpdir(), "cad-render-"));
  try {
    const input = join(dir, "drawing.svg"), output = join(dir, "drawing.png");
    await writeFile(input, svg);
    let python = process.env.PYTHON_PATH;
    if (!python) { try { await access("/opt/vision-venv/bin/python"); python = "/opt/vision-venv/bin/python"; } catch { python = "python3"; } }
    await promisify(execFile)(python, ["-c", "import pymupdf,sys; s=pymupdf.open(sys.argv[1]); d=pymupdf.open('pdf',s.convert_to_pdf()); d[0].get_pixmap(matrix=pymupdf.Matrix(1,1)).save(sys.argv[2])", input, output], { timeout: 30_000, maxBuffer: 1024 * 1024 });
    return (await readFile(output)).toString("base64");
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export function prepareCadEntityTakeoff(drawing: ParsedDrawing & { sourceHash: string }, input: {
  handles: string[]; measurement: "count" | "length" | "area"; sourceKind: "source_document" | "file_node";
}) {
  const byId = new Map(drawing.entities.map((entity) => [entity.id, entity]));
  return [...new Set(input.handles)].map((id) => {
    const entity = byId.get(id);
    if (!entity) throw new Error(`CAD handle ${id} not found in source`);
    const metrics = cadEntityMetrics(entity);
    const quantity = input.measurement === "count" ? Number(entity.raw.insertCount ?? 1) : metrics[input.measurement];
    if (quantity == null || !Number.isFinite(quantity)) throw new Error(`${input.measurement} unavailable for handle ${id}`);
    return { entityId: id, entityType: entity.type, layer: entity.layer, quantity,
      unit: input.measurement === "count" ? "EA" : input.measurement === "area" ? `${drawing.units}^2` : drawing.units,
      measurementType: input.measurement, selection: { ...entity, sourceKind: input.sourceKind, sourceHash: drawing.sourceHash, coordinateSpace: "canonical drawing units", units: drawing.units } };
  });
}
