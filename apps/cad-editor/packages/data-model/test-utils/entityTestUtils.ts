import { acdbHostApplicationServices } from '../src/base'
import { AcDbDatabase } from '../src/database'
import { AcDbEntity } from '../src/entity'

export const setupWorkingDatabase = () => {
  const db = new AcDbDatabase()
  db.createDefaultData()
  acdbHostApplicationServices().workingDatabase = db
  return db
}

export const appendEntityToModelSpace = <T extends AcDbEntity>(
  db: AcDbDatabase,
  entity: T
) => {
  db.tables.blockTable.modelSpace.appendEntity(entity)
  return entity
}

export const attachEntityToNewModelSpace = <T extends AcDbEntity>(
  entity: T
) => {
  const db = setupWorkingDatabase()
  appendEntityToModelSpace(db, entity)
  return db
}

export const getDxfGroupValues = (dxfText: string, code: number) => {
  const lines = dxfText.trim().split(/\r?\n/)
  const values: string[] = []
  for (let i = 0; i < lines.length - 1; i += 2) {
    if (Number(lines[i]) === code) values.push(lines[i + 1])
  }
  return values
}
