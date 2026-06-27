import {
  AcGeArea2d,
  AcGeBox2d,
  AcGeBox3d,
  AcGeCatmullRomCurve3d,
  AcGeCircArc2d,
  AcGeCircArc3d,
  AcGeEllipseArc2d,
  AcGeEllipseArc3d,
  AcGeEuler,
  AcGeGeometryUtil,
  AcGeLine2d,
  AcGeLine3d,
  AcGeLoop2d,
  AcGeMatrix2d,
  AcGeMatrix3d,
  AcGeNurbsCurve,
  AcGePlane,
  AcGePoint2d,
  AcGePoint3d,
  AcGePolyline2d,
  AcGeQuaternion,
  AcGeVector2d,
  AcGeVector3d
} from '../src'

describe('geometry-engine public API coverage boost', () => {
  it('covers utility and point array helpers', () => {
    expect(
      AcGeGeometryUtil.isPointInPolygon(
        { x: 1, y: 1 },
        [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 2 },
          { x: 0, y: 2 }
        ],
        true
      )
    ).toBe(true)

    expect(
      AcGeGeometryUtil.isPolygonIntersect(
        [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 2 },
          { x: 0, y: 2 }
        ],
        [
          { x: 1, y: 1 },
          { x: 3, y: 1 },
          { x: 3, y: 3 },
          { x: 1, y: 3 }
        ]
      )
    ).toBe(true)

    expect(
      AcGePoint2d.pointArrayToNumberArray([
        new AcGePoint2d(1, 2),
        new AcGePoint2d(3, 4)
      ])
    ).toEqual([1, 2, 3, 4])

    const flat2d = AcGePoint3d.pointArrayToNumberArray(
      [new AcGePoint3d(1, 2, 3), new AcGePoint3d(4, 5, 6)],
      false
    )
    expect(flat2d.slice(0, 4)).toEqual([1, 2, 4, 5])
  })

  it('covers vector and matrix methods in 2d and 3d', () => {
    const v2 = new AcGeVector2d(1, -2)
    expect(v2.width).toBe(1)
    v2.width = 2
    v2.height = 3
    v2.set(2, 3)
      .setScalar(4)
      .setX(5)
      .setY(6)
      .setComponent(0, 7)
      .setComponent(1, 8)
    expect(v2.getComponent(0)).toBe(7)
    expect(
      v2.clone().copy({ x: 1, y: 1 }).add({ x: 1, y: 2 }).toArray()
    ).toEqual([2, 3])

    const v2b = new AcGeVector2d(2, 3)
    v2b
      .addScalar(1)
      .addVectors(new AcGeVector2d(1, 1), new AcGeVector2d(2, 2))
      .addScaledVector(new AcGeVector2d(2, 0), 0.5)
      .sub({ x: 1, y: 1 })
      .subScalar(1)
      .subVectors({ x: 3, y: 2 }, { x: 1, y: 1 })
      .multiply({ x: 2, y: 3 })
      .multiplyScalar(0.5)
      .divide(new AcGeVector2d(2, 3))
      .divideScalar(2)
      .applyMatrix2d(new AcGeMatrix2d().makeTranslation(1, 2))
      .min({ x: 1, y: 1 })
      .max({ x: 0, y: 0 })
      .clamp({ x: -1, y: -1 }, { x: 1, y: 1 })
      .clampScalar(-0.5, 0.5)
      .clampLength(0.1, 1)
      .floor()
      .ceil()
      .round()
      .roundToZero()
      .negate()

    expect(v2b.dot(new AcGeVector2d(1, 1))).toBeDefined()
    expect(v2b.cross(new AcGeVector2d(1, 0))).toBeDefined()
    expect(v2b.lengthSq()).toBeGreaterThanOrEqual(0)
    expect(v2b.length()).toBeGreaterThanOrEqual(0)
    expect(v2b.manhattanLength()).toBeGreaterThanOrEqual(0)
    v2b.set(3, 4)
    expect(v2b.normalize().length()).toBeCloseTo(1, 6)
    expect(v2b.angle()).toBeDefined()
    expect(v2b.angleTo(new AcGeVector2d(1, 0))).toBeGreaterThanOrEqual(0)
    expect(v2b.distanceTo({ x: 1, y: 2 })).toBeGreaterThanOrEqual(0)
    expect(v2b.distanceToSquared({ x: 1, y: 2 })).toBeGreaterThanOrEqual(0)
    expect(
      v2b.manhattanDistanceTo(new AcGeVector2d(1, 2))
    ).toBeGreaterThanOrEqual(0)
    expect(v2b.setLength(2).length()).toBeCloseTo(2, 5)
    expect(v2b.lerp(new AcGeVector2d(2, 2), 0.5)).toBeInstanceOf(AcGeVector2d)
    expect(
      v2b.lerpVectors(new AcGeVector2d(0, 0), new AcGeVector2d(2, 2), 0.5)
    ).toBeInstanceOf(AcGeVector2d)
    expect(v2b.equals(v2b.clone())).toBe(true)
    expect(v2b.fromArray([9, 8]).toArray()).toEqual([9, 8])
    expect(v2b.toArray([], 2).slice(2)).toEqual([9, 8])
    expect(v2b.rotateAround({ x: 0, y: 0 }, Math.PI / 2)).toBeInstanceOf(
      AcGeVector2d
    )
    expect(v2b.random().x).toBeGreaterThanOrEqual(0)
    expect(v2b.relativeEps()).toBeGreaterThan(0)

    const m2 = new AcGeMatrix2d()
    const basisX = new AcGeVector3d()
    const basisY = new AcGeVector3d()
    const basisZ = new AcGeVector3d()
    m2.set(1, 2, 3, 4, 5, 6, 7, 8, 9)
      .identity()
      .copy(new AcGeMatrix2d().makeScale(2, 3))
      .extractBasis(basisX, basisY, basisZ)
      .setFromMatrix4(new AcGeMatrix3d().makeScale(2, 3, 1))
      .multiply(new AcGeMatrix2d().makeRotation(Math.PI / 4))
      .premultiply(new AcGeMatrix2d().makeTranslation(1, 2))
      .multiplyMatrices(
        new AcGeMatrix2d().makeScale(2, 2),
        new AcGeMatrix2d().makeTranslation(1, 1)
      )
      .multiplyScalar(0.5)
    expect(m2.determinant()).toBeDefined()
    expect(m2.clone().invert()).toBeInstanceOf(AcGeMatrix2d)
    expect(m2.transpose()).toBeInstanceOf(AcGeMatrix2d)
    expect(
      m2.getNormalMatrix(new AcGeMatrix3d().makeRotationX(0.2))
    ).toBeInstanceOf(AcGeMatrix2d)
    expect(m2.transposeIntoArray(new AcGeMatrix3d())).toBeInstanceOf(
      AcGeMatrix2d
    )
    expect(m2.setUvTransform(0, 0, 1, 1, 0.1, 0, 0)).toBeInstanceOf(
      AcGeMatrix2d
    )
    expect(m2.scale(2, 2).rotate(0.1).translate(1, 1)).toBeInstanceOf(
      AcGeMatrix2d
    )
    expect(m2.makeTranslation(new AcGeVector2d(2, 3), 0)).toBeInstanceOf(
      AcGeMatrix2d
    )
    expect(m2.makeRotation(0.2).makeScale(2, 3)).toBeInstanceOf(AcGeMatrix2d)
    expect(m2.equals(m2.clone())).toBe(true)
    expect(m2.fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9]).toArray()).toHaveLength(9)

    const v3 = new AcGeVector3d(1, 2, 3)
    v3.set(2, 3, 4)
      .setScalar(3)
      .setX(1)
      .setY(2)
      .setZ(3)
      .setComponent(0, 4)
      .setComponent(1, 5)
      .setComponent(2, 6)
    expect(v3.getComponent(0)).toBe(4)
    expect(v3.clone().copy({ x: 1, y: 1, z: 1 }).toArray()).toEqual([1, 1, 1])

    const q = new AcGeQuaternion().setFromAxisAngle(
      AcGeVector3d.Z_AXIS,
      Math.PI / 3
    )
    const m3 = new AcGeMatrix3d().compose(
      new AcGeVector3d(1, 2, 3),
      q,
      new AcGeVector3d(2, 2, 2)
    )

    v3.add({ x: 1, y: 1, z: 1 })
      .addScalar(1)
      .addVectors({ x: 1, y: 1, z: 1 }, { x: 2, y: 2, z: 2 })
      .addScaledVector({ x: 1, y: 0, z: 0 }, 2)
      .sub({ x: 1, y: 1, z: 1 })
      .subScalar(1)
      .subVectors({ x: 5, y: 5, z: 5 }, { x: 1, y: 2, z: 3 })
      .multiply({ x: 2, y: 3, z: 4 })
      .multiplyScalar(0.5)
      .multiplyVectors({ x: 2, y: 2, z: 2 }, { x: 3, y: 3, z: 3 })
      .applyEuler(new AcGeEuler(0.1, 0.2, 0.3, 'XYZ'))
      .applyAxisAngle(AcGeVector3d.Z_AXIS, Math.PI / 2)
      .applyMatrix3(new AcGeMatrix2d().identity())
      .applyNormalMatrix(new AcGeMatrix2d().identity())
      .applyMatrix4(m3)
      .applyQuaternion(q)
      .transformDirection(new AcGeMatrix3d().makeRotationY(0.1))
      .divide({ x: 2, y: 2, z: 2 })
      .divideScalar(2)
      .min({ x: 0, y: 0, z: 0 })
      .max({ x: 1, y: 1, z: 1 })
      .clamp({ x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 })
      .clampScalar(-1, 1)
      .clampLength(0.2, 1)
      .floor()
      .ceil()
      .round()
      .roundToZero()
      .negate()

    expect(v3.dot({ x: 1, y: 0, z: 0 })).toBeDefined()
    expect(v3.isParallelTo(new AcGeVector3d(2, 0, 0))).toBeDefined()
    expect(v3.lengthSq()).toBeGreaterThanOrEqual(0)
    expect(v3.length()).toBeGreaterThanOrEqual(0)
    expect(v3.manhattanLength()).toBeGreaterThanOrEqual(0)
    v3.set(3, 4, 5)
    expect(v3.normalize().length()).toBeCloseTo(1, 6)
    expect(v3.setLength(2).length()).toBeCloseTo(2, 5)
    expect(v3.lerp({ x: 0, y: 0, z: 0 }, 0.5)).toBeInstanceOf(AcGeVector3d)
    expect(
      v3.lerpVectors({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }, 0.5)
    ).toBeInstanceOf(AcGeVector3d)
    expect(v3.cross({ x: 1, y: 0, z: 0 })).toBeInstanceOf(AcGeVector3d)
    expect(
      v3.crossVectors({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })
    ).toBeInstanceOf(AcGeVector3d)
    expect(v3.projectOnVector(new AcGeVector3d(1, 0, 0))).toBeInstanceOf(
      AcGeVector3d
    )
    expect(v3.projectOnPlane(new AcGeVector3d(0, 0, 1))).toBeInstanceOf(
      AcGeVector3d
    )
    expect(v3.reflect({ x: 0, y: 1, z: 0 })).toBeInstanceOf(AcGeVector3d)
    expect(v3.angleTo(new AcGeVector3d(1, 0, 0))).toBeGreaterThanOrEqual(0)
    expect(v3.distanceTo({ x: 1, y: 1, z: 1 })).toBeGreaterThanOrEqual(0)
    expect(v3.distanceToSquared({ x: 1, y: 1, z: 1 })).toBeGreaterThanOrEqual(0)
    expect(v3.manhattanDistanceTo({ x: 1, y: 1, z: 1 })).toBeGreaterThanOrEqual(
      0
    )
    expect(
      v3
        .setFromMatrixPosition(new AcGeMatrix3d().makeTranslation(4, 5, 6))
        .toArray()
    ).toEqual([4, 5, 6])
    expect(
      v3.setFromMatrixScale(new AcGeMatrix3d().makeScale(2, 3, 4)).toArray()
    ).toEqual([2, 3, 4])
    expect(
      v3.setFromMatrixColumn(new AcGeMatrix3d().identity(), 0)
    ).toBeInstanceOf(AcGeVector3d)
    expect(
      v3.setFromMatrix3Column(new AcGeMatrix2d().identity(), 1)
    ).toBeInstanceOf(AcGeVector3d)
    expect(v3.equals(v3.clone())).toBe(true)
    expect(v3.fromArray([1, 2, 3]).toArray()).toEqual([1, 2, 3])
    expect(v3.random().x).toBeGreaterThanOrEqual(0)
    expect(v3.randomDirection().length()).toBeCloseTo(1, 6)

    const m4 = new AcGeMatrix3d()
    const xAxis = new AcGeVector3d()
    const yAxis = new AcGeVector3d()
    const zAxis = new AcGeVector3d()
    m4.set(1, 0, 0, 1, 0, 1, 0, 2, 0, 0, 1, 3, 0, 0, 0, 1)
      .identity()
      .copy(new AcGeMatrix3d().makeTranslation(1, 2, 3))
      .copyPosition(new AcGeMatrix3d().makeTranslation(4, 5, 6))
      .setFromMatrix3(new AcGeMatrix2d().identity())
      .setFromExtrusionDirection(new AcGeVector3d(0, 0, 1))
      .extractBasis(xAxis, yAxis, zAxis)
      .makeBasis(
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 0, z: 1 }
      )
      .extractRotation(new AcGeMatrix3d().makeRotationZ(0.2))
      .makeRotationFromQuaternion(
        new AcGeQuaternion().setFromAxisAngle(AcGeVector3d.X_AXIS, 0.2)
      )
      .lookAt(
        new AcGeVector3d(0, 0, 10),
        new AcGeVector3d(),
        AcGeVector3d.Y_AXIS
      )
      .multiply(new AcGeMatrix3d().makeScale(2, 2, 2))
      .premultiply(new AcGeMatrix3d().makeTranslation(1, 1, 1))
      .multiplyMatrices(
        new AcGeMatrix3d().makeRotationX(0.1),
        new AcGeMatrix3d().makeTranslation(1, 2, 3)
      )
      .multiplyScalar(0.5)
    expect(m4.determinant()).toBeDefined()
    expect(m4.transpose()).toBeInstanceOf(AcGeMatrix3d)
    expect(m4.setPosition(1, 2, 3)).toBeInstanceOf(AcGeMatrix3d)
    expect(m4.invert()).toBeInstanceOf(AcGeMatrix3d)
    expect(m4.scale(new AcGeVector3d(2, 2, 2))).toBeInstanceOf(AcGeMatrix3d)
    expect(m4.getMaxScaleOnAxis()).toBeGreaterThan(0)
    expect(m4.makeTranslation(new AcGeVector3d(1, 2, 3), 0, 0)).toBeInstanceOf(
      AcGeMatrix3d
    )
    expect(
      m4.makeRotationX(0.1).makeRotationY(0.2).makeRotationZ(0.3)
    ).toBeInstanceOf(AcGeMatrix3d)
    expect(m4.makeRotationAxis(AcGeVector3d.Z_AXIS, 0.5)).toBeInstanceOf(
      AcGeMatrix3d
    )
    expect(m4.makeScale(2, 3, 4).makeShear(1, 0, 0, 0, 0, 0)).toBeInstanceOf(
      AcGeMatrix3d
    )
    expect(
      m4.compose(
        new AcGeVector3d(1, 2, 3),
        new AcGeQuaternion(),
        new AcGeVector3d(1, 1, 1)
      )
    ).toBeInstanceOf(AcGeMatrix3d)
    expect(
      m4.decompose(new AcGeVector3d(), new AcGeQuaternion(), new AcGeVector3d())
    ).toBeInstanceOf(AcGeMatrix3d)
    expect(m4.equals(m4.clone())).toBe(true)
    expect(
      m4.fromArray(new Array(16).fill(0).map((_, i) => i + 1)).toArray()
    ).toHaveLength(16)
  })

  it('covers quaternion and euler methods', () => {
    const q = new AcGeQuaternion(0, 0, 0, 1)
    const dst = [0, 0, 0, 0]
    AcGeQuaternion.slerpFlat(dst, 0, [0, 0, 0, 1], 0, [0, 0, 1, 0], 0, 0.5)
    expect(dst[3]).toBeDefined()
    expect(
      AcGeQuaternion.multiplyQuaternionsFlat(
        dst,
        0,
        [0, 0, 0, 1],
        0,
        [0, 0, 1, 0],
        0
      )
    ).toBe(dst)

    let changed = 0
    q._onChange(() => {
      changed++
    })
    q.x = 0.1
    q.y = 0.2
    q.z = 0.3
    q.w = 0.9
    expect(changed).toBeGreaterThan(0)

    const qa = new AcGeQuaternion().setFromAxisAngle(AcGeVector3d.X_AXIS, 0.2)
    const qb = new AcGeQuaternion().setFromAxisAngle(AcGeVector3d.Y_AXIS, 0.3)
    expect(q.set(0, 0, 0, 1).clone().copy(qa)).toBeInstanceOf(AcGeQuaternion)
    expect(q.setFromEuler(new AcGeEuler(0.1, 0.2, 0.3, 'XYZ'))).toBeInstanceOf(
      AcGeQuaternion
    )
    expect(
      q.setFromRotationMatrix(new AcGeMatrix3d().makeRotationZ(0.1))
    ).toBeInstanceOf(AcGeQuaternion)
    expect(
      q.setFromUnitVectors(new AcGeVector3d(1, 0, 0), new AcGeVector3d(0, 1, 0))
    ).toBeInstanceOf(AcGeQuaternion)
    expect(q.angleTo(qa)).toBeGreaterThanOrEqual(0)
    expect(q.rotateTowards(qa, 0.1)).toBeInstanceOf(AcGeQuaternion)
    expect(q.identity().invert().conjugate()).toBeInstanceOf(AcGeQuaternion)
    expect(q.dot(qa)).toBeDefined()
    expect(q.lengthSq()).toBeDefined()
    expect(q.length()).toBeDefined()
    expect(q.normalize().length()).toBeCloseTo(1, 6)
    expect(
      q.multiply(qa).premultiply(qb).multiplyQuaternions(qa, qb)
    ).toBeInstanceOf(AcGeQuaternion)
    expect(q.slerp(qa, 0.3)).toBeInstanceOf(AcGeQuaternion)
    expect(q.slerpQuaternions(qa, qb, 0.5)).toBeInstanceOf(AcGeQuaternion)
    expect(q.random().length()).toBeCloseTo(1, 6)
    expect(q.equals(q.clone())).toBe(true)
    expect(q.fromArray([1, 2, 3, 4], 0).toArray()).toEqual([1, 2, 3, 4])
    expect(q.toJSON()).toHaveLength(4)

    const e = new AcGeEuler(0.1, 0.2, 0.3, 'XYZ')
    let eChanged = 0
    e._onChange(() => {
      eChanged++
    })
    e.x = 0.2
    e.y = 0.3
    e.z = 0.4
    e.order = 'ZYX'
    expect(eChanged).toBeGreaterThan(0)

    expect(e.set(0.1, 0.2, 0.3, 'YZX')).toBeInstanceOf(AcGeEuler)
    expect(e.clone().copy(new AcGeEuler(0.3, 0.2, 0.1, 'XYZ'))).toBeInstanceOf(
      AcGeEuler
    )
    expect(
      e.setFromRotationMatrix(new AcGeMatrix3d().makeRotationX(0.2), 'XYZ')
    ).toBeInstanceOf(AcGeEuler)
    expect(e.setFromQuaternion(new AcGeQuaternion(), 'XYZ')).toBeInstanceOf(
      AcGeEuler
    )
    expect(
      e.setFromVector3(new AcGeVector3d(0.1, 0.2, 0.3), 'XYZ')
    ).toBeInstanceOf(AcGeEuler)
    expect(e.reorder('ZXY')).toBeInstanceOf(AcGeEuler)
    expect(e.equals(e.clone())).toBe(true)
    expect(e.fromArray([0.1, 0.2, 0.3, 'XYZ']).toArray()).toHaveLength(4)
  })

  it('covers box and plane methods', () => {
    const b2 = new AcGeBox2d()
    b2.set({ x: 0, y: 0 }, { x: 1, y: 1 })
      .setFromPoints([
        { x: 0, y: 0 },
        { x: 2, y: 3 }
      ])
      .setFromCenterAndSize({ x: 1, y: 1 }, { x: 2, y: 4 })
    expect(b2.clone().copy(b2)).toBeInstanceOf(AcGeBox2d)
    expect(b2.makeEmpty().isEmpty()).toBe(true)
    b2.set({ x: 0, y: 0 }, { x: 2, y: 2 })
    expect(b2.getCenter(new AcGeVector2d()).toArray()).toEqual([1, 1])
    expect(b2.getSize(new AcGeVector2d()).toArray()).toEqual([2, 2])
    expect(b2.center).toBeInstanceOf(AcGeVector2d)
    expect(b2.size).toBeInstanceOf(AcGeVector2d)
    expect(b2.expandByPoint({ x: 3, y: -1 })).toBeInstanceOf(AcGeBox2d)
    expect(b2.expandByVector({ x: 1, y: 1 })).toBeInstanceOf(AcGeBox2d)
    expect(b2.expandByScalar(1)).toBeInstanceOf(AcGeBox2d)
    expect(b2.containsPoint({ x: 1, y: 1 })).toBe(true)
    expect(b2.containsBox(new AcGeBox2d({ x: 0, y: 0 }, { x: 1, y: 1 }))).toBe(
      true
    )
    expect(b2.getParameter({ x: 1, y: 1 }, new AcGeVector2d())).toBeInstanceOf(
      AcGeVector2d
    )
    expect(
      b2.intersectsBox(new AcGeBox2d({ x: 1, y: 1 }, { x: 4, y: 4 }))
    ).toBe(true)
    expect(
      b2.clampPoint({ x: 10, y: 10 }, new AcGeVector2d()).toArray()
    ).toEqual([5, 4])
    expect(b2.distanceToPoint({ x: 5, y: 5 })).toBeGreaterThan(0)
    expect(
      b2.clone().intersect(new AcGeBox2d({ x: 1, y: 1 }, { x: 2, y: 2 }))
    ).toBeInstanceOf(AcGeBox2d)
    expect(
      b2.clone().union(new AcGeBox2d({ x: -1, y: -1 }, { x: 0, y: 0 }))
    ).toBeInstanceOf(AcGeBox2d)
    expect(b2.translate({ x: 1, y: 1 })).toBeInstanceOf(AcGeBox2d)
    expect(b2.equals(b2.clone())).toBe(true)

    const b3 = new AcGeBox3d()
    b3.set({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })
      .setFromArray([0, 0, 0, 2, 3, 4])
      .setFromPoints([
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 2, z: 2 }
      ])
      .setFromCenterAndSize({ x: 1, y: 1, z: 1 }, { x: 2, y: 2, z: 2 })
    expect(b3.clone().copy(b3)).toBeInstanceOf(AcGeBox3d)
    expect(b3.makeEmpty().isEmpty()).toBe(true)
    b3.set({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 })
    expect(b3.getCenter(new AcGeVector3d()).toArray()).toEqual([1, 1, 1])
    expect(b3.getSize(new AcGeVector3d()).toArray()).toEqual([2, 2, 2])
    expect(b3.center).toBeInstanceOf(AcGeVector3d)
    expect(b3.size).toBeInstanceOf(AcGeVector3d)
    expect(b3.expandByPoint({ x: 3, y: -1, z: 0 })).toBeInstanceOf(AcGeBox3d)
    expect(b3.expandByVector({ x: 1, y: 1, z: 1 })).toBeInstanceOf(AcGeBox3d)
    expect(b3.expandByScalar(1)).toBeInstanceOf(AcGeBox3d)
    expect(b3.containsPoint({ x: 1, y: 1, z: 1 })).toBe(true)
    expect(
      b3.containsBox(new AcGeBox3d({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }))
    ).toBe(true)
    expect(
      b3.getParameter({ x: 1, y: 1, z: 1 }, new AcGeVector3d())
    ).toBeInstanceOf(AcGeVector3d)
    expect(
      b3.intersectsBox(
        new AcGeBox3d({ x: 1, y: 1, z: 1 }, { x: 4, y: 4, z: 4 })
      )
    ).toBe(true)

    const plane = new AcGePlane().setComponents(0, 0, 1, -1)
    expect(b3.intersectsPlane(plane)).toBe(true)
    expect(
      b3.clampPoint({ x: 10, y: 10, z: 10 }, new AcGeVector3d())
    ).toBeInstanceOf(AcGeVector3d)
    expect(b3.distanceToPoint({ x: 5, y: 5, z: 5 })).toBeGreaterThan(0)
    expect(
      b3
        .clone()
        .intersect(new AcGeBox3d({ x: 1, y: 1, z: 1 }, { x: 2, y: 2, z: 2 }))
    ).toBeInstanceOf(AcGeBox3d)
    expect(
      b3
        .clone()
        .union(new AcGeBox3d({ x: -1, y: -1, z: -1 }, { x: 0, y: 0, z: 0 }))
    ).toBeInstanceOf(AcGeBox3d)
    expect(
      b3.applyMatrix4(new AcGeMatrix3d().makeTranslation(1, 2, 3))
    ).toBeInstanceOf(AcGeBox3d)
    expect(b3.translate({ x: -1, y: -2, z: -3 })).toBeInstanceOf(AcGeBox3d)
    expect(b3.equals(b3.clone())).toBe(true)

    const p2 = new AcGePlane()
      .set({ x: 0, y: 1, z: 0 }, -2)
      .setFromNormalAndCoplanarPoint(
        { x: 0, y: 1, z: 0 },
        new AcGeVector3d(0, 2, 0)
      )
      .setFromCoplanarPoints(
        new AcGeVector3d(0, 0, 0),
        new AcGeVector3d(1, 0, 0),
        new AcGeVector3d(0, 0, 1)
      )
    expect(p2.copy(plane)).toBeInstanceOf(AcGePlane)
    expect(p2.normalize().negate()).toBeInstanceOf(AcGePlane)
    expect(p2.distanceToPoint({ x: 0, y: 0, z: 0 })).toBeDefined()
    expect(
      p2.projectPoint({ x: 1, y: 3, z: 1 }, new AcGeVector3d())
    ).toBeInstanceOf(AcGeVector3d)
    expect(
      p2.intersectsBox(
        new AcGeBox3d({ x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 })
      )
    ).toBe(true)
    expect(p2.coplanarPoint(new AcGeVector3d())).toBeInstanceOf(AcGeVector3d)
    expect(
      p2.applyMatrix4(
        new AcGeMatrix3d().makeTranslation(0, 1, 0),
        new AcGeMatrix2d()
      )
    ).toBeInstanceOf(AcGePlane)
    expect(p2.translate(new AcGeVector3d(0, 1, 0))).toBeInstanceOf(AcGePlane)
    expect(p2.equals(p2.clone())).toBe(true)
  })

  it('covers representative geometry class public methods', () => {
    const line2 = new AcGeLine2d({ x: 0, y: 0 }, { x: 2, y: 0 })
    expect(line2.length).toBeCloseTo(2, 6)
    line2.startPoint = { x: 1, y: 1 }
    line2.endPoint = { x: 3, y: 1 }
    expect(line2.getPoints()).toHaveLength(2)
    expect(line2.calculateBoundingBox()).toBeInstanceOf(AcGeBox2d)
    expect(
      line2.transform(new AcGeMatrix2d().makeTranslation(1, 1))
    ).toBeInstanceOf(AcGeLine2d)
    expect(line2.closed).toBe(false)
    expect(
      line2.copy(new AcGeLine2d({ x: 0, y: 0 }, { x: 1, y: 1 }))
    ).toBeInstanceOf(AcGeLine2d)
    expect(line2.clone()).toBeInstanceOf(AcGeLine2d)

    const line3 = new AcGeLine3d({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 })
    expect(line3.direction.length()).toBeCloseTo(1, 6)
    expect(line3.midPoint.x).toBeCloseTo(1, 6)
    expect(line3.nearestPoint({ x: 1, y: 1, z: 0 }).x).toBeCloseTo(1, 6)
    expect(line3.isPointOnLine({ x: 1, y: 0, z: 0 })).toBe(true)
    expect(line3.at(0.5, new AcGePoint3d()).x).toBeCloseTo(1, 6)
    expect(line3.atLength(1).x).toBeDefined()
    expect(line3.extend(1)).toBeInstanceOf(AcGeLine3d)
    expect(
      line3.closestPointToPointParameter(new AcGePoint3d(2, 1, 0), true)
    ).toBeDefined()
    expect(
      line3.closestPointToPoint(
        new AcGePoint3d(2, 1, 0),
        true,
        new AcGePoint3d()
      )
    ).toBeInstanceOf(AcGePoint3d)
    expect(line3.delta(new AcGeVector3d())).toBeInstanceOf(AcGeVector3d)
    expect(line3.distanceSq()).toBeGreaterThanOrEqual(0)
    expect(line3.distance()).toBeGreaterThanOrEqual(0)
    expect(line3.project({ x: 1, y: 1, z: 0 })).toBeInstanceOf(AcGePoint3d)
    expect(line3.perpPoint({ x: 1, y: 1, z: 0 })).toBeInstanceOf(AcGePoint3d)
    expect(line3.calculateBoundingBox()).toBeInstanceOf(AcGeBox3d)
    expect(
      line3.transform(new AcGeMatrix3d().makeTranslation(1, 1, 1))
    ).toBeInstanceOf(AcGeLine3d)
    expect(line3.closed).toBe(false)
    expect(
      line3.copy(new AcGeLine3d({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }))
    ).toBeInstanceOf(AcGeLine3d)
    expect(line3.clone()).toBeInstanceOf(AcGeLine3d)

    const poly = new AcGePolyline2d([
      { x: 0, y: 0 },
      { x: 3, y: 0, bulge: 1 },
      { x: 3, y: 3 }
    ])
    expect(poly.vertices).toHaveLength(3)
    expect(poly.numberOfVertices).toBe(3)
    expect(poly.closed).toBe(false)
    poly.closed = true
    expect(poly.startPoint).toBeInstanceOf(AcGePoint2d)
    expect(poly.endPoint).toBeInstanceOf(AcGePoint2d)
    expect(poly.length).toBeGreaterThan(0)
    poly.addVertexAt(0, { x: -1, y: 0 })
    poly.removeVertexAt(0)
    poly.reset(true, 2)
    poly.addVertexAt(2, { x: 2, y: 2 })
    expect(poly.getPointAt(0)).toBeInstanceOf(AcGePoint2d)
    expect(poly.calculateBoundingBox()).toBeInstanceOf(AcGeBox2d)
    expect(poly.transform(new AcGeMatrix2d().makeScale(-1, 1))).toBeInstanceOf(
      AcGePolyline2d
    )
    expect(poly.getPoints3d(6, 10)[0].z).toBe(10)
    expect(poly.getPoints(6).length).toBeGreaterThan(0)
    poly.translate({ x: 1, y: 2 })

    const loop = new AcGeLoop2d([
      new AcGeLine2d({ x: 0, y: 0 }, { x: 2, y: 0 }),
      new AcGeLine2d({ x: 2, y: 0 }, { x: 2, y: 2 }),
      new AcGeLine2d({ x: 2, y: 2 }, { x: 0, y: 2 }),
      new AcGeLine2d({ x: 0, y: 2 }, { x: 0, y: 0 })
    ])
    expect(loop.curves).toHaveLength(4)
    loop.add(new AcGeLine2d({ x: 0, y: 0 }, { x: 0, y: 0 }))
    expect(loop.numberOfEdges).toBe(5)
    expect(loop.startPoint).toBeInstanceOf(AcGePoint2d)
    expect(loop.endPoint).toBeInstanceOf(AcGePoint2d)
    expect(loop.length).toBeGreaterThan(0)
    expect(loop.calculateBoundingBox()).toBeInstanceOf(AcGeBox2d)
    expect(
      loop.transform(new AcGeMatrix2d().makeTranslation(1, 1))
    ).toBeInstanceOf(AcGeLoop2d)
    expect(loop.closed).toBe(true)
    expect(loop.getPoints(5).length).toBeGreaterThan(0)

    const builtLoops = AcGeLoop2d.buildFromEdges([
      new AcGeLine2d({ x: 0, y: 0 }, { x: 1, y: 0 }),
      new AcGeLine2d({ x: 1, y: 0 }, { x: 1, y: 1 }),
      new AcGeLine2d({ x: 1, y: 1 }, { x: 0, y: 1 }),
      new AcGeLine2d({ x: 0, y: 1 }, { x: 0, y: 0 })
    ])
    expect(builtLoops.length).toBeGreaterThan(0)

    const area = new AcGeArea2d()
    area.add(loop)
    area.add(
      new AcGePolyline2d(
        [
          { x: 0.2, y: 0.2 },
          { x: 0.8, y: 0.2 },
          { x: 0.8, y: 0.8 },
          { x: 0.2, y: 0.8 }
        ],
        true
      )
    )
    expect(area.loops).toHaveLength(2)
    expect(area.outter).toBeDefined()
    expect(area.calculateBoundingBox()).toBeInstanceOf(AcGeBox2d)
    expect(
      area.transform(new AcGeMatrix2d().makeTranslation(1, 0))
    ).toBeInstanceOf(AcGeArea2d)
    expect(area.getPoints(8)).toHaveLength(2)
    expect(area.buildHierarchy().index).toBe(-1)
    expect(area.area).toBeGreaterThan(0)

    const circ3 = new AcGeCircArc3d({ x: 0, y: 0, z: 0 }, 5, 0, Math.PI, {
      x: 0,
      y: 0,
      z: 1
    })
    expect(circ3.center).toBeInstanceOf(AcGePoint3d)
    circ3.center = { x: 1, y: 1, z: 0 }
    circ3.radius = 3
    circ3.startAngle = 0
    circ3.endAngle = Math.PI / 2
    circ3.normal = { x: 0, y: 0, z: 1 }
    circ3.refVec = { x: 1, y: 0, z: 0 }
    expect(circ3.deltaAngle).toBeGreaterThan(0)
    expect(typeof circ3.isLargeArc).toBe('number')
    expect(circ3.clockwise).toBeDefined()
    expect(circ3.startPoint).toBeInstanceOf(AcGePoint3d)
    expect(circ3.endPoint).toBeInstanceOf(AcGePoint3d)
    expect(circ3.midPoint).toBeInstanceOf(AcGePoint3d)
    expect(circ3.length).toBeGreaterThan(0)
    expect(circ3.area).toBe(0)
    const nearest = circ3.nearestPoint({ x: 10, y: 0, z: 0 })
    expect(nearest).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
      z: expect.any(Number)
    })
    expect(circ3.tangentPoints({ x: 10, y: 10, z: 0 })).toBeInstanceOf(Array)
    expect(circ3.nearestTangentPoint({ x: 10, y: 10, z: 0 })).toBeInstanceOf(
      AcGePoint3d
    )
    expect(circ3.calculateBoundingBox()).toBeInstanceOf(AcGeBox3d)
    expect(circ3.closed).toBe(false)
    expect(circ3.getPoints(8).length).toBe(9)
    expect(
      circ3.transform(new AcGeMatrix3d().makeTranslation(1, 2, 3))
    ).toBeInstanceOf(AcGeCircArc3d)
    expect(circ3.copy(circ3.clone())).toBeInstanceOf(AcGeCircArc3d)
    expect(circ3.getAngle(circ3.startPoint.clone())).toBeDefined()
    expect(circ3.getPointAtAngle(0)).toBeInstanceOf(AcGePoint3d)
    expect(circ3.plane).toBeInstanceOf(AcGePlane)
    const computedCenter = AcGeCircArc3d.computeCenterPoint(
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 }
    )
    expect(computedCenter).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
      z: expect.any(Number)
    })
    expect(
      AcGeCircArc3d.createByThreePoints(
        { x: 1, y: 0, z: 0 },
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 }
      )
    ).toBeInstanceOf(AcGeCircArc3d)

    const ellipse2 = new AcGeEllipseArc2d(
      { x: 0, y: 0 },
      4,
      2,
      0,
      Math.PI,
      false,
      0.2
    )
    expect(ellipse2.calculateBoundingBox()).toBeInstanceOf(AcGeBox2d)
    expect(ellipse2.getPoint(0.25)).toBeInstanceOf(AcGePoint2d)
    expect(
      ellipse2.transform(new AcGeMatrix2d().makeTranslation(1, 1))
    ).toBeInstanceOf(AcGeEllipseArc2d)
    expect(ellipse2.copy(ellipse2.clone())).toBeInstanceOf(AcGeEllipseArc2d)

    const ellipse3 = new AcGeEllipseArc3d(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 0 },
      4,
      2,
      0,
      Math.PI
    )
    expect(ellipse3.majorAxisRadius).toBe(4)
    ellipse3.majorAxisRadius = 5
    ellipse3.minorAxisRadius = 2
    ellipse3.startAngle = 0
    ellipse3.endAngle = Math.PI
    ellipse3.normal = { x: 0, y: 0, z: 1 }
    ellipse3.majorAxis = { x: 1, y: 0, z: 0 }
    expect(ellipse3.minorAxis).toBeInstanceOf(AcGeVector3d)
    expect(ellipse3.startPoint).toBeInstanceOf(AcGePoint3d)
    expect(ellipse3.endPoint).toBeInstanceOf(AcGePoint3d)
    expect(ellipse3.midPoint).toBeInstanceOf(AcGePoint3d)
    expect(ellipse3.isCircular).toBe(false)
    expect(ellipse3.length).toBeGreaterThan(0)
    expect(ellipse3.area).toBe(0)
    expect(ellipse3.calculateBoundingBox()).toBeInstanceOf(AcGeBox3d)
    expect(ellipse3.closed).toBe(false)
    expect(ellipse3.getPoints(8).length).toBe(9)
    expect(ellipse3.getPointAtAngle(0)).toBeInstanceOf(AcGePoint3d)
    expect(ellipse3.contains(new AcGePoint3d(1, 0, 0))).toBe(true)
    expect(
      ellipse3.transform(new AcGeMatrix3d().makeScale(1.5, 0.5, 1))
    ).toBeInstanceOf(AcGeEllipseArc3d)
    expect(ellipse3.copy(ellipse3.clone())).toBeInstanceOf(AcGeEllipseArc3d)
    expect(ellipse3.plane).toBeInstanceOf(AcGePlane)

    const catmull = new AcGeCatmullRomCurve3d(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 2, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 2, z: 0 }
      ],
      false,
      'catmullrom'
    )
    expect(catmull.points.length).toBe(4)
    expect(catmull.closed).toBe(false)
    expect(catmull.curveType).toBe('catmullrom')
    expect(catmull.tension).toBeCloseTo(0.5, 6)
    expect(catmull.startPoint).toBeInstanceOf(AcGePoint3d)
    expect(catmull.endPoint).toBeInstanceOf(AcGePoint3d)
    expect(catmull.length).toBeGreaterThan(0)
    expect(catmull.getPoint(0.3)).toBeInstanceOf(AcGePoint3d)
    expect(catmull.getPoints(10)).toHaveLength(11)
    catmull.setPoints([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 3, y: 1, z: 0 }
    ])
    catmull.setClosed(true)
    catmull.setCurveType('centripetal')
    catmull.setTension(0.3)
    expect(
      catmull.transform(new AcGeMatrix3d().makeTranslation(1, 0, 0))
    ).toBeInstanceOf(AcGeCatmullRomCurve3d)

    const nurbs = new AcGeNurbsCurve(
      2,
      [0, 0, 0, 1, 1, 1],
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 }
      ]
    )
    expect(nurbs.degree()).toBe(2)
    expect(nurbs.knots()).toHaveLength(6)
    expect(nurbs.controlPoints()).toHaveLength(3)
    expect(nurbs.weights()).toHaveLength(3)
    expect(nurbs.point(0.5)).toHaveLength(3)
    expect(nurbs.length()).toBeGreaterThan(0)
    expect(
      AcGeNurbsCurve.byKnotsControlPointsWeights(
        2,
        [0, 0, 0, 1, 1, 1],
        [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 2, y: 0, z: 0 }
        ]
      )
    ).toBeInstanceOf(AcGeNurbsCurve)
    expect(
      AcGeNurbsCurve.byPoints(
        [
          [0, 0, 0],
          [1, 1, 0],
          [2, 0, 0],
          [3, 1, 0]
        ],
        3,
        'Chord'
      )
    ).toBeInstanceOf(AcGeNurbsCurve)
    expect(nurbs.getParameterRange().start).toBeDefined()
    expect(nurbs.getPoints(5)).toHaveLength(6)
    expect(nurbs.isClosed()).toBe(false)
    expect(
      AcGeNurbsCurve.createFitPointsForClosedCurve([
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 }
      ])
    ).toBeInstanceOf(Array)
    expect(
      AcGeNurbsCurve.createClosedCurve(
        [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 1, y: 1, z: 0 },
          { x: 0, y: 1, z: 0 }
        ],
        3
      )
    ).toBeInstanceOf(AcGeNurbsCurve)

    const circ2 = new AcGeCircArc2d({ x: 0, y: 0 }, 2, 0, Math.PI, false)
    expect(circ2.clone()).toBeInstanceOf(AcGeCircArc2d)
    const rev = new AcGeLoop2d([
      new AcGeLine2d({ x: 0, y: 0 }, { x: 1, y: 0 }),
      new AcGeCircArc2d({ x: 1, y: 1 }, 1, -Math.PI / 2, 0, false),
      new AcGeEllipseArc2d({ x: 0, y: 1 }, 1, 0.5, 0, Math.PI / 2, false, 0)
    ])
    expect(rev.getPoints(4).length).toBeGreaterThan(0)
  })
})
