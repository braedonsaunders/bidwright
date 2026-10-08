import type { GridSettings } from './grid'
/** BidWright-authored piping semantics. Coordinates and fabrication lengths are millimetres. */
export type Vec3 = [number, number, number]
export type Kind =
  | 'end'
  | 'elbow90'
  | 'elbow45'
  | 'tee'
  | 'flange'
  | 'valve'
  | 'reducer'
  | 'cap'
  | 'support'
  | 'weld'
  | 'olet'
  | 'gasket'
  | 'bolt'
export interface CatalogItem {
  id: string
  kind: Kind
  nps: number
  smallerNps?: number
  description: string
  takeout: number
  branchTakeout?: number
  weightKg?: number
  areaM2?: number
  unitCost?: number
  laborHours?: number
  source: string
}
export interface PipeSize {
  nps: number
  od: number
  wall: number
  kgM: number
}
export interface PipeSpec {
  id: string
  name: string
  material: string
  schedule: string
  rating: string
  sizes: PipeSize[]
  fittings: CatalogItem[]
  rootGap: number
  density: number
  pipeCostM: number
  weldHoursPerDiameterInch: number
  pipeLaborHoursM: number
}
export interface PipeNode {
  id: string
  position: Vec3
  kind: Kind
  catalogId?: string
  description?: string
  takeout?: number
  branchTakeout?: number
  portTakeouts?: Record<string, number>
  branchEdgeId?: string
  weightKg?: number
  areaM2?: number
  unitCost?: number
  laborHours?: number
  heat?: string
  field?: boolean
  tag?: string
  associatedRunId?: string
  quantity?: number
  endPrep?: 'BW' | 'SW' | 'THD' | 'PLAIN'
  /** Schematic-only displacement, independent of the physical coordinates. */
  labelOffset?: [number, number]
}
export type EndPrep = 'BW' | 'SW' | 'THD' | 'PLAIN'
export interface PipeRun {
  id: string
  from: string
  to: string
  specId: string
  nps: number
  spool: string
  line: string
  heat: string
  connector?: boolean
  fromPrep?: EndPrep
  toPrep?: EndPrep
  fromField?: boolean
  toField?: boolean
  fromTag?: string
  toTag?: string
  rootGap?: number
  endPrep: 'BW' | 'SW' | 'THD' | 'PLAIN'
}
export interface IsoDocument {
  schema: 'bidwright-piping'
  version: 1
  title: string
  drawing: string
  revision: string
  customer: string
  project: string
  drawnBy: string
  checkedBy: string
  notes: string
  units: 'mm' | 'imperial'
  north: number
  dimensionMode: 'overall' | 'cut' | 'both'
  grid?: GridSettings
  paper?: 'letter' | 'tabloid' | 'a3' | 'a4'
  outputViews?: Array<'iso' | 'plan' | 'front' | 'side'>
  specs: PipeSpec[]
  nodes: PipeNode[]
  runs: PipeRun[]
  weldStart: number
  weldPrefix: string
  weldNumbering?: 'numeric' | 'alphabetic'
}
export interface RunResult {
  run: PipeRun
  overall: number
  cut: number
  takeouts: [number, number]
  gaps: [number, number]
  weightKg: number
  areaM2: number
}
export interface Weld {
  tag: string
  runId: string
  nodeId: string
  nps: number
  field: boolean
  prep: string
  position: Vec3
}
export interface BomRow {
  item: number
  description: string
  spec: string
  nps: number
  qty: number
  unit: 'm' | 'ea'
  weightKg: number | null
  areaM2: number | null
  cost: number
  hours: number
  heat: string
  spool: string
  line: string
  materialKey?: string
  memberIds?: string[]
}
export const id = () => crypto.randomUUID()
export const sub = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2]
]
export const add = (a: Vec3, b: Vec3): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2]
]
export const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
export const length = (a: Vec3) => Math.hypot(...a)
export const distance = (a: Vec3, b: Vec3) => length(sub(a, b))
export const round = (v: number, d = 2) => Number(v.toFixed(d))
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
// Dimensional facts: Wheatland Schedule 40 submittal and Weldbend catalogue, 63rd ed.
// Original data selection and original symbols; no PROCAD trial assets are used.
const lrWeights = [0.4, 0.55, 0.8, 1.6, 3.2, 4.8, 6.6, 8.9, 15.1, 24.0, 47.8]
const lr45Takeouts = [0.88, 1, 1.12, 1.38, 1.75, 2, 2.25, 2.5, 3.12, 3.75, 5]
const lr45Weights = [
  0.22, 0.33, 0.43, 0.85, 1.7, 2.5, 3.4, 4.5, 7.5, 11.7, 23.3
]
const teeTakeouts = [1.5, 1.88, 2.25, 2.5, 3, 3.38, 3.75, 4.12, 4.88, 5.62, 7]
const teeWeights = [0.75, 1.3, 1.9, 3.2, 5.8, 7.2, 9.5, 12.7, 20.8, 33.1, 56.5]
const capHeight = [1.5, 1.5, 1.5, 1.5, 1.5, 2, 2.5, 2.5, 3, 3.5, 4]
const capWeights = [0.21, 0.33, 0.54, 0.8, 1, 1.7, 2.3, 2.8, 4.6, 6.9, 11.8]
const gateValves = [
  [2, 215.9, 18],
  [2.5, 241.3, 21],
  [3, 282.45, 30],
  [4, 304.8, 44],
  [5, 381, 54],
  [6, 403.35, 76],
  [8, 419.1, 126]
]
const srWeights = [0.3, 0.4, 0.5, 1.0, 2.0, 3.0, 4.3, 6.1, 9.7, 16.7, 32.4]
const rows = [
  [1, 33.4, 3.38, 1.68],
  [1.25, 42.2, 3.56, 2.27],
  [1.5, 48.3, 3.68, 2.72],
  [2, 60.3, 3.91, 3.66],
  [2.5, 73, 5.16, 5.8],
  [3, 88.9, 5.49, 7.58],
  [3.5, 101.6, 5.74, 9.12],
  [4, 114.3, 6.02, 10.8],
  [5, 141.3, 6.55, 14.63],
  [6, 168.3, 7.11, 18.99],
  [8, 219.1, 8.18, 28.58]
]
export function defaultSpec(): PipeSpec {
  return {
    id: 'CS40',
    name: 'Carbon steel · Schedule 40',
    material: 'Carbon steel',
    schedule: '40',
    rating: 'Project specified',
    rootGap: 3,
    density: 7850,
    pipeCostM: 0,
    pipeLaborHoursM: 0,
    weldHoursPerDiameterInch: 0,
    sizes: rows.map(([nps, od, wall, lbFt]) => ({
      nps,
      od,
      wall,
      kgM: (lbFt * 0.45359237) / 0.3048
    })),
    fittings: [
      ...rows.flatMap(([nps, od], i) => [
        {
          id: `LR90-${nps}`,
          kind: 'elbow90' as Kind,
          nps,
          description: '90° long-radius butt-weld elbow',
          takeout: nps * 38.1,
          weightKg: lrWeights[i] * 0.45359237,
          areaM2: (Math.PI * od * ((Math.PI / 2) * nps * 38.1)) / 1e6,
          source:
            'Weldbend, 63rd edition, p26; nominal centre-to-end, approximate manufacturer weight; nominal tube surface.'
        },
        {
          id: `SR90-${nps}`,
          kind: 'elbow90' as Kind,
          nps,
          description: '90° short-radius butt-weld elbow',
          takeout: nps * 25.4,
          weightKg: srWeights[i] * 0.45359237,
          areaM2: (Math.PI * od * ((Math.PI / 2) * nps * 25.4)) / 1e6,
          source:
            'Weldbend, 63rd edition, p29; nominal centre-to-end, approximate manufacturer weight; nominal tube surface.'
        },
        {
          id: `LR45-${nps}`,
          kind: 'elbow45' as Kind,
          nps,
          description: '45° long-radius butt-weld elbow',
          takeout: lr45Takeouts[i] * 25.4,
          weightKg: lr45Weights[i] * 0.45359237,
          source:
            'Weldbend, 63rd edition, p38; centre-to-end in inches; approximate manufacturer weight.'
        },
        {
          id: `TEE-${nps}`,
          kind: 'tee' as Kind,
          nps,
          description: 'Equal butt-weld tee',
          takeout: teeTakeouts[i] * 25.4,
          branchTakeout: teeTakeouts[i] * 25.4,
          weightKg: teeWeights[i] * 0.45359237,
          source:
            'Weldbend, 63rd edition, p49; nominal centre-to-end, approximate manufacturer weight.'
        },
        {
          id: `CAP-${nps}`,
          kind: 'cap' as Kind,
          nps,
          description: 'Butt-weld cap',
          takeout: capHeight[i] * 25.4,
          weightKg: capWeights[i] * 0.45359237,
          source:
            'Weldbend, 63rd edition, p76; node at outer end of cap, takeout is cap height; approximate manufacturer weight.'
        }
      ]),
      ...gateValves.map(([nps, faceToFace, weightKg]) => ({
        id: `GATE150BW-${nps}`,
        kind: 'valve' as Kind,
        nps,
        description: 'Bonney Forge Class 150 butt-weld gate valve',
        takeout: faceToFace / 2,
        weightKg,
        source:
          'Bonney Forge Cast Steel Valves catalogue, Gate Valves Class 150; L1 (BW) end-to-end / 2, WT (BW).'
      }))
    ]
  }
}
export function newIso(): IsoDocument {
  return {
    schema: 'bidwright-piping',
    version: 1,
    title: 'Piping isometric',
    drawing: 'ISO-001',
    revision: '0',
    customer: '',
    project: '',
    drawnBy: '',
    checkedBy: '',
    notes: '',
    units: 'mm',
    north: 0,
    dimensionMode: 'both',
    specs: [defaultSpec()],
    nodes: [],
    runs: [],
    weldStart: 1,
    weldPrefix: 'W'
  }
}
export function getNode(doc: IsoDocument, key: string): PipeNode {
  const node = doc.nodes.find(n => n.id === key)
  if (!node) throw new Error(`Missing connection ${key}`)
  return node
}
export function getSpec(doc: IsoDocument, key: string): PipeSpec {
  const spec = doc.specs.find(s => s.id === key)
  if (!spec) throw new Error(`Missing pipe specification ${key}`)
  return spec
}
export function fitting(
  doc: IsoDocument,
  node: PipeNode
): CatalogItem | undefined {
  return doc.specs.flatMap(s => s.fittings).find(f => f.id === node.catalogId)
}
export function takeout(
  doc: IsoDocument,
  node: PipeNode,
  runId: string
): number | undefined {
  if (node.kind === 'end' || node.kind === 'weld' || node.kind === 'support')
    return 0
  if (node.portTakeouts?.[runId] != null) return node.portTakeouts[runId]
  if (node.branchEdgeId === runId)
    return node.branchTakeout ?? fitting(doc, node)?.branchTakeout
  return node.takeout ?? fitting(doc, node)?.takeout
}
export function prepAt(run: PipeRun, index: number): EndPrep {
  return (index === 0 ? run.fromPrep : run.toPrep) ?? run.endPrep
}
export function runResult(doc: IsoDocument, run: PipeRun): RunResult {
  const a = getNode(doc, run.from),
    b = getNode(doc, run.to),
    spec = getSpec(doc, run.specId),
    size = spec.sizes.find(s => s.nps === run.nps)
  const overall = distance(a.position, b.position)
  const ts: [number, number] = [
    takeout(doc, a, run.id) ?? NaN,
    takeout(doc, b, run.id) ?? NaN
  ]
  const gaps: [number, number] = [a, b].map((n, i) =>
    prepAt(run, i) === 'BW' &&
    n.kind !== 'end' &&
    n.kind !== 'support' &&
    n.kind !== 'gasket' &&
    n.kind !== 'bolt'
      ? (run.rootGap ?? spec.rootGap) / (n.kind === 'weld' ? 2 : 1)
      : 0
  ) as [number, number]
  const cut = overall - ts[0] - ts[1] - gaps[0] - gaps[1]
  return {
    run,
    overall,
    cut,
    takeouts: ts,
    gaps,
    weightKg: size ? (size.kgM * cut) / 1000 : NaN,
    areaM2: size ? (Math.PI * size.od * cut) / 1e6 : NaN
  }
}
export function connected(doc: IsoDocument, nodeId: string): PipeRun[] {
  return doc.runs.filter(r => r.from === nodeId || r.to === nodeId)
}
export function setAutoFitting(doc: IsoDocument, nodeId: string): void {
  const node = getNode(doc, nodeId),
    edges = connected(doc, nodeId)
  if (
    edges.length === 2 &&
    (node.kind === 'end' || node.kind === 'elbow90' || node.kind === 'elbow45')
  ) {
    const vectors = edges.map(r =>
      sub(
        getNode(doc, r.from === nodeId ? r.to : r.from).position,
        node.position
      )
    )
    const angle =
      (Math.acos(
        Math.max(
          -1,
          Math.min(
            1,
            vectors[0].reduce((s, v, i) => s + v * vectors[1][i], 0) /
              (length(vectors[0]) * length(vectors[1]))
          )
        )
      ) *
        180) /
      Math.PI
    if (Math.abs(angle - 180) < 0.1) {
      node.kind = 'weld'
      delete node.catalogId
      return
    }
    node.kind = Math.abs(angle - 135) < 0.1 ? 'elbow45' : 'elbow90'
    node.catalogId = getSpec(doc, edges[0].specId).fittings.find(
      f => f.kind === node.kind && f.nps === edges[0].nps
    )?.id
    if (node.kind === 'elbow90' && Math.abs(angle - 90) > 0.1) {
      delete node.catalogId
      delete node.takeout
      node.description = `${round(180 - angle)}° bend · enter centre-to-end`
    }
  } else if (
    edges.length === 3 &&
    ['end', 'weld', 'elbow90', 'elbow45'].includes(node.kind)
  ) {
    node.kind = 'tee'
    node.catalogId = getSpec(doc, edges[0].specId).fittings.find(
      f => f.kind === 'tee' && f.nps === edges[0].nps
    )?.id
    const branch = edges.find(r => {
      const v = sub(
        getNode(doc, r.from === nodeId ? r.to : r.from).position,
        node.position
      )
      return edges
        .filter(e => e !== r)
        .every(e => {
          const o = sub(
            getNode(doc, e.from === nodeId ? e.to : e.from).position,
            node.position
          )
          return (
            Math.abs(
              v.reduce((sum, n, i) => sum + n * o[i], 0) /
                (length(v) * length(o))
            ) < 0.001
          )
        })
    })
    node.branchEdgeId = branch?.id
  }
}
export function appendRun(
  doc: IsoDocument,
  fromId: string | null,
  delta: Vec3,
  specId: string,
  nps: number,
  spool: string,
  line: string
): PipeNode {
  if (length(delta) <= 0) throw new Error('Enter a positive length.')
  let a = fromId ? getNode(doc, fromId) : undefined
  if (!a) {
    a = { id: id(), position: [0, 0, 0], kind: 'end' }
    doc.nodes.push(a)
  }
  const position = add(a.position, delta),
    existing = doc.nodes.find(n => distance(n.position, position) < 0.001)
  const b = existing ?? { id: id(), position, kind: 'end' as Kind }
  if (
    doc.runs.some(
      r =>
        (r.from === a!.id && r.to === b.id) ||
        (r.to === a!.id && r.from === b.id)
    )
  )
    throw new Error('A pipe already connects these points.')
  if (!existing) doc.nodes.push(b)
  doc.runs.push({
    id: id(),
    from: a.id,
    to: b.id,
    specId,
    nps,
    spool,
    line,
    heat: '',
    endPrep: 'BW'
  })
  setAutoFitting(doc, a.id)
  setAutoFitting(doc, b.id)
  return b
}
/** Inserts an in-line component at a physical fraction; pipe ends remain fixed. */
export function insertComponent(
  doc: IsoDocument,
  runId: string,
  kind: Kind,
  fraction = 0.5
): PipeNode {
  if (!(fraction > 0 && fraction < 1))
    throw new Error('Position must be between the pipe ends.')
  const r = doc.runs.find(r => r.id === runId)
  if (!r) throw new Error('Select a pipe.')
  const node: PipeNode = {
    id: id(),
    position: add(
      getNode(doc, r.from).position,
      mul(
        sub(getNode(doc, r.to).position, getNode(doc, r.from).position),
        fraction
      )
    ),
    kind
  }
  doc.nodes.push(node)
  const previous = r.to,
    next = { ...r, id: id(), from: node.id, to: previous }
  delete next.fromPrep
  delete next.fromField
  delete next.fromTag
  r.to = node.id
  delete r.toPrep
  delete r.toField
  delete r.toTag
  const oldEnd = getNode(doc, previous)
  if (oldEnd.portTakeouts?.[runId] != null) {
    oldEnd.portTakeouts[next.id] = oldEnd.portTakeouts[runId]
    delete oldEnd.portTakeouts[runId]
  }
  if (oldEnd.branchEdgeId === runId) oldEnd.branchEdgeId = next.id
  doc.runs.push(next)
  return node
}
export function attachComponent(
  doc: IsoDocument,
  runId: string,
  kind: Kind,
  fraction = 0.5
): PipeNode {
  const r = doc.runs.find(r => r.id === runId)
  if (!r) throw new Error('Select a pipe.')
  if (!(fraction >= 0 && fraction <= 1))
    throw new Error('Position must be on the pipe.')
  const node: PipeNode = {
    id: id(),
    kind,
    position: add(
      getNode(doc, r.from).position,
      mul(
        sub(getNode(doc, r.to).position, getNode(doc, r.from).position),
        fraction
      )
    ),
    associatedRunId: runId
  }
  doc.nodes.push(node)
  return node
}
/** Spreadsheet-style letters provide a stable A..Z, AA..AZ weld sequence. */
export function weldNumber(
  value: number,
  mode: IsoDocument['weldNumbering'] = 'numeric'
): string {
  if (mode !== 'alphabetic') return String(value)
  let text = ''
  while (value > 0) {
    value--
    text = String.fromCharCode(65 + (value % 26)) + text
    value = Math.floor(value / 26)
  }
  return text
}
export function welds(doc: IsoDocument): Weld[] {
  let seq = doc.weldStart
  const out: Weld[] = []
  for (const r of doc.runs) {
    for (const [index, key] of [r.from, r.to].entries()) {
      const n = getNode(doc, key)
      if (
        n.kind === 'end' ||
        n.kind === 'support' ||
        n.kind === 'gasket' ||
        n.kind === 'bolt' ||
        prepAt(r, index) === 'PLAIN' ||
        prepAt(r, index) === 'THD'
      )
        continue
      // A zero-length butt joint represented as a WELD node gets one weld, not two.
      if (n.kind === 'weld' && out.some(w => w.nodeId === n.id)) continue
      const t = takeout(doc, n, r.id) ?? 0
      const other = getNode(doc, index === 0 ? r.to : r.from)
      const vector = sub(other.position, n.position)
      const position =
        n.kind === 'weld'
          ? n.position
          : add(
              n.position,
              mul(
                vector,
                (t + (r.connector ? 0 : runResult(doc, r).gaps[index] / 2)) /
                  (length(vector) || 1)
              )
            )
      if (
        r.connector &&
        out.some(w => distance(w.position, position) < 0.001 && w.nps === r.nps)
      )
        continue
      const tag =
        (index === 0 ? r.fromTag : r.toTag) ??
        (n.kind === 'weld' ? n.tag : undefined)
      out.push({
        tag: tag ?? `${doc.weldPrefix}${weldNumber(seq++, doc.weldNumbering)}`,
        runId: r.id,
        nodeId: n.id,
        nps: r.nps,
        field: (index === 0 ? r.fromField : r.toField) ?? !!n.field,
        prep: prepAt(r, index),
        position
      })
    }
  }
  return out
}
export function validateIso(doc: IsoDocument): string[] {
  const issues: string[] = []
  const seen = new Set<string>()
  for (const n of doc.nodes) {
    if (seen.has(n.id)) issues.push('Duplicate connection ID.')
    seen.add(n.id)
    if (n.position.some(v => !Number.isFinite(v)))
      issues.push('Invalid connection coordinate.')
  }
  for (const r of doc.runs) {
    try {
      const result = runResult(doc, r),
        spec = getSpec(doc, r.specId)
      if (!spec.sizes.some(s => s.nps === r.nps))
        issues.push(`${r.spool}: NPS ${r.nps} is missing from ${spec.name}.`)
      if (!Number.isFinite(result.cut))
        issues.push(
          `${r.spool}: Enter fitting takeouts for ${getNode(doc, r.from).kind}/${getNode(doc, r.to).kind}.`
        )
      else if (!r.connector && result.cut <= 0)
        issues.push(
          `${r.spool}: Pipe cut length is ${round(result.cut)} mm; check measurements and takeouts.`
        )
      if (!r.spool.trim()) issues.push('Every pipe needs a spool number.')
    } catch (e) {
      issues.push(String(e))
    }
  }
  for (const n of doc.nodes) {
    const degree = connected(doc, n.id).length
    if (n.kind === 'tee' && degree !== 3)
      issues.push('A tee needs three connected pipes.')
    if (
      (n.kind === 'valve' ||
        n.kind === 'reducer' ||
        n.kind.startsWith('elbow')) &&
      degree !== 2
    )
      issues.push(`${n.kind} needs two connected pipes.`)
    if (n.kind === 'tee' && degree === 3 && !n.branchEdgeId)
      issues.push('Select the branch pipe for each tee.')
    const edges = connected(doc, n.id)
    const angleBetween = (a: PipeRun, b: PipeRun) => {
      const vector = (r: PipeRun) =>
        sub(getNode(doc, r.from === n.id ? r.to : r.from).position, n.position)
      const u = vector(a),
        v = vector(b),
        denominator = length(u) * length(v)
      return denominator
        ? (Math.acos(
            Math.max(
              -1,
              Math.min(
                1,
                u.reduce((sum, value, i) => sum + value * v[i], 0) / denominator
              )
            )
          ) *
            180) /
            Math.PI
        : NaN
    }
    if ((n.kind === 'elbow90' || n.kind === 'elbow45') && degree === 2) {
      const bend = 180 - angleBetween(edges[0], edges[1]),
        expected = n.kind === 'elbow90' ? 90 : 45
      if (!Number.isFinite(bend) || Math.abs(bend - expected) > 1)
        issues.push(
          `${n.kind}: connected directions must form a ${expected} degree bend.`
        )
    }
    if (
      ['valve', 'reducer', 'weld'].includes(n.kind) &&
      degree === 2 &&
      Math.abs(angleBetween(edges[0], edges[1]) - 180) > 1
    )
      issues.push(`${n.kind}: the two pipe connections must be in line.`)
    if (n.kind === 'tee' && degree === 3 && n.branchEdgeId) {
      const main = edges.filter(r => r.id !== n.branchEdgeId),
        branch = edges.find(r => r.id === n.branchEdgeId)!
      if (
        Math.abs(angleBetween(main[0], main[1]) - 180) > 1 ||
        Math.abs(angleBetween(main[0], branch) - 90) > 1
      )
        issues.push(
          'Tee: main pipes must be in line and the branch perpendicular.'
        )
    }
    if (
      n.kind === 'reducer' &&
      degree === 2 &&
      connected(doc, n.id)[0].nps === connected(doc, n.id)[1].nps
    )
      issues.push('Reducer connections must use different pipe sizes.')
  }
  const tags = welds(doc).map(w => w.tag)
  if (new Set(tags).size !== tags.length)
    issues.push('Weld tags must be unique.')
  return [...new Set(issues)]
}
export function bom(
  doc: IsoDocument,
  group: 'spool' | 'line' | 'global' = 'spool'
): BomRow[] {
  const map = new Map<string, BomRow>()
  function addRow(row: Omit<BomRow, 'item'>, identity = '', memberId = '') {
    const key = JSON.stringify([
      identity,
      row.description,
      row.spec,
      row.nps,
      row.heat,
      group === 'global' ? '' : row.line,
      group === 'spool' ? row.spool : ''
    ])
    const found = map.get(key)
    if (found) {
      found.memberIds?.push(memberId)
      found.qty += row.qty
      found.cost += row.cost
      found.hours += row.hours
      found.weightKg =
        found.weightKg == null || row.weightKg == null
          ? null
          : found.weightKg + row.weightKg
      found.areaM2 =
        found.areaM2 == null || row.areaM2 == null
          ? null
          : found.areaM2 + row.areaM2
    } else
      map.set(key, {
        ...row,
        materialKey: identity,
        memberIds: [memberId],
        item: map.size + 1
      })
  }
  for (const r of doc.runs.filter(r => !r.connector)) {
    const s = getSpec(doc, r.specId),
      v = runResult(doc, r),
      metres = Number.isFinite(v.cut) && v.cut > 0 ? v.cut / 1000 : NaN
    addRow(
      {
        description: `Pipe · ${s.material} · Sch ${s.schedule}`,
        spec: s.id,
        nps: r.nps,
        qty: metres,
        unit: 'm',
        weightKg:
          Number.isFinite(metres) && Number.isFinite(v.weightKg)
            ? v.weightKg
            : null,
        areaM2:
          Number.isFinite(metres) && Number.isFinite(v.areaM2)
            ? v.areaM2
            : null,
        cost: Number.isFinite(metres) ? metres * s.pipeCostM : 0,
        hours: Number.isFinite(metres) ? metres * s.pipeLaborHoursM : 0,
        heat: r.heat,
        spool: r.spool,
        line: r.line
      },
      '',
      r.id
    )
  }
  for (const n of doc.nodes.filter(
    n => n.kind !== 'end' && n.kind !== 'weld'
  )) {
    const edge =
      connected(doc, n.id)[0] ?? doc.runs.find(r => r.id === n.associatedRunId)
    if (!edge) continue
    const s = getSpec(doc, edge.specId),
      f = fitting(doc, n),
      qty = n.quantity ?? 1
    const kg = n.weightKg ?? f?.weightKg,
      area = n.areaM2 ?? f?.areaM2
    addRow(
      {
        description: n.description ?? f?.description ?? n.kind,
        spec: s.id,
        nps: edge.nps,
        qty,
        unit: 'ea',
        weightKg: kg == null ? null : kg * qty,
        areaM2: area == null ? null : area * qty,
        cost: (n.unitCost ?? f?.unitCost ?? 0) * qty,
        hours: (n.laborHours ?? f?.laborHours ?? 0) * qty,
        heat: n.heat ?? '',
        spool: edge.spool,
        line: edge.line
      },
      JSON.stringify([
        n.catalogId ?? '',
        n.takeout ?? f?.takeout,
        n.branchTakeout ?? f?.branchTakeout,
        kg,
        area,
        n.unitCost ?? f?.unitCost,
        n.laborHours ?? f?.laborHours,
        n.portTakeouts
          ? Object.values(n.portTakeouts).sort((a, b) => a - b)
          : null
      ]),
      n.id
    )
  }
  return [...map.values()]
}
export function formatLength(mm: number, units: IsoDocument['units']): string {
  if (!Number.isFinite(mm)) return '—'
  if (units === 'mm') return `${round(mm, 1)} mm`
  const sixteenths = Math.round((mm / 25.4) * 16),
    feet = Math.floor(sixteenths / 192),
    inch = Math.floor((sixteenths % 192) / 16),
    fraction = sixteenths % 16
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  const g = gcd(fraction, 16)
  return `${feet ? feet + '′ ' : ''}${inch}${fraction ? ' ' + fraction / g + '/' + 16 / g : ''}″`
}
export function parseLength(
  value: string,
  units: IsoDocument['units']
): number {
  const s = value.trim().replace(/[′']/g, 'ft').replace(/[″"]/g, 'in')
  if (!s) throw new Error('Enter a length.')
  if (units === 'mm' && /^\d+(\.\d+)?$/.test(s)) return Number(s)
  if (/^\d+(\.\d+)?\s*mm$/.test(s)) return parseFloat(s)
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s) * 25.4
  let feet = 0,
    inch = 0
  let rem = s
  const ft = rem.match(/^(\d+(?:\.\d+)?)\s*ft\s*/)
  if (ft) {
    feet = Number(ft[1])
    rem = rem.slice(ft[0].length)
  }
  rem = rem.replace(/in\s*$/, '').trim()
  if (rem) {
    const match = rem.match(/^(?:(\d+(?:\.\d+)?)\s*)?(?:(\d+)\/(\d+))?$/)
    if (
      !match ||
      (!match[1] && !match[2]) ||
      (match[3] && Number(match[3]) === 0)
    )
      throw new Error('Use millimetres or feet/inches, e.g. 2\' 3 1/2".')
    inch =
      Number(match[1] ?? 0) +
      (match[2] ? Number(match[2]) / Number(match[3]) : 0)
  }
  return (feet * 12 + inch) * 25.4
}
export function parseIsoJson(raw: string): IsoDocument {
  if (raw.length > 8_000_000)
    throw new Error('Piping file exceeds the 8 MB limit.')
  const d = JSON.parse(raw) as IsoDocument
  const isString = (v: unknown, max = 1000): v is string =>
    typeof v === 'string' && v.length <= max
  const positive = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0
  const nonnegative = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0
  const finite = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e10
  const optionalNumbers = (o: object, keys: string[]) =>
    keys.every(k => {
      const v = (o as Record<string, unknown>)[k]
      return v == null || nonnegative(v)
    })
  const knownKinds = [
    'end',
    'elbow90',
    'elbow45',
    'tee',
    'flange',
    'valve',
    'reducer',
    'cap',
    'support',
    'weld',
    'olet',
    'gasket',
    'bolt'
  ]
  if (
    d?.schema !== 'bidwright-piping' ||
    d.version !== 1 ||
    !Array.isArray(d.nodes) ||
    !Array.isArray(d.runs) ||
    !Array.isArray(d.specs) ||
    !d.specs.length ||
    d.nodes.length > 10000 ||
    d.runs.length > 10000 ||
    d.specs.length > 100
  )
    throw new Error('Unsupported piping document.')
  for (const k of [
    'title',
    'drawing',
    'revision',
    'customer',
    'project',
    'drawnBy',
    'checkedBy',
    'weldPrefix'
  ])
    if (!isString(d[k as keyof IsoDocument])) throw new Error(`Invalid ${k}.`)
  if (
    !isString(d.notes, 12000) ||
    !['mm', 'imperial'].includes(d.units) ||
    !['overall', 'cut', 'both'].includes(d.dimensionMode) ||
    !finite(d.north) ||
    !Number.isInteger(d.weldStart) ||
    d.weldStart < 1 ||
    (d.weldNumbering != null &&
      !['numeric', 'alphabetic'].includes(d.weldNumbering))
  )
    throw new Error('Invalid drawing settings.')
  if (
    d.grid != null &&
    (typeof d.grid.visible !== 'boolean' ||
      typeof d.grid.snap !== 'boolean' ||
      !positive(d.grid.spacing) ||
      d.grid.spacing > 1e7 ||
      !['xy', 'xz', 'yz'].includes(d.grid.plane))
  )
    throw new Error('Invalid isometric grid settings.')
  if (d.paper != null && !['letter', 'tabloid', 'a3', 'a4'].includes(d.paper))
    throw new Error('Invalid PDF paper size.')
  if (
    d.outputViews != null &&
    (!Array.isArray(d.outputViews) ||
      !d.outputViews.length ||
      d.outputViews.length > 4 ||
      new Set(d.outputViews).size !== d.outputViews.length ||
      !d.outputViews.every(v => ['iso', 'plan', 'front', 'side'].includes(v)))
  )
    throw new Error('Invalid PDF views.')
  const ids = new Set<string>()
  for (const n of d.nodes) {
    if (
      !isString(n.id) ||
      !n.id ||
      ids.has(n.id) ||
      !knownKinds.includes(n.kind) ||
      !Array.isArray(n.position) ||
      n.position.length !== 3 ||
      !n.position.every(finite) ||
      !optionalNumbers(n, [
        'takeout',
        'branchTakeout',
        'weightKg',
        'areaM2',
        'unitCost',
        'laborHours',
        'quantity'
      ])
    )
      throw new Error('Invalid piping connection.')
    ids.add(n.id)
    for (const k of [
      'catalogId',
      'description',
      'branchEdgeId',
      'heat',
      'tag',
      'associatedRunId'
    ])
      if (n[k as keyof PipeNode] != null && !isString(n[k as keyof PipeNode]))
        throw new Error('Invalid component attributes.')
    if (n.field != null && typeof n.field !== 'boolean')
      throw new Error('Invalid weld location.')
    if (
      n.labelOffset &&
      (!Array.isArray(n.labelOffset) ||
        n.labelOffset.length !== 2 ||
        !n.labelOffset.every(finite))
    )
      throw new Error('Invalid annotation offset.')
    if (
      n.portTakeouts &&
      (typeof n.portTakeouts !== 'object' ||
        Object.values(n.portTakeouts).some(v => !nonnegative(v)))
    )
      throw new Error('Invalid port takeout.')
  }
  const specs = new Set<string>(),
    catalogs = new Set<string>()
  for (const s of d.specs) {
    if (
      !isString(s.id) ||
      !s.id ||
      specs.has(s.id) ||
      !Array.isArray(s.sizes) ||
      !Array.isArray(s.fittings) ||
      s.sizes.length > 500 ||
      s.fittings.length > 10000 ||
      !nonnegative(s.rootGap) ||
      !positive(s.density) ||
      ![s.pipeCostM, s.pipeLaborHoursM, s.weldHoursPerDiameterInch].every(
        nonnegative
      )
    )
      throw new Error('Invalid pipe specification.')
    specs.add(s.id)
    for (const k of ['name', 'material', 'schedule', 'rating'])
      if (!isString(s[k as keyof PipeSpec]))
        throw new Error('Invalid pipe specification description.')
    const sizes = new Set<number>()
    for (const z of s.sizes) {
      if (
        ![z.nps, z.od, z.wall, z.kgM].every(positive) ||
        z.wall * 2 >= z.od ||
        sizes.has(z.nps)
      )
        throw new Error('Invalid or duplicate pipe size.')
      sizes.add(z.nps)
    }
    for (const f of s.fittings) {
      if (
        !isString(f.id) ||
        !f.id ||
        catalogs.has(f.id) ||
        !knownKinds.includes(f.kind) ||
        !positive(f.nps) ||
        !nonnegative(f.takeout) ||
        !isString(f.description) ||
        !isString(f.source) ||
        !optionalNumbers(f, [
          'branchTakeout',
          'weightKg',
          'areaM2',
          'unitCost',
          'laborHours'
        ])
      )
        throw new Error('Invalid catalogue fitting.')
      catalogs.add(f.id)
    }
  }
  const runs = new Set<string>()
  for (const r of d.runs) {
    for (const key of ['fromPrep', 'toPrep'])
      if (
        r[key as keyof PipeRun] != null &&
        !['BW', 'SW', 'THD', 'PLAIN'].includes(String(r[key as keyof PipeRun]))
      )
        throw new Error('Invalid end preparation.')
    for (const key of ['connector', 'fromField', 'toField'])
      if (
        r[key as keyof PipeRun] != null &&
        typeof r[key as keyof PipeRun] !== 'boolean'
      )
        throw new Error('Invalid pipe attributes.')
    if (r.rootGap != null && !nonnegative(r.rootGap))
      throw new Error('Invalid pipe root gap.')
    if ([r.fromTag, r.toTag].some(v => v != null && !isString(v)))
      throw new Error('Invalid weld tag.')
    getNode(d, r.from)
    getNode(d, r.to)
    getSpec(d, r.specId)
    if (
      !isString(r.id) ||
      !r.id ||
      runs.has(r.id) ||
      r.from === r.to ||
      !positive(r.nps) ||
      !isString(r.spool) ||
      !isString(r.line) ||
      !isString(r.heat) ||
      !['BW', 'SW', 'THD', 'PLAIN'].includes(r.endPrep)
    )
      throw new Error('Invalid pipe run.')
    runs.add(r.id)
  }
  for (const n of d.nodes) {
    if (n.associatedRunId && !runs.has(n.associatedRunId))
      throw new Error('Attachment refers to a missing pipe.')
    if (
      n.branchEdgeId &&
      !connected(d, n.id).some(r => r.id === n.branchEdgeId)
    )
      throw new Error('Tee branch must be a connected pipe.')
  }
  return d
}
export function csv(rows: unknown[][]): string {
  return rows
    .map(row =>
      row
        .map(v => {
          let s = String(v ?? '')
          if (/^[=+@\-]/.test(s)) s = "'" + s
          return '"' + s.replace(/"/g, '""') + '"'
        })
        .join(',')
    )
    .join('\r\n')
}
export function bomCsv(
  doc: IsoDocument,
  group: 'spool' | 'line' | 'global' = 'spool'
): string {
  return csv([
    [
      'Item',
      'Description',
      'Spec',
      'NPS',
      'Quantity',
      'Unit',
      'Weight kg',
      'Surface m2',
      'Cost',
      'Labor hours',
      'Heat',
      'Spool',
      'Line'
    ],
    ...bom(doc, group).map(r => [
      r.item,
      r.description,
      r.spec,
      r.nps,
      Number.isFinite(r.qty) ? round(r.qty, 3) : 'MISSING',
      r.unit,
      r.weightKg == null ? 'MISSING' : round(r.weightKg),
      r.areaM2 == null ? 'MISSING' : round(r.areaM2, 3),
      round(r.cost),
      round(r.hours),
      r.heat,
      r.spool,
      r.line
    ])
  ])
}
export function cutCsv(doc: IsoDocument): string {
  return csv([
    [
      'Pipe',
      'Spool',
      'Line',
      'NPS',
      'Spec',
      'Overall mm',
      'Start takeout mm',
      'End takeout mm',
      'Start gap mm',
      'End gap mm',
      'Cut mm',
      'Heat',
      'Start preparation',
      'End preparation'
    ],
    ...doc.runs
      .filter(r => !r.connector)
      .map(r => {
        const c = runResult(doc, r)
        return [
          r.id,
          r.spool,
          r.line,
          r.nps,
          r.specId,
          round(c.overall),
          ...c.takeouts.map(v => round(v)),
          ...c.gaps,
          round(c.cut),
          r.heat,
          prepAt(r, 0),
          prepAt(r, 1)
        ]
      })
  ])
}
export function weldCsv(doc: IsoDocument): string {
  return csv([
    [
      'Weld',
      'Spool',
      'Line',
      'NPS',
      'Location',
      'End preparation',
      'Diameter inches'
    ],
    ...welds(doc).map(w => {
      const r = doc.runs.find(r => r.id === w.runId)!
      return [
        w.tag,
        r.spool,
        r.line,
        w.nps,
        w.field ? 'Field' : 'Shop',
        w.prep,
        w.nps
      ]
    })
  ])
}
