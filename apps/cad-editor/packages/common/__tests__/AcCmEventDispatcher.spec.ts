import { AcCmEventDispatcher } from '../src'

describe('AcCmEventDispatcher', () => {
  it('dispatches typed events', () => {
    const dispatcher = new AcCmEventDispatcher<{ done: { count: number } }>()
    const listener = jest.fn()
    dispatcher.addEventListener('done', listener)
    dispatcher.dispatchEvent({ type: 'done', count: 3 })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].count).toBe(3)
    expect(listener.mock.calls[0][0].target).toBe(dispatcher)

    dispatcher.removeEventListener('done', listener)
    dispatcher.dispatchEvent({ type: 'done', count: 4 })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('supports hasEventListener and prevents duplicate listeners', () => {
    const dispatcher = new AcCmEventDispatcher<{ tick: { step: number } }>()
    const listener = jest.fn()

    dispatcher.addEventListener('tick', listener)
    dispatcher.addEventListener('tick', listener)

    expect(dispatcher.hasEventListener('tick', listener)).toBe(true)

    dispatcher.dispatchEvent({ type: 'tick', step: 1 })
    expect(listener).toHaveBeenCalledTimes(1)

    dispatcher.removeEventListener('tick', listener)
    expect(dispatcher.hasEventListener('tick', listener)).toBe(false)
  })

  it('handles empty/internal undefined listeners map safely', () => {
    const dispatcher = new AcCmEventDispatcher<{ noop: {} }>()
    ;(dispatcher as unknown as { _listeners: undefined })._listeners = undefined

    expect(dispatcher.hasEventListener('noop', jest.fn())).toBe(false)
    expect(() =>
      dispatcher.removeEventListener('noop', jest.fn())
    ).not.toThrow()
    expect(() => dispatcher.dispatchEvent({ type: 'noop' })).not.toThrow()

    const listener = jest.fn()
    dispatcher.addEventListener('noop', listener)
    dispatcher.dispatchEvent({ type: 'noop' })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
