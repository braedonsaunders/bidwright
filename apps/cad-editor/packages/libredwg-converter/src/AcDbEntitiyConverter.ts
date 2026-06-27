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
import type {
  Dwg3dFaceEntity,
  DwgAlignedDimensionEntity,
  DwgAngularDimensionEntity,
  DwgArcEdge,
  DwgArcEntity,
  DwgAttdefEntity,
  DwgAttribEntity,
  DwgBoundaryPathEdge,
  DwgCircleEntity,
  DwgDimensionEntityCommon,
  DwgEdgeBoundaryPath,
  DwgEllipseEdge,
  DwgEllipseEntity,
  DwgEntity,
  DwgGradientHatchEntity,
  DwgHatchEntity,
  DwgImageEntity,
  DwgInsertEntity,
  DwgLeaderEntity,
  DwgLineEdge,
  DwgLineEntity,
  DwgLWPolylineEntity,
  DwgMLineEntity,
  DwgMTextEntity,
  DwgMultiLeaderEntity,
  DwgOrdinateDimensionEntity,
  DwgPointEntity,
  DwgPolyline2dEntity,
  DwgPolyline3dEntity,
  DwgPolylineBoundaryPath,
  DwgProxyEntity,
  DwgRadialDiameterDimensionEntity,
  DwgRayEntity,
  DwgShapeEntity,
  DwgSolidEntity,
  DwgSplineEdge,
  DwgSplineEntity,
  DwgTableEntity,
  DwgTextEntity,
  DwgViewportEntity,
  DwgWipeoutEntity,
  DwgXlineEntity
} from '@mlightcad/libredwg-web'

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

export class AcDbEntityConverter {
  convert(entity: DwgEntity): AcDbEntity | null {
    const dbEntity = this.createEntity(entity)
    if (dbEntity) {
      this.processCommonAttrs(entity, dbEntity)
    }
    return dbEntity
  }

  /**
   * Create the corresponding drawing database entity from data in dxf format
   * @param entity Input entity data in dxf format
   * @returns Return the converted drawing database entity
   */
  private createEntity(entity: DwgEntity): AcDbEntity | null {
    if (entity.type == '3DFACE') {
      return this.convertFace(entity as Dwg3dFaceEntity)
    } else if (entity.type == 'ARC') {
      return this.convertArc(entity as DwgArcEntity)
    } else if (entity.type == 'ATTDEF') {
      return this.convertAttributeDefinition(entity as DwgAttdefEntity)
    } else if (entity.type == 'ATTRIB') {
      return this.convertAttribute(entity as DwgAttribEntity)
    } else if (entity.type == 'CIRCLE') {
      return this.convertCirle(entity as DwgCircleEntity)
    } else if (entity.type == 'DIMENSION') {
      return this.convertDimension(entity as DwgDimensionEntityCommon)
    } else if (entity.type == 'ELLIPSE') {
      return this.convertEllipse(entity as DwgEllipseEntity)
    } else if (entity.type == 'HATCH') {
      return this.convertHatch(entity as DwgHatchEntity)
    } else if (entity.type == 'IMAGE') {
      return this.convertImage(entity as DwgImageEntity)
    } else if (entity.type == 'LEADER') {
      return this.convertLeader(entity as DwgLeaderEntity)
    } else if (entity.type == 'LINE') {
      return this.convertLine(entity as DwgLineEntity)
    } else if (entity.type == 'LWPOLYLINE') {
      return this.convertLWPolyline(entity as DwgLWPolylineEntity)
    } else if (entity.type == 'MLINE') {
      return this.convertMLine(entity as DwgMLineEntity)
    } else if (entity.type == 'MTEXT') {
      return this.convertMText(entity as DwgMTextEntity)
    } else if (entity.type == 'MULTILEADER' || entity.type == 'MLEADER') {
      return this.convertMLeader(entity as DwgMultiLeaderEntity)
    } else if (entity.type == 'POINT') {
      return this.convertPoint(entity as DwgPointEntity)
    } else if (entity.type == 'POLYLINE2D') {
      return this.convertPolyline2d(entity as DwgPolyline2dEntity)
    } else if (entity.type == 'POLYLINE3D') {
      return this.convertPolyline3d(entity as DwgPolyline3dEntity)
    } else if (entity.type == 'RAY') {
      return this.convertRay(entity as DwgRayEntity)
    } else if (entity.type == 'SPLINE') {
      return this.convertSpline(entity as DwgSplineEntity)
    } else if (entity.type == 'ACAD_TABLE') {
      return this.convertTable(entity as DwgTableEntity)
    } else if (entity.type == 'TEXT') {
      return this.convertText(entity as DwgTextEntity)
    } else if (entity.type == 'SHAPE') {
      return this.convertShape(entity as DwgShapeEntity)
    } else if (entity.type == 'SOLID') {
      return this.convertSolid(entity as DwgSolidEntity)
    } else if (entity.type == 'VIEWPORT') {
      return this.convertViewport(entity as DwgViewportEntity)
    } else if (entity.type == 'WIPEOUT') {
      return this.convertWipeout(entity as DwgWipeoutEntity)
    } else if (entity.type == 'XLINE') {
      return this.convertXline(entity as DwgXlineEntity)
    } else if (entity.type == 'INSERT') {
      return this.convertBlockReference(entity as DwgInsertEntity)
    } else if (entity.type == 'ACAD_PROXY_ENTITY') {
      return this.convertProxyEntity(entity as DwgProxyEntity)
    }
    return null
  }

  /**
   * Converts a DWG ACAD_PROXY_ENTITY to an AcDbProxyEntity.
   */
  private convertProxyEntity(entity: DwgProxyEntity): AcDbProxyEntity {
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

  private convertFace(face: Dwg3dFaceEntity) {
    const dbEntity = new AcDbFace()
    if (face.corner1) dbEntity.setVertexAt(0, face.corner1)
    if (face.corner2) dbEntity.setVertexAt(1, face.corner2)
    if (face.corner3) dbEntity.setVertexAt(2, face.corner3)
    if (face.corner4) dbEntity.setVertexAt(3, face.corner4)
    dbEntity.setEdgeInvisibilities(face.flag)
    return dbEntity
  }

  private convertArc(arc: DwgArcEntity) {
    const normal = arc.extrusionDirection ?? AcGeVector3d.Z_AXIS
    const dbEntity = new AcDbArc(
      transformOcsPointToWcs(arc.center, normal),
      arc.radius,
      arc.startAngle,
      arc.endAngle,
      normal
    )
    return dbEntity
  }

  private convertCirle(circle: DwgCircleEntity) {
    const normal = circle.extrusionDirection ?? AcGeVector3d.Z_AXIS
    const dbEntity = new AcDbCircle(
      transformOcsPointToWcs(circle.center, normal),
      circle.radius,
      normal
    )
    return dbEntity
  }

  private convertEllipse(ellipse: DwgEllipseEntity) {
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

  private convertLine(line: DwgLineEntity) {
    const start = line.startPoint
    const end = line.endPoint
    const dbEntity = new AcDbLine(
      new AcGePoint3d(start.x, start.y, start.z),
      new AcGePoint3d(end.x, end.y, end.z)
    )
    return dbEntity
  }

  private convertSpline(spline: DwgSplineEntity) {
    // One invalid spline must not interrupt block conversion.
    return AcDbSpline.fromDwgSpline(spline)
  }

  private convertPoint(point: DwgPointEntity) {
    const dbEntity = new AcDbPoint()
    dbEntity.position = point.position
    return dbEntity
  }

  private convertShape(shape: DwgShapeEntity) {
    const normal = shape.extrusionDirection ?? AcGeVector3d.Z_AXIS
    const dbEntity = new AcDbShape()
    dbEntity.position = transformOcsPointToWcs(shape.insertionPoint, normal)
    dbEntity.size = shape.size
    dbEntity.shapeNumber = shape.shapeNumber
    if (shape.styleName) {
      dbEntity.styleName = shape.styleName
    }
    dbEntity.rotation = shape.rotation ?? 0
    dbEntity.widthFactor = shape.xScale ?? 1
    dbEntity.oblique = shape.obliqueAngle ?? 0
    dbEntity.thickness = shape.thickness ?? 0
    dbEntity.normal.copy(normal)
    return dbEntity
  }

  private convertSolid(solid: DwgSolidEntity) {
    const dbEntity = new AcDbTrace()
    dbEntity.setPointAt(0, { ...solid.corner1, z: 0 })
    dbEntity.setPointAt(1, { ...solid.corner2, z: 0 })
    dbEntity.setPointAt(2, { ...solid.corner3, z: 0 })
    dbEntity.setPointAt(
      3,
      solid.corner4 ? { ...solid.corner4, z: 0 } : { ...solid.corner3, z: 0 }
    )
    dbEntity.thickness = solid.thickness
    return dbEntity
  }

  private convertLWPolyline(polyline: DwgLWPolylineEntity) {
    // Libredwg changes meaning of the 'flag' field. '512' means closed.
    const dbEntity = new AcDbPolyline()
    dbEntity.closed = !!(polyline.flag & 0x200)
    const defaultWidth = polyline.constantWidth ?? -1
    polyline.vertices.forEach((vertex, index) => {
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

  private convertPolyline2d(polyline: DwgPolyline2dEntity) {
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
    const isPolygonMesh = !!(polyline.flag & 0x10) // 16
    const isPolyfaceMesh = !!(polyline.flag & 0x40) // 64
    const isClosedN = !!(polyline.flag & 0x20) // 32

    // Filter out spline control points
    const vertices: AcGePoint3dLike[] = []
    const bulges: number[] = []
    const faces: number[][] = []
    polyline.vertices.map(vertex => {
      // Check whether it is one spline control point
      if (!(vertex.flag & 0x10)) {
        // For polyface mesh, vertex flag 128 bit is set for all vertices
        if (isPolyfaceMesh && vertex.flag & 0x80) {
          // 128 bit set
          // Check if this is a face vertex (64 bit not set)
          if (!(vertex.flag & 0x40)) {
            // 64 bit not set
            // This is a face vertex
            const faceVertices: number[] = []
            // If the index is negative, the edge that begins with that vertex is invisible.
            // The first 0 vertex marks the end of the vertices of the face.
            if (vertex.polyfaceIndex0 != null && vertex.polyfaceIndex0 != 0)
              faceVertices.push(Math.abs(vertex.polyfaceIndex0) - 1)
            if (vertex.polyfaceIndex1 != null && vertex.polyfaceIndex1 != 0)
              faceVertices.push(Math.abs(vertex.polyfaceIndex1) - 1)
            if (vertex.polyfaceIndex2 != null && vertex.polyfaceIndex2 != 0)
              faceVertices.push(Math.abs(vertex.polyfaceIndex2) - 1)
            if (vertex.polyfaceIndex3 != null && vertex.polyfaceIndex3 != 0)
              faceVertices.push(Math.abs(vertex.polyfaceIndex3) - 1)
            if (faceVertices.length >= 3) {
              faces.push(faceVertices)
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
      const mCount = polyline.meshMVertexCount ?? 2
      const nCount = polyline.meshNVertexCount ?? 2
      return new AcDbPolygonMesh(mCount, nCount, vertices, isClosed, isClosedN)
    } else if (isPolyfaceMesh) {
      return new AcDbPolyFaceMesh(vertices, faces)
    } else {
      let polyType = AcDbPoly2dType.SimplePoly
      if (polyline.flag & 0x02) {
        polyType = AcDbPoly2dType.FitCurvePoly
      } else if (polyline.flag & 0x04) {
        // Please don't use enum DwgSmoothType value here.
        // It will result in libredwg-web bundled in this package.
        if (polyline.smoothType == 6) {
          // DwgSmoothType.CUBIC
          polyType = AcDbPoly2dType.CubicSplinePoly
        } else if (polyline.smoothType == 5) {
          // DwgSmoothType.QUADRATIC
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

  private convertPolyline3d(polyline: DwgPolyline3dEntity) {
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

    // Filter out spline control points
    const vertices: AcGePoint3dLike[] = []
    polyline.vertices.map(vertex => {
      // Check whether it is one spline control point
      if (!(vertex.flag & 0x10)) {
        vertices.push({
          x: vertex.x,
          y: vertex.y,
          z: vertex.z
        })
      }
    })

    let polyType = AcDbPoly3dType.SimplePoly
    if (polyline.flag & 0x04) {
      // Please don't use enum DwgSmoothType value here.
      // It will result in libredwg-web bundled in this package.
      if (polyline.smoothType == 6) {
        // DwgSmoothType.CUBIC
        polyType = AcDbPoly3dType.CubicSplinePoly
      } else if (polyline.smoothType == 5) {
        // DwgSmoothType.QUADRATIC
        polyType = AcDbPoly3dType.QuadSplinePoly
      }
    }
    return new AcDb3dPolyline(polyType, vertices, isClosed)
  }

  private convertHatch(hatch: DwgHatchEntity) {
    const dbEntity = new AcDbHatch()

    hatch.definitionLines?.forEach(item => {
      dbEntity.definitionLines.push({
        angle: item.angle,
        base: item.base,
        offset: item.offset,
        dashLengths: item.numberOfDashLengths > 0 ? item.dashLengths : []
      })
    })
    // Important: Don't use DwgHatchSolidFill.SolidFill to avoid bundling libredwg-web into libredeg-converter
    dbEntity.isSolidFill = hatch.solidFill == 1
    dbEntity.hatchStyle = hatch.hatchStyle as unknown as AcDbHatchStyle
    dbEntity.patternName = hatch.patternName
    dbEntity.patternType = hatch.patternType as unknown as AcDbHatchPatternType
    dbEntity.patternAngle = hatch.patternAngle == null ? 0 : hatch.patternAngle
    dbEntity.patternScale = hatch.patternScale == null ? 0 : hatch.patternScale

    const paths = hatch.boundaryPaths
    paths.forEach(path => {
      const flag = path.boundaryPathTypeFlag
      // Check whether it is a polyline
      if (flag & 0x02) {
        const polylinePath = path as DwgPolylineBoundaryPath
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
        const edgePath = path as DwgEdgeBoundaryPath<DwgBoundaryPathEdge>
        const edges: AcGeBoundaryEdgeType[] = []
        edgePath.edges.forEach(edge => {
          // TODO: It seems there are some issue on libredwg. Sometimes 'undefined' edges are added.
          if (edge == null) return
          if (edge.type == 1) {
            const line = edge as DwgLineEdge
            edges.push(new AcGeLine2d(line.start, line.end))
          } else if (edge.type == 2) {
            const arc = edge as DwgArcEdge
            edges.push(
              new AcGeCircArc2d(
                arc.center,
                arc.radius,
                arc.startAngle,
                arc.endAngle,
                !arc.isCCW
              )
            )
          } else if (edge.type == 3) {
            const ellipse = edge as DwgEllipseEdge
            const majorAxis = new AcGeVector2d()
            majorAxis.subVectors(ellipse.end, ellipse.center)
            const majorAxisRadius = Math.sqrt(
              Math.pow(ellipse.end.x, 2) + Math.pow(ellipse.end.y, 2)
            )
            // Property name 'lengthOfMinorAxis' is really confusing.
            // Actually length of minor axis means percentage of major axis length.
            const minorAxisRadius = majorAxisRadius * ellipse.lengthOfMinorAxis
            let startAngle = ellipse.startAngle
            let endAngle = ellipse.endAngle
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
              edge as DwgSplineEdge
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
      const gradientHatch = hatch as DwgGradientHatchEntity
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

  private convertTable(table: DwgTableEntity) {
    const dbEntity = new AcDbTable(
      table.name,
      table.rowCount,
      table.columnCount
    )
    // dbEntity.tableDataVersion = table.version
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

  private convertText(text: DwgTextEntity) {
    const dbEntity = new AcDbText()
    dbEntity.textString = text.text
    dbEntity.styleName = text.styleName
    dbEntity.height = text.textHeight
    dbEntity.position.copy(text.startPoint)
    // Propagate DXF group 11 (alignment point) so non-default justifications
    // place the text correctly. `endPoint` is libredwg's name for the
    // alignment point on a TEXT entity. Fall back to startPoint when group
    // 11 is missing or surfaces as the zero point ??see comment in
    // `convertAttributeCommon`.
    const isEndPointZero =
      !text.endPoint ||
      (text.endPoint.x === 0 &&
        text.endPoint.y === 0 &&
        ((text.endPoint as { z?: number }).z ?? 0) === 0)
    if (text.endPoint && !isEndPointZero) {
      dbEntity.alignmentPoint.copy(text.endPoint)
    } else {
      dbEntity.alignmentPoint.copy(text.startPoint)
    }
    dbEntity.rotation = text.rotation
    dbEntity.oblique = text.obliqueAngle ?? 0
    dbEntity.thickness = text.thickness
    dbEntity.horizontalMode = text.halign as unknown as AcDbTextHorizontalMode
    dbEntity.verticalMode = text.valign as unknown as AcDbTextVerticalMode
    dbEntity.widthFactor = text.xScale ?? 1
    return dbEntity
  }

  private convertMText(mtext: DwgMTextEntity) {
    const dbEntity = new AcDbMText()
    dbEntity.contents = mtext.text
    if (mtext.styleName != null) {
      dbEntity.styleName = mtext.styleName
    }
    dbEntity.height = mtext.textHeight
    dbEntity.width = mtext.rectWidth
    dbEntity.rotation = mtext.rotation || 0
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

  private convertLeader(leader: DwgLeaderEntity) {
    const dbEntity = new AcDbLeader()
    leader.vertices.forEach(point => {
      dbEntity.appendVertex(point)
    })
    dbEntity.hasArrowHead = leader.isArrowheadEnabled
    dbEntity.hasHookLine = leader.isHooklineExists
    dbEntity.isSplined = leader.isSpline
    dbEntity.dimensionStyle = leader.styleName
    dbEntity.annoType =
      leader.leaderCreationFlag as unknown as AcDbLeaderAnnotationType
    return dbEntity
  }

  private convertMLine(mline: DwgMLineEntity) {
    const dbEntity = new AcDbMLine()

    dbEntity.styleName = mline.mlineStyle || 'STANDARD'
    dbEntity.scale = mline.scale
    dbEntity.flags = mline.flags
    dbEntity.justification =
      mline.justification as unknown as AcDbMLineJustification
    dbEntity.startPosition = mline.startPoint
    dbEntity.normal = mline.extrusionDirection ?? AcGeVector3d.Z_AXIS
    dbEntity.styleCount = mline.numberOfLines ?? 0

    dbEntity.segments = (mline.vertices ?? []).map(vertex => ({
      position: vertex.vertex,
      direction: vertex.vertexDirection,
      miterDirection: vertex.miterDirection,
      elements: (vertex.lines ?? []).map(line => ({
        parameterCount: line.numberOfSegmentParams,
        parameters: line.segmentParams ?? [],
        fillCount: line.numberOfAreaFillParams,
        fillParameters: line.areaFillParams ?? []
      }))
    }))

    return dbEntity
  }

  private convertMLeader(mleader: DwgMultiLeaderEntity) {
    const dbEntity = new AcDbMLeader()
    const raw = mleader as DwgMultiLeaderEntity & Record<string, unknown>

    dbEntity.version = mleader.version
    dbEntity.leaderStyleId = mleader.leaderStyleId
    if (mleader.leaderStyleId) dbEntity.mleaderStyleId = mleader.leaderStyleId
    dbEntity.propertyOverrideFlag = mleader.propertyOverrideFlag
    dbEntity.leaderLineType = (mleader.leaderLineType ??
      AcDbMLeaderLineType.StraightLeader) as AcDbMLeaderLineType
    if (mleader.leaderLineColor != null) {
      dbEntity.leaderLineColor = this.convertMLeaderEntityColor(
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
      dbEntity.textColor = this.convertMLeaderEntityColor(mleader.textColor)
    }
    dbEntity.textFrameEnabled = mleader.textFrameEnabled
    dbEntity.landingGap = mleader.landingGap
    dbEntity.textAttachment = mleader.textAttachment
    dbEntity.textFlowDirection = mleader.textFlowDirection
    if (this.isValidHandleId(mleader.blockContentId)) {
      dbEntity.blockContentId = mleader.blockContentId
    }
    if (mleader.blockContentColor != null) {
      dbEntity.blockContentColor = this.convertMLeaderEntityColor(
        mleader.blockContentColor
      )
    }
    dbEntity.blockContentRotation = mleader.blockContentRotation
    dbEntity.blockContentConnectionType = mleader.blockContentConnectionType
    dbEntity.annotativeScaleEnabled = mleader.annotativeScaleEnabled
    dbEntity.arrowheadOverrides = mleader.arrowheadOverrides
      ? mleader.arrowheadOverrides.map(
          (item: { index: number; handle: string }) => ({ ...item })
        )
      : []
    dbEntity.blockAttributes = mleader.blockAttributes
      ? mleader.blockAttributes.map(
          (item: {
            id?: string
            index?: number
            width?: number
            text?: string
          }) => ({ ...item })
        )
      : []
    dbEntity.textDirectionNegative = mleader.textDirectionNegative
    dbEntity.textAlignInIPE = mleader.textAlignInIPE
    dbEntity.bottomTextAttachmentDirection =
      mleader.bottomTextAttachmentDirection
    dbEntity.topTextAttachmentDirection = mleader.topTextAttachmentDirection
    dbEntity.contentScale = mleader.contentScale
    dbEntity.textLineSpacingStyle = mleader.textLineSpacingStyle
    if (mleader.textBackgroundColor != null) {
      dbEntity.textBackgroundColor = this.convertMLeaderEntityColor(
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
      dbEntity.textRotation = textRotation
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
        const rawBlockColor = this.readMLeaderEntityColor(blockRecord, [
          'color'
        ])
        dbEntity.blockContent = {
          blockContentId,
          normal: this.readPoint(blockRecord, ['normal']),
          position: mleader.blockContent.position,
          scale: this.readPoint(blockRecord, ['scale']),
          rotation: this.readNumber(blockRecord, ['rotation']),
          color: rawBlockColor,
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

  private convertDimension(dimension: DwgDimensionEntityCommon) {
    if (dimension.subclassMarker == 'AcDbAlignedDimension') {
      const entity = dimension as DwgAlignedDimensionEntity
      const dbEntity = new AcDbAlignedDimension(
        entity.subDefinitionPoint1,
        entity.subDefinitionPoint2,
        entity.definitionPoint
      )
      if (entity.insertionPoint) {
        dbEntity.dimBlockPosition = {
          x: entity.insertionPoint.x,
          y: entity.insertionPoint.y,
          z: 0
        }
      }
      dbEntity.rotation = entity.rotationAngle
      this.processDimensionCommonAttrs(dimension, dbEntity)
      return dbEntity
    } else if (dimension.subclassMarker == 'AcDbRotatedDimension') {
      const entity = dimension as DwgAlignedDimensionEntity
      const dbEntity = new AcDbRotatedDimension(
        entity.subDefinitionPoint1,
        entity.subDefinitionPoint2,
        entity.definitionPoint
      )
      if (entity.insertionPoint) {
        dbEntity.dimBlockPosition = {
          x: entity.insertionPoint.x,
          y: entity.insertionPoint.y,
          z: 0
        }
      }
      dbEntity.rotation = entity.rotationAngle
      this.processDimensionCommonAttrs(dimension, dbEntity)
      return dbEntity
    } else if (dimension.subclassMarker == 'AcDb3PointAngularDimension') {
      const entity = dimension as DwgAngularDimensionEntity
      const dbEntity = new AcDb3PointAngularDimension(
        entity.centerPoint,
        entity.subDefinitionPoint1,
        entity.subDefinitionPoint2,
        entity.definitionPoint
      )
      this.processDimensionCommonAttrs(dimension, dbEntity)
      return dbEntity
    } else if (dimension.subclassMarker == 'AcDb2LineAngularDimension') {
      const entity = dimension as DwgAngularDimensionEntity & {
        arcPoint?: DwgAngularDimensionEntity['arcPoint']
      }
      const arcPoint =
        entity.definitionPoint ?? entity.arcPoint ?? entity.subDefinitionPoint2
      const vertexPoint =
        entity.centerPoint ??
        entity.subDefinitionPoint2 ??
        entity.subDefinitionPoint1
      const centerPoint = vertexPoint ?? arcPoint
      const subDefinitionPoint1 =
        entity.subDefinitionPoint1 ?? vertexPoint ?? arcPoint
      const subDefinitionPoint2 =
        entity.subDefinitionPoint2 ?? vertexPoint ?? arcPoint
      if (!arcPoint || !entity.name) {
        return null
      }
      const dbEntity = new AcDb3PointAngularDimension(
        centerPoint,
        subDefinitionPoint1,
        subDefinitionPoint2,
        arcPoint
      )
      this.processDimensionCommonAttrs(dimension, dbEntity)
      return dbEntity
    } else if (dimension.subclassMarker == 'AcDbOrdinateDimension') {
      const entity = dimension as DwgOrdinateDimensionEntity
      const dbEntity = new AcDbOrdinateDimension(
        entity.subDefinitionPoint1,
        entity.subDefinitionPoint2
      )
      this.processDimensionCommonAttrs(dimension, dbEntity)
      return dbEntity
    } else if (dimension.subclassMarker == 'AcDbRadialDimension') {
      const entity = dimension as DwgRadialDiameterDimensionEntity
      const dbEntity = new AcDbRadialDimension(
        entity.definitionPoint,
        entity.centerPoint,
        entity.leaderLength
      )
      this.processDimensionCommonAttrs(dimension, dbEntity)
      return dbEntity
    } else if (dimension.subclassMarker == 'AcDbDiametricDimension') {
      const entity = dimension as DwgRadialDiameterDimensionEntity
      const dbEntity = new AcDbDiametricDimension(
        entity.definitionPoint,
        entity.centerPoint,
        entity.leaderLength
      )
      this.processDimensionCommonAttrs(dimension, dbEntity)
      return dbEntity
    }
    return null
  }

  private processImage(
    image: DwgImageEntity | DwgWipeoutEntity,
    dbImage: AcDbRasterImage
  ) {
    dbImage.position.copy(image.position)
    dbImage.brightness = image.brightness
    dbImage.contrast = image.contrast
    dbImage.fade = image.fade
    dbImage.imageSize.copy(image.imageSize)
    dbImage.imageDefId = image.imageDefHandle as string
    dbImage.isClipped = image.clipping > 0
    dbImage.isShownClipped = (image.flags | 0x0004) > 0
    dbImage.isImageShown = (image.flags | 0x0003) > 0
    dbImage.isImageTransparent = (image.flags | 0x0008) > 0
    image.clippingBoundaryPath.forEach(point => {
      dbImage.clipBoundary.push(new AcGePoint2d(point))
    })
    dbImage.clipBoundaryType =
      image.clippingBoundaryType as unknown as AcDbRasterImageClipBoundaryType

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

  private convertImage(image: DwgImageEntity) {
    const dbImage = new AcDbRasterImage()
    this.processImage(image, dbImage)
    return dbImage
  }

  private convertWipeout(wipeout: DwgWipeoutEntity) {
    const dbWipeout = new AcDbWipeout()
    this.processImage(wipeout, dbWipeout)
    return dbWipeout
  }

  private convertViewport(viewport: DwgViewportEntity) {
    const dbViewport = new AcDbViewport()
    dbViewport.number = viewport.viewportId
    dbViewport.centerPoint.copy(viewport.viewportCenter)
    dbViewport.height = viewport.height
    dbViewport.width = viewport.width
    dbViewport.viewCenter.copy(viewport.displayCenter)
    dbViewport.viewHeight = viewport.viewHeight
    return dbViewport
  }

  private convertRay(ray: DwgRayEntity) {
    const dbRay = new AcDbRay()
    dbRay.basePoint.copy(ray.firstPoint)
    dbRay.unitDir.copy(ray.unitDirection)
    return dbRay
  }

  private convertXline(xline: DwgXlineEntity) {
    const dbXline = new AcDbXline()
    dbXline.basePoint.copy(xline.firstPoint)
    dbXline.unitDir.copy(xline.unitDirection)
    return dbXline
  }

  private convertAttributeCommon(
    attrib: DwgAttribEntity | DwgAttdefEntity,
    dbAttrib: AcDbAttribute | AcDbAttributeDefinition
  ) {
    const text = attrib.text
    dbAttrib.textString = text.text
    dbAttrib.styleName = text.styleName
    dbAttrib.height = text.textHeight
    dbAttrib.position.copy(text.startPoint)
    // Propagate the alignment point (DXF group 11). It is meaningful only
    // when halign/valign deviate from Left/Baseline, but we always copy it
    // so DXF round-trip preserves the original value. Prefer the dedicated
    // field on the parent entity (3D for ATTRIB, 2D for ATTDEF); fall back
    // to the embedded text's `endPoint` which carries the same information.
    // libredwg sometimes surfaces a zero point for entities that simply
    // omit group 11 in the source DWG ??fall back to startPoint so the
    // alignment anchor never collapses to the world origin and is always
    // moved consistently with the position by `transformBy`.
    const alignmentPoint = attrib.alignmentPoint ?? text.endPoint
    const isAlignmentPointZero =
      !alignmentPoint ||
      (alignmentPoint.x === 0 &&
        alignmentPoint.y === 0 &&
        ((alignmentPoint as { z?: number }).z ?? 0) === 0)
    if (alignmentPoint && !isAlignmentPointZero) {
      dbAttrib.alignmentPoint.copy(alignmentPoint)
    } else {
      dbAttrib.alignmentPoint.copy(text.startPoint)
    }
    dbAttrib.rotation = text.rotation
    dbAttrib.oblique = text.obliqueAngle ?? 0
    dbAttrib.thickness = text.thickness
    dbAttrib.horizontalMode = text.halign as unknown as AcDbTextHorizontalMode
    dbAttrib.verticalMode = text.valign as unknown as AcDbTextVerticalMode
    dbAttrib.widthFactor = text.xScale ?? 1
    dbAttrib.tag = attrib.tag
    dbAttrib.fieldLength = attrib.fieldLength
    dbAttrib.isInvisible = (attrib.flags & AcDbAttributeFlags.Invisible) !== 0
    dbAttrib.isConst = (attrib.flags & AcDbAttributeFlags.Const) !== 0
    dbAttrib.isVerifiable = (attrib.flags & AcDbAttributeFlags.Verifiable) !== 0
    dbAttrib.isPreset = (attrib.flags & AcDbAttributeFlags.Preset) !== 0
    dbAttrib.lockPositionInBlock = attrib.lockPositionFlag
    dbAttrib.isReallyLocked = attrib.isReallyLocked
    dbAttrib.isMTextAttribute =
      (attrib.mtextFlag & AcDbAttributeMTextFlag.MultiLine) !== 0
    dbAttrib.isConstMTextAttribute =
      (attrib.mtextFlag & AcDbAttributeMTextFlag.ConstMultiLine) !== 0
  }

  private convertAttribute(attrib: DwgAttribEntity) {
    const dbAttrib = new AcDbAttribute()
    this.convertAttributeCommon(attrib, dbAttrib)
    return dbAttrib
  }

  private convertAttributeDefinition(attrib: DwgAttdefEntity) {
    const dbAttDef = new AcDbAttributeDefinition()
    this.convertAttributeCommon(attrib, dbAttDef)
    dbAttDef.prompt = attrib.prompt
    return dbAttDef
  }

  private convertBlockReference(blockReference: DwgInsertEntity) {
    const dbBlockReference = new AcDbBlockReference(blockReference.name)
    if (blockReference.insertionPoint)
      dbBlockReference.position.copy(blockReference.insertionPoint)
    dbBlockReference.scaleFactors.x = blockReference.xScale
    dbBlockReference.scaleFactors.y = blockReference.yScale
    dbBlockReference.scaleFactors.z = blockReference.zScale
    dbBlockReference.rotation = blockReference.rotation
    dbBlockReference.normal.copy(blockReference.extrusionDirection)
    // Pre-assign the BlockReference's objectId from the DWG handle so that
    // `appendAttributes` below (which sets `attrib.ownerId = this.objectId`)
    // produces a valid ownerId pointing at this INSERT, matching ObjectARX
    // semantics. Without this, ownerId would be assigned undefined here and
    // only later when `processCommonAttrs` runs on the returned BlockReference.
    if (blockReference.handle != null) {
      dbBlockReference.objectId = blockReference.handle
    }
    if (blockReference.attribs) {
      blockReference.attribs.forEach(attrib => {
        // Route through `convert()` rather than `convertAttribute()` so
        // `processCommonAttrs` runs and the AcDbAttribute receives its
        // layer / color / objectId / lineType / lineWeight / linetypeScale
        // from the DWG. Without this, ATTRIBs render with default styling
        // and cannot be addressed individually by per-layer toggles.
        const dbAttrib = this.convert(attrib)
        if (dbAttrib instanceof AcDbAttribute) {
          dbBlockReference.appendAttributes(dbAttrib)
        }
      })
    }
    return dbBlockReference
  }

  private processDimensionCommonAttrs(
    entity: DwgDimensionEntityCommon,
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
  }

  private processCommonAttrs(entity: DwgEntity, dbEntity: AcDbEntity) {
    dbEntity.layer = entity.layer || '0'
    dbEntity.objectId = entity.handle
    if (entity.ownerBlockRecordSoftId != null) {
      dbEntity.ownerId = entity.ownerBlockRecordSoftId
    }
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
    // the entity stuck on the sysvar default and losing the DWG's RGB.
    if (entity.color != null || entity.colorIndex != null || entity.colorName) {
      const color = new AcCmColor()
      if (entity.color != null) {
        color.setRGBValue(entity.color)
      }
      if (entity.colorIndex != null) {
        // ACI color precedence rule:
        // - If the libredwg binding already resolved a concrete RGB for
        //   the entity (entity.color != null), that RGB reflects the
        //   DWG's own color table ??trust it and do NOT overwrite with
        //   ACI resolution from our default palette (which loses custom
        //   palette mappings, e.g. ACI 254 ??#d8f5c2 in the source DWG
        //   vs. near-black in our default palette).
        // - Exception: colorIndex === 7 is semantically special (the
        //   "foreground" color that flips with COLORTHEME). Preserve it
        //   as ByACI(7) so that AcCmColor.isForeground stays true and
        //   text keeps inverting with the theme.
        if (entity.color == null || entity.colorIndex === 7) {
          color.colorIndex = entity.colorIndex
        }
      }
      if (entity.colorName) {
        color.colorName = entity.colorName
      }
      dbEntity.color = color
    }
    if (entity.isVisible != null) {
      dbEntity.visibility = entity.isVisible
    }
    if (entity.transparency != null) {
      const transparency = new AcCmTransparency()
      transparency.method = entity.transparencyType
      if (transparency.isByBlock || transparency.isByBlock) {
        transparency.alpha = entity.transparency
      }
      dbEntity.transparency = transparency
    }
  }

  private convertMLeaderEntityColor(color: number) {
    return decodeMLeaderStyleRawColor(color)
  }

  private readMLeaderEntityColor(
    source: Record<string, unknown>,
    names: string[]
  ) {
    for (const name of names) {
      const value = source[name]
      if (typeof value === 'number' && Number.isFinite(value)) {
        return decodeMLeaderStyleRawColor(value)
      }
    }
    return undefined
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