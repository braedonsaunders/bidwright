import {
  AcCmColor,
  AcCmTransparency,
  AcDb2dPolyline,
  AcDb3dPolyline,
  AcDb3PointAngularDimension,
  AcDbAlignedDimension,
  AcDbArc,
  AcDbAttribute,
  AcDbAttributeDefinition,
  AcDbAttributeFlags,
  AcDbAttributeMTextFlag,
  AcDbBlockReference,
  AcDbCircle,
  AcDbDiametricDimension,
  AcDbDimension,
  AcDbEllipse,
  AcDbEntity,
  AcDbFace,
  AcDbHatch,
  AcDbHatchObjectType,
  AcDbHatchPatternType,
  AcDbHatchStyle,
  AcDbLeader,
  AcDbLeaderAnnotationType,
  AcDbLine,
  AcDbLineSpacingStyle,
  AcDbMLeader,
  AcDbMLeaderContentType,
  AcDbMLeaderLineType,
  AcDbMLeaderTextAttachmentDirection,
  AcDbMLine,
  AcDbMLineJustification,
  AcDbMText,
  AcDbOrdinateDimension,
  AcDbPoint,
  AcDbPoly2dType,
  AcDbPoly3dType,
  AcDbPolyFaceMesh,
  AcDbPolygonMesh,
  AcDbPolyline,
  AcDbProxyEntity,
  AcDbRadialDimension,
  AcDbRasterImage,
  AcDbRasterImageClipBoundaryType,
  AcDbRay,
  AcDbRotatedDimension,
  AcDbShape,
  AcDbSpline,
  AcDbTable,
  AcDbTableCell,
  AcDbText,
  AcDbTextHorizontalMode,
  AcDbTextVerticalMode,
  AcDbTrace,
  AcDbViewport,
  AcDbWipeout,
  AcDbXline,
  AcGeBoundaryEdgeType,
  AcGeCircArc2d,
  AcGeEllipseArc2d,
  AcGeLine2d,
  AcGeLoop2d,
  AcGeMathUtil,
  AcGePoint2d,
  AcGePoint3d,
  AcGePoint3dLike,
  AcGePolyline2d,
  AcGeSpline3d,
  AcGeVector2d,
  AcGeVector3d,
  AcGiMTextAttachmentPoint,
  AcGiMTextFlowDirection,
  decodeMLeaderStyleRawColor,
  hexStringsToBytes,
  transformOcsPointToWcs
} from '@mlightcad/data-model'
import {
  ArcEntity,
  AttdefEntity,
  AttributeEntity,
  FaceEntity,
  GradientHatchEntity,
  HatchSolidFill,
  SmoothType,
  VertexFlag
} from '@mlightcad/dxf-json/types'
import { CircleEntity } from '@mlightcad/dxf-json/types'
import {
  ArcEdge,
  BoundaryPathEdge,
  EdgeBoundaryPath,
  EllipseEdge,
  HatchEntity,
  LineEdge,
  PolylineBoundaryPath,
  SplineEdge
} from '@mlightcad/dxf-json/types'
import {
  CommonDxfEntity,
  EllipseEntity,
  ImageEntity,
  InsertEntity,
  LeaderEntity,
  LineEntity,
  LWPolylineEntity,
  MLineEntity,
  MTextEntity,
  MultiLeaderEntity,
  PointEntity,
  PolylineEntity,
  RayEntity,
  ShapeEntity,
  SolidEntity,
  SplineEntity,
  TableEntity,
  TextEntity,
  ViewportEntity,
  WipeoutEntity,
  XLineEntity
} from '@mlightcad/dxf-json/types'
import {
  AcadProxyEntity,
  AlignedDimensionEntity,
  AngularDimensionEntity,
  DimensionEntityCommon,
  OrdinateDimensionEntity,
  RadialDiameterDimensionEntity
} from '@mlightcad/dxf-json/types'

type ParsedMLeaderBreak = {
  index?: number
  start: AcGePoint3dLike
  end: AcGePoint3dLike
}

type ParsedMLeaderLine = {
  vertices: AcGePoint3dLike[]
  breakPointIndexes?: number[]
  leaderLineIndex?: number
  breaks?: ParsedMLeaderBreak[]
}

type ParsedMLeaderLeader = {
  lastLeaderLinePoint?: AcGePoint3dLike
  lastLeaderLinePointSet?: boolean
  doglegVector?: AcGePoint3dLike
  doglegVectorSet?: boolean
  doglegLength?: number
  breaks?: ParsedMLeaderBreak[]
  leaderBranchIndex?: number
  leaderLines?: ParsedMLeaderLine[]
}

/**
 * Converts DXF entities to AcDbEntity objects.
 *
 * This class provides functionality to convert various DXF entity types
 * (such as lines, circles, arcs, text, etc.) into their corresponding
 * AcDbEntity objects. It handles the conversion of geometric data,
 * properties, and attributes from DXF format to the internal database format.
 *
 * @example
 * ```typescript
 * const converter = new AcDbEntityConverter();
 * const dxfEntity = { type: 'LINE', startPoint: [0, 0, 0], endPoint: [10, 10, 0] };
 * const acDbEntity = converter.convert(dxfEntity);
 * ```
 */
export class AcDbEntityConverter {
  /**
   * Converts a DXF entity to an AcDbEntity.
   *
   * This method takes a DXF entity and converts it to the corresponding
   * AcDbEntity type. It first creates the entity using createEntity(),
   * then processes common attributes using processCommonAttrs().
   *
   * @param entity - The DXF entity to convert
   * @returns The converted AcDbEntity, or null if conversion fails
   *
   * @example
   * ```typescript
   * const dxfLine = { type: 'LINE', startPoint: [0, 0, 0], endPoint: [10, 10, 0] };
   * const acDbLine = converter.convert(dxfLine);
   * if (acDbLine) {
   *   console.log('Converted to:', acDbLine.type);
   * }
   * ```
   */
  convert(entity: CommonDxfEntity): AcDbEntity | null {
    const dbEntity = this.createEntity(entity)
    if (dbEntity) {
      this.processCommonAttrs(entity, dbEntity)
    }
    return dbEntity
  }

  /**
   * Creates the corresponding drawing database entity from DXF format data.
   *
   * This method acts as a factory that routes DXF entities to their specific
   * conversion methods based on the entity type. It handles all supported
   * DXF entity types including geometric entities, text entities, and special entities.
   *
   * @param entity - Input entity data in DXF format
   * @returns The converted drawing database entity, or null if the entity type is not supported
   *
   * @example
   * ```typescript
   * const dxfEntity = { type: 'CIRCLE', center: [0, 0, 0], radius: 5 };
   * const acDbEntity = converter.createEntity(dxfEntity);
   * ```
   */
  private createEntity(entity: CommonDxfEntity): AcDbEntity | null {
    if (entity.type == '3DFACE') {
      return this.convertFace(entity as FaceEntity)
    } else if (entity.type == 'ARC') {
      return this.convertArc(entity as ArcEntity)
    } else if (entity.type == 'ATTDEF') {
      return this.convertAttributeDefinition(entity as AttdefEntity)
    } else if (entity.type == 'ATTRIB') {
      return this.convertAttribute(entity as AttributeEntity)
    } else if (entity.type == 'CIRCLE') {
      return this.convertCirle(entity as CircleEntity)
    } else if (entity.type == 'DIMENSION') {
      return this.convertDimension(entity as DimensionEntityCommon)
    } else if (entity.type == 'ELLIPSE') {
      return this.convertEllipse(entity as EllipseEntity)
    } else if (entity.type == 'HATCH') {
      return this.convertHatch(entity as HatchEntity)
    } else if (entity.type == 'IMAGE') {
      return this.convertImage(entity as ImageEntity)
    } else if (entity.type == 'LEADER') {
      return this.convertLeader(entity as LeaderEntity)
    } else if (entity.type == 'LINE') {
      return this.convertLine(entity as LineEntity)
    } else if (entity.type == 'LWPOLYLINE') {
      return this.convertLWPolyline(entity as LWPolylineEntity)
    } else if (entity.type == 'MTEXT') {
      return this.convertMText(entity as MTextEntity)
    } else if (entity.type == 'MLINE') {
      return this.convertMLine(entity as MLineEntity)
    } else if (entity.type == 'MULTILEADER' || entity.type == 'MLEADER') {
      return this.convertMLeader(entity as MultiLeaderEntity)
    } else if (entity.type == 'POLYLINE') {
      return this.convertPolyline(entity as PolylineEntity)
    } else if (entity.type == 'POINT') {
      return this.convertPoint(entity as PointEntity)
    } else if (entity.type == 'RAY') {
      return this.convertRay(entity as RayEntity)
    } else if (entity.type == 'SPLINE') {
      return this.convertSpline(entity as SplineEntity)
    } else if (entity.type == 'ACAD_TABLE') {
      return this.convertTable(entity as TableEntity)
    } else if (entity.type == 'TEXT') {
      return this.convertText(entity as TextEntity)
    } else if (entity.type == 'SHAPE') {
      return this.convertShape(entity as ShapeEntity)
    } else if (entity.type == 'SOLID') {
      return this.convertSolid(entity as SolidEntity)
    } else if (entity.type == 'VIEWPORT') {
      return this.convertViewport(entity as ViewportEntity)
    } else if (entity.type == 'WIPEOUT') {
      return this.convertWipeout(entity as WipeoutEntity)
    } else if (entity.type == 'XLINE') {
      return this.convertXline(entity as XLineEntity)
    } else if (entity.type == 'INSERT') {
      return this.convertBlockReference(entity as InsertEntity)
    } else if (entity.type == 'ACAD_PROXY_ENTITY') {
      return this.convertProxyEntity(entity as AcadProxyEntity)
    }
    return null
  }

  /**
   * Converts a DXF ACAD_PROXY_ENTITY to an AcDbProxyEntity.
   */
  private convertProxyEntity(entity: AcadProxyEntity): AcDbProxyEntity {
    const proxy = new AcDbProxyEntity()
    proxy.proxyEntityClassId = entity.proxyEntityClassId
    if (entity.originalDxfName) {
      proxy.originalDxfName = entity.originalDxfName
    }
    if (entity.objectDrawingFormat != null) {
      proxy.graphicsMetafileType = entity.objectDrawingFormat
    }
    if (entity.applicationEntityClassId != null) {
      proxy.originalClassName = String(entity.applicationEntityClassId)
    }
    if (entity.graphicsData) {
      const bytes = hexStringsToBytes([entity.graphicsData])
      const size = entity.graphicsDataSize ?? bytes.length
      proxy.setProxyGraphic(bytes.subarray(0, size))
    }
    return proxy
  }

  /**
   * Converts a DXF 3DFACE entity to an AcDbFace.
   *
   * @param face - The DXF 3DFace entity to convert
   * @returns The converted AcDbFace entity
   */
  private convertFace(face: FaceEntity) {
    const dbEntity = new AcDbFace()
    face.vertices.forEach((vertex, index) =>
      dbEntity.setVertexAt(index, vertex)
    )
    return dbEntity
  }

  /**
   * Converts a DXF arc entity to an AcDbArc.
   *
   * @param arc - The DXF arc entity to convert
   * @returns The converted AcDbArc entity
   *
   * @example
   * ```typescript
   * const dxfArc = { type: 'ARC', center: [0, 0, 0], radius: 5, startAngle: 0, endAngle: 90 };
   * const acDbArc = converter.convertArc(dxfArc);
   * ```
   */
  private convertArc(arc: ArcEntity) {
    const normal = arc.extrusionDirection ?? AcGeVector3d.Z_AXIS
    const dbEntity = new AcDbArc(
      transformOcsPointToWcs(arc.center, normal),
      arc.radius,
      AcGeMathUtil.degToRad(arc.startAngle),
      AcGeMathUtil.degToRad(arc.endAngle),
      normal
    )
    return dbEntity
  }

  private convertAttributeCommon(
    attrib: AttributeEntity | AttdefEntity,
    dbAttrib: AcDbAttribute | AcDbAttributeDefinition
  ) {
    dbAttrib.textString = attrib.text
    dbAttrib.height = attrib.textHeight
    dbAttrib.position.copy(attrib.startPoint)
    // Propagate DXF group 11 (alignment point) used when halign/valign are
    // non-default. Falls back to startPoint when missing or zero so the
    // alignment anchor never collapses to the world origin ??see notes in
    // `libredwg-converter` for the same defensive handling.
    const ap = attrib.alignmentPoint
    const isApZero =
      !ap || (ap.x === 0 && ap.y === 0 && ((ap as { z?: number }).z ?? 0) === 0)
    if (ap && !isApZero) {
      dbAttrib.alignmentPoint.copy(ap)
    } else {
      dbAttrib.alignmentPoint.copy(attrib.startPoint)
    }
    dbAttrib.rotation = attrib.rotation
    dbAttrib.oblique = attrib.obliqueAngle ?? 0
    dbAttrib.thickness = attrib.thickness
    dbAttrib.tag = attrib.tag
    dbAttrib.fieldLength = 0 // dxf-json doesn't have this field
    dbAttrib.isInvisible =
      (attrib.attributeFlag & AcDbAttributeFlags.Invisible) !== 0
    dbAttrib.isConst = (attrib.attributeFlag & AcDbAttributeFlags.Const) !== 0
    dbAttrib.isVerifiable =
      (attrib.attributeFlag & AcDbAttributeFlags.Verifiable) !== 0
    dbAttrib.isPreset = (attrib.attributeFlag & AcDbAttributeFlags.Preset) !== 0
    dbAttrib.isReallyLocked = !!attrib.isReallyLocked
    dbAttrib.isMTextAttribute =
      (attrib.mtextFlag & AcDbAttributeMTextFlag.MultiLine) !== 0
    dbAttrib.isConstMTextAttribute =
      (attrib.mtextFlag & AcDbAttributeMTextFlag.ConstMultiLine) !== 0
  }

  private convertAttribute(attrib: AttributeEntity) {
    const dbAttrib = new AcDbAttribute()
    this.convertAttributeCommon(attrib, dbAttrib)
    dbAttrib.styleName = attrib.textStyle
    dbAttrib.horizontalMode =
      attrib.horizontalJustification as AcDbTextHorizontalMode
    dbAttrib.verticalMode = attrib.verticalJustification as AcDbTextVerticalMode
    dbAttrib.widthFactor = attrib.scale ?? 1
    dbAttrib.lockPositionInBlock = attrib.lockPositionFlag
    return dbAttrib
  }

  private convertAttributeDefinition(attrib: AttdefEntity) {
    const dbAttDef = new AcDbAttributeDefinition()
    this.convertAttributeCommon(attrib, dbAttDef)
    dbAttDef.styleName = attrib.styleName
    dbAttDef.horizontalMode = attrib.halign as unknown as AcDbTextHorizontalMode
    dbAttDef.verticalMode = attrib.valign as unknown as AcDbTextVerticalMode
    dbAttDef.widthFactor = attrib.xScale ?? 1
    dbAttDef.prompt = attrib.prompt
    return dbAttDef
  }

  /**
   * Converts a DXF circle entity to an AcDbCircle.
   *
   * @param circle - The DXF circle entity to convert
   * @returns The converted AcDbCircle entity
   *
   * @example
   * ```typescript
   * const dxfCircle = { type: 'CIRCLE', center: [0, 0, 0], radius: 5 };
   * const acDbCircle = converter.convertCirle(dxfCircle);
   * ```
   */
  private convertCirle(circle: CircleEntity) {
    const normal = circle.extrusionDirection ?? AcGeVector3d.Z_AXIS
    const dbEntity = new AcDbCircle(
      transformOcsPointToWcs(circle.center, normal),
      circle.radius,
      normal
    )
    return dbEntity
  }

  /**
   * Converts a DXF ellipse entity to an AcDbEllipse.
   *
   * @param ellipse - The DXF ellipse entity to convert
   * @returns The converted AcDbEllipse entity
   *
   * @example
   * ```typescript
   * const dxfEllipse = { type: 'ELLIPSE', center: [0, 0, 0], majorAxisEndPoint: [5, 0, 0] };
   * const acDbEllipse = converter.convertEllipse(dxfEllipse);
   * ```
   */
  private convertEllipse(ellipse: EllipseEntity) {
    const majorAxis = new AcGeVector3d(ellipse.majorAxisEndPoint)
    const majorAxisRadius = majorAxis.length()
    const dbEntity = new AcDbEllipse(
      ellipse.center,
      ellipse.extrusionDirection ?? AcGeVector3d.Z_AXIS,
      majorAxis,
      majorAxisRadius,
      majorAxisRadius * ellipse.axisRatio,
      ellipse.startAngle,
      ellipse.endAngle
    )
    return dbEntity
  }

  private convertLine(line: LineEntity) {
    const start = line.startPoint
    const end = line.endPoint
    const dbEntity = new AcDbLine(
      new AcGePoint3d(start.x, start.y, start.z || 0),
      new AcGePoint3d(end.x, end.y, end.z || 0)
    )
    return dbEntity
  }

  private convertSpline(spline: SplineEntity) {
    return AcDbSpline.fromDwgSpline(spline)
  }

  private convertPoint(point: PointEntity) {
    const dbEntity = new AcDbPoint()
    dbEntity.position = point.position
    return dbEntity
  }

  private convertShape(shape: ShapeEntity) {
    const dbEntity = new AcDbShape()
    dbEntity.position.copy(shape.insertionPoint)
    dbEntity.size = shape.size
    dbEntity.name = shape.shapeName
    dbEntity.rotation = AcGeMathUtil.degToRad(shape.rotation || 0)
    dbEntity.widthFactor = shape.xScale ?? 1
    dbEntity.oblique = AcGeMathUtil.degToRad(shape.obliqueAngle || 0)
    dbEntity.thickness = shape.thickness ?? 0
    dbEntity.normal.copy(shape.extrusionDirection ?? { x: 0, y: 0, z: 1 })
    return dbEntity
  }

  private convertSolid(solid: SolidEntity) {
    const dbEntity = new AcDbTrace()
    solid.points.forEach((point, index) => dbEntity.setPointAt(index, point))
    dbEntity.thickness = solid.thickness
    return dbEntity
  }

  private convertPolyline(polyline: PolylineEntity) {
    // Polyline flag (bit-coded; default = 0):
    // https://help.autodesk.com/view/OARX/2023/ENU/?guid=GUID-ABF6B778-BE20-4B49-9B58-A94E64CEFFF3
    //
    // 1 = This is a closed polyline (or a polygon mesh closed in the M direction)
    // 2 = Curve-fit vertices have been added
    // 4 = Spline-fit vertices have been added
    // 8 = This is a 3D polyline
    // 16 = This is a 3D polygon mesh
    // 32 = The polygon mesh is closed in the N direction
    // 64 = The polyline is a polyface mesh
    // 128 = The linetype pattern is generated continuously around the vertices of this polyline
    const isClosed = !!(polyline.flag & 0x01)
    const is3dPolyline = !!(polyline.flag & 0x08)
    const isPolygonMesh = !!(polyline.flag & 0x10) // 16
    const isPolyfaceMesh = !!(polyline.flag & 0x40) // 64
    const isClosedN = !!(polyline.flag & 0x20) // 32

    // Filter out spline control points
    const vertices: AcGePoint3dLike[] = []
    const bulges: number[] = []
    const faces: number[][] = []

    polyline.vertices?.map(vertex => {
      if (!(vertex.flag & VertexFlag.SPLINE_CONTROL_POINT)) {
        // For polyface mesh, vertex flag 128 bit is set for all vertices
        if (isPolyfaceMesh && vertex.flag & 0x80) {
          // 128 bit set
          // Check if this is a face vertex (64 bit not set)
          if (!(vertex.flag & 0x40)) {
            // 64 bit not set
            if (vertex.faces && vertex.faces.length >= 3) {
              faces.push([...vertex.faces])
            }
          } else {
            // This is a regular vertex (64 bit set)
            vertices.push({
              x: vertex.x,
              y: vertex.y,
              z: vertex.z
            })
            bulges.push(vertex.bulge ?? 0)
          }
        } else {
          // This is a regular vertex
          vertices.push({
            x: vertex.x,
            y: vertex.y,
            z: vertex.z
          })
          bulges.push(vertex.bulge ?? 0)
        }
      }
    })

    if (isPolygonMesh) {
      // For polygon mesh, we need M and N counts
      // In DXF, these are stored in the polyline entity as 71 and 72 group codes
      const mCount = polyline.meshMVertexCount
      const nCount = polyline.meshNVertexCount
      return new AcDbPolygonMesh(mCount, nCount, vertices, isClosed, isClosedN)
    } else if (isPolyfaceMesh) {
      return new AcDbPolyFaceMesh(vertices, faces)
    } else if (is3dPolyline) {
      let polyType = AcDbPoly3dType.SimplePoly
      if (polyline.flag & 0x04) {
        if (polyline.smoothType == SmoothType.CUBIC) {
          polyType = AcDbPoly3dType.CubicSplinePoly
        } else if (polyline.smoothType == SmoothType.QUADRATIC) {
          polyType = AcDbPoly3dType.QuadSplinePoly
        }
      }
      return new AcDb3dPolyline(polyType, vertices, isClosed)
    } else {
      let polyType = AcDbPoly2dType.SimplePoly
      if (polyline.flag & 0x02) {
        polyType = AcDbPoly2dType.FitCurvePoly
      } else if (polyline.flag & 0x04) {
        if (polyline.smoothType == SmoothType.CUBIC) {
          polyType = AcDbPoly2dType.CubicSplinePoly
        } else if (polyline.smoothType == SmoothType.QUADRATIC) {
          polyType = AcDbPoly2dType.QuadSplinePoly
        }
      }
      return new AcDb2dPolyline(
        polyType,
        vertices,
        0,
        isClosed,
        polyline.startWidth,
        polyline.endWidth,
        bulges
      )
    }
  }

  private convertLWPolyline(polyline: LWPolylineEntity) {
    const dbEntity = new AcDbPolyline()
    dbEntity.closed = !!(polyline.flag & 0x01)
    const defaultWidth = polyline.constantWidth ?? -1
    polyline.vertices?.forEach((vertex, index) => {
      dbEntity.addVertexAt(
        index,
        new AcGePoint2d(vertex.x, vertex.y),
        vertex.bulge,
        vertex.startWidth ?? defaultWidth,
        vertex.endWidth ?? defaultWidth
      )
    })
    return dbEntity
  }

  private convertHatch(hatch: HatchEntity) {
    const dbEntity = new AcDbHatch()

    hatch.definitionLines?.forEach(item => {
      dbEntity.definitionLines.push({
        angle: AcGeMathUtil.degToRad(item.angle || 0),
        base: item.base,
        offset: item.offset,
        dashLengths: item.numberOfDashLengths > 0 ? item.dashLengths : []
      })
    })
    dbEntity.isSolidFill = hatch.solidFill == HatchSolidFill.SolidFill
    dbEntity.hatchStyle = hatch.hatchStyle as unknown as AcDbHatchStyle
    dbEntity.patternName = hatch.patternName
    dbEntity.patternType = hatch.patternType as unknown as AcDbHatchPatternType
    dbEntity.patternAngle =
      hatch.patternAngle == null ? 0 : AcGeMathUtil.degToRad(hatch.patternAngle)
    dbEntity.patternScale = hatch.patternScale == null ? 0 : hatch.patternScale

    const paths = hatch.boundaryPaths
    paths.forEach(path => {
      const flag = path.boundaryPathTypeFlag
      // Check whether it is a polyline
      if (flag & 0x02) {
        const polylinePath = path as PolylineBoundaryPath
        const polyline = new AcGePolyline2d()
        polyline.closed = polylinePath.isClosed
        polylinePath.vertices.forEach((vertex, index) => {
          polyline.addVertexAt(index, {
            x: vertex.x,
            y: vertex.y,
            bulge: vertex.bulge
          })
        })
        dbEntity.add(polyline)
      } else {
        const edgePath = path as EdgeBoundaryPath<BoundaryPathEdge>
        const edges: AcGeBoundaryEdgeType[] = []
        edgePath.edges.forEach(edge => {
          if (edge.type == 1) {
            const line = edge as LineEdge
            edges.push(new AcGeLine2d(line.start, line.end))
          } else if (edge.type == 2) {
            const arc = edge as ArcEdge
            edges.push(
              new AcGeCircArc2d(
                arc.center,
                arc.radius,
                AcGeMathUtil.degToRad(arc.startAngle || 0),
                AcGeMathUtil.degToRad(arc.endAngle || 0),
                !arc.isCCW
              )
            )
          } else if (edge.type == 3) {
            const ellipse = edge as EllipseEdge
            const majorAxis = new AcGeVector2d()
            majorAxis.subVectors(ellipse.end, ellipse.center)
            const majorAxisRadius = Math.sqrt(
              Math.pow(ellipse.end.x, 2) + Math.pow(ellipse.end.y, 2)
            )
            // Property name 'lengthOfMinorAxis' is really confusing.
            // Actually length of minor axis means percentage of major axis length.
            const minorAxisRadius = majorAxisRadius * ellipse.lengthOfMinorAxis
            let startAngle = AcGeMathUtil.degToRad(ellipse.startAngle || 0)
            let endAngle = AcGeMathUtil.degToRad(ellipse.endAngle || 0)
            const rotation = Math.atan2(ellipse.end.y, ellipse.end.x)
            if (!ellipse.isCCW) {
              // when clockwise, need to handle start/end angles
              startAngle = Math.PI * 2 - startAngle
              endAngle = Math.PI * 2 - endAngle
            }
            edges.push(
              new AcGeEllipseArc2d(
                { ...ellipse.center, z: 0 },
                majorAxisRadius,
                minorAxisRadius,
                startAngle,
                endAngle,
                !ellipse.isCCW,
                rotation
              )
            )
          } else if (edge.type == 4) {
            const splineEdge = AcGeSpline3d.fromDwgSplineEdge(
              edge as SplineEdge
            )
            if (splineEdge) {
              edges.push(splineEdge)
            }
          }
        })
        const loops = AcGeLoop2d.buildFromEdges(edges)
        if (loops.length == 0 && edges.length > 0) {
          // Fallback: keep original order if we failed to build any loop.
          dbEntity.add(new AcGeLoop2d(edges))
        } else {
          loops.forEach(loop => dbEntity.add(loop))
        }
      }
    })

    // Handle gradient fill properties
    // The meaning of gradientFlag is as follows.
    // - 0: Solid hatch
    // - 1: Gradient
    if (hatch.gradientFlag) {
      const gradientHatch = hatch as GradientHatchEntity
      dbEntity.hatchObjectType = AcDbHatchObjectType.GradientObject
      dbEntity.gradientName = gradientHatch.gradientName
      dbEntity.gradientAngle = gradientHatch.gradientRotation ?? 0
      dbEntity.gradientShift = gradientHatch.gradientDefinition ?? 0
      dbEntity.gradientOneColorMode = gradientHatch.gradientColorFlag == 1
      dbEntity.shadeTintValue = gradientHatch.colorTint ?? 0
      if (gradientHatch.gradientColors) {
        const length = gradientHatch.gradientColors.length
        if (length > 1) {
          dbEntity.gradientStartColor = gradientHatch.gradientColors[0].rgb
          dbEntity.gradientEndColor = gradientHatch.gradientColors[1].rgb
        } else if (length > 0) {
          dbEntity.gradientStartColor = gradientHatch.gradientColors[0].rgb
        }
      }
    }
    return dbEntity
  }

  private convertTable(table: TableEntity) {
    const dbEntity = new AcDbTable(
      table.name,
      table.rowCount,
      table.columnCount
    )
    dbEntity.tableDataVersion = table.version
    dbEntity.tableStyleId = table.tableStyleId
    dbEntity.owningBlockRecordId = table.blockRecordHandle
    if (table.directionVector) {
      dbEntity.horizontalDirection = new AcGeVector3d(table.directionVector)
    }
    dbEntity.attachmentPoint =
      table.attachmentPoint as unknown as AcGiMTextAttachmentPoint
    dbEntity.position.copy(table.startPoint)
    dbEntity.tableValueFlag = table.tableValue
    dbEntity.tableOverrideFlag = table.overrideFlag
    dbEntity.borderColorOverrideFlag = table.borderColorOverrideFlag
    dbEntity.borderLineweightOverrideFlag = table.borderLineWeightOverrideFlag
    dbEntity.borderVisibilityOverrideFlag = table.borderVisibilityOverrideFlag
    table.columnWidthArr.forEach((width, index) =>
      dbEntity.setColumnWidth(index, width)
    )
    table.rowHeightArr.forEach((height, index) =>
      dbEntity.setRowHeight(index, height)
    )
    table.cells.forEach((cell, index) => {
      dbEntity.setCell(index, cell as unknown as AcDbTableCell)
    })
    return dbEntity
  }

  private convertText(text: TextEntity) {
    const dbEntity = new AcDbText()
    dbEntity.textString = text.text
    dbEntity.styleName = text.styleName
    dbEntity.height = text.textHeight
    dbEntity.position.copy(text.startPoint)
    // dxf-json calls DXF group 11 `endPoint` on TEXT; this is the alignment
    // point used when halign/valign deviate from Left/Baseline. Fall back to
    // startPoint when missing or zero ??same defensive handling as in
    // `convertAttributeCommon`.
    const ep = text.endPoint
    const isEpZero =
      !ep || (ep.x === 0 && ep.y === 0 && ((ep as { z?: number }).z ?? 0) === 0)
    if (ep && !isEpZero) {
      dbEntity.alignmentPoint.copy(ep)
    } else {
      dbEntity.alignmentPoint.copy(text.startPoint)
    }
    dbEntity.rotation = AcGeMathUtil.degToRad(text.rotation || 0)
    dbEntity.oblique = text.obliqueAngle ?? 0
    dbEntity.thickness = text.thickness
    dbEntity.horizontalMode = text.halign as unknown as AcDbTextHorizontalMode
    dbEntity.verticalMode = text.valign as unknown as AcDbTextVerticalMode
    dbEntity.widthFactor = text.xScale ?? 1
    return dbEntity
  }

  private convertMText(mtext: MTextEntity) {
    const dbEntity = new AcDbMText()
    dbEntity.contents = mtext.text
    if (mtext.styleName != null) {
      dbEntity.styleName = mtext.styleName
    }
    dbEntity.height = mtext.height
    dbEntity.width = mtext.width
    dbEntity.rotation = AcGeMathUtil.degToRad(mtext.rotation || 0)
    dbEntity.location = mtext.insertionPoint as AcGePoint3d
    dbEntity.attachmentPoint =
      mtext.attachmentPoint as unknown as AcGiMTextAttachmentPoint
    if (mtext.direction) {
      dbEntity.direction = new AcGeVector3d(mtext.direction)
    }
    dbEntity.drawingDirection =
      mtext.drawingDirection as unknown as AcGiMTextFlowDirection
    return dbEntity
  }

  private convertLeader(leader: LeaderEntity) {
    const dbEntity = new AcDbLeader()
    leader.vertices?.forEach(point => {
      dbEntity.appendVertex(point)
    })
    dbEntity.hasArrowHead = leader.isArrowheadEnabled
    dbEntity.hasHookLine = leader.isHooklineExists
    dbEntity.isHookLineSameDirection = leader.isHooklineSameDirection
    dbEntity.isSplined = leader.isSpline
    dbEntity.dimensionStyle = leader.styleName ?? ''
    dbEntity.annoType =
      leader.leaderCreationFlag as unknown as AcDbLeaderAnnotationType
    dbEntity.textHeight = leader.textHeight ?? 0
    dbEntity.textWidth = leader.textWidth ?? 0
    dbEntity.byBlockColor = leader.byBlockColor
    dbEntity.associatedAnnotation = leader.associatedAnnotation ?? ''
    if (leader.normal) dbEntity.normal = leader.normal
    if (leader.horizontalDirection) {
      dbEntity.horizontalDirection = leader.horizontalDirection
    }
    if (leader.offsetFromBlock)
      dbEntity.offsetFromBlock = leader.offsetFromBlock
    if (leader.offsetFromAnnotation) {
      dbEntity.offsetFromAnnotation = leader.offsetFromAnnotation
    }
    return dbEntity
  }

  private convertMLine(mline: MLineEntity) {
    const dbEntity = new AcDbMLine()

    dbEntity.styleName = mline.name || 'STANDARD'
    dbEntity.styleObjectHandle = mline.styleObjectHandle
    dbEntity.scale = mline.scale
    dbEntity.justification =
      mline.justification as unknown as AcDbMLineJustification
    dbEntity.flags = mline.flags
    dbEntity.styleCount = mline.styleCount
    dbEntity.startPosition = mline.startPosition
    dbEntity.normal = mline.extrusionDirection ?? AcGeVector3d.Z_AXIS

    dbEntity.segments = (mline.segments ?? []).map(segment => ({
      position: segment.position,
      direction: segment.direction,
      miterDirection: segment.miterDirection,
      elements:
        segment.elements?.map(element => ({
          parameterCount: element.parameterCount,
          parameters: element.parameters ?? [],
          fillCount: element.fillCount,
          fillParameters: element.fillParameters ?? []
        })) ?? []
    }))

    return dbEntity
  }

  private convertMLeader(mleader: MultiLeaderEntity) {
    const dbEntity = new AcDbMLeader()
    const raw = mleader as MultiLeaderEntity & Record<string, unknown>

    dbEntity.version = mleader.version
    dbEntity.leaderStyleId = mleader.leaderStyleId
    if (mleader.leaderStyleId) dbEntity.mleaderStyleId = mleader.leaderStyleId
    dbEntity.propertyOverrideFlag = mleader.propertyOverrideFlag
    dbEntity.leaderLineType = (mleader.leaderLineType ??
      AcDbMLeaderLineType.StraightLeader) as AcDbMLeaderLineType
    if (mleader.leaderLineColor != null) {
      dbEntity.leaderLineColor = decodeMLeaderStyleRawColor(
        mleader.leaderLineColor
      )
    }
    dbEntity.leaderLineTypeId = mleader.leaderLineTypeId
    dbEntity.leaderLineWeight = mleader.leaderLineWeight
    dbEntity.landingEnabled = mleader.landingEnabled
    dbEntity.doglegEnabled = mleader.doglegEnabled ?? false
    dbEntity.doglegLength = mleader.doglegLength ?? 0
    dbEntity.arrowheadId = mleader.arrowheadId
    dbEntity.arrowheadSize = mleader.arrowheadSize
    dbEntity.textStyleId = mleader.textStyleId
    dbEntity.textLeftAttachmentType = mleader.textLeftAttachmentType
    dbEntity.textRightAttachmentType = mleader.textRightAttachmentType
    dbEntity.textAngleType = mleader.textAngleType
    dbEntity.textAlignmentType = mleader.textAlignmentType
    if (mleader.textColor != null) {
      dbEntity.textColor = decodeMLeaderStyleRawColor(mleader.textColor)
    }
    dbEntity.textFrameEnabled = mleader.textFrameEnabled
    dbEntity.landingGap = mleader.landingGap
    dbEntity.textAttachment = mleader.textAttachment
    dbEntity.textFlowDirection = mleader.textFlowDirection
    if (this.isValidHandleId(mleader.blockContentId)) {
      dbEntity.blockContentId = mleader.blockContentId
    }
    if (mleader.blockContentColor != null) {
      dbEntity.blockContentColor = decodeMLeaderStyleRawColor(
        mleader.blockContentColor
      )
    }
    dbEntity.blockContentRotation = mleader.blockContentRotation
    dbEntity.blockContentConnectionType = mleader.blockContentConnectionType
    dbEntity.annotativeScaleEnabled = mleader.annotativeScaleEnabled
    dbEntity.arrowheadOverrides = mleader.arrowheadOverrides
      ? mleader.arrowheadOverrides.map(item => ({ ...item }))
      : []
    dbEntity.blockAttributes = mleader.blockAttributes
      ? mleader.blockAttributes.map(item => ({ ...item }))
      : []
    dbEntity.textDirectionNegative = mleader.textDirectionNegative
    dbEntity.textAlignInIPE = mleader.textAlignInIPE
    dbEntity.bottomTextAttachmentDirection =
      mleader.bottomTextAttachmentDirection
    dbEntity.topTextAttachmentDirection = mleader.topTextAttachmentDirection
    dbEntity.contentScale = mleader.contentScale
    dbEntity.textLineSpacingStyle = mleader.textLineSpacingStyle
    if (mleader.textBackgroundColor != null) {
      dbEntity.textBackgroundColor = decodeMLeaderStyleRawColor(
        mleader.textBackgroundColor
      )
    }
    dbEntity.textBackgroundScaleFactor = mleader.textBackgroundScaleFactor
    dbEntity.textBackgroundTransparency = mleader.textBackgroundTransparency
    dbEntity.textBackgroundColorOn = mleader.textBackgroundColorOn
    dbEntity.textFillOn = mleader.textFillOn
    dbEntity.textColumnType = mleader.textColumnType
    dbEntity.textUseAutoHeight = mleader.textUseAutoHeight
    dbEntity.textColumnWidth = mleader.textColumnWidth
    dbEntity.textColumnGutterWidth = mleader.textColumnGutterWidth
    dbEntity.textColumnFlowReversed = mleader.textColumnFlowReversed
    dbEntity.textColumnHeight = mleader.textColumnHeight
    dbEntity.textUseWordBreak = mleader.textUseWordBreak
    dbEntity.hasMText = mleader.hasMText
    dbEntity.hasBlock = mleader.hasBlock
    dbEntity.planeNormalReversed = mleader.planeNormalReversed

    if (mleader.blockContentScale) {
      dbEntity.blockContentScale = new AcGeVector3d(mleader.blockContentScale)
    }
    if (mleader.contentBasePosition) {
      dbEntity.contentBasePosition = new AcGePoint3d().copy(
        mleader.contentBasePosition
      )
    }
    if (mleader.textAnchor) {
      dbEntity.textAnchor = new AcGePoint3d().copy(mleader.textAnchor)
    }
    if (mleader.planeOrigin) {
      dbEntity.planeOrigin = new AcGePoint3d().copy(mleader.planeOrigin)
    }
    if (mleader.planeXAxisDirection) {
      dbEntity.planeXAxisDirection = new AcGeVector3d(
        mleader.planeXAxisDirection
      )
    }
    if (mleader.planeYAxisDirection) {
      dbEntity.planeYAxisDirection = new AcGeVector3d(
        mleader.planeYAxisDirection
      )
    }

    const rawTextContent = raw.textContent as unknown
    const rawTextContentRecord =
      rawTextContent && typeof rawTextContent === 'object'
        ? (rawTextContent as Record<string, unknown>)
        : undefined
    const hasMTextContent =
      (typeof rawTextContent === 'string' && rawTextContent.length > 0) ||
      this.readString(rawTextContentRecord ?? {}, ['text', 'contents']) !=
        null ||
      this.readString(raw, ['text', 'contents', 'mtext']) != null

    const contentType =
      mleader.contentType ??
      (hasMTextContent
        ? AcDbMLeaderContentType.MTextContent
        : mleader.blockContent
          ? AcDbMLeaderContentType.BlockContent
          : AcDbMLeaderContentType.NoneContent)
    dbEntity.contentType = contentType as AcDbMLeaderContentType

    const normal = this.readPoint(raw, ['normal', 'extrusionDirection'])
    if (normal) dbEntity.normal = normal

    const textStyleName =
      this.readString(rawTextContentRecord ?? {}, [
        'styleName',
        'textStyleName',
        'textStyle'
      ]) ?? this.readString(raw, ['textStyleName', 'textStyle', 'styleName'])
    if (textStyleName) dbEntity.textStyleName = textStyleName

    const textHeight =
      this.readPositiveNumber(rawTextContentRecord ?? {}, [
        'textHeight',
        'height'
      ]) ??
      this.readPositiveNumber(raw, [
        'textHeight',
        'mtextHeight',
        'textContentHeight'
      ]) ??
      this.readPositiveNumber(raw, ['arrowheadSize', 'contentScale'])
    if (textHeight != null) dbEntity.textHeight = textHeight

    const textWidth =
      this.readPositiveNumber(rawTextContentRecord ?? {}, [
        'textWidth',
        'width'
      ]) ??
      this.readPositiveNumber(raw, [
        'textWidth',
        'mtextWidth',
        'textContentWidth'
      ])
    if (textWidth != null) dbEntity.textWidth = textWidth
    dbEntity.textLineSpacingFactor =
      this.readNumber(rawTextContentRecord ?? {}, [
        'lineSpacingFactor',
        'textLineSpacingFactor'
      ]) ??
      this.readNumber(raw, ['textLineSpacingFactor']) ??
      dbEntity.textLineSpacingFactor
    const textRotation =
      this.readNumber(rawTextContentRecord ?? {}, [
        'textRotation',
        'rotation'
      ]) ??
      this.readNumber(raw, [
        'textRotation',
        'mtextRotation',
        'textContentRotation'
      ])
    if (textRotation != null) {
      dbEntity.textRotation = AcGeMathUtil.degToRad(textRotation)
    }

    const textDirection = this.readPoint(raw, [
      'textDirection',
      'mtextDirection',
      'textDirectionVector'
    ])
    if (textDirection) dbEntity.textDirection = textDirection

    const textAttachmentPoint = this.readNumber(raw, [
      'textAttachmentPoint',
      'attachmentPoint'
    ])
    if (textAttachmentPoint != null && textAttachmentPoint !== 0) {
      dbEntity.textAttachmentPoint =
        textAttachmentPoint as unknown as AcGiMTextAttachmentPoint
    }

    const textAttachmentDirection = mleader.textAttachmentDirection
    if (textAttachmentDirection != null) {
      dbEntity.textAttachmentDirection =
        textAttachmentDirection as unknown as AcDbMLeaderTextAttachmentDirection
    }

    const textDrawingDirection = this.readNumber(raw, [
      'textDrawingDirection',
      'drawingDirection'
    ])
    if (textDrawingDirection != null) {
      dbEntity.textDrawingDirection =
        textDrawingDirection as unknown as AcGiMTextFlowDirection
    }

    const text =
      typeof rawTextContent === 'string'
        ? rawTextContent
        : (this.readString(rawTextContentRecord ?? {}, ['text', 'contents']) ??
          this.readString(raw, ['text', 'contents', 'mtext']))
    const anchorPoint =
      this.readPoint(rawTextContentRecord ?? {}, [
        'anchorPoint',
        'textAnchor',
        'textLocation',
        'textPosition',
        'textAnchorPoint'
      ]) ??
      this.readPoint(raw, [
        'textAnchor',
        'textLocation',
        'textPosition',
        'textAnchorPoint',
        'contentBasePosition'
      ])
    if (text != null && anchorPoint) {
      dbEntity.mtextContent = { text, anchorPoint }
    }

    if (mleader.blockContent) {
      const blockRecord = mleader.blockContent as unknown as Record<
        string,
        unknown
      >
      const blockContentId = mleader.blockContent.blockContentId
      if (this.isValidHandleId(blockContentId)) {
        const rawBlockColor = this.readNumber(blockRecord, ['color'])
        dbEntity.blockContent = {
          blockContentId,
          normal: this.readPoint(blockRecord, ['normal']),
          position: mleader.blockContent.position,
          scale: this.readPoint(blockRecord, ['scale']),
          rotation: this.readNumber(blockRecord, ['rotation']),
          color:
            rawBlockColor != null
              ? decodeMLeaderStyleRawColor(rawBlockColor)
              : undefined,
          transformationMatrix: Array.isArray(
            mleader.blockContent.transformationMatrix
          )
            ? mleader.blockContent.transformationMatrix
            : []
        }
      }
    } else if (this.isValidHandleId(mleader.blockContentId)) {
      dbEntity.blockContent = {
        blockContentId: mleader.blockContentId,
        scale: mleader.blockContentScale,
        rotation: mleader.blockContentRotation,
        color: dbEntity.blockContentColor,
        transformationMatrix: []
      }
    }

    this.readMLeaderLeaders(raw)?.forEach(leader => {
      dbEntity.addLeader({
        lastLeaderLinePoint: leader.lastLeaderLinePoint,
        lastLeaderLinePointSet: leader.lastLeaderLinePointSet,
        doglegVector: leader.doglegVector,
        doglegVectorSet: leader.doglegVectorSet,
        doglegLength: leader.doglegLength ?? mleader.doglegLength,
        breaks: leader.breaks,
        leaderBranchIndex: leader.leaderBranchIndex,
        leaderLines: leader.leaderLines
      })
    })

    if (dbEntity.numberOfLeaders === 0) {
      this.readLeaderLineArray(raw)?.forEach(line => {
        dbEntity.addLeader({
          doglegLength: mleader.doglegLength
        })
        dbEntity.addLeaderLine(dbEntity.numberOfLeaders - 1, line)
      })
    }

    if (dbEntity.numberOfLeaders === 0 && mleader.contentBasePosition) {
      dbEntity.addLeader({
        lastLeaderLinePoint: mleader.contentBasePosition,
        lastLeaderLinePointSet: true,
        doglegLength: mleader.doglegLength
      })
    }

    return dbEntity
  }

  private convertDimension(dimension: DimensionEntityCommon) {
    if (dimension.subclassMarker == 'AcDbAlignedDimension') {
      const entity = dimension as AlignedDimensionEntity
      const dbEntity = new AcDbAlignedDimension(
        entity.subDefinitionPoint1,
        entity.subDefinitionPoint2,
        entity.definitionPoint
      )
      if (entity.insertionPoint) {
        dbEntity.dimBlockPosition = { ...entity.insertionPoint, z: 0 }
      }
      dbEntity.rotation = AcGeMathUtil.degToRad(entity.rotationAngle || 0)
      this.processDimensionCommonAttrs(dimension, dbEntity)
      return dbEntity
    } else if (dimension.subclassMarker == 'AcDbRotatedDimension') {
      const entity = dimension as AlignedDimensionEntity
      const dbEntity = new AcDbRotatedDimension(
        entity.subDefinitionPoint1,
        entity.subDefinitionPoint2,
        entity.definitionPoint
      )
      if (entity.insertionPoint) {
        dbEntity.dimBlockPosition = { ...entity.insertionPoint, z: 0 }
      }
      dbEntity.rotation = AcGeMathUtil.degToRad(entity.rotationAngle || 0)
      this.processDimensionCommonAttrs(dimension, dbEntity)
      return dbEntity
    } else if (dimension.subclassMarker == 'AcDb3PointAngularDimension') {
      const entity = dimension as AngularDimensionEntity
      const dbEntity = new AcDb3PointAngularDimension(
        entity.centerPoint,
        entity.subDefinitionPoint1,
        entity.subDefinitionPoint2,
        entity.definitionPoint
      )
      this.processDimensionCommonAttrs(dimension, dbEntity)
      return dbEntity
    } else if (dimension.subclassMarker == 'AcDb2LineAngularDimension') {
      const entity = dimension as AngularDimensionEntity
      const centerPoint =
        entity.centerPoint ??
        entity.subDefinitionPoint2 ??
        entity.definitionPoint
      const arcPoint = entity.definitionPoint ?? entity.subDefinitionPoint2
      if (
        !centerPoint ||
        !entity.subDefinitionPoint1 ||
        !entity.subDefinitionPoint2 ||
        !arcPoint
      ) {
        return null
      }
      const dbEntity = new AcDb3PointAngularDimension(
        centerPoint,
        entity.subDefinitionPoint1,
        entity.subDefinitionPoint2,
        arcPoint
      )
      this.processDimensionCommonAttrs(dimension, dbEntity)
      return dbEntity
    } else if (dimension.subclassMarker == 'AcDbOrdinateDimension') {
      const entity = dimension as OrdinateDimensionEntity
      const dbEntity = new AcDbOrdinateDimension(
        entity.subDefinitionPoint1,
        entity.subDefinitionPoint2
      )
      this.processDimensionCommonAttrs(dimension, dbEntity)
      return dbEntity
    } else if (dimension.subclassMarker == 'AcDbRadialDimension') {
      const entity = dimension as RadialDiameterDimensionEntity
      const dbEntity = new AcDbRadialDimension(
        entity.definitionPoint,
        entity.subDefinitionPoint,
        entity.leaderLength
      )
      this.processDimensionCommonAttrs(dimension, dbEntity)
      return dbEntity
    } else if (dimension.subclassMarker == 'AcDbDiametricDimension') {
      const entity = dimension as RadialDiameterDimensionEntity
      const dbEntity = new AcDbDiametricDimension(
        entity.definitionPoint,
        entity.subDefinitionPoint,
        entity.leaderLength
      )
      this.processDimensionCommonAttrs(dimension, dbEntity)
      return dbEntity
    }
    return null
  }

  private processImage(image: ImageEntity, dbImage: AcDbRasterImage) {
    dbImage.position.copy(image.position)
    dbImage.brightness = image.brightness
    dbImage.contrast = image.contrast
    dbImage.fade = image.fade
    dbImage.imageSize.copy(image.imageSize)

    dbImage.isShownClipped = (image.flags | 0x0004) > 0
    dbImage.isImageShown = (image.flags | 0x0003) > 0
    dbImage.isImageTransparent = (image.flags | 0x0008) > 0
    dbImage.imageDefId = image.imageDefHandle
    dbImage.isClipped = image.isClipped
    image.clippingBoundaryPath.forEach(point => {
      dbImage.clipBoundary.push(new AcGePoint2d(point))
    })

    // Calculate the scale factors
    dbImage.width =
      Math.sqrt(
        image.uPixel.x ** 2 + image.uPixel.y ** 2 + image.uPixel.z ** 2
      ) * image.imageSize.x
    dbImage.height =
      Math.sqrt(
        image.vPixel.x ** 2 + image.vPixel.y ** 2 + image.vPixel.z ** 2
      ) * image.imageSize.y

    // Calculate the rotation angle
    // Rotation is determined by the angle of the U-vector relative to the X-axis
    dbImage.rotation = Math.atan2(image.uPixel.y, image.uPixel.x)
  }

  private convertImage(image: ImageEntity) {
    const dbImage = new AcDbRasterImage()
    this.processImage(image, dbImage)
    dbImage.clipBoundaryType =
      image.clippingBoundaryType as unknown as AcDbRasterImageClipBoundaryType
    return dbImage
  }

  private processWipeout(wipeout: WipeoutEntity, dbWipeout: AcDbWipeout) {
    dbWipeout.position.copy(wipeout.position)
    dbWipeout.brightness = wipeout.brightness
    dbWipeout.contrast = wipeout.contrast
    dbWipeout.fade = wipeout.fade
    dbWipeout.imageSize.copy(wipeout.imageSize)

    dbWipeout.isShownClipped = (wipeout.displayFlag | 0x0004) > 0
    dbWipeout.isImageShown = (wipeout.displayFlag | 0x0003) > 0
    dbWipeout.isImageTransparent = (wipeout.displayFlag | 0x0008) > 0
    dbWipeout.imageDefId = wipeout.imageDefHardId
    dbWipeout.isClipped = wipeout.isClipping
    wipeout.boundary.forEach(point => {
      dbWipeout.clipBoundary.push(new AcGePoint2d(point))
    })
    dbWipeout.clipBoundaryType =
      wipeout.boundaryType as unknown as AcDbRasterImageClipBoundaryType

    // Calculate the scale factors
    dbWipeout.width =
      Math.sqrt(
        wipeout.uDirection.x ** 2 +
          wipeout.uDirection.y ** 2 +
          wipeout.uDirection.z ** 2
      ) * wipeout.imageSize.x
    dbWipeout.height =
      Math.sqrt(
        wipeout.vDirection.x ** 2 +
          wipeout.vDirection.y ** 2 +
          wipeout.vDirection.z ** 2
      ) * wipeout.imageSize.y

    // Calculate the rotation angle
    // Rotation is determined by the angle of the U-vector relative to the X-axis
    dbWipeout.rotation = Math.atan2(wipeout.uDirection.y, wipeout.uDirection.x)
  }

  private convertWipeout(wipeout: WipeoutEntity) {
    const dbWipeout = new AcDbWipeout()
    this.processWipeout(wipeout, dbWipeout)
    return dbWipeout
  }

  private convertViewport(viewport: ViewportEntity) {
    const dbViewport = new AcDbViewport()
    dbViewport.number = viewport.viewportId
    dbViewport.centerPoint.copy(viewport.viewportCenter)
    dbViewport.height = viewport.height
    dbViewport.width = viewport.width
    dbViewport.viewCenter.copy(viewport.displayCenter)
    dbViewport.viewHeight = viewport.viewHeight
    return dbViewport
  }

  private convertRay(ray: RayEntity) {
    const dbRay = new AcDbRay()
    dbRay.basePoint.copy(ray.position)
    dbRay.unitDir.copy(ray.direction)
    return dbRay
  }

  private convertXline(xline: XLineEntity) {
    const dbXline = new AcDbXline()
    dbXline.basePoint.copy(xline.position)
    dbXline.unitDir.copy(xline.direction)
    return dbXline
  }

  private convertBlockReference(blockReference: InsertEntity) {
    const dbBlockReference = new AcDbBlockReference(blockReference.name)
    if (blockReference.insertionPoint)
      dbBlockReference.position.copy(blockReference.insertionPoint)
    dbBlockReference.scaleFactors.x = blockReference.xScale || 1
    dbBlockReference.scaleFactors.y = blockReference.yScale || 1
    dbBlockReference.scaleFactors.z = blockReference.zScale || 1
    dbBlockReference.rotation =
      blockReference.rotation != null
        ? AcGeMathUtil.degToRad(blockReference.rotation)
        : 0
    dbBlockReference.normal.copy(
      blockReference.extrusionDirection ?? { x: 0, y: 0, z: 1 }
    )
    return dbBlockReference
  }

  private processDimensionCommonAttrs(
    entity: DimensionEntityCommon,
    dbEntity: AcDbDimension
  ) {
    dbEntity.dimBlockId = entity.name
    dbEntity.textPosition.copy(entity.textPoint)
    dbEntity.textRotation = entity.textRotation || 0
    if (entity.textLineSpacingFactor) {
      dbEntity.textLineSpacingFactor = entity.textLineSpacingFactor
    }
    if (entity.textLineSpacingStyle) {
      dbEntity.textLineSpacingStyle =
        entity.textLineSpacingStyle as unknown as AcDbLineSpacingStyle
    }
    dbEntity.dimensionStyleName = entity.styleName
    dbEntity.dimensionText = entity.text || ''
    dbEntity.measurement = entity.measurement
    dbEntity.normal.copy(entity.extrusionDirection ?? { x: 0, y: 0, z: 1 })
  }

  /**
   * Processes common attributes from a DXF entity to an AcDbEntity.
   *
   * This method copies common properties like layer, object ID, owner ID,
   * linetype, lineweight, color, visibility, and transparency from the
   * DXF entity to the corresponding AcDbEntity.
   *
   * @param entity - The source DXF entity
   * @param dbEntity - The target AcDbEntity to populate
   *
   * @example
   * ```typescript
   * converter.processCommonAttrs(dxfEntity, acDbEntity);
   * ```
   */
  private processCommonAttrs(entity: CommonDxfEntity, dbEntity: AcDbEntity) {
    dbEntity.layer = entity.layer || '0'
    // I found some dxf file may have entity without handle. If so, let's use objectId
    // created by AcDbObject constructor instead.
    if (entity.handle) dbEntity.objectId = entity.handle.toString()
    dbEntity.ownerId = entity.ownerBlockRecordSoftId || ''
    if (entity.lineType != null) {
      dbEntity.lineType = entity.lineType
    }
    if (entity.lineweight != null) {
      dbEntity.lineWeight = entity.lineweight
    }
    if (entity.lineTypeScale != null) {
      dbEntity.linetypeScale = entity.lineTypeScale
    }
    // Build the entity color in a fresh AcCmColor and assign it via the
    // setter. The previous pattern (`dbEntity.color.<prop> = ??) read the
    // getter and mutated the result, which works for entities whose getter
    // returns the cached `_color` field but breaks for entities like
    // AcDbHatch that override the getter to return a clone of an HPCOLOR /
    // CECOLOR fallback (PR #78). Mutations on a clone are dropped, leaving
    // the entity stuck on the sysvar default and losing the DXF's RGB.
    if (entity.color != null || entity.colorIndex != null || entity.colorName) {
      const color = new AcCmColor()
      if (entity.color != null) {
        color.setRGBValue(entity.color)
      }
      if (entity.colorIndex != null) {
        color.colorIndex = entity.colorIndex
      }
      if (entity.colorName) {
        color.colorName = entity.colorName
      }
      dbEntity.color = color
    }
    if (entity.isVisible != null) {
      // DXF group code 60 uses 0 => visible, 1 => invisible.
      // dxf-json parses it with a generic boolean converter, so here:
      // - false means 0 (visible)
      // - true means 1 (invisible)
      dbEntity.visibility = !entity.isVisible
    }
    if (entity.transparency != null) {
      dbEntity.transparency = AcCmTransparency.deserialize(entity.transparency)
    }
  }

  private isValidHandleId(id: string | undefined): id is string {
    return id != null && id !== '' && id !== '0'
  }

  private readNumber(source: Record<string, unknown>, names: string[]) {
    for (const name of names) {
      const value = source[name]
      if (typeof value === 'number' && Number.isFinite(value)) return value
    }
    return undefined
  }

  private readPositiveNumber(source: Record<string, unknown>, names: string[]) {
    const value = this.readNumber(source, names)
    return value != null && value > 0 ? value : undefined
  }

  private readString(source: Record<string, unknown>, names: string[]) {
    for (const name of names) {
      const value = source[name]
      if (typeof value === 'string') return value
    }
    return undefined
  }

  private readBoolean(source: Record<string, unknown>, names: string[]) {
    for (const name of names) {
      const value = source[name]
      if (typeof value === 'boolean') return value
      if (typeof value === 'number') return value !== 0
    }
    return undefined
  }

  private readPoint(source: Record<string, unknown>, names: string[]) {
    for (const name of names) {
      const value = source[name]
      if (this.isPointLike(value)) return value
      if (
        Array.isArray(value) &&
        typeof value[0] === 'number' &&
        typeof value[1] === 'number'
      ) {
        return { x: value[0], y: value[1], z: value[2] ?? 0 }
      }
    }
    return undefined
  }

  private readLeaderLineArray(source: Record<string, unknown>) {
    const leaderLines = source.leaderLines
    if (Array.isArray(leaderLines)) {
      return leaderLines
        .map(line => {
          if (!line || typeof line !== 'object') return undefined
          const vertices = (line as Record<string, unknown>).vertices
          return Array.isArray(vertices)
            ? vertices.filter(point => this.isPointLike(point))
            : undefined
        })
        .filter((line): line is AcGePoint3dLike[] => !!line && line.length > 0)
    }

    const vertices = source.vertices
    if (Array.isArray(vertices)) {
      const line = vertices.filter(point => this.isPointLike(point))
      return line.length > 0 ? [line] : undefined
    }
    return undefined
  }

  private readMLeaderLeaders(
    source: Record<string, unknown>
  ): ParsedMLeaderLeader[] | undefined {
    const leaders = source.leaderSections
    if (!Array.isArray(leaders)) return undefined

    const dbLeaders: ParsedMLeaderLeader[] = []
    leaders.forEach(leader => {
      if (!leader || typeof leader !== 'object') return
      const leaderRecord = leader as Record<string, unknown>
      const leaderLines = leaderRecord.leaderLines
      const lines: ParsedMLeaderLine[] | undefined = Array.isArray(leaderLines)
        ? leaderLines.reduce<ParsedMLeaderLine[]>((result, line) => {
            const dbLine = this.readMLeaderLine(line)
            if (dbLine) result.push(dbLine)
            return result
          }, [])
        : undefined

      const dbLeader: ParsedMLeaderLeader = {}
      const lastLeaderLinePoint = this.readPoint(leaderRecord, [
        'lastLeaderLinePoint'
      ])
      const doglegVector = this.readPoint(leaderRecord, ['doglegVector'])
      const doglegLength = this.readNumber(leaderRecord, ['doglegLength'])
      const leaderBreaks = this.readMLeaderBreaks(leaderRecord.breaks)
      const leaderBranchIndex = this.readNumber(leaderRecord, [
        'leaderBranchIndex'
      ])
      if (lastLeaderLinePoint)
        dbLeader.lastLeaderLinePoint = lastLeaderLinePoint
      if (leaderRecord.lastLeaderLinePointSet != null) {
        dbLeader.lastLeaderLinePointSet = this.readBoolean(leaderRecord, [
          'lastLeaderLinePointSet'
        ])
      }
      if (doglegVector) dbLeader.doglegVector = doglegVector
      if (leaderRecord.doglegVectorSet != null) {
        dbLeader.doglegVectorSet = this.readBoolean(leaderRecord, [
          'doglegVectorSet'
        ])
      }
      if (doglegLength != null) dbLeader.doglegLength = doglegLength
      if (leaderBreaks) dbLeader.breaks = leaderBreaks
      if (leaderBranchIndex != null) {
        dbLeader.leaderBranchIndex = leaderBranchIndex
      }
      if (lines) dbLeader.leaderLines = lines
      dbLeaders.push(dbLeader)
    })
    return dbLeaders
  }

  private readMLeaderLine(value: unknown): ParsedMLeaderLine | undefined {
    if (!value || typeof value !== 'object') return undefined
    const lineRecord = value as Record<string, unknown>
    const vertices = lineRecord.vertices
    const dbVertices = Array.isArray(vertices)
      ? vertices.filter(point => this.isPointLike(point))
      : []

    const dbBreaks = this.readMLeaderBreaks(lineRecord.breaks)
    const breakPointIndexes = Array.isArray(lineRecord.breakPointIndexes)
      ? lineRecord.breakPointIndexes.filter(
          (item): item is number => typeof item === 'number'
        )
      : undefined
    const leaderLineIndex = this.readNumber(lineRecord, ['leaderLineIndex'])

    return dbVertices.length > 0 || (dbBreaks && dbBreaks.length > 0)
      ? {
          vertices: dbVertices,
          breakPointIndexes,
          leaderLineIndex,
          breaks: dbBreaks
        }
      : undefined
  }

  private readMLeaderBreaks(value: unknown): ParsedMLeaderBreak[] | undefined {
    if (!Array.isArray(value)) return undefined

    const breaks = value
      .map((item): ParsedMLeaderBreak | undefined => {
        if (!item || typeof item !== 'object') return undefined
        const breakRecord = item as Record<string, unknown>
        const start = this.readPoint(breakRecord, ['start'])
        const end = this.readPoint(breakRecord, ['end'])
        const index = this.readNumber(breakRecord, ['index'])
        if (!start || !end) return undefined
        const parsed: ParsedMLeaderBreak = { start, end }
        if (index != null) parsed.index = index
        return parsed
      })
      .filter((item): item is ParsedMLeaderBreak => !!item)

    return breaks.length > 0 ? breaks : undefined
  }

  private isPointLike(value: unknown): value is AcGePoint3dLike {
    return (
      !!value &&
      typeof value === 'object' &&
      typeof (value as AcGePoint3dLike).x === 'number' &&
      typeof (value as AcGePoint3dLike).y === 'number'
    )
  }
}