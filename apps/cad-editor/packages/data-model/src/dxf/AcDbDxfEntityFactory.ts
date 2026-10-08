import type { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDb3dSolid } from '../entity/AcDb3dSolid'
import { AcDbArc } from '../entity/AcDbArc'
import { AcDbArcAlignedText } from '../entity/AcDbArcAlignedText'
import { AcDbAttribute } from '../entity/AcDbAttribute'
import { AcDbAttributeDefinition } from '../entity/AcDbAttributeDefinition'
import { AcDbBlockReference } from '../entity/AcDbBlockReference'
import { AcDbCircle } from '../entity/AcDbCircle'
import { AcDbEllipse } from '../entity/AcDbEllipse'
import type { AcDbEntity } from '../entity/AcDbEntity'
import { AcDbFace } from '../entity/AcDbFace'
import { AcDbFcf } from '../entity/AcDbFcf'
import { AcDbHatch } from '../entity/AcDbHatch'
import { AcDbLeader } from '../entity/AcDbLeader'
import { AcDbLine } from '../entity/AcDbLine'
import { AcDbMLeader } from '../entity/AcDbMLeader'
import { AcDbMLine } from '../entity/AcDbMLine'
import { AcDbMText } from '../entity/AcDbMText'
import { AcDbOle2Frame } from '../entity/AcDbOle2Frame'
import { AcDbOleFrame } from '../entity/AcDbOleFrame'
import { AcDbPoint } from '../entity/AcDbPoint'
import { AcDbPolyline } from '../entity/AcDbPolyline'
import { AcDbProxyEntity } from '../entity/AcDbProxyEntity'
import { AcDbRasterImage } from '../entity/AcDbRasterImage'
import { AcDbRay } from '../entity/AcDbRay'
import { AcDbShape } from '../entity/AcDbShape'
import { AcDbSolid } from '../entity/AcDbSolid'
import { AcDbSpline } from '../entity/AcDbSpline'
import { AcDbTable } from '../entity/AcDbTable'
import { AcDbText } from '../entity/AcDbText'
import { AcDbTrace } from '../entity/AcDbTrace'
import { AcDbViewport } from '../entity/AcDbViewport'
import { AcDbWipeout } from '../entity/AcDbWipeout'
import { AcDbXline } from '../entity/AcDbXline'
import { acdbDxfInDimension } from './AcDbDxfDimensionAssembler'
import { acdbDxfInPolyline } from './AcDbDxfPolylineAssembler'

/**
 * Creates an empty entity instance for the given DXF type name, ready for dxfIn.
 * Returns null for unsupported types (caller should skip to next code 0).
 */
export function acdbCreateEntityForDxfIn(typeName: string): AcDbEntity | null {
  const type = typeName.toUpperCase()
  switch (type) {
    case 'LINE':
      return new AcDbLine()
    case 'CIRCLE':
      return new AcDbCircle()
    case 'ARC':
      return new AcDbArc()
    case 'POINT':
      return new AcDbPoint()
    case 'RAY':
      return new AcDbRay()
    case 'XLINE':
      return new AcDbXline()
    case 'ELLIPSE':
      return new AcDbEllipse()
    case 'SOLID':
      // Converter maps SOLID → AcDbSolid (subclass of AcDbTrace).
      return new AcDbSolid()
    case 'TRACE':
      return new AcDbTrace()
    case '3DFACE':
      return new AcDbFace()
    case 'LWPOLYLINE':
      return new AcDbPolyline()
    case 'INSERT':
      return new AcDbBlockReference('')
    case 'TEXT':
      return new AcDbText()
    case 'ARCALIGNEDTEXT':
      return new AcDbArcAlignedText()
    case 'MTEXT':
      return new AcDbMText()
    case 'SPLINE':
      return new AcDbSpline()
    case 'ATTDEF':
      return new AcDbAttributeDefinition()
    case 'ATTRIB':
      return new AcDbAttribute()
    case 'SHAPE':
      return new AcDbShape()
    case 'TOLERANCE':
      return new AcDbFcf()
    case 'LEADER':
      return new AcDbLeader()
    case 'VIEWPORT':
      return new AcDbViewport()
    case 'IMAGE':
      return new AcDbRasterImage()
    case 'WIPEOUT':
      return new AcDbWipeout()
    case 'ACAD_PROXY_ENTITY':
      return new AcDbProxyEntity()
    case 'OLEFRAME':
      return new AcDbOleFrame()
    case 'OLE2FRAME':
      return new AcDbOle2Frame()
    case 'HATCH':
      return new AcDbHatch()
    case 'MLINE':
      return new AcDbMLine()
    case 'MULTILEADER':
    case 'MLEADER':
      return new AcDbMLeader()
    case 'ACAD_TABLE':
      return new AcDbTable('', 1, 1)
    case '3DSOLID':
      return new AcDb3dSolid('')
    default:
      return null
  }
}

/**
 * Create entity from the current filer position.
 * Expects the filer to be at (or just past) the type name pair (0, TYPENAME).
 * When `typeName` is omitted, reads the next (0, name) pair.
 */
export function acdbDxfInEntity(
  filer: AcDbDxfFiler,
  typeName?: string
): AcDbEntity | null {
  let name = typeName
  if (name == null) {
    const item = filer.readItem()
    if (!item || Number(item.code) !== 0) {
      if (item) filer.pushBackItem(item)
      return null
    }
    name = String(item.value)
  }

  const upper = name.toUpperCase()
  // Composite / subclass-dispatched types — not created via empty factory.
  if (upper === 'POLYLINE') {
    return acdbDxfInPolyline(filer)
  }
  if (upper === 'DIMENSION') {
    return acdbDxfInDimension(filer)
  }

  const entity = acdbCreateEntityForDxfIn(name)
  if (!entity) return null
  entity.dxfIn(filer)
  return entity
}
