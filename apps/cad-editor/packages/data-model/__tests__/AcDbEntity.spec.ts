import { AcCmColor } from '@mlightcad/common'
import { DEFAULT_ACGI_CONTEXT, AcGiContext } from '@mlightcad/graphic-interface'
import {
  AcGeBox3d,
  AcGeMatrix3d,
  AcGePoint2d,
  AcGePoint3d,
  AcGePolyline2d,
  AcGeVector3d
} from '@mlightcad/geometry-engine'

import { acdbHostApplicationServices } from '../src/base/AcDbHostApplicationServices'
import { AcDbDatabase } from '../src/database/AcDbDatabase'
import { AcDbLayerTableRecord } from '../src/database/AcDbLayerTableRecord'
import { AcDb2dPolyline, AcDbPoly2dType } from '../src/entity/AcDb2dPolyline'
import { AcDb2dVertex } from '../src/entity/AcDb2dVertex'
import { AcDbArc } from '../src/entity/AcDbArc'
import { AcDbAttribute } from '../src/entity/AcDbAttribute'
import { AcDbAttributeDefinition } from '../src/entity/AcDbAttributeDefinition'
import { AcDb3PointAngularDimension } from '../src/entity/dimension/AcDb3PointAngularDimension'
import { AcDbAlignedDimension } from '../src/entity/dimension/AcDbAlignedDimension'
import { AcDbArcDimension } from '../src/entity/dimension/AcDbArcDimension'
import { AcDb3dPolyline, AcDbPoly3dType } from '../src/entity/AcDb3dPolyline'
import { AcDb3dVertex } from '../src/entity/AcDb3dVertex'
import { AcDbBlockReference } from '../src/entity/AcDbBlockReference'
import { AcDbCircle } from '../src/entity/AcDbCircle'
import { AcDbEntity } from '../src/entity/AcDbEntity'
import { AcDbFace } from '../src/entity/AcDbFace'
import { AcDbHatch } from '../src/entity/AcDbHatch'
import { AcDbLine } from '../src/entity/AcDbLine'
import { AcDbMText } from '../src/entity/AcDbMText'
import { AcDbOrdinateDimension } from '../src/entity/dimension/AcDbOrdinateDimension'
import { AcDbPolyFaceMesh } from '../src/entity/AcDbPolyFaceMesh'
import { AcDbPolygonMesh } from '../src/entity/AcDbPolygonMesh'
import { AcDbPoint } from '../src/entity/AcDbPoint'
import { AcDbPolyline } from '../src/entity/AcDbPolyline'
import { AcDbRasterImage } from '../src/entity/AcDbRasterImage'
import { AcDbRadialDimension } from '../src/entity/dimension/AcDbRadialDimension'
import { AcDbTable } from '../src/entity/AcDbTable'
import { AcDbText } from '../src/entity/AcDbText'
import { AcDbTrace } from '../src/entity/AcDbTrace'
import { AcDbViewport } from '../src/entity/AcDbViewport'
import { AcDbWipeout } from '../src/entity/AcDbWipeout'
import { AcDbEllipse } from '../src/entity/AcDbEllipse'
import { AcDbLeader } from '../src/entity/AcDbLeader'
import { AcDbRay } from '../src/entity/AcDbRay'
import { AcDbSpline } from '../src/entity/AcDbSpline'
import { AcDbDiametricDimension } from '../src/entity/dimension/AcDbDiametricDimension'
import { AcDbXline } from '../src/entity/AcDbXline'
import { AcDbOsnapMode } from '../src/misc'

const expectPoint3dClose = (
  actual: { x: number; y: number; z: number },
  expected: { x: number; y: number; z: number }
) => {
  expect(actual.x).toBeCloseTo(expected.x, 8)
  expect(actual.y).toBeCloseTo(expected.y, 8)
  expect(actual.z).toBeCloseTo(expected.z, 8)
}

const expectVector3dClose = (
  actual: { x: number; y: number; z: number },
  expected: { x: number; y: number; z: number }
) => {
  expect(actual.x).toBeCloseTo(expected.x, 8)
  expect(actual.y).toBeCloseTo(expected.y, 8)
  expect(actual.z).toBeCloseTo(expected.z, 8)
}

class DummyEntity extends AcDbEntity {
  override get dxfTypeName() {
    return 'DUMMY'
  }

  override get geometricExtents() {
    return new AcGeBox3d().expandByPoint(new AcGePoint3d())
  }

  override subWorldDraw() {
    return undefined
  }
}

describe('AcDbEntity.dxfTypeName', () => {
  it('uses explicit DXF type names defined by each entity', () => {
    expect(new AcDbText().dxfTypeName).toBe('TEXT')
    expect(new AcDbBlockReference('TEST').dxfTypeName).toBe('INSERT')
    expect(new AcDbPolyline().dxfTypeName).toBe('LWPOLYLINE')
    expect(new AcDb2dPolyline(AcDbPoly2dType.SimplePoly, []).dxfTypeName).toBe(
      'POLYLINE'
    )
    expect(new AcDb3dPolyline(AcDbPoly3dType.SimplePoly, []).dxfTypeName).toBe(
      'POLYLINE'
    )
    expect(new AcDb2dVertex().dxfTypeName).toBe('VERTEX')
    expect(new AcDb3dVertex().dxfTypeName).toBe('VERTEX')
    expect(new AcDbFace().dxfTypeName).toBe('3DFACE')
    expect(new AcDbRasterImage().dxfTypeName).toBe('IMAGE')
    expect(new AcDbTable('TEST', 1, 1).dxfTypeName).toBe('ACAD_TABLE')
    expect(
      new AcDb3PointAngularDimension(
        new AcGePoint3d(),
        new AcGePoint3d(1, 0, 0),
        new AcGePoint3d(0, 1, 0),
        new AcGePoint3d(1, 1, 0)
      ).dxfTypeName
    ).toBe('DIMENSION')
  })
})

describe('AcDbEntity.worldDraw layer policy', () => {
  let db: AcDbDatabase

  beforeEach(() => {
    db = new AcDbDatabase()
    db.createDefaultData()
    acdbHostApplicationServices().workingDatabase = db
  })

  it('skips subWorldDraw when drawNoPlotLayers is false and layer is non-plottable', () => {
    ;(db as unknown as { _drawNoPlotLayers: boolean })._drawNoPlotLayers = false
    db.tables.layerTable.add(
      new AcDbLayerTableRecord({ name: 'NPLT', isPlottable: false })
    )

    const entity = new DummyEntity()
    entity.layer = 'NPLT'
    db.tables.blockTable.modelSpace.appendEntity(entity)

    const subWorldDraw = jest.spyOn(entity, 'subWorldDraw')
    const renderer = {
      subEntityTraits: {},
      context: new AcGiContext({ ...DEFAULT_ACGI_CONTEXT })
    } as never

    expect(entity.worldDraw(renderer)).toBeUndefined()
    expect(subWorldDraw).not.toHaveBeenCalled()
  })

  it('calls subWorldDraw when drawNoPlotLayers is true on a non-plottable layer', () => {
    db.tables.layerTable.add(
      new AcDbLayerTableRecord({ name: 'NPLT', isPlottable: false })
    )

    const entity = new DummyEntity()
    entity.layer = 'NPLT'
    db.tables.blockTable.modelSpace.appendEntity(entity)

    const renderer = {
      subEntityTraits: {},
      context: new AcGiContext({ ...DEFAULT_ACGI_CONTEXT })
    }
    const subWorldDraw = jest.spyOn(entity, 'subWorldDraw')

    entity.worldDraw(renderer as never)
    expect(subWorldDraw).toHaveBeenCalled()
    expect(renderer.context.database).toBe(db)
  })
})

describe('AcDbEntity.color resolution', () => {
  let db: AcDbDatabase

  const addLayerWithColor = (name: string, rgb: number) => {
    db.tables.layerTable.add(
      new AcDbLayerTableRecord({
        name,
        color: new AcCmColor().setRGBValue(rgb)
      })
    )
  }

  beforeEach(() => {
    db = new AcDbDatabase()
    acdbHostApplicationServices().workingDatabase = db
  })

  it('uses CECOLOR when entity color is explicitly ByBlock', () => {
    addLayerWithColor('0', 0x101010)
    db.clayer = '0'
    db.cecolor = new AcCmColor().setRGBValue(0x336699)

    const line = new AcDbLine(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(1, 0, 0)
    )
    line.layer = '0'
    line.color.setByBlock()

    expect(line.color.isByBlock).toBe(true)
    expect(line.resolvedColor.RGB).toBe(0x336699)
  })

  it('resolves ByBlock through current layer when CECOLOR is ByLayer', () => {
    addLayerWithColor('ENTITY_LAYER', 0x00ff00)
    addLayerWithColor('CURRENT_LAYER', 0x112233)
    db.clayer = 'CURRENT_LAYER'
    db.cecolor = new AcCmColor().setByLayer()

    const line = new AcDbLine(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(1, 0, 0)
    )
    line.layer = 'ENTITY_LAYER'
    line.color.setByBlock()

    expect(line.resolvedColor.RGB).toBe(0x112233)
  })

  it('resolves ByLayer against the entity layer color', () => {
    addLayerWithColor('ENTITY_LAYER', 0xaa5500)
    addLayerWithColor('CURRENT_LAYER', 0x123456)
    db.clayer = 'CURRENT_LAYER'
    db.cecolor = new AcCmColor().setRGBValue(0xff00ff)

    const line = new AcDbLine(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(1, 0, 0)
    )
    line.layer = 'ENTITY_LAYER'
    line.color.setByLayer()

    expect(line.resolvedColor.RGB).toBe(0xaa5500)
  })
})

describe('AcDbEntity.transformBy', () => {
  it('keeps point-like entities aligned across matrix families', () => {
    const cases = [
      {
        name: 'translation',
        matrix: new AcGeMatrix3d().makeTranslation(3, 4, 5)
      },
      {
        name: 'rotation',
        matrix: new AcGeMatrix3d().makeRotationZ(Math.PI / 2)
      },
      {
        name: 'mirror',
        matrix: new AcGeMatrix3d().makeScale(-1, 1, 1)
      },
      {
        name: 'non-uniform-scale',
        matrix: new AcGeMatrix3d().makeScale(2, 3, 4)
      }
    ]

    cases.forEach(({ name, matrix }) => {
      const source = new AcGePoint3d(1, 2, 3)

      const point = new AcDbPoint()
      point.position = source.clone()
      point.transformBy(matrix)

      const vertex2d = new AcDb2dVertex()
      vertex2d.position = source.clone()
      vertex2d.transformBy(matrix)

      const vertex3d = new AcDb3dVertex()
      vertex3d.position = source.clone()
      vertex3d.transformBy(matrix)

      const expected = source.clone().applyMatrix4(matrix)
      expectPoint3dClose(point.position, expected)
      expectPoint3dClose(vertex2d.position, expected)
      expectPoint3dClose(vertex3d.position, expected)
      expect(name).toBeTruthy()
    })
  })

  it('keeps the base AcDbEntity transformBy as a no-op', () => {
    const entity = new DummyEntity()
    const result = entity.transformBy(
      new AcGeMatrix3d().makeTranslation(1, 2, 3)
    )

    expect(result).toBe(entity)
    expect(entity.geometricExtents.min.x).toBe(0)
  })

  it('transforms lightweight and legacy polylines', () => {
    const lwPolyline = new AcDbPolyline()
    lwPolyline.elevation = 1
    lwPolyline.addVertexAt(0, new AcGePoint2d(0, 0), 1)
    lwPolyline.addVertexAt(1, new AcGePoint2d(2, 0))

    lwPolyline.transformBy(new AcGeMatrix3d().makeTranslation(3, 4, 5))

    expect(lwPolyline.elevation).toBeCloseTo(6, 8)
    expect(lwPolyline.getPoint3dAt(0)).toMatchObject({ x: 3, y: 4, z: 6 })
    expect(lwPolyline.getPoint3dAt(1)).toMatchObject({ x: 5, y: 4, z: 6 })

    const legacyPolyline = new AcDb2dPolyline(
      AcDbPoly2dType.SimplePoly,
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 }
      ],
      2
    )
    legacyPolyline.transformBy(new AcGeMatrix3d().makeTranslation(-1, 2, 3))

    expect(legacyPolyline.elevation).toBeCloseTo(5, 8)
    expect(legacyPolyline.getPointAt(0)).toMatchObject({ x: -1, y: 2 })
    expect(legacyPolyline.getPointAt(1)).toMatchObject({ x: 0, y: 2 })
  })

  it('transforms primitive entities and vertex entities', () => {
    const point = new AcDbPoint()
    point.position = new AcGePoint3d(1, 2, 3)
    point.transformBy(new AcGeMatrix3d().makeTranslation(4, -1, 2))
    expectPoint3dClose(point.position, { x: 5, y: 1, z: 5 })

    const line = new AcDbLine(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(1, 2, 3)
    )
    line.transformBy(new AcGeMatrix3d().makeTranslation(2, 3, 4))
    expectPoint3dClose(line.startPoint, { x: 2, y: 3, z: 4 })
    expectPoint3dClose(line.endPoint, { x: 3, y: 5, z: 7 })

    const arc = new AcDbArc(new AcGePoint3d(0, 0, 0), 2, 0, Math.PI / 2)
    arc.transformBy(new AcGeMatrix3d().makeTranslation(1, 2, 3))
    expectPoint3dClose(arc.center, { x: 1, y: 2, z: 3 })
    expectPoint3dClose(arc.startPoint, { x: 3, y: 2, z: 3 })

    const circle = new AcDbCircle(new AcGePoint3d(0, 0, 0), 3)
    circle.transformBy(new AcGeMatrix3d().makeTranslation(-2, 4, 1))
    expectPoint3dClose(circle.center, { x: -2, y: 4, z: 1 })
    expect(circle.radius).toBeCloseTo(3, 8)

    const vertex2d = new AcDb2dVertex()
    vertex2d.position = new AcGePoint3d(1, 1, 0)
    vertex2d.transformBy(new AcGeMatrix3d().makeTranslation(3, 4, 5))
    expectPoint3dClose(vertex2d.position, { x: 4, y: 5, z: 5 })

    const vertex3d = new AcDb3dVertex()
    vertex3d.position = new AcGePoint3d(1, 1, 1)
    vertex3d.transformBy(new AcGeMatrix3d().makeTranslation(-1, 2, -3))
    expectPoint3dClose(vertex3d.position, { x: 0, y: 3, z: -2 })
  })

  it('keeps line-like entities aligned across translation rotation and mirror', () => {
    const cases = [
      new AcGeMatrix3d().makeTranslation(4, -1, 2),
      new AcGeMatrix3d().makeRotationZ(Math.PI / 2),
      new AcGeMatrix3d().makeScale(-1, 1, 1)
    ]

    cases.forEach(matrix => {
      const start = new AcGePoint3d(1, 2, 3)
      const end = new AcGePoint3d(4, 5, 6)

      const line = new AcDbLine(start.clone(), end.clone())
      line.transformBy(matrix)
      expectPoint3dClose(line.startPoint, start.clone().applyMatrix4(matrix))
      expectPoint3dClose(line.endPoint, end.clone().applyMatrix4(matrix))

      const ray = new AcDbRay()
      ray.basePoint = start.clone()
      ray.unitDir = new AcGePoint3d(1, 0, 0)
      ray.transformBy(matrix)
      expectPoint3dClose(ray.basePoint, start.clone().applyMatrix4(matrix))
      expect(ray.unitDir.length()).toBeCloseTo(1, 8)

      const xline = new AcDbXline()
      xline.basePoint = start.clone()
      xline.unitDir = new AcGePoint3d(1, 0, 0)
      xline.transformBy(matrix)
      expectPoint3dClose(xline.basePoint, start.clone().applyMatrix4(matrix))
      expect(xline.unitDir.length()).toBeCloseTo(1, 8)
    })
  })

  it('keeps polyline entities aligned across rotation and mirror transforms', () => {
    const cases = [
      {
        matrix: new AcGeMatrix3d().makeRotationZ(Math.PI / 2),
        expectedBulge: 1
      },
      {
        matrix: new AcGeMatrix3d().makeScale(-1, 1, 1),
        expectedBulge: -1
      }
    ]

    cases.forEach(({ matrix, expectedBulge }) => {
      const lwPolyline = new AcDbPolyline()
      lwPolyline.addVertexAt(0, new AcGePoint2d(0, 0), 1)
      lwPolyline.addVertexAt(1, new AcGePoint2d(2, 0))
      lwPolyline.transformBy(matrix)
      expect(
        (
          lwPolyline as unknown as {
            _geo: { vertices: Array<{ bulge?: number }> }
          }
        )._geo.vertices[0].bulge
      ).toBe(expectedBulge)

      const legacyPolyline = new AcDb2dPolyline(
        AcDbPoly2dType.SimplePoly,
        [
          { x: 0, y: 0, z: 0 },
          { x: 2, y: 0, z: 0 }
        ],
        0,
        false,
        0,
        0,
        [1, 0]
      )
      legacyPolyline.transformBy(matrix)
      expect(legacyPolyline.getBulgeAt(0)).toBe(expectedBulge)

      const polyline3d = new AcDb3dPolyline(AcDbPoly3dType.SimplePoly, [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 2, z: 3 }
      ])
      polyline3d.transformBy(matrix)
      expectPoint3dClose(
        polyline3d.getPointAt(1),
        new AcGePoint3d(1, 2, 3).applyMatrix4(matrix)
      )
    })
  })

  it('transforms 3d polylines, splines, ellipses, leaders and infinite lines', () => {
    const polyline3d = new AcDb3dPolyline(AcDbPoly3dType.SimplePoly, [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 }
    ])
    polyline3d.transformBy(new AcGeMatrix3d().makeTranslation(4, -2, 3))
    expect(polyline3d.getPointAt(1)).toMatchObject({ x: 5, y: -1, z: 4 })

    const spline = new AcDbSpline(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ],
      [0, 0, 0, 0, 1, 1, 1, 1]
    )
    const splineSnapPoints: AcGePoint3d[] = []
    spline.transformBy(new AcGeMatrix3d().makeTranslation(2, 3, 4))
    spline.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      splineSnapPoints
    )
    expect(splineSnapPoints[0]).toMatchObject({ x: 2, y: 3, z: 4 })

    const ellipse = new AcDbEllipse(
      new AcGePoint3d(0, 0, 0),
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS,
      4,
      2,
      0,
      Math.PI / 2
    )
    ellipse.transformBy(new AcGeMatrix3d().makeTranslation(1, 2, 3))
    expect(ellipse.center).toMatchObject({ x: 1, y: 2, z: 3 })

    const leader = new AcDbLeader()
    leader.appendVertex({ x: 0, y: 0, z: 0 })
    leader.appendVertex({ x: 1, y: 0, z: 0 })
    leader.transformBy(new AcGeMatrix3d().makeTranslation(5, 6, 7))
    expect(leader.vertices[0]).toMatchObject({ x: 5, y: 6, z: 7 })
    expect(leader.vertices[1]).toMatchObject({ x: 6, y: 6, z: 7 })

    const ray = new AcDbRay()
    ray.basePoint = new AcGePoint3d(1, 0, 0)
    ray.unitDir = new AcGePoint3d(1, 0, 0)
    ray.transformBy(new AcGeMatrix3d().makeRotationZ(Math.PI / 2))
    expect(ray.basePoint.x).toBeCloseTo(0, 8)
    expect(ray.basePoint.y).toBeCloseTo(1, 8)
    expect(ray.unitDir.x).toBeCloseTo(0, 8)
    expect(ray.unitDir.y).toBeCloseTo(1, 8)

    const xline = new AcDbXline()
    xline.basePoint = new AcGePoint3d(2, 0, 0)
    xline.unitDir = new AcGePoint3d(1, 0, 0)
    xline.transformBy(new AcGeMatrix3d().makeRotationZ(Math.PI / 2))
    expectPoint3dClose(xline.basePoint, { x: 0, y: 2, z: 0 })
    expectVector3dClose(xline.unitDir, { x: 0, y: 1, z: 0 })

    const blockRef = new AcDbBlockReference('TEST')
    blockRef.position = new AcGePoint3d(1, 0, 0)
    blockRef.scaleFactors = new AcGePoint3d(2, 3, 1)
    const attrib = new AcDbAttribute()
    attrib.position = new AcGePoint3d(2, 0, 0)
    blockRef.appendAttributes(attrib)
    blockRef.transformBy(new AcGeMatrix3d().makeRotationZ(Math.PI / 2))
    expect(blockRef.position.x).toBeCloseTo(0, 8)
    expect(blockRef.position.y).toBeCloseTo(1, 8)
    expect(blockRef.rotation).toBeCloseTo(Math.PI / 2, 8)
    expect(blockRef.scaleFactors.x).toBeCloseTo(2, 8)
    expect(blockRef.scaleFactors.y).toBeCloseTo(3, 8)
    expectPoint3dClose(attrib.position, { x: 0, y: 2, z: 0 })
  })

  it('transforms block references correctly under combined rotation and scaling', () => {
    const blockRef = new AcDbBlockReference('TEST')
    blockRef.position = new AcGePoint3d(2, 1, 0)
    blockRef.rotation = Math.PI / 4
    blockRef.scaleFactors = new AcGePoint3d(2, 1, 3)

    blockRef.transformBy(
      new AcGeMatrix3d()
        .makeRotationZ(Math.PI / 2)
        .multiply(new AcGeMatrix3d().makeScale(2, 3, 4))
    )

    expectPoint3dClose(blockRef.position, { x: -3, y: 4, z: 0 })
    expect(blockRef.rotation).toBeCloseTo(Math.atan2(2, -3), 8)
    expect(blockRef.scaleFactors.x).toBeCloseTo(Math.sqrt(26), 8)
    expect(blockRef.scaleFactors.y).toBeCloseTo(Math.sqrt(6.5), 8)
    expect(blockRef.scaleFactors.z).toBeCloseTo(12, 8)
  })

  it('transforms text-like, hatch-like and mesh entities', () => {
    const text = new AcDbText()
    text.position = new AcGePoint3d(0, 0, 0)
    text.height = 2
    text.widthFactor = 1
    text.thickness = 1
    text.transformBy(new AcGeMatrix3d().makeScale(2, 3, 4))
    expect(text.height).toBeCloseTo(6, 8)
    expect(text.widthFactor).toBeCloseTo(2 / 3, 8)
    expect(text.thickness).toBeCloseTo(4, 8)

    const mtext = new AcDbMText()
    mtext.location = new AcGePoint3d(1, 0, 0)
    mtext.direction = new AcGeVector3d(1, 0, 0)
    mtext.width = 10
    mtext.height = 2
    mtext.transformBy(new AcGeMatrix3d().makeRotationZ(Math.PI / 2))
    expect(mtext.location.x).toBeCloseTo(0, 8)
    expect(mtext.location.y).toBeCloseTo(1, 8)
    expect(mtext.direction.x).toBeCloseTo(0, 8)
    expect(mtext.direction.y).toBeCloseTo(1, 8)

    const hatch = new AcDbHatch()
    hatch.elevation = 1
    hatch.add(
      new AcGePolyline2d(
        [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 2 },
          { x: 0, y: 2 }
        ],
        true
      )
    )
    hatch.transformBy(new AcGeMatrix3d().makeTranslation(5, 6, 7))
    expect(hatch.elevation).toBeCloseTo(8, 8)
    expect(hatch.geometricExtents.min).toMatchObject({ x: 5, y: 6, z: 8 })

    const rasterImage = new AcDbRasterImage()
    rasterImage.position = new AcGePoint3d(1, 0, 0)
    rasterImage.width = 2
    rasterImage.height = 1
    rasterImage.transformBy(new AcGeMatrix3d().makeRotationZ(Math.PI / 2))
    expect(rasterImage.position.x).toBeCloseTo(0, 8)
    expect(rasterImage.position.y).toBeCloseTo(1, 8)
    expect(rasterImage.rotation).toBeCloseTo(Math.PI / 2, 8)

    const viewport = new AcDbViewport()
    viewport.centerPoint = new AcGePoint3d(1, 2, 0)
    viewport.width = 2
    viewport.height = 4
    viewport.viewHeight = 10
    viewport.transformBy(new AcGeMatrix3d().makeScale(2, 3, 1))
    expect(viewport.centerPoint).toMatchObject({ x: 2, y: 6, z: 0 })
    expect(viewport.width).toBeCloseTo(4, 8)
    expect(viewport.height).toBeCloseTo(12, 8)
    expect(viewport.viewHeight).toBeCloseTo(30, 8)

    const polyFace = new AcDbPolyFaceMesh(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 }
      ],
      [[1, 2, 3]]
    )
    polyFace.transformBy(new AcGeMatrix3d().makeTranslation(1, 2, 3))
    expect(polyFace.getVertexAt(0).position).toMatchObject({ x: 1, y: 2, z: 3 })

    const polygonMesh = new AcDbPolygonMesh(1, 2, [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 }
    ])
    polygonMesh.transformBy(new AcGeMatrix3d().makeTranslation(-1, -2, -3))
    expect(polygonMesh.getVertexAt(1).position).toMatchObject({
      x: 0,
      y: -1,
      z: -2
    })
  })

  it('updates text, mtext, hatch, raster image and viewport under combined transforms', () => {
    const text = new AcDbText()
    text.position = new AcGePoint3d(1, 0, 0)
    text.rotation = 0
    text.height = 2
    text.widthFactor = 1
    text.transformBy(
      new AcGeMatrix3d()
        .makeRotationZ(Math.PI / 2)
        .multiply(new AcGeMatrix3d().makeScale(2, 3, 1))
    )
    expectPoint3dClose(text.position, { x: 0, y: 2, z: 0 })
    expect(text.rotation).toBeCloseTo(Math.PI / 2, 8)
    expect(text.height).toBeCloseTo(6, 8)
    expect(text.widthFactor).toBeCloseTo(2 / 3, 8)

    const mtext = new AcDbMText()
    mtext.location = new AcGePoint3d(2, 0, 0)
    mtext.direction = new AcGeVector3d(1, 0, 0)
    mtext.width = 5
    mtext.height = 2
    mtext.transformBy(new AcGeMatrix3d().makeScale(2, 3, 1))
    expectPoint3dClose(mtext.location, { x: 4, y: 0, z: 0 })
    expectVector3dClose(mtext.direction, { x: 1, y: 0, z: 0 })
    expect(mtext.width).toBeCloseTo(10, 8)
    expect(mtext.height).toBeCloseTo(6, 8)

    const hatch = new AcDbHatch()
    hatch.patternAngle = Math.PI / 6
    hatch.patternScale = 2
    hatch.add(
      new AcGePolyline2d(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 }
        ],
        true
      )
    )
    hatch.transformBy(new AcGeMatrix3d().makeScale(3, 2, 1))
    expect(hatch.patternAngle).toBeCloseTo(Math.PI / 6, 8)
    expect(hatch.patternScale).toBeCloseTo(6, 8)

    const rasterImage = new AcDbRasterImage()
    rasterImage.position = new AcGePoint3d(1, 0, 0)
    rasterImage.width = 2
    rasterImage.height = 3
    rasterImage.scale = new AcGePoint2d(2, 3) as never
    rasterImage.rotation = 0
    rasterImage.transformBy(new AcGeMatrix3d().makeScale(2, 4, 1))
    expectPoint3dClose(rasterImage.position, { x: 2, y: 0, z: 0 })
    expect(rasterImage.width).toBeCloseTo(8, 8)
    expect(rasterImage.height).toBeCloseTo(36, 8)

    const viewport = new AcDbViewport()
    viewport.centerPoint = new AcGePoint3d(1, 1, 0)
    viewport.width = 2
    viewport.height = 3
    viewport.viewHeight = 4
    viewport.transformBy(
      new AcGeMatrix3d()
        .makeRotationZ(Math.PI / 2)
        .multiply(new AcGeMatrix3d().makeScale(2, 5, 1))
    )
    expectPoint3dClose(viewport.centerPoint, { x: -5, y: 2, z: 0 })
    expect(viewport.width).toBeCloseTo(4, 8)
    expect(viewport.height).toBeCloseTo(15, 8)
    expect(viewport.viewHeight).toBeCloseTo(20, 8)
  })

  it('transforms face and trace entities', () => {
    const face = new AcDbFace()
    face.setVertexAt(0, new AcGePoint3d(0, 0, 0))
    face.setVertexAt(1, new AcGePoint3d(1, 0, 0))
    face.setVertexAt(2, new AcGePoint3d(0, 1, 0))
    face.transformBy(new AcGeMatrix3d().makeTranslation(2, 3, 4))
    expectPoint3dClose(face.getVertexAt(0), { x: 2, y: 3, z: 4 })
    expectPoint3dClose(face.getVertexAt(2), { x: 2, y: 4, z: 4 })

    const trace = new AcDbTrace()
    trace.setPointAt(0, new AcGePoint3d(0, 0, 0))
    trace.setPointAt(1, new AcGePoint3d(1, 0, 0))
    trace.setPointAt(2, new AcGePoint3d(1, 1, 0))
    trace.setPointAt(3, new AcGePoint3d(0, 1, 0))
    trace.transformBy(new AcGeMatrix3d().makeTranslation(-1, 2, 5))
    expectPoint3dClose(trace.getPointAt(0), { x: -1, y: 2, z: 5 })
    expect(trace.elevation).toBeCloseTo(5, 8)
  })

  it('transforms inherited text, raster and block-reference entity kinds', () => {
    const attribute = new AcDbAttribute()
    attribute.position = new AcGePoint3d(0, 0, 0)
    attribute.height = 1
    attribute.transformBy(new AcGeMatrix3d().makeScale(2, 3, 1))
    expect(attribute.height).toBeCloseTo(3, 8)

    const attributeDefinition = new AcDbAttributeDefinition()
    attributeDefinition.position = new AcGePoint3d(1, 1, 0)
    attributeDefinition.transformBy(new AcGeMatrix3d().makeTranslation(2, 4, 6))
    expectPoint3dClose(attributeDefinition.position, { x: 3, y: 5, z: 6 })

    const wipeout = new AcDbWipeout()
    wipeout.position = new AcGePoint3d(1, 0, 0)
    wipeout.width = 4
    wipeout.height = 2
    wipeout.transformBy(new AcGeMatrix3d().makeRotationZ(Math.PI / 2))
    expectPoint3dClose(wipeout.position, { x: 0, y: 1, z: 0 })
    expect(wipeout.rotation).toBeCloseTo(Math.PI / 2, 8)

    const table = new AcDbTable('TEST', 1, 1)
    table.position = new AcGePoint3d(2, 0, 0)
    table.scaleFactors = new AcGePoint3d(1, 2, 1)
    table.transformBy(new AcGeMatrix3d().makeRotationZ(Math.PI / 2))
    expectPoint3dClose(table.position, { x: 0, y: 2, z: 0 })
    expect(table.rotation).toBeCloseTo(Math.PI / 2, 8)
    expect(table.scaleFactors.y).toBeCloseTo(2, 8)
  })

  it('transforms dimension entities through base and subclass definition points', () => {
    const dimension = new AcDbAlignedDimension(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(2, 0, 0),
      new AcGePoint3d(1, 1, 0)
    )
    dimension.dimBlockPosition = new AcGePoint3d(1, 2, 3)
    dimension.textPosition = new AcGePoint3d(2, 0, 0)
    dimension.textRotation = 0
    dimension.normal = AcGeVector3d.Z_AXIS
    dimension.transformBy(
      new AcGeMatrix3d()
        .makeRotationZ(Math.PI / 2)
        .multiply(new AcGeMatrix3d().makeTranslation(3, 4, 5))
    )

    expectPoint3dClose(dimension.xLine1Point, { x: -4, y: 3, z: 5 })
    expectPoint3dClose(dimension.xLine2Point, { x: -4, y: 5, z: 5 })
    expectPoint3dClose(dimension.dimLinePoint, { x: -5, y: 4, z: 5 })
    expectPoint3dClose(dimension.dimBlockPosition, { x: -6, y: 4, z: 8 })
    expectPoint3dClose(dimension.textPosition, { x: -4, y: 5, z: 5 })
    expect(dimension.textRotation).toBeCloseTo(Math.PI / 2, 8)

    const angularDimension = new AcDb3PointAngularDimension(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(1, 0, 0),
      new AcGePoint3d(0, 1, 0),
      new AcGePoint3d(1, 1, 0)
    )
    angularDimension.transformBy(new AcGeMatrix3d().makeTranslation(1, 2, 3))
    expectPoint3dClose(angularDimension.centerPoint, { x: 1, y: 2, z: 3 })
    expectPoint3dClose(angularDimension.arcPoint, { x: 2, y: 3, z: 3 })

    const arcDimension = new AcDbArcDimension(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(1, 0, 0),
      new AcGePoint3d(0, 1, 0),
      new AcGePoint3d(1, 1, 0)
    )
    arcDimension.transformBy(new AcGeMatrix3d().makeTranslation(2, 3, 4))
    expectPoint3dClose(arcDimension.centerPoint, { x: 2, y: 3, z: 4 })
    expectPoint3dClose(arcDimension.arcPoint, { x: 3, y: 4, z: 4 })

    const diametricDimension = new AcDbDiametricDimension(
      new AcGePoint3d(1, 0, 0),
      new AcGePoint3d(-1, 0, 0),
      2
    )
    diametricDimension.transformBy(new AcGeMatrix3d().makeTranslation(5, 6, 7))
    expectPoint3dClose(diametricDimension.chordPoint, { x: 6, y: 6, z: 7 })
    expectPoint3dClose(diametricDimension.farChordPoint, { x: 4, y: 6, z: 7 })

    const ordinateDimension = new AcDbOrdinateDimension(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(1, 2, 3)
    )
    ordinateDimension.transformBy(
      new AcGeMatrix3d().makeTranslation(-1, -2, -3)
    )
    expectPoint3dClose(ordinateDimension.definingPoint, { x: -1, y: -2, z: -3 })
    expectPoint3dClose(ordinateDimension.leaderEndPoint, { x: 0, y: 0, z: 0 })

    const radialDimension = new AcDbRadialDimension(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(2, 0, 0),
      1
    )
    radialDimension.transformBy(new AcGeMatrix3d().makeTranslation(7, 8, 9))
    expectPoint3dClose(radialDimension.center, { x: 7, y: 8, z: 9 })
    expectPoint3dClose(radialDimension.chordPoint, { x: 9, y: 8, z: 9 })
  })
})
