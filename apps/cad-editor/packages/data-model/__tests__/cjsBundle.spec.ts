import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const requireCjs = createRequire(__filename)
const cjsPath = path.join(__dirname, '../dist/data-model.cjs')

type DataModelCjs = typeof import('../src/index')

describe('data-model CJS bundle', () => {
  let dm: DataModelCjs

  beforeAll(() => {
    if (!fs.existsSync(cjsPath)) {
      throw new Error(
        'dist/data-model.cjs not found. Run "pnpm run build" in packages/data-model first.'
      )
    }

    dm = requireCjs(cjsPath) as DataModelCjs
  })

  it('loads without circular dependency initialization errors', () => {
    expect(dm).toBeDefined()
  })

  it('exports core public APIs', () => {
    expect(typeof dm.AcDbDatabase).toBe('function')
    expect(typeof dm.AcDbObject).toBe('function')
    expect(typeof dm.AcDbDxfFiler).toBe('function')
    expect(typeof dm.AcDbDatabaseConverterManager).toBe('function')
    expect(typeof dm.acdbHostApplicationServices).toBe('function')
  })

  it('supports basic database instantiation', () => {
    const db = new dm.AcDbDatabase()
    expect(db).toBeInstanceOf(dm.AcDbDatabase)
    expect(db.tables).toBeDefined()
    expect(db.tables.layerTable).toBeDefined()
  })
})
