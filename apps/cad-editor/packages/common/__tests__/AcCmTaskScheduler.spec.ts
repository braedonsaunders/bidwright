import { AcCmTask, AcCmTaskScheduler } from '../src'

class AddOneTask extends AcCmTask<number, number> {
  constructor() {
    super('add-one')
  }

  run(input: number) {
    return input + 1
  }
}

class AsyncDoubleTask extends AcCmTask<number, number> {
  constructor() {
    super('async-double')
  }

  async run(input: number) {
    return input * 2
  }
}

class ThrowTask extends AcCmTask<number, number> {
  constructor() {
    super('throw')
  }

  run(_input: number): number {
    throw new Error('boom')
  }
}

describe('AcCmTaskScheduler', () => {
  it('executes chained tasks', async () => {
    const scheduler = new AcCmTaskScheduler<number, number>()
    const progress = jest.fn()
    const complete = jest.fn()

    scheduler.addTask(new AddOneTask())
    scheduler.addTask(new AddOneTask())
    scheduler.setProgressCallback(progress)
    scheduler.setCompleteCallback(complete)

    await scheduler.run(1)

    expect(progress).toHaveBeenCalledTimes(2)
    expect(complete).toHaveBeenCalledWith(3)
  })

  it('uses requestAnimationFrame path when window API exists', async () => {
    const scheduler = new AcCmTaskScheduler<number, number>()
    const originalWindow = (globalThis as any).window

    ;(globalThis as any).window = {
      requestAnimationFrame: (cb: FrameRequestCallback) => cb(0)
    }

    scheduler.addTask(new AddOneTask())
    const done = jest.fn()
    scheduler.setCompleteCallback(done)

    await scheduler.run(10)

    expect(done).toHaveBeenCalledWith(11)
    ;(globalThis as any).window = originalWindow
  })

  it('handles errors without interrupt and still completes', async () => {
    const scheduler = new AcCmTaskScheduler<number, number>()
    const onError = jest.fn().mockReturnValue(false)
    const onComplete = jest.fn()

    scheduler.addTask(new ThrowTask())
    scheduler.addTask(new AddOneTask())
    scheduler.setErrorCallback(onError)
    scheduler.setCompleteCallback(onComplete)

    await scheduler.run(1)

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith(2)
  })

  it('rejects when error callback requests interruption', async () => {
    const scheduler = new AcCmTaskScheduler<number, number>()
    scheduler.addTask(new ThrowTask())
    scheduler.addTask(new AsyncDoubleTask())
    scheduler.setErrorCallback(() => true)

    await expect(scheduler.run(3)).rejects.toThrow('boom')
  })
})
