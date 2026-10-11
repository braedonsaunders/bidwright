import { z } from "zod";
import { aggregateMto, connection, item, type MtoItem, type PipingMto, type SourceRef } from "./mto.js";

const number = z.number().finite();
const prep = z.enum(["BW", "SW", "THD", "FL", "PLAIN"]);
const catalog = z.object({
  id: z.string(), nps: number.optional(), smallerNps: number.optional(), shopField: z.enum(["S", "F"]).optional(), material: z.string().optional(), schedule: z.string().optional(),
  description: z.string().optional(), partCode: z.string().optional(), component: z.string().optional(),
  takeout: number.nonnegative().optional(), branchTakeout: number.nonnegative().optional(), takeoutMissing: z.boolean().optional(),
});
const schema = z.object({
  schema: z.literal("bidwright-piping"), version: z.literal(1), units: z.enum(["mm", "imperial"]).optional(),
  specs: z.array(z.object({ id: z.string(), material: z.string().optional(), schedule: z.string().optional(), rootGap: number.nonnegative().optional(), fittings: z.array(catalog).default([]), sizes: z.array(z.object({ nps: number.positive(), shopField: z.enum(["S", "F"]).optional(), material: z.string().optional(), schedule: z.string().optional() })).default([]) })),
  nodes: z.array(z.object({ id: z.string(), kind: z.string(), position: z.tuple([number, number, number]), catalogId: z.string().optional(), component: z.string().optional(), description: z.string().optional(), quantity: number.nonnegative().optional(), takeout: number.nonnegative().optional(), branchTakeout: number.nonnegative().optional(), portTakeouts: z.record(number.nonnegative()).optional(), branchEdgeId: z.string().optional(), associatedRunId: z.string().optional(), field: z.boolean().optional() })),
  runs: z.array(z.object({ id: z.string(), from: z.string(), to: z.string(), specId: z.string(), nps: number.positive(), connector: z.boolean().optional(), endPrep: prep.optional(), fromPrep: prep.optional(), toPrep: prep.optional(), fromField: z.boolean().optional(), toField: z.boolean().optional(), rootGap: number.nonnegative().optional() })),
});

// Schema and fabrication lengths: github.com/braedonsaunders/spoolyard src/core/model.ts.
// The display-unit setting does not change stored millimetres or NPS inches.
export function parseSpoolyard(text: string): PipingMto {
  const doc = schema.parse(JSON.parse(text));
  const nodes = new Map(doc.nodes.map(n => [n.id, n]));
  const specs = new Map(doc.specs.map(s => [s.id, s]));
  if (nodes.size !== doc.nodes.length || specs.size !== doc.specs.length || new Set(doc.runs.map(r => r.id)).size !== doc.runs.length) throw new Error("Duplicate piping node, run, or spec id");
  const catalogItems = doc.specs.flatMap(s => s.fittings);
  const fittings = new Map(catalogItems.map(f => [f.id, f]));
  if (fittings.size !== catalogItems.length) throw new Error("Duplicate piping catalog id");
  const runs = new Map(doc.runs.map(r => [r.id, r]));
  const connected = new Map<string, typeof doc.runs>();
  for (const run of doc.runs) for (const nodeId of new Set([run.from, run.to])) {
    const edges = connected.get(nodeId) ?? [];
    edges.push(run);
    connected.set(nodeId, edges);
  }
  const sizesBySpec = new Map(doc.specs.map(s => [s.id, new Map(s.sizes.map(size => [size.nps, size]))]));
  const refs = new Map<string, SourceRef>();
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
  const lineAt = (offset: number) => {
    let low = 0, high = lineStarts.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (lineStarts[middle] <= offset) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  // Scan each array once; paths disambiguate compact JSON whose items share line 1.
  for (const group of ["nodes", "runs"] as const) {
    const ids = /"id"\s*:\s*("(?:\\.|[^"\\])*")/g;
    ids.lastIndex = new RegExp(`"${group}"\\s*:\\s*\\[`).exec(text)?.index ?? 0;
    for (const [i, entry] of doc[group].entries()) {
      const match = ids.exec(text);
      if (!match || JSON.parse(match[1]) !== entry.id) throw new Error(`Cannot locate ${group} source reference ${entry.id}`);
      refs.set(`${group}:${entry.id}`, { id: entry.id, path: `/${group}/${i}`, line: lineAt(match.index) });
    }
  }
  const ref = (group: string, id: string) => refs.get(`${group}:${id}`)!;
  const items: MtoItem[] = [], unknown: PipingMto["joints"]["unknown"] = [], warnings: string[] = [];
  const takeout = (n: typeof doc.nodes[number], runId: string) => {
    if (["end", "weld", "support", "annotation"].includes(n.kind)) return 0;
    if (n.portTakeouts?.[runId] !== undefined) return n.portTakeouts[runId];
    const f = n.catalogId ? fittings.get(n.catalogId) : undefined;
    return n.branchEdgeId === runId ? n.branchTakeout ?? (f?.takeoutMissing ? undefined : f?.branchTakeout) : n.takeout ?? (f?.takeoutMissing ? undefined : f?.takeout);
  };
  for (const r of doc.runs) {
    const a = nodes.get(r.from), b = nodes.get(r.to), s = specs.get(r.specId);
    if (!a || !b || !s) throw new Error(`Run ${r.id} references a missing node or spec`);
    if (r.connector) continue;
    const size = sizesBySpec.get(s.id)?.get(r.nps);
    const overall = Math.hypot(...a.position.map((v, i) => v - b.position[i]));
    const ts = [takeout(a, r.id), takeout(b, r.id)];
    const gaps = [a, b].map((n, i) => {
      const endPrep = (i === 0 ? r.fromPrep : r.toPrep) ?? r.endPrep;
      if (!endPrep) return undefined;
      if (endPrep !== "BW" || ["end", "support", "annotation", "gasket", "bolt"].includes(n.kind)) return 0;
      const gap = r.rootGap ?? s.rootGap;
      return gap === undefined ? undefined : gap / (n.kind === "weld" ? 2 : 1);
    });
    const cut = [...ts, ...gaps].every(v => v !== undefined) ? overall - ts[0]! - ts[1]! - gaps[0]! - gaps[1]! : null;
    if (cut === null || cut <= 0) warnings.push(`Run ${r.id}: cut length unknown (${cut === null ? "missing takeout, end preparation, or root gap" : "non-positive cut"}); centreline length ${overall} mm.`);
    items.push(item({ type: "PIPE", scope: size?.shopField === "F" ? "field" : size?.shopField === "S" ? "shop" : "unknown", size: `${r.nps} NPS in`, spec: s.id, material: size?.material ?? s.material ?? "", schedule: size?.schedule ?? s.schedule ?? "", quantity: cut !== null && cut > 0 ? cut / 1000 : null, unit: "m", basis: "cut length: centreline minus port takeouts and BW root gaps", refs: [ref("runs", r.id)] }));
  }
  for (const n of doc.nodes) {
    if (["end", "annotation"].includes(n.kind)) continue;
    const edges = connected.get(n.id) ?? [];
    const edge = edges[0] ?? runs.get(n.associatedRunId ?? "");
    if (n.associatedRunId && !runs.has(n.associatedRunId)) throw new Error(`Node ${n.id} references a missing run`);
    const s = edge ? specs.get(edge.specId) : undefined, f = n.catalogId ? fittings.get(n.catalogId) : undefined;
    if (n.catalogId && !f) warnings.push(`Node ${n.id}: catalog item ${n.catalogId} not found.`);
    const size = f?.nps ?? (edges.length ? Math.max(...edges.map(r => r.nps)) : edge?.nps);
    const sizes = f?.smallerNps !== undefined ? [size, f.smallerNps] : [...new Set([size, ...edges.map(r => r.nps)])];
    const base = { size: size === undefined ? "unknown" : `${sizes.join(" x ")} NPS in`, spec: s?.id ?? "", material: f?.material ?? s?.material ?? "", schedule: f?.schedule ?? s?.schedule ?? "" };
    if (n.kind !== "weld") items.push(item({ ...base, type: n.kind.toUpperCase(), scope: f?.shopField === "F" ? "field" : f?.shopField === "S" ? "shop" : "unknown", itemCode: f?.partCode ?? n.component ?? f?.component ?? n.catalogId ?? "", description: n.description ?? f?.description ?? n.kind, quantity: n.quantity ?? 1, refs: [ref("nodes", n.id)] }));
    if (["support", "gasket", "bolt"].includes(n.kind)) continue;
    const ports = edges.map(r => ({ r, prep: connection((r.from === n.id ? r.fromPrep : r.toPrep) ?? r.endPrep), field: (r.from === n.id ? r.fromField : r.toField) ?? n.field }));
    if (n.kind === "weld") {
      const fields = ports.map(p => p.field).filter(v => v !== undefined);
      const scope = fields.length && fields.every(v => v === fields[0]) ? (fields[0] ? "field" : "shop") : n.field === undefined ? "unknown" : n.field ? "field" : "shop";
      items.push(item({ ...base, type: "JOINT", skey: "WELD", scope, refs: [ref("nodes", n.id)], basis: "explicit weld node" }));
      continue;
    }
    if (!ports.length) unknown.push({ reason: `Node ${n.id}: no connected runs or end-connection semantics`, refs: [ref("nodes", n.id)] });
    for (const p of ports) {
      if (p.r.connector) continue; // Handled once per connector below.
      if (((p.r.from === n.id ? p.r.fromPrep : p.r.toPrep) ?? p.r.endPrep) === "PLAIN") continue;
      if (!p.prep) { unknown.push({ reason: `Node ${n.id}, run ${p.r.id}: end-connection type unknown`, refs: [ref("nodes", n.id), ref("runs", p.r.id)] }); continue; }
      items.push(item({ ...base, size: `${p.r.nps} NPS in`, type: "JOINT", skey: p.prep, scope: p.field === undefined ? "unknown" : p.field ? "field" : "shop", basis: n.branchEdgeId === p.r.id ? "explicit branch end preparation" : "explicit connected run end preparation", refs: [ref("nodes", n.id), ref("runs", p.r.id)] }));
    }
  }
  for (const r of doc.runs.filter(r => r.connector)) {
    const a = nodes.get(r.from)!, b = nodes.get(r.to)!;
    if (a.kind === "weld" || b.kind === "weld") continue;
    if ((r.fromPrep ?? r.endPrep) === "PLAIN" && (r.toPrep ?? r.endPrep) === "PLAIN") continue;
    const from = connection(r.fromPrep ?? r.endPrep), to = connection(r.toPrep ?? r.endPrep);
    if (!from || from !== to) { unknown.push({ reason: `Connector ${r.id}: missing or conflicting end preparations`, refs: [ref("runs", r.id)] }); continue; }
    const fields = [r.fromField ?? a.field, r.toField ?? b.field].filter(v => v !== undefined);
    items.push(item({ type: "JOINT", size: `${r.nps} NPS in`, spec: r.specId, skey: from, scope: fields.length && fields.every(v => v === fields[0]) ? fields[0] ? "field" : "shop" : "unknown", basis: "explicit connector end preparations", refs: [ref("runs", r.id)] }));
  }
  return aggregateMto("piping", items, unknown, warnings);
}
