export interface PdfDataPackage {
  quoteNumber: string;
  revisionNumber: number;
  title: string;
  description: string;
  clientName: string;
  location: string;
  type: string;
  status: string;
  dateQuote: string | null;
  dateDue: string | null;
  subtotal: number;
  cost: number;
  estimatedProfit: number;
  estimatedMargin: number;
  totalHours: number;
  breakoutPackage: unknown[];
  lineItems: Array<{
    lineOrder: number;
    entityName: string;
    category: string;
    quantity: number;
    uom: string;
    cost: number;
    markup: number;
    price: number;
    laborHourReg: number;
    laborHourOver: number;
    laborHourDouble: number;
    vendor: string;
    description: string;
    phaseName?: string;
    worksheetName: string;
  }>;
  phases: Array<{ number: string; name: string; description: string }>;
  modifiers: Array<{
    name: string;
    type: string;
    appliesTo: string;
    percentage: number | null;
    amount: number | null;
    show: string;
  }>;
  conditions: Array<{ type: string; value: string }>;
  notes: string;
  leadLetter: string;
  reportSections: Array<{
    id: string;
    sectionType: string;
    title: string;
    content: string;
    order: number;
    parentSectionId: string | null;
  }>;
}

export function buildPdfDataPackage(workspace: any, reportSections: any[] = []): PdfDataPackage {
  const rev = workspace.currentRevision;
  const lineItems = (workspace.worksheets ?? []).flatMap((ws: any) =>
    (ws.items ?? []).map((item: any) => ({
      ...item,
      worksheetName: ws.name,
      phaseName: (workspace.phases ?? []).find(
        (p: any) => p.id === item.phaseId
      )?.name,
    }))
  );

  return {
    quoteNumber: workspace.quote?.quoteNumber ?? "",
    revisionNumber: rev?.revisionNumber ?? 0,
    title: rev?.title ?? "",
    description: rev?.description ?? "",
    clientName: workspace.project?.clientName ?? "",
    location: workspace.project?.location ?? "",
    type: rev?.type ?? "Firm",
    status: rev?.status ?? "Open",
    dateQuote: rev?.dateQuote ?? null,
    dateDue: rev?.dateDue ?? null,
    subtotal: rev?.subtotal ?? 0,
    cost: rev?.cost ?? 0,
    estimatedProfit: rev?.estimatedProfit ?? 0,
    estimatedMargin: rev?.estimatedMargin ?? 0,
    totalHours: rev?.totalHours ?? 0,
    breakoutPackage: rev?.breakoutPackage ?? [],
    lineItems,
    phases: (workspace.phases ?? []).map((p: any) => ({
      number: p.number,
      name: p.name,
      description: p.description,
    })),
    modifiers: workspace.modifiers ?? [],
    conditions: (workspace.conditions ?? []).map((c: any) => ({
      type: c.type,
      value: c.value,
    })),
    notes: rev?.notes ?? "",
    leadLetter: rev?.leadLetter ?? "",
    reportSections: (reportSections ?? []).map((s: any) => ({
      id: s.id,
      sectionType: s.sectionType ?? "content",
      title: s.title ?? "",
      content: s.content ?? "",
      order: s.order ?? 0,
      parentSectionId: s.parentSectionId ?? null,
    })),
  };
}

export function generatePdfHtml(
  data: PdfDataPackage,
  templateType: string
): string {
  const inclusions = data.conditions.filter((c) =>
    c.type.toLowerCase().includes("inclusion")
  );
  const exclusions = data.conditions.filter((c) =>
    c.type.toLowerCase().includes("exclusion")
  );

  const formatMoney = (v: number) =>
    `$${v.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const formatPct = (v: number) => `${(v * 100).toFixed(1)}%`;

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1a1a1a; margin: 40px; font-size: 12px; line-height: 1.5; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 24px 0 8px; border-bottom: 2px solid #e5e5e5; padding-bottom: 4px; }
  h3 { font-size: 13px; margin: 16px 0 4px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #e5e5e5; font-size: 11px; }
  th { background: #f5f5f5; font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
  .meta { color: #666; font-size: 11px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; }
  .badge-firm { background: #e8f5e9; color: #2e7d32; }
  .badge-budget { background: #fff3e0; color: #e65100; }
  .totals { background: #f5f5f5; font-weight: 600; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 2px solid #e5e5e5; font-size: 11px; color: #666; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
  .summary-card { background: #f9f9f9; border: 1px solid #e5e5e5; border-radius: 6px; padding: 12px; }
  .summary-card .label { font-size: 10px; text-transform: uppercase; color: #888; }
  .summary-card .value { font-size: 18px; font-weight: 600; margin-top: 4px; }
  .conditions { columns: 2; column-gap: 24px; }
  .conditions li { margin-bottom: 4px; }
  @media print { body { margin: 20px; } }
</style></head><body>`;

  // Header
  html += `<div class="header">
    <div>
      <h1>${escapeHtml(data.title || data.quoteNumber)}</h1>
      <div class="meta">${escapeHtml(data.clientName)} &middot; ${escapeHtml(data.location)}</div>
      <div class="meta">Quote ${escapeHtml(data.quoteNumber)} &middot; Revision ${data.revisionNumber}</div>
    </div>
    <div style="text-align:right">
      <span class="badge badge-${data.type.toLowerCase()}">${escapeHtml(data.type)}</span>
      ${data.dateQuote ? `<div class="meta" style="margin-top:4px">Date: ${escapeHtml(data.dateQuote)}</div>` : ""}
      ${data.dateDue ? `<div class="meta">Due: ${escapeHtml(data.dateDue)}</div>` : ""}
    </div>
  </div>`;

  // Summary cards
  html += `<div class="summary-grid">
    <div class="summary-card"><div class="label">Subtotal</div><div class="value">${formatMoney(data.subtotal)}</div></div>
    <div class="summary-card"><div class="label">Cost</div><div class="value">${formatMoney(data.cost)}</div></div>
    <div class="summary-card"><div class="label">Profit</div><div class="value">${formatMoney(data.estimatedProfit)}</div></div>
    <div class="summary-card"><div class="label">Margin</div><div class="value">${formatPct(data.estimatedMargin)}</div></div>
  </div>`;

  // Description
  if (data.description) {
    html += `<h2>Scope of Work</h2><div>${escapeHtml(data.description)}</div>`;
  }

  // Lead letter (only for main template)
  if (templateType === "main" && data.leadLetter) {
    html += `<h2>Lead Letter</h2><div>${escapeHtml(data.leadLetter)}</div>`;
  }

  // Line items table
  if (templateType !== "closeout") {
    const backupCol = templateType === "backup";
    html += `<h2>Line Items</h2><table>
      <thead><tr><th>#</th><th>Item</th><th>Category</th>${backupCol ? "<th>Worksheet</th>" : ""}<th class="num">Qty</th><th>UOM</th><th class="num">Cost</th><th class="num">Markup</th><th class="num">Price</th><th class="num">Hours</th></tr></thead><tbody>`;
    for (const item of data.lineItems) {
      const hours =
        item.laborHourReg + item.laborHourOver + item.laborHourDouble;
      html += `<tr>
        <td>${item.lineOrder}</td>
        <td><strong>${escapeHtml(item.entityName)}</strong>${item.description ? `<br><span style="color:#888">${escapeHtml(item.description)}</span>` : ""}</td>
        <td>${escapeHtml(item.category)}</td>
        ${backupCol ? `<td>${escapeHtml(item.worksheetName)}</td>` : ""}
        <td class="num">${item.quantity}</td>
        <td>${escapeHtml(item.uom)}</td>
        <td class="num">${formatMoney(item.cost)}</td>
        <td class="num">${formatPct(item.markup)}</td>
        <td class="num"><strong>${formatMoney(item.price)}</strong></td>
        <td class="num">${hours > 0 ? hours.toLocaleString() : ""}</td>
      </tr>`;
    }
    // Totals row
    const totalCost = data.lineItems.reduce((s, i) => s + i.cost, 0);
    const totalPrice = data.lineItems.reduce((s, i) => s + i.price, 0);
    const totalHrs = data.lineItems.reduce(
      (s, i) => s + i.laborHourReg + i.laborHourOver + i.laborHourDouble,
      0
    );
    html += `<tr class="totals"><td colspan="${backupCol ? 6 : 5}">Total (${data.lineItems.length} items)</td><td class="num">${formatMoney(totalCost)}</td><td></td><td class="num">${formatMoney(totalPrice)}</td><td class="num">${totalHrs.toLocaleString()}</td></tr>`;
    html += `</tbody></table>`;
  }

  // Modifiers
  if (data.modifiers.length > 0) {
    html += `<h2>Modifiers</h2><table><thead><tr><th>Name</th><th>Type</th><th>Applies To</th><th class="num">%</th><th class="num">Amount</th></tr></thead><tbody>`;
    for (const m of data.modifiers) {
      html += `<tr><td>${escapeHtml(m.name)}</td><td>${escapeHtml(m.type)}</td><td>${escapeHtml(m.appliesTo)}</td><td class="num">${m.percentage != null ? formatPct(m.percentage) : ""}</td><td class="num">${m.amount != null ? formatMoney(m.amount) : ""}</td></tr>`;
    }
    html += `</tbody></table>`;
  }

  // Conditions
  if (inclusions.length > 0 || exclusions.length > 0) {
    html += `<h2>Terms & Conditions</h2><div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">`;
    if (inclusions.length > 0) {
      html += `<div><h3>Inclusions</h3><ul>${inclusions.map((c) => `<li>${escapeHtml(c.value)}</li>`).join("")}</ul></div>`;
    }
    if (exclusions.length > 0) {
      html += `<div><h3>Exclusions</h3><ul>${exclusions.map((c) => `<li>${escapeHtml(c.value)}</li>`).join("")}</ul></div>`;
    }
    html += `</div>`;
  }

  // Notes
  if (data.notes) {
    html += `<h2>Notes</h2><div>${escapeHtml(data.notes)}</div>`;
  }

  // Hours summary (for main and site copy)
  if (templateType !== "closeout") {
    html += `<h2>Hours Summary</h2>
      <table><thead><tr><th>Regular</th><th>Overtime (1.5x)</th><th>Double Time (2x)</th><th>Total</th></tr></thead>
      <tbody><tr>
        <td class="num">${data.lineItems.reduce((s, i) => s + i.laborHourReg * i.quantity, 0).toLocaleString()}</td>
        <td class="num">${data.lineItems.reduce((s, i) => s + i.laborHourOver * i.quantity, 0).toLocaleString()}</td>
        <td class="num">${data.lineItems.reduce((s, i) => s + i.laborHourDouble * i.quantity, 0).toLocaleString()}</td>
        <td class="num"><strong>${data.totalHours.toLocaleString()}</strong></td>
      </tr></tbody></table>`;
  }

  // Report sections
  if (data.reportSections.length > 0) {
    html += `<h2>Report</h2>`;
    const topLevel = data.reportSections
      .filter((s) => !s.parentSectionId)
      .sort((a, b) => a.order - b.order);
    const children = (parentId: string) =>
      data.reportSections
        .filter((s) => s.parentSectionId === parentId)
        .sort((a, b) => a.order - b.order);

    for (const section of topLevel) {
      html += renderReportSection(section);
      for (const child of children(section.id)) {
        html += `<div style="margin-left:24px;padding-left:16px;border-left:3px solid #e5e5e5">`;
        html += renderReportSection(child);
        html += `</div>`;
      }
    }
  }

  html += `<div class="footer">Generated by Bidwright &middot; ${new Date().toLocaleDateString()}</div>`;
  html += `</body></html>`;

  return html;
}

function renderReportSection(section: PdfDataPackage["reportSections"][number]): string {
  const typeStyles: Record<string, { bg: string; border: string; icon: string }> = {
    content:         { bg: "#f9f9f9", border: "#e5e5e5", icon: "&#128221;" },
    heading:         { bg: "#eff6ff", border: "#bfdbfe", icon: "&#128204;" },
    summary:         { bg: "#ecfdf5", border: "#a7f3d0", icon: "&#128202;" },
    recommendations: { bg: "#fffbeb", border: "#fde68a", icon: "&#128161;" },
    image:           { bg: "#faf5ff", border: "#e9d5ff", icon: "&#128247;" },
  };
  const style = typeStyles[section.sectionType] ?? typeStyles.content;

  if (section.sectionType === "heading") {
    return `<h3 style="margin:20px 0 8px;font-size:15px;font-weight:600;color:#1a1a1a">${section.title}</h3>`;
  }

  let html = `<div style="background:${style.bg};border:1px solid ${style.border};border-radius:6px;padding:16px;margin:12px 0">`;
  if (section.title) {
    html += `<div style="font-weight:600;font-size:13px;margin-bottom:8px">${style.icon} ${section.title}</div>`;
  }
  if (section.content) {
    // Content may contain HTML from the rich text editor
    html += `<div style="font-size:12px;line-height:1.6;color:#333">${section.content}</div>`;
  }
  html += `</div>`;
  return html;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* ─── Schedule PDF ─── */

export interface SchedulePdfData {
  projectName: string;
  clientName: string;
  dateStart: string | null;
  dateEnd: string | null;
  phases: Array<{ id: string; name: string; number: string; color: string }>;
  tasks: Array<{
    name: string;
    phaseName: string;
    startDate: string | null;
    endDate: string | null;
    duration: number;
    progress: number;
    assignee: string;
    status: string;
    taskType: string;
  }>;
  generatedAt: string;
}

export function buildSchedulePdfData(workspace: any): SchedulePdfData {
  const phases = (workspace.phases ?? []).map((p: any) => ({
    id: p.id,
    name: p.name ?? "",
    number: p.number ?? "",
    color: p.color ?? "",
  }));
  const phaseMap = new Map(phases.map((p: any) => [p.id, p.name]));

  const tasks = (workspace.scheduleTasks ?? []).map((t: any) => ({
    name: t.name ?? "",
    phaseName: t.phaseId ? phaseMap.get(t.phaseId) ?? "" : "",
    startDate: t.startDate ?? null,
    endDate: t.endDate ?? null,
    duration: t.duration ?? 0,
    progress: t.progress ?? 0,
    assignee: t.assignee ?? "",
    status: t.status ?? "not_started",
    taskType: t.taskType ?? "task",
  }));

  return {
    projectName: workspace.project?.name ?? "",
    clientName: workspace.project?.clientName ?? "",
    dateStart: workspace.currentRevision?.dateWorkStart ?? null,
    dateEnd: workspace.currentRevision?.dateWorkEnd ?? null,
    phases,
    tasks,
    generatedAt: new Date().toLocaleDateString(),
  };
}

const STATUS_DISPLAY: Record<string, { label: string; color: string }> = {
  not_started: { label: "Not Started", color: "#9ca3af" },
  in_progress: { label: "In Progress", color: "#3b82f6" },
  complete: { label: "Complete", color: "#10b981" },
  on_hold: { label: "On Hold", color: "#f59e0b" },
};

const BAR_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#f43f5e", "#06b6d4", "#f97316", "#ec4899"];

export function generateSchedulePdfHtml(data: SchedulePdfData): string {
  const startDate = data.dateStart ? new Date(data.dateStart) : new Date();
  const endDate = data.dateEnd ? new Date(data.dateEnd) : new Date(startDate.getTime() + 90 * 86400000);
  const totalDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000));

  // Generate week columns
  const weeks: { label: string; start: Date }[] = [];
  let current = new Date(startDate);
  current.setDate(current.getDate() - current.getDay()); // start of week
  while (current <= endDate && weeks.length < 30) {
    weeks.push({
      label: current.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      start: new Date(current),
    });
    current = new Date(current.getTime() + 7 * 86400000);
  }

  const phaseMap = new Map(data.phases.map((p, i) => [p.name, BAR_COLORS[i % BAR_COLORS.length]]));

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  @page { size: landscape; margin: 15mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1a1a1a; margin: 0; font-size: 11px; line-height: 1.4; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid #e5e5e5; }
  .header h1 { font-size: 20px; margin: 0 0 2px; }
  .header .meta { color: #666; font-size: 10px; }
  .gantt { width: 100%; border-collapse: collapse; }
  .gantt th, .gantt td { padding: 4px 6px; border: 1px solid #e5e5e5; font-size: 10px; }
  .gantt thead th { background: #f5f5f5; font-weight: 600; text-transform: uppercase; font-size: 9px; letter-spacing: 0.05em; }
  .gantt .name-col { width: 200px; min-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gantt .phase-col { width: 100px; min-width: 100px; }
  .gantt .status-col { width: 80px; min-width: 80px; text-align: center; }
  .gantt .bar-cell { position: relative; padding: 2px 0; height: 20px; }
  .gantt .bar { position: absolute; height: 14px; top: 3px; border-radius: 3px; min-width: 4px; }
  .gantt .bar-progress { position: absolute; height: 14px; top: 0; left: 0; border-radius: 3px; opacity: 0.3; background: white; }
  .gantt .milestone { position: absolute; top: 2px; width: 12px; height: 12px; transform: rotate(45deg); border-radius: 2px; }
  .gantt .phase-row { background: #f9fafb; font-weight: 600; }
  .status-badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 9px; font-weight: 500; }
  .footer { margin-top: 16px; padding-top: 8px; border-top: 1px solid #e5e5e5; font-size: 9px; color: #999; display: flex; justify-content: space-between; }
  @media print { body { margin: 0; } }
</style></head><body>`;

  // Header
  html += `<div class="header">
    <div>
      <h1>${escapeHtml(data.projectName)}</h1>
      <div class="meta">${escapeHtml(data.clientName)}</div>
    </div>
    <div style="text-align:right">
      <div class="meta">Project Schedule</div>
      <div class="meta">${data.dateStart ? new Date(data.dateStart).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "TBD"} \u2014 ${data.dateEnd ? new Date(data.dateEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "TBD"}</div>
    </div>
  </div>`;

  // Table
  html += `<table class="gantt"><thead><tr>
    <th class="name-col">Task</th>
    <th class="phase-col">Phase</th>
    <th class="status-col">Status</th>
    <th>Assignee</th>`;

  for (const week of weeks) {
    html += `<th style="text-align:center;min-width:40px">${week.label}</th>`;
  }
  html += `</tr></thead><tbody>`;

  // Group tasks by phase
  const phaseGroups = new Map<string, typeof data.tasks>();
  const standalone: typeof data.tasks = [];
  for (const task of data.tasks) {
    if (task.phaseName) {
      if (!phaseGroups.has(task.phaseName)) phaseGroups.set(task.phaseName, []);
      phaseGroups.get(task.phaseName)!.push(task);
    } else {
      standalone.push(task);
    }
  }

  const renderTask = (task: typeof data.tasks[0], color: string) => {
    const s = STATUS_DISPLAY[task.status] ?? STATUS_DISPLAY.not_started;
    html += `<tr>
      <td class="name-col" style="padding-left:24px">${task.taskType === "milestone" ? "\u25C6 " : ""}${escapeHtml(task.name)}</td>
      <td class="phase-col">${escapeHtml(task.phaseName)}</td>
      <td class="status-col"><span class="status-badge" style="background:${s.color}20;color:${s.color}">${s.label}</span></td>
      <td>${escapeHtml(task.assignee)}</td>`;

    // Bar cells
    const tStart = task.startDate ? new Date(task.startDate).getTime() : null;
    const tEnd = task.endDate ? new Date(task.endDate).getTime() : null;

    for (const week of weeks) {
      const weekStart = week.start.getTime();
      const weekEnd = weekStart + 7 * 86400000;

      html += `<td class="bar-cell">`;
      if (tStart && tEnd) {
        if (task.taskType === "milestone") {
          if (tStart >= weekStart && tStart < weekEnd) {
            const pct = ((tStart - weekStart) / (weekEnd - weekStart)) * 100;
            html += `<div class="milestone" style="left:${pct}%;background:${color}"></div>`;
          }
        } else {
          // Compute bar overlap with this week
          const overlapStart = Math.max(tStart, weekStart);
          const overlapEnd = Math.min(tEnd, weekEnd);
          if (overlapStart < overlapEnd) {
            const left = ((overlapStart - weekStart) / (weekEnd - weekStart)) * 100;
            const width = ((overlapEnd - overlapStart) / (weekEnd - weekStart)) * 100;
            html += `<div class="bar" style="left:${left}%;width:${width}%;background:${color}">`;
            if (task.progress > 0) {
              html += `<div class="bar-progress" style="width:${task.progress * 100}%"></div>`;
            }
            html += `</div>`;
          }
        }
      }
      html += `</td>`;
    }
    html += `</tr>`;
  };

  // Render phase groups
  let phaseIdx = 0;
  for (const phase of data.phases) {
    const phaseTasks = phaseGroups.get(phase.name) ?? [];
    if (phaseTasks.length === 0) continue;
    const color = BAR_COLORS[phaseIdx % BAR_COLORS.length];

    html += `<tr class="phase-row">
      <td colspan="${4 + weeks.length}" style="border-left:3px solid ${color}">
        <span style="color:${color}">\u25CF</span> ${escapeHtml(phase.number ? `${phase.number}. ` : "")}${escapeHtml(phase.name)}
        <span style="color:#999;font-weight:normal;margin-left:8px">${phaseTasks.length} task${phaseTasks.length !== 1 ? "s" : ""}</span>
      </td>
    </tr>`;

    for (const task of phaseTasks) {
      renderTask(task, color);
    }
    phaseIdx++;
  }

  // Standalone tasks
  if (standalone.length > 0) {
    html += `<tr class="phase-row"><td colspan="${4 + weeks.length}">Unphased Tasks</td></tr>`;
    for (const task of standalone) {
      renderTask(task, "#6b7280");
    }
  }

  html += `</tbody></table>`;

  // Footer
  html += `<div class="footer">
    <span>${data.tasks.length} tasks \u00B7 ${data.phases.length} phases</span>
    <span>Generated by Bidwright \u00B7 ${data.generatedAt}</span>
  </div>`;

  html += `</body></html>`;
  return html;
}

// Lazy browser singleton for Playwright
let _browser: import("playwright").Browser | null = null;

async function getBrowser(): Promise<import("playwright").Browser> {
  if (_browser && _browser.isConnected()) return _browser;
  const { chromium } = await import("playwright");
  _browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  return _browser;
}

/**
 * Generate a PDF buffer from HTML content using Playwright.
 * Falls back to returning HTML if Playwright/Chromium is unavailable.
 */
export async function generatePdfBuffer(html: string): Promise<{ buffer: Buffer; contentType: string }> {
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
    });
    await page.close();
    return { buffer: Buffer.from(pdfBuffer), contentType: "application/pdf" };
  } catch {
    // Playwright/Chromium not available — fall back to HTML
    return { buffer: Buffer.from(html, "utf-8"), contentType: "text/html" };
  }
}
