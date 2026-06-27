import { AcGeMathUtil } from '../src'

describe('Test AcGeMathUtil', () => {
  it('covers scalar conversion and interpolation helpers', () => {
    expect(AcGeMathUtil.clamp(10, 0, 5)).toBe(5)
    expect(AcGeMathUtil.euclideanModulo(-1, 5)).toBe(4)
    expect(AcGeMathUtil.mapLinear(5, 0, 10, 0, 100)).toBe(50)
    expect(AcGeMathUtil.inverseLerp(0, 10, 5)).toBe(0.5)
    expect(AcGeMathUtil.inverseLerp(1, 1, 10)).toBe(0)
    expect(AcGeMathUtil.lerp(10, 20, 0.25)).toBe(12.5)
    expect(AcGeMathUtil.damp(0, 10, 2, 0.5)).toBeGreaterThan(0)
    expect(AcGeMathUtil.pingpong(2.5, 2)).toBeCloseTo(1.5, 8)
    expect(AcGeMathUtil.smoothstep(-1, 0, 1)).toBe(0)
    expect(AcGeMathUtil.smoothstep(2, 0, 1)).toBe(1)
    expect(AcGeMathUtil.smoothstep(0.5, 0, 1)).toBeCloseTo(0.5, 12)
    expect(AcGeMathUtil.smootherstep(-1, 0, 1)).toBe(0)
    expect(AcGeMathUtil.smootherstep(2, 0, 1)).toBe(1)
    expect(AcGeMathUtil.smootherstep(0.5, 0, 1)).toBeCloseTo(0.5, 12)
  })

  it('covers random and power-of-two helpers', () => {
    const uuid = AcGeMathUtil.generateUUID()
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )

    const rInt = AcGeMathUtil.randInt(3, 6)
    expect(rInt).toBeGreaterThanOrEqual(3)
    expect(rInt).toBeLessThanOrEqual(6)

    const rFloat = AcGeMathUtil.randFloat(2, 3)
    expect(rFloat).toBeGreaterThanOrEqual(2)
    expect(rFloat).toBeLessThan(3)

    const spread = AcGeMathUtil.randFloatSpread(10)
    expect(spread).toBeGreaterThanOrEqual(-5)
    expect(spread).toBeLessThanOrEqual(5)

    const seededA = AcGeMathUtil.seededRandom(12345)
    const seededB = AcGeMathUtil.seededRandom(12345)
    expect(seededA).toBeCloseTo(seededB, 12)
    expect(AcGeMathUtil.seededRandom(54321)).toBeGreaterThanOrEqual(0)
    expect(AcGeMathUtil.seededRandom(54321)).toBeLessThan(1)

    expect(AcGeMathUtil.degToRad(180)).toBeCloseTo(Math.PI, 12)
    expect(AcGeMathUtil.radToDeg(Math.PI)).toBeCloseTo(180, 12)
    expect(AcGeMathUtil.isPowerOfTwo(8)).toBe(true)
    expect(AcGeMathUtil.isPowerOfTwo(6)).toBe(false)
    expect(AcGeMathUtil.ceilPowerOfTwo(9)).toBe(16)
    expect(AcGeMathUtil.floorPowerOfTwo(9)).toBe(8)
  })

  it('covers angle and epsilon helpers', () => {
    expect(AcGeMathUtil.normalizeAngle(-Math.PI / 2)).toBeCloseTo(
      Math.PI * 1.5,
      12
    )
    expect(AcGeMathUtil.isBetween(3, 1, 5)).toBe(true)
    expect(AcGeMathUtil.isBetween(0, 1, 5)).toBe(false)
    expect(AcGeMathUtil.intPartLength(0.8)).toBe(0)
    expect(AcGeMathUtil.intPartLength(1234.56)).toBe(4)
    expect(AcGeMathUtil.relativeEps(1234.56)).toBeGreaterThan(1.0e-7)
    expect(AcGeMathUtil.relativeEps(0.001)).toBe(1.0e-7)
  })

  it('.isBetweenAngle checks angle between start and end angle correctly', () => {
    expect(
      AcGeMathUtil.isBetweenAngle(Math.PI / 4, 0, Math.PI / 2, false)
    ).toBeTruthy()
    expect(
      AcGeMathUtil.isBetweenAngle((Math.PI * 3) / 4, 0, Math.PI / 2, false)
    ).toBeFalsy()
    expect(
      AcGeMathUtil.isBetweenAngle(Math.PI / 2, 0, Math.PI, false)
    ).toBeTruthy()
    expect(
      AcGeMathUtil.isBetweenAngle((Math.PI * 3) / 2, 0, Math.PI, false)
    ).toBeFalsy()
    expect(
      AcGeMathUtil.isBetweenAngle(0, Math.PI, Math.PI / 2, false)
    ).toBeTruthy()
    expect(
      AcGeMathUtil.isBetweenAngle(
        (Math.PI * 3) / 4,
        Math.PI,
        Math.PI / 2,
        false
      )
    ).toBeFalsy()

    expect(
      AcGeMathUtil.isBetweenAngle(Math.PI / 4, 0, Math.PI / 2, true)
    ).toBeFalsy()
    expect(
      AcGeMathUtil.isBetweenAngle((Math.PI * 3) / 4, 0, Math.PI / 2, true)
    ).toBeTruthy()
    expect(
      AcGeMathUtil.isBetweenAngle(Math.PI / 2, 0, Math.PI, true)
    ).toBeFalsy()
    expect(
      AcGeMathUtil.isBetweenAngle((Math.PI * 3) / 2, 0, Math.PI, true)
    ).toBeTruthy()
    expect(
      AcGeMathUtil.isBetweenAngle(0, Math.PI, Math.PI / 2, true)
    ).toBeFalsy()
    expect(
      AcGeMathUtil.isBetweenAngle((Math.PI * 3) / 4, Math.PI, Math.PI / 2, true)
    ).toBeTruthy()
  })
})
