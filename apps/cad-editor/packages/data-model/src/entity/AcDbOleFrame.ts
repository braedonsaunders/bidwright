import { AcGeBox3d } from '@mlightcad/geometry-engine'
import { AcGiEntity, AcGiRenderer } from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import {
  acdbBytesToHexString,
  acdbCombineDxfBinaryChunks
} from '../misc/proxyGraphic'
import {
  AcDbEntityProperties,
  AcDbEntityPropertyGroup
} from './AcDbEntityProperties'
import { AcDbFrame } from './AcDbFrame'

/**
 * Represents a legacy OLE 1 frame entity in AutoCAD.
 *
 * {@link AcDbOleFrame} stores the raw OLE binary payload for an embedded OLE
 * object. Prefer {@link AcDbOle2Frame} for OLE 2 objects, which also expose
 * frame geometry and display attributes.
 *
 * @see https://help.autodesk.com/view/OARX/2024/ENU/?guid=OARX-RefGuide-AcDbOleFrame
 * @see https://help.autodesk.com/view/OARX/2024/ENU/?guid=OARX-RefGuide-__MEMBERTYPE_Methods_AcDbOleFrame
 *
 * @example
 * ```typescript
 * const oleFrame = new AcDbOleFrame()
 * oleFrame.oleVersion = 1
 * oleFrame.setOleObject(binaryPayload)
 * ```
 */
export class AcDbOleFrame extends AcDbFrame {
  /** The entity type name */
  static override typeName: string = 'OleFrame'

  override get dxfTypeName() {
    return 'OLEFRAME'
  }

  /** OLE version number (DXF group code 70). */
  private _oleVersion = 0
  /** Raw OLE binary payload. */
  private _oleObject?: Uint8Array

  /**
   * Creates a new OLE 1 frame entity.
   *
   * Objects created with this constructor must receive a valid OLE payload
   * through {@link setOleObject} before they represent a complete OLE entity.
   */
  constructor() {
    super()
  }

  /**
   * Gets the OLE version number stored with this frame.
   *
   * Corresponds to DXF group code **70**.
   */
  get oleVersion() {
    return this._oleVersion
  }

  /**
   * Sets the OLE version number stored with this frame.
   *
   * @param value - OLE version number (DXF group code **70**).
   */
  set oleVersion(value: number) {
    this._oleVersion = value
  }

  /**
   * Returns the raw OLE object data associated with this frame.
   *
   * Mirrors ObjectARX `AcDbOleFrame::getOleObject`. In this TypeScript port the
   * payload is exposed as a byte array rather than an opaque MFC pointer.
   *
   * @returns A copy of the stored OLE bytes, or `undefined` when unset.
   */
  getOleObject(): Uint8Array | undefined {
    return this._oleObject ? new Uint8Array(this._oleObject) : undefined
  }

  /**
   * Sets the raw OLE object data associated with this frame.
   *
   * Mirrors ObjectARX `AcDbOleFrame::setOleObject`. The supplied buffer is
   * copied so later mutations of the caller's array do not affect this entity.
   *
   * @param value - OLE binary payload, or `null`/`undefined` to clear.
   */
  setOleObject(value?: Uint8Array | ArrayBuffer | null) {
    if (value == null) {
      this._oleObject = undefined
    } else {
      this._oleObject =
        value instanceof ArrayBuffer
          ? new Uint8Array(value.slice(0))
          : new Uint8Array(value)
    }
    this.onOleObjectChanged()
  }

  /**
   * Loads OLE binary data from DXF group codes **90** / **310**.
   *
   * @param length - Expected byte length from group code **90**.
   * @param data - Decoded binary payload (already converted from hex chunks).
   */
  loadOleObjectFromDxf(length: number | undefined, data?: Uint8Array | null) {
    if (!data?.length) {
      this._oleObject = undefined
    } else if (length != null && length > 0 && length < data.length) {
      this._oleObject = data.subarray(0, length)
    } else {
      this._oleObject = new Uint8Array(data)
    }
    this.onOleObjectChanged()
  }

  /**
   * Raw OLE payload retained by this frame (no copy).
   *
   * Subclasses use this for decoding presentation data without cloning the
   * buffer on every draw.
   */
  protected get oleObjectData(): Uint8Array | undefined {
    return this._oleObject
  }

  /**
   * Hook invoked when the OLE binary payload changes.
   *
   * Subclasses override this to invalidate cached presentation images.
   */
  protected onOleObjectChanged() {}

  /**
   * Returns property-group metadata for OLE-frame-specific attributes
   * (currently the OLE version number).
   *
   * Subclasses such as {@link AcDbOle2Frame} merge these properties into their
   * own `ole` group.
   */
  protected getOleProperties(): AcDbEntityPropertyGroup {
    return {
      groupName: 'ole',
      properties: [
        {
          name: 'oleVersion',
          type: 'int',
          editable: true,
          accessor: {
            get: () => this.oleVersion,
            set: (v: number) => {
              this.oleVersion = v
            }
          }
        }
      ]
    }
  }

  /**
   * Returns the full property definition for this OLE frame entity, including
   * the general group and OLE-specific attributes.
   */
  get properties(): AcDbEntityProperties {
    return {
      type: this.type,
      groups: [this.getGeneralProperties(), this.getOleProperties()]
    }
  }

  /**
   * Gets the geometric extents of this OLE frame.
   *
   * Legacy OLEFRAME entities do not store independent corner geometry in DXF;
   * an empty box is returned unless a subclass overrides this property.
   */
  get geometricExtents(): AcGeBox3d {
    return new AcGeBox3d()
  }

  /**
   * Draws this OLE frame.
   *
   * Legacy OLE 1 frames have no drawable geometry outside the embedded OLE
   * payload, which is not rendered here.
   *
   * @param _renderer - Target graphics renderer.
   */
  subWorldDraw(_renderer: AcGiRenderer): AcGiEntity | undefined {
    return undefined
  }

  /**
   * Writes DXF fields for this OLE frame.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   * @see https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-DXF/files/GUID-4A10EF68-35A3-4961-8B15-1222ECE5E8C6.htm
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbOleFrame')
    filer.writeInt16(70, this._oleVersion)
    if (this._oleObject?.length) {
      filer.writeInt32(90, this._oleObject.length)
      let index = 0
      while (index < this._oleObject.length) {
        const chunk = this._oleObject.subarray(index, index + 127)
        filer.writeString(310, acdbBytesToHexString(chunk))
        index += 127
      }
    }
    filer.writeString(1, 'OLE')
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    filer.atSubclassData('AcDbOleFrame')

    // ASCII readers may leave hex as string; typed binary pairs yield Uint8Array.
    const dataChunks: Array<string | Uint8Array> = []
    let dataLength: number | undefined

    const commit = () => {
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
          // Marker string "OLE" — ignore.
          break
        case 70:
          this.oleVersion = n
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
}
