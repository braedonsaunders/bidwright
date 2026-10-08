import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import {
  type IsoDocument,
  bom,
  cutCsv,
  weldCsv,
  validateIso,
  round,
  welds,
  csv,
  runResult,
  prepAt,
  formatLength
} from './model'
import { createDrawing, drawingSvg } from './drawing'
export function download(
  name: string,
  content: Blob | string,
  mime = 'text/plain'
): void {
  const blob =
    typeof content === 'string' ? new Blob([content], { type: mime }) : content
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name.replace(/[\\/:*?"<>|]/g, '-')
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
export async function exportPdf(doc: IsoDocument): Promise<Blob> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${doc.drawing} - ${doc.title}`)
  pdf.setCreator('BidWright')
  pdf.registerFontkit(fontkit)
  const fontResponse = await fetch(
    new URL('./fonts/NotoSans-Regular.ttf', import.meta.url)
  )
  if (!fontResponse.ok)
    throw new Error('PDF font could not load. Please retry.')
  const font = await pdf.embedFont(await fontResponse.arrayBuffer(), {
    subset: true
  })
  const spools = [...new Set(doc.runs.map(r => r.spool))]
  const pages = spools.length ? spools : ['']
  const views = doc.outputViews ?? ['iso']
  if (pages.length * views.length > 200)
    throw new Error(
      'This package exceeds 200 drawing sheets. Export a smaller set of spools.'
    )
  const pageSize: [number, number] = (
    {
      letter: [792, 612],
      tabloid: [1224, 792],
      a3: [1190.55, 841.89],
      a4: [841.89, 595.28]
    } as const
  )[doc.paper ?? 'tabloid'].slice() as [number, number]
  const issues = validateIso(doc)
  const title = (page: ReturnType<typeof pdf.addPage>, s: string) =>
    page.drawText(s, {
      x: 32,
      y: page.getHeight() - 35,
      size: 15,
      font,
      color: rgb(0.07, 0.13, 0.2)
    })
  for (const spool of pages)
    for (const view of views) {
      const d = createDrawing(doc, spool, view)
      const page = pdf.addPage(pageSize)
      const [width, height] = pageSize
      const scale = Math.min((width - 40) / d.width, (height - 40) / d.height),
        ox = (width - d.width * scale) / 2,
        oy = (height - d.height * scale) / 2
      for (const p of d.primitives) {
        if (p.type === 'line')
          page.drawLine({
            start: { x: ox + p.a[0] * scale, y: height - oy - p.a[1] * scale },
            end: { x: ox + p.b[0] * scale, y: height - oy - p.b[1] * scale },
            thickness: (p.layer === 'PIPE' ? 2 : 0.7) * scale,
            color: rgb(0.05, 0.1, 0.15)
          })
        else if (p.type === 'circle')
          page.drawCircle({
            x: ox + p.p[0] * scale,
            y: height - oy - p.p[1] * scale,
            size: p.r * scale,
            borderWidth: 0.8 * scale,
            borderColor: rgb(0.05, 0.1, 0.15)
          })
        else
          page.drawText(p.text, {
            x: ox + p.p[0] * scale,
            y: height - oy - p.p[1] * scale,
            size: p.size * scale,
            font,
            color: rgb(0.05, 0.1, 0.15)
          })
      }
      if (issues.length)
        page.drawText('DRAFT - FABRICATION DATA INCOMPLETE', {
          x: width / 2 - 145,
          y: height - 14,
          size: 11,
          font,
          color: rgb(0.8, 0.1, 0.1)
        })
    }
  function schedule(
    heading: string,
    headers: string[],
    rows: string[][],
    widths: number[]
  ) {
    let page = pdf.addPage([792, 612]),
      y = 537
    title(page, `${doc.drawing} - ${heading}`)
    const wrap = (s: string, width: number, size: number): string[] => {
      const lines: string[] = []
      for (const paragraph of s.split(/\r?\n/)) {
        let line = ''
        for (const char of paragraph) {
          if (line && font.widthOfTextAtSize(line + char, size) > width) {
            lines.push(line)
            line = ''
          }
          line += char
        }
        lines.push(line)
      }
      return lines
    }
    function header() {
      let x = 32
      headers.forEach((s, i) => {
        page.drawText(s, { x, y, size: 9, font })
        x += widths[i]
      })
      y -= 22
    }
    const nextPage = () => {
      page = pdf.addPage([792, 612])
      title(page, `${doc.drawing} - ${heading} (continued)`)
      y = 537
      header()
    }
    header()
    for (const row of rows) {
      const cells = row.map((s, i) => wrap(s, widths[i] - 8, 8))
      const count = Math.max(...cells.map(c => c.length))
      // Split exceptionally long imported descriptions across pages without running below the margin.
      for (let first = 0; first < count; ) {
        if (y < 50) nextPage()
        const available = Math.max(1, Math.floor((y - 38) / 12)),
          take = Math.min(available, count - first)
        let x = 32
        cells.forEach((lines, i) => {
          lines
            .slice(first, first + take)
            .forEach((line, j) =>
              page.drawText(line, { x, y: y - j * 12, size: 8, font })
            )
          x += widths[i]
        })
        y -= Math.max(20, take * 12 + 5)
        first += take
        if (first < count) nextPage()
      }
    }
  }
  schedule(
    'Material schedule',
    [
      'Item',
      'Description',
      'Spec / NPS',
      'Quantity',
      'Weight kg',
      'Area m2',
      'Spool / heat'
    ],
    bom(doc).map(r => [
      String(r.item),
      r.description,
      `${r.spec} / ${r.nps}"`,
      `${Number.isFinite(r.qty) ? round(r.qty, 3) : 'MISSING'} ${r.unit}`,
      r.weightKg == null ? 'MISSING' : String(round(r.weightKg)),
      r.areaM2 == null ? 'MISSING' : String(round(r.areaM2, 3)),
      `${r.spool} / ${r.heat}`
    ]),
    [30, 200, 95, 72, 72, 72, 187]
  )
  schedule(
    'Pipe cut schedule',
    [
      'Pipe / spool',
      'Line / heat',
      'NPS',
      'Overall',
      'Takeouts / gaps',
      'Cut length',
      'Start / end'
    ],
    doc.runs
      .filter(r => !r.connector)
      .map((r, index) => {
        const v = runResult(doc, r)
        return [
          String(index + 1) + ' / ' + r.spool,
          r.line + ' / ' + r.heat,
          String(r.nps),
          formatLength(v.overall, doc.units),
          v.takeouts
            .map(t => (Number.isFinite(t) ? String(round(t)) : 'MISSING'))
            .join(' + ') +
            ' mm / ' +
            v.gaps.join(' + ') +
            ' mm',
          formatLength(v.cut, doc.units),
          prepAt(r, 0) + ' / ' + prepAt(r, 1)
        ]
      }),
    [95, 125, 40, 95, 158, 115, 100]
  )
  schedule(
    'Weld map',
    ['Tag', 'Spool', 'Line', 'NPS', 'Location', 'Prep'],
    welds(doc).map(w => {
      const r = doc.runs.find(r => r.id === w.runId)!
      return [
        w.tag,
        r.spool,
        r.line,
        String(w.nps),
        w.field ? 'FIELD' : 'SHOP',
        w.prep
      ]
    }),
    [85, 125, 210, 65, 100, 85]
  )
  if (issues.length)
    schedule(
      'Data requiring completion',
      ['Issue'],
      issues.map(s => [s]),
      [720]
    )
  const total = pdf.getPageCount()
  pdf
    .getPages()
    .forEach((page, index) =>
      page.drawText(
        `${doc.drawing.slice(0, 60)} · Rev ${doc.revision.slice(0, 20)} · ${index + 1} / ${total}`,
        { x: 32, y: 10, size: 8, font, color: rgb(0.3, 0.35, 0.4) }
      )
    )
  return new Blob([new Uint8Array(await pdf.save())], {
    type: 'application/pdf'
  })
}
export function exportSvg(doc: IsoDocument, spool = ''): void {
  download(
    `${doc.drawing}-${spool || 'all'}.svg`,
    drawingSvg(createDrawing(doc, spool)),
    'image/svg+xml'
  )
}
export function exportSchedule(doc: IsoDocument, kind: 'cut' | 'weld'): void {
  if (kind === 'cut' && validateIso(doc).length)
    throw new Error('Resolve fabrication checks before exporting the cut list.')
  download(
    `${doc.drawing}-${kind}.csv`,
    kind === 'cut' ? cutCsv(doc) : weldCsv(doc),
    'text/csv'
  )
}
export function combinedBomCsv(docs: IsoDocument[]): string {
  const grouped = new Map<
    string,
    { row: ReturnType<typeof bom>[number]; drawings: Set<string> }
  >()
  for (const doc of docs)
    for (const row of bom(doc, 'global')) {
      const spec = doc.specs.find(s => s.id === row.spec)!
      const key = JSON.stringify([
        row.materialKey ?? '',
        row.description,
        row.spec,
        spec.material,
        spec.schedule,
        spec.rating,
        row.nps,
        row.unit,
        row.heat
      ])
      const existing = grouped.get(key)
      if (existing) {
        const r = existing.row
        r.qty += row.qty
        r.cost += row.cost
        r.hours += row.hours
        r.weightKg =
          r.weightKg == null || row.weightKg == null
            ? null
            : r.weightKg + row.weightKg
        r.areaM2 =
          r.areaM2 == null || row.areaM2 == null ? null : r.areaM2 + row.areaM2
        existing.drawings.add(doc.drawing)
      } else
        grouped.set(key, { row: { ...row }, drawings: new Set([doc.drawing]) })
    }
  const rows = [...grouped.values()].map(({ row: r, drawings }) => [
    [...drawings].join('; '),
    r.description,
    r.spec,
    r.nps,
    Number.isFinite(r.qty) ? round(r.qty, 3) : 'MISSING',
    r.unit,
    r.weightKg == null ? 'MISSING' : round(r.weightKg),
    r.areaM2 == null ? 'MISSING' : round(r.areaM2, 3),
    round(r.cost),
    round(r.hours),
    r.heat
  ])
  return csv([
    [
      'Drawings',
      'Description',
      'Spec',
      'NPS',
      'Quantity',
      'Unit',
      'Weight kg',
      'Area m2',
      'Cost',
      'Labor hours',
      'Heat'
    ],
    ...rows
  ])
}
