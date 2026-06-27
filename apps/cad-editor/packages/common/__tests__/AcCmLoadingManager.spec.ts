import { AcCmLoader, AcCmLoadingManager } from '../src'

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

describe('AcCmLoadingManager', () => {
  it('manages handlers and lifecycle callbacks', () => {
    const onStart = jest.fn()
    const onProgress = jest.fn()
    const onLoad = jest.fn()
    const onError = jest.fn()
    const manager = new AcCmLoadingManager(onLoad, onProgress, onError)
    const loader = new DummyLoader(manager)

    manager.onStart = onStart

    expect(manager.resolveURL('a.txt')).toBe('a.txt')
    manager.setURLModifier(url => `/static/${url}`)
    expect(manager.resolveURL('a.txt')).toBe('/static/a.txt')

    const txtPattern = /\.txt$/g
    manager.addHandler(txtPattern, loader)
    expect(manager.getHandler('a.txt')).toBe(loader)
    manager.removeHandler(/\.png$/)
    manager.removeHandler(txtPattern)
    expect(manager.getHandler('a.txt')).toBeNull()

    manager.itemStart('a')
    manager.itemEnd('a')
    expect(onStart).toHaveBeenCalledWith('a', 0, 1)
    expect(onProgress).toHaveBeenCalledWith('a', 1, 1)
    expect(onLoad).toHaveBeenCalledTimes(1)

    manager.itemError('bad')
    expect(onError).toHaveBeenCalledWith('bad')
  })
})
