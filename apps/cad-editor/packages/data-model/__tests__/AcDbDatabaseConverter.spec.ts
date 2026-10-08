import { AcDbDatabase } from '../src/database/AcDbDatabase'
import { AcDbDatabaseConverter } from '../src/database/AcDbDatabaseConverter'

class LegacyConverter extends AcDbDatabaseConverter<unknown> {
  // Simulates a converter compiled before the CLASSES stage existed:
  // it overrides nothing beyond what the abstract base requires.
}

describe('AcDbDatabaseConverter', () => {
  it('treats the CLASSES stage as optional for legacy converters', () => {
    const converter = new LegacyConverter()
    const db = new AcDbDatabase()

    // The HEADER task calls processClasses unconditionally; a legacy
    // converter without an override must not abort the conversion
    // (regression: mlightcad/cad-viewer#437).
    expect(() =>
      (
        converter as unknown as {
          processClasses(model: unknown, db: AcDbDatabase): void
        }
      ).processClasses({}, db)
    ).not.toThrow()
  })

  it('keeps mandatory stages throwing for unimplemented converters', () => {
    const converter = new LegacyConverter()
    const db = new AcDbDatabase()

    expect(() =>
      (
        converter as unknown as {
          processHeader(model: unknown, db: AcDbDatabase): void
        }
      ).processHeader({}, db)
    ).toThrow()
  })
})
