import { AcCmLoader, AcCmLoadingManager, DefaultLoadingManager } from '../src'

class DummyLoader extends AcCmLoader {
  load(
    url: string,
    onLoad?: (data: unknown) => void,
    _onProgress?: (progress: ProgressEvent) => void,
    _onError?: (errorUrl: string) => void
  ) {
    onLoad?.({ ok: true, url })
  }
}

describe('AcCmLoader', () => {
  it('supports basic configuration and async loading', async () => {
    const manager = new AcCmLoadingManager()
    const dummy = new DummyLoader(manager)

    dummy
      .setPath('/assets/')
      .setResourcePath('/res/')
      .setCrossOrigin('use-credentials')
      .setWithCredentials(true)
      .setRequestHeader({ Authorization: 'Bearer token' })

    const result = await dummy.loadAsync('file.bin', () => {})
    expect(result).toEqual({ ok: true, url: 'file.bin' })
    expect(dummy.parse('x')).toBeUndefined()
  })

  it('uses default loading manager when manager is omitted', () => {
    const dummy = new DummyLoader()
    expect(dummy.manager).toBe(DefaultLoadingManager)
  })
})
