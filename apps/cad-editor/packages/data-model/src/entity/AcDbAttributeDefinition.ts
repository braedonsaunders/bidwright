import { AcGiEntity, AcGiRenderer } from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbMText } from './AcDbMText'
import { AcDbText } from './AcDbText'
/**
 * Attribute definition flags.
 *
 * These flags control visibility, editability, prompting behavior,
 * and verification requirements of an attribute.
 */
export enum AcDbAttributeFlags {
  /** Attribute is invisible (not displayed). */
  Invisible = 0x1,

  /** Attribute is constant and cannot be modified per block reference. */
  Const = 0x2,

  /** Attribute requires verification on user input. */
  Verifiable = 0x4,

  /** Attribute has a preset value and does not prompt during insertion. */
  Preset = 0x8
}

/**
 * Flags related to multi-line (MText-based) attributes.
 */
export enum AcDbAttributeMTextFlag {
  /** Attribute is represented as multi-line text (MText). */
  MultiLine = 0x2,

  /** Multi-line attribute is constant. */
  ConstMultiLine = 0x4
}

/**
 * Represents an attribute definition attached to a block definition.
 *
 * This class closely follows the behavior and semantics of
 * `AcDbAttributeDefinition` in AutoCAD ObjectARX.
 */
export class AcDbAttributeDefinition extends AcDbText {
  /** The DXF entity type name. */
  static override typeName: string = 'AttDef'

  override get dxfTypeName() {
    return 'ATTDEF'
  }

  /**
   * Attribute behavior flags.
   * @see AcDbAttributeFlags
   */
  private _flags: number

  /**
   * Multi-line attribute flags.
   * @see AcDbAttributeMTextFlag
   */
  private _mtextFlag: number

  /** Attribute tag string (identifier). */
  private _tag: string

  /**
   * Prompt string displayed during block insertion.
   *
   * This value is inherited from the corresponding
   * `AcDbAttributeDefinition` and is used to prompt the user
   * for input when the block is inserted.
   */
  private _prompt: string

  /**
   * Field length value.
   *
   * This value is preserved for compatibility but is not actively
   * used by AutoCAD.
   */
  private _fieldLength: number

  /**
   * Indicates whether the attribute position is locked relative
   * to the block geometry.
   */
  private _lockPositionInBlock: boolean

  /**
   * Indicates whether the attribute is currently locked.
   */
  private _isReallyLocked: boolean

  /**
   * Internal MText representation for multi-line attributes.
   * Undefined for single-line attributes.
   */
  private _mtext?: AcDbMText

  constructor() {
    super()
    this._flags = 0
    this._prompt = ''
    this._mtextFlag = 0
    this._tag = ''
    this._fieldLength = 0
    this._lockPositionInBlock = false
    this._isReallyLocked = false
  }

  /**
   * Gets whether the attribute is invisible.
   */
  get isInvisible(): boolean {
    return (this._flags & AcDbAttributeFlags.Invisible) !== 0
  }

  /**
   * Sets whether the attribute is invisible.
   */
  set isInvisible(value: boolean) {
    if (value) {
      this._flags |= AcDbAttributeFlags.Invisible
    } else {
      this._flags &= ~AcDbAttributeFlags.Invisible
    }
  }

  /**
   * Gets the prompt string displayed during block insertion.
   *
   * This prompt is shown to the user when the attribute is created
   * from an attribute definition, unless the attribute is preset.
   */
  get prompt(): string {
    return this._prompt
  }

  /**
   * Sets the prompt string displayed during block insertion.
   *
   * DXF group code: 3
   */
  set prompt(value: string) {
    this._prompt = value
  }

  /**
   * Gets whether the attribute is constant.
   */
  get isConst(): boolean {
    return (this._flags & AcDbAttributeFlags.Const) !== 0
  }

  /**
   * Sets whether the attribute is constant.
   */
  set isConst(value: boolean) {
    if (value) {
      this._flags |= AcDbAttributeFlags.Const
    } else {
      this._flags &= ~AcDbAttributeFlags.Const
    }
  }

  /**
   * Gets whether the attribute requires verification on input.
   */
  get isVerifiable(): boolean {
    return (this._flags & AcDbAttributeFlags.Verifiable) !== 0
  }

  /**
   * Sets whether the attribute requires verification on input.
   */
  set isVerifiable(value: boolean) {
    if (value) {
      this._flags |= AcDbAttributeFlags.Verifiable
    } else {
      this._flags &= ~AcDbAttributeFlags.Verifiable
    }
  }

  /**
   * Gets whether the attribute has a preset value and does not prompt
   * the user during block insertion.
   */
  get isPreset(): boolean {
    return (this._flags & AcDbAttributeFlags.Preset) !== 0
  }

  /**
   * Sets whether the attribute has a preset value.
   */
  set isPreset(value: boolean) {
    if (value) {
      this._flags |= AcDbAttributeFlags.Preset
    } else {
      this._flags &= ~AcDbAttributeFlags.Preset
    }
  }

  /**
   * Gets whether this attribute is a multi-line (MText-based) attribute.
   */
  get isMTextAttribute(): boolean {
    return (this._mtextFlag & AcDbAttributeMTextFlag.MultiLine) !== 0
  }

  /**
   * Sets whether this attribute is a multi-line (MText-based) attribute.
   */
  set isMTextAttribute(value: boolean) {
    if (value) {
      this._mtextFlag |= AcDbAttributeMTextFlag.MultiLine
    } else {
      this._mtextFlag &= ~AcDbAttributeMTextFlag.MultiLine
    }
  }

  /**
   * Gets whether this attribute is a constant multi-line attribute.
   */
  get isConstMTextAttribute(): boolean {
    return (this._mtextFlag & AcDbAttributeMTextFlag.ConstMultiLine) !== 0
  }

  /**
   * Sets whether this attribute is a constant multi-line attribute.
   */
  set isConstMTextAttribute(value: boolean) {
    if (value) {
      this._mtextFlag |= AcDbAttributeMTextFlag.ConstMultiLine
    } else {
      this._mtextFlag &= ~AcDbAttributeMTextFlag.ConstMultiLine
    }
  }

  /**
   * Gets the attribute tag.
   *
   * The tag uniquely identifies the attribute within a block.
   */
  get tag(): string {
    return this._tag
  }

  /**
   * Sets the attribute tag.
   */
  set tag(value: string) {
    this._tag = value
  }

  /**
   * Gets the attribute field length.
   *
   * This value is not currently used by AutoCAD.
   */
  get fieldLength(): number {
    return this._fieldLength
  }

  /**
   * Sets the attribute field length.
   */
  set fieldLength(value: number) {
    this._fieldLength = value
  }

  /**
   * Gets whether the attribute position is locked relative to
   * the block geometry.
   */
  get lockPositionInBlock(): boolean {
    return this._lockPositionInBlock
  }

  /**
   * Sets whether the attribute position is locked relative to
   * the block geometry.
   */
  set lockPositionInBlock(value: boolean) {
    this._lockPositionInBlock = value
  }

  /**
   * Gets whether the attribute is currently locked.
   */
  get isReallyLocked(): boolean {
    return this._isReallyLocked
  }

  /**
   * Sets whether the attribute is currently locked.
   */
  set isReallyLocked(value: boolean) {
    this._isReallyLocked = value
  }

  /**
   * Gets the internal `AcDbMText` used to represent this attribute
   * when it is a multi-line attribute.
   *
   * Returns `undefined` for single-line attributes.
   */
  get mtext(): AcDbMText | undefined {
    return this._mtext
  }

  /**
   * Sets the internal `AcDbMText` used to represent this attribute
   * as a multi-line attribute.
   *
   * Setting this value automatically marks the attribute as
   * a multi-line attribute.
   */
  set mtext(value: AcDbMText | undefined) {
    this._mtext = value
    this.isMTextAttribute = value != null
  }

  /**
   * Returns true when this ATTDEF is loose in model/paper space rather than
   * stored inside a named block definition.
   *
   * Fail closed when ownership cannot be resolved to a block table record.
   * DWG import may reassign a BTR handle after entities are appended (handle
   * collision), leaving ATTDEF.ownerId pointing at a non-BTR object. Treating
   * that as "loose" would draw attribute tags into the block render cache and
   * overlap INSERT ATTRIB values.
   */
  private isLooseInDrawingSpace(): boolean {
    const db = this.database
    if (!db) {
      return false
    }
    const ownerId = this.getAttrWithoutException('ownerId')
    if (!ownerId) {
      return false
    }
    const owner = db.tables.blockTable.getIdAt(ownerId)
    if (!owner) {
      return false
    }
    return owner.isModelSapce || owner.isPaperSapce
  }

  /**
   * Resolves the on-screen glyph for this ATTDEF.
   *
   * - Invisible: not drawn
   * - Loose in model/paper space: tag (placeholder while editing)
   * - Constant (or constant MText) inside a block: default value is geometry
   * - Non-constant inside a block: not drawn — INSERT ATTRIB supplies the value
   */
  private resolveDisplayText(): string | undefined {
    if (this.isInvisible) {
      return undefined
    }
    if (this.isLooseInDrawingSpace()) {
      return this.tag || this.textString
    }
    if (this.isConst || this.isConstMTextAttribute) {
      return this.textString
    }
    // Non-constant template ATTDEF: the INSERT's ATTRIB draws the value.
    return undefined
  }

  /**
   * Draws an attribute definition following AutoCAD ATTDEF semantics.
   *
   * Loose definitions in model/paper space show the tag. Constant definitions
   * inside a block show the default value. Non-constant definitions inside a
   * block are not drawn (INSERT ATTRIB draws the value). Invisible definitions
   * are not drawn.
   *
   * @param renderer - The renderer to use for drawing
   * @param delay - When true, the renderer may defer heavy work
   * @returns The rendered text entity, or undefined when not drawn
   */
  override subWorldDraw(
    renderer: AcGiRenderer,
    delay?: boolean
  ): AcGiEntity | undefined {
    const display = this.resolveDisplayText()
    if (display === undefined) {
      return undefined
    }

    if (display === this.textString) {
      return super.subWorldDraw(renderer, delay)
    }

    const saved = this.textString
    this.textString = display
    try {
      return super.subWorldDraw(renderer, delay)
    } finally {
      this.textString = saved
    }
  }
  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbAttributeDefinition')
    filer.writeString(3, this.prompt)
    filer.writeString(2, this.tag)
    // Group 70: Invisible | Constant | Verifiable | Preset bit flags
    filer.writeInt16(70, this._flags)
    filer.writeInt16(73, this.fieldLength)
    // Group 74: lock position within the block (not isReallyLocked)
    filer.writeInt16(74, this.lockPositionInBlock ? 1 : 0)
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    filer.atSubclassData('AcDbAttributeDefinition')

    while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
      const item = filer.readItem()
      if (!item) break
      const code = Number(item.code)
      const n = Number(item.value)
      switch (code) {
        case 2:
          this.tag = String(item.value)
          break
        case 3:
          this.prompt = String(item.value)
          break
        case 70:
          this.isInvisible = (n & AcDbAttributeFlags.Invisible) !== 0
          this.isConst = (n & AcDbAttributeFlags.Const) !== 0
          this.isVerifiable = (n & AcDbAttributeFlags.Verifiable) !== 0
          this.isPreset = (n & AcDbAttributeFlags.Preset) !== 0
          break
        case 71:
          this.isMTextAttribute =
            (n & AcDbAttributeMTextFlag.MultiLine) !== 0
          this.isConstMTextAttribute =
            (n & AcDbAttributeMTextFlag.ConstMultiLine) !== 0
          break
        case 73:
          this.fieldLength = n
          break
        case 74:
          // DXF: vertical text justification for ATTDEF.
          this.verticalMode = n
          break
        case 280:
          this.lockPositionInBlock = n !== 0
          break
        case 340:
          // Soft-pointer ID to FIELD object — optional; keep scanning.
          break
        default:
          break
      }
    }
    return this
  }
}
