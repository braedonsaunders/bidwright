/** Native AutoCAD 2000 DWG, written by the pinned GNU LibreDWG WebAssembly worker. */
export async function exportDwg(dxf: string): Promise<Blob> {
  const bytes = new TextEncoder().encode(dxf)
  if (bytes.byteLength > 25_000_000)
    throw new Error(
      'DWG export is limited to 25 MB of drawing data. Use DXF for larger drawings.'
    )
  const worker = new Worker(new URL('dwg-export/worker.js', document.baseURI), {
    type: 'module'
  })
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('DWG conversion timed out. Try DXF export.')),
        60000
      )
      worker.onmessage = ({ data }) => {
        clearTimeout(timer)
        if (data.error) reject(new Error(data.error))
        else resolve(new Blob([data.bytes], { type: 'application/acad' }))
      }
      worker.onerror = () => {
        clearTimeout(timer)
        reject(
          new Error('DWG writer could not load. Please retry, or export DXF.')
        )
      }
      worker.postMessage(bytes.buffer, [bytes.buffer])
    })
  } finally {
    worker.terminate()
  }
}
