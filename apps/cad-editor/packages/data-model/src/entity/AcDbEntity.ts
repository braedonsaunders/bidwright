import { AcCmColor, AcCmTransparency } from '@mlightcad/common'
import {
  AcGeBox3d,
  AcGeMatrix3d,
  AcGePoint3d,
  AcGeVector3dLike
} from '@mlightcad/geometry-engine'
import {
  AcGiEntity,
  AcGiLineStyle,
  AcGiLineWeight,
  AcGiRenderer,
  AcGiStyleType
} from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbObject } from '../base/AcDbObject'
import { ByBlock, ByLayer, DEFAULT_LINE_TYPE } from '../misc/AcDbConstants'
import { AcDbOsnapMode } from '../misc/AcDbOsnapMode'
import {
  AcDbEntityProperties,
  AcDbEntityPropertyGroup
} from './AcDbEntityProperties'

/**
 * Abstract base class for all drawing entities.
 *
 * This class provides the fundamental functionality for all drawing entities,
 * including layer management, color handling, linetype support, visibility,
 * and geometric operations. All specific entity types (lines, circles, text, etc.)
 * inherit from this class.
 *
 * @example
 * ```typescript
 * class MyEntity extends AcDbEntity {
 *   get geometricExtents(): AcGeBox3d {
 *     // Implementation for geometric extents
 *   }
 *
 *   draw(renderer: AcGiRenderer): AcGiEntity | undefined {
 *     // Implementation for drawing
 *   }
 * }
 * ```
 */
export abstract class AcDbEntity extends AcDbObject {
  /** The entity type name */
  static typeName: string = 'Entity'
  /** The layer name this entity belongs to */
  private _layer?: string
  /** The color of this entity */
  private _color?: AcCmColor
  /** The linetype name for this entity */
  private _lineType?: string
  /** The line weight for this entity */
  private _lineWeight?: AcGiLineWeight
  /** The linetype scale factor for this entity */
  private _linetypeScale?: number
  /** Whether this entity is visible */
  private _visibility: boolean = true
  /** The transparency level of this entity (0-1) */
  private _transparency: AcCmTransparency = new AcCmTransparency()
  /** Whether transparency was explicitly assigned on this entity. */
  private _transparencySet: boolean = false

  /**
   * Gets the type name of this entity.
   *
   * This method returns the entity type by removing the "AcDb" prefix
   * from the constructor name.
   *
   * @returns The entity type name
   *
   * @example
   * ```typescript
   * const entity = new AcDbLine();
   * console.log(entity.type); // "Line"
   * ```
   */
  get type() {
    return (this.constructor as typeof AcDbEntity).typeName
  }

  /**
   * Emits the database-level entity modified event for in-place geometry edits.
   * Editing commands call this after mutating an already-owned entity so views
   * can update their render buckets without forcing every command through a
   * database transaction.
   */
  triggerModifiedEvent() {
    this.database.events.entityModified.dispatch({
      database: this.database,
      entity: this
    })
  }

  /**
   * Gets the DXF entity type name written to the file.
   *
   * This value is the literal DXF record type emitted for the entity during
   * DXF export, such as `LINE`, `INSERT`, or `DIMENSION`.
   *
   * Every concrete entity class must explicitly define this property so the
   * DXF export contract stays local to the entity implementation rather than
   * being inferred by the base class.
   *
   * @returns The DXF entity type name used during export
   */
  abstract get dxfTypeName(): string

  /**
   * Gets the name of the layer referenced by this entity.
   *
   * @returns The layer name
   *
   * @example
   * ```typescript
   * const layerName = entity.layer;
   * ```
   */
  get layer() {
    if (this._layer == null) {
      this._layer = this.database.clayer ?? '0'
    }
    return this._layer
  }

  /**
   * Sets the name of the layer for this entity.
   *
   * @param value - The new layer name
   *
   * @example
   * ```typescript
   * entity.layer = 'MyLayer';
   * ```
   */
  set layer(value: string) {
    this._layer = value
  }

  /**
   * Gets the color information of this entity.
   *
   * @returns The color object for this entity
   *
   * @example
   * ```typescript
   * const color = entity.color;
   * ```
   */
  get color() {
    return this.getEntityColor()
  }

  /**
   * Sets the color information for this entity.
   *
   * @param value - The new color object
   *
   * @example
   * ```typescript
   * entity.color = new AcCmColor(0xFF0000);
   * ```
   */
  set color(value: AcCmColor) {
    this.setEntityColor(value)
  }

  /**
   * Resolved color applied on this entity. It will resolve layer colors and block colors as needed.
   */
  get resolvedColor() {
    return this.resolveStandardColor()
  }

  /**
   * Default ByLayer / ByBlock colour resolution for entities without an INSERT owner.
   */
  protected resolveStandardColor() {
    let color = this.color
    if (color.isByLayer) {
      const layerColor = this.getLayerColor()
      if (layerColor && layerColor.RGB != null) {
        color = layerColor
      }
    } else if (color.isByBlock) {
      // For common entities, ByBlock falls back to current entity color (CECOLOR).
      // If CECOLOR is ByLayer, resolve it further by current layer color.
      const currentColor = this.database.cecolor
      if (currentColor) {
        color = currentColor
        if (color.isByLayer) {
          const currentLayerName = this.database.clayer || this.layer
          const currentLayer =
            this.database.tables.layerTable.getAt(currentLayerName)
          if (currentLayer?.color?.RGB != null) {
            color = currentLayer.color
          }
        }
      }
      // Nested block ByBlock colours are applied during block rendering. Attributes
      // override this method to resolve ByBlock against their owning INSERT.
    }
    return color
  }

  /**
   * Gets the name of the line type referenced by this entity.
   *
   * @returns The linetype name
   *
   * @example
   * ```typescript
   * const lineType = entity.lineType;
   * ```
   */
  get lineType() {
    if (this._lineType == null) {
      this._lineType = this.database?.celtype ?? ByLayer
    }
    return this._lineType
  }

  /**
   * Sets the name of the line type for this entity.
   *
   * @param value - The new linetype name
   *
   * @example
   * ```typescript
   * entity.lineType = 'DASHED';
   * ```
   */
  set lineType(value: string) {
    if (!value) {
      this._lineType = ByLayer
    } else if (value.toUpperCase() === 'BYLAYER') {
      this._lineType = ByLayer
    } else if (value.toUpperCase() === 'BYBLOCK') {
      this._lineType = ByBlock
    } else {
      this._lineType = value
    }
  }

  /**
   * Gets the line weight used by this entity.
   *
   * @returns The line weight value
   */
  get lineWeight() {
    if (this._lineWeight == null) {
      this._lineWeight = this.database.celweight ?? AcGiLineWeight.ByLayer
    }
    return this._lineWeight
  }

  /**
   * Sets the line weight for this entity.
   *
   * @param value - The new line weight value
   */
  set lineWeight(value: AcGiLineWeight) {
    this._lineWeight = value
  }

  /**
   * Gets the line type scale factor of this entity.
   *
   * When an entity is first instantiated, its line type scale is initialized
   * to an invalid value. When the entity is added to the database, if a
   * linetype scale has not been specified for the entity, it is set to the
   * database's current line type scale value.
   *
   * @returns The linetype scale factor
   *
   * @example
   * ```typescript
   * const scale = entity.linetypeScale;
   * ```
   */
  get linetypeScale() {
    if (this._linetypeScale == null) {
      this._linetypeScale = this.database.celtscale ?? -1
    }
    return this._linetypeScale
  }

  /**
   * Sets the line type scale factor for this entity.
   *
   * @param value - The new linetype scale factor
   *
   * @example
   * ```typescript
   * entity.linetypeScale = 2.0;
   * ```
   */
  set linetypeScale(value: number) {
    this._linetypeScale = value
  }

  /**
   * Gets whether this entity is visible.
   *
   * @returns True if the entity is visible, false otherwise
   *
   * @example
   * ```typescript
   * const isVisible = entity.visibility;
   * ```
   */
  get visibility() {
    return this._visibility
  }

  /**
   * Sets whether this entity is visible.
   *
   * @param value - True to make the entity visible, false to hide it
   *
   * @example
   * ```typescript
   * entity.visibility = false; // Hide the entity
   * ```
   */
  set visibility(value: boolean) {
    this._visibility = value
  }

  /**
   * Gets the transparency level of this entity.
   *
   * @returns The transparency value.
   *
   * @example
   * ```typescript
   * const transparency = entity.transparency;
   * ```
   */
  get transparency() {
    return this._transparency
  }

  /**
   * Sets the transparency level of this entity.
   *
   * @param value - The transparency value.
   *
   * @example
   * ```typescript
   * entity.transparency = 0.5; // 50% transparent
   * ```
   */
  set transparency(value: AcCmTransparency) {
    this._transparency = value.clone()
    this._transparencySet = true
  }

  /**
   * Returns whether a layer value has been explicitly assigned on this entity.
   */
  protected hasExplicitLayer() {
    return this._layer != null
  }

  /**
   * Returns whether a color value has been explicitly assigned on this entity.
   */
  protected hasExplicitColor() {
    return this._color != null
  }

  /**
   * Returns the stored entity color, initializing it from CECOLOR if needed.
   */
  protected getEntityColor() {
    if (this._color == null) {
      this._color = new AcCmColor()
      if (this.database.cecolor) {
        this._color.copy(this.database.cecolor)
      }
    }
    return this._color
  }

  /**
   * Assigns the stored entity color.
   */
  protected setEntityColor(value: AcCmColor) {
    if (this._color == null) this._color = new AcCmColor()
    this._color.copy(value)
  }

  /**
   * Returns whether unresolved entity color should be initialized from CECOLOR.
   */
  protected shouldResolveColorFromCecolor() {
    return true
  }

  /**
   * Returns whether transparency has been explicitly assigned on this entity.
   */
  protected hasExplicitTransparency() {
    return this._transparencySet
  }

  /**
   * Writes common entity-level DXF fields (layer, linetype, color, etc.).
   *
   * Subclasses should call this first, then write their own fields.
   *
   * @param filer - DXF output writer.
   * @returns The entity instance (for chaining).
   */
  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    // For better downstream compatibility, emit only the entity-level subclass
    // marker here. The object-level marker (AcDbObject) is omitted for entities.
    filer.writeSubclassMarker('AcDbEntity')
    filer.writeString(8, this.layer)
    filer.writeString(6, this.lineType)
    filer.writeDouble(48, this.linetypeScale)
    filer.writeInt16(60, this.visibility ? 0 : 1)
    filer.writeCmColor(this.color)
    filer.writeInt16(370, this.lineWeight)
    filer.writeTransparency(this.transparency)
    const owner = this.database.tables.blockTable.getIdAt(this.ownerId)
    if (owner?.isPaperSapce) {
      filer.writeInt16(67, 1)
    }
    return this
  }

  /**
   * Resolves the effective properties of this entity.
   *
   * This method determines the final, usable values for entity properties such as
   * layer, linetype, lineweight, color, and other display-related attributes.
   * If a property is not explicitly set on the entity (for example, it is undefined
   * or specified as *ByLayer* / *ByBlock*), the value is resolved according to the
   * current AutoCAD system variables and drawing context.
   *
   * Typical system variables involved in the resolution process include, but are
   * not limited to:
   * - `CLAYER`    – Current layer
   * - `CELTYPE`   – Current linetype
   * - `CELWEIGHT` – Current lineweight
   * - `CECOLOR`   – Current color
   *
   * The resolution follows AutoCAD semantics:
   * - Explicitly assigned entity properties take precedence
   * - *ByLayer* properties are inherited from the entity’s layer
   * - *ByBlock* properties are inherited from the owning block reference
   * - If no explicit value can be determined, the corresponding system variable
   *   or default drawing value is used
   *
   * This method does not change user-defined property settings; it only computes
   * and applies the final effective values used for display, selection, and
   * downstream processing.
   */
  resolveEffectiveProperties() {
    if (this._layer == null) {
      this._layer = this.database.clayer ?? '0'
    }

    if (this._color == null && this.shouldResolveColorFromCecolor()) {
      this._color = new AcCmColor()
      if (this.database.cecolor) {
        this._color.copy(this.database.cecolor)
      }
    }

    if (this._lineType == null) {
      this._lineType = this.database.celtype ?? ByLayer
    }

    if (this._linetypeScale == null) {
      this._linetypeScale = this.database.celtscale ?? -1
    }

    if (this._lineWeight == null) {
      this._lineWeight = this.database.celweight ?? AcGiLineWeight.ByLayer
    }
  }

  /**
   * Returns the full property definition for this entity, including
   * all property groups and runtime accessors.
   *
   * This getter is used by the property inspector UI to:
   * - determine the layout and grouping of properties,
   * - look up editable flags and metadata,
   * - read/write live values on this entity using accessors.
   *
   * The returned structure contains:
   * - static metadata (label, type, group structure),
   * - dynamic accessor bindings that expose the actual values stored in the entity.
   *
   * Note: The `groups` array contains `AcDbEntityPropertyGroup` objects whose
   * `properties` entries are runtime-resolved property descriptors that include
   * {@link AcDbPropertyAccessor} objects. Each property object therefore
   * conforms to `AcDbEntityRuntimeProperty`.
   */
  get properties(): AcDbEntityProperties {
    return {
      type: this.type,
      groups: [this.getGeneralProperties()]
    }
  }

  /**
   * Gets the grip points for this entity.
   *
   * Grip points are the control points that can be used to modify the entity.
   * This method should be overridden by subclasses to provide entity-specific
   * grip points.
   *
   * @returns Array of grip points as 3D points
   *
   * @example
   * ```typescript
   * const gripPoints = entity.subGetGripPoints();
   * ```
   */
  subGetGripPoints() {
    const gripPoints = new Array<AcGePoint3d>()
    return gripPoints
  }

  /**
   * Moves the grip points at the specified indices by the given offset.
   *
   * This method should be overridden by subclasses to provide entity-specific
   * grip editing behavior, matching AutoCAD `AcDbEntity::subMoveGripPointsAt`.
   *
   * @param indices - Zero-based indexes into the array returned by {@link subGetGripPoints}
   * @param offset - WCS translation offset applied to the selected grips
   * @returns This entity after the grip edit
   *
   * @example
   * ```typescript
   * entity.subMoveGripPointsAt([0], new AcGeVector3d(1, 0, 0));
   * ```
   */
  subMoveGripPointsAt(
    // @ts-expect-error not use '_' prefix so that typedoc can the correct parameter to generate doc
    indices: number[],
    // @ts-expect-error not use '_' prefix so that typedoc can the correct parameter to generate doc
    offset: AcGeVector3dLike
  ): this {
    return this
  }

  /**
   * Gets the object snap points for this entity.
   *
   * Object snap points are the points that can be used for precise positioning
   * when drawing or editing. This method should be overridden by subclasses
   * to provide entity-specific snap points.
   *
   * @param osnapMode - The object snap mode
   * @param pickPoint - The pick point
   * @param lastPoint - The last point
   * @param snapPoints - Array to populate with snap points
   * @param gsMark - The object id of subentity. For now, it is used by INSERT
   * entity only. In AutoCAD, it uses AcGiSubEntityTraits::setSelectionMarkerInput
   * to set GS marker of the subentity involved in the object snap operation. For
   * now, we don't provide such a GS marker mechanism yet. So passed id of subentity
   * as GS marker. Maybe this behavior will change in the future.
   * @param insertionMat - Cumulative insertion transform matrix from nested block
   * references. This parameter is primarily used by INSERT entities.
   *
   * @example
   * ```typescript
   * const snapPoints: AcGePoint3d[] = [];
   * entity.subGetOsnapPoints(AcDbOsnapMode.Endpoint, 0, pickPoint, lastPoint, snapPoints);
   * ```
   */
  subGetOsnapPoints(
    // @ts-expect-error not use '_' prefix so that typedoc can the correct parameter to generate doc
    osnapMode: AcDbOsnapMode,
    // @ts-expect-error not use '_' prefix so that typedoc can the correct parameter to generate doc
    pickPoint: AcGePoint3dLike,
    // @ts-expect-error not use '_' prefix so that typedoc can the correct parameter to generate doc
    lastPoint: AcGePoint3dLike,
    // @ts-expect-error not use '_' prefix so that typedoc can the correct parameter to generate doc
    snapPoints: AcGePoint3dLike[],
    // @ts-expect-error not use '_' prefix so that typedoc can the correct parameter to generate doc
    gsMark?: AcDbObjectId,
    // @ts-expect-error not use '_' prefix so that typedoc can the correct parameter to generate doc
    insertionMat?: AcGeMatrix3d
  ) {}

  /**
   * Transforms this entity by the specified matrix.
   *
   * This method applies a geometric transformation to the entity.
   * Subclasses should override this method to provide entity-specific
   * transformation behavior.
   *
   * @param matrix - The transformation matrix to apply
   * @returns This entity after transformation
   *
   * @example
   * ```typescript
   * const matrix = AcGeMatrix3d.translation(10, 0, 0);
   * entity.transformBy(matrix);
   * ```
   */
  // @ts-expect-error not use '_' prefix so that typedoc can the correct parameter to generate doc
  transformBy(matrix: AcGeMatrix3d): this {
    return this
  }

  /**
   * Gets the geometric extents of this entity.
   *
   * This method should be implemented by subclasses to return the
   * bounding box that encompasses the entire entity.
   *
   * @returns The geometric extents as a 3D bounding box
   *
   * @example
   * ```typescript
   * const extents = entity.geometricExtents;
   * console.log(`Min: ${extents.minPoint}, Max: ${extents.maxPoint}`);
   * ```
   */
  abstract get geometricExtents(): AcGeBox3d

  /**
   * Erase the current entity from the associated database.
   *
   * @returns — true if an entity in the database existed and has been removed,
   * or false if the entity does not exist.
   */
  erase() {
    return this.database.tables.blockTable.removeEntity(this.objectId)
  }

  /**
   * Draws this entity using the specified renderer.
   *
   * This method should be implemented by subclasses to provide
   * entity-specific drawing behavior.
   *
   * @param renderer - The renderer to use for drawing
   * @param delay - The flag to delay creating one rendered entity and just create one dummy
   * entity. Renderer can delay heavy calculation operation to avoid blocking UI when this flag
   * is true. For now, text and mtext entity supports this flag only. Other types of entities
   * just ignore this flag.
   * @returns The rendered entity, or undefined if drawing failed
   */
  abstract subWorldDraw(
    renderer: AcGiRenderer,
    delay?: boolean
  ): AcGiEntity | undefined

  /**
   * Called by cad application when it wants the entity to draw itself in WCS (World Coordinate
   * System) and acts as a wrapper / dispatcher around subWorldDraw(). The children class should
   * never overidde this method.
   *
   * It executes the following logic:
   * - Skips drawing when the entity's layer is not drawable under the database
   *   {@link AcDbDatabase.drawNoPlotLayers} policy
   * - Handles traits (color, linetype, lineweight, transparency, etc.)
   * - Sets {@link AcGiRenderer.context} database for draw-time database lookups
   * - Calls subWorldDraw() to do the actual geometry output
   *
   * @param renderer - The renderer to use for drawing
   * @param delay - The flag to delay creating one rendered entity and just create one dummy
   * entity. Renderer can delay heavy calculation operation to avoid blocking UI when this flag
   * is true. For now, text and mtext entity supports this flag only. Other types of entities
   * just ignore this flag.
   * @returns The rendered entity, or undefined if drawing failed
   */
  worldDraw(renderer: AcGiRenderer, delay?: boolean): AcGiEntity | undefined {
    if (!this.database.isLayerDrawable(this.layer)) {
      return undefined
    }

    const traits = renderer.subEntityTraits
    traits.color = this.resolvedColor
    traits.lineType = this.lineStyle
    traits.lineTypeScale = this.linetypeScale
    traits.lineWeight = this.lineWeight
    traits.transparency = this.transparency
    traits.layer = this.layer
    traits.drawOrder = 0
    if ('thickness' in this) {
      traits.thickness = this.thickness as number
    }
    renderer.context.database = this.database
    const drawable = this.subWorldDraw(renderer, delay)
    this.attachEntityInfo(drawable)
    return drawable
  }

  /**
   * Creates the "General" property group for this entity.
   *
   * This group contains common metadata attributes shared by all CAD entities
   * (e.g., handle, layer). Each property includes a runtime {@link AcDbPropertyAccessor}
   * allowing the property inspector to read and update live values.
   *
   * Subclasses may override this method to append additional general-purpose
   * properties while still preserving this base set.
   *
   * @returns A fully resolved property group containing runtime-accessible properties.
   */
  protected getGeneralProperties(): AcDbEntityPropertyGroup {
    return {
      groupName: 'general',

      properties: [
        {
          name: 'handle',
          type: 'int',
          editable: false,
          accessor: {
            get: (): string => this.objectId
          }
        },
        {
          name: 'color',
          type: 'color',
          editable: true,
          accessor: {
            get: (): AcCmColor => this.color,
            set: (newVal: AcCmColor): void => {
              this.color = newVal
            }
          }
        },
        {
          name: 'layer',
          type: 'string',
          editable: true,
          accessor: {
            get: (): string => this.layer,
            set: (newVal: string): void => {
              this.layer = newVal
            }
          }
        },
        {
          name: 'linetype',
          type: 'linetype',
          editable: true,
          accessor: {
            get: (): string => this.lineType,
            set: (newVal: string): void => {
              this.lineType = newVal
            }
          }
        },
        {
          name: 'linetypeScale',
          type: 'float',
          editable: true,
          accessor: {
            get: (): number => this.linetypeScale,
            set: (newVal: number): void => {
              this.linetypeScale = newVal
            }
          }
        },
        {
          name: 'lineWeight',
          type: 'lineweight',
          editable: true,
          accessor: {
            get: (): AcGiLineWeight => this.lineWeight,
            set: (newVal: AcGiLineWeight): void => {
              this.lineWeight = newVal
            }
          }
        },
        {
          name: 'transparency',
          type: 'transparency',
          editable: true,
          accessor: {
            get: (): AcCmTransparency => this.transparency,
            set: (newVal: AcCmTransparency): void => {
              this.transparency = newVal
            }
          }
        }
      ]
    }
  }

  /**
   * Gets the line style for this entity.
   *
   * This method returns the line style based on the entity's linetype
   * and other properties.
   *
   * @returns The line style object
   *
   * @example
   * ```typescript
   * const lineStyle = entity.lineStyle;
   * ```
   */
  get lineStyle(): AcGiLineStyle {
    const { type, name } = this.getLineType()
    const lineTypeRecord = this.database?.tables.linetypeTable.getAt(name)
    if (lineTypeRecord) {
      return { type, ...lineTypeRecord.linetype }
    } else {
      return {
        type,
        name,
        standardFlag: 0,
        description: '',
        totalPatternLength: 0
      }
    }
  }

  /**
   * Gets the line type for this entity.
   *
   * This method resolves the line type, handling ByLayer and ByBlock
   * references as needed.
   *
   * @returns The resolved line type
   *
   * @example
   * ```typescript
   * const lineType = entity.getLineType();
   * ```
   */
  private getLineType(): { type: AcGiStyleType; name: string } {
    if (this.lineType == ByLayer) {
      const layer = this.database.tables.layerTable.getAt(this.layer)
      if (layer && layer.linetype) {
        return {
          type: 'ByLayer',
          name: layer.linetype
        }
      }
    } else if (this.lineType == ByBlock) {
      // TODO: Get line type correctly
      return {
        type: 'ByBlock',
        name: DEFAULT_LINE_TYPE
      }
    } else {
      return {
        type: 'UserSpecified',
        name: this.lineType
      }
    }
    return {
      type: 'UserSpecified',
      name: DEFAULT_LINE_TYPE
    }
  }

  /**
   * Gets the color of the layer this entity belongs to.
   *
   * This method retrieves the color from the layer table for the
   * layer this entity belongs to.
   *
   * @returns The layer color, or undefined if the layer doesn't exist
   *
   * @example
   * ```typescript
   * const layerColor = entity.getLayerColor();
   * ```
   */
  protected getLayerColor() {
    const layer = this.database.tables.layerTable.getAt(this.layer)
    if (layer == null) {
      console.error(
        `The layer with name '${this.layer}' not found in drawing database!`
      )
    } else {
      return layer.color
    }
    return null
  }

  /**
   * Attaches entity information to a graphic interface entity.
   *
   * This method transfers essential entity properties (object ID, owner ID,
   * layer name, and visibility) from this entity to the target graphic
   * interface entity. This is typically used during the rendering process
   * to ensure the graphic entity has the correct metadata.
   *
   * @param target - The graphic interface entity to attach information to
   *
   */
  private attachEntityInfo(target: AcGiEntity | null | undefined) {
    if (target) {
      target.objectId = this.objectId
      if (this.attrs.has('ownerId')) {
        target.ownerId = this.ownerId
      }
      target.layerName = this.layer
      target.visible = this.visibility
    }
  }
}
