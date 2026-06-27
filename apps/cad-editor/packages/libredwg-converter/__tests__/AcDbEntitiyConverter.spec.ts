import {
  AcDb3PointAngularDimension,
  AcDbArc,
  AcDbAttribute,
  AcDbBlockReference,
  AcDbCircle,
  AcDbDatabase,
  AcDbHatch,
  AcDbProxyEntity,
  AcDbShape,
  acdbHostApplicationServices
} from '@mlightcad/data-model'

import { AcDbEntityConverter } from '../src/AcDbEntitiyConverter'

const baseAttrib = (overrides: Record<string, unknown> = {}) => ({
  type: 'ATTRIB',
  handle: 'A1',
  layer: 'TAGS',
  ownerBlockRecordSoftId: 'INSERT_HANDLE',
  color: 0xff0000,
  lineType: 'CONTINUOUS',
  lineweight: 25,
  lineTypeScale: 1,
  text: {
    text: 'ROOM-101',
    styleName: 'STANDARD',
    textHeight: 2.5,
    startPoint: { x: 10, y: 20, z: 0 },
    rotation: 0,
    obliqueAngle: 0,
    thickness: 0,
    halign: 0,
    valign: 0,
    xScale: 1
  },
  tag: 'COMODO',
  fieldLength: 0,
  flags: 0,
  mtextFlag: 0,
  lockPositionFlag: false,
  isReallyLocked: false,
  ...overrides
})

describe('libredwg AcDbEntityConverter', () => {
  it('converts ARC/CIRCLE OCS centers into WCS when extrusion points to -Z', () => {
    acdbHostApplicationServices().workingDatabase = new AcDbDatabase()
    const converter = new AcDbEntityConverter()

    const arc = converter.convert({
      type: 'ARC',
      center: { x: 1, y: 2, z: 0 },
      radius: 1,
      startAngle: 0,
      endAngle: Math.PI / 2,
      extrusionDirection: { x: 0, y: 0, z: -1 }
    } as any)

    const circle = converter.convert({
      type: 'CIRCLE',
      center: { x: 1, y: 2, z: 0 },
      radius: 1,
      extrusionDirection: { x: 0, y: 0, z: -1 }
    } as any)

    expect(arc).toBeInstanceOf(AcDbArc)
    expect(circle).toBeInstanceOf(AcDbCircle)

    const dbArc = arc as AcDbArc
    const dbCircle = circle as AcDbCircle

    expect(dbArc.center).toMatchObject({ x: -1, y: 2, z: 0 })
    expect(dbArc.startPoint).toMatchObject({ x: -2, y: 2, z: 0 })
    expect(dbArc.endPoint).toMatchObject({ x: -1, y: 3, z: 0 })
    expect(dbCircle.center).toMatchObject({ x: -1, y: 2, z: 0 })
  })

  it('converts ACAD_PROXY_ENTITY with graphics data to AcDbProxyEntity', () => {
    acdbHostApplicationServices().workingDatabase = new AcDbDatabase()
    const converter = new AcDbEntityConverter()
    const result = converter.convert({
      type: 'ACAD_PROXY_ENTITY',
      subclassMarker: 'AcDbProxyEntity',
      originalDxfName: 'AECC_TIN_SURFACE',
      proxyEntityClassId: 498,
      applicationEntityClassId: 500,
      graphicsDataSize: 4,
      graphicsData: '01020304',
      entityDataSize: 0,
      objectDrawingFormat: 29,
      originalDataFormat: 0,
      layer: '0',
      handle: 'A1'
    } as any)

    expect(result).toBeInstanceOf(AcDbProxyEntity)
    const proxy = result as AcDbProxyEntity
    expect(proxy.type).toBe('ProxyEntity')
    expect(proxy.originalDxfName).toBe('AECC_TIN_SURFACE')
    expect(proxy.proxyEntityClassId).toBe(498)
    expect(proxy.graphicsMetafileType).toBe(29)
    expect(proxy.originalClassName).toBe('500')
    expect(proxy.proxyGraphic).toEqual(new Uint8Array([0x01, 0x02, 0x03, 0x04]))
  })

  describe('ATTRIB common attribute propagation (issue #183 follow-up)', () => {
    beforeEach(() => {
      acdbHostApplicationServices().workingDatabase = new AcDbDatabase()
    })

    it('routes a top-level ATTRIB through convert() so common attrs are set', () => {
      const converter = new AcDbEntityConverter()
      const dbAttrib = converter.convert(baseAttrib() as any)

      expect(dbAttrib).toBeInstanceOf(AcDbAttribute)
      const attr = dbAttrib as AcDbAttribute
      // Common attrs from processCommonAttrs
      expect(attr.layer).toBe('TAGS')
      expect(attr.objectId).toBe('A1')
      expect(attr.ownerId).toBe('INSERT_HANDLE')
      expect(attr.lineType).toBe('CONTINUOUS')
      expect(attr.lineWeight).toBe(25)
      // ATTRIB-specific attrs from convertAttributeCommon
      expect(attr.tag).toBe('COMODO')
      expect(attr.textString).toBe('ROOM-101')
      expect(attr.styleName).toBe('STANDARD')
      expect(attr.height).toBe(2.5)
    })

    it('appends ATTRIBs of an INSERT through convert() preserving common attrs', () => {
      const converter = new AcDbEntityConverter()
      const dbInsert = converter.convert({
        type: 'INSERT',
        handle: 'INSERT_HANDLE',
        layer: 'BLOCKS',
        ownerBlockRecordSoftId: 'MS',
        name: 'CARIMBO',
        insertionPoint: { x: 0, y: 0, z: 0 },
        xScale: 1,
        yScale: 1,
        zScale: 1,
        rotation: 0,
        extrusionDirection: { x: 0, y: 0, z: 1 },
        attribs: [
          baseAttrib({ handle: 'A1', tag: 'COMODO', layer: 'TAGS' }),
          baseAttrib({
            handle: 'A2',
            tag: 'AREA',
            layer: 'AREAS',
            color: 0x00ff00,
            text: {
              ...(baseAttrib().text as any),
              text: '23.45 m2'
            }
          })
        ]
      } as any) as AcDbBlockReference

      expect(dbInsert).toBeInstanceOf(AcDbBlockReference)
      const attrs = Array.from(dbInsert.attributeIterator())
      expect(attrs.length).toBe(2)
      // Each ATTRIB carries its OWN layer/color (not inherited from INSERT),
      // so per-attrib layer toggles can take effect downstream.
      const tag = attrs.find(a => a.tag === 'COMODO') as AcDbAttribute
      const area = attrs.find(a => a.tag === 'AREA') as AcDbAttribute
      expect(tag.layer).toBe('TAGS')
      expect(area.layer).toBe('AREAS')
      // Each ATTRIB has its own DWG handle (objectId), so they don't collide
      // in `_attribs` Map keyed by objectId.
      expect(tag.objectId).toBe('A1')
      expect(area.objectId).toBe('A2')
      // ATTRIB.ownerId points at the INSERT, not at the BTR — matches
      // ObjectARX semantics.
      expect(tag.ownerId).toBe('INSERT_HANDLE')
      expect(area.ownerId).toBe('INSERT_HANDLE')
    })
  })

  // The previous color-resolution path mutated the result of the entity
  // `color` getter (`dbEntity.color.<prop> = …`). That works for entities
  // whose getter returns the cached `_color` field, but breaks for
  // AcDbHatch — its override returns a clone of the HPCOLOR / CECOLOR
  // fallback when no color is explicitly set, so the mutations are
  // dropped and the hatch ends up stuck on the sysvar default. The
  // converter now builds a fresh AcCmColor and assigns it via the setter,
  // so colour reaches the data-model regardless of the getter's caching
  // strategy.
  describe('hatch color preservation (regression #228)', () => {
    it('persists explicit truecolor RGB on a HATCH entity', () => {
      acdbHostApplicationServices().workingDatabase = new AcDbDatabase()
      const converter = new AcDbEntityConverter()

      const hatch = converter.convert({
        type: 'HATCH',
        handle: 'H1',
        layer: 'WALLS',
        ownerBlockRecordSoftId: 'MS',
        color: 0x00ff00,
        elevation: 0,
        extrusionDirection: { x: 0, y: 0, z: 1 },
        patternName: 'SOLID',
        solidFill: 1,
        gradientFlag: 0,
        boundaryPaths: []
      } as any) as AcDbHatch

      expect(hatch).toBeInstanceOf(AcDbHatch)
      // RGB must reach the data-model — not be lost on the clone.
      expect(hatch.color.RGB).toBe(0x00ff00)
      expect(hatch.color.isByColor).toBe(true)
    })

    it('persists ACI 7 (foreground) on a HATCH entity', () => {
      acdbHostApplicationServices().workingDatabase = new AcDbDatabase()
      const converter = new AcDbEntityConverter()

      const hatch = converter.convert({
        type: 'HATCH',
        handle: 'H2',
        layer: 'WALLS',
        ownerBlockRecordSoftId: 'MS',
        colorIndex: 7,
        elevation: 0,
        extrusionDirection: { x: 0, y: 0, z: 1 },
        patternName: 'SOLID',
        solidFill: 1,
        gradientFlag: 0,
        boundaryPaths: []
      } as any) as AcDbHatch

      expect(hatch).toBeInstanceOf(AcDbHatch)
      // ACI 7 must surface as foreground so the renderer keeps the
      // theme-aware behaviour (fuse-with-bg for solid hatches).
      expect(hatch.color.colorIndex).toBe(7)
      expect(hatch.color.isForeground).toBe(true)
    })
  })

  it('converts libredwg SHAPE entity', () => {
    acdbHostApplicationServices().workingDatabase = new AcDbDatabase()
    const converter = new AcDbEntityConverter()
    const result = converter.convert({
      type: 'SHAPE',
      subclassMarker: 'AcDbShape',
      layer: '0',
      handle: '19AAD3',
      insertionPoint: { x: 100, y: 200, z: 0 },
      size: 2.5,
      shapeNumber: 42,
      styleName: 'TECOGISSHAPE0',
      rotation: Math.PI / 4,
      xScale: 1.5,
      obliqueAngle: Math.PI / 18,
      thickness: 0.5,
      extrusionDirection: { x: 0, y: 0, z: 1 }
    } as any)

    expect(result).toBeInstanceOf(AcDbShape)
    const shape = result as AcDbShape
    expect(shape.type).toBe('Shape')
    expect(shape.shapeNumber).toBe(42)
    expect(shape.styleName).toBe('TECOGISSHAPE0')
    expect(shape.position).toMatchObject({ x: 100, y: 200, z: 0 })
    expect(shape.size).toBe(2.5)
    expect(shape.rotation).toBeCloseTo(Math.PI / 4)
    expect(shape.widthFactor).toBe(1.5)
    expect(shape.oblique).toBeCloseTo(Math.PI / 18)
    expect(shape.thickness).toBe(0.5)
    expect(shape.normal).toMatchObject({ x: 0, y: 0, z: 1 })
  })

  it('converts libredwg SHAPE OCS insertion point into WCS when extrusion points to -Z', () => {
    acdbHostApplicationServices().workingDatabase = new AcDbDatabase()
    const converter = new AcDbEntityConverter()
    const result = converter.convert({
      type: 'SHAPE',
      subclassMarker: 'AcDbShape',
      insertionPoint: { x: 1, y: 2, z: 0 },
      size: 1,
      shapeNumber: 1,
      rotation: 0,
      xScale: 1,
      obliqueAngle: 0,
      thickness: 0,
      extrusionDirection: { x: 0, y: 0, z: -1 }
    } as any)

    expect(result).toBeInstanceOf(AcDbShape)
    expect((result as AcDbShape).position).toMatchObject({ x: -1, y: 2, z: 0 })
  })

  it('converts AcDb2LineAngularDimension entities with sparse libredwg fields', () => {
    acdbHostApplicationServices().workingDatabase = new AcDbDatabase()
    const converter = new AcDbEntityConverter()
    const result = converter.convert({
      type: 'DIMENSION',
      subclassMarker: 'AcDb2LineAngularDimension',
      handle: '1D3C',
      ownerBlockRecordSoftId: '18',
      layer: '08',
      name: '*D64',
      styleName: 'INTE$2',
      text: '<>',
      textPoint: { x: 144.2555221096907, y: 96.83120801079416, z: 0 },
      measurement: 0.2094395102393174,
      definitionPoint: {
        x: 134.60218283003303,
        y: 129.01372599012376,
        z: 0
      },
      arcPoint: {
        x: 134.60218283003303,
        y: 129.01372599012376,
        z: 0
      }
    } as any)

    expect(result).toBeInstanceOf(AcDb3PointAngularDimension)
    expect((result as AcDb3PointAngularDimension).dimBlockId).toBe('*D64')
  })
})
