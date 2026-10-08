/**
 * Batch-add common missing DXF group-code cases that only need a `break`
 * (already skipped) is NOT enough — we need actual handlers.
 *
 * This script does NOT add properties; it only reports what still needs work
 * after manual property additions. Kept as a checklist runner.
 */
import fs from 'node:fs'

const checklist = {
  CIRCLE: { file: 'src/entity/AcDbCircle.ts', need: [39] },
  ARC: { file: 'src/entity/AcDbArc.ts', need: [39] },
  POINT: { file: 'src/entity/AcDbPoint.ts', need: [39, 50, 210] },
  MTEXT: { file: 'src/entity/AcDbMText.ts', need: [101] },
  INSERT: { file: 'src/entity/AcDbBlockReference.ts', need: [44, 45, 70, 71] },
  LWPOLYLINE: { file: 'src/entity/AcDbPolyline.ts', need: [39, 91, 210] },
  SPLINE: { file: 'src/entity/AcDbSpline.ts', need: [42, 43, 44, 210] },
  SOLID: { file: 'src/entity/AcDbTrace.ts', need: [210] },
  IMAGE: { file: 'src/entity/AcDbRasterImage.ts', need: [90, 290] },
  VIEWPORT: {
    file: 'src/entity/AcDbViewport.ts',
    need: [13, 14, 15, 16, 42, 43, 44, 50, 68, 71, 72, 90, 110, 146, 331]
  }
}

for (const [name, { file, need }] of Object.entries(checklist)) {
  const src = fs.readFileSync(file, 'utf8')
  const missing = need.filter(c => !new RegExp(`case\\s+${c}\\s*:`).test(src))
  console.log(
    missing.length
      ? `${name}: still missing ${missing.join(', ')}`
      : `${name}: cases present`
  )
}
