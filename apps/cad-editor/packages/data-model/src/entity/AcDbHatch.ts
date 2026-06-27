import { AcCmColor, AcCmColorMethod, AcCmTransparency } from '@mlightcad/common'
import {
  AcGeArea2d,
  AcGeBox3d,
  AcGeCircArc2d,
  AcGeEllipseArc2d,
  AcGeIndexNode,
  AcGeLine2d,
  AcGeLoop2d,
  AcGeLoop2dType,
  AcGeMatrix2d,
  AcGeMatrix3d,
  AcGePoint2d,
  AcGePoint3d,
  AcGePoint3dLike,
  AcGePolyline2d,
  AcGeSpline3d,
  AcGeVector3dLike
} from '@mlightcad/geometry-engine'
import {
  AcGiHatchPatternLine,
  AcGiRenderer
} from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import type { AcDbDatabase } from '../database/AcDbDatabase'
import { AcDbSystemVariables } from '../database/AcDbSystemVariables'
import { AcDbSysVarManager } from '../database/AcDbSysVarManager'
import {
  DEFAULT_GRADIENT_HATCH_NAME,
  HATCH_PATTERN_SOLID,
  HATCH_PATTERN_USER
} from '../misc/AcDbConstants'
import { AcDbOsnapMode } from '../misc/AcDbOsnapMode'
import { AcDbPredefinedAcadIsoPat } from '../misc/pat/AcDbPatPredefined'
import { AcDbEntity } from './AcDbEntity'
import { AcDbEntityProperties } from './AcDbEntityProperties'
import {
  acdbForEachGripIndex,
  acdbMovePolyline2dVertexAt
} from './AcDbGripHelpers'
import {
  acdbCollectPolyline2dSegmentOsnapPoints,
  acdbPickNearestOsnapPoint
} from './AcDbOsnapHelpers'

/**
 * Defines the type of hatch pattern.
 */
export enum AcDbHatchPatternType {
  /**
   * A user-defined pattern provides a direct method to define a simple hatch pattern using a specified
   * hatch entity linetype. The definition data for user-defined hatch pattern include angle, space and
   * double. "Angle" specifies an angle for the hatch pattern relative to the X axis of the hatch plane
   * in OCS. "Space" defines the vertical distance between two consecutive pattern lines. "Double"
   * specifies that a second set of lines is to be drawn at 90 degrees to the original lines. When
   * specifying a user-defined hatch pattern, you don't need to set the pattern name. AutoCAD designates
   * a default pattern name "U" for all user-defined patterns.
   */
  UserDefined = 0,
  /**
   * A predefined pattern type allows you to select a hatch pattern from the AutoCAD standard hatch
   * pattern file acad.pat in the "support" directory. The file contains many predefined hatch patterns,
   * including ANGLE, ANSI31, BRICK, CLAY, etc. When you use a predefined pattern, you can also specify
   * a scale and angle in order to modify the hatch's appearance. Solid fill is a new predefined pattern
   * type that enables the application to fill in the hatch area with a specified color. The reserved
   * name for this new pattern is "SOLID." SOLID does not appear in the file acad.pat because it has no
   * definition data. To specify a solid, use the keyword "SOLID".
   */
  Predefined = 1,
  /**
   * A custom-defined pattern type stores the pattern in its own PAT file, in which the name of the
   * hatch pattern must match the name of the file. For instance, you must store the TEST hatch pattern
   * in a file named test.pat, and the file must be located in the ACAD search path. When you use a
   * custom-defined pattern, you can also specify a scale and angle in order to modify the hatch's
   * appearance.
   */
  Custom = 2
}

/**
 * Defines the hatch style for determining which areas to hatch.
 */
export enum AcDbHatchStyle {
  /**
   * Normal hatch style will hatch inward from the outer loop. If it encounters an internal intersection,
   * it turns off hatching until it encounters another intersection. Thus, areas separated from the
   * outside of the hatched area by an odd number of intersections are hatched, while areas separated by
   * an even number of intersections are not.
   */
  Normal = 0,
  /**
   * Outer hatch style will hatch inward from the outer loop. It turns off hatching if it encounters an
   * intersection and does not turn it back on. Because this process starts from both ends of each hatch
   * line, only the outmost level of the structure is hatched, and the internal structure is left blank.
   */
  Outer = 1,
  /**
   * Ignore hatch style will hatch inward from the outer loop and ignores all internal loops.
   */
  Ignore = 2
}

export enum AcDbHatchObjectType {
  /**
   * Indicates that the object is currently a classic hatch
   */
  HatchObject = 0,
  /**
   * Indicates that the object is currently a color gradient
   */
  GradientObject = 1
}

export type AcDbGradientName =
  | 'LINEAR'
  | 'CYLINDER'
  | 'INVCYLINDER'
  | 'SPHERICAL'
  | 'INVSPHERICAL'
  | 'HEMISPHERICAL'
  | 'INVHEMISPHERICAL'
  | 'CURVED'
  | 'INVCURVED'

/**
 * Defines the gradient pattern type for hatch.
 */
export enum AcDbGradientPatternType {
  /**
   * Indicates that the gradient name refers to one of the predefined gradient patterns
   */
  PreDefinedGradient = 0,
  /**
   * Indicates that the gradient name refers to one of the user-defined gradient patterns.
   */
  UserDefinedGradient = 1
}

/**
 * Represents a hatch entity in AutoCAD.
 *
 * A hatch is a 2D geometric object that fills an area with a pattern of lines, dots, or other shapes.
 * Hatches are commonly used to represent materials, textures, or to distinguish different areas in drawings.
 *
 * @example
 * ```typescript
 * // Create a hatch entity
 * const hatch = new AcDbHatch();
 * hatch.patternName = "ANSI31";
 * hatch.patternType = AcDbHatchPatternType.Predefined;
 * hatch.patternScale = 1.0;
 * hatch.patternAngle = 0;
 * hatch.hatchStyle = AcDbHatchStyle.Normal;
 *
 * // Add a loop to define the hatch boundary
 * const loop = new AcGeLoop2d();
 * loop.add(new AcGePoint2d(0, 0));
 * loop.add(new AcGePoint2d(10, 0));
 * loop.add(new AcGePoint2d(10, 5));
 * loop.add(new AcGePoint2d(0, 5));
 * hatch.add(loop);
 *
 * // Access hatch properties
 * console.log(`Pattern name: ${hatch.patternName}`);
 * console.log(`Pattern scale: ${hatch.patternScale}`);
 * ```
 */
export class AcDbHatch extends AcDbEntity {
  /** The entity type name */
  static override typeName: string = 'Hatch'

  override get dxfTypeName() {
    return 'HATCH'
  }

  /** The underlying geometric area object */
  private _geo: AcGeArea2d
  /** The flag to indicate whether the hatch object is configured for solid fill */
  private _isSolidFill: boolean
  /** The elevation (Z-coordinate) of the hatch plane */
  private _elevation: number
  /** The definition lines for the hatch pattern */
  private _definitionLines: AcGiHatchPatternLine[]
  /** Whether current definition lines were generated from a predefined PAT entry. */
  private _definitionLinesAutoGenerated: boolean
  /** Pattern name used for the current auto-generated definition lines. */
  private _definitionLinesPatternName: string
  /** Pattern scale used for the current auto-generated definition lines. */
  private _definitionLinesPatternScale: number
  /** The name of the hatch pattern */
  private _patternName: string
  /** Whether the pattern name was assigned explicitly instead of coming from HPNAME. */
  private _patternNameSet: boolean
  /** The type of hatch pattern */
  private _patternType: AcDbHatchPatternType
  /** The angle of the hatch pattern in radians */
  private _patternAngle: number
  /** Whether the pattern angle was assigned explicitly instead of coming from HPANG. */
  private _patternAngleSet: boolean
  /** The scale factor for the hatch pattern */
  private _patternScale: number
  /** Whether the pattern scale was assigned explicitly instead of coming from HPSCALE. */
  private _patternScaleSet: boolean
  /** Whether this hatch is associated with its defining boundary objects. */
  private _associative: boolean
  /** Whether associativity was assigned explicitly instead of coming from HPASSOC. */
  private _associativeSet: boolean
  /** Optional background color for hatch patterns. */
  private _backgroundColor?: AcCmColor
  /** Whether the background color was assigned explicitly instead of coming from HPBACKGROUNDCOLOR. */
  private _backgroundColorSet: boolean
  /** Whether user-defined hatch pattern doubling is enabled. */
  private _patternDouble: boolean
  /** Whether pattern doubling was assigned explicitly instead of coming from HPDOUBLE. */
  private _patternDoubleSet: boolean
  /** The hatch style for determining which areas to hatch */
  private _hatchStyle: AcDbHatchStyle
  /** Whether the hatch style was assigned explicitly instead of coming from HPISLANDDETECTION. */
  private _hatchStyleSet: boolean
  /**
   * The current state of the gradient object.
   */
  private _hatchObjectType: AcDbHatchObjectType
  /** The angle, in radians, at which the current gradient definition is applied. */
  private _gradientAngle: number = 0
  /**
   * The current interpolation value between the gradient definition's default and shifted
   * values. The default is 0.0f.
   */
  private _gradientShift: number
  /**The one-color tint shade (luminance) value. */
  private _shadeTintValue: number
  /** Optional start color for gradient fill, stored as packed 0xRRGGBB. */
  private _gradientStartColor?: number
  /** Optional end color for gradient fill, stored as packed 0xRRGGBB. */
  private _gradientEndColor?: number
  /** The type of the gradient pattern. */
  private _gradientType: AcDbGradientPatternType
  /** The name of the current gradient. */
  private _gradientName: string
  /**
   * Indicates whether the gradient hatch is transitioning from a start to a stop color (two-color)
   * or from a color to an adjusted luminance version of the same color (one-color). In the latter
   * case, the full luminance version is the "tint" and the zero luminance version is the "shade."
   */
  private _gradientOneColorMode: boolean

  /**
   * Creates a new hatch entity.
   *
   * This constructor initializes a hatch with default values.
   * The elevation is 0, pattern type is Predefined, pattern scale is 1,
   * pattern angle is 0, and hatch style is Normal.
   *
   * @example
   * ```typescript
   * const hatch = new AcDbHatch();
   * hatch.patternName = "ANSI31";
   * hatch.patternScale = 2.0;
   * ```
   */
  constructor() {
    super()
    this._elevation = 0
    this._geo = new AcGeArea2d()
    this._isSolidFill = false
    this._definitionLines = []
    this._definitionLinesAutoGenerated = false
    this._definitionLinesPatternName = ''
    this._definitionLinesPatternScale = 1
    this._patternName = ''
    this._patternNameSet = false
    this._patternType = AcDbHatchPatternType.Predefined
    this._patternAngle = 0
    this._patternAngleSet = false
    this._patternScale = 1
    this._patternScaleSet = false
    this._associative = false
    this._associativeSet = false
    this._backgroundColor = undefined
    this._backgroundColorSet = false
    this._patternDouble = false
    this._patternDoubleSet = false
    this._hatchStyle = AcDbHatchStyle.Normal
    this._hatchStyleSet = false
    this._hatchObjectType = AcDbHatchObjectType.HatchObject
    this._gradientAngle = 0
    this._gradientShift = 0
    this._shadeTintValue = 0
    this._gradientStartColor = undefined
    this._gradientEndColor = undefined
    this._gradientType = AcDbGradientPatternType.PreDefinedGradient
    this._gradientName = ''
    this._gradientOneColorMode = false
  }

  /**
   * Gets whether the hatch object is currently a gradient object.
   */
  get isGradient() {
    return this._hatchObjectType === AcDbHatchObjectType.GradientObject
  }

  /**
   * Gets whether the hatch object is currently using a hatched pattern.
   */
  get isHatch() {
    return this._hatchObjectType === AcDbHatchObjectType.HatchObject
  }

  /**
   * Gets whether the hatch object is configured for solid fill.
   */
  get isSolidFill() {
    return (
      this._isSolidFill ||
      this.getEffectivePatternName().trim().toUpperCase() ===
        HATCH_PATTERN_SOLID
    )
  }
  /**
   * Sets whether the hatch object is configured for solid fill.
   */
  set isSolidFill(value: boolean) {
    this._isSolidFill = value
  }

  /**
   * Gets the effective hatch color.
   *
   * When the hatch does not have an explicit entity color, hatch color follows
   * HPCOLOR first and falls back to CECOLOR when HPCOLOR is unset.
   */
  override get color() {
    if (this.hasExplicitColor()) {
      return this.getEntityColor()
    }

    const db = this.database
    const hpColor = AcDbSysVarManager.instance().getVar(
      AcDbSystemVariables.HPCOLOR,
      db
    )
    if (
      hpColor instanceof AcCmColor &&
      hpColor.colorMethod !== AcCmColorMethod.None
    ) {
      return hpColor.clone()
    }

    return db.cecolor.clone()
  }

  /**
   * Sets an explicit hatch entity color.
   */
  override set color(value: AcCmColor) {
    this.setEntityColor(value)
  }

  /**
   * Gets the definition lines for the hatch pattern.
   *
   * @returns Array of hatch pattern lines
   *
   * @example
   * ```typescript
   * const definitionLines = hatch.definitionLines;
   * console.log(`Number of definition lines: ${definitionLines.length}`);
   * ```
   */
  get definitionLines() {
    return this._definitionLines
  }

  /**
   * The pattern name of this hatch.
   */
  get patternName() {
    return this._patternName
  }
  set patternName(value: string) {
    this._patternName = value ?? ''
    this._isSolidFill =
      this._patternName.trim().toUpperCase() === HATCH_PATTERN_SOLID
    this._patternNameSet = true
    this.updatePredefinedPatternDefinitionLines()
  }

  /**
   * The pattern name of this hatch.
   */
  get patternType() {
    return this._patternType
  }
  set patternType(value: AcDbHatchPatternType) {
    this._patternType = value
    if (
      value !== AcDbHatchPatternType.Predefined &&
      this._definitionLinesAutoGenerated
    ) {
      this._definitionLines = []
      this._definitionLinesAutoGenerated = false
      this._definitionLinesPatternName = ''
      this._definitionLinesPatternScale = 1
    }
    this.updatePredefinedPatternDefinitionLines()
  }

  /**
   * The pattern angle (in radians) of this hatch.
   */
  get patternAngle() {
    return this._patternAngle
  }
  set patternAngle(value: number) {
    this._patternAngle = value
    this._patternAngleSet = true
  }

  /**
   * The pattern scale of the hatch entity. It is a non-zero positive number.
   */
  get patternScale() {
    return this._patternScale
  }
  set patternScale(value: number) {
    this._patternScale = value
    this._patternScaleSet = true
    this.updatePredefinedPatternDefinitionLines()
  }

  /**
   * Indicates whether this hatch is associative with its defining boundary objects.
   */
  get associative() {
    return this._associative
  }
  set associative(value: boolean) {
    this._associative = !!value
    this._associativeSet = true
  }

  /**
   * Optional background color of this hatch pattern.
   */
  get backgroundColor() {
    return this._backgroundColor
  }
  set backgroundColor(value: AcCmColor | undefined) {
    this._backgroundColor = value?.clone()
    this._backgroundColorSet = true
  }

  /**
   * Indicates whether user-defined hatch pattern doubling is enabled.
   */
  get patternDouble() {
    return this._patternDouble
  }
  set patternDouble(value: boolean) {
    this._patternDouble = !!value
    this._patternDoubleSet = true
  }

  /**
   * The pattern style of the hatch entity.
   */
  get hatchStyle() {
    return this._hatchStyle
  }
  set hatchStyle(value: AcDbHatchStyle) {
    this._hatchStyle = value
    this._hatchStyleSet = true
  }

  /**
   * The elevation (Z-coordinate) of the hatch plane.
   */
  get elevation() {
    return this._elevation
  }
  set elevation(value: number) {
    this._elevation = value
  }

  /**
   * Gets the current state of the gradient object.
   */
  get hatchObjectType(): AcDbHatchObjectType {
    return this._hatchObjectType
  }
  /**
   * Sets the current state of the gradient object.
   */
  set hatchObjectType(value: AcDbHatchObjectType) {
    this._hatchObjectType = value
  }

  /**
   * Gets the angle, in radians, at which the current gradient definition is applied.
   */
  get gradientAngle() {
    return this._gradientAngle
  }

  /**
   * Sets the angle, in radians, at which the current gradient definition is applied.
   */
  set gradientAngle(value: number) {
    this._gradientAngle = value
  }

  /**
   * Gets the current interpolation value between the gradient definition's default and shifted
   * values. The default is 0.0f.
   */
  get gradientShift() {
    return this._gradientShift
  }

  /**
   * Sets the current interpolation value between the gradient definition's default and shifted
   * values. The default is 0.0f.
   */
  set gradientShift(value: number) {
    this._gradientShift = value
  }

  /**
   * Gets the type of the gradient pattern.
   */
  get gradientType() {
    return this._gradientType
  }

  /**
   * Sets the type of the gradient pattern.
   */
  set gradientType(value: AcDbGradientPatternType) {
    this._gradientType = value
  }

  /**
   * Gets the name of the current gradient.
   */
  get gradientName() {
    if (this.isGradient && this._gradientName.trim() === '') {
      return DEFAULT_GRADIENT_HATCH_NAME
    }
    return this._gradientName
  }

  /**
   * Sets the name of the current gradient.
   */
  set gradientName(value: string) {
    this._gradientName = value ?? ''
  }

  /**
   * Gets whether the gradient hatch is transitioning from a start to a stop color (two-color).
   */
  get gradientOneColorMode() {
    return this._gradientOneColorMode
  }

  /**
   * Sets whether the gradient hatch is transitioning from a start to a stop color (two-color)
   * or from a color to an adjusted luminance version of the same color (one-color). In the latter
   * case, the full luminance version is the "tint" and the zero luminance version is the "shade."
   */
  set gradientOneColorMode(value: boolean) {
    this._gradientOneColorMode = value
  }

  /**
   * Gets the one-color tint shade (luminance) value.
   */
  get shadeTintValue() {
    return this._shadeTintValue
  }

  /**
   * Sets the one-color tint shade (luminance) value. If the gradient is using one-color mode,
   * this function sets the luminance value applied to the first color.
   */
  set shadeTintValue(value: number) {
    this._shadeTintValue = value
  }

  /**
   * Gets the optional first gradient color as a packed RGB value.
   */
  get gradientStartColor() {
    return this._gradientStartColor
  }

  /**
   * Sets the optional first gradient color as a packed RGB value.
   */
  set gradientStartColor(value: number | undefined) {
    this._gradientStartColor =
      value == null || !Number.isFinite(value) ? undefined : value & 0xffffff
  }

  /**
   * Gets the optional second gradient color as a packed RGB value.
   */
  get gradientEndColor() {
    return this._gradientEndColor
  }

  /**
   * Sets the optional second gradient color as a packed RGB value.
   */
  set gradientEndColor(value: number | undefined) {
    this._gradientEndColor =
      value == null || !Number.isFinite(value) ? undefined : value & 0xffffff
  }

  /**
   * Applies the current hatch-related system variables as persistent defaults
   * when this hatch is first added to a database.
   *
   * Imported hatches and programmatically assigned hatch values keep their own
   * explicit settings.
   *
   * @internal
   */
  applyPatternDefaultsFromSysVars(db: AcDbDatabase) {
    const manager = AcDbSysVarManager.instance()

    if (!this.hasExplicitLayer()) {
      const layer = manager.getVar(AcDbSystemVariables.HPLAYER, db)
      if (this.shouldUseSysVarOverride(layer)) {
        this.layer = layer as string
      }
    }

    if (!this.hasExplicitTransparency()) {
      const transparency = this.parseHpTransparency(
        manager.getVar(AcDbSystemVariables.HPTRANSPARENCY, db)
      )
      if (transparency) {
        this.transparency = transparency
      }
    }

    if (!this._backgroundColorSet) {
      this._backgroundColor = this.parseHpBackgroundColor(
        manager.getVar(AcDbSystemVariables.HPBACKGROUNDCOLOR, db)
      )
      this._backgroundColorSet = true
    }

    if (!this._patternNameSet) {
      const patternName = manager.getVar(AcDbSystemVariables.HPNAME, db)
      this._patternName = typeof patternName === 'string' ? patternName : ''
      this._patternNameSet = true
    }

    if (!this._patternAngleSet) {
      const patternAngle = manager.getVar(AcDbSystemVariables.HPANG, db)
      this._patternAngle =
        typeof patternAngle === 'number' && Number.isFinite(patternAngle)
          ? patternAngle
          : 0
      this._patternAngleSet = true
    }

    if (!this._patternScaleSet) {
      this._patternScale = this.normalizePatternScale(
        manager.getVar(AcDbSystemVariables.HPSCALE, db)
      )
      this._patternScaleSet = true
    }

    if (!this._associativeSet) {
      const hpAssoc = manager.getVar(AcDbSystemVariables.HPASSOC, db)
      this._associative = typeof hpAssoc === 'number' ? hpAssoc !== 0 : false
      this._associativeSet = true
    }

    if (!this._hatchStyleSet) {
      this._hatchStyle = this.normalizeHatchStyle(
        manager.getVar(AcDbSystemVariables.HPISLANDDETECTION, db)
      )
      this._hatchStyleSet = true
    }

    if (!this._patternDoubleSet) {
      const hpDouble = manager.getVar(AcDbSystemVariables.HPDOUBLE, db)
      this._patternDouble =
        typeof hpDouble === 'number' ? hpDouble !== 0 : false
      this._patternDoubleSet = true
    }

    this.updatePredefinedPatternDefinitionLines()
  }

  private getEffectivePatternName() {
    if (this._patternNameSet) {
      return this._patternName
    }

    const db = this.database
    const value = AcDbSysVarManager.instance().getVar(
      AcDbSystemVariables.HPNAME,
      db
    )
    return typeof value === 'string' ? value : this._patternName
  }

  protected override shouldResolveColorFromCecolor() {
    return false
  }

  private getEffectivePatternAngle() {
    if (this._patternAngleSet) {
      return this._patternAngle
    }

    const db = this.database
    const value = AcDbSysVarManager.instance().getVar(
      AcDbSystemVariables.HPANG,
      db
    )
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : this._patternAngle
  }

  /**
   * Returns the pattern angle consumed by renderers.
   *
   * Explicit definition lines from DXF (or assigned directly) already include
   * pattern rotation in their angles and offsets. Only lines expanded from
   * bundled PAT entries need the entity-level pattern angle applied again.
   */
  private getRenderablePatternAngle() {
    if (
      !this._definitionLinesAutoGenerated &&
      this._definitionLines.length > 0
    ) {
      return 0
    }
    return this.getEffectivePatternAngle()
  }

  private getEffectivePatternScale() {
    if (this._patternScaleSet) {
      return this._patternScale
    }

    const db = this.database
    return this.normalizePatternScale(
      AcDbSysVarManager.instance().getVar(AcDbSystemVariables.HPSCALE, db)
    )
  }

  private getEffectiveAssociative() {
    if (this._associativeSet) {
      return this._associative
    }

    const db = this.database
    const value = AcDbSysVarManager.instance().getVar(
      AcDbSystemVariables.HPASSOC,
      db
    )
    return typeof value === 'number' ? value !== 0 : this._associative
  }

  private normalizePatternScale(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : 1
  }

  private normalizeHatchStyle(value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return AcDbHatchStyle.Outer
    }

    if (value === AcDbHatchStyle.Normal) return AcDbHatchStyle.Normal
    if (value === AcDbHatchStyle.Ignore) return AcDbHatchStyle.Ignore
    return AcDbHatchStyle.Outer
  }

  private shouldUseSysVarOverride(value: unknown) {
    if (typeof value !== 'string') return false
    const normalized = value.trim().toLowerCase()
    return (
      normalized !== '' && normalized !== '.' && normalized !== 'use current'
    )
  }

  private parseHpBackgroundColor(value: unknown) {
    if (value instanceof AcCmColor) {
      return value.colorMethod === AcCmColorMethod.None
        ? undefined
        : value.clone()
    }

    if (typeof value !== 'string') return undefined
    const normalized = value.trim().toLowerCase()
    if (!normalized || normalized === '.' || normalized === 'none') {
      return undefined
    }

    return AcCmColor.fromString(value)
  }

  private parseHpTransparency(value: unknown) {
    if (value instanceof AcCmTransparency) {
      return value.clone()
    }

    if (!this.shouldUseSysVarOverride(value)) {
      return undefined
    }

    const text = (value as string).trim()
    if (/^bylayer$/i.test(text) || /^byblock$/i.test(text)) {
      return AcCmTransparency.fromString(text)
    }

    const percentage = Number(text)
    if (Number.isInteger(percentage) && percentage >= 0 && percentage <= 90) {
      const transparency = new AcCmTransparency()
      transparency.percentage = percentage
      return transparency
    }

    return undefined
  }

  /**
   * Populates renderable pattern definition lines for predefined hatch names.
   *
   * `patternName`, `patternScale`, and `patternType` are the persistent hatch
   * metadata. Renderers consume `definitionLines`, so newly-created predefined
   * hatches need those lines expanded from the bundled PAT library. Imported
   * files usually already contain explicit definition lines; those are kept
   * intact unless they were previously auto-generated by this object.
   */
  private updatePredefinedPatternDefinitionLines(
    patternName = this.getEffectivePatternName(),
    patternScale = this.getEffectivePatternScale()
  ) {
    if (this.patternType !== AcDbHatchPatternType.Predefined) return

    const canReplace =
      this._definitionLinesAutoGenerated || this._definitionLines.length === 0
    if (!canReplace) return

    const normalizedPatternName = patternName.trim().toUpperCase()
    if (
      !normalizedPatternName ||
      normalizedPatternName === HATCH_PATTERN_SOLID
    ) {
      this._definitionLines = []
      this._definitionLinesAutoGenerated = false
      this._definitionLinesPatternName = ''
      this._definitionLinesPatternScale = 1
      return
    }

    const scale = this.normalizePatternScale(patternScale)
    if (
      this._definitionLinesAutoGenerated &&
      this._definitionLinesPatternName === normalizedPatternName &&
      this._definitionLinesPatternScale === scale
    ) {
      return
    }

    const pattern = AcDbPredefinedAcadIsoPat.patterns.find(
      item => item.name.trim().toUpperCase() === normalizedPatternName
    )
    if (!pattern) {
      if (this._definitionLinesAutoGenerated) {
        this._definitionLines = []
        this._definitionLinesAutoGenerated = false
        this._definitionLinesPatternName = ''
        this._definitionLinesPatternScale = 1
      }
      return
    }

    this._definitionLines = pattern.lines.map(line => ({
      angle: (line.angle * Math.PI) / 180,
      base: {
        x: line.originX * scale,
        y: line.originY * scale
      },
      offset: {
        x: line.deltaX * scale,
        y: line.deltaY * scale
      },
      dashLengths: line.dashes.map(dash => dash * scale)
    }))
    this._definitionLinesAutoGenerated = true
    this._definitionLinesPatternName = normalizedPatternName
    this._definitionLinesPatternScale = scale
  }

  /**
   * Append one loop to loops of this area. If it is the first loop added, it is the outter loop.
   * Otherwise, it is an inner loop.
   * @param loop Input the loop to append
   */
  add(loop: AcGeLoop2dType) {
    this._geo.add(loop)
  }

  private buildAreasFromLoops() {
    const loops = this._geo.loops
    if (loops.length === 0) return []
    if (loops.length === 1) return [this._geo]

    const hierarchy = this._geo.buildHierarchy()
    const areas: AcGeArea2d[] = []

    const visit = (node: AcGeIndexNode, depth: number) => {
      if (node.index >= 0 && depth % 2 === 0) {
        const area = new AcGeArea2d()
        area.add(loops[node.index])
        node.children.forEach(child => {
          if (child.index >= 0) {
            area.add(loops[child.index])
          }
        })
        areas.push(area)
      }
      node.children.forEach(child => visit(child, depth + 1))
    }

    hierarchy.children.forEach(child => visit(child, 0))

    return areas.length > 0 ? areas : [this._geo]
  }

  private getCalculatedAreaValue(): number {
    const areas = this.buildAreasFromLoops()
    if (areas.length === 0) return 0
    return areas.reduce((sum, area) => sum + area.area, 0)
  }

  /**
   * The area enclosed by this hatch, including holes.
   */
  get area(): number {
    return this.getCalculatedAreaValue()
  }

  /**
   * @inheritdoc
   */
  get geometricExtents() {
    const areas = this.buildAreasFromLoops()
    if (areas.length === 0) {
      return new AcGeBox3d()
    }
    const extents = new AcGeBox3d()
    areas.forEach(area => {
      const box = area.box
      extents.union(
        new AcGeBox3d(
          { x: box.min.x, y: box.min.y, z: this._elevation },
          { x: box.max.x, y: box.max.y, z: this._elevation }
        )
      )
    })
    return extents
  }

  /**
   * Returns the full property definition for this hatch entity, including
   * general group, pattern group, and geometry group.
   *
   * The geometry group exposes editable start/end coordinates via
   * {@link AcDbPropertyAccessor} so the property palette can update
   * the hatch in real-time.
   *
   * Each property is an {@link AcDbEntityRuntimeProperty}.
   */
  get properties(): AcDbEntityProperties {
    return {
      type: this.type,
      groups: [
        this.getGeneralProperties(),
        {
          groupName: 'pattern',
          properties: [
            {
              name: 'patternType',
              type: 'enum',
              editable: true,
              options: [
                { label: AcDbHatchPatternType[0], value: 0 },
                { label: AcDbHatchPatternType[1], value: 1 },
                { label: AcDbHatchPatternType[2], value: 2 }
              ],
              accessor: {
                get: () => this.patternType,
                set: (v: AcDbHatchPatternType) => {
                  this.patternType = v
                }
              }
            },
            {
              name: 'patternName',
              type: 'string',
              editable: true,
              accessor: {
                get: () => this.patternName,
                set: (v: string) => {
                  this.patternName = v
                }
              }
            },
            {
              name: 'patternAngle',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.patternAngle,
                set: (v: number) => {
                  this.patternAngle = v
                }
              }
            },
            {
              name: 'patternScale',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.patternScale,
                set: (v: number) => {
                  this.patternScale = v
                }
              }
            },
            {
              name: 'associative',
              type: 'boolean',
              editable: true,
              accessor: {
                get: () => this.associative,
                set: (v: boolean) => {
                  this.associative = v
                }
              }
            },
            {
              name: 'backgroundColor',
              type: 'color',
              editable: true,
              accessor: {
                get: () => this.backgroundColor,
                set: (v: AcCmColor | undefined) => {
                  this.backgroundColor = v
                }
              }
            },
            {
              name: 'patternDouble',
              type: 'boolean',
              editable: true,
              accessor: {
                get: () => this.patternDouble,
                set: (v: boolean) => {
                  this.patternDouble = v
                }
              }
            }
          ]
        },
        {
          groupName: 'geometry',
          properties: [
            {
              name: 'elevation',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.elevation,
                set: (v: number) => {
                  this.elevation = v
                }
              }
            },
            {
              name: 'area',
              type: 'float',
              editable: false,
              accessor: {
                get: () => this.area
              }
            }
          ]
        }
      ]
    }
  }

  /**
   * Gets the grip points for this hatch.
   *
   * Associative hatches do not expose editable grips in AutoCAD. Non-associative
   * hatches return boundary definition points from all loops.
   *
   * @returns Array of grip points as 3D points
   */
  subGetGripPoints() {
    if (this.associative) {
      return []
    }
    return this.collectBoundaryGripPoints()
  }

  /** @inheritdoc */
  subMoveGripPointsAt(indices: number[], offset: AcGeVector3dLike) {
    if (this.associative) {
      return this
    }
    acdbForEachGripIndex(indices, index => {
      this.moveBoundaryGripPointAt(index, offset)
    })
    return this
  }

  /**
   * Collects editable grip points from hatch boundary loops.
   */
  private collectBoundaryGripPoints() {
    const gripPoints = new Array<AcGePoint3d>()
    const elevation = this._elevation
    const seen = new Set<string>()

    const appendPoint = (point: AcGePoint3dLike) => {
      const key = `${point.x},${point.y},${point.z ?? 0}`
      if (seen.has(key)) return
      seen.add(key)
      gripPoints.push(new AcGePoint3d(point.x, point.y, point.z ?? elevation))
    }

    this._geo.loops.forEach(loop => {
      if (loop instanceof AcGePolyline2d) {
        const vertexCount = loop.numberOfVertices
        for (let index = 0; index < vertexCount; index++) {
          const vertex = loop.getPointAt(index)
          appendPoint({ x: vertex.x, y: vertex.y, z: elevation })
        }
        return
      }

      loop.curves.forEach(curve => {
        if (curve instanceof AcGeLine2d) {
          appendPoint({
            x: curve.startPoint.x,
            y: curve.startPoint.y,
            z: elevation
          })
          appendPoint({
            x: curve.endPoint.x,
            y: curve.endPoint.y,
            z: elevation
          })
        } else if (curve instanceof AcGeCircArc2d) {
          appendPoint({
            x: curve.startPoint.x,
            y: curve.startPoint.y,
            z: elevation
          })
          appendPoint({
            x: curve.endPoint.x,
            y: curve.endPoint.y,
            z: elevation
          })
          appendPoint({
            x: curve.midPoint.x,
            y: curve.midPoint.y,
            z: elevation
          })
        } else if (curve instanceof AcGeEllipseArc2d) {
          appendPoint({
            x: curve.startPoint.x,
            y: curve.startPoint.y,
            z: elevation
          })
          appendPoint({
            x: curve.endPoint.x,
            y: curve.endPoint.y,
            z: elevation
          })
          const mid = curve.getPoint(0.5)
          appendPoint({ x: mid.x, y: mid.y, z: elevation })
        }
      })
    })

    return gripPoints
  }

  /**
   * Moves one boundary grip point using the same index order as
   * {@link collectBoundaryGripPoints}.
   */
  private moveBoundaryGripPointAt(gripIndex: number, offset: AcGeVector3dLike) {
    let currentIndex = 0
    const elevation = this._elevation
    const seen = new Set<string>()

    const tryMove = (point: AcGePoint3dLike, move: () => void) => {
      const key = `${point.x},${point.y},${point.z ?? 0}`
      if (seen.has(key)) return
      seen.add(key)
      if (currentIndex === gripIndex) {
        move()
      }
      currentIndex++
    }

    this._geo.loops.forEach(loop => {
      if (loop instanceof AcGePolyline2d) {
        const vertexCount = loop.numberOfVertices
        for (let index = 0; index < vertexCount; index++) {
          const vertex = loop.vertices[index]
          if (!vertex) continue
          tryMove({ x: vertex.x, y: vertex.y, z: elevation }, () => {
            acdbMovePolyline2dVertexAt(loop.vertices, index, offset)
          })
        }
        return
      }

      loop.curves.forEach(curve => {
        if (curve instanceof AcGeLine2d) {
          tryMove(
            { x: curve.startPoint.x, y: curve.startPoint.y, z: elevation },
            () => {
              curve.startPoint.x += offset.x
              curve.startPoint.y += offset.y
            }
          )
          tryMove(
            { x: curve.endPoint.x, y: curve.endPoint.y, z: elevation },
            () => {
              curve.endPoint.x += offset.x
              curve.endPoint.y += offset.y
            }
          )
        } else if (curve instanceof AcGeCircArc2d) {
          tryMove(
            { x: curve.startPoint.x, y: curve.startPoint.y, z: elevation },
            () => this.moveCircArc2dGripPoint(curve, 'start', offset)
          )
          tryMove(
            { x: curve.endPoint.x, y: curve.endPoint.y, z: elevation },
            () => this.moveCircArc2dGripPoint(curve, 'end', offset)
          )
          tryMove(
            { x: curve.midPoint.x, y: curve.midPoint.y, z: elevation },
            () => this.moveCircArc2dGripPoint(curve, 'mid', offset)
          )
        } else if (curve instanceof AcGeEllipseArc2d) {
          tryMove(
            { x: curve.startPoint.x, y: curve.startPoint.y, z: elevation },
            () => this.moveEllipseArc2dGripPoint(curve, 'start', offset)
          )
          tryMove(
            { x: curve.endPoint.x, y: curve.endPoint.y, z: elevation },
            () => this.moveEllipseArc2dGripPoint(curve, 'end', offset)
          )
          const mid = curve.getPoint(0.5)
          tryMove({ x: mid.x, y: mid.y, z: elevation }, () =>
            this.moveEllipseArc2dGripPoint(curve, 'mid', offset)
          )
        }
      })
    })
  }

  private moveCircArc2dGripPoint(
    arc: AcGeCircArc2d,
    which: 'start' | 'end' | 'mid',
    offset: AcGeVector3dLike
  ) {
    const center = arc.center
    switch (which) {
      case 'start': {
        const point = arc.startPoint
        arc.startAngle = Math.atan2(
          point.y + offset.y - center.y,
          point.x + offset.x - center.x
        )
        break
      }
      case 'end': {
        const point = arc.endPoint
        arc.endAngle = Math.atan2(
          point.y + offset.y - center.y,
          point.x + offset.x - center.x
        )
        break
      }
      case 'mid': {
        const mid = arc.midPoint
        const movedArc = new AcGeCircArc2d(
          arc.startPoint,
          { x: mid.x + offset.x, y: mid.y + offset.y },
          arc.endPoint
        )
        arc.center = movedArc.center
        arc.radius = movedArc.radius
        arc.startAngle = movedArc.startAngle
        arc.endAngle = movedArc.endAngle
        arc.clockwise = movedArc.clockwise
        break
      }
    }
  }

  private moveEllipseArc2dGripPoint(
    arc: AcGeEllipseArc2d,
    which: 'start' | 'end' | 'mid',
    offset: AcGeVector3dLike
  ) {
    const center = arc.center
    switch (which) {
      case 'start': {
        const point = arc.startPoint
        arc.startAngle = Math.atan2(
          point.y + offset.y - center.y,
          point.x + offset.x - center.x
        )
        break
      }
      case 'end': {
        const point = arc.endPoint
        arc.endAngle = Math.atan2(
          point.y + offset.y - center.y,
          point.x + offset.x - center.x
        )
        break
      }
      case 'mid': {
        const mid = arc.getPoint(0.5)
        const dx = mid.x + offset.x - arc.center.x
        const dy = mid.y + offset.y - arc.center.y
        const currentRadius = Math.hypot(
          mid.x - arc.center.x,
          mid.y - arc.center.y
        )
        const targetRadius = Math.hypot(dx, dy)
        if (currentRadius > 0 && targetRadius > 0) {
          const scale = targetRadius / currentRadius
          arc.majorAxisRadius *= scale
          arc.minorAxisRadius *= scale
        }
        break
      }
    }
  }

  /**
   * Gets the object snap points for hatch boundary geometry.
   */
  subGetOsnapPoints(
    osnapMode: AcDbOsnapMode,
    pickPoint: AcGePoint3dLike,
    _lastPoint: AcGePoint3dLike,
    snapPoints: AcGePoint3dLike[]
  ) {
    const elevation = this._elevation
    const nearestCandidates: AcGePoint3d[] = []

    this._geo.loops.forEach(loop => {
      if (loop instanceof AcGePolyline2d) {
        const geo = loop
        const vertexCount = geo.numberOfVertices
        if (vertexCount === 0) return

        switch (osnapMode) {
          case AcDbOsnapMode.EndPoint:
            for (let index = 0; index < vertexCount; index++) {
              const vertex = geo.getPointAt(index)
              snapPoints.push(new AcGePoint3d(vertex.x, vertex.y, elevation))
            }
            break
          case AcDbOsnapMode.MidPoint:
          case AcDbOsnapMode.Nearest:
          case AcDbOsnapMode.Perpendicular:
          case AcDbOsnapMode.Tangent: {
            const segmentCount = loop.closed ? vertexCount : vertexCount - 1
            for (let index = 0; index < segmentCount; index++) {
              const segmentSnaps: AcGePoint3d[] = []
              acdbCollectPolyline2dSegmentOsnapPoints(
                geo.getPointAt(index),
                geo.getPointAt((index + 1) % vertexCount),
                geo.vertices[index]?.bulge,
                elevation,
                osnapMode,
                pickPoint,
                segmentSnaps
              )
              if (osnapMode === AcDbOsnapMode.MidPoint) {
                snapPoints.push(...segmentSnaps)
              } else {
                nearestCandidates.push(...segmentSnaps)
              }
            }
            break
          }
          default:
            break
        }
        return
      }

      loop.curves.forEach(curve => {
        if (curve instanceof AcGeLine2d) {
          const segmentSnaps: AcGePoint3d[] = []
          acdbCollectPolyline2dSegmentOsnapPoints(
            curve.startPoint,
            curve.endPoint,
            undefined,
            elevation,
            osnapMode,
            pickPoint,
            segmentSnaps
          )
          if (osnapMode === AcDbOsnapMode.MidPoint) {
            snapPoints.push(...segmentSnaps)
          } else if (
            osnapMode === AcDbOsnapMode.Nearest ||
            osnapMode === AcDbOsnapMode.Perpendicular ||
            osnapMode === AcDbOsnapMode.Tangent
          ) {
            nearestCandidates.push(...segmentSnaps)
          } else {
            snapPoints.push(...segmentSnaps)
          }
        } else if (curve instanceof AcGeCircArc2d) {
          switch (osnapMode) {
            case AcDbOsnapMode.EndPoint:
              snapPoints.push(
                new AcGePoint3d(
                  curve.startPoint.x,
                  curve.startPoint.y,
                  elevation
                ),
                new AcGePoint3d(curve.endPoint.x, curve.endPoint.y, elevation)
              )
              break
            case AcDbOsnapMode.MidPoint:
              snapPoints.push(
                new AcGePoint3d(curve.midPoint.x, curve.midPoint.y, elevation)
              )
              break
            case AcDbOsnapMode.Nearest: {
              const nearest = curve.nearestPoint({
                x: pickPoint.x,
                y: pickPoint.y
              })
              nearestCandidates.push(
                new AcGePoint3d(nearest.x, nearest.y, elevation)
              )
              break
            }
            case AcDbOsnapMode.Perpendicular: {
              const perpPoints = curve.perpendicularPoints({
                x: pickPoint.x,
                y: pickPoint.y
              })
              perpPoints.forEach(point =>
                nearestCandidates.push(
                  new AcGePoint3d(point.x, point.y, elevation)
                )
              )
              break
            }
            case AcDbOsnapMode.Tangent: {
              const tangentPoints = curve.tangentPoints({
                x: pickPoint.x,
                y: pickPoint.y
              })
              tangentPoints.forEach(point =>
                nearestCandidates.push(
                  new AcGePoint3d(point.x, point.y, elevation)
                )
              )
              break
            }
            default:
              break
          }
        } else if (curve instanceof AcGeEllipseArc2d) {
          switch (osnapMode) {
            case AcDbOsnapMode.EndPoint:
              snapPoints.push(
                new AcGePoint3d(
                  curve.startPoint.x,
                  curve.startPoint.y,
                  elevation
                ),
                new AcGePoint3d(curve.endPoint.x, curve.endPoint.y, elevation)
              )
              break
            case AcDbOsnapMode.MidPoint: {
              const mid = curve.getPoint(0.5)
              snapPoints.push(new AcGePoint3d(mid.x, mid.y, elevation))
              break
            }
            case AcDbOsnapMode.Nearest: {
              const nearest = curve.nearestPoint({
                x: pickPoint.x,
                y: pickPoint.y
              })
              nearestCandidates.push(
                new AcGePoint3d(nearest.x, nearest.y, elevation)
              )
              break
            }
            case AcDbOsnapMode.Perpendicular: {
              const perpPoints = curve.perpendicularPoints({
                x: pickPoint.x,
                y: pickPoint.y
              })
              perpPoints.forEach(point =>
                nearestCandidates.push(
                  new AcGePoint3d(point.x, point.y, elevation)
                )
              )
              break
            }
            case AcDbOsnapMode.Tangent: {
              const tangentPoints = curve.tangentPoints({
                x: pickPoint.x,
                y: pickPoint.y
              })
              tangentPoints.forEach(point =>
                nearestCandidates.push(
                  new AcGePoint3d(point.x, point.y, elevation)
                )
              )
              break
            }
            default:
              break
          }
        }
      })
    })

    if (
      (osnapMode === AcDbOsnapMode.Nearest ||
        osnapMode === AcDbOsnapMode.Perpendicular ||
        osnapMode === AcDbOsnapMode.Tangent) &&
      nearestCandidates.length > 0
    ) {
      const nearest = acdbPickNearestOsnapPoint(pickPoint, nearestCandidates)
      snapPoints.length = 0
      if (nearest) snapPoints.push(nearest)
    }
  }

  /**
   * @inheritdoc
   */
  subWorldDraw(renderer: AcGiRenderer) {
    this.updatePredefinedPatternDefinitionLines()
    const traits = renderer.subEntityTraits
    traits.fillType = {
      solidFill: this.isSolidFill,
      patternAngle: this.getRenderablePatternAngle(),
      definitionLines: this.definitionLines,
      backgroundColor: this.backgroundColor?.clone(),
      gradient: this.isGradient
        ? {
            name: this.gradientName,
            angle: this.gradientAngle,
            shift: this.gradientShift,
            oneColorMode: this.gradientOneColorMode,
            shadeTintValue: this.shadeTintValue,
            startColor: this.gradientStartColor,
            endColor: this.gradientEndColor
          }
        : undefined
    }
    traits.drawOrder = -1
    const areas = this.buildAreasFromLoops()
    if (areas.length === 0) {
      return renderer.area(this._geo)
    }
    if (areas.length === 1) {
      return renderer.area(areas[0])
    }
    const entities = areas.map(area => renderer.area(area))
    return renderer.group(entities)
  }

  /**
   * Transforms this hatch by the specified matrix.
   */
  transformBy(matrix: AcGeMatrix3d) {
    const te = matrix.elements
    const matrix2d = new AcGeMatrix2d(
      te[0],
      te[4],
      te[12],
      te[1],
      te[5],
      te[13],
      0,
      0,
      1
    )
    this._geo.transform(matrix2d)
    this._elevation = new AcGePoint3d(0, 0, this._elevation).applyMatrix4(
      matrix
    ).z

    const xAxis = new AcGePoint3d(1, 0, 0).applyMatrix4(matrix)
    const origin = new AcGePoint3d().applyMatrix4(matrix)
    const xVector = new AcGePoint3d(xAxis).sub(origin)
    if (xVector.length() > 0) {
      const rotation = Math.atan2(xVector.y, xVector.x)
      this._patternAngle = this.getEffectivePatternAngle() + rotation
      this._gradientAngle += rotation
      this._patternScale = this.getEffectivePatternScale() * xVector.length()
      this._patternAngleSet = true
      this._patternScaleSet = true
      this.updatePredefinedPatternDefinitionLines()
    }
    return this
  }

  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    const loops = this._geo.loops
    const patternName = this.getEffectivePatternName()
    const patternAngle = this.getEffectivePatternAngle()
    const patternScale = this.getEffectivePatternScale()
    this.updatePredefinedPatternDefinitionLines(patternName, patternScale)
    filer.writeSubclassMarker('AcDbHatch')
    filer.writePoint3d(10, { x: 0, y: 0, z: this.elevation })
    filer.writeVector3d(210, { x: 0, y: 0, z: 1 })
    filer.writeString(
      2,
      patternName ||
        (this.isSolidFill ? HATCH_PATTERN_SOLID : HATCH_PATTERN_USER)
    )
    filer.writeInt16(70, this.isSolidFill ? 1 : 0)
    filer.writeInt16(71, this.getEffectiveAssociative() ? 1 : 0)
    filer.writeInt16(91, loops.length)
    loops.forEach((loop, index) => {
      const isExternal = index === 0

      if (loop instanceof AcGePolyline2d) {
        const vertices = loop.vertices
        const hasBulge = vertices.some(vertex => (vertex.bulge ?? 0) !== 0)
        const boundaryFlag = 2

        filer.writeInt16(92, boundaryFlag)
        filer.writeInt16(72, hasBulge ? 1 : 0)
        filer.writeInt16(73, loop.closed ? 1 : 0)
        filer.writeInt16(93, vertices.length)
        for (const vertex of vertices) {
          filer.writePoint2d(10, vertex)
          if (hasBulge) {
            filer.writeDouble(42, vertex.bulge ?? 0)
          }
        }
        filer.writeInt16(97, 0)
        return
      }

      if (loop instanceof AcGeLoop2d) {
        const boundaryFlag = isExternal ? 1 : 0
        filer.writeInt16(92, boundaryFlag)
        filer.writeInt16(93, loop.numberOfEdges)

        for (const edge of loop.curves) {
          if (edge instanceof AcGeLine2d) {
            filer.writeInt16(72, 1)
            filer.writePoint2d(10, edge.startPoint)
            filer.writePoint2d(11, edge.endPoint)
            continue
          }

          if (edge instanceof AcGeCircArc2d) {
            filer.writeInt16(72, 2)
            filer.writePoint2d(10, edge.center)
            filer.writeDouble(40, edge.radius)
            filer.writeAngle(50, edge.startAngle)
            filer.writeAngle(51, edge.endAngle)
            filer.writeInt16(73, edge.clockwise ? 0 : 1)
            continue
          }

          if (edge instanceof AcGeEllipseArc2d) {
            filer.writeInt16(72, 3)
            filer.writePoint2d(10, edge.center)
            const majorAxisVector = new AcGePoint2d(
              edge.majorAxisRadius * Math.cos(edge.rotation),
              edge.majorAxisRadius * Math.sin(edge.rotation)
            )
            filer.writePoint2d(11, majorAxisVector)
            const ratio =
              edge.majorAxisRadius === 0
                ? 0
                : edge.minorAxisRadius / edge.majorAxisRadius
            filer.writeDouble(40, ratio)
            filer.writeAngle(50, edge.startAngle)
            filer.writeAngle(51, edge.endAngle)
            filer.writeInt16(73, edge.clockwise ? 0 : 1)
            continue
          }

          if (edge instanceof AcGeSpline3d) {
            const knots = edge.knots
            const controlPoints = edge.controlPoints
            const weights = edge.weights
            const fitPoints = edge.fitPoints
            const isRational = weights.some(weight => weight !== 1)

            filer.writeInt16(72, 4)
            filer.writeInt16(94, edge.degree)
            filer.writeInt16(73, isRational ? 1 : 0)
            filer.writeInt16(74, edge.closed ? 1 : 0)
            filer.writeInt16(95, knots.length)
            filer.writeInt16(96, controlPoints.length)
            knots.forEach(knot => filer.writeDouble(40, knot))
            controlPoints.forEach((point, pointIndex) => {
              filer.writePoint2d(10, point)
              if (isRational) {
                filer.writeDouble(42, weights[pointIndex] ?? 1)
              }
            })
            filer.writeInt16(97, fitPoints?.length ?? 0)
            fitPoints?.forEach(point => filer.writePoint2d(11, point))
          }
        }

        filer.writeInt16(97, 0)
      }
    })
    filer.writeInt16(75, this.hatchStyle)
    filer.writeInt16(76, this.patternType)
    filer.writeAngle(52, patternAngle)
    filer.writeDouble(41, patternScale)
    filer.writeInt16(77, 0)
    filer.writeInt16(78, this.definitionLines.length)
    this.definitionLines.forEach(line => {
      filer.writeAngle(53, line.angle)
      filer.writePoint2d(43, line.base)
      filer.writePoint2d(45, line.offset)
      filer.writeInt16(79, line.dashLengths.length)
      line.dashLengths.forEach(length => filer.writeDouble(49, length))
    })
    // Gradient fill parameters
    if (this.isGradient) {
      filer.writeInt16(450, this._hatchObjectType)
      filer.writeInt16(451, 0)
      filer.writeInt16(452, this._gradientOneColorMode ? 1 : 0)
      filer.writeAngle(460, this._gradientAngle)
      filer.writeDouble(461, this._gradientShift)
      filer.writeString(470, this.gradientName)
    }
    // TODO: Write the number of seed points
    filer.writeInt16(98, 0)
    return this
  }
}