import { AcCmPerformanceCollector } from '../src'

describe('AcCmPerformanceCollector', () => {
  beforeEach(() => {
    AcCmPerformanceCollector.getInstance().clear()
    jest.restoreAllMocks()
  })

  it('stores and clears entries', () => {
    const collector = AcCmPerformanceCollector.getInstance()
    collector.collect({
      name: 'parse-time',
      data: 12,
      format() {
        return `${this.data}ms`
      }
    })

    expect(collector.getEntry('parse-time')).toBeDefined()
    expect(collector.getAll()).toHaveLength(1)

    collector.remove('parse-time')
    expect(collector.getAll()).toHaveLength(0)
    expect(collector.remove('not-exists')).toBe(false)
  })

  it('prints all entries', () => {
    const collector = AcCmPerformanceCollector.getInstance()
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

    collector.collect({
      name: 'io',
      data: 3,
      format() {
        return `io:${this.data}`
      }
    })

    collector.printAll()

    expect(logSpy).toHaveBeenCalledWith('io:')
    expect(logSpy).toHaveBeenCalledWith('io:3')
  })
})
