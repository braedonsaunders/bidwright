import { AcGePoint3dLike, AcGeVector3dLike } from '@mlightcad/geometry-engine'

/**
 * Describes one AutoCAD SHAPE entity for rendering.
 *
 * A shape references a single glyph from an SHX shape font, identified by
 * {@link name} and/or {@link shapeNumber}.
 */
export interface AcGiShapeData {
  /** Shape name within the SHX font (DXF group 2). */
  name?: string
  /** Numeric shape code within the SHX font. */
  shapeNumber?: number
  /** Shape height (DXF group 40). */
  size: number
  /** Insertion point in WCS coordinates (DXF group 10). */
  position: AcGePoint3dLike
  /** Rotation relative to the shape OCS X axis, in radians (DXF group 50). */
  rotation?: number
  /** Extrusion/normal vector (DXF groups 210–230). */
  directionVector?: AcGeVector3dLike
  /** Relative X-scale factor (DXF group 41). */
  widthFactor?: number
}
