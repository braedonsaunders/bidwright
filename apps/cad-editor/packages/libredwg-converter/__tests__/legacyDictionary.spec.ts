import { readLegacyDictionaryNames } from '../src/AcDbLibreDwgLegacyDictionary'
import type { LibreDwgEx } from '@mlightcad/libredwg-web'
describe('legacy DWG dictionary text decoding', () => {
  it('decodes byte strings using the drawing codepage without treating ASCII as UTF-16', () => {
    const heap = new Uint8Array(256),
      pointers = new Uint32Array(heap.buffer)
    pointers[4] = 64
    pointers[5] = 96
    heap.set(new TextEncoder().encode('BIDWRIGHT_PIPING_V1\0'), 64)
    heap.set([67, 97, 102, 233, 0], 96)
    const reader = {
      HEAPU8: heap,
      HEAPU32: pointers,
      decoder: new TextDecoder('windows-1252'),
      dwg_object_to_object_tio: () => 1,
      dwg_dynapi_entity_data: (_: number, name: string) =>
        name === 'numitems' ? 2 : 16
    }
    expect(
      readLegacyDictionaryNames(reader as unknown as LibreDwgEx, 1)
    ).toEqual(['BIDWRIGHT_PIPING_V1', 'Café'])
  })
  it('rejects an invalid pointer instead of reading outside the WASM heap', () => {
    const heap = new Uint8Array(32),
      pointers = new Uint32Array(heap.buffer)
    pointers[0] = 100
    const reader = {
      HEAPU8: heap,
      HEAPU32: pointers,
      dwg_object_to_object_tio: () => 1,
      dwg_dynapi_entity_data: (_: number, name: string) =>
        name === 'numitems' ? 1 : 0
    }
    expect(() =>
      readLegacyDictionaryNames(reader as unknown as LibreDwgEx, 1)
    ).toThrow('pointer')
  })
})
