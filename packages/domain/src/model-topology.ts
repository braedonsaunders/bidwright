/**
 * Deterministic model topology and estimating-rollup engine.
 *
 * The engine deliberately does not use an LLM. Physical relationships must be
 * reproducible and auditable: authoritative source-system metadata wins,
 * explicit connector references come next, and geometry proximity is used only
 * when compatible element semantics make the inference safe.
 */

export type ModelTopologyGroupKind = "system" | "network" | "run" | "estimate";
export type ModelTopologyConnectionSource = "explicit" | "geometry";
export type ModelTopologyEstimateAxis = "trade" | "role" | "specification" | "material" | "size" | "system" | "level" | "elementClass" | "elementType";

export const DEFAULT_MODEL_TOPOLOGY_ESTIMATE_AXES: ModelTopologyEstimateAxis[] = [
  "trade",
  "role",
  "specification",
  "material",
  "size",
];

export interface ModelTopologyQuantityInput {
  id: string;
  elementId?: string | null;
  quantityType: string;
  value: number;
  unit: string;
  method?: string;
  confidence?: number;
}

export interface ModelTopologyElementInput {
  id: string;
  externalId: string;
  name: string;
  elementClass?: string;
  elementType?: string;
  system?: string;
  level?: string;
  material?: string;
  bbox?: unknown;
  properties?: Record<string, unknown>;
  quantities?: ModelTopologyQuantityInput[];
}

export interface ModelTopologyConnectionResult {
  signature: string;
  fromElementId: string;
  toElementId: string;
  kind: "physical" | "reference";
  source: ModelTopologyConnectionSource;
  confidence: number;
  metadata: Record<string, unknown>;
}

export interface ModelTopologyGroupResult {
  signature: string;
  parentSignature: string | null;
  kind: ModelTopologyGroupKind;
  name: string;
  trade: string;
  source: "authored" | "detected" | "inferred";
  confidence: number;
  measurementType: string;
  quantity: number;
  unit: string;
  memberElementIds: string[];
  warnings: string[];
  metadata: Record<string, unknown>;
}

export interface ModelTopologyResult {
  version: 1;
  connections: ModelTopologyConnectionResult[];
  groups: ModelTopologyGroupResult[];
  diagnostics: {
    elementCount: number;
    connectedElementCount: number;
    authoredSystemCount: number;
    inferredConnectionCount: number;
    ungroupedElementCount: number;
  };
}

type Point3 = { x: number; y: number; z: number };

interface SemanticElement extends ModelTopologyElementInput {
  trade: string;
  role: string;
  authoredSystem: string;
  specification: string;
  size: string;
  endpoints: Point3[];
  flatProperties: Array<[string, unknown]>;
  authoredLinearUnit: LinearUnit | null;
  impliedLength: { value: number; unit: LinearUnit } | null;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function signature(kind: string, parts: Array<string | number | null | undefined>) {
  const normalized = parts.map((part) => String(part ?? "").trim().toLowerCase()).join("\u001f");
  return `${kind}:${stableHash(normalized)}`;
}

function display(value: string) {
  return value.trim().replace(/[_:-]+/g, " ").replace(/\s+/g, " ");
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^[-+]?(?:\d+(?:,\d{3})*|\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?/);
  if (!match?.[0]) return null;
  const parsed = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function flattenProperties(value: unknown, prefix = "", depth = 0): Array<[string, unknown]> {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 4) return [];
  const rows: Array<[string, unknown]> = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) {
      const record = child as Record<string, unknown>;
      if ("value" in record) rows.push([path, record.value]);
      else rows.push(...flattenProperties(child, path, depth + 1));
    } else {
      rows.push([path, child]);
    }
  }
  return rows;
}

function propertyValue(rows: Array<[string, unknown]>, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = rows.find(([key, value]) => pattern.test(key) && value != null && String(value).trim());
    if (match) return String(match[1]).trim();
  }
  return "";
}

function coordinateTriples(rows: Array<[string, unknown]>, stem: RegExp): Point3[] {
  const coordinates = new Map<string, Partial<Point3>>();
  for (const [key, value] of rows) {
    if (!stem.test(key)) continue;
    const axisMatch = key.match(/(?:^|[._\s-])(x|y|z)$/i);
    if (!axisMatch) continue;
    const number = finiteNumber(value);
    if (number == null) continue;
    const base = key.slice(0, axisMatch.index).toLowerCase();
    const current = coordinates.get(base) ?? {};
    current[axisMatch[1].toLowerCase() as keyof Point3] = number;
    coordinates.set(base, current);
  }
  return Array.from(coordinates.values())
    .filter((point): point is Point3 => point.x != null && point.y != null && point.z != null)
    .map((point) => ({ x: point.x, y: point.y, z: point.z }));
}

function bboxEndpoints(bbox: unknown, multiPort = false): Point3[] {
  if (!bbox || typeof bbox !== "object") return [];
  const record = bbox as Record<string, unknown>;
  const point = (value: unknown): Point3 | null => {
    if (Array.isArray(value) && value.length >= 3) {
      const [x, y, z] = value.map(finiteNumber);
      return x != null && y != null && z != null ? { x, y, z } : null;
    }
    if (!value || typeof value !== "object") return null;
    const candidate = value as Record<string, unknown>;
    const x = finiteNumber(candidate.x ?? candidate.X ?? candidate[0]);
    const y = finiteNumber(candidate.y ?? candidate.Y ?? candidate[1]);
    const z = finiteNumber(candidate.z ?? candidate.Z ?? candidate[2]);
    return x != null && y != null && z != null ? { x, y, z } : null;
  };
  const min = point(record.min ?? record.minimum ?? record.low ?? [record.minX, record.minY, record.minZ]);
  const max = point(record.max ?? record.maximum ?? record.high ?? [record.maxX, record.maxY, record.maxZ]);
  if (!min || !max) return [];
  const center = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
  if (multiPort) {
    return [
      { ...center, x: min.x }, { ...center, x: max.x },
      { ...center, y: min.y }, { ...center, y: max.y },
      { ...center, z: min.z }, { ...center, z: max.z },
    ];
  }
  const spans = [
    { axis: "x" as const, value: Math.abs(max.x - min.x) },
    { axis: "y" as const, value: Math.abs(max.y - min.y) },
    { axis: "z" as const, value: Math.abs(max.z - min.z) },
  ].sort((left, right) => right.value - left.value);
  const axis = spans[0].axis;
  return [
    { ...center, [axis]: min[axis] },
    { ...center, [axis]: max[axis] },
  ];
}

function classifyTrade(text: string) {
  if (/pipe|piping|plumb|hydronic|sprinkler|process|sanitary|drain/.test(text)) return "piping";
  if (/duct|hvac|air terminal|damper|mechanical air/.test(text)) return "ductwork";
  if (/conduit|cable tray|cable|wire|electrical|lighting|power|circuit/.test(text)) return "electrical";
  if (/beam|column|brace|joist|structural|steel|framing/.test(text)) return "structural";
  if (/wall|drywall|gypsum|ceiling|finish|covering|flooring/.test(text)) return "architectural";
  if (/slab|footing|foundation|concrete|rebar/.test(text)) return "concrete";
  if (/roof|roofing/.test(text)) return "roofing";
  if (/civil|corridor|alignment|road|utility|sewer|storm/.test(text)) return "civil";
  return "general";
}

function classifyRole(text: string) {
  if (/\b(?:tee|cross|junction|wye|manifold)\b|pipejunction/.test(text)) return "junction";
  if (/\b(?:elbow|bend|reducer|coupling|union|flange|fitting|transition|nipple)\b|pipefitting|ductfitting/.test(text)) return "fitting";
  if (/\b(?:valve|damper|switch|disconnect)\b|ifcvalve/.test(text)) return "control";
  if (/\b(?:pump|fan|unit|equipment|panel|transformer|tank|boiler|chiller|fixture)\b|ifc(?:pump|fan|equipment|transformer|tank|boiler|chiller)/.test(text)) return "equipment";
  if (/\b(?:terminal|diffuser|grille|sprinkler head|device|receptacle|outlet)\b|flowterminal/.test(text)) return "terminal";
  if (/\bpipe\b|pipesegment|pipe\s*segment|ductsegment|duct\s*segment|cablesegment|cable\s*segment|flowsegment|\bconduit\b|cable tray|\blinear\b|centerline/.test(text)) return "linear";
  if (/wall|floor|slab|roof|ceiling|surface|covering/.test(text)) return "planar";
  if (/beam|column|brace|member|framing/.test(text)) return "member";
  return "component";
}

function semanticElement(element: ModelTopologyElementInput): SemanticElement {
  const flatProperties = flattenProperties(element.properties ?? {});
  const semanticPropertyText = flatProperties
    .filter(([key]) => /(?:^|\.)(?:class|type|short description|long description|part size long desc)$/i.test(key))
    .map(([, value]) => String(value ?? ""))
    .join(" ");
  const text = [element.name, element.elementClass, element.elementType, element.system, element.material, semanticPropertyText]
    .join(" ").toLowerCase();
  const role = classifyRole(text);
  const authoredSystem = propertyValue(flatProperties, [
    /(?:^|\.)pipe ?line ?number$/i,
    /(?:^|\.)pipeline tag$/i,
    /(?:^|\.)line number tag$/i,
    /(?:^|\.)line number$/i,
    /(?:^|\.)system name$/i,
    /(?:^|\.)mep system$/i,
    /(?:^|\.)circuit number$/i,
    /(?:^|\.)assembly name$/i,
    /(?:^|\.)system$/i,
  ]) || element.system?.trim() || "";
  const specification = propertyValue(flatProperties, [
    /(?:^|\.)spec$/i,
    /(?:^|\.)specification$/i,
    /(?:^|\.)system type$/i,
    /(?:^|\.)schedule$/i,
  ]);
  const size = propertyValue(flatProperties, [
    /(?:^|\.)size$/i,
    /(?:^|\.)nominal diameter$/i,
    /(?:^|\.)diameter$/i,
    /(?:^|\.)width x height$/i,
    /(?:^|\.)profile$/i,
  ]);
  const rawEstimatingMaterial = propertyValue(flatProperties, [
    /(?:^|\.)plant material$/i,
    /(?:^|\.)material code$/i,
    /(?:^|\.)structural material$/i,
  ]) || element.material?.trim() || "";
  // Navisworks' display colour is frequently serialized into Item.Material.
  // It is rendering metadata, never a procurement material.
  const estimatingMaterial = /^(?:autocad color index\s+\d+|bylayer|byblock)$/i.test(rawEstimatingMaterial)
    ? ""
    : rawEstimatingMaterial;
  const explicitEndpoints = coordinateTriples(flatProperties, /start|end|endpoint|port|connector/i);
  return {
    ...element,
    trade: classifyTrade(text),
    role,
    authoredSystem,
    specification,
    size,
    material: estimatingMaterial,
    endpoints: explicitEndpoints.length >= 2
      ? explicitEndpoints.slice(0, 8)
      : bboxEndpoints(element.bbox, ["junction", "fitting", "control", "equipment", "terminal"].includes(role)),
    flatProperties,
    authoredLinearUnit: authoredLinearUnitHint(flatProperties),
    impliedLength: impliedLengthFromWeight(flatProperties),
  };
}

function compatible(left: SemanticElement, right: SemanticElement) {
  if (left.trade !== right.trade) return false;
  if (left.authoredSystem && right.authoredSystem && left.authoredSystem !== right.authoredSystem) return false;
  if (left.specification && right.specification && left.specification !== right.specification) return false;
  if (left.role === "planar" || right.role === "planar") return false;
  return true;
}

function distance(left: Point3, right: Point3) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function toleranceForUnits(units: string) {
  const normalized = units.toLowerCase();
  if (/millimet|\bmm\b/.test(normalized)) return 12;
  if (/centimet|\bcm\b/.test(normalized)) return 1.2;
  if (/inch|\bin\b/.test(normalized)) return 0.5;
  if (/foot|feet|\bft\b/.test(normalized)) return 0.04;
  return 0.012;
}

function connectionKey(leftId: string, rightId: string) {
  return leftId < rightId ? `${leftId}\u001f${rightId}` : `${rightId}\u001f${leftId}`;
}

function explicitConnections(elements: SemanticElement[]) {
  const byExternalId = new Map(elements.filter((element) => element.externalId).map((element) => [element.externalId.toLowerCase(), element]));
  const byId = new Map(elements.map((element) => [element.id.toLowerCase(), element]));
  const results = new Map<string, ModelTopologyConnectionResult>();
  for (const element of elements) {
    for (const [key, rawValue] of element.flatProperties) {
      if (!/(connected|connection|from object|to object|related element)/i.test(key)) continue;
      const candidates = Array.isArray(rawValue) ? rawValue : String(rawValue ?? "").split(/[;,|]/g);
      for (const rawCandidate of candidates) {
        const candidate = String(rawCandidate).trim().toLowerCase();
        const other = byExternalId.get(candidate) ?? byId.get(candidate);
        if (!other || other.id === element.id || !compatible(element, other)) continue;
        const keyValue = connectionKey(element.id, other.id);
        if (results.has(keyValue)) continue;
        const [fromElementId, toElementId] = element.id < other.id ? [element.id, other.id] : [other.id, element.id];
        results.set(keyValue, {
          signature: signature("connection", [fromElementId, toElementId, "explicit"]),
          fromElementId,
          toElementId,
          kind: "reference",
          source: "explicit",
          confidence: 1,
          metadata: { property: key },
        });
      }
    }
  }
  return results;
}

function inferredConnections(elements: SemanticElement[], units: string, existing: Map<string, ModelTopologyConnectionResult>) {
  const tolerance = toleranceForUnits(units);
  const cellSize = tolerance * 1.5;
  const cells = new Map<string, Array<{ element: SemanticElement; point: Point3 }>>();
  const cell = (point: Point3) => `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}:${Math.floor(point.z / cellSize)}`;
  for (const element of elements) {
    if (element.endpoints.length === 0) continue;
    for (const point of element.endpoints) {
      const baseX = Math.floor(point.x / cellSize);
      const baseY = Math.floor(point.y / cellSize);
      const baseZ = Math.floor(point.z / cellSize);
      for (let x = baseX - 1; x <= baseX + 1; x += 1) {
        for (let y = baseY - 1; y <= baseY + 1; y += 1) {
          for (let z = baseZ - 1; z <= baseZ + 1; z += 1) {
            for (const candidate of cells.get(`${x}:${y}:${z}`) ?? []) {
              if (candidate.element.id === element.id || !compatible(element, candidate.element)) continue;
              const gap = distance(point, candidate.point);
              if (gap > tolerance) continue;
              const key = connectionKey(element.id, candidate.element.id);
              if (existing.has(key)) continue;
              const [fromElementId, toElementId] = element.id < candidate.element.id
                ? [element.id, candidate.element.id]
                : [candidate.element.id, element.id];
              existing.set(key, {
                signature: signature("connection", [fromElementId, toElementId, "geometry"]),
                fromElementId,
                toElementId,
                kind: "physical",
                source: "geometry",
                confidence: Math.max(0.6, 0.9 - (gap / Math.max(tolerance, Number.EPSILON)) * 0.25),
                metadata: { gap, tolerance },
              });
            }
          }
        }
      }
      const key = cell(point);
      const bucket = cells.get(key) ?? [];
      bucket.push({ element, point });
      cells.set(key, bucket);
    }
  }
}

function connectedComponents(elementIds: string[], connections: ModelTopologyConnectionResult[]) {
  const adjacency = new Map(elementIds.map((id) => [id, new Set<string>()]));
  for (const connection of connections) {
    adjacency.get(connection.fromElementId)?.add(connection.toElementId);
    adjacency.get(connection.toElementId)?.add(connection.fromElementId);
  }
  const components: string[][] = [];
  const visited = new Set<string>();
  for (const id of elementIds) {
    if (visited.has(id)) continue;
    const members: string[] = [];
    const queue = [id];
    visited.add(id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      members.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    components.push(members.sort());
  }
  return { adjacency, components };
}

function runPaths(component: string[], adjacency: Map<string, Set<string>>, byId: Map<string, SemanticElement>) {
  const componentSet = new Set(component);
  const edges = new Set<string>();
  for (const id of component) {
    for (const neighbor of adjacency.get(id) ?? []) if (componentSet.has(neighbor)) edges.add(connectionKey(id, neighbor));
  }
  if (edges.size === 0) return component.map((id) => [id]);
  const visitedEdges = new Set<string>();
  const paths: string[][] = [];
  const isBoundary = (id: string) => {
    const degree = Array.from(adjacency.get(id) ?? []).filter((candidate) => componentSet.has(candidate)).length;
    const role = byId.get(id)?.role;
    return degree !== 2 || role === "junction" || role === "equipment" || role === "terminal" || role === "control";
  };
  const walk = (start: string, first: string) => {
    const path = [start];
    let previous = start;
    let current = first;
    visitedEdges.add(connectionKey(previous, current));
    while (true) {
      path.push(current);
      if (isBoundary(current)) break;
      const next = Array.from(adjacency.get(current) ?? []).find((candidate) => candidate !== previous && componentSet.has(candidate));
      if (!next || visitedEdges.has(connectionKey(current, next))) break;
      const currentElement = byId.get(current);
      const nextElement = byId.get(next);
      if (currentElement && nextElement && (
        currentElement.specification !== nextElement.specification
        || currentElement.size !== nextElement.size
        || currentElement.material !== nextElement.material
      )) break;
      previous = current;
      current = next;
      visitedEdges.add(connectionKey(previous, current));
    }
    return path;
  };
  for (const start of component.filter(isBoundary)) {
    for (const neighbor of adjacency.get(start) ?? []) {
      if (!componentSet.has(neighbor) || visitedEdges.has(connectionKey(start, neighbor))) continue;
      paths.push(walk(start, neighbor));
    }
  }
  for (const edge of edges) {
    if (visitedEdges.has(edge)) continue;
    const [left, right] = edge.split("\u001f");
    paths.push(walk(left, right));
  }
  return paths.filter((path) => path.length > 0);
}

function normalizedMeasurementType(value: string) {
  const lower = value.toLowerCase();
  if (/length|perimeter|circumference|linear/.test(lower)) return "length";
  if (/area|surface/.test(lower)) return "area";
  if (/volume/.test(lower)) return "volume";
  if (/weight|mass/.test(lower)) return "weight";
  if (/count|quantity/.test(lower)) return "count";
  return "";
}

function compactUnit(units: string, type: string) {
  if (type === "count") return "EA";
  const lower = units.toLowerCase();
  const base = /millimet|\bmm\b/.test(lower) ? "mm"
    : /centimet|\bcm\b/.test(lower) ? "cm"
      : /inch|\bin\b/.test(lower) ? "in"
        : /foot|feet|\bft\b/.test(lower) ? "ft"
          : /yard|\byd\b/.test(lower) ? "yd"
            : /metre|meter|\bm\b/.test(lower) ? "m"
              : units.trim();
  if (type === "area" && base && !/[²2]$/.test(base)) return `${base}²`;
  if (type === "volume" && base && !/[³3]$/.test(base)) return `${base}³`;
  return base;
}

type LinearUnit = "mm" | "cm" | "m" | "in" | "ft" | "yd";

const METERS_PER_LINEAR_UNIT: Record<LinearUnit, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: 0.0254,
  ft: 0.3048,
  yd: 0.9144,
};

const LINEAR_UNITS = Object.keys(METERS_PER_LINEAR_UNIT) as LinearUnit[];

function normalizeLinearUnit(units: string | null | undefined): LinearUnit | null {
  const lower = (units ?? "").trim().toLowerCase().replace(/[²³]|\^\d$/g, "").trim();
  if (!lower) return null;
  if (/millimet|\bmm\b/.test(lower)) return "mm";
  if (/centimet|\bcm\b/.test(lower)) return "cm";
  if (/inch|\bin\b|^"$/.test(lower)) return "in";
  if (/foot|feet|\bft\b|^'$/.test(lower)) return "ft";
  if (/yard|\byd\b/.test(lower)) return "yd";
  if (/metre|meter|\bm\b/.test(lower)) return "m";
  return null;
}

function convertLinearValue(value: number, from: LinearUnit, to: LinearUnit, type: string) {
  if (from === to) return value;
  const power = type === "volume" ? 3 : type === "area" ? 2 : 1;
  return value * Math.pow(METERS_PER_LINEAR_UNIT[from] / METERS_PER_LINEAR_UNIT[to], power);
}

/**
 * Authored numeric properties frequently omit units: Plant3D/Navisworks emit
 * drawing-unit magnitudes (an imperial DWG serializes AutoCAD.Length in
 * inches) while the model's display units say feet. Sibling unit-hint
 * properties ("Port1_LengthUnit": "in") declare the drawing unit directly.
 */
function authoredLinearUnitHint(rows: Array<[string, unknown]>): LinearUnit | null {
  const hints = new Set<LinearUnit>();
  for (const [key, value] of rows) {
    if (!/(?:length|linear)[ ._-]?units?$/i.test(key)) continue;
    const unit = normalizeLinearUnit(String(value ?? ""));
    if (unit) hints.add(unit);
  }
  // Conflicting hints mean we cannot trust either; fall through to other signals.
  return hints.size === 1 ? hints.values().next().value! : null;
}

function normalizeMassUnit(text: string) {
  if (/lb|pound/i.test(text)) return "lb";
  if (/kg|kilo/i.test(text)) return "kg";
  if (/\bg\b|gram/i.test(text)) return "g";
  return "";
}

/**
 * Total weight ÷ weight-per-length independently implies the element's length
 * in the linear-weight denominator unit (LB and LB/FT ⇒ length in ft). That
 * cross-check disambiguates a unitless authored length no matter which unit
 * the source system serialized it in.
 */
function impliedLengthFromWeight(rows: Array<[string, unknown]>): { value: number; unit: LinearUnit } | null {
  let weight: number | null = null;
  let weightUnitText = "";
  let linearWeight: number | null = null;
  let linearWeightUnitText = "";
  for (const [key, raw] of rows) {
    if (/linear[ ._-]?weight[ ._-]?units?$/i.test(key)) linearWeightUnitText = String(raw ?? "");
    else if (/linear[ ._-]?weight$/i.test(key)) linearWeight = finiteNumber(raw);
    else if (/(?:^|[._\s-])weight[ ._-]?units?$/i.test(key)) weightUnitText = String(raw ?? "");
    else if (/(?:^|[._\s-])weight$/i.test(key)) weight = finiteNumber(raw);
  }
  if (weight == null || weight <= 0 || linearWeight == null || linearWeight <= 0) return null;
  const [massText, perText] = linearWeightUnitText.split("/");
  const perUnit = normalizeLinearUnit(perText ?? "");
  if (!perUnit) return null;
  const mass = normalizeMassUnit(weightUnitText);
  const linearMass = normalizeMassUnit(massText ?? "");
  if (!mass || !linearMass || mass !== linearMass) return null;
  return { value: weight / linearWeight, unit: perUnit };
}

function resolveLinearSourceUnit(
  element: SemanticElement,
  type: string,
  explicitUnitText: string,
  value: number,
  defaultLinear: LinearUnit | null,
  modalAuthoredUnit: LinearUnit | null = null,
): LinearUnit | null {
  const explicit = normalizeLinearUnit(explicitUnitText);
  // An explicit unit that DIFFERS from the model's display unit is genuinely
  // authored — trust it outright. An explicit unit EQUAL to the display unit
  // is suspect: the APS adapter stamps guessUnits() (always "ft") onto raw
  // property magnitudes, so an imperial Plant3D NWD arrives with inch values
  // labelled "ft". Demote that case below the per-element hint, the weight
  // cross-check, and the model-wide modal hint.
  if (explicit && explicit !== defaultLinear) return explicit;
  if (element.authoredLinearUnit) return element.authoredLinearUnit;
  if (type === "length" && element.impliedLength && value > 0) {
    let best: { unit: LinearUnit; error: number } | null = null;
    for (const unit of LINEAR_UNITS) {
      const candidate = convertLinearValue(value, unit, element.impliedLength.unit, "length");
      const error = Math.abs(candidate - element.impliedLength.value) / element.impliedLength.value;
      if (!best || error < best.error) best = { unit, error };
    }
    if (best && best.error <= 0.2) return best.unit;
  }
  // Hint-less elements (Navisworks pipes often carry a bare geometry length
  // with no sibling unit props) inherit the drawing unit declared by the
  // overwhelming majority of their hinted siblings.
  if (modalAuthoredUnit) return modalAuthoredUnit;
  if (explicit) return explicit;
  return defaultLinear;
}

function propertyMeasurementCandidates(element: SemanticElement) {
  return element.flatProperties.flatMap(([key, rawValue]) => {
    const type = normalizedMeasurementType(key);
    // Counts are never inferred from arbitrary numeric properties. IDs such as
    // PnPID and element numbers are common in Plant3D/Navisworks and are not
    // estimating quantities. A real native count may still arrive through the
    // normalized quantity table; otherwise non-linear elements fall back to 1 EA.
    if (!type || type === "count" || /diameter|radius|width|height|depth|thickness|elevation|offset|units?$/i.test(key)) return [];
    const value = finiteNumber(rawValue);
    if (value == null || value <= 0) return [];
    const unitMatch = typeof rawValue === "string"
      ? rawValue.trim().match(/[-+]?\d[\d,]*(?:\.\d+)?(?:[eE][-+]?\d+)?\s+([a-zA-Z°'"²³^/]+.*)$/)
      : null;
    const exact = new RegExp(`(?:^|[._\\s-])(?:gross |net )?${type}$`, "i").test(key);
    return [{
      quantity: { id: `property:${key}`, value, unit: unitMatch?.[1]?.trim() ?? "", confidence: exact ? 0.82 : 0.72 },
      type,
      propertyScore: exact ? 20 : 0,
    }];
  });
}

/**
 * Resolve the measurement's real source unit and convert to the model's
 * canonical linear unit so member measurements always sum coherently.
 * Precedence: explicit unit on the value > per-element authored unit hint >
 * weight ÷ linear-weight cross-check > the model's display units.
 */
function finalizeMeasurement(
  element: SemanticElement,
  selected: { quantity: { id: string; value: number; unit: string; confidence?: number }; type: string },
  defaultUnits: string,
  modalAuthoredUnit: LinearUnit | null = null,
) {
  const type = selected.type;
  const rawUnitText = selected.quantity.unit ?? "";
  const confidence = selected.quantity.confidence ?? 1;
  if (type === "length" || type === "area" || type === "volume") {
    const defaultLinear = normalizeLinearUnit(defaultUnits);
    const source = resolveLinearSourceUnit(element, type, rawUnitText, selected.quantity.value, defaultLinear, modalAuthoredUnit);
    const canonical = defaultLinear ?? source;
    const value = source && canonical
      ? convertLinearValue(selected.quantity.value, source, canonical, type)
      : selected.quantity.value;
    const unit = canonical ? compactUnit(canonical, type) : compactUnit(rawUnitText || defaultUnits, type);
    return { type, value, unit, confidence, quantityId: selected.quantity.id };
  }
  // Non-dimensional measurements (weight, counts routed here) must never
  // inherit the model's linear display units.
  return { type, value: selected.quantity.value, unit: compactUnit(rawUnitText, type), confidence, quantityId: selected.quantity.id };
}

function elementMeasurement(element: SemanticElement, defaultUnits: string, modalAuthoredUnit: LinearUnit | null = null) {
  const preferred = element.role === "linear" ? "length" : element.role === "planar" ? "area" : "count";
  const nativeCandidates = (element.quantities ?? [])
    .filter((quantity) => Number.isFinite(quantity.value) && quantity.value > 0)
    .map((quantity) => ({ quantity, type: normalizedMeasurementType(quantity.quantityType), propertyScore: 30 }));
  const candidates = [...nativeCandidates, ...propertyMeasurementCandidates(element)]
    .filter((candidate) => candidate.type)
    .sort((left, right) => {
      const leftScore = (left.type === preferred ? 100 : left.type === "count" ? 0 : 30) + left.propertyScore;
      const rightScore = (right.type === preferred ? 100 : right.type === "count" ? 0 : 30) + right.propertyScore;
      return rightScore - leftScore || (right.quantity.confidence ?? 1) - (left.quantity.confidence ?? 1);
    });
  const selected = candidates[0];
  if (selected && (selected.type === preferred || preferred !== "count")) {
    return finalizeMeasurement(element, selected, defaultUnits, modalAuthoredUnit);
  }
  return { type: "count", value: 1, unit: "EA", confidence: 1, quantityId: null as string | null };
}

/**
 * Resolve one element's estimating measurement with the same unit handling the
 * topology rollups use — authored unit hints, the weight cross-check and the
 * model-wide drawing-unit consensus. Element lists must not re-derive this:
 * reading a bare `AutoCAD.Length` and stamping the model's display unit on it
 * is what made inch values render as feet.
 */
export function resolveElementMeasurement(
  element: ModelTopologyElementInput,
  options: { units?: string; modalAuthoredUnit?: string | null } = {},
) {
  return elementMeasurement(
    semanticElement(element),
    options.units ?? "",
    normalizeLinearUnit(options.modalAuthoredUnit ?? null),
  );
}

/**
 * The drawing unit this element's own properties declare (Plant3D stamps
 * Port1_LengthUnit and friends), or null when it declares none. Callers that
 * label a raw length property must prefer this over the model's display unit.
 */
export function resolveAuthoredLinearUnit(properties: Record<string, unknown> | null | undefined): string | null {
  return authoredLinearUnitHint(flattenProperties(properties ?? {}));
}

/**
 * The drawing unit an overwhelming majority of hinted elements declare, or
 * null when there is no real consensus. Pass into resolveElementMeasurement so
 * a list of elements units the same way the rollups do.
 */
export function resolveModelAuthoredUnit(elements: ModelTopologyElementInput[]): string | null {
  const hintCounts = new Map<LinearUnit, number>();
  for (const input of elements) {
    const hint = authoredLinearUnitHint(flattenProperties(input.properties ?? {}));
    if (!hint) continue;
    hintCounts.set(hint, (hintCounts.get(hint) ?? 0) + 1);
  }
  const hintedTotal = Array.from(hintCounts.values()).reduce((sum, count) => sum + count, 0);
  const modal = Array.from(hintCounts.entries()).sort((left, right) => right[1] - left[1])[0];
  return modal && modal[1] >= 3 && modal[1] / hintedTotal >= 0.8 ? modal[0] : null;
}

function groupQuality(members: SemanticElement[], connections: ModelTopologyConnectionResult[], measurementCoverage: number, expectConnectivity = true) {
  const warnings: string[] = [];
  const materials = new Set(members.map((member) => member.material?.trim()).filter(Boolean));
  const specs = new Set(members.map((member) => member.specification).filter(Boolean));
  const sizes = new Set(members.map((member) => member.size).filter(Boolean));
  if (materials.size > 1) warnings.push("Mixed materials");
  if (specs.size > 1) warnings.push("Mixed specifications");
  if (sizes.size > 1) warnings.push("Mixed sizes");
  if (measurementCoverage < 1) warnings.push(`Quantity coverage ${Math.round(measurementCoverage * 100)}%`);
  if (expectConnectivity && members.length > 1 && connections.length === 0) warnings.push("Grouped by authored metadata; physical connectivity unavailable");
  return warnings;
}

export function buildModelTopology(
  inputElements: ModelTopologyElementInput[],
  options: { units?: string; estimateGroupBy?: ModelTopologyEstimateAxis[] } = {},
): ModelTopologyResult {
  const elements = inputElements
    .filter((element) => element.properties?.estimateRelevant !== false)
    .map(semanticElement);
  const defaultUnits = options.units ?? "";
  const byId = new Map(elements.map((element) => [element.id, element]));
  const connectionMap = explicitConnections(elements);
  // Endpoint coordinates live in the source drawing's units, which authored
  // unit hints describe; the display units can disagree (imperial Plant3D NWDs
  // report feet while serializing inch coordinates). Proximity tolerance must
  // follow the coordinate space or inference silently finds nothing.
  const hintCounts = new Map<LinearUnit, number>();
  for (const element of elements) {
    if (!element.authoredLinearUnit) continue;
    hintCounts.set(element.authoredLinearUnit, (hintCounts.get(element.authoredLinearUnit) ?? 0) + 1);
  }
  const geometryUnits = Array.from(hintCounts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? defaultUnits;
  // Model-wide drawing unit consensus: when an overwhelming majority of
  // hinted elements declare one unit, hint-less siblings (Navisworks pipes
  // whose only datum is a bare geometry length stamped with the display
  // unit) measure in that same drawing unit. Requires a real majority — a
  // couple of stray hints must not re-unit the whole model.
  const hintedTotal = Array.from(hintCounts.values()).reduce((sum, count) => sum + count, 0);
  const modalHintEntry = Array.from(hintCounts.entries()).sort((left, right) => right[1] - left[1])[0];
  const modalAuthoredUnit: LinearUnit | null =
    modalHintEntry && modalHintEntry[1] >= 3 && modalHintEntry[1] / hintedTotal >= 0.8
      ? modalHintEntry[0]
      : null;
  inferredConnections(elements, geometryUnits, connectionMap);
  const connections = Array.from(connectionMap.values()).sort((left, right) => left.signature.localeCompare(right.signature));
  const { adjacency, components } = connectedComponents(elements.map((element) => element.id), connections);
  const componentIndex = new Map<string, number>();
  components.forEach((members, index) => members.forEach((id) => componentIndex.set(id, index)));

  const groups: ModelTopologyGroupResult[] = [];
  const systemBuckets = new Map<string, SemanticElement[]>();
  for (const element of elements) {
    const component = componentIndex.get(element.id) ?? -1;
    const key = element.authoredSystem
      ? `authored:${element.trade}:${element.authoredSystem}`
      : connections.some((connection) => connection.fromElementId === element.id || connection.toElementId === element.id)
        ? `detected:${element.trade}:${component}`
        : `unassigned:${element.trade}`;
    const bucket = systemBuckets.get(key) ?? [];
    bucket.push(element);
    systemBuckets.set(key, bucket);
  }

  let systemNumber = 0;
  for (const [bucketKey, systemMembers] of systemBuckets) {
    systemNumber += 1;
    const authored = bucketKey.startsWith("authored:");
    const unassigned = bucketKey.startsWith("unassigned:");
    const authoredName = systemMembers.find((member) => member.authoredSystem)?.authoredSystem ?? "";
    const trade = systemMembers[0]?.trade ?? "general";
    const systemSignature = signature("system", [trade, authoredName || systemMembers.map((member) => member.externalId || member.id).sort().join("|")]);
    const systemConnections = connections.filter((connection) => systemMembers.some((member) => member.id === connection.fromElementId) && systemMembers.some((member) => member.id === connection.toElementId));
    groups.push({
      signature: systemSignature,
      parentSignature: null,
      kind: "system",
      name: authoredName ? display(authoredName) : unassigned ? `Unassigned ${display(trade)}` : `${display(trade)} system ${systemNumber}`,
      trade,
      source: authored ? "authored" : systemConnections.length > 0 ? "detected" : "inferred",
      confidence: authored ? 0.98 : systemConnections.length > 0 ? 0.82 : 0.55,
      measurementType: "count",
      quantity: systemMembers.length,
      unit: "EA",
      memberElementIds: systemMembers.map((member) => member.id).sort(),
      warnings: groupQuality(systemMembers, systemConnections, 1),
      metadata: { authoredSystem: authoredName, elementCount: systemMembers.length },
    });

    const memberIds = new Set(systemMembers.map((member) => member.id));
    const connectedSystemComponents = components
      .map((members) => members.filter((id) => memberIds.has(id)))
      .filter((members) => members.length > 0)
      .filter((members) => members.length > 1 || members.some((id) => (adjacency.get(id)?.size ?? 0) > 0));
    // Authored pipeline/system identifiers are authoritative logical runs even
    // when a source format (notably NWD) omits connector relationships. Keep
    // that line together instead of manufacturing one "network" per element.
    const systemComponents = connectedSystemComponents.length > 0
      ? connectedSystemComponents
      : authored
        ? [systemMembers.map((member) => member.id).sort()]
        : [];
    for (let networkIndex = 0; networkIndex < systemComponents.length; networkIndex += 1) {
      const networkIds = systemComponents[networkIndex];
      const networkMembers = networkIds.map((id) => byId.get(id)!).filter(Boolean);
      const networkConnections = connections.filter((connection) => networkIds.includes(connection.fromElementId) && networkIds.includes(connection.toElementId));
      const networkSignature = signature("network", [systemSignature, ...networkMembers.map((member) => member.externalId || member.id).sort()]);
      groups.push({
        signature: networkSignature,
        parentSignature: systemSignature,
        kind: "network",
        name: authoredName
          ? `${display(authoredName)} · ${systemComponents.length === 1 ? "Network" : `Network ${networkIndex + 1}`}`
          : systemComponents.length === 1 ? `${display(trade)} network` : `${display(trade)} network ${networkIndex + 1}`,
        trade,
        source: networkConnections.some((connection) => connection.source === "explicit") ? "detected" : networkConnections.length > 0 ? "inferred" : authored ? "authored" : "inferred",
        confidence: networkConnections.length > 0 ? Math.min(...networkConnections.map((connection) => connection.confidence)) : authored ? 0.75 : 0.45,
        measurementType: "count",
        quantity: networkMembers.length,
        unit: "EA",
        memberElementIds: networkIds,
        warnings: groupQuality(networkMembers, networkConnections, 1),
        metadata: { connectionCount: networkConnections.length },
      });

      const paths = authored && networkConnections.length === 0
        ? [networkIds]
        : runPaths(networkIds, adjacency, byId);
      for (let pathIndex = 0; pathIndex < paths.length; pathIndex += 1) {
        const path = paths[pathIndex];
        const pathMembers = path.map((id) => byId.get(id)!).filter(Boolean);
        const runSignature = signature("run", [networkSignature, ...pathMembers.map((member) => member.externalId || member.id)]);
        const measurements = pathMembers.map((member) => elementMeasurement(member, defaultUnits, modalAuthoredUnit));
        const linearMeasurements = measurements.filter((measurement) => measurement.type === "length");
        const runMeasurement = linearMeasurements.length > 0 ? linearMeasurements : measurements;
        const unit = runMeasurement[0]?.unit || (linearMeasurements.length > 0 ? "" : "EA");
        const compatibleMeasurements = runMeasurement.filter((measurement) => measurement.unit === unit && measurement.type === runMeasurement[0]?.type);
        groups.push({
          signature: runSignature,
          parentSignature: networkSignature,
          kind: "run",
          name: authoredName
            ? `${display(authoredName)} · ${paths.length === 1 ? "Run" : `Run ${pathIndex + 1}`}`
            : paths.length === 1 ? `${display(trade)} run` : `${display(trade)} run ${pathIndex + 1}`,
          trade,
          source: networkConnections.length > 0 ? "detected" : authored ? "authored" : "inferred",
          confidence: networkConnections.length > 0 ? Math.min(...networkConnections.map((connection) => connection.confidence)) : authored ? 0.72 : 0.45,
          measurementType: runMeasurement[0]?.type ?? "count",
          quantity: compatibleMeasurements.reduce((sum, measurement) => sum + measurement.value, 0),
          unit,
          memberElementIds: path,
          warnings: groupQuality(pathMembers, networkConnections, compatibleMeasurements.length / Math.max(1, pathMembers.length)),
          metadata: { pathIndex, branchBoundaryCount: pathMembers.filter((member) => ["junction", "equipment", "terminal", "control"].includes(member.role)).length },
        });
      }
    }

  }

  // Estimating groups deliberately span authored systems. Systems/Runs answer
  // “where is it?”; these rollups answer “what do I price?” and collapse many
  // source runs into a small, worksheet-ready schedule by trade, role, spec,
  // material, size, measurement and unit.
  const estimateGroupBy = Array.from(new Set(options.estimateGroupBy?.length
    ? options.estimateGroupBy
    : DEFAULT_MODEL_TOPOLOGY_ESTIMATE_AXES));
  const estimateBuckets = new Map<string, { members: SemanticElement[]; measurements: ReturnType<typeof elementMeasurement>[] }>();
  for (const member of elements) {
    const measurement = elementMeasurement(member, defaultUnits, modalAuthoredUnit);
    const estimatingRole = member.role === "linear" ? "linear" : ["junction", "fitting"].includes(member.role) ? "fittings" : member.role;
    const axisValue = (axis: ModelTopologyEstimateAxis) => axis === "trade" ? member.trade
      : axis === "role" ? estimatingRole
        : axis === "specification" ? member.specification
          : axis === "material" ? member.material ?? ""
            : axis === "size" ? member.size
              : axis === "system" ? member.authoredSystem
                : axis === "level" ? member.level ?? ""
                  : axis === "elementClass" ? member.elementClass ?? ""
                    : member.elementType ?? "";
    // Measurement and unit are hard boundaries: unlike descriptive axes they
    // can never be removed by a recipe because unlike quantities cannot sum.
    const key = [...estimateGroupBy.map(axisValue), measurement.type, measurement.unit].join("\u001f");
    const bucket = estimateBuckets.get(key) ?? { members: [], measurements: [] };
    bucket.members.push(member);
    bucket.measurements.push(measurement);
    estimateBuckets.set(key, bucket);
  }
  for (const bucket of estimateBuckets.values()) {
    const sample = bucket.members[0];
    const measurement = bucket.measurements[0];
    const estimatingRole = sample.role === "linear"
      ? measurement.type === "length" ? "Linear run" : "Unmeasured linear items"
      : ["junction", "fitting"].includes(sample.role) ? "Fittings" : display(sample.role);
    const labelValue = (axis: ModelTopologyEstimateAxis) => axis === "trade" ? display(sample.trade)
      : axis === "role" ? estimatingRole
        : axis === "specification" ? sample.specification
          : axis === "material" ? sample.material ?? ""
            : axis === "size" ? sample.size
              : axis === "system" ? sample.authoredSystem
                : axis === "level" ? sample.level ?? ""
                  : axis === "elementClass" ? sample.elementClass ?? ""
                    : sample.elementType ?? "";
    const labelParts = estimateGroupBy.map(labelValue)
      .filter((value): value is string => Boolean(value))
      .map(display);
    const bucketConnections = connections.filter((connection) =>
      bucket.members.some((member) => member.id === connection.fromElementId)
      && bucket.members.some((member) => member.id === connection.toElementId));
    const authoredSystems = Array.from(new Set(bucket.members.map((member) => member.authoredSystem).filter(Boolean))).sort();
    const signatureValue = (axis: ModelTopologyEstimateAxis) => axis === "trade" ? sample.trade
      : axis === "role" ? (sample.role === "linear" ? "linear" : ["junction", "fitting"].includes(sample.role) ? "fittings" : sample.role)
        : axis === "specification" ? sample.specification
          : axis === "material" ? sample.material ?? ""
            : axis === "size" ? sample.size
              : axis === "system" ? sample.authoredSystem
                : axis === "level" ? sample.level ?? ""
                  : axis === "elementClass" ? sample.elementClass ?? ""
                    : sample.elementType ?? "";
    const estimateSignature = signature("estimate", [...estimateGroupBy.flatMap((axis) => [axis, signatureValue(axis)]), measurement.type, measurement.unit]);
    const estimateWarnings = groupQuality(bucket.members, bucketConnections, bucket.measurements.length / Math.max(1, bucket.members.length), false);
    if (sample.role === "linear" && measurement.type !== "length") estimateWarnings.push("Linear elements have no usable length; review source quantities");
    groups.push({
      signature: estimateSignature,
      parentSignature: null,
      kind: "estimate",
      name: labelParts.join(" · ") || `${display(sample.trade)} pickup`,
      trade: sample.trade,
      source: authoredSystems.length > 0 ? "authored" : bucketConnections.length > 0 ? "detected" : "inferred",
      confidence: Math.min(...bucket.measurements.map((candidate) => candidate.confidence)),
      measurementType: measurement.type,
      quantity: bucket.measurements.reduce((sum, candidate) => sum + candidate.value, 0),
      unit: measurement.unit,
      memberElementIds: bucket.members.map((member) => member.id).sort(),
      warnings: estimateWarnings,
      metadata: {
        role: sample.role,
        specification: sample.specification,
        material: sample.material ?? "",
        size: sample.size,
        authoredSystems,
        systemCount: authoredSystems.length,
        groupBy: estimateGroupBy,
        quantityIds: bucket.measurements.map((candidate) => candidate.quantityId).filter(Boolean),
      },
    });
  }

  const connectedIds = new Set(connections.flatMap((connection) => [connection.fromElementId, connection.toElementId]));
  return {
    version: 1,
    connections,
    groups: groups.sort((left, right) => left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name)),
    diagnostics: {
      elementCount: elements.length,
      connectedElementCount: connectedIds.size,
      authoredSystemCount: groups.filter((group) => group.kind === "system" && group.source === "authored").length,
      inferredConnectionCount: connections.filter((connection) => connection.source === "geometry").length,
      ungroupedElementCount: elements.filter((element) => !groups.some((group) => group.memberElementIds.includes(element.id))).length,
    },
  };
}
