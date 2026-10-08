import type { AcDbAcisModel, AcDbAcisNode } from '../src/acis/AcDbAcisEntities'
import { AcDbAcisSabTag } from '../src/acis/AcDbAcisSab'
import { acdbAcisWireframeSegmentsFromSatText } from '../src/acis/AcDbAcisSatWireframe'
import {
  acdbAcisBuildNodeTransforms,
  acdbAcisModelSpaceTransform,
  acdbAcisTransformDirection,
  acdbAcisTransformIsIdentity,
  acdbAcisTransformPoint,
  acdbAcisTransformSegments,
  acdbAcisTransformsEqual,
  type AcDbAcisAffineTransform,
} from '../src/acis/AcDbAcisTransform'

const translationOnly: AcDbAcisAffineTransform = {
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  zAxis: [0, 0, 1],
  translation: [-6438.553441499935, -965.402812514523, 0],
  scale: 1,
}

function transformNode(
  index: number,
  transform: AcDbAcisAffineTransform,
): AcDbAcisNode {
  return {
    index,
    type: 'transform',
    record: {
      type: 'transform',
      tokens: [
        { tag: AcDbAcisSabTag.DirectionVec, value: transform.xAxis },
        { tag: AcDbAcisSabTag.DirectionVec, value: transform.yAxis },
        { tag: AcDbAcisSabTag.DirectionVec, value: transform.zAxis },
        { tag: AcDbAcisSabTag.LocationVec, value: transform.translation },
        { tag: AcDbAcisSabTag.Double, value: transform.scale },
      ],
    },
    refs: [],
  }
}

function mockNode(
  index: number,
  type: string,
  refs: Array<AcDbAcisNode | null> = [],
): AcDbAcisNode {
  return {
    index,
    type,
    record: { type, tokens: [] },
    refs,
  }
}

function mockModel(bodies: AcDbAcisNode[]): AcDbAcisModel {
  const nodes: AcDbAcisNode[] = []
  const visit = (node: AcDbAcisNode | null): void => {
    if (node == null || nodes[node.index] === node) return
    nodes[node.index] = node
    for (const ref of node.refs) visit(ref)
  }
  for (const body of bodies) visit(body)
  return {
    header: {
      signature: 'ACIS BinaryFile',
      version: 700,
      numRecords: nodes.length,
      numEntities: nodes.length,
      flags: 0,
      productId: '',
      acisVersion: '',
      creationDate: '',
      unitsInMm: 1,
      resTol: 1e-6,
      norTol: 1e-10,
    },
    nodes,
    bodies,
    typeCounts: new Map(),
    nodesOfType: () => [],
    pointLocations: () => [],
  }
}

describe('AcDbAcisTransform', () => {
  it('detects identity transforms', () => {
    expect(
      acdbAcisTransformIsIdentity({
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        zAxis: [0, 0, 1],
        translation: [0, 0, 0],
        scale: 1,
      }),
    ).toBe(true)
    expect(acdbAcisTransformIsIdentity(translationOnly)).toBe(false)
  })

  it('treats near-equal transforms as equal', () => {
    const a: AcDbAcisAffineTransform = {
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      zAxis: [0, 0, 1],
      translation: [1, 2, 3],
      scale: 1,
    }
    const b: AcDbAcisAffineTransform = {
      ...a,
      translation: [1 + 1e-13, 2, 3],
    }
    expect(acdbAcisTransformsEqual(a, b)).toBe(true)
  })

  it('maps body-space points into model space with translation', () => {
    // Mirrors anteensolids equipment-03 solid A1AAD: body-space XY near
    // (6437–6438, 962–968) plus the body transform lands on the same local
    // frame as the block's LWPOLYLINE / LINE geometry.
    expect(
      acdbAcisTransformPoint([6437.353441499935, 962.277812514523, 14.2], translationOnly),
    ).toEqual([-1.199999999999818, -3.125, 14.2])
    expect(
      acdbAcisTransformPoint([6438.553441499935, 968.527812514523, 14.5], translationOnly),
    ).toEqual([0, 3.125, 14.5])
  })

  it('transforms directions without applying translation', () => {
    expect(acdbAcisTransformDirection([1, 0, 0], translationOnly)).toEqual([
      1, 0, 0,
    ])
  })

  it('transforms wireframe segment endpoints', () => {
    const segments = new Float32Array([
      6437.353441499935, 962.277812514523, 14.2, 6438.553441499935,
      968.527812514523, 14.5,
    ])
    const out = acdbAcisTransformSegments(segments, translationOnly)
    // Float32Array storage rounds intermediates; check model-space placement.
    expect(out[0]).toBeCloseTo(-1.2, 3)
    expect(out[1]).toBeCloseTo(-3.125, 3)
    expect(out[2]).toBeCloseTo(14.2, 5)
    expect(out[3]).toBeCloseTo(0, 3)
    expect(out[4]).toBeCloseTo(3.125, 3)
    expect(out[5]).toBeCloseTo(14.5, 5)
  })

  it('keeps a shared model-space transform when bodies nearly agree', () => {
    const shared: AcDbAcisAffineTransform = {
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      zAxis: [0, 0, 1],
      translation: [10, 20, 30],
      scale: 1,
    }
    const nearShared: AcDbAcisAffineTransform = {
      ...shared,
      translation: [10 + 1e-13, 20, 30],
    }
    const bodyA = mockNode(0, 'body', [transformNode(1, shared)])
    const bodyB = mockNode(2, 'body', [transformNode(3, nearShared)])
    const modelTransform = acdbAcisModelSpaceTransform(mockModel([bodyA, bodyB]))
    expect(modelTransform.translation[0]).toBeCloseTo(10, 12)
    expect(modelTransform.translation[1]).toBe(20)
    expect(modelTransform.translation[2]).toBe(30)
  })

  it('returns identity for model-space transform when bodies disagree', () => {
    const a: AcDbAcisAffineTransform = {
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      zAxis: [0, 0, 1],
      translation: [1, 0, 0],
      scale: 1,
    }
    const b: AcDbAcisAffineTransform = {
      ...a,
      translation: [2, 0, 0],
    }
    const bodyA = mockNode(0, 'body', [transformNode(1, a)])
    const bodyB = mockNode(2, 'body', [transformNode(3, b)])
    expect(
      acdbAcisTransformIsIdentity(acdbAcisModelSpaceTransform(mockModel([bodyA, bodyB]))),
    ).toBe(true)
  })

  it('assigns each topology node its owning body transform', () => {
    const tA: AcDbAcisAffineTransform = {
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      zAxis: [0, 0, 1],
      translation: [100, 0, 0],
      scale: 1,
    }
    const tB: AcDbAcisAffineTransform = {
      ...tA,
      translation: [0, 200, 0],
    }
    const faceA = mockNode(2, 'face')
    const faceB = mockNode(5, 'face')
    const lumpA = mockNode(3, 'lump', [faceA])
    const lumpB = mockNode(6, 'lump', [faceB])
    const bodyA = mockNode(0, 'body', [lumpA, transformNode(1, tA)])
    const bodyB = mockNode(4, 'body', [lumpB, transformNode(7, tB)])

    const map = acdbAcisBuildNodeTransforms(mockModel([bodyA, bodyB]))
    expect(map.get(faceA.index)?.translation).toEqual([100, 0, 0])
    expect(map.get(faceB.index)?.translation).toEqual([0, 200, 0])
  })
})

describe('acdbAcisWireframeSegmentsFromSatText transform', () => {
  it('applies a body transform to straight-curve segments', () => {
    const sat = `
-0 body $1 $-1 $-1 $2 #
-1 attrib $-1 #
-2 transform $-1 1 0 0 0 1 0 0 0 1 5 6 7 1 no_rotate no_reflect no_shear #
-3 straight-curve $-1 0 0 0 1 0 0 #
End-of-ACIS-data
`
    const out = acdbAcisWireframeSegmentsFromSatText(sat)
    expect(out.length).toBe(6)
    expect(out[0]).toBeCloseTo(5, 5)
    expect(out[1]).toBeCloseTo(6, 5)
    expect(out[2]).toBeCloseTo(7, 5)
    expect(out[3]).toBeCloseTo(6, 5)
    expect(out[4]).toBeCloseTo(6, 5)
    expect(out[5]).toBeCloseTo(7, 5)
  })
})
