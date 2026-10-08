import { AcDbBlockTableRecord, AcDbBlockTableRecordFlag } from '../src/database/AcDbBlockTableRecord'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbBlockTableRecord', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbBlockTableRecord())
  })

  it('detects unresolved xrefs from flags and empty content', () => {
    const xref = new AcDbBlockTableRecord()
    xref.name = 'BASE'
    xref.flags = AcDbBlockTableRecordFlag.Xref
    xref.pathName = 'C:\\drawings\\base.dwg'
    expect(xref.isXref).toBe(true)
    expect(xref.isOverlayReference).toBe(false)
    expect(xref.isUnresolvedXref).toBe(true)

    const overlay = new AcDbBlockTableRecord()
    overlay.flags =
      AcDbBlockTableRecordFlag.XrefOverlay | AcDbBlockTableRecordFlag.Resolved
    expect(overlay.isXref).toBe(true)
    expect(overlay.isOverlayReference).toBe(true)
    expect(overlay.isUnresolvedXref).toBe(false)
  })

  it('strips AutoCAD-internal Resolved/Referenced bits on import', () => {
    // AutoCAD often writes 36 (Xref|Resolved) for attached xrefs whose geometry
    // is not present in the host file.
    const sanitized = AcDbBlockTableRecord.sanitizeImportedFlags(
      AcDbBlockTableRecordFlag.Xref | AcDbBlockTableRecordFlag.Resolved
    )
    expect(sanitized).toBe(AcDbBlockTableRecordFlag.Xref)

    const xref = new AcDbBlockTableRecord()
    xref.flags = sanitized
    xref.pathName = '.\\xref1.dwg'
    expect(xref.isUnresolvedXref).toBe(true)

    expect(
      AcDbBlockTableRecord.sanitizeImportedFlags(
        AcDbBlockTableRecordFlag.Xref |
          AcDbBlockTableRecordFlag.Resolved |
          AcDbBlockTableRecordFlag.Referenced
      )
    ).toBe(AcDbBlockTableRecordFlag.Xref)
  })
})
