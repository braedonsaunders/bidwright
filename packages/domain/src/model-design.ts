/** Portable, replayable CAD intent. No executable model-supplied code. */
export type DesignScalar = number | string;
export type DesignVector = [DesignScalar, DesignScalar, DesignScalar];
export interface DesignFeature {
  id: string;
  op: "existing" | "box" | "cylinder" | "sphere" | "tube" | "extrude" | "revolve" | "union" | "cut" | "intersect" | "transform" | "fillet" | "chamfer";
  inputs?: string[];
  nodeId?: string;
  size?: DesignVector;
  origin?: DesignVector;
  axis?: DesignVector;
  xDirection?: DesignVector;
  radius?: DesignScalar;
  height?: DesignScalar;
  wall?: DesignScalar;
  points?: DesignVector[];
  direction?: DesignVector;
  angle?: DesignScalar;
  translation?: DesignVector;
  rotation?: DesignVector;
  edges?: number[];
}
export interface ModelDesign {
  version: 1;
  name: string;
  units: "mm" | "in";
  parameters: Record<string, number>;
  features: DesignFeature[];
  parts: Array<{ id: string; name: string; feature: string; nodeId?: string; material?: string; stock?: string }>;
  assumptions: string[];
  removedParts?: string[];
}

/** Small arithmetic parser, intentionally without eval, property access, or functions. */
export function evaluateDesignScalar(value: DesignScalar, parameters: Record<string, number>): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > 1e7) throw new Error("Dimension is outside the supported range");
    return value;
  }
  if (typeof value !== "string" || value.length > 200) throw new Error("Invalid dimension expression");
  const tokens = value.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|[()+*/-]/g) ?? [];
  if (tokens.join("") !== value.replace(/\s/g, "")) throw new Error(`Unsupported expression: ${value}`);
  let at = 0;
  function atom(): number {
    const token = tokens[at++];
    if (token === "+") return atom();
    if (token === "-") return -atom();
    if (token === "(") {
      const result = sum();
      if (tokens[at++] !== ")") throw new Error("Unclosed expression");
      return result;
    }
    if (!token) throw new Error("Incomplete expression");
    if (/^[A-Za-z_]/.test(token)) {
      if (!Object.hasOwn(parameters, token)) throw new Error(`Unknown parameter: ${token}`);
      return parameters[token]!;
    }
    const result = Number(token);
    if (!Number.isFinite(result)) throw new Error(`Invalid number: ${token}`);
    return result;
  }
  function product(): number {
    let result = atom();
    while (tokens[at] === "*" || tokens[at] === "/") {
      const op = tokens[at++];
      const rhs = atom();
      if (op === "/" && rhs === 0) throw new Error("Division by zero");
      result = op === "*" ? result * rhs : result / rhs;
    }
    return result;
  }
  function sum(): number {
    let result = product();
    while (tokens[at] === "+" || tokens[at] === "-") {
      const op = tokens[at++];
      const rhs = product();
      result = op === "+" ? result + rhs : result - rhs;
    }
    return result;
  }
  const result = sum();
  if (at !== tokens.length || !Number.isFinite(result) || Math.abs(result) > 1e7) throw new Error(`Invalid expression: ${value}`);
  return result;
}

export function validateModelDesign(value: unknown): asserts value is ModelDesign {
  const d = value as ModelDesign;
  if (!d || d.version !== 1 || !["mm", "in"].includes(d.units) || typeof d.name !== "string" || !d.name.trim() || d.name.length > 160) throw new Error("Invalid model design header");
  if (!d.parameters || Array.isArray(d.parameters) || typeof d.parameters !== "object" || Object.keys(d.parameters).length > 60) throw new Error("Invalid model parameters");
  for (const [key, value] of Object.entries(d.parameters)) {
    if (!/^[A-Za-z_][A-Za-z_0-9]{0,63}$/.test(key) || typeof value !== "number") throw new Error(`Invalid parameter: ${key}`);
    evaluateDesignScalar(value, {});
  }
  if (!Array.isArray(d.features) || !d.features.length || d.features.length > 400 || !Array.isArray(d.parts) || !d.parts.length || d.parts.length > 200) throw new Error("A design requires 1–400 features and 1–200 parts");
  if (!Array.isArray(d.assumptions) || d.assumptions.length > 40 || d.assumptions.some(x => typeof x !== "string" || x.length > 500)) throw new Error("Invalid design assumptions");
  const ids = new Set<string>();
  const ops = ["existing", "box", "cylinder", "sphere", "tube", "extrude", "revolve", "union", "cut", "intersect", "transform", "fillet", "chamfer"];
  const vector = (v: unknown, label: string) => {
    if (!Array.isArray(v) || v.length !== 3) throw new Error(`${label} must have three coordinates`);
    v.forEach(x => evaluateDesignScalar(x, d.parameters));
  };
  for (const f of d.features) {
    if (!f || !/^[A-Za-z_][A-Za-z_0-9-]{0,79}$/.test(f.id) || ids.has(f.id) || !ops.includes(f.op)) throw new Error("Invalid or duplicate feature");
    if (f.op === "existing" && (typeof f.nodeId !== "string" || !f.nodeId || f.nodeId.length > 160)) throw new Error(`${f.id}: existing geometry requires nodeId`);
    if (f.inputs !== undefined && (!Array.isArray(f.inputs) || f.inputs.length > 200 || f.inputs.some(x => !ids.has(x)))) throw new Error(`${f.id}: inputs must reference earlier features`);
    for (const key of ["size", "origin", "axis", "xDirection", "direction", "translation", "rotation"] as const) if (f[key] !== undefined) vector(f[key], `${f.id}.${key}`);
    for (const key of ["radius", "height", "wall", "angle"] as const) if (f[key] !== undefined) evaluateDesignScalar(f[key]!, d.parameters);
    if (f.op === "box" || f.op === "tube") vector(f.size, `${f.id}.size`);
    if (["cylinder", "sphere", "fillet", "chamfer"].includes(f.op) && f.radius === undefined) throw new Error(`${f.id}: radius is required`);
    if (f.op === "cylinder" && f.height === undefined) throw new Error(`${f.id}: height is required`);
    if (f.op === "tube" && f.wall === undefined) throw new Error(`${f.id}: wall is required`);
    if (["union", "cut", "intersect"].includes(f.op) && (f.inputs?.length ?? 0) < 2) throw new Error(`${f.id}: at least two inputs are required`);
    if (["transform", "fillet", "chamfer"].includes(f.op) && f.inputs?.length !== 1) throw new Error(`${f.id}: one input is required`);
    if (["extrude", "revolve"].includes(f.op)) {
      if (!Array.isArray(f.points) || f.points.length < 3 || f.points.length > 256) throw new Error(`${f.id}: a closed planar profile needs 3–256 points`);
      f.points.forEach(p => vector(p, `${f.id}.points`));
      if (f.op === "extrude") vector(f.direction, `${f.id}.direction`);
    }
    if (f.edges !== undefined && (!Array.isArray(f.edges) || f.edges.length > 300 || f.edges.some(e => !Number.isInteger(e) || e < 0))) throw new Error(`${f.id}: invalid edge indices`);
    ids.add(f.id);
  }
  if (d.removedParts !== undefined && (!Array.isArray(d.removedParts) || d.removedParts.length > 200 || d.removedParts.some(id => typeof id !== "string" || id.length > 80))) throw new Error("Invalid removed parts");
  const parts = new Set<string>();
  const targetNodes = new Set<string>();
  for (const p of d.parts) {
    if (!p || !/^[A-Za-z_][A-Za-z_0-9-]{0,79}$/.test(p.id) || parts.has(p.id) || !ids.has(p.feature) || typeof p.name !== "string" || !p.name.trim() || p.name.length > 160) throw new Error("Invalid part");
    if (p.nodeId !== undefined && (typeof p.nodeId !== "string" || !p.nodeId || p.nodeId.length > 160)) throw new Error("Invalid target node");
    for (const field of [p.material, p.stock]) if (field !== undefined && (typeof field !== "string" || field.length > 160)) throw new Error("Invalid part metadata");
    const target = p.nodeId ?? `design-${p.id}`;
    if (targetNodes.has(target)) throw new Error("Two parts cannot replace the same node");
    targetNodes.add(target);
    parts.add(p.id);
  }
}

export const MODEL_DESIGN_INSTRUCTIONS = `You design precise CAD parts and custom fabrication assemblies for Bidwright. Return ONLY JSON: {"message":"short explanation or clarification question","recipe": ModelDesign or null}.
ModelDesign: {version:1,name:string,removedParts?:[explicitlyDeletedPartId],units:"mm"|"in",parameters:{namedDimension:number},features:[DesignFeature],parts:[{id,name,feature,nodeId?,material?,stock?}],assumptions:[string]}.
Dimensions may be numbers or arithmetic expressions using parameters, + - * / and parentheses. Keep dimensions parameterized. All lengths and coordinates use recipe.units; rotations use degrees. No functions, code, or property access.
DesignFeature has id and op, plus the applicable fields below. Features are evaluated in order. inputs reference earlier feature IDs. Every part points at its final feature. Keep IDs stable across revisions. Return the COMPLETE revised recipe, retaining all unaffected features and parts exactly. Only change the selected/requested portion. The editor compares feature dependencies and updates changed parts in place; unrelated nodes retain their identity, placement, hierarchy and materials. Omit a previous part ONLY when deletion was explicitly requested and include its id in removedParts. Keep nodeId stable when present.
existing: nodeId (exact live node id). This snapshots the current solid in WORLD millimetres, regardless of recipe.units. Use it as the input for careful edits to imported, manually drawn, or manually modified geometry. Put that SAME nodeId on the output part to replace only that existing node. Never approximate/reconstruct an existing part when a cut, union, transform, fillet or chamfer can edit it. For AI parts whose live geometry still matches the recipe, modify the appropriate primitive/feature or append a new feature using the previous part.feature as input. If manuallyModified is true, use a NEW existing feature id to rebase on current geometry.
box: size:[width,depth,height], origin?:[x,y,z] (minimum corner), axis?:[x,y,z] (local Z), xDirection?:[x,y,z] (local X).
tube: same as box, plus wall (hollow rectangular stock along local Z; both ends open).
cylinder: radius,height,origin?:[x,y,z] (base center),axis?:[x,y,z] (default Z).
sphere: radius,origin?:[x,y,z].
extrude: points:[[x,y,z],...], direction:[dx,dy,dz]. Profile must be planar; omit repeated closing point.
revolve: points as above, origin?:[x,y,z] (axis point), axis?:[x,y,z], angle?:degrees (default 360).
union/cut/intersect: inputs:[target,tool,...]. A cut subtracts all tools from the first shape.
transform: inputs:[feature],translation?:[x,y,z],rotation?:[Xdegrees,Ydegrees,Zdegrees] about world origin; rotation then translation. Use explicit box axes for tilted tube stock when simpler.
fillet/chamfer: inputs:[feature],radius,edges?:[zero-based edge indices]. Omit edges to apply to all edges. Prefer simple, robust features and avoid gratuitous fillets.
Parts remain separate solids for fabrication BOMs. Do not fuse a welded assembly into one part. Represent every physical member as a part; use transform features for repeats. Materials/stock are specifications, not appearance. Z is up. Distinguish tube outside size from wall thickness. Holes need cylinders extending slightly beyond the target; cut through holes robustly. For oblique members, provide orthogonal axis and xDirection.
The current recipe and live geometry context are provided. Selected nodes include world-space bounds and edge/face topology. Use selected node ids and edge indices for precise local edits; preserve all other geometry. Ask a concise question if the target portion is ambiguous. Never claim a change was applied; the client verifies the recipe in OpenCascade before reporting success.
Ask a concise question with recipe:null if critical dimensions or requirements are missing. You may produce a first concept with clearly listed assumptions for noncritical details. Never invent structural load capacity, certified weld sizing, bend allowances, or machine-ready flat patterns. If execution feedback is present, repair the recipe while preserving the user's intent. Geometry validation proves shape consistency, not engineering suitability.`;

/** Geometry signature only includes dependencies and dimensions used by this part. */
export function modelDesignPartSignature(design: ModelDesign, part: ModelDesign["parts"][number]): string {
  const features = new Map(design.features.map(f => [f.id, f]));
  const seen = new Set<string>();
  const resolved: unknown[] = [];
  function visit(id: string) {
    if (seen.has(id)) return;
    seen.add(id);
    const f = features.get(id)!;
    (f.inputs ?? []).forEach(visit);
    const normalized: Record<string, unknown> = { ...f };
    for (const key of ["radius", "height", "wall", "angle"] as const) if (f[key] !== undefined) normalized[key] = evaluateDesignScalar(f[key]!, design.parameters);
    for (const key of ["size", "origin", "axis", "xDirection", "direction", "translation", "rotation"] as const) if (f[key]) normalized[key] = f[key]!.map(v => evaluateDesignScalar(v, design.parameters));
    if (f.points) normalized["points"] = f.points.map(p => p.map(v => evaluateDesignScalar(v, design.parameters)));
    resolved.push(Object.fromEntries(Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b))));
  }
  visit(part.feature);
  return JSON.stringify({ units: design.units, features: resolved });
}
