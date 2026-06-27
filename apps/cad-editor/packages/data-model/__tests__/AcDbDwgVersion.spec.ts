import { AcDbDwgVersion } from '../src/database/AcDbDwgVersion'

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
})
