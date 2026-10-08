import { AcCmTransparency } from '@mlightcad/common'
import {
  AcGeArea2d,
  AcGePoint3dLike,
  AcGePolyline2d
} from '@mlightcad/geometry-engine'
import { AcGiEntity, AcGiRenderer } from '@mlightcad/graphic-interface'

/**
 * Draws a rectangular image/OLE frame that remains interior-pickable when no
 * raster is shown.
 *
 * AutoCAD lets users click inside IMAGE / OLE2FRAME extents even when only the
 * outline is visible. Outline-only `renderer.lines` cannot provide that, so this
 * helper adds a fully transparent solid fill for hit-testing and keeps the
 * visible frame outline.
 *
 * @param renderer - Target graphics renderer.
 * @param boundary - Closed frame boundary in WCS (closing vertex optional).
 * @returns Group of fill + outline, or outline alone if fill cannot be built.
 */
export function acdbDrawImageFrame(
  renderer: AcGiRenderer,
  boundary: AcGePoint3dLike[]
): AcGiEntity | undefined {
  if (boundary.length < 3) {
    return undefined
  }

  const traits = renderer.subEntityTraits
  const previousFillType = traits.fillType
  const previousTransparency = traits.transparency

  traits.fillType = {
    solidFill: true,
    patternAngle: 0,
    definitionLines: []
  }
  // Fully transparent: pickable via mesh raycast, but does not paint over the drawing.
  traits.transparency = new AcCmTransparency(0)

  const area = new AcGeArea2d()
  area.add(new AcGePolyline2d(boundary, true))
  const fill = renderer.area(area)

  traits.fillType = previousFillType
  traits.transparency = previousTransparency

  const outline = renderer.lines(boundary)
  if (!fill) {
    return outline
  }
  if (!outline) {
    return fill
  }
  return renderer.group([fill, outline])
}
