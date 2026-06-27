import {
  AcDbWorkerApi,
  AcDbWorkerManager,
  createWorkerApi
} from '../src/converter/worker/AcDbWorkerManager'

class FakeWorker {
  static created = 0
  private readonly listeners: Record<string, Array<(event: any) => void>> = {
    message: [],
    error: []
  }

  constructor(_url: string | URL) {
    FakeWorker.created += 1
  }

  addEventListener(type: 'message' | 'error', cb: (event: any) => void) {
    this.listeners[type].push(cb)
  }

  postMessage(payload: { id: string; input: unknown }) {
    if (payload.input === 'trigger-error') {
      const evt = { message: 'boom' }
      this.listeners.error.forEach(cb => cb(evt))
      return
    }
    if (payload.input === 'no-response') {
      return
    }
    const evt = {
      data: {
        id: payload.id,
        success: payload.input !== 'fail-result',
        data: payload.input,
        error: payload.input === 'fail-result' ? 'failed' : undefined
      }
    }
    this.listeners.message.forEach(cb => cb(evt))
  }

  terminate() {
    // no-op
  }
}

describe('AcDbWorkerManager / AcDbWorkerApi', () => {
  const originalWorker = (globalThis as unknown as { Worker?: unknown }).Worker

  beforeEach(() => {
    ;(globalThis as unknown as { Worker: unknown }).Worker =
      FakeWorker as unknown
    FakeWorker.created = 0
  })

  afterAll(() => {
    ;(globalThis as unknown as { Worker?: unknown }).Worker = originalWorker
  })

  it('executes tasks and returns result/error payloads', async () => {
    const manager = new AcDbWorkerManager({
      workerUrl: 'mock-worker.js',
      timeout: 20,
      maxConcurrentWorkers: 1
    })

    expect(manager.detectWorkerSupport()).toBe(true)

    const ok = await manager.execute<string, string>('hello')
    expect(ok.success).toBe(true)
    expect(ok.data).toBe('hello')

    const failed = await manager.execute<string, string>('fail-result')
    expect(failed.success).toBe(false)
    expect(failed.error).toBe('failed')

    const workerError = await manager.execute<string, string>('trigger-error')
    expect(workerError.success).toBe(false)
    expect(workerError.error).toContain('Worker error: boom')

    const timeout = await manager.execute<string, string>('no-response')
    expect(timeout.success).toBe(false)
    expect(timeout.error).toContain('timed out')

    const stats = manager.getStats()
    expect(stats.totalWorkers).toBeGreaterThan(0)

    manager.destroy()
    expect(manager.getStats().totalWorkers).toBe(0)
  })

  it('reuses wrapper API', async () => {
    const api = new AcDbWorkerApi({ workerUrl: 'mock-worker.js' })
    const result = await api.execute<string, string>('wrapped')
    expect(result.success).toBe(true)
    expect(result.data).toBe('wrapped')

    const viaFactory = createWorkerApi({ workerUrl: 'mock-worker.js' })
    expect(viaFactory.getStats().config.workerUrl).toBe('mock-worker.js')

    api.destroy()
    viaFactory.destroy()
  })

  it('reports no support when Worker is unavailable', () => {
    ;(globalThis as unknown as { Worker?: unknown }).Worker = undefined
    const manager = new AcDbWorkerManager({ workerUrl: 'mock-worker.js' })
    expect(manager.detectWorkerSupport()).toBe(false)
    manager.destroy()
  })
})
