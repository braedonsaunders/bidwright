import { writerCompatibleDxf } from './dxf-compat.js'
import createWriter from './dwg-export.js'
self.onmessage = async ({ data }) => {
  try {
    const warnings = []
    const writer = await createWriter({
      locateFile: file => new URL(file, import.meta.url).href,
      print: () => {},
      printErr: message => {
        if (String(message).includes('ERROR')) {
          warnings.push(String(message).slice(0, 200))
          if (warnings.length > 8) warnings.shift()
        }
      }
    })
    writer.FS.writeFile(
      '/input.dxf',
      new TextEncoder().encode(
        writerCompatibleDxf(new TextDecoder().decode(data))
      )
    )
    const status = writer.ccall('bw_convert', 'number', [], [])
    if (status !== 0)
      throw new Error(
        `DWG conversion reported unsupported or invalid data (code ${status}). Export DXF to preserve the drawing. ${warnings.join(' ')}`
      )
    const bytes = writer.FS.readFile('/output.dwg')
    if (new TextDecoder().decode(bytes.subarray(0, 6)) !== 'AC1015')
      throw new Error('DWG writer returned an invalid file.')
    self.postMessage({ bytes: bytes.buffer }, [bytes.buffer])
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error)
    })
  }
}
