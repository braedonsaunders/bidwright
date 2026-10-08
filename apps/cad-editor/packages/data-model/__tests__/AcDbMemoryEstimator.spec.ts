import { AcGePoint3d } from '@mlightcad/geometry-engine'

import { AcDbLine } from '../src/entity/AcDbLine'
import { AcDbMText } from '../src/entity/AcDbMText'
import { AcDbProxyEntity } from '../src/entity/AcDbProxyEntity'
import {
  acdbEstimateDatabaseMemory,
  acdbFormatMemoryEstimate,
  acdbFormatMemoryBytes
} from '../src/misc/AcDbMemoryEstimator'
import {
  appendEntityToModelSpace,
  setupWorkingDatabase
} from '../test-utils/entityTestUtils'

describe('AcDbMemoryEstimator', () => {
  it('reports a stable lower bound for an empty default database', () => {
    const db = setupWorkingDatabase()
    const report = acdbEstimateDatabaseMemory(db)

    expect(report.totalBytes).toBeGreaterThan(10_000)
    expect(report.objectCount).toBeGreaterThan(10)
    expect(report.entityCount).toBe(0)
    expect(report.byCategory.tables?.bytes).toBeGreaterThan(0)
    expect(report.byCategory.sysvars?.bytes).toBeGreaterThan(0)
    expect(report.byCategory.handleRegistry?.bytes).toBeGreaterThan(0)
    expect(report.byCategory.events).toBeUndefined()
    expect(report.byCategory.transaction).toBeUndefined()
  })

  it('increases total and entity stats when lines are appended', () => {
    const db = setupWorkingDatabase()
    const before = acdbEstimateDatabaseMemory(db)

    for (let i = 0; i < 50; i++) {
      appendEntityToModelSpace(
        db,
        new AcDbLine(new AcGePoint3d(i, 0, 0), new AcGePoint3d(i, 1, 0))
      )
    }

    const after = acdbEstimateDatabaseMemory(db)

    expect(after.totalBytes).toBeGreaterThan(before.totalBytes)
    expect(after.entityCount).toBe(50)
    expect(after.byCategory.entities?.bytes).toBeGreaterThan(0)
    expect(after.byEntityType.Line?.count).toBe(50)
    expect(after.byEntityType.Line?.bytes).toBeGreaterThan(0)
    expect(after.objectCount).toBeGreaterThan(before.objectCount)
  })

  it('accounts for large MText string payloads', () => {
    const db = setupWorkingDatabase()
    const withShort = setupWorkingDatabase()
    const short = new AcDbMText()
    short.contents = 'hi'
    appendEntityToModelSpace(withShort, short)

    const long = new AcDbMText()
    long.contents = 'x'.repeat(50_000)
    appendEntityToModelSpace(db, long)

    const shortReport = acdbEstimateDatabaseMemory(withShort)
    const longReport = acdbEstimateDatabaseMemory(db)

    const shortMText = shortReport.byEntityType.MText?.bytes ?? 0
    const longMText = longReport.byEntityType.MText?.bytes ?? 0

    // UTF-16 payload alone is ~100 KiB; long text must dominate.
    expect(longMText - shortMText).toBeGreaterThan(80_000)
    expect(longReport.totalBytes).toBeGreaterThan(shortReport.totalBytes)
  })

  it('accounts for TypedArray proxy graphic payloads', () => {
    const db = setupWorkingDatabase()
    const before = acdbEstimateDatabaseMemory(db)

    const proxy = new AcDbProxyEntity()
    proxy.setProxyGraphic(new Uint8Array(20_000))
    appendEntityToModelSpace(db, proxy)

    const after = acdbEstimateDatabaseMemory(db)
    expect(after.totalBytes - before.totalBytes).toBeGreaterThan(15_000)
    expect(after.byEntityType.ProxyEntity?.count).toBe(1)
    expect(after.byEntityType.ProxyEntity?.bytes).toBeGreaterThan(15_000)
  })

  it('formats estimates for display', () => {
    const db = setupWorkingDatabase()
    const report = acdbEstimateDatabaseMemory(db)
    const text = acdbFormatMemoryEstimate(report)

    expect(acdbFormatMemoryBytes(512)).toBe('512 B')
    expect(acdbFormatMemoryBytes(2048)).toBe('2.00 KiB')
    expect(text).toContain('AcDbDatabase memory estimate:')
    expect(text).toContain('By category:')
    expect(text).toContain('tables:')
  })

  it('can optionally include transaction manager', () => {
    const db = setupWorkingDatabase()
    const without = acdbEstimateDatabaseMemory(db)
    const withTx = acdbEstimateDatabaseMemory(db, {
      includeTransactionManager: true
    })

    expect(withTx.totalBytes).toBeGreaterThanOrEqual(without.totalBytes)
    expect(withTx.byCategory.transaction?.bytes).toBeGreaterThan(0)
  })
})
