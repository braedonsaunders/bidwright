import {
  ACCM_DEFAULT_UI_YIELD_BUDGET_MS,
  AcCmUiYieldGate,
  accmYieldForPaint,
  accmYieldToUi
} from '../src/AcCmYieldToUi'

describe('accmYieldToUi', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('resolves via a single requestAnimationFrame when available', async () => {
    const callbacks: Array<() => void> = []
    const raf = jest.fn((cb: () => void) => {
      callbacks.push(cb)
      return callbacks.length
    })
    ;(
      globalThis as unknown as { requestAnimationFrame: typeof raf }
    ).requestAnimationFrame = raf

    const done = accmYieldToUi()
    expect(raf).toHaveBeenCalledTimes(1)
    callbacks[0]()
    await done
  })

  it('accmYieldForPaint uses double rAF', async () => {
    const callbacks: Array<() => void> = []
    const raf = jest.fn((cb: () => void) => {
      callbacks.push(cb)
      return callbacks.length
    })
    ;(
      globalThis as unknown as { requestAnimationFrame: typeof raf }
    ).requestAnimationFrame = raf

    const done = accmYieldForPaint()
    expect(raf).toHaveBeenCalledTimes(1)
    callbacks[0]()
    expect(raf).toHaveBeenCalledTimes(2)
    callbacks[1]()
    await done
  })
})

describe('AcCmUiYieldGate', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('skips yields inside the budget and yields after it elapses', async () => {
    let now = 1_000
    jest.spyOn(performance, 'now').mockImplementation(() => now)

    const yieldFn = jest.fn(() => Promise.resolve())
    const gate = new AcCmUiYieldGate(ACCM_DEFAULT_UI_YIELD_BUDGET_MS)

    await expect(gate.maybeYield(yieldFn)).resolves.toBe(false)
    expect(yieldFn).not.toHaveBeenCalled()

    now = 1_000 + ACCM_DEFAULT_UI_YIELD_BUDGET_MS - 1
    await expect(gate.maybeYield(yieldFn)).resolves.toBe(false)

    now = 1_000 + ACCM_DEFAULT_UI_YIELD_BUDGET_MS
    await expect(gate.maybeYield(yieldFn)).resolves.toBe(true)
    expect(yieldFn).toHaveBeenCalledTimes(1)

    await expect(gate.maybeYield(yieldFn)).resolves.toBe(false)
    expect(yieldFn).toHaveBeenCalledTimes(1)

    now = 1_000 + ACCM_DEFAULT_UI_YIELD_BUDGET_MS * 2
    await expect(gate.maybeYield(yieldFn)).resolves.toBe(true)
    expect(yieldFn).toHaveBeenCalledTimes(2)
  })

  it('mark resets the budget clock without yielding', async () => {
    let now = 5_000
    jest.spyOn(performance, 'now').mockImplementation(() => now)

    const yieldFn = jest.fn(() => Promise.resolve())
    const gate = new AcCmUiYieldGate(40)

    now = 5_050
    gate.mark()
    await expect(gate.maybeYield(yieldFn)).resolves.toBe(false)

    now = 5_090
    await expect(gate.maybeYield(yieldFn)).resolves.toBe(true)
    expect(yieldFn).toHaveBeenCalledTimes(1)
  })
})
