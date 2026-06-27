import {
  AcGeBox3d,
  AcGeMatrix3d,
  AcGePoint3d,
  AcGePoint3dLike,
  AcGeQuaternion,
  AcGeVector3d,
  AcGeVector3dLike
} from '@mlightcad/geometry-engine'
import { AcGiEntity, AcGiRenderer } from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbObjectId } from '../base/AcDbObject'
import { AcDbObjectIterator } from '../misc/AcDbObjectIterator'
import { AcDbOsnapMode } from '../misc/AcDbOsnapMode'
import { AcDbRenderingCache } from '../misc/AcDbRenderingCache'
import { AcDbAttribute } from './AcDbAttribute'
import { AcDbEntity } from './AcDbEntity'
import {
  AcDbEntityProperties,
  AcDbEntityPropertyGroup
} from './AcDbEntityProperties'
import { acdbMovePrimaryGripPointAt } from './AcDbGripHelpers'
import { acdbPickNearestOsnapPoint } from './AcDbOsnapHelpers'

/**
 * Represents a block reference entity in AutoCAD.
 *
 * A block reference is used to place, size, and display an instance of the collection
 * of entities within the block table record that it references. Block references allow
 * you to reuse complex geometry by referencing a block definition multiple times with
 * different positions, rotations, and scales.
 *
 * @example
 * ```typescript
 * // Create a block reference
 * const blockRef = new AcDbBlockReference("MyBlock");
 * blockRef.position = new AcGePoint3d(10, 20, 0);
 * blockRef.rotation = Math.PI / 4; // 45 degrees
 * blockRef.scaleFactors = new AcGePoint3d(2, 2, 1); // 2x scale
 *
 * // Access block reference properties
 * console.log(`Block name: ${blockRef.blockTableRecord?.name}`);
 * console.log(`Position: ${blockRef.position}`);
 * console.log(`Rotation: ${blockRef.rotation}`);
 * ```
 */
export class AcDbBlockReference extends AcDbEntity {
  /** The entity type name */
  static override typeName: string = 'BlockReference'

  override get dxfTypeName() {
    return 'INSERT'
  }

  /** The WCS position point (insertion point) of the block reference */
  private _position: AcGePoint3d
  /** The rotation value in radians */
  private _rotation: number
  /** The X, Y, and Z scale factors for the block reference */
  private _scaleFactors: AcGePoint3d
  /** The normal vector of the plane containing the block reference */
  private _normal: AcGeVector3d
  /** The name of the referenced block */
  private _blockName: string
  /** Attributes associated with this block reference */
  private _attribs: Map<string, AcDbAttribute>

  /**
   * Creates a new block reference entity.
   *
   * This constructor initializes a block reference with the specified block name.
   * The position is set to the origin, rotation to 0, normal to Z-axis, and scale factors to 1.
   *
   * @param blockName - The name of the block table record to reference
   *
   * @example
   * ```typescript
   * const blockRef = new AcDbBlockReference("MyBlock");
   * blockRef.position = new AcGePoint3d(5, 10, 0);
   * blockRef.rotation = Math.PI / 6; // 30 degrees
   * ```
   */
  constructor(blockName: string) {
    super()
    this._blockName = blockName
    this._position = new AcGePoint3d()
    this._rotation = 0.0
    this._normal = new AcGeVector3d(0, 0, 1)
    this._scaleFactors = new AcGePoint3d(1, 1, 1)
    this._attribs = new Map()
  }

  /**
   * Gets the WCS position point (insertion point) of the block reference.
   *
   * @returns The position point in WCS coordinates
   *
   * @example
   * ```typescript
   * const position = blockRef.position;
   * console.log(`Block position: ${position.x}, ${position.y}, ${position.z}`);
   * ```
   */
  get position(): AcGePoint3d {
    return this._position
  }

  /**
   * Sets the WCS position point (insertion point) of the block reference.
   *
   * @param value - The new position point
   *
   * @example
   * ```typescript
   * blockRef.position = new AcGePoint3d(15, 25, 0);
   * ```
   */
  set position(value: AcGePoint3dLike) {
    this._position.copy(value)
  }

  /**
   * Gets the rotation value of the block reference.
   *
   * The rotation value is relative to the X axis of a coordinate system that is parallel
   * to the OCS of the block reference, but has its origin at the position point of the
   * block reference. The rotation axis is the Z axis of this coordinate system with
   * positive rotations going counterclockwise when looking down the Z axis towards the origin.
   *
   * @returns The rotation value in radians
   *
   * @example
   * ```typescript
   * const rotation = blockRef.rotation;
   * console.log(`Rotation: ${rotation} radians (${rotation * 180 / Math.PI} degrees)`);
   * ```
   */
  get rotation() {
    return this._rotation
  }

  /**
   * Sets the rotation value of the block reference.
   *
   * @param value - The new rotation value in radians
   *
   * @example
   * ```typescript
   * blockRef.rotation = Math.PI / 4; // 45 degrees
   * ```
   */
  set rotation(value: number) {
    this._rotation = value
  }

  /**
   * Gets the X, Y, and Z scale factors for the block reference.
   *
   * @returns The scale factors as a 3D point
   *
   * @example
   * ```typescript
   * const scaleFactors = blockRef.scaleFactors;
   * console.log(`Scale factors: ${scaleFactors.x}, ${scaleFactors.y}, ${scaleFactors.z}`);
   * ```
   */
  get scaleFactors(): AcGePoint3d {
    return this._scaleFactors
  }

  /**
   * Sets the X, Y, and Z scale factors for the block reference.
   *
   * @param value - The new scale factors
   *
   * @example
   * ```typescript
   * blockRef.scaleFactors = new AcGePoint3d(2, 1.5, 1); // 2x X scale, 1.5x Y scale
   * ```
   */
  set scaleFactors(value: AcGePoint3dLike) {
    this._scaleFactors.copy(value)
  }

  /**
   * Gets the normal vector of the plane containing the block reference.
   *
   * @returns The normal vector
   *
   * @example
   * ```typescript
   * const normal = blockRef.normal;
   * console.log(`Normal: ${normal.x}, ${normal.y}, ${normal.z}`);
   * ```
   */
  get normal(): AcGeVector3d {
    return this._normal
  }

  /**
   * Sets the normal vector of the plane containing the block reference.
   *
   * @param value - The new normal vector
   *
   * @example
   * ```typescript
   * blockRef.normal = new AcGeVector3d(0, 0, 1);
   * ```
   */
  set normal(value: AcGeVector3dLike) {
    this._normal.copy(value).normalize()
  }

  /**
   * Gets the name of the block definition referenced by this INSERT entity.
   *
   * The returned value is the block table record key used to resolve
   * {@link blockTableRecord} from the current database.
   *
   * @returns The referenced block name.
   */
  get blockName() {
    return this._blockName
  }

  /**
   * Gets the block table record referenced by this block reference.
   *
   * The referenced block table record contains the entities that the block reference will display.
   *
   * @returns The block table record, or undefined if not found
   *
   * @example
   * ```typescript
   * const blockRecord = blockRef.blockTableRecord;
   * if (blockRecord) {
   *   console.log(`Block name: ${blockRecord.name}`);
   * }
   * ```
   */
  get blockTableRecord() {
    return this.database.tables.blockTable.getAt(this._blockName)
  }

  /**
   * Appends the specified AcDbAttribute object to the attribute list of the block reference,
   * establishes the block reference as the attribute's owner, and adds the attribute to the
   * AcDbDatabase that contains the block reference.
   * @param attrib - The attribute to be appended to the attribute list of the block reference.
   */
  appendAttributes(attrib: AcDbAttribute) {
    this._attribs.set(attrib.objectId, attrib)
    attrib.ownerId = this.objectId
    this.syncAttributeDatabases()
  }

  /**
   * Propagates this INSERT's database association to all attached attributes.
   *
   * @internal
   */
  syncAttributeDatabases() {
    try {
      const db = this.database
      this._attribs.forEach(attrib => {
        attrib.database = db
      })
    } catch {
      // INSERT not yet associated with a database.
    }
  }

  /**
   * Creates an iterator object that can be used to iterate over the attributes associated
   * with the block reference.
   *
   * @returns An iterator object that can be used to iterate over the attributes
   */
  attributeIterator(): AcDbObjectIterator<AcDbAttribute> {
    return new AcDbObjectIterator(this._attribs)
  }

  /**
   * Gets the block-local transformation matrix of this block reference.
   *
   * This matrix represents the **INSERT entity transform in Object Coordinate
   * System (OCS)**, excluding the extrusion / normal transformation.
   *
   * In AutoCAD, a block reference transform is conceptually applied in the
   * following order:
   *
   * 1. Translate geometry by the negative block base point
   * 2. Apply non-uniform scaling
   * 3. Apply rotation about the block Z axis (OCS Z)
   * 4. Translate to the insertion point
   * 5. Finally, transform from OCS to WCS using the entity normal (extrusion)
   *
   * This property returns the matrix for steps **1–4 only**.
   *
   * The OCS → WCS transformation derived from {@link normal} **must NOT be
   * included here**, because:
   *
   * - The rotation angle of an INSERT is defined in OCS
   * - Applying OCS earlier would rotate around an incorrect axis
   * - Cached block geometry must remain reusable for different normals
   *
   * Therefore, the extrusion transformation is applied **after rendering**
   * (see {@link AcDbRenderingCache.draw}), matching AutoCAD / RealDWG behavior.
   *
   * ### Matrix composition (right-multiply convention)
   *
   * ```
   * blockTransform =
   *   T(position)
   * · R(rotation about OCS Z)
   * · S(scaleFactors)
   * · T(-blockBasePoint)
   * ```
   *
   * ### Notes
   *
   * - The returned matrix operates in OCS space
   * - Rotation is always about the OCS Z axis
   * - {@link normal} is applied later as a final orientation step
   * - This mirrors the internal behavior of `AcDbBlockReference` in ObjectARX
   *
   * @returns A transformation matrix representing the block-local INSERT transform
   *          in OCS, excluding extrusion.
   */
  get blockTransform(): AcGeMatrix3d {
    // Retrieve the referenced block table record.
    // The block definition contains its own local coordinate system
    // whose origin is the block base point.
    const blockTableRecord = this.blockTableRecord

    // The base point (origin) of the block definition.
    // All entities inside the block are defined relative to this point.
    // If the block record is missing, fall back to (0,0,0).
    const basePoint = blockTableRecord?.origin ?? AcGePoint3d.ORIGIN

    // ------------------------------------------------------------
    // Step 1: Translate geometry by the negative block base point
    //
    // This moves block geometry so that the block base point
    // coincides with the origin (0,0,0) in block-local space.
    //
    // AutoCAD always applies this compensation first.
    // ------------------------------------------------------------
    const mBase = new AcGeMatrix3d().makeTranslation(
      -basePoint.x,
      -basePoint.y,
      -basePoint.z
    )

    // ------------------------------------------------------------
    // Step 2: Apply non-uniform scaling
    //
    // Scale factors are applied in block-local OCS coordinates.
    // Negative or non-uniform scales are supported.
    // ------------------------------------------------------------
    const mScale = new AcGeMatrix3d().makeScale(
      this._scaleFactors.x,
      this._scaleFactors.y,
      this._scaleFactors.z
    )

    // ------------------------------------------------------------
    // Step 3: Apply rotation about the block Z axis (OCS Z)
    //
    // IMPORTANT:
    // - The rotation angle of an INSERT is defined in OCS
    // - The rotation axis is always the local Z axis
    // - The extrusion / normal is NOT applied here
    //
    // Rotation is therefore constructed around (0,0,1).
    // ------------------------------------------------------------
    const qRot = new AcGeQuaternion().setFromAxisAngle(
      AcGeVector3d.Z_AXIS,
      this._rotation
    )
    const mRot = new AcGeMatrix3d().makeRotationFromQuaternion(qRot)

    // ------------------------------------------------------------
    // Step 4: Translate to the insertion point
    //
    // This moves the transformed block geometry from the origin
    // to its final insertion point, still in OCS.
    // ------------------------------------------------------------
    const mInsert = new AcGeMatrix3d().makeTranslation(
      this._position.x,
      this._position.y,
      this._position.z
    )

    // ------------------------------------------------------------
    // Final composition (right-multiply convention)
    //
    // blockTransform =
    //   T(position)
    // · R(rotation about OCS Z)
    // · S(scaleFactors)
    // · T(-blockBasePoint)
    //
    // NOTE:
    // - This matrix operates entirely in OCS
    // - The OCS → WCS transform derived from `normal`
    //   is intentionally excluded here
    // - Extrusion is applied later at render time
    // ------------------------------------------------------------
    return new AcGeMatrix3d()
      .multiplyMatrices(mInsert, mRot)
      .multiply(mScale)
      .multiply(mBase)
  }

  /**
   * Gets the grip points for this block reference.
   *
   * @returns Array containing the block insertion point.
   */
  subGetGripPoints() {
    return [this._position]
  }

  /** @inheritdoc */
  subMoveGripPointsAt(indices: number[], offset: AcGeVector3dLike) {
    acdbMovePrimaryGripPointAt(indices, offset, this._position)
    return this
  }

  /**
   * Gets the object snap points for this block reference.
   *
   * Object snap points are precise points that can be used for positioning
   * when drawing or editing. This method provides snap points based on the
   * specified snap mode.
   *
   * @param osnapMode - The object snap mode
   * @param pickPoint - The point where the user picked
   * @param lastPoint - The last point
   * @param snapPoints - Array to populate with snap points
   * @param gsMark - The object id of subentity. For now, it is used by INSERT
   * entity only. In AutoCAD, it uses AcGiSubEntityTraits::setSelectionMarkerInput
   * to set GS marker of the subentity involved in the object snap operation. For
   * now, we don't provide such a GS marker mechanism yet. So passed id of subentity
   * as GS marker. Maybe this behavior will change in the future.
   * @param insertionMat - Cumulative insertion transform matrix from parent
   * block references.
   */
  subGetOsnapPoints(
    osnapMode: AcDbOsnapMode,
    pickPoint: AcGePoint3dLike,
    lastPoint: AcGePoint3dLike,
    snapPoints: AcGePoint3dLike[],
    gsMark?: AcDbObjectId,
    insertionMat?: AcGeMatrix3d
  ) {
    const parentInsertionMat = insertionMat ?? new AcGeMatrix3d()

    if (AcDbOsnapMode.Insertion === osnapMode) {
      snapPoints.push(this.getInsertionPoint(parentInsertionMat))
    } else if (gsMark) {
      this.subEntityGetOsnapPoints(
        osnapMode,
        pickPoint,
        lastPoint,
        snapPoints,
        gsMark,
        parentInsertionMat
      )
    } else {
      this.collectBlockOsnapPoints(
        osnapMode,
        pickPoint,
        lastPoint,
        snapPoints,
        parentInsertionMat
      )
    }
  }

  /**
   * Transforms this block reference by an arbitrary world-space matrix.
   *
   * Unlike simple entities that can transform raw geometry directly, an INSERT
   * stores placement as decomposed parameters (`position`, `rotation`,
   * `scaleFactors`, and `normal`). This method applies the input matrix to a
   * derived local frame, then reconstructs those parameters from the transformed
   * frame so the reference remains representable as an INSERT.
   *
   * Recomposition pipeline:
   *
   * 1. Build local axes from current `rotation`, `normal`, and `scaleFactors`
   * 2. Transform axis endpoints and origin by `matrix`
   * 3. Recompute normal from transformed X/Y axes (with a degenerate fallback)
   * 4. Project transformed X axis into the new OCS to recover `rotation`
   * 5. Recover axis lengths as new `scaleFactors`
   * 6. Transform all attached attributes with the same matrix
   *
   * @param matrix - Transformation matrix in WCS.
   * @returns The current block reference instance.
   */
  transformBy(matrix: AcGeMatrix3d) {
    const extrusion = new AcGeMatrix3d().setFromExtrusionDirection(this._normal)
    const rotation = new AcGeMatrix3d().makeRotationZ(this._rotation)
    const localToWcs = new AcGeMatrix3d().multiplyMatrices(extrusion, rotation)

    const origin = this._position.clone()
    const xAxisPoint = new AcGePoint3d(this._scaleFactors.x, 0, 0)
      .applyMatrix4(localToWcs)
      .add(origin)
    const yAxisPoint = new AcGePoint3d(0, this._scaleFactors.y, 0)
      .applyMatrix4(localToWcs)
      .add(origin)
    const zAxisPoint = new AcGePoint3d(0, 0, this._scaleFactors.z)
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

    this._position.copy(origin)
    this._normal.copy(normal)
    this._rotation = Math.atan2(localXAxis.y, localXAxis.x)
    this._scaleFactors.set(xAxis.length(), yAxis.length(), zAxis.length())

    this._attribs.forEach(attrib => attrib.transformBy(matrix))
    return this
  }

  /**
   * Returns the full property definition for this block reference entity, including
   * general group and geometry group.
   *
   * The geometry group exposes editable properties via {@link AcDbPropertyAccessor}
   * so the property palette can update the block reference in real-time.
   *
   * Each property is an {@link AcDbEntityRuntimeProperty}.
   */
  get properties(): AcDbEntityProperties {
    const props: AcDbEntityProperties = {
      type: this.type,
      groups: [
        this.getGeneralProperties(),
        {
          groupName: 'geometry',
          properties: [
            {
              name: 'blockName',
              type: 'float',
              editable: false,
              accessor: {
                get: () => this._blockName
              }
            },
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
              name: 'scaleFactorsX',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.scaleFactors.x,
                set: (v: number) => {
                  this.scaleFactors.x = v
                }
              }
            },
            {
              name: 'scaleFactorsY',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.scaleFactors.y,
                set: (v: number) => {
                  this.scaleFactors.y = v
                }
              }
            },
            {
              name: 'scaleFactorsZ',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.scaleFactors.z,
                set: (v: number) => {
                  this.scaleFactors.z = v
                }
              }
            },
            {
              name: 'normalX',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.normal.x,
                set: (v: number) => {
                  this.normal.x = v
                }
              }
            },
            {
              name: 'normalY',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.normal.y,
                set: (v: number) => {
                  this.normal.y = v
                }
              }
            },
            {
              name: 'normalZ',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.normal.z,
                set: (v: number) => {
                  this.normal.z = v
                }
              }
            }
          ]
        }
      ]
    }
    if (this._attribs.size > 0) {
      const group: AcDbEntityPropertyGroup = {
        groupName: 'attribute',
        properties: []
      }
      props.groups.push(group)
      this._attribs.forEach(attr => {
        group.properties.push({
          name: attr.tag,
          type: 'string',
          editable: !attr.isConst,
          skipTranslation: true,
          accessor: {
            get: () => attr.textString,
            set: (v: string) => {
              attr.textString = v
            }
          }
        })
      })
    }
    return props
  }

  /**
   * Gets the geometric extents (bounding box) of this block reference.
   *
   * This method calculates the bounding box by transforming the geometric extents
   * of all entities in the referenced block according to the block reference's
   * position, rotation, and scale factors.
   *
   * @returns The bounding box that encompasses the entire block reference
   *
   * @example
   * ```typescript
   * const extents = blockRef.geometricExtents;
   * console.log(`Block bounds: ${extents.minPoint} to ${extents.maxPoint}`);
   * ```
   */
  get geometricExtents(): AcGeBox3d {
    const box = new AcGeBox3d()
    const blockTableRecord = this.blockTableRecord
    if (blockTableRecord != null) {
      const entities = blockTableRecord.newIterator()
      for (const entity of entities) {
        box.union(entity.geometricExtents)
      }
    }
    const matrix = this.blockTransform
    box.applyMatrix4(matrix)

    return box
  }

  /**
   * @inheritdoc
   */
  subWorldDraw(renderer: AcGiRenderer) {
    const blockTableRecord = this.blockTableRecord
    if (blockTableRecord != null) {
      const matrix = this.blockTransform
      const attribs: AcGiEntity[] = []
      this._attribs.forEach(attrib => {
        if (!attrib.isInvisible) {
          const result = attrib.worldDraw(renderer)
          if (result) attribs.push(result)
        }
      })
      const block = AcDbRenderingCache.instance.draw(
        renderer,
        blockTableRecord,
        this.resolvedColor,
        attribs,
        true,
        matrix,
        this._normal
      )
      return block
    } else {
      const block = renderer.group([])
      return block
    }
  }

  /**
   * Writes this INSERT entity to DXF, including its attribute sequence.
   *
   * The output order follows DXF conventions:
   *
   * 1. Emit INSERT common/object fields via the base implementation
   * 2. Emit one `ATTRIB` section for each attached attribute
   * 3. Emit a terminating `SEQEND` record when attributes were written
   *
   * @param filer - DXF output writer.
   * @param allXdata - When true, emits all XData attached to this entity.
   * @returns The current entity instance.
   */
  override dxfOut(filer: AcDbDxfFiler, allXdata = false) {
    super.dxfOut(filer, allXdata)
    let hasAttributes = false
    for (const attrib of this.attributeIterator()) {
      hasAttributes = true
      filer.writeStart('ATTRIB')
      attrib.dxfOut(filer)
    }
    if (hasAttributes) {
      filer.writeStart('SEQEND')
      filer.writeHandle(5, this.database.generateHandle())
      filer.writeObjectId(330, this.objectId)
      filer.writeSubclassMarker('AcDbEntity')
    }
    return this
  }

  /**
   * Collects object snap points from all entities in this block reference.
   */
  private collectBlockOsnapPoints(
    osnapMode: AcDbOsnapMode,
    pickPoint: AcGePoint3dLike,
    lastPoint: AcGePoint3dLike,
    snapPoints: AcGePoint3dLike[],
    parentInsertionMat: AcGeMatrix3d
  ) {
    const blockTableRecord = this.blockTableRecord
    if (!blockTableRecord) return

    const thisInsertionMat = new AcGeMatrix3d().multiplyMatrices(
      parentInsertionMat,
      this.getFullInsertionTransform()
    )
    const inverseMat = thisInsertionMat.clone().invert()
    const localPickPoint = new AcGePoint3d(pickPoint).applyMatrix4(inverseMat)
    const localLastPoint = new AcGePoint3d(lastPoint).applyMatrix4(inverseMat)
    const candidates: AcGePoint3d[] = []

    for (const entity of blockTableRecord.newIterator()) {
      const localSnapPoints: AcGePoint3d[] = []
      if (entity instanceof AcDbBlockReference) {
        entity.subGetOsnapPoints(
          osnapMode,
          pickPoint,
          lastPoint,
          localSnapPoints,
          undefined,
          thisInsertionMat
        )
        candidates.push(...localSnapPoints)
        continue
      }

      entity.subGetOsnapPoints(
        osnapMode,
        localPickPoint,
        localLastPoint,
        localSnapPoints,
        undefined,
        thisInsertionMat
      )
      localSnapPoints.forEach(point =>
        candidates.push(new AcGePoint3d(point).applyMatrix4(thisInsertionMat))
      )
    }

    if (candidates.length === 0) return

    if (
      osnapMode === AcDbOsnapMode.Nearest ||
      osnapMode === AcDbOsnapMode.Perpendicular ||
      osnapMode === AcDbOsnapMode.Tangent
    ) {
      const nearest = acdbPickNearestOsnapPoint(pickPoint, candidates)
      if (nearest) snapPoints.push(nearest)
    } else {
      snapPoints.push(...candidates)
    }
  }

  /**
   * Recursively resolves object snap points from nested block references.
   *
   * This helper traverses child entities under the current block reference to
   * locate the sub-entity identified by `gsMark`. When found, it converts
   * pick/last points into the target local space, asks that entity for snap
   * points, then maps results back to the caller space as needed.
   *
   * The method tracks visited block references to prevent infinite recursion in
   * cyclic block graphs.
   *
   * @param osnapMode - Requested osnap mode.
   * @param pickPoint - User pick point in caller space.
   * @param lastPoint - Previous point in caller space.
   * @param snapPoints - Output collection to append resolved snap points into.
   * @param gsMark - Object id of the target sub-entity.
   * @param parentInsertionMat - Cumulative transform from ancestor INSERTs.
   * @param visitedRefs - Internal recursion guard set.
   * @returns `true` when the target sub-entity is found and processed, else `false`.
   */
  private subEntityGetOsnapPoints(
    osnapMode: AcDbOsnapMode,
    pickPoint: AcGePoint3dLike,
    lastPoint: AcGePoint3dLike,
    snapPoints: AcGePoint3dLike[],
    gsMark: AcDbObjectId,
    parentInsertionMat: AcGeMatrix3d,
    visitedRefs = new Set<AcDbObjectId>()
  ) {
    // Avoid an infinite loop
    if (gsMark === this.objectId || visitedRefs.has(this.objectId)) return false

    visitedRefs.add(this.objectId)

    try {
      const blockTableRecord = this.blockTableRecord
      if (blockTableRecord == null) return false

      const thisInsertionMat = new AcGeMatrix3d().multiplyMatrices(
        parentInsertionMat,
        this.getFullInsertionTransform()
      )

      for (const entity of blockTableRecord.newIterator()) {
        if (entity.objectId === gsMark) {
          const localPickPoint = new AcGePoint3d(pickPoint).applyMatrix4(
            thisInsertionMat.clone().invert()
          )
          const localLastPoint = new AcGePoint3d(lastPoint).applyMatrix4(
            thisInsertionMat.clone().invert()
          )
          const localSnapPoints: AcGePoint3d[] = []

          entity.subGetOsnapPoints(
            osnapMode,
            localPickPoint,
            localLastPoint,
            localSnapPoints,
            gsMark,
            thisInsertionMat
          )

          if (entity instanceof AcDbBlockReference) {
            localSnapPoints.forEach(point => {
              snapPoints.push(point.clone())
            })
          } else {
            localSnapPoints.forEach(point => {
              snapPoints.push(
                new AcGePoint3d(point).applyMatrix4(thisInsertionMat)
              )
            })
          }

          return true
        }

        if (entity instanceof AcDbBlockReference) {
          const found = entity.subEntityGetOsnapPoints(
            osnapMode,
            pickPoint,
            lastPoint,
            snapPoints,
            gsMark,
            thisInsertionMat,
            visitedRefs
          )
          if (found) return true
        }
      }

      return false
    } finally {
      visitedRefs.delete(this.objectId)
    }
  }

  /**
   * Computes the insertion osnap point in caller space.
   *
   * The insertion point is the block definition base point transformed by the
   * full cumulative insertion transform (ancestor transform + this reference's
   * own full insertion transform including extrusion).
   *
   * @param parentInsertionMat - Cumulative transform from parent block references.
   * @returns The insertion point in the caller coordinate space.
   */
  private getInsertionPoint(parentInsertionMat: AcGeMatrix3d) {
    const blockBasePoint = this.blockTableRecord?.origin ?? AcGePoint3d.ORIGIN
    const insertionMat = new AcGeMatrix3d().multiplyMatrices(
      parentInsertionMat,
      this.getFullInsertionTransform()
    )
    return new AcGePoint3d(blockBasePoint).applyMatrix4(insertionMat)
  }

  /**
   * Builds the full INSERT transform for this block reference.
   *
   * {@link blockTransform} contains translation/rotation/scale in OCS only.
   * This method prepends the extrusion transform derived from {@link normal} so
   * the returned matrix maps block-local geometry all the way into WCS.
   *
   * @returns Full block insertion transform including OCS extrusion.
   */
  private getFullInsertionTransform() {
    const extrusion = new AcGeMatrix3d().setFromExtrusionDirection(this._normal)
    return new AcGeMatrix3d().multiplyMatrices(extrusion, this.blockTransform)
  }

  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbBlockReference')
    filer.writePoint3d(10, this.position)
    filer.writeString(2, this.blockName)
    filer.writeDouble(41, this.scaleFactors.x)
    filer.writeDouble(42, this.scaleFactors.y)
    filer.writeDouble(43, this.scaleFactors.z)
    filer.writeAngle(50, this.rotation)
    filer.writeVector3d(210, this.normal)
    return this
  }
}
