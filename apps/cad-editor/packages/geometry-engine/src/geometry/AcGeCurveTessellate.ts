/**
 * Options for chord-height curve tessellation.
 *
 * `circleSides` is a quality hint equivalent to AutoCAD VIEWRES / VPORT
 * `circleSides`. When `deviation` is omitted it is derived from that hint
 * and the curve's characteristic size. `maxSegments` also caps the number
 * of curve evaluations so adaptive sampling cannot exceed a fixed-N path.
 */
export interface AcGeTessellateOptions {
  /** Maximum chord height in world units. Derived from `circleSides` when omitted. */
  deviation?: number
  /**
   * Quality hint used to derive deviation and the default `maxSegments`.
   * Default is {@link AcGeCircArc2d.DEFAULT_CIRCLE_SIDES}.
   */
  circleSides?: number
  /** Minimum number of segments. Defaults depend on the curve type. */
  minSegments?: number
  /**
   * Maximum number of segments (circular arcs) or curve evaluations
   * (parametric refine). Defaults to `circleSides`.
   */
  maxSegments?: number
}

/**
 * Tessellation options after applying `circleSides` defaults.
 */
export interface AcGeResolvedTessellateOptions {
  deviation?: number
  circleSides: number
  minSegments?: number
  maxSegments: number
}
