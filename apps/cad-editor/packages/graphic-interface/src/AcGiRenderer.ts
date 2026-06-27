import {
  AcGeArea2d,
  AcGeCircArc3d,
  AcGeEllipseArc3d,
  AcGePoint3d,
  AcGePoint3dLike
} from '@mlightcad/geometry-engine'

import { AcGiContext } from './AcGiContext'
import { AcGiEntity } from './AcGiEntity'
import { AcGiImageStyle } from './AcGiImageStyle'
import { AcGiPointStyle } from './AcGiPointStyle'
import { AcGiShapeData } from './AcGiShapeData'
import { AcGiSubEntityTraits } from './AcGiSubEntityTraits'
import { AcGiMTextData, AcGiTextStyle } from './AcGiTextStyle'

/**
 * Font mappings.
 * - The key is the original font name
 * - The value is the mapped font name
 */
export type AcGiFontMapping = Record<string, string>

export interface AcGiRenderer<T extends AcGiEntity = AcGiEntity> {
  /**
   * The entity traits object gives the user control of, and access to, the attribute
   * (color, layer, linetype, etc.) settings of the current geometry.
   */
  get subEntityTraits(): AcGiSubEntityTraits

  /**
   * Draw-time context for resolving semantic trait colors (for example ACI 7
   * foreground) into pixel RGB values.
   */
  get context(): AcGiContext

  /**
   * Create one group
   * @param entities Input entities to group together
   * @returns Return created group
   */
  group(entities: T[]): T

  /**
   * Draw a point.
   * @param point Input point to draw
   * @param style Input point style applied to point
   * @returns Return an object which can be added to scene
   */
  point(point: AcGePoint3d, style: AcGiPointStyle): T

  /**
   * Draw a circular arc or full circle.
   * @param arc Input circular arc to draw
   * @returns Return an object which can be added to scene
   */
  circularArc(arc: AcGeCircArc3d): T

  /**
   * Draw an elliptical arc or full ellipse.
   * @param ellipseArc Input elliptical arc to draw
   * @returns Return an object which can be added to scene
   */
  ellipticalArc(ellipseArc: AcGeEllipseArc3d): T

  /**
   * Draw lines using gl.LINE_STRIP.
   * @param points Input a point array which contains all line vertices
   * @returns Return an object which can be added to scene
   */
  lines(points: AcGePoint3dLike[]): T

  /**
   * Draw lines using gl.LINES.
   * @param array Must be a `TypedArray`. Used to instantiate the buffer. This array should have
   * `itemSize * numVertices` elements, where numVertices is the number of vertices.
   * @param itemSize The number of values of the {@link array} that should be associated with a
   * particular vertex. If the vertex is one 2d point, then itemSize should be `2`. If the vertex
   * is one 3d point, then itemSize should be `3`.
   * @param indices Index buffer.
   * @returns Return an object which can be added to scene
   */
  lineSegments(array: Float32Array, itemSize: number, indices: Uint16Array): T

  /**
   * Draw one area
   * @param area Input area to draw
   * @returns Return an object which can be added to scene
   */
  area(area: AcGeArea2d): T

  /**
   * Draw multiple line texts
   * @param mtext Input multiple line text data to draw
   * @param style Input text style applied to the text string
   * @param delay The flag to delay creating one rendered entity and just create one dummy
   * entity. Renderer can delay heavy calculation operation to avoid blocking UI when this
   * flag is true.
   * @returns Return an object which can be added to scene
   */
  mtext(mtext: AcGiMTextData, style: AcGiTextStyle, delay?: boolean): T

  /**
   * Draw one SHX shape glyph.
   *
   * @param shape Shape placement and glyph identity
   * @param style Optional text style that references the SHX shape font. When omitted,
   * `null`, or `undefined`, the renderer resolves the glyph by collecting every shape
   * definition file from the text style table and searching them for the shape specified
   * in {@link shape}.
   * @param delay When true, the renderer may defer heavy work and return a placeholder
   * @returns Rendered entity for the scene graph
   */
  shape(shape: AcGiShapeData, style?: AcGiTextStyle, delay?: boolean): T

  /**
   * Draw image
   * @param blob Input Blob instance of one image file
   * @param style Input image style
   * @returns Return an object which can be added to scene
   */
  image(blob: Blob, style: AcGiImageStyle): T

  /**
   * Set font mapping
   * @param Input font mapping to set
   */
  setFontMapping(mapping: AcGiFontMapping): void
}
