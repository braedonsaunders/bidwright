import { type LibreDwgEx } from '@mlightcad/libredwg-web'
/** libredwg-web 0.7.15's dictionary helper treats pre-2007 char** as UTF-16.
 * Decode the actual byte strings using the DWG codepage instead. Modern DWGs
 * continue through the upstream Unicode helper.
 */
export function readLegacyDictionaryNames(
  reader: LibreDwgEx,
  object: number
): string[] {
  const item = reader.dwg_object_to_object_tio(object)
  const count = reader.dwg_dynapi_entity_data<number>(item, 'numitems')
  const texts = reader.dwg_dynapi_entity_data<number>(item, 'texts')
  const memory = reader as unknown as {
    HEAPU8: Uint8Array
    HEAPU32: Uint32Array
    decoder?: TextDecoder
  }
  if (
    !Number.isInteger(count) ||
    count < 0 ||
    count > 100000 ||
    !Number.isInteger(texts) ||
    texts < 0 ||
    texts + count * 4 > memory.HEAPU8.byteLength
  )
    throw new Error('Invalid legacy DWG dictionary.')
  const decoder = memory.decoder ?? new TextDecoder('windows-1252')
  return Array.from({ length: count }, (_, i) => {
    const start = memory.HEAPU32[(texts >>> 2) + i]
    let end = start
    if (start >= memory.HEAPU8.byteLength)
      throw new Error('Invalid DWG dictionary text pointer.')
    while (
      end < memory.HEAPU8.byteLength &&
      end - start < 1_000_000 &&
      memory.HEAPU8[end] !== 0
    )
      end++
    if (end === memory.HEAPU8.byteLength || end - start === 1_000_000)
      throw new Error('Unterminated DWG dictionary text.')
    return decoder.decode(memory.HEAPU8.subarray(start, end))
  })
}
