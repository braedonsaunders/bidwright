/** AutoCAD gives the last MTEXT direction vector precedence over a preceding rotation.
 * LibreDWG 0.14 rejects the redundant group 50; retaining the vector preserves the exact orientation.
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
  // The pinned GNU reader pre-creates model space at handle 1F. Swap identities
  // consistently so it reuses the real BLOCK_RECORD instead of creating a second one.
  const model = records.find(
    record =>
      record.some(([c, v]) => c.trim() === '0' && v === 'BLOCK_RECORD') &&
      record.some(
        ([c, v]) => c.trim() === '2' && v.toUpperCase() === '*MODEL_SPACE'
      )
  )
  const modelHandle = model?.find(([c]) => c.trim() === '5')?.[1]?.toUpperCase()
  const isHandle = code =>
    code === 5 ||
    code === 105 ||
    (code >= 320 && code <= 369) ||
    (code >= 390 && code <= 399) ||
    code === 480 ||
    code === 481 ||
    code === 1005
  let maximum = 0n
  for (const record of records)
    for (const pair of record) {
      const code = Number(pair[0]),
        handle = pair[1].toUpperCase()
      if (isHandle(code) && /^[0-9A-F]+$/.test(handle)) {
        if (modelHandle && modelHandle !== '1F')
          pair[1] =
            handle === modelHandle
              ? '1F'
              : handle === '1F'
                ? modelHandle
                : pair[1]
        if (code === 5 || code === 105) {
          const value = BigInt('0x' + pair[1])
          if (value > maximum) maximum = value
        }
      }
    }
  for (const record of records)
    for (let i = 0; i + 1 < record.length; i++)
      if (
        record[i][0].trim() === '9' &&
        record[i][1] === '$HANDSEED' &&
        record[i + 1][0].trim() === '5'
      )
        record[i + 1][1] = (maximum + 1n).toString(16).toUpperCase()
  return (
    records
      .flatMap(record => {
        const type = record.find(([c]) => c.trim() === '0')?.[1]
        const directionIndex = record.findIndex(([c]) => c.trim() === '11')
        return record
          .filter(
            ([code], index) =>
              !(
                type === 'MTEXT' &&
                code.trim() === '50' &&
                directionIndex > index
              )
          )
          .flat()
      })
      .map(value =>
        value.replace(
          /[^\x00-\x7f]/g,
          char =>
            '\\U+' +
            char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')
        )
      )
      .join('\n') + '\n'
  )
}
