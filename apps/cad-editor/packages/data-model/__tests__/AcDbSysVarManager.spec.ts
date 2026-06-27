import { AcCmColor, AcCmTransparency } from '@mlightcad/common'

import { acdbHostApplicationServices } from '../src/base/AcDbHostApplicationServices'
import { AcDbDatabase } from '../src/database/AcDbDatabase'
import { AcDbSystemVariables } from '../src/database/AcDbSystemVariables'
import { AcDbSysVarManager } from '../src/database/AcDbSysVarManager'

describe('AcDbSysVarManager', () => {
  it('gets and sets db/non-db vars with conversion and events', () => {
    const db = new AcDbDatabase()
    const manager = AcDbSysVarManager.instance()

    const unknownName = '__unit_test_unknown__'
    expect(() => manager.getVar(unknownName, db)).toThrow(
      'System variable __unit_test_unknown__ not found!'
    )

    const oldPickbox = manager.getVar(AcDbSystemVariables.PICKBOX, db)
    const oldGripColor = manager.getVar(AcDbSystemVariables.GRIPCOLOR, db)
    const oldGripHot = manager.getVar(AcDbSystemVariables.GRIPHOT, db)
    const oldGripObjLimit = manager.getVar(AcDbSystemVariables.GRIPOBJLIMIT, db)
    const oldGrips = manager.getVar(AcDbSystemVariables.GRIPS, db)
    const oldGripSize = manager.getVar(AcDbSystemVariables.GRIPSIZE, db)
    const events: string[] = []
    manager.events.sysVarChanged.addEventListener(e => events.push(e.name))

    manager.setVar(AcDbSystemVariables.PICKBOX, '12', db)
    expect(manager.getVar(AcDbSystemVariables.PICKBOX, db)).toBe(12)

    expect(manager.getVar(AcDbSystemVariables.GRIPCOLOR, db)).toBe(150)
    manager.setVar(AcDbSystemVariables.GRIPCOLOR, '5', db)
    expect(manager.getVar(AcDbSystemVariables.GRIPCOLOR, db)).toBe(5)
    manager.setVar(AcDbSystemVariables.GRIPCOLOR, 255, db)
    expect(manager.getVar(AcDbSystemVariables.GRIPCOLOR, db)).toBe(255)
    expect(() => manager.setVar(AcDbSystemVariables.GRIPCOLOR, 0, db)).toThrow(
      'Invalid GRIPCOLOR value! Valid range is 1 to 255.'
    )
    expect(() =>
      manager.setVar(AcDbSystemVariables.GRIPCOLOR, 256, db)
    ).toThrow('Invalid GRIPCOLOR value! Valid range is 1 to 255.')

    expect(manager.getVar(AcDbSystemVariables.GRIPHOT, db)).toBe(12)
    manager.setVar(AcDbSystemVariables.GRIPHOT, '5', db)
    expect(manager.getVar(AcDbSystemVariables.GRIPHOT, db)).toBe(5)
    manager.setVar(AcDbSystemVariables.GRIPHOT, 255, db)
    expect(manager.getVar(AcDbSystemVariables.GRIPHOT, db)).toBe(255)
    expect(() => manager.setVar(AcDbSystemVariables.GRIPHOT, 0, db)).toThrow(
      'Invalid GRIPHOT value! Valid range is 1 to 255.'
    )
    expect(() => manager.setVar(AcDbSystemVariables.GRIPHOT, 256, db)).toThrow(
      'Invalid GRIPHOT value! Valid range is 1 to 255.'
    )

    expect(manager.getVar(AcDbSystemVariables.GRIPOBJLIMIT, db)).toBe(100)
    manager.setVar(AcDbSystemVariables.GRIPOBJLIMIT, '50', db)
    expect(manager.getVar(AcDbSystemVariables.GRIPOBJLIMIT, db)).toBe(50)
    manager.setVar(AcDbSystemVariables.GRIPOBJLIMIT, 0, db)
    expect(manager.getVar(AcDbSystemVariables.GRIPOBJLIMIT, db)).toBe(0)
    expect(() =>
      manager.setVar(AcDbSystemVariables.GRIPOBJLIMIT, 32768, db)
    ).toThrow('Invalid GRIPOBJLIMIT value! Valid range is 0 to 32767.')

    expect(manager.getVar(AcDbSystemVariables.GRIPS, db)).toBe(2)
    manager.setVar(AcDbSystemVariables.GRIPS, '1', db)
    expect(manager.getVar(AcDbSystemVariables.GRIPS, db)).toBe(1)
    manager.setVar(AcDbSystemVariables.GRIPS, 0, db)
    expect(manager.getVar(AcDbSystemVariables.GRIPS, db)).toBe(0)
    expect(() => manager.setVar(AcDbSystemVariables.GRIPS, 3, db)).toThrow(
      'Invalid GRIPS value! Valid range is 0 to 2.'
    )

    expect(manager.getVar(AcDbSystemVariables.GRIPSIZE, db)).toBe(5)
    manager.setVar(AcDbSystemVariables.GRIPSIZE, '10', db)
    expect(manager.getVar(AcDbSystemVariables.GRIPSIZE, db)).toBe(10)
    manager.setVar(AcDbSystemVariables.GRIPSIZE, 255, db)
    expect(manager.getVar(AcDbSystemVariables.GRIPSIZE, db)).toBe(255)
    expect(() => manager.setVar(AcDbSystemVariables.GRIPSIZE, 0, db)).toThrow(
      'Invalid GRIPSIZE value! Valid range is 1 to 255.'
    )
    expect(() => manager.setVar(AcDbSystemVariables.GRIPSIZE, 256, db)).toThrow(
      'Invalid GRIPSIZE value! Valid range is 1 to 255.'
    )

    manager.setVar(AcDbSystemVariables.DYNPROMPT, 'false', db)
    expect(manager.getVar(AcDbSystemVariables.DYNPROMPT, db)).toBe(false)

    manager.setVar(AcDbSystemVariables.MEASUREMENTCOLOR, 'red', db)
    expect(
      manager.getVar(AcDbSystemVariables.MEASUREMENTCOLOR, db)
    ).toBeInstanceOf(AcCmColor)

    expect(events).toContain(AcDbSystemVariables.PICKBOX.toLowerCase())

    manager.setVar(AcDbSystemVariables.CLAYER, '0', db)
    expect(manager.getVar(AcDbSystemVariables.CLAYER, db)).toBe('0')

    manager.setVar(AcDbSystemVariables.CMLSTYLE, 'FILL', db)
    expect(manager.getVar(AcDbSystemVariables.CMLSTYLE, db)).toBe('FILL')
    manager.setVar(AcDbSystemVariables.CMLSCALE, 20, db)
    expect(manager.getVar(AcDbSystemVariables.CMLSCALE, db)).toBe(20)

    manager.setVar(AcDbSystemVariables.CMLEADERSTYLE, 'ANNOTATION', db)
    expect(manager.getVar(AcDbSystemVariables.CMLEADERSTYLE, db)).toBe(
      'ANNOTATION'
    )
    manager.setVar(AcDbSystemVariables.HPCOLOR, 'RGB:10,20,30', db)
    expect(manager.getVar(AcDbSystemVariables.HPCOLOR, db)?.toString()).toBe(
      'RGB:10,20,30'
    )
    expect(
      manager.getDescriptor(AcDbSystemVariables.CETRANSPARENCY)?.type
    ).toBe('transparency')
    manager.setVar(AcDbSystemVariables.CETRANSPARENCY, '25', db)
    const ceTransparency = manager.getVar(
      AcDbSystemVariables.CETRANSPARENCY,
      db
    )
    expect(ceTransparency).toBeInstanceOf(AcCmTransparency)
    expect((ceTransparency as AcCmTransparency).percentage).toBe(25)

    const serializedTransparency = new AcCmTransparency()
    serializedTransparency.percentage = 30
    manager.setVar(
      AcDbSystemVariables.CETRANSPARENCY,
      serializedTransparency.serialize(),
      db
    )
    expect(db.cetransparency.percentage).toBe(30)

    const directTransparency = new AcCmTransparency()
    directTransparency.percentage = 40
    db.cetransparency = directTransparency
    directTransparency.percentage = 45
    expect(db.cetransparency.percentage).toBe(40)

    manager.setVar(AcDbSystemVariables.HPTRANSPARENCY, '35', db)
    const hpTransparency = manager.getVar(
      AcDbSystemVariables.HPTRANSPARENCY,
      db
    )
    expect(hpTransparency).toBeInstanceOf(AcCmTransparency)
    expect((hpTransparency as AcCmTransparency).percentage).toBe(35)

    manager.setVar(AcDbSystemVariables.CELTYPE, 'BYLAYER', db)
    expect(manager.getVar(AcDbSystemVariables.CELTYPE, db)).toBe('ByLayer')

    manager.setVar(AcDbSystemVariables.POLARMODE, 3, db)
    expect(manager.getVar(AcDbSystemVariables.POLARMODE, db)).toBe(3)
    manager.setVar(AcDbSystemVariables.POLARANG, '45', db)
    expect(manager.getVar(AcDbSystemVariables.POLARANG, db)).toBe(45)
    manager.setVar(AcDbSystemVariables.POLARADDANG, '15;30;60', db)
    expect(manager.getVar(AcDbSystemVariables.POLARADDANG, db)).toBe('15;30;60')

    expect(() =>
      manager.setVar(AcDbSystemVariables.PICKBOX, 'NaN-input', db)
    ).toThrow('Invalid number input!')
    expect(() =>
      manager.setVar(AcDbSystemVariables.MEASUREMENTCOLOR, 'bad-color', db)
    ).toThrow('Invalid color value!')

    manager.setVar(AcDbSystemVariables.PICKBOX, oldPickbox as number, db)
    manager.setVar(AcDbSystemVariables.GRIPCOLOR, oldGripColor as number, db)
    manager.setVar(AcDbSystemVariables.GRIPHOT, oldGripHot as number, db)
    manager.setVar(
      AcDbSystemVariables.GRIPOBJLIMIT,
      oldGripObjLimit as number,
      db
    )
    manager.setVar(AcDbSystemVariables.GRIPS, oldGrips as number, db)
    manager.setVar(AcDbSystemVariables.GRIPSIZE, oldGripSize as number, db)
  })

  it('supports registry helpers and defaults', () => {
    const db = new AcDbDatabase()
    const manager = AcDbSysVarManager.instance()

    manager.registerVar({
      name: '__UNIT_BOOL__',
      type: 'boolean',
      isDbVar: false,
      defaultValue: true
    })

    manager.registerMany([
      {
        name: '__UNIT_NUM__',
        type: 'number',
        isDbVar: false,
        defaultValue: 1
      }
    ])

    expect(manager.getDescriptor('__UNIT_BOOL__')?.name).toBe('__unit_bool__')
    expect(manager.getDefaultValue('__UNIT_BOOL__')).toBe(true)
    expect(manager.getVar('__UNIT_BOOL__', db)).toBe(true)
    expect(manager.getDefaultValue(AcDbSystemVariables.CMLSTYLE)).toBe(
      'Standard'
    )
    expect(manager.getDefaultValue(AcDbSystemVariables.CMLSCALE)).toBe(1)
    expect(manager.getDefaultValue(AcDbSystemVariables.CMLEADERSTYLE)).toBe(
      'Standard'
    )
    expect(manager.getDefaultValue(AcDbSystemVariables.HPASSOC)).toBe(1)
    expect(manager.getDefaultValue(AcDbSystemVariables.HPANG)).toBe(0)
    expect(
      manager.getDefaultValue(AcDbSystemVariables.HPBACKGROUNDCOLOR)?.toString()
    ).toBe('None')
    expect(
      manager.getDefaultValue(AcDbSystemVariables.HPCOLOR)?.toString()
    ).toBe('ByLayer')
    expect(manager.getDefaultValue(AcDbSystemVariables.HPDOUBLE)).toBe(0)
    expect(manager.getDefaultValue(AcDbSystemVariables.HPISLANDDETECTION)).toBe(
      1
    )
    expect(manager.getDefaultValue(AcDbSystemVariables.HPLAYER)).toBe('.')
    expect(manager.getDefaultValue(AcDbSystemVariables.HPNAME)).toBe('ANGLE')
    expect(manager.getDefaultValue(AcDbSystemVariables.HPSCALE)).toBe(1)
    expect(manager.getDefaultValue(AcDbSystemVariables.HPSEPARATE)).toBe(0)
    expect(
      manager.getDefaultValue(AcDbSystemVariables.CETRANSPARENCY)
    ).toBeInstanceOf(AcCmTransparency)
    expect(
      manager.getDefaultValue(AcDbSystemVariables.CETRANSPARENCY)?.toString()
    ).toBe('ByLayer')
    expect(
      manager.getDefaultValue(AcDbSystemVariables.HPTRANSPARENCY)
    ).toBeInstanceOf(AcCmTransparency)
    expect(
      manager.getDefaultValue(AcDbSystemVariables.HPTRANSPARENCY)?.toString()
    ).toBe('ByLayer')
    expect(manager.getDefaultValue(AcDbSystemVariables.CELTYPE)).toBe('ByLayer')
    expect(manager.getDefaultValue(AcDbSystemVariables.POLARADDANG)).toBe('')
    expect(manager.getDefaultValue(AcDbSystemVariables.POLARMODE)).toBe(0)
    expect(manager.getDefaultValue(AcDbSystemVariables.POLARANG)).toBe(90)
    expect(manager.getDefaultValue(AcDbSystemVariables.GRIPCOLOR)).toBe(150)
    expect(manager.getDefaultValue(AcDbSystemVariables.GRIPHOT)).toBe(12)
    expect(manager.getDefaultValue(AcDbSystemVariables.GRIPOBJLIMIT)).toBe(100)
    expect(manager.getDefaultValue(AcDbSystemVariables.GRIPS)).toBe(2)
    expect(manager.getDefaultValue(AcDbSystemVariables.GRIPSIZE)).toBe(5)
    expect(manager.getAllDescriptors().length).toBeGreaterThan(0)
    expect(() => manager.getDefaultValue('__NOT_FOUND__')).toThrow(
      'System variable __not_found__ not found!'
    )
  })

  it('exposes read-only DWGNAME on the working database', () => {
    const db = new AcDbDatabase()
    acdbHostApplicationServices().workingDatabase = db
    const manager = AcDbSysVarManager.instance()
    const workingDb = acdbHostApplicationServices().workingDatabase

    expect(workingDb.dwgname).toMatch(/^Drawing\d+\.dwg$/)
    expect(manager.getVar(AcDbSystemVariables.DWGNAME, workingDb)).toBe(
      workingDb.dwgname
    )
    expect(manager.getDefaultValue(AcDbSystemVariables.DWGNAME)).toBe(
      'Drawing1.dwg'
    )

    workingDb.setDwgName('Floor Plan.dwg')
    expect(manager.getVar(AcDbSystemVariables.DWGNAME, workingDb)).toBe(
      'Floor Plan.dwg'
    )

    expect(() =>
      manager.setVar(AcDbSystemVariables.DWGNAME, 'Other.dwg', workingDb)
    ).toThrow('System variable dwgname is read-only!')
  })
})