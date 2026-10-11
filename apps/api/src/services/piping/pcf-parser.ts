import { aggregateMto, connection, item, type MtoItem, type PipingMto, type SourceRef } from "./mto.js";

type RecordBlock = { type: string; line: number; endLine: number; pipeline: string; spec: string; fields: Map<string, string[]> };
const components = /^(PIPE|ELBOW|BEND|TEE|CROSS|FLANGE(?:-.+)?|VALVE(?:-.+)?|REDUCER(?:-.+)?|OLET|WELD|GASKET|BOLT|SUPPORT|CAP|COUPLING|UNION|NIPPLE|PLUG|INSTRUMENT(?:-.+)?)$/;
const coordFactors: Record<string, number> = { MM: 0.001, M: 1, INCH: 0.0254, "MM-HUNDREDTHS": 0.00001, "INCH-SIXTEENTHS": 0.0254 / 16 };
const numeric = (s: string) => /^\d+\/\d+$/.test(s) ? Number(s.split("/")[0]) / Number(s.split("/")[1]) : Number(s);

export function parsePcf(text: string): PipingMto {
  const blocks: RecordBlock[] = [], materials = new Map<string, Map<string, string[]>>();
  let current: RecordBlock | undefined, materialFields: Map<string, string[]> | undefined;
  let inMaterials = false, coordinateUnit = "", boreUnit = "", pipeline = "", spec = "";
  for (const [i, raw] of text.replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [key, ...rest] = line.split(/\s+/), value = rest.join(" ");
    if (key === "MATERIALS") { inMaterials = true; current = undefined; continue; }
    if (inMaterials) {
      if (key === "MATERIAL-IDENTIFIER" || key === "ITEM-CODE" && (!materialFields?.has("MATERIAL-IDENTIFIER") || materialFields.has("ITEM-CODE"))) { materialFields = new Map([[key, [value]]]); materials.set(value, materialFields); }
      else if (materialFields) {
        materialFields.set(key, [...(materialFields.get(key) ?? []), value]);
        if (key === "ITEM-CODE") materials.set(value, materialFields);
      }
      continue;
    }
    if (key === "UNITS-CO-ORDS") { coordinateUnit = value; continue; }
    if (key === "UNITS-BORE") { boreUnit = value; continue; }
    if (key === "PIPELINE-REFERENCE") { pipeline = value; spec = ""; current = undefined; continue; }
    if (components.test(key) && !value) {
      current = { type: key, line: i + 1, endLine: i + 1, pipeline, spec, fields: new Map() };
      blocks.push(current); continue;
    }
    // Non-component top-level records (messages, dimensions, etc.) are not MTO items.
    if (!/^\s/.test(raw) && !value && !["FABRICATION-ITEM", "ERECTION-ITEM", "SHOP-WELD", "FIELD-WELD"].includes(key)) { current = undefined; continue; }
    if (key === "PIPING-SPEC" && !current) spec = value;
    if (current) { current.fields.set(key, [...(current.fields.get(key) ?? []), value]); current.endLine = i + 1; }
  }
  const warnings: string[] = [], unknown: PipingMto["joints"]["unknown"] = [], items: MtoItem[] = [];
  if (!blocks.length) warnings.push("No supported PCF components found.");
  const points = new Map<string, Array<{ block: RecordBlock; type?: string; ref: SourceRef; size: string }>>();
  const explicitWeldLocations = new Set<string>();
  for (const b of blocks) {
    const get = (key: string) => b.fields.get(key)?.[0] ?? "";
    const ref = { id: `pcf:${b.line}`, line: b.line, endLine: b.endLine };
    const material = materials.get(get("MATERIAL-IDENTIFIER") || get("ITEM-CODE"));
    const skey = get("SKEY");
    const coords = ["END-POINT", "BRANCH1-POINT", "BRANCH2-POINT"].flatMap(key => (b.fields.get(key) ?? []).map(p => ({ key, values: p.split(/\s+/) })));
    const ends = coords.filter(p => p.key === "END-POINT");
    const sizes = [...new Set(coords.map(p => p.values[3]).filter(Boolean))];
    const scope = b.fields.has("FIELD-WELD") || /^(FIELD|F)$/i.test(get("SHOP-FIELD")) || /^WF/.test(skey) ? "field" : b.fields.has("SHOP-WELD") || /^(SHOP|S)$/i.test(get("SHOP-FIELD")) || /^WS/.test(skey) ? "shop" : b.fields.has("FABRICATION-ITEM") ? "fabrication" : b.fields.has("ERECTION-ITEM") ? "erection" : "unknown";
    const base = { spec: get("PIPING-SPEC") || b.spec, size: sizes.length ? `${sizes.join(" x ")} ${boreUnit || "unknown bore unit"}` : "unknown", material: get("MATERIAL") || material?.get("MATERIAL")?.[0] || "", skey, itemCode: get("ITEM-CODE") || material?.get("ITEM-CODE")?.[0] || "", description: get("ITEM-DESCRIPTION") || material?.get("DESCRIPTION")?.[0] || material?.get("ITEM-DESCRIPTION")?.[0] || b.type, scope, refs: [ref] };
    let quantity: number | null = 1;
    if (b.type === "PIPE") {
      const a = ends[0]?.values.slice(0, 3).map(numeric), c = ends[1]?.values.slice(0, 3).map(numeric), factor = coordFactors[coordinateUnit];
      quantity = factor && ends.length === 2 && a?.length === 3 && c?.length === 3 && [...a, ...c].every(Number.isFinite) ? Math.hypot(...a.map((v, i) => v - c[i])) * factor : null;
      if (quantity === null) warnings.push(`Line ${b.line}: pipe length unknown; missing/invalid endpoints or unsupported coordinate units ${coordinateUnit || "(absent)"}.`);
    } else if (get("QUANTITY")) {
      quantity = numeric(get("QUANTITY"));
      if (!Number.isFinite(quantity) || quantity < 0) throw new Error(`Invalid QUANTITY at line ${b.line}`);
    }
    items.push(item({ ...base, type: b.type === "WELD" ? "JOINT" : b.type, quantity, unit: b.type === "PIPE" ? "m" : "EA", basis: b.type === "PIPE" ? "PCF pipe endpoint distance" : "explicit component" }));
    for (const p of coords) {
      const xyz = p.values.slice(0, 3).map(numeric);
      if (xyz.length !== 3 || !xyz.every(Number.isFinite)) { warnings.push(`Line ${b.line}: invalid endpoint coordinates.`); continue; }
      const key = `${b.pipeline}:${xyz.join(",")}`;
      if (b.type === "WELD") { explicitWeldLocations.add(key); continue; }
      if (["BOLT", "GASKET", "SUPPORT"].includes(b.type)) continue;
      const type = connection(p.values[4]) ?? connection(get(p.key === "END-POINT" ? "END-CONNECTION" : "BRANCH-CONNECTION")) ?? connection(skey.slice(-2));
      points.set(key, [...(points.get(key) ?? []), { block: b, type, ref, size: `${p.values[3] ?? "unknown"} ${boreUnit || "unknown bore unit"}` }]);
    }
    if (!coords.length && !["WELD", "BOLT", "GASKET", "SUPPORT"].includes(b.type)) unknown.push({ reason: `Line ${b.line}: connection endpoints absent`, refs: [ref] });
  }
  for (const [key, ports] of points) {
    if (explicitWeldLocations.has(key)) continue;
    const refs = [...new Map(ports.map(p => [p.ref.id, p.ref])).values()];
    if (ports.length === 2 && ports[0].block !== ports[1].block && ports[0].type && ports[0].type === ports[1].type && ports[0].size === ports[1].size) {
      items.push(item({ type: "JOINT", size: ports[0].size, skey: ports[0].type, basis: "shared endpoint with explicit matching end connections", refs }));
    } else unknown.push({ reason: `Connection ${key}: ${ports.some(p => !p.type) ? "end-connection semantics absent" : ports.length === 1 ? "mating endpoint absent" : "ambiguous or conflicting endpoints"}`, refs });
  }
  return aggregateMto("pcf", items, unknown, warnings);
}
