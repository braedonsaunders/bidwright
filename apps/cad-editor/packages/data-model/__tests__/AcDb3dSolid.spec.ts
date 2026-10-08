import { AcGeMatrix3d } from '@mlightcad/geometry-engine'

import { AcDb3dSolid } from '../src/entity'

/**
 * Real ACIS SAT text for a cylinder (radius 10, from z=-10 to z=10), taken
 * verbatim from the ACIS "SAT Save File Format" spec (Spatial Corp, SAT
 * Format 7.0), Figure 2-2/2-3 example. Used here only to confirm point
 * extraction works against a real, spec-sourced SAT stream rather than an
 * invented one.
 */
const REAL_CYLINDER_SAT = `400 0 1 0
11 Scheme AIDE 11 ACIS 4.0 NT 24 Mon Apr 12 13:59:03 1998
25.4 1e-06 1e-10
-0 body $1 $2 $-1 $3 #
-1 display_attribute-st-attrib $-1 $4 $-1 $0 1 #
-2 lump $-1 $-1 $5 $0 #
-3 transform $-1 1 0 0 0 0 -1 0 1 0 0 10 0 1 rotate no_reflect no_shear #
-4 rgb_color-st-attrib $-1 $6 $1 $0 0 1 0 #
-5 shell $-1 $-1 $-1 $7 $-1 $2 #
-6 id_attribute-st-attrib $-1 $-1 $-1 $4 $0 1 #
-7 face $-1 $8 $9 $5 $-1 $10 forward single #
-8 face $-1 $11 $12 $5 $-1 $13 forward single #
-9 loop $-1 $14 $15 $7 #
-10 cone-surface $-1 0 0 0 0 0 1 10 0 0 1 I I 0 1 forward I I I #
-11 face $-1 $-1 $16 $5 $-1 $17 forward single #
-12 loop $-1 $-1 $18 $8 #
-13 plane-surface $-1 0 0 -10 0 0 -1 -1 0 0 forward_v I I I #
-14 loop $-1 $-1 $19 $7 #
-15 coedge $-1 $15 $15 $18 $20 1 $9 $-1 #
-16 loop $-1 $-1 $21 $11 #
-17 plane-surface $-1 0 0 10 0 0 1 1 0 0 forward_v I I I I #
-18 coedge $-1 $18 $18 $15 $20 0 $12 $-1 #
-19 coedge $-1 $19 $19 $21 $22 1 $14 $-1 #
-20 edge $-1 $23 $23 $18 $24 forward #
-21 coedge $-1 $21 $21 $19 $22 0 $16 $-1 #
-22 edge $-1 $25 $25 $21 $26 forward #
-23 vertex $-1 $20 $27 #
-24 ellipse-curve $-1 0 0 -10 0 0 -1 10 0 0 1 I I #
-25 vertex $-1 $22 $28 #
-26 ellipse-curve $-1 0 0 10 0 0 1 10 0 0 1 I I #
-27 point $-1 10 0 -10 #
-28 point $-1 10 0 10 #
End-of-ACIS-data`

/**
 * A synthetic SAT snippet with three non-collinear points, used to verify
 * bounding-box math against known, easy-to-check values (the real cylinder
 * sample above only has 2 points, which collapses to a degenerate box).
 */
const SYNTHETIC_BOX_POINTS = `body $1 $2 $-1 $-1 #
point $-1 0 0 0 #
point $-1 5 3 0 #
point $-1 5 3 7 #
End-of-ACIS-data`

describe('AcDb3dSolid', () => {
  it('exposes type names', () => {
    const solid = new AcDb3dSolid('')
    expect(AcDb3dSolid.typeName).toBe('3dSolid')
    expect(solid.dxfTypeName).toBe('3DSOLID')
  })

  it('extracts every point record from real, spec-sourced ACIS SAT text', () => {
    const solid = new AcDb3dSolid(REAL_CYLINDER_SAT, 400)
    expect(solid.acisData).toBe(REAL_CYLINDER_SAT)
    expect(solid.version).toBe(400)
    expect(solid.hasRenderableGeometry).toBe(true)

    // Body transform maps (x,y,z) → (x, z+10, -y), so the two ellipse rings
    // land at y=0 and y=20 with radius 10 in the XZ plane.
    const extents = solid.geometricExtents
    expect(extents.min.x).toBeCloseTo(-10, 5)
    expect(extents.min.y).toBeCloseTo(0, 5)
    expect(extents.min.z).toBeCloseTo(-10, 5)
    expect(extents.max.x).toBeCloseTo(10, 5)
    expect(extents.max.y).toBeCloseTo(20, 5)
    expect(extents.max.z).toBeCloseTo(10, 5)
  })

  it('computes a correct bounding box from a synthetic point set', () => {
    const solid = new AcDb3dSolid(SYNTHETIC_BOX_POINTS)
    const extents = solid.geometricExtents
    expect(extents.min).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(extents.max).toMatchObject({ x: 5, y: 3, z: 7 })
  })

  it('reports no renderable geometry and draws nothing for non-SAT (binary/empty) data', () => {
    const solid = new AcDb3dSolid('')
    expect(solid.hasRenderableGeometry).toBe(false)
    expect(solid.geometricExtents.min).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(solid.geometricExtents.max).toMatchObject({ x: 0, y: 0, z: 0 })

    const renderer = {
      lineSegments: jest.fn()
    }
    const result = solid.subWorldDraw(renderer as never)
    expect(result).toBeUndefined()
    expect(renderer.lineSegments).not.toHaveBeenCalled()
  })

  it('draws wireframe segments from SAT text when curve records are present', () => {
    const solid = new AcDb3dSolid(REAL_CYLINDER_SAT, 400)
    const lineSegments = jest.fn()
    const renderer = { lineSegments }

    solid.subWorldDraw(renderer as never)

    expect(lineSegments).toHaveBeenCalledTimes(1)
    const [, itemSize, indices] = lineSegments.mock.calls[0]
    expect(itemSize).toBe(3)
    expect(indices.length).toBeGreaterThan(12 * 2)
  })

  it('falls back to a bounding-box wireframe when only isolated point records exist', () => {
    const solid = new AcDb3dSolid(SYNTHETIC_BOX_POINTS)
    const lineSegments = jest.fn()
    const renderer = { lineSegments }

    solid.subWorldDraw(renderer as never)

    expect(lineSegments).toHaveBeenCalledTimes(1)
    const [buffer, itemSize, indices] = lineSegments.mock.calls[0]
    expect(itemSize).toBe(3)
    expect(buffer.length).toBeGreaterThanOrEqual(8 * 3)
    expect(indices.length).toBeGreaterThanOrEqual(12 * 2)
  })

  it('transforms the extracted point cloud (and thus the bounding box)', () => {
    const solid = new AcDb3dSolid(SYNTHETIC_BOX_POINTS)
    const matrix = new AcGeMatrix3d().makeTranslation(1, 2, 3)

    solid.transformBy(matrix)

    const extents = solid.geometricExtents
    expect(extents.min).toMatchObject({ x: 1, y: 2, z: 3 })
    expect(extents.max).toMatchObject({ x: 6, y: 5, z: 10 })
  })
})
