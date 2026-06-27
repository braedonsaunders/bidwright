import { AcTrStringUtil } from '../src'

describe('AcTrStringUtil', () => {
  it('formats bytes', () => {
    expect(AcTrStringUtil.formatBytes(0)).toBe('0 B')
    expect(AcTrStringUtil.formatBytes(1536, 1)).toBe('1.5 KB')
  })
})
