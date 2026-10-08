import { AcDbDwgVersion } from '../src/database/AcDbDwgVersion'
import { acdbDxfVersionCaps } from '../src/dxf/AcDbDxfVersionCaps'

describe('AcDbDwgVersion', () => {
  it('constructs from known name and value', () => {
    const fromName = new AcDbDwgVersion('AC1032')
    expect(fromName.value).toBe(33)

    const fromValue = new AcDbDwgVersion(23)
    expect(fromValue.name).toBe('AC1015')
  })

  it('throws for unknown values', () => {
    expect(() => new AcDbDwgVersion('UNKNOWN')).toThrow(
      'Unknown DWG version name: UNKNOWN'
    )
    expect(() => new AcDbDwgVersion(999)).toThrow(
      'Unknown DWG version value: 999'
    )
  })

  it('exposes DXF capability truth table across key versions', () => {
    const cases: Array<{
      name: string
      expect: {
        supportsHandles: boolean
        supportsSubclassMarkers: boolean
        supportsClassesSection: boolean
        supportsObjectsSection: boolean
        supportsBlockRecordTable: boolean
        supportsLwPolyline: boolean
        supportsLineWeight: boolean
        supportsTrueColor: boolean
        supportsTransparency: boolean
        supportsUtf8CodePage: boolean
      }
    }> = [
      {
        name: 'AC1009',
        expect: {
          supportsHandles: false,
          supportsSubclassMarkers: false,
          supportsClassesSection: false,
          supportsObjectsSection: false,
          supportsBlockRecordTable: false,
          supportsLwPolyline: false,
          supportsLineWeight: false,
          supportsTrueColor: false,
          supportsTransparency: false,
          supportsUtf8CodePage: false
        }
      },
      {
        name: 'AC1015',
        expect: {
          supportsHandles: true,
          supportsSubclassMarkers: true,
          supportsClassesSection: true,
          supportsObjectsSection: true,
          supportsBlockRecordTable: true,
          supportsLwPolyline: true,
          supportsLineWeight: true,
          supportsTrueColor: false,
          supportsTransparency: false,
          supportsUtf8CodePage: false
        }
      },
      {
        name: 'AC1018',
        expect: {
          supportsHandles: true,
          supportsSubclassMarkers: true,
          supportsClassesSection: true,
          supportsObjectsSection: true,
          supportsBlockRecordTable: true,
          supportsLwPolyline: true,
          supportsLineWeight: true,
          supportsTrueColor: true,
          supportsTransparency: true,
          supportsUtf8CodePage: false
        }
      },
      {
        name: 'AC1021',
        expect: {
          supportsHandles: true,
          supportsSubclassMarkers: true,
          supportsClassesSection: true,
          supportsObjectsSection: true,
          supportsBlockRecordTable: true,
          supportsLwPolyline: true,
          supportsLineWeight: true,
          supportsTrueColor: true,
          supportsTransparency: true,
          supportsUtf8CodePage: true
        }
      },
      {
        name: 'AC1032',
        expect: {
          supportsHandles: true,
          supportsSubclassMarkers: true,
          supportsClassesSection: true,
          supportsObjectsSection: true,
          supportsBlockRecordTable: true,
          supportsLwPolyline: true,
          supportsLineWeight: true,
          supportsTrueColor: true,
          supportsTransparency: true,
          supportsUtf8CodePage: true
        }
      }
    ]

    for (const row of cases) {
      expect(acdbDxfVersionCaps(row.name)).toEqual(row.expect)
      expect(new AcDbDwgVersion(row.name).capabilities).toEqual(row.expect)
    }
  })
})
