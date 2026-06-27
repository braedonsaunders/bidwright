import { AcCmLoadingManager } from '../src'
import { AcCmFileLoader } from '../src/loader/AcCmFileLoader'

const flushPromises = async () => {
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('AcCmFileLoader', () => {
  const originalFetch = global.fetch
  const originalDOMParser = global.DOMParser
  const originalProgressEvent = (global as any).ProgressEvent

  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch

    if (!(global as any).ProgressEvent) {
      ;(global as any).ProgressEvent = class {
        type: string
        lengthComputable: boolean
        loaded: number
        total: number

        constructor(type: string, init?: ProgressEventInit) {
          this.type = type
          this.lengthComputable = Boolean(init?.lengthComputable)
          this.loaded = init?.loaded ?? 0
          this.total = init?.total ?? 0
        }
      }
    }
  })

  afterEach(() => {
    global.fetch = originalFetch
    global.DOMParser = originalDOMParser
    ;(global as any).ProgressEvent = originalProgressEvent
    jest.restoreAllMocks()
  })

  const absolute = (url: string) => `http://example.com/${url}`

  const loadOnce = (
    loader: AcCmFileLoader,
    url: string,
    onProgress = jest.fn()
  ): Promise<{ data?: unknown; error?: unknown; progress: jest.Mock }> => {
    return new Promise(resolve => {
      loader.load(
        absolute(url),
        ((data: unknown) => resolve({ data, progress: onProgress })) as any,
        onProgress,
        (error: unknown) => resolve({ error, progress: onProgress })
      )
    })
  }

  it('supports response type and mime type configuration', () => {
    const manager = new AcCmLoadingManager()
    const loader = new AcCmFileLoader(manager)

    loader.setResponseType('json').setMimeType('text/html')

    expect(loader.responseType).toBe('json')
    expect(loader.mimeType).toBe('text/html')
  })

  it('loads text with progress stream and deduplicates duplicate requests', async () => {
    const managerOnLoad = jest.fn()
    const managerOnProgress = jest.fn()
    const managerOnError = jest.fn()
    const manager = new AcCmLoadingManager(
      managerOnLoad,
      managerOnProgress,
      managerOnError
    )
    const loader = new AcCmFileLoader(manager).setPath(
      'http://example.com/base/'
    )

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('abc'))
        controller.close()
      }
    })

    ;(global.fetch as jest.Mock).mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Length': '3' }
      })
    )

    const onLoadA = jest.fn()
    const onLoadB = jest.fn()
    const onProgressA = jest.fn()
    const onProgressB = jest.fn()
    const onError = jest.fn()

    loader.load('a.txt', onLoadA as any, onProgressA, onError)
    loader.load('a.txt', onLoadB as any, onProgressB, onError)

    await flushPromises()

    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(onLoadA).toHaveBeenCalledWith('abc')
    expect(onLoadB).toHaveBeenCalledWith('abc')
    expect(onProgressA).toHaveBeenCalled()
    expect(onProgressB).toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()

    const progressEvent = onProgressA.mock.calls[0][0] as {
      total: number
      loaded: number
    }
    expect(progressEvent.total).toBe(3)
    expect(progressEvent.loaded).toBe(3)

    expect(managerOnProgress).toHaveBeenCalledWith(
      'http://example.com/base/a.txt',
      1,
      1
    )
    expect(managerOnLoad).toHaveBeenCalledTimes(1)
    expect(managerOnError).not.toHaveBeenCalled()
  })

  it('parses json/arraybuffer/blob/document/default text branches', async () => {
    const manager = new AcCmLoadingManager()

    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), { status: 200 })
      )
      .mockResolvedValueOnce(new Response('blob-data', { status: 200 }))
      .mockResolvedValueOnce(new Response('<root></root>', { status: 200 }))
      .mockResolvedValueOnce(
        new Response(new TextEncoder().encode('hello'), { status: 200 })
      )

    const parserResult = { parsed: true }
    const parseFromString = jest.fn().mockReturnValue(parserResult)
    global.DOMParser = class {
      parseFromString = parseFromString
    } as unknown as typeof DOMParser

    const loaderJson = new AcCmFileLoader(manager).setResponseType('json')
    const json = await loadOnce(loaderJson, 'j')
    expect(json.data).toEqual({ ok: true })

    const loaderAb = new AcCmFileLoader(manager).setResponseType('arraybuffer')
    const ab = await loadOnce(loaderAb, 'ab')
    expect(ab.data).toBeInstanceOf(ArrayBuffer)

    const loaderBlob = new AcCmFileLoader(manager).setResponseType('blob')
    const blob = await loadOnce(loaderBlob, 'b')
    expect(blob.data).toBeInstanceOf(Blob)

    const loaderDoc = new AcCmFileLoader(manager)
      .setResponseType('document')
      .setMimeType('text/html')
    const doc = await loadOnce(loaderDoc, 'd')
    expect(doc.data).toBe(parserResult)
    expect(parseFromString).toHaveBeenCalledWith('<root></root>', 'text/html')

    const loaderTextWithMime = new AcCmFileLoader(manager).setMimeType(
      'text/plain;charset=utf-8' as unknown as DOMParserSupportedType
    )
    const decoded = await loadOnce(loaderTextWithMime, 't')
    expect(decoded.data).toBe('hello')
  })

  it('handles status 0 response fallback and undefined url input', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const manager = new AcCmLoadingManager()
    const loader = new AcCmFileLoader(manager).setPath('http://example.com/')

    ;(global.fetch as jest.Mock).mockResolvedValue({
      status: 0,
      url: 'http://example.com/',
      statusText: 'OK',
      headers: new Headers(),
      body: undefined,
      text: () => Promise.resolve('fallback')
    } as unknown as Response)

    const result = await new Promise<{ data?: unknown }>(resolve => {
      loader.load(
        undefined as unknown as string,
        ((data: unknown) => resolve({ data })) as any,
        jest.fn(),
        jest.fn()
      )
    })

    expect(result.data).toBe('fallback')
    expect(warnSpy).toHaveBeenCalledWith('HTTP Status 0 received.')
  })

  it('forwards HTTP errors to callbacks and manager', async () => {
    const managerOnError = jest.fn()
    const manager = new AcCmLoadingManager(undefined, undefined, managerOnError)
    const loader = new AcCmFileLoader(manager)

    ;(global.fetch as jest.Mock).mockResolvedValue(
      new Response('failed', {
        status: 500,
        statusText: 'Server Error'
      })
    )

    const result = await loadOnce(loader, 'bad')

    expect(result.error).toBeInstanceOf(Error)
    expect(String((result.error as Error).message)).toContain(
      'responded with 500'
    )
    expect(managerOnError).toHaveBeenCalledWith(absolute('bad'))
  })
  it('handles stream read errors and forwards to onError', async () => {
    const managerOnError = jest.fn()
    const manager = new AcCmLoadingManager(undefined, undefined, managerOnError)
    const loader = new AcCmFileLoader(manager)
    const streamError = new Error('stream-failed')

    ;(global.fetch as jest.Mock).mockResolvedValue({
      status: 200,
      url: absolute('stream-error'),
      statusText: 'OK',
      headers: new Headers({ 'Content-Length': '3' }),
      body: {
        getReader: () => ({
          read: () => Promise.reject(streamError)
        })
      }
    } as unknown as Response)

    const result = await loadOnce(loader, 'stream-error')
    expect(result.error).toBe(streamError)
    expect(managerOnError).toHaveBeenCalledWith(absolute('stream-error'))
  })
})
