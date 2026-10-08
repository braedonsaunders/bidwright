import type { Vec3 } from './model'
import type { Drawing, Point } from './drawing'

export type GridPlane = 'xy' | 'xz' | 'yz'
export interface GridSettings {
  visible: boolean
  snap: boolean
  spacing: number
  plane: GridPlane
}
export const defaultGrid = (): GridSettings => ({
  visible: true,
  snap: true,
  spacing: 100,
  plane: 'xy'
})
const axes = (plane: GridPlane): [number, number] =>
  plane === 'xy' ? [0, 1] : plane === 'xz' ? [0, 2] : [1, 2]

/** Invert the displayed projection on one physical routing plane. The third axis is held at the start connection. */
export function pickGridPoint(
  drawing: Drawing,
  sheet: Point,
  anchor: Vec3,
  settings: GridSettings
): Vec3 {
  if (!Number.isFinite(settings.spacing) || settings.spacing <= 0)
    throw new Error('Enter a positive grid spacing.')
  const [a, b] = axes(settings.plane)
  const origin = drawing.project(anchor)
  const pa: Vec3 = [...anchor],
    pb: Vec3 = [...anchor]
  pa[a] += 1
  pb[b] += 1
  const ap = drawing.project(pa),
    bp = drawing.project(pb)
  const ax = ap[0] - origin[0],
    ay = ap[1] - origin[1]
  const bx = bp[0] - origin[0],
    by = bp[1] - origin[1]
  const det = ax * by - ay * bx
  if (Math.abs(det) < 1e-10)
    throw new Error(
      'This routing plane is edge-on. Choose another plane or drawing view.'
    )
  const x = sheet[0] - origin[0],
    y = sheet[1] - origin[1]
  const deltaA = (x * by - y * bx) / det,
    deltaB = (y * ax - x * ay) / det
  const snap = (v: number) =>
    settings.snap ? Math.round(v / settings.spacing) * settings.spacing : v
  const result: Vec3 = [...anchor]
  result[a] += snap(deltaA)
  result[b] += snap(deltaB)
  return result
}

/** Three families form traditional triangular isometric paper, aligned to the active routing plane. Editor overlay only. */
export function gridSvg(
  drawing: Drawing,
  anchor: Vec3,
  settings: GridSettings
): string {
  if (!settings.visible) return ''
  const origin = drawing.project(anchor),
    [a, b] = axes(settings.plane)
  const pa: Vec3 = [...anchor],
    pb: Vec3 = [...anchor]
  pa[a] += settings.spacing
  pb[b] += settings.spacing
  const ap = drawing.project(pa),
    bp = drawing.project(pb)
  let u: Point = [ap[0] - origin[0], ap[1] - origin[1]],
    v: Point = [bp[0] - origin[0], bp[1] - origin[1]]
  const det = u[0] * v[1] - u[1] * v[0]
  if (Math.abs(det) < 1e-8)
    return '<text x="55" y="132" font-size="10">Grid plane is edge-on in this view</text>'
  // Keep large models readable while retaining the finer, explicit physical snap spacing.
  const perpendicular = Math.min(
    Math.abs(det) / Math.hypot(...u),
    Math.abs(det) / Math.hypot(...v)
  )
  const every = Math.max(1, Math.ceil(12 / perpendicular))
  u = [u[0] * every, u[1] * every]
  v = [v[0] * every, v[1] * every]
  const determinant = u[0] * v[1] - u[1] * v[0]
  const corners: Point[] = [
    [50, 115],
    [780, 115],
    [50, 630],
    [780, 630]
  ]
  const lattice = corners.map(([px, py]) => {
    const x = px - origin[0],
      y = py - origin[1]
    return [
      (x * v[1] - y * v[0]) / determinant,
      (y * u[0] - x * u[1]) / determinant
    ]
  })
  const out: string[] = []
  const families: Array<[Point, Point, number[]]> = [
    [u, v, lattice.map(p => p[1])],
    [v, u, lattice.map(p => p[0])]
  ]
  if (drawing.view === 'iso')
    families.push([
      [u[0] + v[0], u[1] + v[1]],
      u,
      lattice.map(p => p[0] - p[1])
    ])
  for (const [dir, step, limits] of families) {
    const length = Math.hypot(...dir)
    if (length < 1e-6) continue
    for (
      let i = Math.floor(Math.min(...limits)) - 1;
      i <= Math.ceil(Math.max(...limits)) + 1;
      i++
    ) {
      const x = origin[0] + step[0] * i,
        y = origin[1] + step[1] * i,
        dx = (dir[0] / length) * 1600,
        dy = (dir[1] / length) * 1600
      out.push(
        `<line x1="${x - dx}" y1="${y - dy}" x2="${x + dx}" y2="${y + dy}" class="iso-grid-line${i % 5 === 0 ? ' major' : ''}"/>`
      )
    }
  }
  return `<defs><clipPath id="iso-grid-clip"><rect x="50" y="115" width="730" height="515"/></clipPath></defs><g data-isometric-grid="true" pointer-events="none" clip-path="url(#iso-grid-clip)">${out.join('')}</g><text x="55" y="132" font-size="10" class="iso-grid-caption" pointer-events="none">${settings.plane.toUpperCase()} grid · ${settings.spacing * every} mm${every > 1 ? ` shown · ${settings.spacing} mm snap` : ''}</text>`
}
