import { acdbHostApplicationServices } from '../src/base/AcDbHostApplicationServices'
import { AcDbDatabase } from '../src/database/AcDbDatabase'
import { AcDbDataGenerator } from '../src/misc/AcDbDataGenerator'
import { AcDbLayoutManager } from '../src/object/layout/AcDbLayoutManager'

describe('AcDbLayoutManager', () => {
  it('manages layouts by name, id and block record id', () => {
    const db = new AcDbDatabase()
    new AcDbDataGenerator(db).createDefaultLayout()
    acdbHostApplicationServices().workingDatabase = db

    const manager = new AcDbLayoutManager()
    expect(manager.countLayouts(db)).toBeGreaterThanOrEqual(1)
    expect(manager.findActiveLayout()).toBe('Model')

    const createdEvents: string[] = []
    const renamedEvents: string[] = []
    const switchedEvents: string[] = []
    const removedEvents: string[] = []

    manager.events.layoutCreated.addEventListener(e =>
      createdEvents.push(e.layout.layoutName)
    )
    manager.events.layoutRenamed.addEventListener(e =>
      renamedEvents.push(`${e.oldName}->${e.newName}`)
    )
    manager.events.layoutSwitched.addEventListener(e =>
      switchedEvents.push(e.layout.layoutName)
    )
    manager.events.layoutRemoved.addEventListener(e =>
      removedEvents.push(e.layout.layoutName)
    )

    const created = manager.createLayout('Sheet1', db)
    expect(created.layout.layoutName).toBe('Sheet1')
    expect(createdEvents).toContain('Sheet1')

    expect(manager.findLayoutNamed('Sheet1', db)).toBeDefined()
    const modelLayout = manager.findLayoutNamed('Model', db)
    if (modelLayout) {
      expect(manager.setCurrentLayout('Model', db)).toBe(true)
      expect(manager.setCurrentLayoutId(modelLayout.objectId, db)).toBe(true)
      expect(
        manager.setCurrentLayoutBtrId(modelLayout.blockTableRecordId, db)
      ).toBe(true)
      expect(switchedEvents).toContain('Model')
    }

    expect(manager.renameLayout('Sheet1', 'SheetA', db)).toBe(true)
    expect(renamedEvents).toContain('Sheet1->SheetA')
    expect(manager.renameLayout('Missing', 'X', db)).toBe(false)

    expect(manager.deleteLayout('Sheet1', db)).toBe(true)
    expect(removedEvents).toContain('SheetA')
    expect(manager.deleteLayout('Missing', db)).toBe(false)

    expect(manager.setCurrentLayout('Missing', db)).toBe(false)
    expect(manager.setCurrentLayoutId('missing-id', db)).toBe(false)
    expect(manager.setCurrentLayoutBtrId('missing-btr-id', db)).toBe(false)
  })

  it('provides layout manager through host services', () => {
    ;(
      acdbHostApplicationServices() as unknown as {
        _layoutManager?: unknown
      }
    )._layoutManager = undefined
    expect(acdbHostApplicationServices().layoutManager).toBeInstanceOf(
      AcDbLayoutManager
    )
  })
})
