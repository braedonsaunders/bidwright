/**
 * Intersection extent flags used by {@link AcDbEntity.intersectWith}.
 *
 * Numeric values match ObjectARX `AcDb::Intersect`. The flags only affect
 * how intersections are computed; they do not modify either entity.
 */
export enum AcDbIntersect {
  /** Keep both operands at their stored extents. */
  OnBothOperands = 0,
  /** Treat this entity as extended when its primitives allow it. */
  ExtendThis = 1,
  /** Treat the other entity as extended when its primitives allow it. */
  ExtendArg = 2,
  /** Extend both operands when their primitives allow it. */
  ExtendBoth = 3
}
