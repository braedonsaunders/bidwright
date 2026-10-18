/**
 * The DXF handed to the pinned GNU LibreDWG writer, adjusted for what that writer does differently from AutoCAD.
 * The drawing itself is unchanged; this text is only ever read by the writer, never saved.
 *
 * - Model space: the reader pre-creates the *MODEL_SPACE block record at handle 1F, so the real one is moved there.
 * - Handle B: for an R2000 DWG the writer adds the VX table (AutoCAD's viewport-entity table, which DXF never
 *   carries) at its standard handle B, so an object of the DXF at B is moved to a free handle; else the DWG would
 *   hold two objects with one handle.
 * - $HANDSEED: one above the largest handle actually used.
 * - MTEXT: AutoCAD gives the last direction vector precedence over a preceding rotation. The writer rejects the
 *   redundant group 50; retaining the vector preserves the exact orientation.
 * - HATCH seed points: the writer drops a seed point whose X is exactly 0 (and then writes the HATCH without
 *   seeds), so such a seed is moved off zero by a millionth of a drawing unit, well inside its boundary.
 * - Text values end in a NUL before their line break. The reader measures the rest of the file on every character
 *   of a string it reads, so a drawing that keeps its piping model (hundreds of kilobytes of text in an XRECORD)
 *   took tens of seconds; the NUL ends each measurement at the value's own end. The value read is the same.
 * - Characters outside ASCII are written as \U+XXXX.
 */
export function writerCompatibleDxf(input) {
  const lines = input.replace(/\r\n/g, '\n').split('\n'),
    records = []
  let record = []
  for (let i = 0; i + 1 < lines.length; i += 2) {
    if (lines[i].trim() === '0' && record.length) {
      records.push(record)
      record = []
    }
    record.push([lines[i], lines[i + 1]])
  }
  if (record.length) records.push(record)
  const code = pair => Number(pair[0])
  const isHandle = c =>
    c === 5 ||
    c === 105 ||
    (c >= 320 && c <= 369) ||
    (c >= 390 && c <= 399) ||
    c === 480 ||
    c === 481 ||
    c === 1005
  const hex = value => (/^[0-9A-Fa-f]+$/.test(value.trim()) ? BigInt('0x' + value.trim()) : null)
  /** The header's $HANDSEED value pair: a code 5 that is the next free handle, not an object's. */
  const seedPairs = new Set()
  for (const record of records)
    for (let i = 0; i + 1 < record.length; i++)
      if (record[i][0].trim() === '9' && record[i][1].trim() === '$HANDSEED' && code(record[i + 1]) === 5)
        seedPairs.add(record[i + 1])
  const defined = () => {
    const handles = new Set()
    for (const record of records)
      for (const pair of record)
        if ((code(pair) === 5 || code(pair) === 105) && !seedPairs.has(pair)) {
          const value = hex(pair[1])
          if (value) handles.add(value)
        }
    return handles
  }
  const renumber = remap => {
    if (!remap.size) return
    for (const record of records)
      for (const pair of record) {
        if (!isHandle(code(pair)) || seedPairs.has(pair)) continue
        const value = hex(pair[1])
        if (value != null && remap.has(value)) pair[1] = remap.get(value).toString(16).toUpperCase()
      }
  }
  const model = records.find(
    record =>
      record.some(([c, v]) => c.trim() === '0' && v.trim() === 'BLOCK_RECORD') &&
      record.some(([c, v]) => c.trim() === '2' && v.trim().toUpperCase() === '*MODEL_SPACE')
  )
  const modelPair = model?.find(pair => code(pair) === 5)
  const modelHandle = modelPair ? hex(modelPair[1]) : null
  if (modelHandle && modelHandle !== 0x1fn)
    renumber(new Map([[modelHandle, 0x1fn], [0x1fn, modelHandle]]))
  let handles = defined(),
    maximum = [...handles].reduce((a, b) => (b > a ? b : a), 0n)
  if (handles.has(0xbn)) {
    maximum += 1n
    renumber(new Map([[0xbn, maximum]]))
  }
  for (const pair of seedPairs) pair[1] = (maximum + 1n).toString(16).toUpperCase()
  const TEXT_CODES = new Set([1, 3, 4, 6, 7, 8])
  const out = []
  for (const record of records) {
    const type = record.find(([c]) => c.trim() === '0')?.[1]?.trim()
    const directionIndex = record.findIndex(([c]) => c.trim() === '11')
    const seedsFrom = type === 'HATCH' ? record.findIndex(pair => code(pair) === 98) : -1
    record.forEach((pair, index) => {
      const c = code(pair)
      if (type === 'MTEXT' && c === 50 && directionIndex > index) return
      let value = pair[1]
      if (seedsFrom >= 0 && index > seedsFrom && c === 10 && Number(value) === 0) value = '0.000001'
      value = value.replace(
        /[^\x00-\x7f]/g,
        char => '\\U+' + char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')
      )
      if (TEXT_CODES.has(c) || (c >= 300 && c <= 309) || c === 1000) value += '\0'
      out.push(pair[0], value)
    })
  }
  return out.join('\n') + '\n'
}
