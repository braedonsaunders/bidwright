import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  type IsoDocument,
  type Vec3,
  getNode,
  getSpec,
  sub,
  mul,
  add,
  runResult,
  takeout,
  connected
} from './model'

/** Physical pipe and fitting envelopes for spatial review; dimensions remain governed by the piping model. */
export function mountPreview3d(
  container: HTMLElement,
  doc: IsoDocument,
  spool = ''
): () => void {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
  renderer.setClearColor(0xf2f5f8)
  container.append(renderer.domElement)
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xffffff, 0x566472, 2))
  const sun = new THREE.DirectionalLight(0xffffff, 3)
  sun.position.set(1000, 2000, 1000)
  scene.add(sun)
  const group = new THREE.Group()
  scene.add(group)
  const metal = new THREE.MeshStandardMaterial({
    color: 0x778b9c,
    metalness: 0.55,
    roughness: 0.38,
    side: THREE.DoubleSide
  })
  const fittingMaterial = new THREE.MeshStandardMaterial({
    color: 0xb8c9d5,
    metalness: 0.6,
    roughness: 0.32,
    side: THREE.DoubleSide
  })
  const warning = new THREE.MeshStandardMaterial({
    color: 0xf4aa45,
    roughness: 0.6
  })
  const vector = (p: Vec3) => new THREE.Vector3(p[0], p[2], -p[1])
  const mesh = (
    geometry: THREE.BufferGeometry,
    at: THREE.Vector3,
    material = fittingMaterial
  ) => {
    const m = new THREE.Mesh(geometry, material)
    m.position.copy(at)
    group.add(m)
    return m
  }
  const cylinder = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    r1: number,
    r2 = r1,
    material = fittingMaterial
  ) => {
    const axis = b.clone().sub(a),
      length = axis.length()
    if (length < 0.001) return
    const m = mesh(
      new THREE.CylinderGeometry(r2, r1, length, 24, 1, true),
      a.clone().add(b).multiplyScalar(0.5),
      material
    )
    m.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      axis.normalize()
    )
    return m
  }
  const runs = doc.runs.filter(r => !spool || r.spool === spool)
  for (const r of runs.filter(r => !r.connector)) {
    const a = getNode(doc, r.from),
      b = getNode(doc, r.to),
      result = runResult(doc, r),
      span = sub(b.position, a.position),
      norm = Math.hypot(...span)
    const size = getSpec(doc, r.specId).sizes.find(s => s.nps === r.nps)
    if (!size || !norm || !Number.isFinite(result.cut) || result.cut <= 0)
      continue
    const start = vector(
        add(a.position, mul(span, (result.takeouts[0] + result.gaps[0]) / norm))
      ),
      end = vector(
        add(
          b.position,
          mul(span, -(result.takeouts[1] + result.gaps[1]) / norm)
        )
      )
    cylinder(start, end, size.od / 2, size.od / 2, metal)
    cylinder(
      start,
      end,
      size.od / 2 - size.wall,
      size.od / 2 - size.wall,
      metal
    )
    for (const point of [start, end]) {
      const ring = mesh(
        new THREE.RingGeometry(size.od / 2 - size.wall, size.od / 2, 24),
        point,
        metal
      )
      ring.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        end.clone().sub(start).normalize()
      )
    }
  }
  for (const n of doc.nodes.filter(
    n => n.kind !== 'end' && n.kind !== 'weld'
  )) {
    const edges = connected(doc, n.id).filter(r => runs.includes(r)),
      host = edges[0] ?? runs.find(r => r.id === n.associatedRunId)
    if (!host) continue
    const size = getSpec(doc, host.specId).sizes.find(s => s.nps === host.nps),
      radius = (size?.od ?? 50) / 2,
      center = vector(n.position)
    const ports = edges.map(r => {
      const other = getNode(doc, r.from === n.id ? r.to : r.from),
        delta = sub(other.position, n.position),
        distance = Math.hypot(...delta),
        t = takeout(doc, n, r.id)
      return {
        r,
        t,
        point: vector(
          add(n.position, mul(delta, (t ?? radius) / (distance || 1)))
        ),
        radius:
          (getSpec(doc, r.specId).sizes.find(s => s.nps === r.nps)?.od ??
            radius * 2) / 2
      }
    })
    if (ports.some(p => p.t == null)) {
      mesh(new THREE.SphereGeometry(radius * 1.2, 20, 12), center, warning)
      continue
    }
    if (n.kind === 'elbow90' || n.kind === 'elbow45') {
      if (ports.length !== 2) continue
      const a = ports[0].point,
        b = ports[1].point,
        ua = a.clone().sub(center).normalize(),
        ub = b.clone().sub(center).normalize()
      const included = Math.acos(THREE.MathUtils.clamp(ua.dot(ub), -1, 1)),
        bend = Math.PI - included,
        t = Math.min(ports[0].t!, ports[1].t!)
      if (
        bend > 0.001 &&
        bend < Math.PI - 0.001 &&
        Math.abs(ports[0].t! - ports[1].t!) < 0.1
      ) {
        const radial = t / Math.tan(bend / 2),
          normal = new THREE.Vector3().crossVectors(ua, ub).normalize()
        const arcCenter = a
          .clone()
          .add(
            new THREE.Vector3().crossVectors(normal, ua).multiplyScalar(radial)
          )
        const start = a.clone().sub(arcCenter),
          finish = b.clone().sub(arcCenter),
          axis = new THREE.Vector3().crossVectors(start, finish).normalize()
        const angle = Math.acos(
          THREE.MathUtils.clamp(
            start.clone().normalize().dot(finish.clone().normalize()),
            -1,
            1
          )
        )
        class Arc extends THREE.Curve<THREE.Vector3> {
          constructor() {
            super()
          }
          getPoint(fraction: number) {
            return start
              .clone()
              .applyAxisAngle(axis, angle * fraction)
              .add(arcCenter)
          }
        }
        mesh(
          new THREE.TubeGeometry(new Arc(), 32, radius, 24, false),
          new THREE.Vector3()
        )
      } else
        mesh(
          new THREE.TubeGeometry(
            new THREE.QuadraticBezierCurve3(a, center, b),
            32,
            radius,
            24,
            false
          ),
          new THREE.Vector3()
        )
    } else if (n.kind === 'tee' || n.kind === 'olet') {
      for (const port of ports) cylinder(center, port.point, port.radius)
    } else if (n.kind === 'reducer' && ports.length === 2) {
      cylinder(ports[0].point, ports[1].point, ports[0].radius, ports[1].radius)
    } else if (n.kind === 'valve' && ports.length === 2) {
      cylinder(ports[0].point, ports[1].point, radius * 1.3)
      const axis = ports[1].point.clone().sub(ports[0].point).normalize()
      const up =
        Math.abs(axis.y) > 0.9
          ? new THREE.Vector3(1, 0, 0)
          : new THREE.Vector3(0, 1, 0)
      const stem = up.addScaledVector(axis, -up.dot(axis)).normalize(),
        tip = center.clone().addScaledVector(stem, radius * 4.5)
      cylinder(center, tip, radius * 0.12)
      const wheel = mesh(
        new THREE.TorusGeometry(radius * 1.6, radius * 0.15, 8, 28),
        tip
      )
      wheel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), stem)
    } else if (n.kind === 'flange' || n.kind === 'gasket') {
      const axis = (
        ports[0]?.point.clone().sub(center) ??
        vector(
          sub(getNode(doc, host.to).position, getNode(doc, host.from).position)
        )
      ).normalize()
      const half = radius * (n.kind === 'gasket' ? 0.05 : 0.25)
      cylinder(
        center.clone().addScaledVector(axis, -half),
        center.clone().addScaledVector(axis, half),
        radius * 1.9
      )
    } else if (n.kind === 'cap') {
      const axis =
        ports[0]?.point.clone().sub(center).normalize() ??
        new THREE.Vector3(1, 0, 0)
      if (ports[0]) cylinder(ports[0].point, center, radius)
      const cap = mesh(
        new THREE.SphereGeometry(
          radius,
          24,
          12,
          0,
          Math.PI * 2,
          0,
          Math.PI / 2
        ),
        center
      )
      cap.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        axis.negate()
      )
    } else if (n.kind === 'support') {
      const support = mesh(
        new THREE.BoxGeometry(radius * 3, radius * 0.3, radius * 3),
        center.clone().add(new THREE.Vector3(0, -radius, 0))
      )
      support.material = fittingMaterial
    } else if (n.kind === 'bolt') {
      mesh(
        new THREE.BoxGeometry(radius * 0.5, radius * 0.5, radius * 0.5),
        center.clone().add(new THREE.Vector3(0, radius * 1.5, 0))
      )
    }
  }
  const bounds = new THREE.Box3().setFromObject(group),
    center = new THREE.Vector3(),
    size = new THREE.Vector3()
  if (!bounds.isEmpty()) {
    bounds.getCenter(center)
    bounds.getSize(size)
  }
  const span = Math.max(100, size.length()),
    camera = new THREE.PerspectiveCamera(
      42,
      1,
      Math.max(0.1, span / 10000),
      span * 100
    )
  camera.position
    .copy(center)
    .add(new THREE.Vector3(span * 0.8, span * 0.6, span * 0.8))
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.copy(center)
  controls.update()
  const render = () => renderer.render(scene, camera)
  controls.addEventListener('change', render)
  const resize = () => {
    const w = Math.max(1, container.clientWidth),
      h = Math.max(1, container.clientHeight)
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    render()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(container)
  resize()
  return () => {
    observer.disconnect()
    controls.dispose()
    group.traverse(o => {
      if (o instanceof THREE.Mesh) o.geometry.dispose()
    })
    metal.dispose()
    fittingMaterial.dispose()
    warning.dispose()
    renderer.dispose()
    renderer.domElement.remove()
  }
}
