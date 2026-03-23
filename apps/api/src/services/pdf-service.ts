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

export interface PdfLayoutOptions {
  // Which sections to show (all default true)
  sections: {
    coverPage: boolean;
    scopeOfWork: boolean;
    leadLetter: boolean;
    lineItems: boolean;
    phases: boolean;
    modifiers: boolean;
    conditions: boolean;
    hoursSummary: boolean;
    labourSummary: boolean;
    notes: boolean;
    reportSections: boolean;
  };
  // Section display order (array of section keys)
  sectionOrder: string[];
  // Line items options
  lineItemOptions: {
    showCostColumn: boolean;
    showMarkupColumn: boolean;
    groupBy: "none" | "phase" | "worksheet";
  };
  // Branding
  branding: {
    accentColor: string;     // hex e.g. "#3b82f6"
    headerBgColor: string;   // hex
    fontFamily: "sans" | "serif" | "mono";
  };
  // Page setup
  pageSetup: {
    orientation: "portrait" | "landscape";
    pageSize: "letter" | "a4" | "legal";
  };
  // Cover page options
  coverPageOptions: {
    companyName: string;
    tagline: string;
    logoUrl: string;
  };
  // Header/footer
  headerFooter: {
    showHeader: boolean;
    showFooter: boolean;
    headerText: string;
    footerText: string;
    showPageNumbers: boolean;
  };
  // Custom sections
  customSections: Array<{
    id: string;
    title: string;
    content: string;
    order: number;
  }>;
}

export function getDefaultPdfLayoutOptions(): PdfLayoutOptions {
  return {
    sections: {
      coverPage: true,
      scopeOfWork: true,
      leadLetter: true,
      lineItems: true,
      phases: true,
      modifiers: true,
      conditions: true,
      hoursSummary: true,
      labourSummary: false,
      notes: true,
      reportSections: true,
    },
    sectionOrder: [
      "coverPage", "scopeOfWork", "leadLetter", "lineItems", "phases",
      "modifiers", "conditions", "hoursSummary", "labourSummary", "notes", "reportSections",
    ],
    lineItemOptions: {
      showCostColumn: true,
      showMarkupColumn: true,
      groupBy: "none",
    },
    branding: {
      accentColor: "#3b82f6",
      headerBgColor: "#1a1a1a",
      fontFamily: "sans",
    },
    pageSetup: {
      orientation: "portrait",
      pageSize: "letter",
    },
    coverPageOptions: {
      companyName: "",
      tagline: "",
      logoUrl: "",
    },
    headerFooter: {
      showHeader: true,
      showFooter: true,
      headerText: "",
      footerText: "",
      showPageNumbers: true,
    },
    customSections: [],
  };
}

function deepMerge<T extends Record<string, any>>(base: T, overrides: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(overrides) as (keyof T)[]) {
    const val = overrides[key];
    if (val !== undefined && typeof val === "object" && !Array.isArray(val) && val !== null) {
      result[key] = deepMerge(base[key] as any, val as any);
    } else if (val !== undefined) {
      result[key] = val as T[keyof T];
    }
  }
  return result;
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

const FONT_STACKS: Record<PdfLayoutOptions["branding"]["fontFamily"], string> = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: '"Georgia", "Times New Roman", serif',
  mono: '"SF Mono", "Fira Code", monospace',
};

export function generatePdfHtml(
  data: PdfDataPackage,
  templateType: string,
  options?: Partial<PdfLayoutOptions>
): string {
  const defaults = getDefaultPdfLayoutOptions();
  const opts: PdfLayoutOptions = options ? deepMerge(defaults, options) : defaults;

  const fontStack = FONT_STACKS[opts.branding.fontFamily];
  const accent = opts.branding.accentColor;
  const headerBg = opts.branding.headerBgColor;

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

  // --- Section renderers ---

  const renderCoverPage = (): string => {
    const companyName = opts.coverPageOptions.companyName || "Proposal";
    const tagline = opts.coverPageOptions.tagline;
    const logoUrl = opts.coverPageOptions.logoUrl;
    const dateStr = data.dateQuote
      ? new Date(data.dateQuote).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
      : new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    let coverHtml = `<div class="cover-page">`;
    if (logoUrl) {
      coverHtml += `<img src="${escapeHtml(logoUrl)}" alt="Logo" style="max-width:180px;max-height:80px;margin-bottom:24px" />`;
    }
    coverHtml += `<div class="cover-company">${escapeHtml(companyName)}</div>`;
    if (tagline) {
      coverHtml += `<div class="cover-tagline">${escapeHtml(tagline)}</div>`;
    }
    coverHtml += `<div class="cover-divider"></div>`;
    coverHtml += `<div class="cover-title">${escapeHtml(data.title || data.quoteNumber)}</div>`;
    coverHtml += `<div class="cover-meta">Prepared for <strong>${escapeHtml(data.clientName)}</strong></div>`;
    coverHtml += `<div class="cover-meta">${escapeHtml(data.location)}</div>`;
    coverHtml += `<div class="cover-details">`;
    coverHtml += `<span>Quote ${escapeHtml(data.quoteNumber)}</span>`;
    coverHtml += `<span>&middot;</span>`;
    coverHtml += `<span>Revision ${data.revisionNumber}</span>`;
    coverHtml += `<span>&middot;</span>`;
    coverHtml += `<span>${dateStr}</span>`;
    coverHtml += `</div>`;
    coverHtml += `</div>`;
    return coverHtml;
  };

  const renderScopeOfWork = (): string => {
    if (!data.description) return "";
    return `<h2>Scope of Work</h2><div class="section-body">${escapeHtml(data.description)}</div>`;
  };

  const renderLeadLetter = (): string => {
    if (templateType !== "main" || !data.leadLetter) return "";
    return `<h2>Lead Letter</h2><div class="section-body">${escapeHtml(data.leadLetter)}</div>`;
  };

  const renderLineItems = (): string => {
    if (templateType === "closeout") return "";

    const backupCol = templateType === "backup";
    const showCost = opts.lineItemOptions.showCostColumn;
    const showMarkup = opts.lineItemOptions.showMarkupColumn;
    const groupBy = opts.lineItemOptions.groupBy;

    const renderItemRow = (item: PdfDataPackage["lineItems"][0]) => {
      const hours = item.laborHourReg + item.laborHourOver + item.laborHourDouble;
      let row = `<tr>
        <td>${item.lineOrder}</td>
        <td><strong>${escapeHtml(item.entityName)}</strong>${item.description ? `<br><span style="color:#888">${escapeHtml(item.description)}</span>` : ""}</td>
        <td>${escapeHtml(item.category)}</td>
        ${backupCol ? `<td>${escapeHtml(item.worksheetName)}</td>` : ""}
        <td class="num">${item.quantity}</td>
        <td>${escapeHtml(item.uom)}</td>
        ${showCost ? `<td class="num">${formatMoney(item.cost)}</td>` : ""}
        ${showMarkup ? `<td class="num">${formatPct(item.markup)}</td>` : ""}
        <td class="num"><strong>${formatMoney(item.price)}</strong></td>
        <td class="num">${hours > 0 ? hours.toLocaleString() : ""}</td>
      </tr>`;
      return row;
    };

    const renderGroupHeader = (label: string, count: number) =>
      `<tr style="background:#f0f4ff"><td colspan="100%" style="font-weight:600;font-size:11px;color:${accent};padding:8px">${escapeHtml(label)} <span style="font-weight:400;color:#888">(${count} items)</span></td></tr>`;

    let result = `<h2>Line Items</h2><table>
      <thead><tr>
        <th>#</th><th>Item</th><th>Category</th>
        ${backupCol ? "<th>Worksheet</th>" : ""}
        <th class="num">Qty</th><th>UOM</th>
        ${showCost ? '<th class="num">Cost</th>' : ""}
        ${showMarkup ? '<th class="num">Markup</th>' : ""}
        <th class="num">Price</th><th class="num">Hours</th>
      </tr></thead><tbody>`;

    if (groupBy === "phase") {
      const groups = new Map<string, PdfDataPackage["lineItems"]>();
      for (const item of data.lineItems) {
        const key = item.phaseName || "Unphased";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(item);
      }
      for (const [phaseName, items] of groups) {
        result += renderGroupHeader(phaseName, items.length);
        for (const item of items) result += renderItemRow(item);
      }
    } else if (groupBy === "worksheet") {
      const groups = new Map<string, PdfDataPackage["lineItems"]>();
      for (const item of data.lineItems) {
        const key = item.worksheetName || "Default";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(item);
      }
      for (const [wsName, items] of groups) {
        result += renderGroupHeader(wsName, items.length);
        for (const item of items) result += renderItemRow(item);
      }
    } else {
      for (const item of data.lineItems) result += renderItemRow(item);
    }

    // Totals row
    const totalCost = data.lineItems.reduce((s, i) => s + i.cost, 0);
    const totalPrice = data.lineItems.reduce((s, i) => s + i.price, 0);
    const totalHrs = data.lineItems.reduce(
      (s, i) => s + i.laborHourReg + i.laborHourOver + i.laborHourDouble,
      0
    );
    const baseCols = backupCol ? 6 : 5;
    const skipCols = baseCols + (showCost ? 0 : -1) + (showMarkup ? 0 : -1);
    result += `<tr class="totals"><td colspan="${skipCols}">Total (${data.lineItems.length} items)</td>`;
    if (showCost) result += `<td class="num">${formatMoney(totalCost)}</td>`;
    if (showMarkup) result += `<td></td>`;
    result += `<td class="num">${formatMoney(totalPrice)}</td><td class="num">${totalHrs.toLocaleString()}</td></tr>`;
    result += `</tbody></table>`;
    return result;
  };

  const renderPhases = (): string => {
    if (data.phases.length === 0) return "";
    let result = `<h2>Phases</h2><table>
      <thead><tr><th>#</th><th>Phase</th><th>Description</th></tr></thead><tbody>`;
    for (const p of data.phases) {
      result += `<tr><td>${escapeHtml(p.number)}</td><td><strong>${escapeHtml(p.name)}</strong></td><td>${escapeHtml(p.description)}</td></tr>`;
    }
    result += `</tbody></table>`;
    return result;
  };

  const renderModifiers = (): string => {
    if (data.modifiers.length === 0) return "";
    let result = `<h2>Modifiers</h2><table><thead><tr><th>Name</th><th>Type</th><th>Applies To</th><th class="num">%</th><th class="num">Amount</th></tr></thead><tbody>`;
    for (const m of data.modifiers) {
      result += `<tr><td>${escapeHtml(m.name)}</td><td>${escapeHtml(m.type)}</td><td>${escapeHtml(m.appliesTo)}</td><td class="num">${m.percentage != null ? formatPct(m.percentage) : ""}</td><td class="num">${m.amount != null ? formatMoney(m.amount) : ""}</td></tr>`;
    }
    result += `</tbody></table>`;
    return result;
  };

  const renderConditions = (): string => {
    if (inclusions.length === 0 && exclusions.length === 0) return "";
    let result = `<h2>Terms & Conditions</h2><div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">`;
    if (inclusions.length > 0) {
      result += `<div><h3>Inclusions</h3><ul>${inclusions.map((c) => `<li>${escapeHtml(c.value)}</li>`).join("")}</ul></div>`;
    }
    if (exclusions.length > 0) {
      result += `<div><h3>Exclusions</h3><ul>${exclusions.map((c) => `<li>${escapeHtml(c.value)}</li>`).join("")}</ul></div>`;
    }
    result += `</div>`;
    return result;
  };

  const renderHoursSummary = (): string => {
    if (templateType === "closeout") return "";
    return `<h2>Hours Summary</h2>
      <table><thead><tr><th>Regular</th><th>Overtime (1.5x)</th><th>Double Time (2x)</th><th>Total</th></tr></thead>
      <tbody><tr>
        <td class="num">${data.lineItems.reduce((s, i) => s + i.laborHourReg * i.quantity, 0).toLocaleString()}</td>
        <td class="num">${data.lineItems.reduce((s, i) => s + i.laborHourOver * i.quantity, 0).toLocaleString()}</td>
        <td class="num">${data.lineItems.reduce((s, i) => s + i.laborHourDouble * i.quantity, 0).toLocaleString()}</td>
        <td class="num"><strong>${data.totalHours.toLocaleString()}</strong></td>
      </tr></tbody></table>`;
  };

  const renderLabourSummary = (): string => {
    // Group labour by phase and compute totals
    const phaseLabour = new Map<string, { reg: number; ot: number; dt: number; total: number; cost: number }>();
    for (const item of data.lineItems) {
      const key = item.phaseName || "Unphased";
      const existing = phaseLabour.get(key) ?? { reg: 0, ot: 0, dt: 0, total: 0, cost: 0 };
      const reg = item.laborHourReg * item.quantity;
      const ot = item.laborHourOver * item.quantity;
      const dt = item.laborHourDouble * item.quantity;
      existing.reg += reg;
      existing.ot += ot;
      existing.dt += dt;
      existing.total += reg + ot + dt;
      existing.cost += item.cost;
      phaseLabour.set(key, existing);
    }

    if (phaseLabour.size === 0) return "";

    let result = `<h2>Labour Summary</h2><table>
      <thead><tr><th>Phase</th><th class="num">Reg Hours</th><th class="num">OT Hours</th><th class="num">DT Hours</th><th class="num">Total Hours</th><th class="num">Rate</th><th class="num">Cost</th></tr></thead><tbody>`;

    let grandReg = 0, grandOt = 0, grandDt = 0, grandTotal = 0, grandCost = 0;
    for (const [phase, v] of phaseLabour) {
      const rate = v.total > 0 ? v.cost / v.total : 0;
      grandReg += v.reg;
      grandOt += v.ot;
      grandDt += v.dt;
      grandTotal += v.total;
      grandCost += v.cost;
      result += `<tr>
        <td>${escapeHtml(phase)}</td>
        <td class="num">${v.reg.toLocaleString()}</td>
        <td class="num">${v.ot.toLocaleString()}</td>
        <td class="num">${v.dt.toLocaleString()}</td>
        <td class="num"><strong>${v.total.toLocaleString()}</strong></td>
        <td class="num">${formatMoney(rate)}</td>
        <td class="num">${formatMoney(v.cost)}</td>
      </tr>`;
    }

    const grandRate = grandTotal > 0 ? grandCost / grandTotal : 0;
    result += `<tr class="totals">
      <td>Total</td>
      <td class="num">${grandReg.toLocaleString()}</td>
      <td class="num">${grandOt.toLocaleString()}</td>
      <td class="num">${grandDt.toLocaleString()}</td>
      <td class="num"><strong>${grandTotal.toLocaleString()}</strong></td>
      <td class="num">${formatMoney(grandRate)}</td>
      <td class="num">${formatMoney(grandCost)}</td>
    </tr>`;
    result += `</tbody></table>`;
    return result;
  };

  const renderNotes = (): string => {
    if (!data.notes) return "";
    return `<h2>Notes</h2><div class="section-body">${escapeHtml(data.notes)}</div>`;
  };

  const renderReportSections = (): string => {
    if (data.reportSections.length === 0) return "";
    let result = `<h2>Report</h2>`;
    const topLevel = data.reportSections
      .filter((s) => !s.parentSectionId)
      .sort((a, b) => a.order - b.order);
    const children = (parentId: string) =>
      data.reportSections
        .filter((s) => s.parentSectionId === parentId)
        .sort((a, b) => a.order - b.order);

    for (const section of topLevel) {
      result += renderReportSection(section);
      for (const child of children(section.id)) {
        result += `<div style="margin-left:24px;padding-left:16px;border-left:3px solid #e5e5e5">`;
        result += renderReportSection(child);
        result += `</div>`;
      }
    }
    return result;
  };

  // Section key to renderer map
  const sectionRenderers: Record<string, () => string> = {
    coverPage: renderCoverPage,
    scopeOfWork: renderScopeOfWork,
    leadLetter: renderLeadLetter,
    lineItems: renderLineItems,
    phases: renderPhases,
    modifiers: renderModifiers,
    conditions: renderConditions,
    hoursSummary: renderHoursSummary,
    labourSummary: renderLabourSummary,
    notes: renderNotes,
    reportSections: renderReportSections,
  };

  // --- Build HTML ---

  const pageSizeMap: Record<string, string> = { letter: "letter", a4: "A4", legal: "legal" };
  const pageSize = pageSizeMap[opts.pageSetup.pageSize] || "letter";
  const orientation = opts.pageSetup.orientation;

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  @page {
    size: ${pageSize} ${orientation};
    margin: 20mm 15mm;
    ${opts.headerFooter.showPageNumbers ? `@bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 9px; color: #999; }` : ""}
    ${opts.headerFooter.headerText ? `@top-center { content: "${opts.headerFooter.headerText}"; font-size: 9px; color: #666; }` : ""}
    ${opts.headerFooter.footerText ? `@bottom-center { content: "${opts.headerFooter.footerText}"; font-size: 9px; color: #666; }` : ""}
  }
  * { box-sizing: border-box; }
  body { font-family: ${fontStack}; color: #1a1a1a; margin: 0; padding: 40px; font-size: 12px; line-height: 1.6; }
  h1 { font-size: 24px; margin: 0 0 4px; color: #111; letter-spacing: -0.02em; }
  h2 { font-size: 15px; margin: 28px 0 10px; border-bottom: 2px solid ${accent}; padding-bottom: 6px; color: #111; text-transform: uppercase; letter-spacing: 0.04em; }
  h3 { font-size: 13px; margin: 16px 0 4px; color: #333; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th, td { padding: 7px 10px; text-align: left; border-bottom: 1px solid #e5e5e5; font-size: 11px; }
  th { background: ${headerBg}; color: #fff; font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #e5e5e5; }
  .meta { color: #666; font-size: 11px; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 4px; font-size: 10px; font-weight: 600; background: ${accent}18; color: ${accent}; }
  .totals { background: #f5f5f5; font-weight: 600; }
  .section-body { color: #444; line-height: 1.7; margin-bottom: 8px; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
  .summary-card { background: #fff; border: 1px solid #e5e5e5; border-left: 3px solid ${accent}; border-radius: 6px; padding: 14px 16px; }
  .summary-card .label { font-size: 10px; text-transform: uppercase; color: #888; letter-spacing: 0.05em; }
  .summary-card .value { font-size: 20px; font-weight: 700; margin-top: 4px; color: #111; }
  .conditions li { margin-bottom: 4px; }

  /* Cover page */
  .cover-page { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 85vh; text-align: center; page-break-after: always; }
  .cover-company { font-size: 14px; text-transform: uppercase; letter-spacing: 0.15em; color: ${accent}; font-weight: 600; margin-bottom: 4px; }
  .cover-tagline { font-size: 12px; color: #888; margin-bottom: 24px; }
  .cover-divider { width: 60px; height: 3px; background: ${accent}; margin: 16px auto 24px; border-radius: 2px; }
  .cover-title { font-size: 32px; font-weight: 700; color: #111; margin-bottom: 16px; letter-spacing: -0.02em; line-height: 1.2; }
  .cover-meta { font-size: 14px; color: #555; margin-bottom: 4px; }
  .cover-details { display: flex; gap: 12px; align-items: center; font-size: 12px; color: #888; margin-top: 24px; }

  /* Header/footer bars */
  .html-header { background: ${headerBg}; color: #fff; padding: 8px 20px; font-size: 10px; display: flex; justify-content: space-between; align-items: center; margin: -40px -40px 24px; }
  .html-footer { margin: 32px -40px -40px; padding: 12px 20px; background: #f5f5f5; border-top: 2px solid #e5e5e5; font-size: 10px; color: #666; display: flex; justify-content: space-between; align-items: center; }

  @media print { body { margin: 0; padding: 20px; } .html-header, .html-footer { margin: 0; } }
</style></head><body>`;

  // HTML header bar
  if (opts.headerFooter.showHeader && opts.headerFooter.headerText) {
    html += `<div class="html-header"><span>${escapeHtml(opts.headerFooter.headerText)}</span><span>${escapeHtml(data.quoteNumber)}</span></div>`;
  }

  // Render ordered sections
  for (const sectionKey of opts.sectionOrder) {
    const sectionFlag = (opts.sections as Record<string, boolean>)[sectionKey];
    if (sectionFlag === false) continue;

    const renderer = sectionRenderers[sectionKey];
    if (!renderer) continue;

    const sectionHtml = renderer();
    if (!sectionHtml) continue;

    html += sectionHtml;

    // After cover page, add the header info block
    if (sectionKey === "coverPage") {
      // Header and summary cards follow the cover page
      html += `<div class="header">
        <div>
          <h1>${escapeHtml(data.title || data.quoteNumber)}</h1>
          <div class="meta">${escapeHtml(data.clientName)} &middot; ${escapeHtml(data.location)}</div>
          <div class="meta">Quote ${escapeHtml(data.quoteNumber)} &middot; Revision ${data.revisionNumber}</div>
        </div>
        <div style="text-align:right">
          <span class="badge">${escapeHtml(data.type)}</span>
          ${data.dateQuote ? `<div class="meta" style="margin-top:4px">Date: ${escapeHtml(data.dateQuote)}</div>` : ""}
          ${data.dateDue ? `<div class="meta">Due: ${escapeHtml(data.dateDue)}</div>` : ""}
        </div>
      </div>`;
      html += `<div class="summary-grid">
        <div class="summary-card"><div class="label">Subtotal</div><div class="value">${formatMoney(data.subtotal)}</div></div>
        <div class="summary-card"><div class="label">Cost</div><div class="value">${formatMoney(data.cost)}</div></div>
        <div class="summary-card"><div class="label">Profit</div><div class="value">${formatMoney(data.estimatedProfit)}</div></div>
        <div class="summary-card"><div class="label">Margin</div><div class="value">${formatPct(data.estimatedMargin)}</div></div>
      </div>`;
    }
  }

  // If cover page was not rendered, still show header and summary at the top
  if (!opts.sections.coverPage || !opts.sectionOrder.includes("coverPage")) {
    // Prepend header after <body> opening. We need to insert it.
    // Since cover page was skipped, render header block at current position
    // Actually, let's build it properly — we already have the html accumulating,
    // so we insert after the <body> tag by rebuilding.
    const bodyTag = "</head><body>";
    const bodyIdx = html.indexOf(bodyTag);
    if (bodyIdx !== -1) {
      const afterBody = bodyIdx + bodyTag.length;
      const headerBlock = (opts.headerFooter.showHeader && opts.headerFooter.headerText
        ? `<div class="html-header"><span>${escapeHtml(opts.headerFooter.headerText)}</span><span>${escapeHtml(data.quoteNumber)}</span></div>`
        : "") +
        `<div class="header">
          <div>
            <h1>${escapeHtml(data.title || data.quoteNumber)}</h1>
            <div class="meta">${escapeHtml(data.clientName)} &middot; ${escapeHtml(data.location)}</div>
            <div class="meta">Quote ${escapeHtml(data.quoteNumber)} &middot; Revision ${data.revisionNumber}</div>
          </div>
          <div style="text-align:right">
            <span class="badge">${escapeHtml(data.type)}</span>
            ${data.dateQuote ? `<div class="meta" style="margin-top:4px">Date: ${escapeHtml(data.dateQuote)}</div>` : ""}
            ${data.dateDue ? `<div class="meta">Due: ${escapeHtml(data.dateDue)}</div>` : ""}
          </div>
        </div>
        <div class="summary-grid">
          <div class="summary-card"><div class="label">Subtotal</div><div class="value">${formatMoney(data.subtotal)}</div></div>
          <div class="summary-card"><div class="label">Cost</div><div class="value">${formatMoney(data.cost)}</div></div>
          <div class="summary-card"><div class="label">Profit</div><div class="value">${formatMoney(data.estimatedProfit)}</div></div>
          <div class="summary-card"><div class="label">Margin</div><div class="value">${formatPct(data.estimatedMargin)}</div></div>
        </div>`;
      html = html.slice(0, afterBody) + headerBlock + html.slice(afterBody);
    }
  }

  // Custom sections
  if (opts.customSections.length > 0) {
    const sorted = [...opts.customSections].sort((a, b) => a.order - b.order);
    for (const cs of sorted) {
      html += `<h2>${escapeHtml(cs.title)}</h2><div class="section-body">${cs.content}</div>`;
    }
  }

  // HTML footer bar
  if (opts.headerFooter.showFooter) {
    const footerText = opts.headerFooter.footerText || "Generated by Bidwright";
    html += `<div class="html-footer"><span>${escapeHtml(footerText)}</span><span>${new Date().toLocaleDateString()}</span></div>`;
  }

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
export async function generatePdfBuffer(
  html: string,
  layoutOptions?: Partial<PdfLayoutOptions>
): Promise<{ buffer: Buffer; contentType: string }> {
  const defaults = getDefaultPdfLayoutOptions();
  const opts = layoutOptions ? deepMerge(defaults, layoutOptions) : defaults;

  const formatMap: Record<string, string> = { letter: "Letter", a4: "A4", legal: "Legal" };
  const format = formatMap[opts.pageSetup.pageSize] || "Letter";
  const landscape = opts.pageSetup.orientation === "landscape";

  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdfBuffer = await page.pdf({
      format: format as any,
      landscape,
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
