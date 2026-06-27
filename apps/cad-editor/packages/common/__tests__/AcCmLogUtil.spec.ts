import * as logUtil from '../src/AcCmLogUtil'

describe('AcCmLogUtil', () => {
  it('exports debug mode and logger', () => {
    expect(logUtil.DEBUG_MODE).toBe(true)
    expect(typeof logUtil.log.setLevel).toBe('function')
  })

  it('accepts valid and invalid log levels without throwing', () => {
    expect(() => logUtil.setLogLevel('warn')).not.toThrow()
    expect(() => logUtil.setLogLevel('bad-level')).not.toThrow()
  })
})
