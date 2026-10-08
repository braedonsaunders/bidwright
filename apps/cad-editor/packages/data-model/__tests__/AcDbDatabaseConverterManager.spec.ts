import {
  AcDbDatabaseConverterManager,
  AcDbFileType
} from '../src/database/AcDbDatabaseConverterManager'
import { AcDbNativeDxfConverter } from '../src/dxf/AcDbNativeDxfConverter'

describe('AcDbDatabaseConverterManager', () => {
  it('creates a singleton instance', () => {
    const manager = AcDbDatabaseConverterManager.instance
    expect(AcDbDatabaseConverterManager.createInstance()).toBe(manager)
  })

  it('registers a native DXF converter by default', () => {
    const manager = AcDbDatabaseConverterManager.instance
    expect(manager.get(AcDbFileType.DXF)).toBeInstanceOf(AcDbNativeDxfConverter)
  })

  it('replaces a DXF converter when register is called again', () => {
    // Mirrors production: the manager registers AcDbNativeDxfConverter by default,
    // then apps may replace it (e.g. with AcDbDxfConverter from dxf-json-converter).
    const manager = AcDbDatabaseConverterManager.instance
    const nativeDefault = { read: jest.fn(), name: 'native' } as any
    const replacement = { read: jest.fn(), name: 'json' } as any

    manager.register(AcDbFileType.DXF, nativeDefault)
    expect(manager.get(AcDbFileType.DXF)).toBe(nativeDefault)

    manager.register(AcDbFileType.DXF, replacement)
    expect(manager.get(AcDbFileType.DXF)).toBe(replacement)
  })

  it('registers and unregisters converters with events', () => {
    const manager = AcDbDatabaseConverterManager.instance
    const custom = {
      read: jest.fn()
    } as any

    const registered: string[] = []
    const unregistered: string[] = []

    manager.events.registered.addEventListener(evt =>
      registered.push(evt.fileType)
    )
    manager.events.unregistered.addEventListener(evt =>
      unregistered.push(evt.fileType)
    )

    manager.register('custom', custom)
    expect(manager.get('custom')).toBe(custom)
    expect(registered).toContain('custom')

    manager.unregister('custom')
    expect(manager.get('custom')).toBeUndefined()
    expect(unregistered).toContain('custom')

    manager.unregister('missing')
  })
})
