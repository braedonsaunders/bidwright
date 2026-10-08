import {
  AcGeBox3d,
  AcGeIntersectPrimitive,
  AcGeMatrix3d,
  AcGePoint3d,
  AcGePoint3dLike,
  AcGeVector3d,
  AcGeVector3dLike
} from '@mlightcad/geometry-engine'
import { AcGiRenderer } from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { acdbDrawImageFrame } from '../misc/acdbDrawImageFrame'
import { acdbParseOle2FrameGeometryHeader } from '../misc/AcDbOle2FrameGeometry'
import { acdbExtractOleImageBlob } from '../misc/AcDbOleImageExtractor'
import { AcDbOsnapMode } from '../misc/AcDbOsnapMode'
import {
  acdbBytesToHexString,
  acdbCombineDxfBinaryChunks
} from '../misc/proxyGraphic'
import { AcDbEntity } from './AcDbEntity'
import { AcDbEntityProperties } from './AcDbEntityProperties'
import {
  acdbForEachGripIndex,
  acdbMovePointArrayGripAt
} from './AcDbGripHelpers'
import { acdbIntersectPrimitivesFromPointPath } from './AcDbIntersectHelpers'
import { AcDbOleFrame } from './AcDbOleFrame'
import { acdbCollectVertexPathOsnapPoints } from './AcDbOsnapHelpers'

/**
 * OLE object type stored with an {@link AcDbOle2Frame} (DXF group code 71).
 *
 * @see https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-DXF/files/GUID-77747CE6-82C6-4452-97ED-4CEEB38BE960.htm
 */
export enum AcDbOleObjectType {
  /** Linked OLE object */
  Link = 1,
  /** Embedded OLE object */
  Embedded = 2,
  /** Static OLE object */
  Static = 3
}

/**
 * Tile-mode descriptor stored with an {@link AcDbOle2Frame} (DXF group code 72).
 *
 * Distinct from the common entity paper-space flag (group code 67).
 */
export enum AcDbOleTileMode {
  /** Object resides in model space */
  ModelSpace = 0,
  /** Object resides in paper space */
  PaperSpace = 1
}

/**
 * Axis-aligned OLE frame rectangle in WCS, analogous to ObjectARX
 * `CRectangle3d`.
 */
export interface AcDbOleRectangle3d {
  /** Upper-left corner in WCS */
  upperLeft: AcGePoint3dLike
  /** Upper-right corner in WCS */
  upperRight: AcGePoint3dLike
  /** Lower-left corner in WCS */
  lowerLeft: AcGePoint3dLike
  /** Lower-right corner in WCS */
  lowerRight: AcGePoint3dLike
}

/**
 * Represents an OLE 2 frame entity in AutoCAD.
 *
 * {@link AcDbOle2Frame} provides a display frame for an OLE 2 object. It stores
 * frame geometry (location, width, height, rotation), display settings, link
 * metadata, and the embedded OLE binary payload inherited from
 * {@link AcDbOleFrame}.
 *
 * Platform-specific MFC types such as `COleClientItem` are represented as opaque
 * values in this TypeScript port.
 *
 * @see https://help.autodesk.com/view/OARX/2024/ENU/?guid=OARX-RefGuide-AcDbOle2Frame
 * @see https://help.autodesk.com/view/OARX/2024/ENU/?guid=OARX-RefGuide-__MEMBERTYPE_Methods_AcDbOle2Frame
 *
 * @example
 * ```typescript
 * const ole = new AcDbOle2Frame()
 * ole.setLocation(new AcGePoint3d(0, 10, 0))
 * ole.setWcsWidth(100)
 * ole.setWcsHeight(75)
 * ole.userType = 'Paintbrush Picture'
 * ole.oleObjectType = AcDbOleObjectType.Embedded
 * ```
 */
export class AcDbOle2Frame extends AcDbOleFrame {
  /** The entity type name */
  static override typeName: string = 'Ole2Frame'

  override get dxfTypeName() {
    return 'OLE2FRAME'
  }

  /** Upper-left corner of the frame in WCS. */
  private _upperLeft = new AcGePoint3d()
  /** Lower-right corner of the frame in WCS. */
  private _lowerRight = new AcGePoint3d()
  /** Rotation angle in radians. */
  private _rotation = 0
  /** Relative scale factor applied to the frame width. */
  private _scaleWidth = 1
  /** Relative scale factor applied to the frame height. */
  private _scaleHeight = 1
  /** Whether the aspect ratio is locked. */
  private _lockAspect = false
  /** Output quality value (DXF group code 73 when present). */
  private _outputQuality = 0
  /** Automatic output quality flag. */
  private _autoOutputQuality = 0
  /** OLE object type (link / embedded / static). */
  private _oleObjectType = AcDbOleObjectType.Embedded
  /** Tile-mode descriptor. */
  private _tileMode = AcDbOleTileMode.ModelSpace
  /** User-visible OLE type description (DXF group code 3). */
  private _userType = ''
  /** Linked OLE object name. */
  private _linkName = ''
  /** Linked OLE object path. */
  private _linkPath = ''
  /**
   * Opaque host OLE client item.
   *
   * Mirrors ObjectARX `COleClientItem*`. There is no MFC host in the browser
   * runtime, so this value is application-defined.
   */
  private _oleClientItem: unknown = null
  /** Cached image decoded from the OLE binary payload. */
  private _image?: Blob
  /** Whether image extraction from the current OLE payload has been attempted. */
  private _imageResolved = false

  /**
   * Creates a new OLE 2 frame entity.
   *
   * Objects created with this constructor must receive a valid OLE payload
   * through {@link setOleObject} (or host-specific client-item APIs) before they
   * represent a complete OLE entity.
   */
  constructor() {
    super()
  }

  /**
   * Gets the upper-left corner of this frame in WCS.
   */
  get upperLeftCorner(): AcGePoint3d {
    return this._upperLeft
  }

  /**
   * Sets the upper-left corner of this frame in WCS.
   */
  set upperLeftCorner(value: AcGePoint3dLike) {
    this._upperLeft.copy(value)
  }

  /**
   * Gets the lower-right corner of this frame in WCS.
   */
  get lowerRightCorner(): AcGePoint3d {
    return this._lowerRight
  }

  /**
   * Sets the lower-right corner of this frame in WCS.
   */
  set lowerRightCorner(value: AcGePoint3dLike) {
    this._lowerRight.copy(value)
  }

  /**
   * Gets the location (upper-left corner) of this OLE frame in WCS.
   *
   * Mirrors ObjectARX `AcDbOle2Frame::getLocation`.
   */
  getLocation(result?: AcGePoint3d): AcGePoint3d {
    if (result) {
      return result.copy(this._upperLeft)
    }
    return this._upperLeft.clone()
  }

  /**
   * Sets the location (upper-left corner) of this OLE frame in WCS.
   *
   * The lower-right corner is translated by the same delta so the frame size is
   * preserved.
   *
   * Mirrors ObjectARX `AcDbOle2Frame::setLocation`.
   */
  setLocation(value: AcGePoint3dLike) {
    const dx = value.x - this._upperLeft.x
    const dy = value.y - this._upperLeft.y
    const dz = (value.z ?? 0) - this._upperLeft.z
    this._upperLeft.copy(value)
    this._lowerRight.x += dx
    this._lowerRight.y += dy
    this._lowerRight.z += dz
  }

  /**
   * Gets the frame rectangle in WCS.
   *
   * Mirrors ObjectARX `AcDbOle2Frame::position(CRectangle3d&)`.
   */
  position(): AcDbOleRectangle3d {
    return {
      upperLeft: this._upperLeft.clone(),
      upperRight: this.cornerUpperRight(),
      lowerLeft: this.cornerLowerLeft(),
      lowerRight: this._lowerRight.clone()
    }
  }

  /**
   * Sets the frame rectangle in WCS from the given corner points.
   *
   * Mirrors ObjectARX `AcDbOle2Frame::setPosition(const CRectangle3d&)`.
   * Only the upper-left and lower-right corners are stored; the other two
   * corners are derived.
   */
  setPosition(rect: AcDbOleRectangle3d) {
    this._upperLeft.copy(rect.upperLeft)
    this._lowerRight.copy(rect.lowerRight)
  }

  /**
   * Gets the frame width in WCS units.
   *
   * Mirrors ObjectARX `AcDbOle2Frame::wcsWidth`.
   */
  wcsWidth(): number {
    return Math.abs(this._lowerRight.x - this._upperLeft.x)
  }

  /**
   * Sets the frame width in WCS units, keeping the upper-left corner fixed.
   *
   * Mirrors ObjectARX `AcDbOle2Frame::setWcsWidth`.
   */
  setWcsWidth(value: number) {
    const sign = this._lowerRight.x >= this._upperLeft.x ? 1 : -1
    this._lowerRight.x = this._upperLeft.x + sign * Math.abs(value)
    if (this._lockAspect) {
      this.syncHeightFromAspect()
    }
  }

  /**
   * Gets the frame height in WCS units.
   *
   * Mirrors ObjectARX `AcDbOle2Frame::wcsHeight`.
   */
  wcsHeight(): number {
    return Math.abs(this._upperLeft.y - this._lowerRight.y)
  }

  /**
   * Sets the frame height in WCS units, keeping the upper-left corner fixed.
   *
   * Mirrors ObjectARX `AcDbOle2Frame::setWcsHeight`.
   */
  setWcsHeight(value: number) {
    const sign = this._upperLeft.y >= this._lowerRight.y ? 1 : -1
    this._lowerRight.y = this._upperLeft.y - sign * Math.abs(value)
    if (this._lockAspect) {
      this.syncWidthFromAspect()
    }
  }

  /**
   * Gets the relative width scale factor.
   *
   * Mirrors ObjectARX `AcDbOle2Frame::scaleWidth`.
   */
  scaleWidth(): number {
    return this._scaleWidth
  }

  /**
   * Sets the relative width scale factor.
   *
   * Mirrors ObjectARX `AcDbOle2Frame::setScaleWidth`.
   */
  setScaleWidth(value: number) {
    this._scaleWidth = value
  }

  /**
   * Gets the relative height scale factor.
   *
   * Mirrors ObjectARX `AcDbOle2Frame::scaleHeight`.
   */
  scaleHeight(): number {
    return this._scaleHeight
  }

  /**
   * Sets the relative height scale factor.
   *
   * Mirrors ObjectARX `AcDbOle2Frame::setScaleHeight`.
   */
  setScaleHeight(value: number) {
    this._scaleHeight = value
  }

  /**
   * Gets the rotation angle of this frame in radians.
   *
   * Mirrors ObjectARX `AcDbOle2Frame::rotation`.
   */
  rotation(): number {
    return this._rotation
  }

  /**
   * Sets the rotation angle of this frame in radians.
   *
   * Mirrors ObjectARX `AcDbOle2Frame::setRotation`.
   */
  setRotation(value: number) {
    this._rotation = value
  }

  /**
   * Returns whether the frame aspect ratio is locked.
   *
   * Mirrors ObjectARX `AcDbOle2Frame::lockAspect`.
   */
  lockAspect(): boolean {
    return this._lockAspect
  }

  /**
   * Sets whether the frame aspect ratio is locked.
   *
   * Mirrors ObjectARX `AcDbOle2Frame::setLockAspect`.
   */
  setLockAspect(value: boolean | number) {
    this._lockAspect = !!value
  }

  /**
   * Gets the output quality value.
   *
   * Mirrors ObjectARX `AcDbOle2Frame::outputQuality`.
   */
  outputQuality(): number {
    return this._outputQuality
  }

  /**
   * Sets the output quality value.
   *
   * Mirrors ObjectARX `AcDbOle2Frame::setOutputQuality`.
   */
  setOutputQuality(value: number) {
    this._outputQuality = value & 0xff
  }

  /**
   * Gets the automatic output quality flag.
   *
   * Mirrors ObjectARX `AcDbOle2Frame::autoOutputQuality`.
   */
  autoOutputQuality(): number {
    return this._autoOutputQuality
  }

  /**
   * Sets the automatic output quality flag.
   *
   * Mirrors ObjectARX `AcDbOle2Frame::setAutoOutputQuality`.
   */
  setAutoOutputQuality(value: number) {
    this._autoOutputQuality = value & 0xff
  }

  /**
   * Gets the OLE object type (link / embedded / static).
   *
   * Mirrors ObjectARX `AcDbOle2Frame::getType`.
   */
  getType(): AcDbOleObjectType {
    return this._oleObjectType
  }

  /**
   * Sets the OLE object type (link / embedded / static).
   */
  setType(value: AcDbOleObjectType) {
    this._oleObjectType = value
  }

  /**
   * Gets the OLE object type (link / embedded / static).
   *
   * Prefer {@link getType} when matching ObjectARX naming.
   */
  get oleObjectType() {
    return this._oleObjectType
  }

  set oleObjectType(value: AcDbOleObjectType) {
    this._oleObjectType = value
  }

  /**
   * Gets the tile-mode descriptor for this frame.
   */
  get tileMode() {
    return this._tileMode
  }

  set tileMode(value: AcDbOleTileMode) {
    this._tileMode = value
  }

  /**
   * Gets the user-visible OLE type description.
   *
   * Mirrors ObjectARX `AcDbOle2Frame::getUserType`. Corresponds to DXF group
   * code **3**.
   */
  getUserType(): string {
    return this._userType
  }

  /**
   * Sets the user-visible OLE type description.
   */
  setUserType(value: string) {
    this._userType = value
  }

  /**
   * Gets the user-visible OLE type description.
   *
   * Prefer {@link getUserType} when matching ObjectARX naming.
   */
  get userType() {
    return this._userType
  }

  set userType(value: string) {
    this._userType = value
  }

  /**
   * Gets the linked OLE object name.
   *
   * Mirrors ObjectARX `AcDbOle2Frame::getLinkName`.
   */
  getLinkName(): string {
    return this._linkName
  }

  /**
   * Sets the linked OLE object name.
   */
  setLinkName(value: string) {
    this._linkName = value
  }

  /**
   * Gets the linked OLE object path.
   *
   * Mirrors ObjectARX `AcDbOle2Frame::getLinkPath`.
   */
  getLinkPath(): string {
    return this._linkPath
  }

  /**
   * Sets the linked OLE object path.
   */
  setLinkPath(value: string) {
    this._linkPath = value
  }

  /**
   * Returns the opaque host OLE client item associated with this frame.
   *
   * Mirrors ObjectARX `AcDbOle2Frame::getOleClientItem`. There is no MFC
   * `COleClientItem` in the browser runtime; the value is application-defined.
   */
  getOleClientItem(): unknown {
    return this._oleClientItem
  }

  /**
   * Associates an opaque host OLE client item with this frame.
   *
   * Mirrors ObjectARX `AcDbOle2Frame::setOleClientItem`.
   */
  setOleClientItem(value: unknown) {
    this._oleClientItem = value ?? null
  }

  /**
   * Returns the full property definition for this OLE 2 frame entity, including
   * general, geometry, and OLE-specific groups.
   *
   * Geometry accessors update location / size / rotation via the ObjectARX-style
   * setters so aspect locking and size preservation stay consistent.
   */
  override get properties(): AcDbEntityProperties {
    return {
      type: this.type,
      groups: [
        this.getGeneralProperties(),
        {
          groupName: 'geometry',
          properties: [
            {
              name: 'positionX',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.upperLeftCorner.x,
                set: (v: number) => {
                  this.setLocation({
                    x: v,
                    y: this.upperLeftCorner.y,
                    z: this.upperLeftCorner.z
                  })
                }
              }
            },
            {
              name: 'positionY',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.upperLeftCorner.y,
                set: (v: number) => {
                  this.setLocation({
                    x: this.upperLeftCorner.x,
                    y: v,
                    z: this.upperLeftCorner.z
                  })
                }
              }
            },
            {
              name: 'positionZ',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.upperLeftCorner.z,
                set: (v: number) => {
                  this.setLocation({
                    x: this.upperLeftCorner.x,
                    y: this.upperLeftCorner.y,
                    z: v
                  })
                }
              }
            },
            {
              name: 'rotation',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.rotation(),
                set: (v: number) => {
                  this.setRotation(v)
                }
              }
            },
            {
              name: 'width',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.wcsWidth(),
                set: (v: number) => {
                  this.setWcsWidth(v)
                }
              }
            },
            {
              name: 'height',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.wcsHeight(),
                set: (v: number) => {
                  this.setWcsHeight(v)
                }
              }
            },
            {
              name: 'scaleWidth',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.scaleWidth(),
                set: (v: number) => {
                  this.setScaleWidth(v)
                }
              }
            },
            {
              name: 'scaleHeight',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.scaleHeight(),
                set: (v: number) => {
                  this.setScaleHeight(v)
                }
              }
            },
            {
              name: 'lockAspect',
              type: 'boolean',
              editable: true,
              accessor: {
                get: () => this.lockAspect(),
                set: (v: boolean) => {
                  this.setLockAspect(v)
                }
              }
            }
          ]
        },
        {
          groupName: 'ole',
          properties: [
            ...this.getOleProperties().properties,
            {
              name: 'userType',
              type: 'string',
              editable: true,
              accessor: {
                get: () => this.userType,
                set: (v: string) => {
                  this.userType = v
                }
              }
            },
            {
              name: 'oleObjectType',
              type: 'enum',
              editable: true,
              options: [
                {
                  label: AcDbOleObjectType[AcDbOleObjectType.Link],
                  value: AcDbOleObjectType.Link
                },
                {
                  label: AcDbOleObjectType[AcDbOleObjectType.Embedded],
                  value: AcDbOleObjectType.Embedded
                },
                {
                  label: AcDbOleObjectType[AcDbOleObjectType.Static],
                  value: AcDbOleObjectType.Static
                }
              ],
              accessor: {
                get: () => this.oleObjectType,
                set: (v: AcDbOleObjectType) => {
                  this.oleObjectType = v
                }
              }
            },
            {
              name: 'tileMode',
              type: 'enum',
              editable: true,
              options: [
                {
                  label: AcDbOleTileMode[AcDbOleTileMode.ModelSpace],
                  value: AcDbOleTileMode.ModelSpace
                },
                {
                  label: AcDbOleTileMode[AcDbOleTileMode.PaperSpace],
                  value: AcDbOleTileMode.PaperSpace
                }
              ],
              accessor: {
                get: () => this.tileMode,
                set: (v: AcDbOleTileMode) => {
                  this.tileMode = v
                }
              }
            },
            {
              name: 'linkName',
              type: 'string',
              editable: true,
              accessor: {
                get: () => this.getLinkName(),
                set: (v: string) => {
                  this.setLinkName(v)
                }
              }
            },
            {
              name: 'linkPath',
              type: 'string',
              editable: true,
              accessor: {
                get: () => this.getLinkPath(),
                set: (v: string) => {
                  this.setLinkPath(v)
                }
              }
            },
            {
              name: 'outputQuality',
              type: 'int',
              editable: true,
              accessor: {
                get: () => this.outputQuality(),
                set: (v: number) => {
                  this.setOutputQuality(v)
                }
              }
            },
            {
              name: 'autoOutputQuality',
              type: 'int',
              editable: true,
              accessor: {
                get: () => this.autoOutputQuality(),
                set: (v: number) => {
                  this.setAutoOutputQuality(v)
                }
              }
            }
          ]
        }
      ]
    }
  }

  /**
   * @inheritdoc
   */
  get geometricExtents(): AcGeBox3d {
    return new AcGeBox3d().setFromPoints(this.boundaryPath())
  }

  /** @inheritdoc */
  override subGetIntersectCurves(): AcGeIntersectPrimitive[] {
    return acdbIntersectPrimitivesFromPointPath(
      this.boundaryPath().slice(0, 4),
      true
    )
  }

  /**
   * @inheritdoc
   */
  subGetGripPoints() {
    return this.boundaryPath().slice(0, 4)
  }

  /** @inheritdoc */
  subMoveGripPointsAt(indices: number[], offset: AcGeVector3dLike) {
    const corners = this.boundaryPath().slice(0, 4)
    acdbMovePointArrayGripAt(indices, offset, corners)
    acdbForEachGripIndex(indices, index => {
      if (index === 0) {
        this._upperLeft.copy(corners[0])
      } else if (index === 2) {
        this._lowerRight.copy(corners[2])
      } else if (index === 1) {
        this._upperLeft.y = corners[1].y
        this._lowerRight.x = corners[1].x
        this._upperLeft.z = corners[1].z
        this._lowerRight.z = corners[1].z
      } else if (index === 3) {
        this._upperLeft.x = corners[3].x
        this._lowerRight.y = corners[3].y
        this._upperLeft.z = corners[3].z
        this._lowerRight.z = corners[3].z
      }
    })
    return this
  }

  /**
   * Gets object snap points for this OLE frame.
   */
  subGetOsnapPoints(
    osnapMode: AcDbOsnapMode,
    pickPoint: AcGePoint3dLike,
    _lastPoint: AcGePoint3dLike,
    snapPoints: AcGePoint3dLike[]
  ) {
    if (osnapMode === AcDbOsnapMode.Insertion) {
      snapPoints.push(this._upperLeft.clone())
      return
    }

    const vertices = this.boundaryPath().slice(0, 4)
    if (osnapMode === AcDbOsnapMode.EndPoint) {
      snapPoints.push(...vertices)
      return
    }

    acdbCollectVertexPathOsnapPoints(
      vertices,
      true,
      osnapMode,
      pickPoint,
      snapPoints
    )
  }

  /**
   * Transforms this OLE frame by the specified matrix.
   */
  transformBy(matrix: AcGeMatrix3d) {
    const signedWidth = this._lowerRight.x - this._upperLeft.x
    const signedHeight = this._upperLeft.y - this._lowerRight.y
    const cos = Math.cos(this._rotation)
    const sin = Math.sin(this._rotation)
    const origin = this._upperLeft.clone()
    const uPoint = origin
      .clone()
      .add(new AcGeVector3d(signedWidth * cos, signedWidth * sin, 0))
    const vPoint = origin
      .clone()
      .add(new AcGeVector3d(signedHeight * sin, -signedHeight * cos, 0))

    origin.applyMatrix4(matrix)
    uPoint.applyMatrix4(matrix)
    vPoint.applyMatrix4(matrix)

    const transformedU = new AcGeVector3d().subVectors(uPoint, origin)
    const transformedV = new AcGeVector3d().subVectors(vPoint, origin)

    this._upperLeft.copy(origin)
    this._rotation = Math.atan2(transformedU.y, transformedU.x)
    this._lowerRight.set(
      origin.x + transformedU.length(),
      origin.y - transformedV.length(),
      origin.z
    )
    return this
  }

  /**
   * Gets the image blob extracted from the embedded OLE object, when the
   * payload contains a recognizable bitmap / PNG / JPEG / WMF / EMF
   * presentation.
   *
   * Metafile blobs use MIME types `image/wmf` or `image/emf` and must be
   * rasterized by the host renderer (see {@link acdbRasterizeOleMetafile})
   * before WebGL texturing.
   *
   * Extraction is performed lazily on first access and cached until the OLE
   * binary payload changes.
   */
  get image(): Blob | undefined {
    return this.resolveImage()
  }

  /**
   * Draws the embedded OLE picture when an image can be extracted from the
   * OLE binary payload; otherwise draws a pickable rectangular frame
   * (transparent fill + outline).
   *
   * Excel OLE previews typically arrive as WMF/EMF metafile blobs. Renderers
   * that accept those MIME types (and rasterize them) will show the table
   * picture; others should treat metafiles like missing images.
   */
  subWorldDraw(renderer: AcGiRenderer) {
    const image = this.resolveImage()
    const points = this.imageBoundaryPath()
    if (image) {
      return renderer.image(image, {
        boundary: points,
        roation: this._rotation
      })
    }
    return acdbDrawImageFrame(renderer, this.boundaryPath())
  }

  /** @inheritdoc */
  protected override onOleObjectChanged() {
    this._image = undefined
    this._imageResolved = false
    this.applyGeometryFromOleObjectData()
  }

  /**
   * Applies frame corners from the OLE2FRAME binary geometry header when
   * present.
   *
   * AutoCAD stores the drawable rectangle inside the OLE payload (the first
   * 0x80 bytes before the MS-CFB document). DWG parsers often expose only the
   * raw blob, and DXF group codes 10/11 are documented as derived from that
   * header — so recovering corners here keeps OLE frames visible for both
   * paths.
   */
  private applyGeometryFromOleObjectData() {
    const header = acdbParseOle2FrameGeometryHeader(this.oleObjectData)
    if (!header) {
      return
    }
    this._upperLeft.copy(header.upperLeft)
    this._lowerRight.copy(header.lowerRight)
  }

  private resolveImage(): Blob | undefined {
    if (this._imageResolved) {
      return this._image
    }
    this._imageResolved = true
    this._image = acdbExtractOleImageBlob(this.oleObjectData)
    return this._image
  }

  /**
   * Image quad in the same corner order as {@link AcDbRasterImage}:
   * lower-left, lower-right, upper-right, upper-left, then close.
   */
  private imageBoundaryPath(): AcGePoint3d[] {
    const frame = this.boundaryPath()
    const points = [frame[3], frame[2], frame[1], frame[0]]

    points.push(points[0].clone())
    return points
  }

  /**
   * Writes DXF fields for this OLE 2 frame.
   *
   * Emits the `AcDbOle2Frame` subclass marker and Autodesk OLE2FRAME group
   * codes. Entity-level fields come from {@link AcDbEntity.dxfOutFields};
   * {@link AcDbOleFrame} fields are skipped because OLE2FRAME uses its own
   * layout.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   * @see https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-DXF/files/GUID-77747CE6-82C6-4452-97ED-4CEEB38BE960.htm
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    AcDbEntity.prototype.dxfOutFields.call(this, filer)
    filer.writeSubclassMarker('AcDbOle2Frame')
    filer.writeInt16(70, this.oleVersion)
    if (this._userType) {
      filer.writeString(3, this._userType)
    }
    filer.writePoint3d(10, this._upperLeft)
    filer.writePoint3d(11, this._lowerRight)
    filer.writeInt16(71, this._oleObjectType)
    filer.writeInt16(72, this._tileMode)
    if (this._outputQuality) {
      filer.writeInt16(73, this._outputQuality)
    }
    const oleObject = this.getOleObject()
    if (oleObject?.length) {
      filer.writeInt32(90, oleObject.length)
      let index = 0
      while (index < oleObject.length) {
        const chunk = oleObject.subarray(index, index + 127)
        filer.writeString(310, acdbBytesToHexString(chunk))
        index += 127
      }
    }
    filer.writeString(1, 'OLE')
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    // OLE2FRAME uses AcDbEntity fields, not AcDbOleFrame layout.
    AcDbEntity.prototype.dxfInFields.call(this, filer)
    filer.atSubclassData('AcDbOle2Frame')

    let ulx = this._upperLeft.x
    let uly = this._upperLeft.y
    let ulz = this._upperLeft.z
    let lrx = this._lowerRight.x
    let lry = this._lowerRight.y
    let lrz = this._lowerRight.z
    // ASCII readers may leave hex as string; typed binary pairs yield Uint8Array.
    const dataChunks: Array<string | Uint8Array> = []
    let dataLength: number | undefined

    const commit = () => {
      this.upperLeftCorner = new AcGePoint3d(ulx, uly, ulz)
      this.lowerRightCorner = new AcGePoint3d(lrx, lry, lrz)
      if (dataChunks.length > 0) {
        this.loadOleObjectFromDxf(
          dataLength,
          acdbCombineDxfBinaryChunks(dataChunks)
        )
      }
    }

    while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
      const item = filer.readItem()
      if (!item) break
      const code = Number(item.code)
      const n = Number(item.value)
      switch (code) {
        case 1:
          // Marker "OLE".
          break
        case 3:
          this.userType = String(item.value)
          break
        case 10:
          ulx = n
          break
        case 20:
          uly = n
          break
        case 30:
          ulz = n
          break
        case 11:
          lrx = n
          break
        case 21:
          lry = n
          break
        case 31:
          lrz = n
          break
        case 70:
          this.oleVersion = n
          break
        case 71:
          this.oleObjectType = n as AcDbOleObjectType
          break
        case 72:
          this.tileMode = n as AcDbOleTileMode
          break
        case 73:
          this.setOutputQuality(n)
          break
        case 90:
          dataLength = n
          break
        case 310:
          if (item.value instanceof Uint8Array) {
            dataChunks.push(item.value)
          } else {
            dataChunks.push(String(item.value))
          }
          break
        default:
          break
      }
    }

    commit()
    return this
  }

  private cornerUpperRight(): AcGePoint3d {
    return new AcGePoint3d(
      this._lowerRight.x,
      this._upperLeft.y,
      this._upperLeft.z
    )
  }

  private cornerLowerLeft(): AcGePoint3d {
    return new AcGePoint3d(
      this._upperLeft.x,
      this._lowerRight.y,
      this._lowerRight.z
    )
  }

  private boundaryPath(): AcGePoint3d[] {
    const points = [
      this._upperLeft.clone(),
      this.cornerUpperRight(),
      this._lowerRight.clone(),
      this.cornerLowerLeft()
    ]

    if (this._rotation !== 0) {
      const origin = this._upperLeft
      for (let index = 1; index < points.length; index++) {
        points[index]
          .sub(origin)
          .applyMatrix4(new AcGeMatrix3d().makeRotationZ(this._rotation))
        points[index].add(origin)
      }
    }

    // Closed path for line rendering
    points.push(points[0].clone())
    return points
  }

  private syncHeightFromAspect() {
    const width = this.wcsWidth()
    if (width === 0 || this._scaleWidth === 0) return
    const aspect = this._scaleHeight / this._scaleWidth
    const height = width * aspect
    const sign = this._upperLeft.y >= this._lowerRight.y ? 1 : -1
    this._lowerRight.y = this._upperLeft.y - sign * Math.abs(height)
  }

  private syncWidthFromAspect() {
    const height = this.wcsHeight()
    if (height === 0 || this._scaleHeight === 0) return
    const aspect = this._scaleWidth / this._scaleHeight
    const width = height * aspect
    const sign = this._lowerRight.x >= this._upperLeft.x ? 1 : -1
    this._lowerRight.x = this._upperLeft.x + sign * Math.abs(width)
  }
}
