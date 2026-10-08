/**
 * Full audit: native dxfInFields case codes vs dxf-json parsers.
 * Inheritance: child files inherit cases from listed parent files.
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const DXF_JSON = 'd:/code/dxf-json/src/parser'

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

function readCases(rel) {
  const full = path.join(ROOT, rel)
  if (!fs.existsSync(full)) return new Set()
  return extractCases(fs.readFileSync(full, 'utf8'))
}

function union(...sets) {
  const out = new Set()
  for (const s of sets) for (const v of s) out.add(v)
  return out
}

// Common entity/object group codes handled by AcDbEntity / AcDbObject.
// XData group codes (handled by AcDbObject xdata path, not per-entity cases).
const common = new Set([
  0, 5, 6, 8, 48, 60, 62, 67, 92, 100, 102, 105, 160, 284, 310, 330, 347, 360,
  370, 380, 390, 410, 420, 430, 440,
  1000, 1001, 1002, 1003, 1004, 1005, 1010, 1011, 1012, 1013, 1040, 1041, 1042,
  1070, 1071
])

const entity = 'src/entity/AcDbEntity.ts'
const object = 'src/base/AcDbObject.ts'
const text = 'src/entity/AcDbText.ts'
const dim = 'src/entity/dimension/AcDbDimension.ts'
const curve = 'src/entity/AcDbCurve.ts'
const blockRef = 'src/entity/AcDbBlockReference.ts'
const plotSettings = 'src/object/layout/AcDbPlotSettings.ts'
const index = 'src/object/AcDbIndex.ts'

const pairs = [
  // entities
  ['LINE', ['src/entity/AcDbLine.ts', entity], `${DXF_JSON}/entities/line/parser.ts`],
  ['CIRCLE', ['src/entity/AcDbCircle.ts', entity], `${DXF_JSON}/entities/circle/parser.ts`],
  ['ARC', ['src/entity/AcDbArc.ts', entity], `${DXF_JSON}/entities/arc/parser.ts`],
  ['POINT', ['src/entity/AcDbPoint.ts', entity], `${DXF_JSON}/entities/point/parser.ts`],
  ['ELLIPSE', ['src/entity/AcDbEllipse.ts', entity], `${DXF_JSON}/entities/ellipse/parser.ts`],
  ['TEXT', ['src/entity/AcDbText.ts', entity], `${DXF_JSON}/entities/text/parser.ts`],
  ['MTEXT', ['src/entity/AcDbMText.ts', entity], `${DXF_JSON}/entities/mtext/parser.ts`],
  ['INSERT', ['src/entity/AcDbBlockReference.ts', entity], `${DXF_JSON}/entities/insert/parser.ts`],
  ['LWPOLYLINE', ['src/entity/AcDbPolyline.ts', entity], `${DXF_JSON}/entities/lwpolyline/parser.ts`],
  ['SPLINE', ['src/entity/AcDbSpline.ts', entity], `${DXF_JSON}/entities/spline/parser.ts`],
  ['LEADER', ['src/entity/AcDbLeader.ts', entity], `${DXF_JSON}/entities/leader/parser.ts`],
  ['SOLID', ['src/entity/AcDbTrace.ts', entity], `${DXF_JSON}/entities/solid/parser.ts`],
  ['3DFACE', ['src/entity/AcDbFace.ts', entity], `${DXF_JSON}/entities/face/parser.ts`],
  ['RAY', ['src/entity/AcDbRay.ts', entity], `${DXF_JSON}/entities/ray/parser.ts`],
  ['XLINE', ['src/entity/AcDbXline.ts', entity], `${DXF_JSON}/entities/xline/parser.ts`],
  ['IMAGE', ['src/entity/AcDbRasterImage.ts', entity], `${DXF_JSON}/entities/image/parser.ts`],
  ['SHAPE', ['src/entity/AcDbShape.ts', entity], `${DXF_JSON}/entities/shape/parser.ts`],
  ['TOLERANCE', ['src/entity/AcDbFcf.ts', entity], `${DXF_JSON}/entities/tolerance/parser.ts`],
  ['MLINE', ['src/entity/AcDbMLine.ts', entity], `${DXF_JSON}/entities/mline/parser.ts`],
  ['HATCH', ['src/entity/AcDbHatch.ts', entity], `${DXF_JSON}/entities/hatch/parser.ts`],
  ['MLEADER', ['src/entity/AcDbMLeader.ts', entity], `${DXF_JSON}/entities/multileader/parser.ts`],
  ['ATTRIB', ['src/entity/AcDbAttribute.ts', text, entity], `${DXF_JSON}/entities/attribute/parser.ts`],
  ['ATTDEF', ['src/entity/AcDbAttributeDefinition.ts', text, entity], `${DXF_JSON}/entities/attdef/parser.ts`],
  ['VIEWPORT', ['src/entity/AcDbViewport.ts', entity], `${DXF_JSON}/entities/viewport/parser.ts`],
  ['DIMENSION', [dim, 'src/entity/dimension/AcDbAlignedDimension.ts', 'src/entity/dimension/AcDbRadialDimension.ts', 'src/entity/dimension/AcDbDiametricDimension.ts', 'src/entity/dimension/AcDbOrdinateDimension.ts', 'src/entity/dimension/AcDb3PointAngularDimension.ts', 'src/entity/dimension/AcDbArcDimension.ts', entity], `${DXF_JSON}/entities/dimension/parser.ts`],
  ['ALIGNED_DIM', ['src/entity/dimension/AcDbAlignedDimension.ts', dim, entity], `${DXF_JSON}/entities/dimension/parser.ts`],
  ['OLE2FRAME', ['src/entity/AcDbOle2Frame.ts', entity], `${DXF_JSON}/entities/ole2frame/parser.ts`],
  ['OLEFRAME', ['src/entity/AcDbOleFrame.ts', entity], `${DXF_JSON}/entities/oleframe/parser.ts`],
  ['PROXY', ['src/entity/AcDbProxyEntity.ts', entity], `${DXF_JSON}/entities/acadProxyEntity/parser.ts`],
  ['WIPEOUT', ['src/entity/AcDbRasterImage.ts', entity], `${DXF_JSON}/entities/wipeout/parser.ts`],
  ['MESH', null, `${DXF_JSON}/entities/mesh/parser.ts`],
  ['LIGHT', null, `${DXF_JSON}/entities/light/parser.ts`],
  ['SECTION', null, `${DXF_JSON}/entities/section/parser.ts`],
  ['SUN', null, `${DXF_JSON}/entities/sun/parser.ts`],
  ['BODY', ['src/entity/AcDb3dSolid.ts', entity], `${DXF_JSON}/entities/body/parser.ts`],
  ['3DSOLID', ['src/entity/AcDb3dSolid.ts', entity], `${DXF_JSON}/entities/solid3d/parser.ts`],
  ['REGION', ['src/entity/AcDb3dSolid.ts', entity], `${DXF_JSON}/entities/region/parser.ts`],
  ['ACAD_TABLE', ['src/entity/AcDbTable.ts', blockRef, entity], `${DXF_JSON}/entities/table/parser.ts`],
  // tables
  ['LAYER', ['src/database/AcDbLayerTableRecord.ts', object], `${DXF_JSON}/tables/layer/parser.ts`],
  ['LTYPE', ['src/database/AcDbLinetypeTableRecord.ts', object], `${DXF_JSON}/tables/ltype/parser.ts`],
  ['STYLE', ['src/database/AcDbTextStyleTableRecord.ts', object], `${DXF_JSON}/tables/style/parser.ts`],
  ['DIMSTYLE', ['src/database/AcDbDimStyleTableRecord.ts', object], `${DXF_JSON}/tables/dimStyle/parser.ts`],
  ['VPORT', ['src/database/AcDbViewportTableRecord.ts', object], `${DXF_JSON}/tables/vport/parser.ts`],
  ['VIEW', ['src/database/AcDbViewTableRecord.ts', object], `${DXF_JSON}/tables/view/parser.ts`],
  ['UCS', ['src/database/AcDbUcsTableRecord.ts', object], `${DXF_JSON}/tables/ucs/parser.ts`],
  ['APPID', ['src/database/AcDbRegAppTableRecord.ts', object], `${DXF_JSON}/tables/appId/parser.ts`],
  ['BLOCK_RECORD', ['src/database/AcDbBlockTableRecord.ts', object], `${DXF_JSON}/tables/blockRecord/parser.ts`],
  // objects
  ['DICTIONARY', ['src/object/AcDbDictionary.ts', object], `${DXF_JSON}/objects/dictionary/parser.ts`],
  ['LAYOUT', ['src/object/layout/AcDbLayout.ts', plotSettings, object], `${DXF_JSON}/objects/layout/parser.ts`],
  ['PLOTSETTINGS', [plotSettings, object], `${DXF_JSON}/objects/plotSettings/parser.ts`],
  ['IMAGEDEF', ['src/object/AcDbRasterImageDef.ts', object], `${DXF_JSON}/objects/imageDef/parser.ts`],
  ['MLINESTYLE', ['src/object/AcDbMlineStyle.ts', object], `${DXF_JSON}/objects/mlineStyle/parser.ts`],
  ['MLEADERSTYLE', ['src/object/AcDbMLeaderStyle.ts', object], `${DXF_JSON}/objects/mleaderStyle/parser.ts`],
  ['GROUP', ['src/object/AcDbGroup.ts', object], `${DXF_JSON}/objects/group/parser.ts`],
  ['XRECORD', ['src/object/AcDbXrecord.ts', object], `${DXF_JSON}/objects/xrecord/parser.ts`],
  ['SORTENTSTABLE', ['src/object/AcDbSortentsTable.ts', object], null],
  ['LAYER_FILTER', ['src/object/AcDbLayerFilter.ts', object], `${DXF_JSON}/objects/layer_filter/parser.ts`],
  ['LAYER_INDEX', ['src/object/AcDbLayerIndex.ts', index, object], `${DXF_JSON}/objects/layer_index/parser.ts`],
  ['SPATIAL_FILTER', ['src/object/AcDbFilter.ts', object], `${DXF_JSON}/objects/spatial_filter/parser.ts`]
]

const report = []
for (const [name, oursList, theirs] of pairs) {
  if (theirs == null || !fs.existsSync(theirs)) {
    report.push({ name, status: theirs == null ? 'no-dxf-json' : 'no-dxf-json', missing: [] })
    continue
  }
  const theirsCodes = extractSnippetCodes(fs.readFileSync(theirs, 'utf8'))
  if (!oursList) {
    report.push({
      name,
      status: 'unimplemented-native',
      missing: [...theirsCodes].filter(c => !common.has(c)).sort((a, b) => a - b)
    })
    continue
  }
  const ours = union(...oursList.map(readCases))
  const missing = [...theirsCodes]
    .filter(c => !ours.has(c) && !common.has(c))
    .sort((a, b) => a - b)
  report.push({
    name,
    status: missing.length ? 'gaps' : 'ok',
    missing
  })
}

for (const row of report) {
  if (row.status === 'ok') console.log(`${row.name}: OK`)
  else if (row.status === 'unimplemented-native')
    console.log(`${row.name}: NO NATIVE CLASS — dxf-json codes ${row.missing.join(', ') || '(common only)'}`)
  else if (row.status === 'no-dxf-json') console.log(`${row.name}: no dxf-json parser`)
  else console.log(`${row.name}: missing ${row.missing.join(', ')}`)
}

const gaps = report.filter(r => r.status === 'gaps' && r.missing.length)
console.log('\n--- SUMMARY ---')
console.log(`OK: ${report.filter(r => r.status === 'ok').length}`)
console.log(`Gaps: ${gaps.length}`)
console.log(`Unimplemented native: ${report.filter(r => r.status === 'unimplemented-native').length}`)
