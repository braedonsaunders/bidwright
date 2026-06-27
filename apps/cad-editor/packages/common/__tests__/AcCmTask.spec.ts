import { AcCmTask } from '../src'

describe('AcCmTask', () => {
  it('throws if run is not implemented by subclass', () => {
    const baseTask = new AcCmTask<number, number>('base')
    expect(() => baseTask.run(1)).toThrow(
      'run() must be implemented by subclass'
    )
  })
})
