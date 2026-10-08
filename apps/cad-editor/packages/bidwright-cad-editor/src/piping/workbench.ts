import { AcApDocManager } from '@mlightcad/cad-simple-viewer'
import {
  newIso,
  type IsoDocument,
  type Kind,
  type Vec3,
  appendRun,
  insertComponent,
  attachComponent,
  parseLength,
  parseIsoJson,
  getNode,
  getSpec,
  connected,
  fitting,
  runResult,
  validateIso,
  bom,
  bomCsv,
  welds,
  formatLength,
  clone,
  round,
  id,
  prepAt,
  type EndPrep,
  takeout
} from './model'
import { defaultGrid, pickGridPoint, type GridPlane } from './grid'
import { createDrawing, drawingSvg, escape as e } from './drawing'
import { readPiping, writePiping } from './database'
import { importPcf, exportPcf } from './pcf'
import {
  download,
  exportPdf,
  exportSvg,
  exportSchedule,
  combinedBomCsv
} from './export'
import { exportDwg } from './dwg'
import { mountPreview3d } from './preview3d'
const kinds: Kind[] = [
  'end',
  'elbow90',
  'elbow45',
  'tee',
  'flange',
  'valve',
  'reducer',
  'cap',
  'support',
  'weld',
  'olet',
  'gasket',
  'bolt'
]
const label = (s: string) =>
  s.replace(/([a-z])(\d)/g, '$1 $2').replace(/^./, c => c.toUpperCase())
export class PipingWorkbench {
  private pickRoute = false
  private doc: IsoDocument = newIso()
  private selected = ''
  private start = ''
  private spec = 'CS40'
  private nps = 2
  private spool = 'SP-001'
  private line = ''
  private tab = 'draw'
  private view: 'iso' | 'plan' | 'front' | 'side' = 'iso'
  private filter = ''
  private loaded = false
  private writing = false
  private visible = false
  private warning = ''
  private dispose3d: (() => void) | undefined
  private removeDbListeners: Array<() => void> = []
  private readonly activated = () => this.activate()
  private readonly click = (event: Event) => {
    void this.handleClick(event).catch(error => this.showError(error))
  }
  private readonly pointer = (event: Event) =>
    this.previewPick(event as MouseEvent)
  private readonly change = (event: Event) => {
    try {
      this.handleChange(event)
    } catch (error) {
      this.showError(error)
    }
  }
  constructor(
    private readonly root: HTMLElement,
    private readonly save: () => void
  ) {
    root.className = 'bw-piping'
    root.hidden = true
    root.addEventListener('click', this.click)
    root.addEventListener('change', this.change)
    root.addEventListener('mousemove', this.pointer)
    AcApDocManager.instance.events.documentActivated.addEventListener(
      this.activated
    )
    this.render()
  }
  dispose() {
    this.dispose3d?.()
    this.removeDbListeners.forEach(f => f())
    AcApDocManager.instance.events.documentActivated.removeEventListener(
      this.activated
    )
    this.root.removeEventListener('click', this.click)
    this.root.removeEventListener('change', this.change)
    this.root.removeEventListener('mousemove', this.pointer)
  }
  setVisible(value: boolean) {
    this.visible = value
    this.root.hidden = !value
    if (value) this.render()
    else {
      this.dispose3d?.()
      this.dispose3d = undefined
    }
  }
  private activate() {
    this.loaded = true
    this.removeDbListeners.forEach(f => f())
    this.removeDbListeners = []
    try {
      this.doc =
        readPiping(AcApDocManager.instance.curDocument.database) ?? newIso()
      this.spec = this.doc.specs[0].id
      this.nps = this.doc.specs[0].sizes[0]?.nps ?? 2
      this.start = this.doc.nodes.at(-1)?.id ?? ''
      this.selected = ''
      this.warning = ''
    } catch (error) {
      this.loaded = false
      this.showError(error)
      return
    }
    const events = AcApDocManager.instance.curDocument.database.events
    const changed = () => {
      if (this.writing) return
      queueMicrotask(() => {
        try {
          const latest =
            readPiping(AcApDocManager.instance.curDocument.database) ?? newIso()
          if (JSON.stringify(latest) !== JSON.stringify(this.doc)) {
            this.doc = latest
            if (!this.doc.nodes.some(n => n.id === this.start))
              this.start = this.doc.nodes.at(-1)?.id ?? ''
            this.render()
          }
        } catch (error) {
          this.showError(error)
        }
      })
    }
    for (const event of [events.dictObjetSet, events.dictObjectErased]) {
      event.addEventListener(changed)
      this.removeDbListeners.push(() => event.removeEventListener(changed))
    }
    this.render()
  }
  private commit(edit: (d: IsoDocument) => void) {
    if (!this.loaded) throw new Error('Wait for the drawing to finish opening.')
    const next = clone(this.doc)
    edit(next)
    parseIsoJson(JSON.stringify(next))
    this.writing = true
    try {
      writePiping(next)
      this.doc = next
    } finally {
      this.writing = false
    }
    this.render()
  }
  private showError(error: unknown) {
    this.warning = error instanceof Error ? error.message : String(error)
    const area = this.root.querySelector('[data-notice]')
    if (area) {
      area.textContent = this.warning
      area.classList.add('error')
    } else this.render()
  }
  private field(name: string, fallback = ''): string {
    return (
      (
        this.root.querySelector(`[name="${name}"]`) as
          | HTMLInputElement
          | HTMLSelectElement
          | null
      )?.value ?? fallback
    )
  }
  private number(name: string, minimum = 0): number {
    const value = Number(this.field(name))
    if (!Number.isFinite(value) || value < minimum)
      throw new Error(`${name}: enter a number of at least ${minimum}.`)
    return value
  }
  private option(value: string, text: string, selected: string) {
    return `<option value="${e(value)}" ${value === selected ? 'selected' : ''}>${e(text)}</option>`
  }
  private input(name: string, value: unknown, type = 'text') {
    return `<input name="${e(name)}" type="${type}" value="${e(value ?? '')}" ${type === 'number' ? 'step="any"' : ''}/>`
  }
  private nodeName(nodeId: string) {
    const n = this.doc.nodes.find(n => n.id === nodeId)
    return n
      ? `${this.doc.nodes.indexOf(n) + 1} · ${label(n.kind)} (${n.position.map(v => round(v, 1)).join(', ')})`
      : 'Origin'
  }
  private toolbar() {
    return `<header class="bw-iso-bar"><div><b>Piping isometrics</b><span>Measured geometry · fabrication schedules</span></div><button data-action="save">Save</button><button data-action="undo">Undo</button><button data-action="redo">Redo</button><button data-action="import">Import PCF / piping file</button><button data-action="pdf">PDF package</button><button data-action="svg">SVG</button><button data-action="dxf">DXF</button><button data-action="dwg">DWG</button><button data-action="json">Piping file</button><input hidden data-import type="file" accept=".pcf,.json"/><input hidden data-global type="file" accept=".json" multiple/></header>
      <nav class="bw-iso-tabs">${[
        ['draw', 'Draw'],
        ['materials', 'Materials & cuts'],
        ['welds', 'Weld map'],
        ['specs', 'Specifications'],
        ['sheet', 'Drawing setup'],
        ['3d', '3D review']
      ]
        .map(
          ([key, text]) =>
            `<button data-tab="${key}" class="${this.tab === key ? 'active' : ''}">${text}</button>`
        )
        .join(
          ''
        )}<label>Spool <select name="filter">${this.option('', 'All spools', this.filter)}${[...new Set(this.doc.runs.map(r => r.spool))].map(s => this.option(s, s, this.filter)).join('')}</select></label></nav><div data-notice class="bw-iso-notice ${this.warning ? 'error' : ''}" role="status">${e(this.warning || (!this.loaded ? 'Opening drawing…' : this.doc.runs.length ? 'Click a connection to continue, or a pipe to inspect it.' : 'Choose a direction and measured length to start your isometric.'))}</div>`
  }
  private get grid() {
    return this.doc.grid ?? defaultGrid()
  }
  private get anchor(): Vec3 {
    return this.doc.nodes.find(n => n.id === this.start)?.position ?? [0, 0, 0]
  }
  private sidebar() {
    const spec = getSpec(this.doc, this.spec)
    const node = this.doc.nodes.find(n => n.id === this.selected),
      run = this.doc.runs.find(r => r.id === this.selected)
    return `<aside class="bw-iso-sidebar"><section><h3>Route pipe</h3><label>Continue from<select name="start">${this.option('', 'New origin', this.start)}${this.doc.nodes.map(n => this.option(n.id, this.nodeName(n.id), this.start)).join('')}</select></label>
      <label>Specification<select name="spec">${this.doc.specs.map(s => this.option(s.id, s.name, this.spec)).join('')}</select></label><label>Nominal size<select name="nps">${spec.sizes.map(s => this.option(String(s.nps), `${s.nps}" NPS · ${s.od} mm OD`, String(this.nps))).join('')}</select></label>
      <div class="bw-iso-pair"><label>Spool${this.input('spool', this.spool)}</label><label>Line${this.input('line', this.line)}</label></div><label>Measured length (${this.doc.units === 'mm' ? 'mm' : 'inches or feet/inches'})${this.input('length', this.doc.units === 'mm' ? '1000' : '48')}</label>
      <div class="bw-iso-directions">${[
        ['x+', 'East ↗'],
        ['y+', 'North ↖'],
        ['z+', 'Up ↑'],
        ['x-', 'West ↙'],
        ['y-', 'South ↘'],
        ['z-', 'Down ↓']
      ]
        .map(
          ([key, text]) =>
            `<button data-direction="${key}" ${!this.loaded ? 'disabled' : ''}>${text}</button>`
        )
        .join('')}</div>
      <details><summary>Rolling offset / measured coordinates</summary><p>Enter the three signed offsets in millimetres. The travel length is calculated in 3D.</p><div class="bw-iso-triple">${['dx', 'dy', 'dz'].map(name => `<label>${name.toUpperCase()}${this.input(name, 0, 'number')}</label>`).join('')}</div><button data-action="offset">Add offset pipe</button></details>
    </section><section><h3>${node ? 'Connection' : run ? 'Pipe properties' : 'Selection'}</h3>${node ? this.nodeProperties(node.id) : run ? this.runProperties(run.id) : '<p>Select a pipe or connection in the drawing.</p>'}</section><section><h3>Isometric grid</h3><label><input name="gridVisible" type="checkbox" ${this.grid.visible ? 'checked' : ''}/> Show grid</label><label><input name="gridSnap" type="checkbox" ${this.grid.snap ? 'checked' : ''}/> Snap picked points</label><label>Grid spacing (mm)${this.input('gridSpacing', this.grid.spacing, 'number')}</label><label>Routing plane<select name="gridPlane">${[
      ['xy', 'Horizontal · X/Y'],
      ['xz', 'Vertical · X/Z'],
      ['yz', 'Vertical · Y/Z']
    ]
      .map(([v, t]) => this.option(v, t, this.grid.plane))
      .join(
        ''
      )}</select></label><button data-action="pick-route" aria-pressed="${this.pickRoute}" class="${this.pickRoute ? 'active' : ''}">${this.pickRoute ? 'Finish picking' : 'Pick route on grid'}</button><p>Pick endpoints on the active plane. The third coordinate stays at the starting connection. Entered measurements stay exact. Grid is hidden in customer exports.</p></section><section><h3>Drawing view</h3><div class="bw-iso-directions">${['iso', 'plan', 'front', 'side'].map(v => `<button data-view="${v}" class="${this.view === v ? 'active' : ''}">${label(v)}</button>`).join('')}</div><p>Root gap: ${spec.rootGap} mm. Generated CAD layers stay locked; piping controls update the dimensions and schedules together.</p></section></aside>`
  }
  private nodeProperties(nodeId: string) {
    const n = getNode(this.doc, nodeId),
      edges = connected(this.doc, n.id),
      cat = fitting(this.doc, n),
      nps = edges[0]?.nps ?? this.nps,
      spec = edges[0]
        ? getSpec(this.doc, edges[0].specId)
        : getSpec(this.doc, this.spec)
    return `<b>${e(this.nodeName(nodeId))}</b><label>Component<select name="nodeKind">${kinds.map(k => this.option(k, label(k), n.kind)).join('')}</select></label><label>Catalogue item<select name="catalog">${this.option('', 'Custom / measured', n.catalogId ?? '')}${spec.fittings
      .filter(f => f.kind === n.kind && f.nps === nps)
      .map(f => this.option(f.id, f.description, n.catalogId ?? ''))
      .join('')}</select></label>
      <label>Description${this.input('nodeDescription', n.description ?? cat?.description ?? '')}</label><label>Centre-to-end takeout (mm)${this.input('takeout', n.takeout ?? cat?.takeout, 'number')}</label>${n.kind === 'tee' ? `<label>Branch pipe<select name="branch">${this.option('', 'Choose branch', n.branchEdgeId ?? '')}${edges.map(r => this.option(r.id, `${r.nps}" → ${this.nodeName(r.from === n.id ? r.to : r.from)}`, n.branchEdgeId ?? '')).join('')}</select></label><label>Branch takeout (mm)${this.input('branchTakeout', n.branchTakeout ?? cat?.branchTakeout, 'number')}</label>` : ''}
      ${n.portTakeouts ? `<details><summary>Measured port takeouts</summary><p>Imported dimensions are held per connection. These values govern each pipe cut.</p>${edges.map((r, i) => `<label>Port ${i + 1} — NPS ${r.nps}${this.input('portTakeout' + i, takeout(this.doc, n, r.id), 'number')}</label>`).join('')}</details>` : ''}
      <details><summary>Weight, finish & traceability</summary><label>Weight (kg)${this.input('weight', n.weightKg ?? cat?.weightKg, 'number')}</label><label>Surface area (m²)${this.input('area', n.areaM2 ?? cat?.areaM2, 'number')}</label><label>Unit cost${this.input('cost', n.unitCost ?? cat?.unitCost ?? 0, 'number')}</label><label>Labor hours${this.input('labor', n.laborHours ?? cat?.laborHours ?? 0, 'number')}</label><label>Heat number${this.input('nodeHeat', n.heat)}</label><label>Quantity${this.input('nodeQty', n.quantity ?? 1, 'number')}</label></details>
      <label><input name="field" type="checkbox" ${n.field ? 'checked' : ''}/> Field weld / erection</label><button data-action="apply-node">Apply component</button><details><summary>Move / label position</summary><div class="bw-iso-triple">${n.position.map((v, i) => `<label>${['X', 'Y', 'Z'][i]} mm${this.input(`node${i}`, v, 'number')}</label>`).join('')}</div><button data-action="move-node">Update coordinates</button><div class="bw-iso-pair"><label>Balloon X${this.input('labelX', n.labelOffset?.[0] ?? 24, 'number')}</label><label>Balloon Y${this.input('labelY', n.labelOffset?.[1] ?? -24, 'number')}</label></div><button data-action="label-node">Move balloon</button></details><button data-action="remove" class="danger">Delete connection and attached pipes</button>`
  }
  private runProperties(runId: string) {
    const r = this.doc.runs.find(r => r.id === runId)!,
      value = runResult(this.doc, r)
    return `<dl><dt>Overall</dt><dd>${e(formatLength(value.overall, this.doc.units))}</dd><dt>Pipe cut</dt><dd>${e(formatLength(value.cut, this.doc.units))}</dd><dt>Takeouts</dt><dd>${value.takeouts.map(v => (Number.isFinite(v) ? round(v) + ' mm' : 'MISSING')).join(' + ')}</dd><dt>Root gaps</dt><dd>${value.gaps.join(' + ')} mm</dd></dl><label>Spool${this.input('runSpool', r.spool)}</label><label>Line${this.input('runLine', r.line)}</label><label>Heat number${this.input('runHeat', r.heat)}</label><label>NPS${this.input('runNps', r.nps, 'number')}</label><label>Spec<select name="runSpec">${this.doc.specs.map(s => this.option(s.id, s.name, r.specId)).join('')}</select></label>${(['from', 'to'] as const).map((end, i) => `<details><summary>${i === 0 ? 'Start' : 'End'} connection</summary><label>Preparation<select name="${end}Prep">${['BW', 'SW', 'THD', 'PLAIN'].map(s => this.option(s, s, prepAt(r, i))).join('')}</select></label><label>Weld tag (blank = automatic)${this.input(end + 'Tag', r[`${end}Tag`])}</label><label><input name="${end}Field" type="checkbox" ${(r[`${end}Field`] ?? getNode(this.doc, i === 0 ? r.from : r.to).field) ? 'checked' : ''}/> Field weld</label></details>`).join('')}<label>Root gap override (mm, blank = spec)${this.input('runGap', r.rootGap, 'number')}</label><button data-action="apply-run">Apply pipe</button><label>Insert component<select name="insertKind">${['valve', 'flange', 'reducer', 'support', 'weld', 'bolt', 'gasket'].map(k => this.option(k, label(k), 'valve')).join('')}</select></label><label>Position along pipe (%)${this.input('fraction', 50, 'number')}</label><button data-action="insert">Insert component</button><button data-action="remove" class="danger">Delete pipe</button>`
  }
  private materialTab() {
    const rows = bom(this.doc).filter(
        r => !this.filter || r.spool === this.filter
      ),
      cuts = this.doc.runs
        .filter(r => !r.connector && (!this.filter || r.spool === this.filter))
        .map(r => runResult(this.doc, r))
    const issues = validateIso(this.doc)
    const missing = rows.filter(
      r => r.weightKg == null || r.areaM2 == null
    ).length
    return `<div class="bw-iso-content"><div class="bw-iso-summary"><b>${this.doc.runs.length} pipes · ${this.doc.nodes.filter(n => n.kind !== 'end').length} components</b><span>${round(rows.reduce((s, r) => s + (r.weightKg ?? 0), 0))} kg known · ${round(
      rows.reduce((s, r) => s + (r.areaM2 ?? 0), 0),
      3
    )} m² known</span><span>Configured material cost ${round(rows.reduce((s, r) => s + r.cost, 0))} · Configured labor ${round(
      rows.reduce((s, r) => s + r.hours, 0),
      2
    )} h</span></div>${missing ? `<p class="bw-iso-warning">${missing} material rows need weight or surface data for a complete spool total.</p>` : ''}<div class="bw-iso-actions"><button data-action="bom">Material CSV</button><button data-action="cuts" ${issues.length ? 'disabled' : ''}>Cut list CSV</button><button data-action="global">BOM across piping files</button><button data-action="pcf">PCF export</button></div><h3>Fabrication checks</h3>${issues.length ? `<ul class="bw-iso-warning">${issues.map(s => `<li>${e(s)}</li>`).join('')}</ul>` : '<p class="bw-iso-pass">All pipe lengths and component connections are valid.</p>'}<h3>Bill of materials</h3><table><thead><tr>${['Item', 'Description', 'Spec', 'NPS', 'Quantity', 'Weight kg', 'Surface m²', 'Spool', 'Heat'].map(s => `<th>${s}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${[r.item, r.description, r.spec, r.nps, `${Number.isFinite(r.qty) ? round(r.qty, 3) : 'MISSING'} ${r.unit}`, r.weightKg == null ? 'MISSING' : round(r.weightKg), r.areaM2 == null ? 'MISSING' : round(r.areaM2, 3), r.spool, r.heat].map(s => `<td>${e(s)}</td>`).join('')}</tr>`).join('')}</tbody></table><h3>Pipe cut schedule</h3><table><thead><tr>${['Pipe', 'Spool', 'NPS', 'Overall', 'Takeouts mm', 'Gaps mm', 'Cut length', 'Heat'].map(s => `<th>${s}</th>`).join('')}</tr></thead><tbody>${cuts.map((c, i) => `<tr data-owner="${e(c.run.id)}">${[i + 1, c.run.spool, c.run.nps, formatLength(c.overall, this.doc.units), c.takeouts.map(v => (Number.isFinite(v) ? round(v) : 'MISSING')).join(' + '), c.gaps.join(' + '), formatLength(c.cut, this.doc.units), c.run.heat].map(s => `<td>${e(s)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
  }
  private weldTab() {
    const ws = welds(this.doc).filter(
      w =>
        !this.filter ||
        this.doc.runs.find(r => r.id === w.runId)?.spool === this.filter
    )
    return `<div class="bw-iso-content"><div class="bw-iso-summary"><b>${ws.length} welds · ${round(ws.reduce((s, w) => s + w.nps, 0))} diameter-inches</b><span>${ws.filter(w => w.field).length} field · ${ws.filter(w => !w.field).length} shop</span><span>Welding labor ${round(ws.reduce((s, w) => s + w.nps * getSpec(this.doc, this.doc.runs.find(r => r.id === w.runId)!.specId).weldHoursPerDiameterInch, 0))} h</span></div><div class="bw-iso-pair"><label>Tag prefix${this.input('weldPrefix', this.doc.weldPrefix)}</label><label>Start number${this.input('weldStart', this.doc.weldStart, 'number')}</label></div><label>Numbering<select name="weldNumbering">${this.option('numeric', 'Numbers (1, 2, 3)', this.doc.weldNumbering ?? 'numeric')}${this.option('alphabetic', 'Letters (A, B, C)', this.doc.weldNumbering ?? 'numeric')}</select></label><button data-action="weld-settings">Apply numbering</button><button data-action="weld-csv">Weld list CSV</button><table><thead><tr><th>Tag</th><th>NPS</th><th>Spool</th><th>Line</th><th>Location</th><th>Preparation</th></tr></thead><tbody>${ws
      .map(w => {
        const r = this.doc.runs.find(r => r.id === w.runId)!
        return `<tr data-node="${e(w.nodeId)}">${[w.tag, w.nps, r.spool, r.line, w.field ? 'FIELD' : 'SHOP', w.prep].map(s => `<td>${e(s)}</td>`).join('')}</tr>`
      })
      .join('')}</tbody></table></div>`
  }
  private specTab() {
    const s = getSpec(this.doc, this.spec)
    return `<div class="bw-iso-content bw-iso-settings"><h3>Project specifications</h3><label>Active specification<select name="spec">${this.doc.specs.map(s => this.option(s.id, s.name, this.spec)).join('')}</select></label><div class="bw-iso-actions"><button data-action="new-spec">Duplicate specification</button><button data-action="spec-export">Export specification</button><button data-action="spec-import">Import specification</button><input hidden data-spec-import type="file" accept=".json"/></div><div class="bw-iso-grid">${[
      ['specName', 'Name', s.name],
      ['material', 'Material', s.material],
      ['schedule', 'Schedule', s.schedule],
      ['rating', 'Pressure class / rating', s.rating]
    ]
      .map(
        ([name, title, value]) =>
          `<label>${title}${this.input(name, value)}</label>`
      )
      .join('')}${[
      ['rootGap', 'Weld root gap (mm)', s.rootGap],
      ['density', 'Density (kg/m³)', s.density],
      ['pipeCost', 'Pipe cost per metre', s.pipeCostM],
      ['pipeLabor', 'Pipe labor hours per metre', s.pipeLaborHoursM],
      ['weldLabor', 'Weld hours per diameter-inch', s.weldHoursPerDiameterInch]
    ]
      .map(
        ([name, title, value]) =>
          `<label>${title}${this.input(String(name), value, 'number')}</label>`
      )
      .join(
        ''
      )}</div><button data-action="apply-spec">Apply specification</button>
      <h3>Pipe size library</h3><table><thead><tr><th>NPS</th><th>OD mm</th><th>Wall mm</th><th>kg/m</th></tr></thead><tbody>${s.sizes.map(z => `<tr>${[z.nps, z.od, z.wall, round(z.kgM, 3)].map(v => `<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table><details><summary>Add or replace pipe size</summary><div class="bw-iso-grid">${[
        ['sizeNps', 'NPS'],
        ['sizeOd', 'Outside diameter mm'],
        ['sizeWall', 'Wall mm'],
        ['sizeWeight', 'Weight kg/m']
      ]
        .map(
          ([name, title]) =>
            `<label>${title}${this.input(name, '', 'number')}</label>`
        )
        .join(
          ''
        )}</div><button data-action="size-add">Save pipe size</button></details>
      <h3>Fitting library</h3><p>Catalogue facts and shop-measured takeouts are editable. For valves and reducers, enter half the face-to-face dimension as the centre-to-end takeout.</p><table><thead><tr><th>Component</th><th>NPS</th><th>Description</th><th>Takeout mm</th><th>Source</th></tr></thead><tbody>${s.fittings.map(f => `<tr>${[f.kind, f.nps, f.description, f.takeout, f.source].map(v => `<td>${e(v)}</td>`).join('')}</tr>`).join('')}</tbody></table><details><summary>Add catalogue fitting</summary><div class="bw-iso-grid"><label>Component<select name="fitKind">${kinds
        .filter(k => k !== 'end')
        .map(k => this.option(k, label(k), 'valve'))
        .join('')}</select></label>${[
        ['fitNps', 'NPS', 'number'],
        ['fitDescription', 'Description', 'text'],
        ['fitTakeout', 'Centre-to-end mm', 'number'],
        ['fitBranch', 'Branch centre-to-end mm', 'number'],
        ['fitWeight', 'Weight kg', 'number'],
        ['fitArea', 'Surface m²', 'number'],
        ['fitCost', 'Unit cost', 'number'],
        ['fitLabor', 'Labor hours', 'number'],
        ['fitSource', 'Dimension source / manufacturer', 'text']
      ]
        .map(
          ([name, title, type]) =>
            `<label>${title}${this.input(name, '', type)}</label>`
        )
        .join(
          ''
        )}</div><button data-action="fitting-add">Add fitting</button></details></div>`
  }
  private sheetTab() {
    return `<div class="bw-iso-content bw-iso-settings"><h3>Customer drawing</h3><div class="bw-iso-grid">${[
      ['title', 'Title'],
      ['drawing', 'Drawing number'],
      ['revision', 'Revision'],
      ['customer', 'Customer'],
      ['project', 'Project'],
      ['drawnBy', 'Drawn by'],
      ['checkedBy', 'Checked by']
    ]
      .map(
        ([name, title]) =>
          `<label>${title}${this.input(name, this.doc[name as keyof IsoDocument])}</label>`
      )
      .join(
        ''
      )}<label>Dimensions<select name="units">${this.option('mm', 'Millimetres', this.doc.units)}${this.option('imperial', 'Feet & fractional inches', this.doc.units)}</select></label><label>Dimension labels<select name="dimensionMode">${['overall', 'cut', 'both'].map(v => this.option(v, label(v), this.doc.dimensionMode)).join('')}</select></label><label>PDF paper<select name="paper">${this.option('tabloid', '11 × 17 in', this.doc.paper ?? 'tabloid')}${this.option('letter', 'Letter', this.doc.paper ?? 'tabloid')}${this.option('a3', 'A3', this.doc.paper ?? 'tabloid')}${this.option('a4', 'A4', this.doc.paper ?? 'tabloid')}</select></label><label>Isometric rotation (degrees)${this.input('north', this.doc.north, 'number')}</label></div><div class="bw-iso-actions">${(['iso', 'plan', 'front', 'side'] as const).map(v => `<label><input type="checkbox" name="output-${v}" ${(this.doc.outputViews ?? ['iso']).includes(v) ? 'checked' : ''}/> ${label(v)} in PDF</label>`).join('')}</div><label>Drawing notes<textarea name="notes" rows="6">${e(this.doc.notes)}</textarea></label><button data-action="apply-sheet">Apply drawing setup</button><p>The PDF package includes one isometric per spool, a complete material schedule, pipe cut schedule and weld list. Incomplete fabrication data marks the drawing DRAFT.</p></div>`
  }
  private render() {
    this.dispose3d?.()
    this.dispose3d = undefined
    if (!this.doc.specs.some(s => s.id === this.spec))
      this.spec = this.doc.specs[0].id
    this.root.innerHTML =
      this.toolbar() +
      `<main class="bw-iso-main">${this.tab === 'draw' ? this.sidebar() + `<div class="bw-iso-canvas ${this.pickRoute ? 'picking' : ''}">${drawingSvg(createDrawing(this.doc, this.filter, this.view), this.selected, true, { settings: this.grid, anchor: this.anchor })}</div>` : this.tab === 'materials' ? this.materialTab() : this.tab === 'welds' ? this.weldTab() : this.tab === 'specs' ? this.specTab() : this.tab === 'sheet' ? this.sheetTab() : '<div class="bw-iso-3d" data-3d></div><div class="bw-iso-3d-note">Drag to orbit · scroll to zoom · centreline and pipe-envelope review</div>'}</main>`
    const file = this.root.querySelector('[data-import]') as HTMLInputElement
    file.addEventListener('change', () => {
      void this.importFiles(file).catch(error => this.showError(error))
    })
    const global = this.root.querySelector('[data-global]') as HTMLInputElement
    global.addEventListener('change', () => {
      void this.globalFiles(global).catch(error => this.showError(error))
    })
    const specFile = this.root.querySelector(
      '[data-spec-import]'
    ) as HTMLInputElement | null
    specFile?.addEventListener('change', () => {
      void this.importSpec(specFile).catch(error => this.showError(error))
    })
    if (this.visible && this.tab === '3d')
      try {
        this.dispose3d = mountPreview3d(
          this.root.querySelector('[data-3d]')!,
          this.doc,
          this.filter
        )
      } catch (error) {
        this.showError(error)
      }
  }
  private handleChange(event: Event) {
    const target = event.target as HTMLInputElement
    switch (target.name) {
      case 'gridVisible':
      case 'gridSnap':
      case 'gridSpacing':
      case 'gridPlane': {
        const grid = { ...this.grid }
        if (target.name === 'gridVisible') grid.visible = target.checked
        if (target.name === 'gridSnap') grid.snap = target.checked
        if (target.name === 'gridSpacing')
          grid.spacing = this.number('gridSpacing', 0.001)
        if (target.name === 'gridPlane') grid.plane = target.value as GridPlane
        this.commit(d => (d.grid = grid))
        break
      }
      case 'start':
        this.start = target.value
        this.render()
        break
      case 'spec':
        this.spec = target.value
        this.nps = getSpec(this.doc, this.spec).sizes[0]?.nps ?? 1
        this.render()
        break
      case 'nps':
        this.nps = Number(target.value)
        break
      case 'spool':
        this.spool = target.value
        break
      case 'line':
        this.line = target.value
        break
      case 'filter':
        this.filter = target.value
        this.render()
        break
      case 'nodeKind':
        this.commit(d => {
          const n = getNode(d, this.selected)
          n.kind = target.value as Kind
          delete n.catalogId
          delete n.takeout
          delete n.branchTakeout
          delete n.portTakeouts
        })
        break
      case 'catalog':
        this.commit(d => {
          const n = getNode(d, this.selected)
          n.catalogId = target.value || undefined
          delete n.takeout
          delete n.branchTakeout
          delete n.portTakeouts
        })
        break
    }
  }
  private async handleClick(event: Event) {
    const target = (event.target as Element).closest<HTMLElement>(
      '[data-action],[data-tab],[data-node],[data-owner],[data-direction],[data-view]'
    )
    if (!target) {
      if (this.pickRoute && this.tab === 'draw') {
        const point = this.sheetPoint(event as MouseEvent)
        if (point) {
          const at = pickGridPoint(
            createDrawing(this.doc, this.filter, this.view),
            point,
            this.anchor,
            this.grid
          )
          this.add(at.map((v, i) => v - this.anchor[i]) as Vec3)
        }
      }
      return
    }
    if (target.dataset.tab) {
      this.tab = target.dataset.tab
      this.render()
      return
    }
    if (target.dataset.view) {
      this.view = target.dataset.view as typeof this.view
      this.render()
      return
    }
    if (target.hasAttribute('data-owner') && !target.dataset.owner) {
      if (this.pickRoute) {
        const point = this.sheetPoint(event as MouseEvent)
        if (point) {
          const at = pickGridPoint(
            createDrawing(this.doc, this.filter, this.view),
            point,
            this.anchor,
            this.grid
          )
          this.add(at.map((v, i) => v - this.anchor[i]) as Vec3)
        }
      }
      return
    }
    if (target.dataset.node || target.dataset.owner) {
      const key = target.dataset.node || target.dataset.owner
      if (key) {
        this.selected = key
        if (this.doc.nodes.some(n => n.id === key)) this.start = key
        this.tab = 'draw'
        this.render()
      }
      return
    }
    if (target.dataset.direction) {
      const dir = target.dataset.direction
      const mm = parseLength(this.field('length'), this.doc.units)
      if (!(mm > 0)) throw new Error('Enter a positive pipe length.')
      const delta: Vec3 = [0, 0, 0]
      delta['xyz'.indexOf(dir[0])] = mm * (dir[1] === '+' ? 1 : -1)
      this.add(delta)
      return
    }
    const action = target.dataset.action
    this.warning = ''
    switch (action) {
      case 'pick-route':
        this.pickRoute = !this.pickRoute
        this.render()
        break
      case 'save':
        this.save()
        break
      case 'undo':
      case 'redo':
        AcApDocManager.instance.sendStringToExecute(action + '\n')
        break
      case 'offset': {
        const delta = ['dx', 'dy', 'dz'].map(n => Number(this.field(n))) as Vec3
        if (!delta.every(Number.isFinite))
          throw new Error('Enter finite offset measurements.')
        this.add(delta)
        break
      }
      case 'apply-run': {
        const spool = this.field('runSpool').trim(),
          line = this.field('runLine'),
          heat = this.field('runHeat'),
          nps = this.number('runNps', 0.001),
          specId = this.field('runSpec'),
          fromPrep = this.field('fromPrep') as EndPrep,
          toPrep = this.field('toPrep') as EndPrep,
          fromTag = this.field('fromTag').trim() || undefined,
          toTag = this.field('toTag').trim() || undefined,
          fromField = (
            this.root.querySelector('[name="fromField"]') as HTMLInputElement
          ).checked,
          toField = (
            this.root.querySelector('[name="toField"]') as HTMLInputElement
          ).checked,
          rootGap = this.optional('runGap')
        if (!spool) throw new Error('Enter a spool number.')
        this.commit(d => {
          const r = d.runs.find(r => r.id === this.selected)!
          Object.assign(r, {
            spool,
            line,
            heat,
            nps,
            specId,
            fromPrep,
            toPrep,
            fromTag,
            toTag,
            fromField,
            toField,
            rootGap
          })
        })
        break
      }
      case 'apply-node': {
        const description = this.field('nodeDescription'),
          takeout = this.optional('takeout'),
          branchTakeout = this.optional('branchTakeout'),
          weightKg = this.optional('weight'),
          areaM2 = this.optional('area'),
          unitCost = this.optional('cost'),
          laborHours = this.optional('labor'),
          heat = this.field('nodeHeat'),
          quantity = this.number('nodeQty', 1),
          field = (
            this.root.querySelector('[name="field"]') as HTMLInputElement
          ).checked,
          branch = this.field('branch'),
          node = getNode(this.doc, this.selected),
          portTakeouts = node.portTakeouts
            ? Object.fromEntries(
                connected(this.doc, node.id).map((r, i) => [
                  r.id,
                  this.number('portTakeout' + i)
                ])
              )
            : undefined
        this.commit(d =>
          Object.assign(getNode(d, this.selected), {
            description: description || undefined,
            takeout,
            branchTakeout,
            portTakeouts,
            weightKg,
            areaM2,
            unitCost,
            laborHours,
            heat,
            quantity,
            field,
            branchEdgeId: branch || undefined
          })
        )
        break
      }
      case 'move-node': {
        const position = [0, 1, 2].map(i =>
          Number(this.field('node' + i))
        ) as Vec3
        if (!position.every(Number.isFinite))
          throw new Error('Enter finite coordinates.')
        this.commit(d => {
          getNode(d, this.selected).position = position
        })
        break
      }
      case 'label-node': {
        const offset: [number, number] = [
          Number(this.field('labelX')),
          Number(this.field('labelY'))
        ]
        if (!offset.every(Number.isFinite))
          throw new Error('Enter finite balloon offsets.')
        this.commit(d => {
          getNode(d, this.selected).labelOffset = offset
        })
        break
      }
      case 'insert': {
        const kind = this.field('insertKind') as Kind,
          fraction = this.number('fraction', 0.001) / 100
        this.commit(d => {
          const n = ['support', 'bolt'].includes(kind)
            ? attachComponent(d, this.selected, kind, fraction)
            : insertComponent(d, this.selected, kind, fraction)
          this.selected = n.id
          this.start = n.id
        })
        break
      }
      case 'remove': {
        const key = this.selected
        this.commit(d => {
          if (d.nodes.some(n => n.id === key)) {
            d.nodes = d.nodes.filter(n => n.id !== key)
            d.runs = d.runs.filter(r => r.from !== key && r.to !== key)
          } else d.runs = d.runs.filter(r => r.id !== key)
          d.nodes = d.nodes.filter(n =>
            d.runs.some(
              r =>
                r.from === n.id || r.to === n.id || r.id === n.associatedRunId
            )
          )
        })
        this.selected = ''
        this.start = this.doc.nodes.at(-1)?.id ?? ''
        this.render()
        break
      }
      case 'import':
        ;(this.root.querySelector('[data-import]') as HTMLInputElement).click()
        break
      case 'json':
        download(
          this.doc.drawing + '.piping.json',
          JSON.stringify(this.doc, null, 2),
          'application/json'
        )
        break
      case 'dwg': {
        target.setAttribute('disabled', '')
        target.textContent = 'Writing DWG…'
        try {
          download(
            this.doc.drawing + '.dwg',
            await exportDwg(
              String(
                AcApDocManager.instance.curDocument.database.dxfOut(
                  undefined,
                  undefined,
                  'AC1015'
                )
              )
            )
          )
        } finally {
          target.removeAttribute('disabled')
          target.textContent = 'DWG'
        }
        break
      }
      case 'dxf':
        download(
          this.doc.drawing + '.dxf',
          String(AcApDocManager.instance.curDocument.database.dxfOut()),
          'application/dxf'
        )
        break
      case 'pdf':
        download(this.doc.drawing + '.pdf', await exportPdf(this.doc))
        break
      case 'svg':
        exportSvg(this.doc, this.filter)
        break
      case 'bom':
        download(
          this.doc.drawing + '-materials.csv',
          bomCsv(this.doc),
          'text/csv'
        )
        break
      case 'cuts':
        exportSchedule(this.doc, 'cut')
        break
      case 'weld-csv':
        exportSchedule(this.doc, 'weld')
        break
      case 'pcf':
        if (validateIso(this.doc).length)
          throw new Error('Resolve fabrication checks before exporting PCF.')
        download(this.doc.drawing + '.pcf', exportPcf(this.doc))
        break
      case 'global':
        ;(this.root.querySelector('[data-global]') as HTMLInputElement).click()
        break
      case 'weld-settings': {
        const prefix = this.field('weldPrefix'),
          start = this.number('weldStart', 1),
          numbering = this.field('weldNumbering') as 'numeric' | 'alphabetic'
        if (!Number.isInteger(start))
          throw new Error('Weld start must be a whole number.')
        this.commit(d => {
          d.weldPrefix = prefix
          d.weldStart = start
          d.weldNumbering = numbering
        })
        break
      }
      case 'apply-sheet': {
        const fields = [
          'title',
          'drawing',
          'revision',
          'customer',
          'project',
          'drawnBy',
          'checkedBy',
          'notes',
          'units',
          'dimensionMode',
          'paper'
        ]
        const values = Object.fromEntries(
          fields.map(name => [name, this.field(name)])
        )
        const north = Number(this.field('north'))
        if (!Number.isFinite(north))
          throw new Error('Enter a finite rotation angle.')
        const outputViews = (['iso', 'plan', 'front', 'side'] as const).filter(
          v =>
            (
              this.root.querySelector(
                `[name="output-${v}"]`
              ) as HTMLInputElement
            ).checked
        )
        if (!outputViews.length)
          throw new Error('Choose at least one drawing view for the PDF.')
        this.commit(d => Object.assign(d, values, { north, outputViews }))
        break
      }
      case 'apply-spec': {
        const values = {
          name: this.field('specName'),
          material: this.field('material'),
          schedule: this.field('schedule'),
          rating: this.field('rating'),
          rootGap: this.number('rootGap'),
          density: this.number('density', 1),
          pipeCostM: this.number('pipeCost'),
          pipeLaborHoursM: this.number('pipeLabor'),
          weldHoursPerDiameterInch: this.number('weldLabor')
        }
        this.commit(d => Object.assign(getSpec(d, this.spec), values))
        break
      }
      case 'new-spec': {
        const next = clone(getSpec(this.doc, this.spec))
        next.id = 'SPEC-' + id().slice(0, 8)
        next.name += ' (copy)'
        next.fittings = next.fittings.map(f => ({
          ...f,
          id: next.id + '-' + f.id
        }))
        this.commit(d => d.specs.push(next))
        this.spec = next.id
        this.render()
        break
      }
      case 'size-add': {
        const size = {
          nps: this.number('sizeNps', 0.001),
          od: this.number('sizeOd', 0.001),
          wall: this.number('sizeWall', 0.001),
          kgM: this.number('sizeWeight', 0.001)
        }
        if (size.wall * 2 >= size.od)
          throw new Error('Wall thickness must be less than half the OD.')
        this.commit(d => {
          const s = getSpec(d, this.spec)
          s.sizes = s.sizes.filter(v => v.nps !== size.nps)
          s.sizes.push(size)
          s.sizes.sort((a, b) => a.nps - b.nps)
        })
        break
      }
      case 'fitting-add': {
        const f = {
          id: 'FIT-' + id(),
          kind: this.field('fitKind') as Kind,
          nps: this.number('fitNps', 0.001),
          description: this.field('fitDescription'),
          takeout: this.number('fitTakeout'),
          branchTakeout: this.optional('fitBranch'),
          weightKg: this.optional('fitWeight'),
          areaM2: this.optional('fitArea'),
          unitCost: this.optional('fitCost'),
          laborHours: this.optional('fitLabor'),
          source: this.field('fitSource')
        }
        if (!f.description || !f.source)
          throw new Error('Enter the description and dimension source.')
        this.commit(d => getSpec(d, this.spec).fittings.push(f))
        break
      }
      case 'spec-export':
        download(
          this.spec + '.spec.json',
          JSON.stringify(getSpec(this.doc, this.spec), null, 2),
          'application/json'
        )
        break
      case 'spec-import':
        ;(
          this.root.querySelector('[data-spec-import]') as HTMLInputElement
        ).click()
        break
    }
  }
  private sheetPoint(event: MouseEvent): [number, number] | undefined {
    const svg = (event.target as Element).closest('svg')
    if (!svg || !svg.closest('.bw-iso-canvas')) return
    const matrix = svg.getScreenCTM()
    if (!matrix) return
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse()
    )
    if (p.x < 50 || p.x > 780 || p.y < 115 || p.y > 630) return
    return [p.x, p.y]
  }
  private previewPick(event: MouseEvent) {
    const cursor = this.root.querySelector('[data-grid-cursor]')
    if (!cursor) return
    cursor.innerHTML = ''
    if (!this.pickRoute) return
    const point = this.sheetPoint(event)
    if (!point) return
    try {
      const drawing = createDrawing(this.doc, this.filter, this.view),
        at = pickGridPoint(drawing, point, this.anchor, this.grid),
        p = drawing.project(at),
        start = drawing.project(this.anchor),
        travel = Math.hypot(...at.map((v, i) => v - this.anchor[i]))
      cursor.innerHTML = `<line class="grid-cursor" x1="${start[0]}" y1="${start[1]}" x2="${p[0]}" y2="${p[1]}" stroke-dasharray="5 4"/><circle class="grid-cursor" cx="${p[0]}" cy="${p[1]}" r="4"/><text x="${Math.min(p[0] + 9, 610)}" y="${Math.max(145, p[1] - 10)}" font-size="11">${e(formatLength(travel, this.doc.units))}</text>`
    } catch {
      /* Edge-on planes report a clear error if the user attempts a pick. */
    }
  }
  private optional(name: string): number | undefined {
    return this.field(name).trim() ? this.number(name) : undefined
  }
  private add(delta: Vec3) {
    this.spool = this.field('spool').trim()
    this.line = this.field('line')
    if (!this.spool) throw new Error('Enter a spool number.')
    const start = this.start,
      spec = this.spec,
      nps = this.nps,
      spool = this.spool,
      line = this.line
    this.commit(d => {
      const n = appendRun(d, start || null, delta, spec, nps, spool, line)
      this.start = n.id
      this.selected = n.id
    })
  }
  private async importFiles(input: HTMLInputElement) {
    const file = input.files?.[0]
    if (!file) return
    if (file.size > 8_000_000) throw new Error('Import is limited to 8 MB.')
    const text = await file.text()
    let doc: IsoDocument,
      warnings: string[] = []
    if (file.name.toLowerCase().endsWith('.pcf')) {
      const imported = importPcf(text)
      doc = imported.doc
      warnings = imported.warnings
    } else doc = parseIsoJson(text)
    this.commit(d => Object.assign(d, doc))
    this.spec = doc.specs[0].id
    this.start = doc.nodes.at(-1)?.id ?? ''
    this.selected = ''
    this.warning = warnings.join(' ')
    this.render()
  }
  private async globalFiles(input: HTMLInputElement) {
    const files = [...(input.files ?? [])]
    if (files.length > 100) throw new Error('Select at most 100 piping files.')
    const docs = await Promise.all(
      files.map(async f => {
        if (f.size > 8_000_000) throw new Error(`${f.name} exceeds 8 MB.`)
        return parseIsoJson(await f.text())
      })
    )
    download('project-materials.csv', combinedBomCsv(docs), 'text/csv')
  }
  private async importSpec(input: HTMLInputElement) {
    const file = input.files?.[0]
    if (!file) return
    if (file.size > 1_000_000)
      throw new Error('Specification is limited to 1 MB.')
    const spec = JSON.parse(await file.text())
    const trial = newIso()
    trial.specs = [spec]
    parseIsoJson(JSON.stringify(trial))
    this.commit(d => {
      if (d.specs.some(s => s.id === spec.id))
        throw new Error(
          'Specification ID already exists; use a new ID to avoid changing existing pipes.'
        )
      d.specs.push(spec)
    })
    this.spec = spec.id
    this.render()
  }
}
