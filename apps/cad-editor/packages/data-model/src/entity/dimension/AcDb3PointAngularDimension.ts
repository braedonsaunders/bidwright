import {
  AcGeMatrix3d,
  AcGePoint3d,
  AcGePointLike
} from '@mlightcad/geometry-engine'

import { AcDbDxfFiler } from '../../base'
import { AcDbEntityProperties } from '../AcDbEntityProperties'
import { AcDbDimension } from './AcDbDimension'

/**
 * Represents a three-point angular dimension entity in AutoCAD.
 *
 * This dimension type measures the angle between two lines or edges by defining three points:
 * a center point and two points that define the lines or edges being measured. The dimension
 * displays the angle value and typically includes extension lines, dimension lines, and arrows.
 *
 * Three-point angular dimensions are commonly used to measure angles between non-parallel lines,
 * angles of arcs, or any angular measurement that requires three reference points.
 */
export class AcDb3PointAngularDimension extends AcDbDimension {
  /** The entity type name */
  static override typeName: string = '3PointAngularDimension'

  private _arcPoint: AcGePoint3d
  private _centerPoint: AcGePoint3d
  private _xLine1Point: AcGePoint3d
  private _xLine2Point: AcGePoint3d

  /**
   * Creates a new three-point angular dimension.
   *
   * @param centerPoint - The center point of the angle being measured. This is typically
   *                      the vertex where the two lines or edges meet
   * @param xLine1Point - The first extension line end point. This defines one of the
   *                      lines or edges being measured
   * @param xLine2Point - The second extension line end point. This defines the other
   *                      line or edge being measured
   * @param arcPoint - A point on the arc that represents the angle being measured.
   *                   This point helps determine the direction and extent of the angle
   * @param dimText - Optional custom dimension text to display instead of the calculated
   *                  angle value. If null, the calculated angle will be displayed
   * @param dimStyle - Optional name of the dimension style table record to use for
   *                   formatting. If null, the current default style will be used
   */
  constructor(
    centerPoint: AcGePointLike,
    xLine1Point: AcGePointLike,
    xLine2Point: AcGePointLike,
    arcPoint: AcGePointLike,
    dimText: string | null = null,
    dimStyle: string | null = null
  ) {
    super()
    this._centerPoint = new AcGePoint3d().copy(centerPoint)
    this._xLine1Point = new AcGePoint3d().copy(xLine1Point)
    this._xLine2Point = new AcGePoint3d().copy(xLine2Point)
    this._arcPoint = new AcGePoint3d().copy(arcPoint)

    this.dimensionText = dimText
    // TODO: Set it to the current default dimStyle within the AutoCAD editor if dimStyle is null
    this.dimensionStyleName = dimStyle
  }

  /**
   * Gets or sets a point on the arc that represents the angle being measured.
   *
   * This point is used to determine the direction and extent of the angle measurement.
   * It helps define which side of the angle should be measured and how the dimension
   * arc should be drawn.
   *
   * @returns The arc point that defines the angle measurement
   */
  get arcPoint() {
    return this._arcPoint
  }
  set arcPoint(value: AcGePoint3d) {
    this._arcPoint.copy(value)
  }

  /**
   * Gets or sets the center point of the angle being measured.
   *
   * The center point is the vertex where the two lines or edges meet. This point
   * serves as the reference for measuring the angle between the two extension lines.
   *
   * @returns The center point of the angle
   */
  get centerPoint() {
    return this._centerPoint
  }
  set centerPoint(value: AcGePoint3d) {
    this._centerPoint.copy(value)
  }

  /**
   * Gets or sets the first extension line end point.
   *
   * This point defines one of the lines or edges being measured. The extension line
   * extends from this point to the center point, helping to clearly identify the
   * first reference line for the angle measurement.
   *
   * @returns The first extension line end point
   */
  get xLine1Point() {
    return this._xLine1Point
  }
  set xLine1Point(value: AcGePoint3d) {
    this._xLine1Point.copy(value)
  }

  /**
   * Gets or sets the second extension line end point.
   *
   * This point defines the other line or edge being measured. The extension line
   * extends from this point to the center point, helping to clearly identify the
   * second reference line for the angle measurement.
   *
   * @returns The second extension line end point
   */
  get xLine2Point() {
    return this._xLine2Point
  }
  set xLine2Point(value: AcGePoint3d) {
    this._xLine2Point.copy(value)
  }

  override get properties(): AcDbEntityProperties {
    const baseProperties = this.getBaseProperties()
    return {
      type: this.type,
      groups: [
        ...baseProperties.groups,
        {
          groupName: 'geometry',
          properties: [
            ...this.createPoint3dProperties(
              'centerPoint',
              () => this.centerPoint
            ),
            ...this.createPoint3dProperties(
              'xLine1Point',
              () => this.xLine1Point
            ),
            ...this.createPoint3dProperties(
              'xLine2Point',
              () => this.xLine2Point
            ),
            ...this.createPoint3dProperties('arcPoint', () => this.arcPoint)
          ]
        }
      ]
    }
  }

  /**
   * @inheritdoc
   */
  protected override collectDimensionDefinitionGripPoints() {
    return [this.centerPoint, this.xLine1Point, this.xLine2Point, this.arcPoint]
  }

  /**
   * @inheritdoc
   */
  protected override subTransformBy(matrix: AcGeMatrix3d) {
    this._arcPoint.applyMatrix4(matrix)
    this._centerPoint.applyMatrix4(matrix)
    this._xLine1Point.applyMatrix4(matrix)
    this._xLine2Point.applyMatrix4(matrix)
  }

  /**
   * Gets the geometric extents (bounding box) of this dimension entity.
   *
   * The geometric extents define the minimum bounding box that completely contains
   * the dimension entity, including all its components like extension lines,
   * dimension lines, arrows, and text.
   *
   * @returns A 3D bounding box containing the dimension entity
   * @inheritdoc
   */
  get geometricExtents() {
    return this.getGeometricExtentsFromDimBlockOrPoints([
      this.xLine1Point,
      this.xLine2Point,
      this.centerPoint,
      this.arcPoint
    ])
  }

  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDb3PointAngularDimension')
    filer.writePoint3d(13, this.xLine1Point)
    filer.writePoint3d(14, this.xLine2Point)
    filer.writePoint3d(15, this.centerPoint)
    filer.writePoint3d(16, this.arcPoint)
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)

    // Accept either angular subclass. Group-70 type 2 writes AcDb2LineAngular…
    // while type 5 writes AcDb3PointAngular…; both map into this class.
    const peek = filer.peekItem()
    let is2Line = false
    if (peek && Number(peek.code) === 100) {
      const marker = String(peek.value)
      if (marker === 'AcDb2LineAngularDimension') {
        is2Line = true
        filer.atSubclassData('AcDb2LineAngularDimension')
      } else if (marker === 'AcDb3PointAngularDimension') {
        filer.atSubclassData('AcDb3PointAngularDimension')
      }
    }

    let x1 = this.xLine1Point.x
    let y1 = this.xLine1Point.y
    let z1 = this.xLine1Point.z
    let x2 = this.xLine2Point.x
    let y2 = this.xLine2Point.y
    let z2 = this.xLine2Point.z
    let cx = this.centerPoint.x
    let cy = this.centerPoint.y
    let cz = this.centerPoint.z
    let ax = this.arcPoint.x
    let ay = this.arcPoint.y
    let az = this.arcPoint.z
    let hasArc = false

    // 2-line angular stores four endpoints: 13/14 = line1, 15/16 = line2.
    let l1ex = x1
    let l1ey = y1
    let l1ez = z1
    let l2ex = x2
    let l2ey = y2
    let l2ez = z2

    const commit = () => {
      if (is2Line) {
        // Map 2-line endpoints into the 3-point representation used by this
        // class (same approach as dxf-json-converter): xLine points are the
        // line starts; center is the line intersection when available.
        this.xLine1Point = new AcGePoint3d(x1, y1, z1)
        this.xLine2Point = new AcGePoint3d(cx, cy, cz) // group 15 = line2 start
        const hit = intersectLines2d(
          { x: x1, y: y1 },
          { x: l1ex, y: l1ey },
          { x: cx, y: cy },
          { x: l2ex, y: l2ey }
        )
        if (hit) {
          this.centerPoint = new AcGePoint3d(hit.x, hit.y, (z1 + l2ez) / 2)
        } else {
          // Parallel / degenerate — fall back to line1 end (group 14).
          this.centerPoint = new AcGePoint3d(l1ex, l1ey, l1ez)
        }
        // Arc point is AcDbDimension definition point (group 10) when 16 was
        // consumed as line2 end rather than an arc point.
        this.arcPoint = new AcGePoint3d(
          this._dxfDefinitionPoint.x,
          this._dxfDefinitionPoint.y,
          this._dxfDefinitionPoint.z
        )
        return
      }

      this.xLine1Point = new AcGePoint3d(x1, y1, z1)
      this.xLine2Point = new AcGePoint3d(x2, y2, z2)
      this.centerPoint = new AcGePoint3d(cx, cy, cz)
      // AutoCAD DXF stores the arc point as group 10 when group 16 is absent.
      if (hasArc) {
        this.arcPoint = new AcGePoint3d(ax, ay, az)
      } else {
        this.arcPoint = new AcGePoint3d(
          this._dxfDefinitionPoint.x,
          this._dxfDefinitionPoint.y,
          this._dxfDefinitionPoint.z
        )
      }
    }

    while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
      const item = filer.readItem()
      if (!item) break
      const code = Number(item.code)
      const n = Number(item.value)
      switch (code) {
        case 13:
          x1 = n
          break
        case 23:
          y1 = n
          break
        case 33:
          z1 = n
          break
        case 14:
          if (is2Line) {
            l1ex = n
          } else {
            x2 = n
          }
          break
        case 24:
          if (is2Line) {
            l1ey = n
          } else {
            y2 = n
          }
          break
        case 34:
          if (is2Line) {
            l1ez = n
          } else {
            z2 = n
          }
          break
        case 15:
          cx = n
          break
        case 25:
          cy = n
          break
        case 35:
          cz = n
          break
        case 16:
          if (is2Line) {
            l2ex = n
          } else {
            ax = n
            hasArc = true
          }
          break
        case 26:
          if (is2Line) {
            l2ey = n
          } else {
            ay = n
            hasArc = true
          }
          break
        case 36:
          if (is2Line) {
            l2ez = n
          } else {
            az = n
            hasArc = true
          }
          break
        default:
          break
      }
    }

    commit()
    return this
  }
}

/** 2D line-segment intersection used when mapping 2-line angular dimensions. */
function intersectLines2d(
  a0: { x: number; y: number },
  a1: { x: number; y: number },
  b0: { x: number; y: number },
  b1: { x: number; y: number }
): { x: number; y: number } | null {
  const dax = a1.x - a0.x
  const day = a1.y - a0.y
  const dbx = b1.x - b0.x
  const dby = b1.y - b0.y
  const denom = dax * dby - day * dbx
  if (Math.abs(denom) < 1e-12) return null
  const t = ((b0.x - a0.x) * dby - (b0.y - a0.y) * dbx) / denom
  return { x: a0.x + t * dax, y: a0.y + t * day }
}
