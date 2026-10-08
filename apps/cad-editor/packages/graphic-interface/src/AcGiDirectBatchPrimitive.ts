/**
 * Primitive kinds that a renderer may capture from a single {@link AcGiRenderer}
 * draw call and append into a batch without an intermediate scene-graph entity.
 *
 * Entities advertise support via the
 * {@link import('@mlightcad/data-model').AcDbEntity.directBatchPrimitive} accessor.
 *
 * @internal
 */
export type AcGiDirectBatchPrimitive =
  /** `lines` / `circularArc` / `ellipticalArc` (tessellated to a point strip). */
  | 'lineStrip'
  /** `lineSegments` (indexed `gl.LINES`). */
  | 'lineSegments'
  /** `point` with a simple Points drawable (no symbol LineSegments). */
  | 'point'
  /** `area` solid fill (single area call, not a group of areas). */
  | 'area'
