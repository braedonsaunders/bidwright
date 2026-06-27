import {
  AcGeBox3d,
  AcGeMatrix3d,
  AcGePoint3d,
  AcGePoint3dLike,
  AcGeVector3d,
  AcGeVector3dLike
} from '@mlightcad/geometry-engine'
import {
  AcGiEntity,
  AcGiRenderer,
  AcGiShapeData,
  AcGiTextStyle
} from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbOsnapMode } from '../misc/AcDbOsnapMode'
import { AcDbEntity } from './AcDbEntity'
import { AcDbEntityProperties } from './AcDbEntityProperties'
import { acdbMovePrimaryGripPointAt } from './AcDbGripHelpers'

/**
 * Represents a shape entity in AutoCAD.
 *
 * A shape is a planar geometric object that references a shape definition from an
 * SHX font file. Shapes are positioned by an insertion point, scaled by {@link size}
 * and {@link widthFactor}, and oriented by {@link rotation}, {@link oblique}, and
 * {@link normal}. This class mirrors {@link AcDbShape} in ObjectARX.
 *
 * @see https://help.autodesk.com/view/OARX/2024/ENU/?guid=OARX-RefGuide-AcDbShape
 *
 * @example
 * ```typescript
 * const shape = new AcDbShape();
 * shape.name = 'ARROW';
 * shape.position = new AcGePoint3d(10, 20, 0);
 * shape.size = 2.5;
 * shape.rotation = Math.PI / 4;
 * ```
 */
export class AcDbShape extends AcDbEntity {
  /** The entity type name */
  static override typeName: string = 'Shape'

  override get dxfTypeName() {
    return 'SHAPE'
  }

  /** The insertion point of the shape in WCS coordinates. */
  private _position: AcGePoint3d
  /** The height of the shape. */
  private _size: number
  /** The name of the shape within the associated SHX font. */
  private _name: string
  /** The rotation angle relative to the shape OCS X axis, in radians. */
  private _rotation: number
  /** The relative X-scale factor (width factor). */
  private _widthFactor: number
  /** The oblique angle relative to the shape vertical, in radians. */
  private _oblique: number
  /** The thickness along {@link normal}. */
  private _thickness: number
  /** The normal vector of the plane containing the shape, in WCS coordinates. */
  private _normal: AcGeVector3d
  /** The numeric shape code within the SHX font. */
  private _shapeNumber: number
  /** The text style name that references the SHX font for this shape. */
  private _styleName: string

  /**
   * Creates a new shape entity at the origin with unit size and no rotation.
   */
  constructor() {
    super()
    this._position = new AcGePoint3d()
    this._size = 1
    this._name = ''
    this._rotation = 0
    this._widthFactor = 1
    this._oblique = 0
    this._thickness = 0
    this._normal = new AcGeVector3d(0, 0, 1)
    this._shapeNumber = 0
    this._styleName = ''
  }

  /**
   * Gets the insertion point of this shape in WCS coordinates.
   *
   * Mirrors `AcDbShape::position()` in ObjectARX.
   */
  get position(): AcGePoint3d {
    return this._position
  }

  /** Sets the insertion point of this shape in WCS coordinates. */
  set position(value: AcGePoint3dLike) {
    this._position.copy(value)
  }

  /**
   * Gets the height of this shape.
   *
   * Mirrors `AcDbShape::size()` in ObjectARX.
   */
  get size(): number {
    return this._size
  }

  /** Sets the height of this shape. */
  set size(value: number) {
    this._size = value
  }

  /**
   * Gets the name of the shape within the associated SHX font.
   *
   * Mirrors `AcDbShape::name()` in ObjectARX.
   */
  get name(): string {
    return this._name
  }

  /** Sets the name of the shape within the associated SHX font. */
  set name(value: string) {
    this._name = value
  }

  /**
   * Gets the rotation angle of this shape in radians.
   *
   * The angle is relative to the X axis of the shape OCS, with positive angles
   * going counterclockwise when looking down the Z axis toward the origin.
   *
   * Mirrors `AcDbShape::rotation()` in ObjectARX.
   */
  get rotation(): number {
    return this._rotation
  }

  /** Sets the rotation angle of this shape in radians. */
  set rotation(value: number) {
    this._rotation = value
  }

  /**
   * Gets the width factor applied to this shape.
   *
   * Mirrors `AcDbShape::widthFactor()` in ObjectARX.
   */
  get widthFactor(): number {
    return this._widthFactor
  }

  /** Sets the width factor applied to this shape. */
  set widthFactor(value: number) {
    this._widthFactor = value
  }

  /**
   * Gets the oblique angle of this shape in radians.
   *
   * Mirrors `AcDbShape::oblique()` in ObjectARX.
   */
  get oblique(): number {
    return this._oblique
  }

  /** Sets the oblique angle of this shape in radians. */
  set oblique(value: number) {
    this._oblique = value
  }

  /**
   * Gets the thickness of this shape along {@link normal}.
   *
   * Mirrors `AcDbShape::thickness()` in ObjectARX.
   */
  get thickness(): number {
    return this._thickness
  }

  /** Sets the thickness of this shape. */
  set thickness(value: number) {
    this._thickness = value
  }

  /**
   * Gets the normal vector of the plane containing this shape.
   *
   * Mirrors `AcDbShape::normal()` in ObjectARX.
   */
  get normal(): AcGeVector3d {
    return this._normal
  }

  /** Sets the normal vector of the plane containing this shape. */
  set normal(value: AcGeVector3dLike) {
    this._normal.copy(value)
  }

  /**
   * Gets the numeric shape code within the SHX font.
   *
   * Mirrors `AcDbShape::shapeNumber()` in ObjectARX.
   */
  get shapeNumber(): number {
    return this._shapeNumber
  }

  /** Sets the numeric shape code within the SHX font. */
  set shapeNumber(value: number) {
    this._shapeNumber = value
  }

  /**
   * Gets the object ID of the text style table record that references this
   * shape's SHX font.
   *
   * Mirrors `AcDbShape::styleId()` in ObjectARX.
   */
  get styleId(): string {
    const record = this.database?.tables?.textStyleTable?.resolveAt(
      this._styleName
    )
    return record?.objectId ?? ''
  }

  /**
   * Sets the text style table record by object ID.
   *
   * Mirrors `AcDbShape::setStyleId()` in ObjectARX.
   */
  set styleId(value: string) {
    const record = this.database?.tables?.textStyleTable?.getIdAt(value)
    if (record) {
      this._styleName = record.name
    }
  }

  /**
   * Gets the text style name associated with this shape.
   *
   * Used when reading or writing DXF group code 3 (shape file/style name).
   */
  get styleName(): string {
    return this._styleName
  }

  /** Sets the text style name associated with this shape. */
  set styleName(value: string) {
    this._styleName = value
  }

  /**
   * Gets whether this shape is planar.
   *
   * Mirrors `AcDbShape::isPlanar()` in ObjectARX.
   */
  get isPlanar(): boolean {
    return true
  }

  get geometricExtents(): AcGeBox3d {
    const half = Math.abs(this._size) / 2
    const extents = new AcGeBox3d()
    extents.expandByPoint(this._position)
    if (half > 0) {
      extents.expandByPoint(
        new AcGePoint3d(
          this._position.x - half,
          this._position.y - half,
          this._position.z
        )
      )
      extents.expandByPoint(
        new AcGePoint3d(
          this._position.x + half,
          this._position.y + half,
          this._position.z
        )
      )
    }
    return extents
  }

  subGetGripPoints() {
    return [this._position]
  }

  /** @inheritdoc */
  subMoveGripPointsAt(indices: number[], offset: AcGeVector3dLike) {
    acdbMovePrimaryGripPointAt(indices, offset, this._position)
    return this
  }

  subGetOsnapPoints(
    osnapMode: AcDbOsnapMode,
    _pickPoint: AcGePoint3dLike,
    _lastPoint: AcGePoint3dLike,
    snapPoints: AcGePoint3dLike[]
  ) {
    if (osnapMode === AcDbOsnapMode.Insertion) {
      snapPoints.push(this._position)
    }
  }

  transformBy(matrix: AcGeMatrix3d) {
    const extrusion = new AcGeMatrix3d().setFromExtrusionDirection(this._normal)
    const rotation = new AcGeMatrix3d().makeRotationZ(this._rotation)
    const localToWcs = new AcGeMatrix3d().multiplyMatrices(extrusion, rotation)

    const origin = this._position.clone()
    const xAxisPoint = new AcGePoint3d(this._widthFactor, 0, 0)
      .applyMatrix4(localToWcs)
      .add(origin)
    const yAxisPoint = new AcGePoint3d(0, 1, 0)
      .applyMatrix4(localToWcs)
      .add(origin)
    const zAxisPoint = new AcGePoint3d(0, 0, 1)
      .applyMatrix4(localToWcs)
      .add(origin)

    origin.applyMatrix4(matrix)
    xAxisPoint.applyMatrix4(matrix)
    yAxisPoint.applyMatrix4(matrix)
    zAxisPoint.applyMatrix4(matrix)

    const xAxis = new AcGeVector3d(xAxisPoint).sub(origin)
    const yAxis = new AcGeVector3d(yAxisPoint).sub(origin)
    const zAxis = new AcGeVector3d(zAxisPoint).sub(origin)

    let normal = new AcGeVector3d().crossVectors(xAxis, yAxis)
    if (normal.lengthSq() === 0) {
      normal = this._normal.clone().transformDirection(matrix)
    } else {
      normal.normalize()
    }

    const extrusionMatrix = new AcGeMatrix3d().setFromExtrusionDirection(normal)
    const ocsInverse = extrusionMatrix.clone().invert()
    const localXAxis = xAxis.clone().applyMatrix4(ocsInverse)
    const yScale = yAxis.length()
    const xScale = xAxis.length()

    this._position.copy(origin)
    this._normal.copy(normal)
    if (xScale > 0) {
      this._rotation = Math.atan2(localXAxis.y, localXAxis.x)
    }
    if (yScale > 0) {
      this._size *= yScale
      if (xScale > 0) {
        this._widthFactor *= xScale / yScale
      }
    }
    const zScale = zAxis.length()
    if (zScale > 0) {
      this._thickness *= zScale
    }
    return this
  }

  get properties(): AcDbEntityProperties {
    return {
      type: this.type,
      groups: [
        this.getGeneralProperties(),
        {
          groupName: 'shape',
          properties: [
            {
              name: 'name',
              type: 'string',
              editable: true,
              accessor: {
                get: () => this.name,
                set: (v: string) => {
                  this.name = v
                }
              }
            },
            {
              name: 'size',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.size,
                set: (v: number) => {
                  this.size = v
                }
              }
            },
            {
              name: 'rotation',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.rotation,
                set: (v: number) => {
                  this.rotation = v
                }
              }
            },
            {
              name: 'widthFactor',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.widthFactor,
                set: (v: number) => {
                  this.widthFactor = v
                }
              }
            },
            {
              name: 'oblique',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.oblique,
                set: (v: number) => {
                  this.oblique = v
                }
              }
            },
            {
              name: 'shapeNumber',
              type: 'int',
              editable: true,
              accessor: {
                get: () => this.shapeNumber,
                set: (v: number) => {
                  this.shapeNumber = v
                }
              }
            }
          ]
        },
        {
          groupName: 'geometry',
          properties: [
            {
              name: 'positionX',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.position.x,
                set: (v: number) => {
                  this.position.x = v
                }
              }
            },
            {
              name: 'positionY',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.position.y,
                set: (v: number) => {
                  this.position.y = v
                }
              }
            },
            {
              name: 'positionZ',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.position.z,
                set: (v: number) => {
                  this.position.z = v
                }
              }
            }
          ]
        }
      ]
    }
  }

  subWorldDraw(
    renderer: AcGiRenderer,
    delay?: boolean
  ): AcGiEntity | undefined {
    const textStyle = this.getTextStyle()
    const style: AcGiTextStyle | undefined = textStyle
      ? {
          ...textStyle,
          widthFactor: this.widthFactor,
          // MText renderer stores oblique in degrees on the text style.
          obliqueAngle: (this.oblique * 180) / Math.PI
        }
      : undefined

    const shapeData: AcGiShapeData = {
      name: this._name.trim() || undefined,
      shapeNumber: this._shapeNumber !== 0 ? this._shapeNumber : undefined,
      size: this.size,
      position: this._position,
      rotation: this._rotation,
      directionVector: this._normal,
      widthFactor: this.widthFactor
    }

    return renderer.shape(shapeData, style, delay)
  }

  /**
   * Gets the text style that references the SHX font for this shape.
   *
   * When {@link styleName} is empty, returns `undefined` so renderers search
   * shape-file definition entries in the STYLE table instead of falling back to
   * `$TEXTSTYLE` (which is for TEXT/MTEXT, not SHAPE entities).
   */
  protected getTextStyle(): AcGiTextStyle | undefined {
    const trimmed = this.styleName.trim()
    if (!trimmed) {
      return undefined
    }
    const style = this.database.tables.textStyleTable.resolveAt(trimmed)
    return style?.textStyle
  }

  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbShape')
    filer.writePoint3d(10, this.position)
    filer.writeDouble(40, this.size)
    filer.writeString(2, this.name)
    filer.writeAngle(50, this.rotation)
    filer.writeDouble(41, this.widthFactor)
    filer.writeAngle(51, this.oblique)
    filer.writeDouble(39, this.thickness)
    if (this._styleName) {
      filer.writeString(3, this._styleName)
    }
    filer.writeVector3d(210, this.normal)
    return this
  }
}