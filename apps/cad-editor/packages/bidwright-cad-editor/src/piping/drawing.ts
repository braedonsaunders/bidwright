import {
  type IsoDocument,
  type Vec3,
  type PipeNode,
  formatLength,
  runResult,
  welds,
  connected,
  bom,
  round
} from './model'
import { gridSvg, type GridSettings } from './grid'
export type Point = [number, number]
export type Primitive =
  | { type: 'line'; a: Point; b: Point; layer: string; owner?: string }
  | { type: 'circle'; p: Point; r: number; layer: string; owner?: string }
  | {
      type: 'text'
      p: Point
      text: string
      size: number
      layer: string
      owner?: string
    }
export interface Drawing {
  width: number
  height: number
  primitives: Primitive[]
  positions: Map<string, Point>
  project: (p: Vec3) => Point
  view: 'iso' | 'plan' | 'front' | 'side'
}
export const escape = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!
  )
export function isoProject(p: Vec3, rotation = 0): Point {
  const angle = (rotation * Math.PI) / 180
  const x = p[0] * Math.cos(angle) - p[1] * Math.sin(angle),
    y = p[0] * Math.sin(angle) + p[1] * Math.cos(angle)
  return [(x - y) * Math.cos(Math.PI / 6), -(x + y) * 0.5 - p[2]]
}
export function createDrawing(
  doc: IsoDocument,
  spool = '',
  view: 'iso' | 'plan' | 'front' | 'side' = 'iso'
): Drawing {
  const runs = doc.runs.filter(r => !spool || r.spool === spool),
    nodes = doc.nodes.filter(n =>
      runs.some(
        r => r.from === n.id || r.to === n.id || r.id === n.associatedRunId
      )
    )
  const project = (p: Vec3): Point =>
    view === 'plan'
      ? [p[0], -p[1]]
      : view === 'front'
        ? [p[0], -p[2]]
        : view === 'side'
          ? [p[1], -p[2]]
          : isoProject(p, doc.north)
  const raw = nodes.map(n => project(n.position))
  const xs = raw.map(p => p[0]),
    ys = raw.map(p => p[1])
  const minX = raw.length ? Math.min(...xs) : 0,
    minY = raw.length ? Math.min(...ys) : 0,
    maxX = raw.length ? Math.max(...xs) : 1,
    maxY = raw.length ? Math.max(...ys) : 1
  const scale = nodes.length
    ? Math.min(660 / Math.max(1, maxX - minX), 420 / Math.max(1, maxY - minY))
    : 0.3
  const positions = new Map(
    nodes.map((n, i) => [
      n.id,
      [
        (raw[i][0] - (maxX + minX) / 2) * scale + 410,
        (raw[i][1] - (maxY + minY) / 2) * scale + 360
      ] as Point
    ])
  )
  const d: Drawing = {
    width: 1100,
    height: 850,
    primitives: [],
    positions,
    view,
    project: p => {
      const raw = project(p)
      return [
        (raw[0] - (maxX + minX) / 2) * scale + 410,
        (raw[1] - (maxY + minY) / 2) * scale + 360
      ]
    }
  }
  const line = (a: Point, b: Point, layer = 'PIPE', owner?: string) =>
    d.primitives.push({ type: 'line', a, b, layer, owner })
  const occupied: Array<[number, number, number, number]> = []
  const text = (
    p: Point,
    value: string,
    size = 12,
    layer = 'TEXT',
    owner?: string
  ) => {
    let at: Point = [...p]
    const width = value.length * size * 0.52
    if (owner && ['DIM', 'TEXT', 'WELD'].includes(layer)) {
      at = [
        Math.max(50, Math.min(at[0], 780 - width)),
        Math.max(150, Math.min(at[1], 625))
      ]
      for (let attempt = 0; attempt < 24; attempt++) {
        const box: [number, number, number, number] = [
          at[0] - 2,
          at[1] - size - 2,
          at[0] + width + 2,
          at[1] + 3
        ]
        if (
          !occupied.some(
            b =>
              box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]
          )
        )
          break
        at = [
          p[0],
          p[1] +
            (attempt % 2 === 0 ? -1 : 1) *
              Math.ceil((attempt + 1) / 2) *
              (size + 5)
        ]
      }
    }
    occupied.push([at[0] - 2, at[1] - size - 2, at[0] + width + 2, at[1] + 3])
    d.primitives.push({ type: 'text', p: at, text: value, size, layer, owner })
  }
  const circle = (p: Point, r: number, layer = 'SYMBOL', owner?: string) =>
    d.primitives.push({ type: 'circle', p, r, layer, owner })
  const rect = (x: number, y: number, w: number, h: number) => {
    line([x, y], [x + w, y], 'BORDER')
    line([x + w, y], [x + w, y + h], 'BORDER')
    line([x + w, y + h], [x, y + h], 'BORDER')
    line([x, y + h], [x, y], 'BORDER')
  }
  rect(20, 20, 1060, 810)
  text(
    [40, 48],
    doc.title.length > 55 ? doc.title.slice(0, 54) + '…' : doc.title,
    22
  )
  text(
    [40, 72],
    `${doc.drawing}  |  ${spool || 'All spools'}  |  Revision ${doc.revision}`,
    13
  )
  text(
    [40, 94],
    `${doc.customer}${doc.project ? '  /  ' + doc.project : ''}`,
    12
  )
  const allBom = bom(doc)
  const partMap = new Map<string, number>()
  for (const n of nodes) {
    const edge =
      connected(doc, n.id)[0] ?? doc.runs.find(r => r.id === n.associatedRunId)
    if (!edge) continue
    partMap.set(n.id, allBom.find(r => r.memberIds?.includes(n.id))?.item ?? 0)
  }
  for (const r of runs) {
    const a = positions.get(r.from)!,
      b = positions.get(r.to)!,
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      len = Math.hypot(dx, dy) || 1
    const result = runResult(doc, r)
    line(a, b, r.connector ? 'SYMBOL' : 'PIPE', r.id)
    if (r.connector) continue
    const offset: Point = [(-dy / len) * 32, (dx / len) * 32]
    const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const da: Point = [a[0] + offset[0], a[1] + offset[1]],
      db: Point = [b[0] + offset[0], b[1] + offset[1]]
    line(a, [da[0] + offset[0] * 0.15, da[1] + offset[1] * 0.15], 'DIM', r.id)
    line(b, [db[0] + offset[0] * 0.15, db[1] + offset[1] * 0.15], 'DIM', r.id)
    line(da, db, 'DIM', r.id)
    for (const p of [da, db])
      line([p[0] - 3, p[1] - 5], [p[0] + 3, p[1] + 5], 'DIM', r.id)
    const label =
      doc.dimensionMode === 'overall'
        ? formatLength(result.overall, doc.units)
        : doc.dimensionMode === 'cut'
          ? `CUT ${formatLength(result.cut, doc.units)}`
          : `${formatLength(result.overall, doc.units)} / CUT ${formatLength(result.cut, doc.units)}`
    text(
      [mid[0] + offset[0] - 35, mid[1] + offset[1] - 5],
      label,
      11,
      'DIM',
      r.id
    )
    text(
      [mid[0] - 20, mid[1] - 10],
      `${r.nps}" · ${r.specId}`,
      11,
      'TEXT',
      r.id
    )
  }
  function symbol(n: PipeNode, p: Point) {
    const edges = connected(doc, n.id),
      edge = edges[0]
    const neighbour = edge
      ? positions.get(edge.from === n.id ? edge.to : edge.from)
      : undefined
    const delta: Point = neighbour
      ? [neighbour[0] - p[0], neighbour[1] - p[1]]
      : [1, 0]
    const norm = Math.hypot(...delta) || 1,
      u: Point = [delta[0] / norm, delta[1] / norm],
      v: Point = [-u[1], u[0]]
    const at = (x: number, y: number): Point => [
      p[0] + u[0] * x + v[0] * y,
      p[1] + u[1] * x + v[1] * y
    ]
    const l = (a: Point, b: Point) => line(a, b, 'SYMBOL', n.id)
    if (n.kind === 'valve') {
      l(at(-12, -8), at(12, 8))
      l(at(-12, 8), at(12, -8))
      l(at(-12, -8), at(-12, 8))
      l(at(12, -8), at(12, 8))
      l(at(0, 0), at(0, -20))
      l(at(-8, -20), at(8, -20))
    } else if (n.kind === 'flange' || n.kind === 'gasket') {
      l(at(-3, -12), at(-3, 12))
      l(at(3, -12), at(3, 12))
    } else if (n.kind === 'reducer') {
      l(at(-12, -10), at(12, -5))
      l(at(-12, 10), at(12, 5))
      l(at(-12, -10), at(-12, 10))
      l(at(12, -5), at(12, 5))
    } else if (n.kind === 'cap') {
      l(at(-2, -10), at(-2, 10))
      circle(at(-2, 0), 10, 'SYMBOL', n.id)
    } else if (n.kind === 'support') {
      l(at(-9, 6), at(9, 6))
      l(at(-9, 6), at(0, 18))
      l(at(9, 6), at(0, 18))
      l(at(-14, 18), at(14, 18))
    } else if (n.kind === 'weld') {
      circle(p, n.field ? 5 : 3, 'WELD', n.id)
    } else if (n.kind === 'elbow90' || n.kind === 'elbow45') {
      circle(p, 6, 'SYMBOL', n.id)
    } else if (n.kind === 'tee' || n.kind === 'olet') {
      circle(p, 7, 'SYMBOL', n.id)
      text(
        [p[0] - 3, p[1] + 4],
        n.kind === 'tee' ? 'T' : 'O',
        9,
        'SYMBOL',
        n.id
      )
    } else if (n.kind === 'bolt') {
      text([p[0] - 5, p[1] + 4], 'B', 10, 'SYMBOL', n.id)
    } else circle(p, 3, 'SYMBOL', n.id)
    const part = partMap.get(n.id)
    if (part) {
      const offset = n.labelOffset ?? [24, -24]
      const dest: Point = [p[0] + offset[0], p[1] + offset[1]]
      line(p, dest, 'BOM', n.id)
      circle(dest, 10, 'BOM', n.id)
      text([dest[0] - 4, dest[1] + 4], String(part), 10, 'BOM', n.id)
    }
  }
  for (const n of nodes) symbol(n, positions.get(n.id)!)
  for (const w of welds(doc).filter(w => runs.some(r => r.id === w.runId))) {
    const p0 = project(w.position)
    const p: Point = [
      (p0[0] - (maxX + minX) / 2) * scale + 410,
      (p0[1] - (maxY + minY) / 2) * scale + 360
    ]
    circle(p, 3, 'WELD', w.nodeId)
    text(
      [p[0] + 7, p[1] + 15],
      `${w.tag}${w.field ? ' FW' : ''}`,
      9,
      'WELD',
      w.nodeId
    )
  }
  const north = project([0, 1, 0]),
    northLength = Math.hypot(...north)
  if (northLength > 0.001) {
    const u: Point = [north[0] / northLength, north[1] / northLength],
      v: Point = [-u[1], u[0]]
    const tip: Point = [745 + u[0] * 22, 82 + u[1] * 22]
    line([745, 82], tip, 'TEXT')
    for (const sign of [-1, 1])
      line(
        tip,
        [
          tip[0] - u[0] * 8 + v[0] * 4 * sign,
          tip[1] - u[1] * 8 + v[1] * 4 * sign
        ],
        'TEXT'
      )
    text([tip[0] + u[0] * 12 - 4, tip[1] + u[1] * 12 + 4], 'N', 13)
  }
  text([815, 126], 'BILL OF MATERIALS', 13)
  text([810, 146], '#   DESCRIPTION                 NPS      QTY', 10)
  line([805, 155], [1060, 155], 'BORDER')
  const shown = allBom.filter(row => !spool || row.spool === spool)
  for (const [i, r] of shown.slice(0, 23).entries()) {
    const y = 175 + i * 19
    text([810, y], String(r.item), 10)
    text(
      [835, y],
      r.description.length > 25
        ? r.description.slice(0, 24) + '…'
        : r.description,
      9
    )
    text([990, y], String(r.nps), 10)
    text(
      [1032, y],
      `${Number.isFinite(r.qty) ? round(r.qty, 2) : 'MISSING'} ${r.unit}`,
      9
    )
  }
  if (shown.length > 23)
    text([810, 625], `+${shown.length - 23} rows: see material schedule`, 10)
  rect(35, 650, 1030, 160)
  line([35, 705], [1065, 705], 'BORDER')
  line([700, 650], [700, 810], 'BORDER')
  text(
    [48, 673],
    `DRAWING: ${doc.drawing}     SPOOL: ${spool || 'ALL'}     REV: ${doc.revision}`,
    12
  )
  text([48, 694], `DRAWN: ${doc.drawnBy}     CHECKED: ${doc.checkedBy}`, 11)
  text([715, 673], 'BIDWRIGHT  /  PIPING ISOMETRIC', 15)
  text(
    [715, 694],
    `${view.toUpperCase()} VIEW · ${doc.units === 'mm' ? 'METRIC' : 'IMPERIAL'}`,
    11
  )
  const noteLines = doc.notes
    .split('\n')
    .flatMap(s => s.match(/.{1,90}/g) ?? [''])
    .slice(0, 5)
  noteLines.forEach((s, i) => text([48, 728 + i * 15], s, 11))
  text([715, 727], 'DIMENSIONS GOVERN · NOT TO SCALE', 10)
  text([715, 746], 'ALL LENGTHS TO CENTRELINES UNLESS NOTED', 9)
  text([715, 765], 'CUT = OVERALL - FITTINGS - ROOT GAPS', 9)
  text(
    [715, 789],
    `ROOT GAP: ${[...new Set(doc.specs.map(s => s.rootGap))].join('/')} mm`,
    10
  )
  // Break drafting lines around annotation text so every export remains legible,
  // including legacy DWG versions without MTEXT background masks.
  const clearances = d.primitives
    .filter(
      (p): p is Extract<Primitive, { type: 'text' }> =>
        p.type === 'text' &&
        !!p.owner &&
        ['DIM', 'TEXT', 'WELD'].includes(p.layer)
    )
    .map(p => [
      p.p[0] - 2,
      p.p[1] - p.size - 1,
      p.p[0] + p.text.length * p.size * 0.62 + 2,
      p.p[1] + 3
    ])
  const clip = (a: Point, b: Point, box: number[]): Array<[Point, Point]> => {
    const delta: Point = [b[0] - a[0], b[1] - a[1]]
    let enter = 0,
      leave = 1
    for (const axis of [0, 1]) {
      if (Math.abs(delta[axis]) < 1e-9) {
        if (a[axis] < box[axis] || a[axis] > box[axis + 2]) return [[a, b]]
      } else {
        const t1 = (box[axis] - a[axis]) / delta[axis],
          t2 = (box[axis + 2] - a[axis]) / delta[axis]
        enter = Math.max(enter, Math.min(t1, t2))
        leave = Math.min(leave, Math.max(t1, t2))
      }
    }
    if (enter >= leave) return [[a, b]]
    const at = (t: number): Point => [a[0] + delta[0] * t, a[1] + delta[1] * t]
    const segments: Array<[Point, Point]> = []
    if (enter > 0) segments.push([a, at(enter)])
    if (leave < 1) segments.push([at(leave), b])
    return segments
  }
  d.primitives = d.primitives.flatMap(p => {
    if (p.type !== 'line' || p.layer === 'BORDER') return [p]
    let pieces: Array<[Point, Point]> = [[p.a, p.b]]
    for (const box of clearances)
      pieces = pieces.flatMap(([a, b]) => clip(a, b, box))
    return pieces.map(([a, b]) => ({ ...p, a, b }))
  })
  d.primitives.sort(
    (a, b) => Number(a.type === 'text') - Number(b.type === 'text')
  )
  return d
}
export function drawingSvg(
  d: Drawing,
  selected = '',
  interactive = false,
  grid?: { settings: GridSettings; anchor: Vec3 }
): string {
  const shape = (p: Primitive) => {
    const attrs = `data-owner="${escape(p.owner ?? '')}" class="${p.owner === selected ? 'selected' : ''}"`
    if (p.type === 'line')
      return `<line ${attrs} x1="${p.a[0]}" y1="${p.a[1]}" x2="${p.b[0]}" y2="${p.b[1]}" stroke-width="${p.layer === 'PIPE' ? 3 : p.layer === 'SYMBOL' ? 2 : 0.8}"/>`
    if (p.type === 'circle')
      return `<circle ${attrs} cx="${p.p[0]}" cy="${p.p[1]}" r="${p.r}" fill="white"/>`
    return `<text ${attrs} x="${p.p[0]}" y="${p.p[1]}" font-size="${p.size}" stroke="none">${escape(p.text)}</text>`
  }
  const hits = interactive
    ? [...d.positions]
        .map(
          ([key, p]) =>
            `<circle data-node="${escape(key)}" cx="${p[0]}" cy="${p[1]}" r="14" fill="transparent" stroke="none" class="node-hit"/>`
        )
        .join('')
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${d.width} ${d.height}" role="img" aria-label="Piping isometric drawing" style="background:white;color:#17212c"><style>text{fill:#17212c;font-family:Arial,sans-serif}line,circle{stroke:#17212c}.selected{stroke:#087fbe;fill:#087fbe}.node-hit{cursor:pointer;stroke:none!important}.iso-grid-line{stroke:#c6dbea;stroke-width:0.6}.iso-grid-line.major{stroke:#a5c8df;stroke-width:0.85}.iso-grid-caption{fill:#4f7289}.grid-cursor{stroke:#087fbe;fill:#087fbe;pointer-events:none}text{user-select:none}</style>${interactive && grid ? gridSvg(d, grid.anchor, grid.settings) : ''}${d.primitives.map(shape).join('')}${hits}${interactive ? '<g data-grid-cursor pointer-events="none"></g>' : ''}</svg>`
}
