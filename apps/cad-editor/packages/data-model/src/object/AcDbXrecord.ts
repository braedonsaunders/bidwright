import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbObject } from '../base/AcDbObject'
import { AcDbResultBuffer } from '../base/AcDbResultBuffer'

/**
 * Defines how duplicate records are handled when objects
 * are cloned into a destination database.
 *
 * @remarks
 * This enum mirrors AcDb::DuplicateRecordCloning in ObjectARX.
 */
export enum AcDbDuplicateRecordCloning {
  /** No special cloning behavior */
  NotApplicable = 0,

  /** Ignore the duplicate record */
  Ignore = 1,

  /** Replace the existing record */
  Replace = 2,

  /** Mangle the name when coming from an external reference */
  XrefMangleName = 3,

  /** Always mangle the name to avoid conflicts */
  MangleName = 4
}

/**
 * Represents an Xrecord object used to store arbitrary
 * application-defined data.
 *
 * @remarks
 * An Xrecord is typically stored in an extension dictionary
 * and contains an {@link AcDbResultBuffer}.
 */
export class AcDbXrecord extends AcDbObject {
  private _data: AcDbResultBuffer | null = null
  /** Duplicate-record cloning flag read from/written to DXF group 280. */
  private _cloningFlag?: AcDbDuplicateRecordCloning

  /**
   * Gets or sets the data stored in this Xrecord.
   *
   * @remarks
   * Equivalent to the Xrecord.Data property in AutoCAD .NET.
   */
  get data(): AcDbResultBuffer | null {
    return this._data
  }

  set data(value: AcDbResultBuffer | null) {
    this._data = value
  }

  /**
   * Removes all data from this Xrecord.
   */
  clear(): void {
    this._data?.clear()
  }

  /**
   * Creates a deep copy of this Xrecord.
   *
   * @remarks
   * The cloned Xrecord contains a cloned ResultBuffer.
   */
  override clone(): this {
    return super.clone()
  }

  /**
   * Returns the duplicate record cloning behavior for this Xrecord.
   *
   * @remarks
   * This method exists for API parity with ObjectARX.
   */
  getDuplicateRecordCloning(): AcDbDuplicateRecordCloning {
    return this._cloningFlag ?? AcDbDuplicateRecordCloning.NotApplicable
  }

  /**
   * Sets the duplicate record cloning behavior for this Xrecord
   * (DXF group 280).
   */
  setDuplicateRecordCloning(value: AcDbDuplicateRecordCloning): void {
    this._cloningFlag = value
  }

  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbXrecord')
    filer.writeInt16(
      280,
      this._cloningFlag ?? AcDbDuplicateRecordCloning.Ignore
    )
    filer.writeResultBuffer(this.data)
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    filer.atSubclassData('AcDbXrecord')

    const buffer = new AcDbResultBuffer()
    while (!filer.atEndOfObject && !filer.atEof) {
      const item = filer.readItem()
      if (!item) break
      const code = Number(item.code)
      if (code === 1001 || (code >= 1000 && code <= 1071)) {
        // Trailing XData belongs to the object wrapper.
        filer.pushBackItem(item)
        break
      }
      if (code === 100) {
        filer.pushBackItem(item)
        break
      }
      switch (code) {
        case 280:
          // Duplicate-record cloning flag (AcDb::DuplicateRecordCloning).
          this._cloningFlag = Number(item.value) as AcDbDuplicateRecordCloning
          break
        default:
          buffer.add({ code: item.code, value: item.value })
          break
      }
    }
    this._data = buffer.length > 0 ? buffer : null
    return this
  }
}
