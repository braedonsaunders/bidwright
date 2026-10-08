/**
 * Compare DXF group codes handled by native dxfInFields vs dxf-json parsers.
 */
import fs from 'node:fs'

function extractCases(src) {
  const cases = new Set()
  const re = /case\s+(\d+)\s*:/g
  let m
  while ((m = re.exec(src))) cases.add(Number(m[1]))
  return cases
}

function extractSnippetCodes(src) {
  const cases = new Set()
  const re = /code:\s*(?:\[([^\]]+)\]|(\d+))/g
  let m
  while ((m = re.exec(src))) {
    if (m[1]) {
      for (const part of m[1].split(',')) {
        const n = Number(part.trim())
        if (!Number.isNaN(n)) cases.add(n)
      }
    }
    if (m[2]) cases.add(Number(m[2]))
  }
  return cases
}

const pairs = [
  ['LINE', 'src/entity/AcDbLine.ts', 'd:/code/dxf-json/src/parser/entities/line/parser.ts'],
  ['CIRCLE', 'src/entity/AcDbCircle.ts', 'd:/code/dxf-json/src/parser/entities/circle/parser.ts'],
  ['ARC', 'src/entity/AcDbArc.ts', 'd:/code/dxf-json/src/parser/entities/arc/parser.ts'],
  ['POINT', 'src/entity/AcDbPoint.ts', 'd:/code/dxf-json/src/parser/entities/point/parser.ts'],
  ['ELLIPSE', 'src/entity/AcDbEllipse.ts', 'd:/code/dxf-json/src/parser/entities/ellipse/parser.ts'],
  ['TEXT', 'src/entity/AcDbText.ts', 'd:/code/dxf-json/src/parser/entities/text/parser.ts'],
  ['MTEXT', 'src/entity/AcDbMText.ts', 'd:/code/dxf-json/src/parser/entities/mtext/parser.ts'],
  ['INSERT', 'src/entity/AcDbBlockReference.ts', 'd:/code/dxf-json/src/parser/entities/insert/parser.ts'],
  ['LWPOLYLINE', 'src/entity/AcDbPolyline.ts', 'd:/code/dxf-json/src/parser/entities/lwpolyline/parser.ts'],
  ['SPLINE', 'src/entity/AcDbSpline.ts', 'd:/code/dxf-json/src/parser/entities/spline/parser.ts'],
  ['LEADER', 'src/entity/AcDbLeader.ts', 'd:/code/dxf-json/src/parser/entities/leader/parser.ts'],
  ['SOLID', 'src/entity/AcDbTrace.ts', 'd:/code/dxf-json/src/parser/entities/solid/parser.ts'],
  ['3DFACE', 'src/entity/AcDbFace.ts', 'd:/code/dxf-json/src/parser/entities/face/parser.ts'],
  ['RAY', 'src/entity/AcDbRay.ts', 'd:/code/dxf-json/src/parser/entities/ray/parser.ts'],
  ['XLINE', 'src/entity/AcDbXline.ts', 'd:/code/dxf-json/src/parser/entities/xline/parser.ts'],
  ['IMAGE', 'src/entity/AcDbRasterImage.ts', 'd:/code/dxf-json/src/parser/entities/image/parser.ts'],
  ['SHAPE', 'src/entity/AcDbShape.ts', 'd:/code/dxf-json/src/parser/entities/shape/parser.ts'],
  ['TOLERANCE', 'src/entity/AcDbFcf.ts', 'd:/code/dxf-json/src/parser/entities/tolerance/parser.ts'],
  ['MLINE', 'src/entity/AcDbMLine.ts', 'd:/code/dxf-json/src/parser/entities/mline/parser.ts'],
  ['ATTRIB', 'src/entity/AcDbAttribute.ts', 'd:/code/dxf-json/src/parser/entities/attribute/parser.ts'],
  ['ATTDEF', 'src/entity/AcDbAttributeDefinition.ts', 'd:/code/dxf-json/src/parser/entities/attdef/parser.ts'],
  ['VIEWPORT', 'src/entity/AcDbViewport.ts', 'd:/code/dxf-json/src/parser/entities/viewport/parser.ts'],
  ['DIMENSION', 'src/entity/dimension/AcDbDimension.ts', 'd:/code/dxf-json/src/parser/entities/dimension/parser.ts'],
  ['ALIGNED_DIM', 'src/entity/dimension/AcDbAlignedDimension.ts', 'd:/code/dxf-json/src/parser/entities/dimension/parser.ts'],
  ['OLE2FRAME', 'src/entity/AcDbOle2Frame.ts', 'd:/code/dxf-json/src/parser/entities/ole2frame/parser.ts'],
  ['PROXY', 'src/entity/AcDbProxyEntity.ts', 'd:/code/dxf-json/src/parser/entities/acadProxyEntity/parser.ts']
]

// Codes handled by AcDbEntity / AcDbObject common paths.
const common = new Set([
  5, 6, 8, 48, 60, 62, 67, 92, 100, 102, 105, 160, 284, 310, 330, 347, 360,
  370, 380, 390, 410, 420, 430, 440
])

for (const [name, ours, theirs] of pairs) {
  const a = extractCases(fs.readFileSync(ours, 'utf8'))
  const b = extractSnippetCodes(fs.readFileSync(theirs, 'utf8'))
  const missing = [...b].filter(c => !a.has(c) && !common.has(c)).sort((x, y) => x - y)
  const extra = [...a].filter(c => !b.has(c) && !common.has(c)).sort((x, y) => x - y)
  if (missing.length || extra.length) {
    console.log(`${name}:`)
    if (missing.length) console.log(`  missing vs dxf-json: ${missing.join(', ')}`)
    if (extra.length) console.log(`  only in native: ${extra.join(', ')}`)
  } else {
    console.log(`${name}: OK`)
  }
}
