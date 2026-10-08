import { readLegacyDictionaryNames } from './AcDbLibreDwgLegacyDictionary'
import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web'

export async function parseDwg(data: string) {
  // LibreDwg.create() loads libredwg-web.wasm via the Emscripten glue's
  // `new URL(..., import.meta.url)`. The worker build emits that wasm as a
  // sibling of libredwg-parser-worker.js (not inlined).
  const libredwg = await LibreDwg.create()
  if (libredwg == null) {
    throw new Error('libredwg is not loaded!')
  }

  const dwgDataPtr = libredwg.dwg_read_data(data, Dwg_File_Type.DWG)
  if (dwgDataPtr == null) {
    throw new Error('Failed to read dwg data!')
  }
  const original = libredwg.dwg_object_dictionary_get_texts
  try {
    if (libredwg.dwg_get_version_type(dwgDataPtr).version < 27) {
      libredwg.dwg_object_dictionary_get_texts = object =>
        readLegacyDictionaryNames(libredwg, object)
    }
    return libredwg.convertEx(dwgDataPtr)
  } finally {
    libredwg.dwg_object_dictionary_get_texts = original
    libredwg.dwg_free(dwgDataPtr)
  }
}
