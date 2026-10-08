import { AcDbEntity } from './AcDbEntity'

/**
 * Abstract base class for OLE container entities.
 *
 * {@link AcDbFrame} is the ObjectARX base class for {@link AcDbOleFrame} and
 * {@link AcDbOle2Frame}. Applications typically use {@link AcDbOle2Frame}
 * rather than this class directly.
 *
 * @see https://help.autodesk.com/view/OARX/2024/ENU/?guid=OARX-RefGuide-AcDbFrame
 */
export abstract class AcDbFrame extends AcDbEntity {
  /** The entity type name */
  static override typeName: string = 'Frame'
}
