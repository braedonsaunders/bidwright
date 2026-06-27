import { AcDbWorkerApi } from '../src/converter/worker/AcDbWorkerManager'

describe('AcDbWorkerApi', () => {
  it('can be constructed', () => {
    const api = new AcDbWorkerApi({ workerUrl: 'mock-worker.js' })
    expect(api).toBeInstanceOf(AcDbWorkerApi)
    api.destroy()
  })
})
