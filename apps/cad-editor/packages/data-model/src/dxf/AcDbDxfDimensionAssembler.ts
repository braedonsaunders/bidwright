import { AcGePoint3d } from '@mlightcad/geometry-engine'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import type { AcDbDxfPair } from '../base/AcDbDxfPair'
import type { AcDbEntity } from '../entity/AcDbEntity'
import { AcDb3PointAngularDimension } from '../entity/dimension/AcDb3PointAngularDimension'
import { AcDbAlignedDimension } from '../entity/dimension/AcDbAlignedDimension'
import { AcDbArcDimension } from '../entity/dimension/AcDbArcDimension'
import { AcDbDiametricDimension } from '../entity/dimension/AcDbDiametricDimension'
import type { AcDbDimension } from '../entity/dimension/AcDbDimension'
import { AcDbOrdinateDimension } from '../entity/dimension/AcDbOrdinateDimension'
import { AcDbRadialDimension } from '../entity/dimension/AcDbRadialDimension'
import { AcDbRotatedDimension } from '../entity/dimension/AcDbRotatedDimension'
import {
  acdbDrainDxfObjectPairs,
  AcDbDxfPairArrayReader,
  acdbTypedValueToDxfPair
} from './AcDbDxfPairArrayReader'

const DIMENSION_SUBCLASS_MARKERS = new Set([
  'AcDbAlignedDimension',
  'AcDbRotatedDimension',
  'AcDb3PointAngularDimension',
  'AcDb2LineAngularDimension',
  'AcDbOrdinateDimension',
  'AcDbRadialDimension',
  'AcDbDiametricDimension',
  'AcDbArcDimension'
])

/**
 * Drain one DIMENSION object's pairs (including XData) and create the matching
 * dimension subclass via group-100 markers (with group-70 type-bit fallback).
 *
 * Expects the filer just after `(0, DIMENSION)`.
 */
export function acdbDxfInDimension(filer: AcDbDxfFiler): AcDbEntity | null {
  const pairs = drainDimensionPairs(filer)
  const subclass = findDimensionSubclassMarker(pairs)
  const entity = createDimensionForSubclass(subclass, pairs)
  if (!entity) return null

  const replay = AcDbDxfFiler.forReading(new AcDbDxfPairArrayReader(pairs), {
    database: filer.database
  })
  entity.dxfIn(replay)
  return entity
}

function drainDimensionPairs(filer: AcDbDxfFiler): AcDbDxfPair[] {
  const pairs = acdbDrainDxfObjectPairs(filer)
  // Include trailing XData so {@link AcDbObject.dxfIn} can consume it on replay.
  while (!filer.atEndOfObject && !filer.atEof) {
    const item = filer.readItem()
    if (!item) break
    if (Number(item.code) === 0) {
      filer.pushBackItem(item)
      break
    }
    pairs.push(acdbTypedValueToDxfPair(item))
  }
  return pairs
}

function findDimensionSubclassMarker(pairs: readonly AcDbDxfPair[]): string {
  let marker = ''
  for (const pair of pairs) {
    if (pair.code === 100 && typeof pair.value === 'string') {
      if (DIMENSION_SUBCLASS_MARKERS.has(pair.value)) {
        marker = pair.value
      }
    }
  }
  if (marker) return marker

  // Fallback: Autodesk dimension type bits in group 70 (low 4 bits).
  // 0=rotated, 1=aligned, 2=angular 2-line, 3=diameter, 4=radius,
  // 5=angular 3-point, 6=ordinate, 8=arc.
  for (const pair of pairs) {
    if (pair.code === 70 && typeof pair.value === 'number') {
      const type = pair.value & 0x0f
      switch (type) {
        case 0:
          return 'AcDbRotatedDimension'
        case 1:
          return 'AcDbAlignedDimension'
        case 2:
          return 'AcDb2LineAngularDimension'
        case 3:
          return 'AcDbDiametricDimension'
        case 4:
          return 'AcDbRadialDimension'
        case 5:
          return 'AcDb3PointAngularDimension'
        case 6:
          return 'AcDbOrdinateDimension'
        case 8:
          return 'AcDbArcDimension'
        default:
          break
      }
    }
  }
  return 'AcDbAlignedDimension'
}

function createDimensionForSubclass(
  subclass: string,
  _pairs: readonly AcDbDxfPair[]
): AcDbDimension | null {
  const origin = new AcGePoint3d()
  switch (subclass) {
    case 'AcDbRotatedDimension':
      return new AcDbRotatedDimension(origin, origin, origin)
    case 'AcDbAlignedDimension':
      return new AcDbAlignedDimension(origin, origin, origin)
    case 'AcDb3PointAngularDimension':
    case 'AcDb2LineAngularDimension':
      return new AcDb3PointAngularDimension(origin, origin, origin, origin)
    case 'AcDbOrdinateDimension':
      return new AcDbOrdinateDimension(origin, origin)
    case 'AcDbRadialDimension':
      return new AcDbRadialDimension(origin, origin, 0)
    case 'AcDbDiametricDimension':
      return new AcDbDiametricDimension(origin, origin, 0)
    case 'AcDbArcDimension':
      return new AcDbArcDimension(origin, origin, origin, origin)
    default:
      return new AcDbAlignedDimension(origin, origin, origin)
  }
}
