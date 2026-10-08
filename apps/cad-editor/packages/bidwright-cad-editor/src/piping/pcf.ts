import {
  type IsoDocument,
  type Kind,
  type Vec3,
  type PipeNode,
  type PipeRun,
  clone,
  newIso,
  id,
  distance,
  add,
  sub,
  mul,
  getNode,
  parseIsoJson,
  takeout,
  bom,
  prepAt
} from './model'
interface PcfRecord {
  type: string
  fields: Map<string, string[]>
  line: string
  spec: string
}
interface Port {
  nodeId: string
  takeout: number
  nps: number
  prep: string
  branch: boolean
  field?: boolean
  tag?: string
}
const TYPES: Record<string, Kind> = {
  ELBOW: 'elbow90',
  BEND: 'elbow90',
  TEE: 'tee',
  FLANGE: 'flange',
  VALVE: 'valve',
  'REDUCER-CONCENTRIC': 'reducer',
  'REDUCER-ECCENTRIC': 'reducer',
  CAP: 'cap',
  SUPPORT: 'support',
  WELD: 'weld',
  OLET: 'olet',
  GASKET: 'gasket',
  BOLT: 'bolt'
}
const CONNECTIONS = new Set([
  'END-CONNECTION-EQUIPMENT',
  'END-CONNECTION-PIPELINE',
  'END-POSITION-NULL',
  'START-CO-ORDS'
])
const first = (r: PcfRecord, k: string) => r.fields.get(k)?.[0]
/** PCF import with explicit units, material references, branch ports and direct fitting assemblies. */
export function importPcf(text: string): {
  doc: IsoDocument
  warnings: string[]
} {
  if (text.length > 8_000_000) throw new Error('PCF exceeds the 8 MB limit.')
  const headers = new Map<string, string>(),
    materials = new Map<string, string>(),
    records: PcfRecord[] = []
  let current: PcfRecord | undefined,
    lineRef = 'PCF-001',
    specRef = 'PCF-UNSPECIFIED',
    inMaterials = false,
    materialKey = '',
    materialCode = ''
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const match = line.trim().match(/^(\S+)\s*(.*)$/)!
    const key = match[1].toUpperCase(),
      value = match[2].trim()
    if (inMaterials) {
      if (key === 'MATERIAL-IDENTIFIER') {
        materialKey = value
        materialCode = ''
      }
      if (key === 'ITEM-CODE') materialCode = value
      if (key === 'DESCRIPTION') {
        if (materialKey) materials.set(materialKey, value)
        if (materialCode) materials.set(materialCode, value)
      }
      continue
    }
    if (!/^\s/.test(line)) {
      if (key === 'MATERIALS') {
        inMaterials = true
        current = undefined
        continue
      }
      if (key === 'PIPELINE-REFERENCE') {
        lineRef = value
        headers.set(key, value)
        current = undefined
        continue
      }
      if (key.startsWith('UNITS-') || key === 'ISOGEN-FILES') {
        headers.set(key, value)
        current = undefined
        continue
      }
      current = { type: key, fields: new Map(), line: lineRef, spec: specRef }
      records.push(current)
    } else if (current)
      current.fields.set(key, [...(current.fields.get(key) ?? []), value])
    else {
      headers.set(key, value)
      if (key === 'PIPING-SPEC') specRef = value
    }
  }
  const coordUnit = headers.get('UNITS-CO-ORDS')?.toUpperCase(),
    boreUnit = headers.get('UNITS-BORE')?.toUpperCase()
  if (
    !coordUnit ||
    !['MM', 'INCH', 'INCHES'].includes(coordUnit) ||
    !boreUnit ||
    !['MM', 'INCH', 'INCHES'].includes(boreUnit)
  )
    throw new Error(
      'PCF needs UNITS-CO-ORDS and UNITS-BORE headers (MM or INCH).'
    )
  const factor = coordUnit === 'MM' ? 1 : 25.4,
    doc = newIso()
  doc.drawing = headers.get('PIPELINE-REFERENCE') ?? 'PCF-001'
  doc.units = coordUnit === 'MM' ? 'mm' : 'imperial'
  doc.revision = headers.get('REVISION') ?? '0'
  doc.project = headers.get('PROJECT-IDENTIFIER') ?? ''
  const gapAttribute = headers
    .get('ATTRIBUTE99')
    ?.match(/^BIDWRIGHT-ROOT-GAP\s+(\d+(?:\.\d+)?)/)
  const gap = gapAttribute ? Number(gapAttribute[1]) : 0
  doc.specs[0].rootGap = gap
  doc.specs[0].id = 'PCF-UNSPECIFIED'
  doc.specs[0].name = 'PCF · specification required'
  doc.specs[0].material = 'Unspecified'
  doc.specs[0].schedule = 'Unspecified'
  doc.specs[0].sizes = []
  doc.specs[0].fittings = []
  const warnings = gapAttribute
    ? []
    : [
        'PCF endpoint lengths are used directly; imported root gap starts at 0 mm. Add the actual pipe specification and weights before fabrication.'
      ]
  const unsupported = records.filter(
    r => r.type !== 'PIPE' && !TYPES[r.type] && !CONNECTIONS.has(r.type)
  )
  if (unsupported.length)
    throw new Error(
      `Unsupported PCF components: ${[...new Set(unsupported.map(r => r.type))].join(', ')}. Import would omit parts; convert or add support first.`
    )
  const point = (value: string): Vec3 => {
    const parts = value.split(/\s+/).slice(0, 3).map(Number)
    if (parts.length !== 3 || !parts.every(Number.isFinite))
      throw new Error(`Invalid PCF point: ${value}`)
    return parts.map(n => n * factor) as Vec3
  }
  const key = (p: Vec3) => p.map(n => Math.round(n * 1000)).join(',')
  const ports = new Map<string, Port[]>(),
    nodeRecords = new Map<string, PcfRecord>(),
    weldLocations = new Map<string, { field: boolean; tag?: string }>()
  const embedded = headers.get('ATTRIBUTE98')?.match(/^BIDWRIGHT-SPECS (.+)$/)
  if (embedded) {
    const specs = JSON.parse(decodeURIComponent(embedded[1]))
    const trial = newIso()
    trial.specs = specs
    doc.specs = parseIsoJson(JSON.stringify(trial)).specs
  }
  const specFor = (name: string) => {
    let spec = doc.specs.find(s => s.id === name)
    if (!spec) {
      spec = clone(doc.specs[0])
      spec.id = name
      spec.name = `${name} · imported specification`
      spec.fittings = []
      spec.sizes = []
      spec.material = 'Unspecified'
      spec.schedule = 'Unspecified'
      spec.rootGap = gap
      doc.specs.push(spec)
    }
    return spec
  }
  const npsFor = (value: string): number => {
    const n = Number(value.split(/\s+/)[3])
    if (!(n > 0) || !Number.isFinite(n))
      throw new Error('PCF endpoint is missing its nominal bore.')
    if (boreUnit !== 'MM') return n
    const dn: Record<number, number> = {
      6: 0.125,
      8: 0.25,
      10: 0.375,
      15: 0.5,
      20: 0.75,
      25: 1,
      32: 1.25,
      40: 1.5,
      50: 2,
      65: 2.5,
      80: 3,
      90: 3.5,
      100: 4,
      125: 5,
      150: 6,
      200: 8,
      250: 10,
      300: 12,
      350: 14,
      400: 16,
      450: 18,
      500: 20,
      550: 22,
      600: 24
    }
    if (dn[n]) return dn[n]
    throw new Error(`Unrecognised metric nominal bore ${n}.`)
  }
  const description = (r: PcfRecord) =>
    first(r, 'ITEM-DESCRIPTION') ??
    materials.get(
      first(r, 'MATERIAL-IDENTIFIER') ?? first(r, 'ITEM-CODE') ?? ''
    ) ??
    r.type
  for (const r of records.filter(r => TYPES[r.type])) {
    const endValues = [
        ...(r.fields.get('END-POINT') ?? []),
        ...(r.fields.get('BRANCH1-POINT') ?? [])
      ],
      ends = endValues.map(point),
      centre = first(r, 'CENTRE-POINT') ?? first(r, 'CO-ORDS')
    if (!centre && !ends.length) throw new Error(`${r.type} has no location.`)
    const position = centre
      ? point(centre)
      : mul(
          ends.reduce((sum, p) => add(sum, p), [0, 0, 0] as Vec3),
          1 / ends.length
        )
    if (r.type === 'WELD') {
      weldLocations.set(key(position), {
        field:
          r.fields.has('CATEGORY-ERECTION') ||
          first(r, 'WELD-TYPE') === 'FIELD',
        tag: first(r, 'WELD-IDENTIFIER')
      })
      continue
    }
    const node: PipeNode = {
      id: id(),
      position,
      kind:
        r.type === 'ELBOW' && Number(first(r, 'ANGLE')) === 45
          ? 'elbow45'
          : TYPES[r.type],
      description: description(r),
      portTakeouts: {},
      heat: first(r, 'HEAT-NUMBER'),
      field: r.fields.has('CATEGORY-ERECTION'),
      quantity: first(r, 'BOLT-QUANTITY')
        ? Number(first(r, 'BOLT-QUANTITY'))
        : 1
    }
    const weight = first(r, 'WEIGHT')
    if (weight) {
      const n = Number(weight)
      if (!(n >= 0) || !Number.isFinite(n))
        throw new Error('Invalid PCF weight.')
      node.weightKg =
        n *
        (headers.get('UNITS-WEIGHT')?.toUpperCase() === 'LBS' ? 0.45359237 : 1)
    }
    doc.nodes.push(node)
    nodeRecords.set(node.id, r)
    if (r.type === 'SUPPORT' || r.type === 'BOLT') continue
    for (const [i, end] of ends.entries()) {
      const k = key(end),
        list = ports.get(k) ?? []
      if (list.some(p => p.nodeId === node.id)) continue
      list.push({
        nodeId: node.id,
        takeout: distance(position, end),
        nps: npsFor(endValues[i]),
        prep: endValues[i].split(/\s+/)[4]?.toUpperCase() ?? 'BW',
        branch: i >= (r.fields.get('END-POINT')?.length ?? 0)
      })
      ports.set(k, list)
    }
  }
  const makeRun = (
    a: Port,
    b: Port,
    r: PcfRecord,
    connector = false
  ): PipeRun => {
    const prep = (s: string): PipeRun['endPrep'] =>
      ['BW', 'SW', 'THD'].includes(s) ? (s as PipeRun['endPrep']) : 'PLAIN'
    const spec = specFor(first(r, 'PIPING-SPEC') ?? r.spec),
      run: PipeRun = {
        id: id(),
        from: a.nodeId,
        to: b.nodeId,
        nps: a.nps,
        specId: spec.id,
        spool: first(r, 'SPOOL-IDENTIFIER') ?? 'SP-001',
        line: r.line,
        heat: first(r, 'HEAT-NUMBER') ?? '',
        endPrep: prep(a.prep),
        fromPrep: prep(a.prep),
        toPrep: prep(b.prep),
        fromField: a.field,
        toField: b.field,
        fromTag: a.tag,
        toTag: b.tag,
        connector
      }
    const attributes = first(r, 'ATTRIBUTE97')?.match(/^BIDWRIGHT-PIPE (.+)$/)
    if (attributes && !connector) {
      const values = JSON.parse(decodeURIComponent(attributes[1]))
      if (!values || typeof values !== 'object' || Array.isArray(values))
        throw new Error('Invalid embedded pipe attributes.')
      for (const key of [
        'rootGap',
        'fromTag',
        'toTag',
        'fromField',
        'toField',
        'fromPrep',
        'toPrep'
      ] as const)
        if (Object.hasOwn(values, key))
          Object.assign(run, { [key]: values[key] })
    }
    doc.runs.push(run)
    for (const p of [a, b]) {
      const n = getNode(doc, p.nodeId)
      n.portTakeouts ??= {}
      n.portTakeouts[run.id] = p.takeout
      if (p.branch) n.branchEdgeId = run.id
    }
    return run
  }
  // Direct fitting connections carry topology, but are never fabricated pipe/BOM length.
  for (const [coord, list] of ports) {
    const weld = weldLocations.get(coord)
    if (weld)
      for (const p of list) {
        p.field = weld.field
        p.tag = weld.tag
      }
    for (let i = 1; i < list.length; i++) {
      const r = nodeRecords.get(list[i].nodeId)!
      makeRun(list[i - 1], list[i], r, true)
    }
  }
  const endNode = (value: string): Port => {
    const position = point(value),
      list = ports.get(key(position))
    if (list?.length) return list[0]
    let node = doc.nodes.find(
      n => n.kind === 'end' && distance(n.position, position) < 0.001
    )
    if (!node) {
      node = { id: id(), position, kind: 'end' }
      doc.nodes.push(node)
    }
    const weld = weldLocations.get(key(position))
    if (weld) {
      node.kind = 'weld'
      node.field = weld.field
      node.tag = weld.tag
    }
    return {
      nodeId: node.id,
      takeout: 0,
      nps: npsFor(value),
      prep: value.split(/\s+/)[4]?.toUpperCase() ?? 'BW',
      branch: false
    }
  }
  for (const r of records.filter(r => r.type === 'PIPE')) {
    const ends = r.fields.get('END-POINT')
    if (ends?.length !== 2)
      throw new Error('Every PCF PIPE needs two endpoints.')
    makeRun(endNode(ends[0]), endNode(ends[1]), r)
  }
  if (!doc.runs.some(r => !r.connector))
    throw new Error('No PCF pipe runs were found.')
  for (const n of doc.nodes.filter(
    n => n.kind === 'support' || n.kind === 'bolt'
  )) {
    let nearest: PipeRun | undefined,
      best = Infinity
    for (const r of doc.runs) {
      const a = getNode(doc, r.from).position,
        b = getNode(doc, r.to).position,
        delta = sub(b, a)
      const norm = delta.reduce((s, v) => s + v * v, 0),
        t = Math.max(
          0,
          Math.min(
            1,
            sub(n.position, a).reduce((s, v, i) => s + v * delta[i], 0) /
              (norm || 1)
          )
        )
      const d = distance(n.position, add(a, mul(delta, t)))
      if (d < best) {
        best = d
        nearest = r
      }
    }
    n.associatedRunId = nearest?.id
  }
  return { doc: parseIsoJson(JSON.stringify(doc)), warnings }
}
export function exportPcf(doc: IsoDocument): string {
  const safe = (s: string) => s.replace(/[\r\n\t]/g, ' ')
  const out = [
    'ISOGEN-FILES ISOGEN.FLS',
    'UNITS-BORE INCH',
    'UNITS-CO-ORDS MM',
    'UNITS-WEIGHT KGS',
    `PIPELINE-REFERENCE ${safe(doc.drawing)}`,
    `    REVISION ${safe(doc.revision)}`,
    `    PROJECT-IDENTIFIER ${safe(doc.project)}`,
    `    ATTRIBUTE99 BIDWRIGHT-ROOT-GAP ${doc.specs[0].rootGap}`,
    `    ATTRIBUTE98 BIDWRIGHT-SPECS ${encodeURIComponent(JSON.stringify(doc.specs))}`
  ]
  const fmt = (p: Vec3, nps: number, prep = 'BW') =>
    `${p.map(v => v.toFixed(4)).join(' ')} ${nps} ${prep}`
  const materials = bom(doc, 'global')
  const material = (member: string) =>
    materials.find(r => r.memberIds?.includes(member))?.item ?? 1
  const port = (n: PipeNode, r: PipeRun): Vec3 => {
    const other = getNode(doc, r.from === n.id ? r.to : r.from)
    const delta = sub(other.position, n.position),
      d = distance(n.position, other.position),
      t = takeout(doc, n, r.id) ?? 0
    return add(n.position, mul(delta, t / (d || 1)))
  }
  for (const n of doc.nodes.filter(n => n.kind !== 'end')) {
    const edges = doc.runs.filter(r => r.from === n.id || r.to === n.id),
      associated = edges[0] ?? doc.runs.find(r => r.id === n.associatedRunId)
    if (!associated) continue
    const type =
      Object.entries(TYPES).find(([, k]) => k === n.kind)?.[0] ?? 'ELBOW'
    out.push(
      `PIPELINE-REFERENCE ${safe(associated.line || doc.drawing)}`,
      type,
      `    CENTRE-POINT ${fmt(n.position, associated.nps)}`,
      `    MATERIAL-IDENTIFIER ${material(n.id)}`,
      `    PIPING-SPEC ${associated.specId}`,
      `    SPOOL-IDENTIFIER ${associated.spool}`
    )
    for (const r of edges)
      out.push(
        `    ${n.branchEdgeId === r.id ? 'BRANCH1-POINT' : 'END-POINT'} ${fmt(port(n, r), r.nps, prepAt(r, r.from === n.id ? 0 : 1))}`
      )
    if (n.kind === 'support' || n.kind === 'bolt')
      out.push(`    CO-ORDS ${fmt(n.position, associated.nps)}`)
    if (n.kind === 'bolt') out.push(`    BOLT-QUANTITY ${n.quantity ?? 1}`)
    if (n.kind === 'elbow45') out.push('    ANGLE 45')
    if (n.field) out.push('    CATEGORY-ERECTION')
    if (n.weightKg != null) out.push(`    WEIGHT ${n.weightKg}`)
    if (n.kind === 'weld' && n.tag)
      out.push(`    WELD-IDENTIFIER ${safe(n.tag)}`)
  }
  for (const r of doc.runs.filter(r => !r.connector)) {
    out.push(
      `PIPELINE-REFERENCE ${safe(r.line || doc.drawing)}`,
      'PIPE',
      `    END-POINT ${fmt(port(getNode(doc, r.from), r), r.nps, prepAt(r, 0))}`,
      `    END-POINT ${fmt(port(getNode(doc, r.to), r), r.nps, prepAt(r, 1))}`,
      `    MATERIAL-IDENTIFIER ${material(r.id)}`,
      `    PIPING-SPEC ${r.specId}`,
      `    SPOOL-IDENTIFIER ${r.spool}`,
      `    HEAT-NUMBER ${safe(r.heat)}`,
      `    ATTRIBUTE97 BIDWRIGHT-PIPE ${encodeURIComponent(JSON.stringify({ rootGap: r.rootGap, fromPrep: r.fromPrep, toPrep: r.toPrep, fromTag: r.fromTag, toTag: r.toTag, fromField: r.fromField, toField: r.toField }))}`
    )
  }
  const seenWelds = new Set<string>()
  for (const r of doc.runs)
    for (const [i, key] of [r.from, r.to].entries()) {
      const field = i === 0 ? r.fromField : r.toField,
        tag = i === 0 ? r.fromTag : r.toTag
      if (field == null && !tag) continue
      const p = port(getNode(doc, key), r),
        identity = p.map(v => v.toFixed(4)).join(',')
      if (seenWelds.has(identity)) continue
      seenWelds.add(identity)
      out.push(
        `PIPELINE-REFERENCE ${safe(r.line || doc.drawing)}`,
        'WELD',
        `    CO-ORDS ${fmt(p, r.nps)}`,
        `    WELD-IDENTIFIER ${safe(tag ?? '')}`,
        ...(field ? ['    CATEGORY-ERECTION'] : [])
      )
    }
  out.push('MATERIALS')
  for (const m of materials)
    out.push(
      `MATERIAL-IDENTIFIER ${m.item}`,
      `    ITEM-CODE BW-${m.item}`,
      `    DESCRIPTION ${safe(m.description)}`
    )
  return out.join('\n') + '\n'
}
