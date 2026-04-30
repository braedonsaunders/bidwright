export interface PdfDataPackage {
  quoteNumber: string;
  revisionNumber: number;
  title: string;
  description: string;
  orgName: string;
  orgLogoUrl: string;
  orgWebsite: string;
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
    unit1: number;
    unit2: number;
    unit3: number;
    vendor: string;
    description: string;
    phaseName?: string;
    worksheetName: string;
  }>;
  phases: Array<{ number: string; name: string; description: string }>;
  adjustments: Array<{
    name: string;
    kind: string;
    pricingMode: string;
    type: string;
    description: string;
    appliesTo: string;
    percentage: number | null;
    amount: number | null;
    show: string;
  }>;
  summaryBuilder?: {
    mode: "total" | "grouped" | "pivot";
    rowDimension: "none" | "phase" | "category" | "worksheet";
    columnDimension: "none" | "phase" | "category" | "worksheet";
    rows: Array<{ key: string; sourceId: string | null; label: string; visible: boolean; order: number }>;
    columns: Array<{ key: string; sourceId: string | null; label: string; visible: boolean; order: number }>;
    totals: { label: string; visible: boolean };
  } | null;
  summaryTotals?: {
    categoryTotals: Array<{ id: string; label: string; value: number; cost: number; margin: number }>;
    phaseTotals: Array<{ id: string; label: string; value: number; cost: number; margin: number }>;
    phaseCategoryTotals: Array<{ id: string; phaseId?: string | null; label: string; value: number; cost: number; margin: number }>;
    worksheetTotals?: Array<{ id: string; label: string; value: number; cost: number; margin: number }>;
    worksheetCategoryTotals?: Array<{ id: string; label: string; value: number; cost: number; margin: number }>;
    worksheetPhaseTotals?: Array<{ id: string; phaseId?: string | null; label: string; value: number; cost: number; margin: number }>;
    adjustmentTotals: Array<{ id: string; label: string; show: string; value: number; cost: number; margin: number }>;
  };
  summaryRows: Array<{
    id: string;
    type: string;
    label: string;
    order: number;
    visible: boolean;
    style: string;
    computedValue: number;
    computedCost: number;
    computedMargin: number;
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
  orgTermsAndConditions: string;
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
    pricingSummary: boolean;
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
    showLogo: boolean;
    backgroundStyle: "minimal" | "accent" | "grid";
  };
  // Header/footer
  headerFooter: {
    showHeader: boolean;
    showFooter: boolean;
    showPageNumbers: boolean;
  };
  // Customer-facing mode: hides cost, markup, margin, and profit everywhere
  customerFacing: boolean;
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
      phases: false,
      modifiers: true,
      conditions: true,
      pricingSummary: true,
      hoursSummary: false,
      labourSummary: false,
      notes: true,
      reportSections: true,
    },
    sectionOrder: [
      "coverPage", "scopeOfWork", "notes", "leadLetter", "lineItems", "phases",
      "modifiers", "conditions", "hoursSummary", "labourSummary", "reportSections", "pricingSummary",
    ],
    lineItemOptions: {
      showCostColumn: true,
      showMarkupColumn: true,
      groupBy: "worksheet",
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
      showLogo: true,
      backgroundStyle: "accent",
    },
    headerFooter: {
      showHeader: true,
      showFooter: true,
      showPageNumbers: true,
    },
    customerFacing: true,
    customSections: [],
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge<T extends Record<string, any>>(base: T, overrides: Partial<T> | Record<string, unknown>): T {
  const result = { ...base };
  for (const [rawKey, val] of Object.entries(overrides ?? {})) {
    if (!(rawKey in base) || val === undefined) continue;
    const key = rawKey as keyof T;
    const baseValue = base[key];
    if (isPlainObject(baseValue) && isPlainObject(val)) {
      result[key] = deepMerge(baseValue as Record<string, any>, val) as T[keyof T];
    } else {
      result[key] = val as T[keyof T];
    }
  }
  return result;
}

export function buildPdfDataPackage(
  workspace: any,
  reportSections: any[] = [],
  organization: {
    termsAndConditions?: string;
    companyName?: string;
    logoUrl?: string;
    website?: string;
  } = {},
): PdfDataPackage {
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
    orgName: organization.companyName ?? "",
    orgLogoUrl: organization.logoUrl ?? "",
    orgWebsite: organization.website ?? "",
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
    summaryBuilder: workspace.summaryBuilder ?? null,
    summaryTotals: {
      categoryTotals: workspace.estimate?.totals?.categoryTotals ?? [],
      phaseTotals: workspace.estimate?.totals?.phaseTotals ?? [],
      phaseCategoryTotals: workspace.estimate?.totals?.phaseCategoryTotals ?? [],
      worksheetTotals: workspace.estimate?.totals?.worksheetTotals ?? [],
      worksheetCategoryTotals: workspace.estimate?.totals?.worksheetCategoryTotals ?? [],
      worksheetPhaseTotals: workspace.estimate?.totals?.worksheetPhaseTotals ?? [],
      adjustmentTotals: workspace.estimate?.totals?.adjustmentTotals ?? [],
    },
    summaryRows: (workspace.summaryRows ?? []).map((r: any) => ({
      id: r.id,
      type: r.type,
      label: r.label,
      order: r.order,
      visible: r.visible,
      style: r.style ?? "normal",
      computedValue: r.computedValue ?? 0,
      computedCost: r.computedCost ?? 0,
      computedMargin: r.computedMargin ?? 0,
    })),
    adjustments: workspace.adjustments ?? [],
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
    orgTermsAndConditions: organization.termsAndConditions ?? "",
  };
}

const ROW_TYPE_LABELS: Record<string, string> = {
  category: "Category",
  phase: "Phase",
  adjustment: "Adjustment",
  heading: "Heading",
  subtotal: "Subtotal",
  separator: "",
};

const FONT_STACKS: Record<PdfLayoutOptions["branding"]["fontFamily"], string> = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: '"Georgia", "Times New Roman", serif',
  mono: '"SF Mono", "Fira Code", monospace',
};

const PDF_PAGE_MARGINS_MM = {
  top: 12,
  right: 10,
  bottom: 12,
  left: 10,
} as const;

const PDF_BODY_PADDING_PX = 24;

const CUSTOM_SECTION_PREFIX = "custom:";

function getCustomSectionId(sectionKey: string) {
  return sectionKey.startsWith(CUSTOM_SECTION_PREFIX)
    ? sectionKey.slice(CUSTOM_SECTION_PREFIX.length)
    : null;
}

function insertCustomSectionBeforePricing(order: string[], key: string) {
  const pricingIndex = order.indexOf("pricingSummary");
  if (pricingIndex === -1) order.push(key);
  else order.splice(pricingIndex, 0, key);
}

export function generatePdfHtml(
  data: PdfDataPackage,
  templateType: string,
  options?: Partial<PdfLayoutOptions>
): string {
  const defaults = getDefaultPdfLayoutOptions();
  const opts: PdfLayoutOptions = options ? deepMerge(defaults, options) : defaults;

  // Ensure any new section keys present in defaults are added to sectionOrder
  for (const key of defaults.sectionOrder) {
    if (!opts.sectionOrder.includes(key)) {
      // Insert at the default position
      const defaultIdx = defaults.sectionOrder.indexOf(key);
      const insertAt = Math.min(defaultIdx, opts.sectionOrder.length);
      opts.sectionOrder.splice(insertAt, 0, key);
    }
  }

  for (const customSection of opts.customSections) {
    const sectionKey = `${CUSTOM_SECTION_PREFIX}${customSection.id}`;
    if (!opts.sectionOrder.includes(sectionKey)) {
      insertCustomSectionBeforePricing(opts.sectionOrder, sectionKey);
    }
  }

  const fontStack = FONT_STACKS[opts.branding.fontFamily];
  const accent = opts.branding.accentColor;
  const headerBg = opts.branding.headerBgColor;
  const headerText = data.orgName || "Proposal";
  const footerText = data.orgWebsite || data.orgName || data.quoteNumber;

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
    const companyName = data.orgName || "Proposal";
    const logoUrl = opts.coverPageOptions.showLogo ? data.orgLogoUrl : "";
    const coverStyleClass = opts.coverPageOptions.backgroundStyle === "grid"
      ? "cover-grid"
      : opts.coverPageOptions.backgroundStyle === "accent"
        ? "cover-accent"
        : "cover-minimal";
    const dateStr = data.dateQuote
      ? new Date(data.dateQuote).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
      : new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    let coverHtml = `<div class="cover-page ${coverStyleClass}"><div class="cover-page-inner">`;
    coverHtml += `<div class="cover-top">`;
    if (logoUrl) {
      coverHtml += `<img class="cover-logo" src="${escapeHtml(logoUrl)}" alt="Logo" />`;
    }
    coverHtml += `<div class="cover-company">${escapeHtml(companyName)}</div>`;
    coverHtml += `</div>`;
    coverHtml += `<div class="cover-body">`;
    coverHtml += `<div class="cover-divider"></div>`;
    coverHtml += `<div class="cover-title">${escapeHtml(data.title || data.quoteNumber)}</div>`;
    coverHtml += `<div class="cover-meta">Prepared for <strong>${escapeHtml(data.clientName)}</strong></div>`;
    coverHtml += `<div class="cover-meta">${escapeHtml(data.location)}</div>`;
    coverHtml += `</div>`;
    coverHtml += `<div class="cover-details">`;
    coverHtml += `<span class="cover-detail">Quote ${escapeHtml(data.quoteNumber)}</span>`;
    coverHtml += `<span class="cover-detail">Revision ${data.revisionNumber}</span>`;
    coverHtml += `<span class="cover-detail">${dateStr}</span>`;
    coverHtml += `</div>`;
    coverHtml += `</div>`;
    coverHtml += `</div>`;
    return coverHtml;
  };

  const renderScopeOfWork = (): string => {
    if (!data.description) return "";
    // Description may contain HTML from the rich text editor — render as-is
    return `<h2>Scope of Work</h2><div class="section-body">${data.description}</div>`;
  };

  const renderLeadLetter = (): string => {
    if (templateType !== "main" || !data.leadLetter) return "";
    // Lead letter may contain HTML from the rich text editor — render as-is
    return `<h2>Lead Letter</h2><div class="section-body">${data.leadLetter}</div>`;
  };

  const renderPricingSummary = (): string => {
    const showCost = !opts.customerFacing;
    const builder = data.summaryBuilder;
    const summaryTotals = data.summaryTotals;

    if (builder && summaryTotals) {
      const axisTotal = (dimension: "none" | "phase" | "category" | "worksheet", sourceId: string | null) => {
        if (!sourceId) return null;
        if (dimension === "phase") return summaryTotals.phaseTotals.find((entry) => entry.id === sourceId) ?? null;
        if (dimension === "category") return summaryTotals.categoryTotals.find((entry) => entry.id === sourceId) ?? null;
        if (dimension === "worksheet") return (summaryTotals.worksheetTotals ?? []).find((entry) => entry.id === sourceId) ?? null;
        return null;
      };
      const adjustmentTotals = summaryTotals.adjustmentTotals.filter((entry) => entry.show !== "No");

      if (builder.mode === "pivot") {
        const rows = [...builder.rows].filter((row) => row.visible).sort((a, b) => a.order - b.order);
        const columns = [...builder.columns].filter((column) => column.visible).sort((a, b) => a.order - b.order);
        if (rows.length === 0 || columns.length === 0) {
          return "";
        }

        const resolveCell = (rowSourceId: string | null, columnSourceId: string | null) => {
          const empty = { value: 0, cost: 0, margin: 0 };
          const dims = [builder.rowDimension, builder.columnDimension];
          if (dims.includes("worksheet") && dims.includes("category")) {
            const worksheetId = builder.rowDimension === "worksheet" ? rowSourceId : columnSourceId;
            const categoryId = builder.rowDimension === "category" ? rowSourceId : columnSourceId;
            return (summaryTotals.worksheetCategoryTotals ?? []).find((entry) => entry.id === `${worksheetId}::${categoryId ?? ""}`) ?? empty;
          }
          if (dims.includes("worksheet") && dims.includes("phase")) {
            const worksheetId = builder.rowDimension === "worksheet" ? rowSourceId : columnSourceId;
            const phaseId = builder.rowDimension === "phase" ? rowSourceId : columnSourceId;
            return (summaryTotals.worksheetPhaseTotals ?? []).find((entry) => entry.id === `${worksheetId}::${phaseId ?? "__unphased__"}`) ?? empty;
          }
          const phaseId = builder.rowDimension === "phase" ? rowSourceId : columnSourceId;
          const categoryId = builder.rowDimension === "category" ? rowSourceId : columnSourceId;
          const key = `${phaseId ?? "__unphased__"}::${categoryId ?? ""}`;
          return summaryTotals.phaseCategoryTotals.find((entry) => entry.id === key) ?? empty;
        };

        const dimensionLabel = (d: typeof builder.rowDimension) => d === "phase" ? "Phase" : d === "category" ? "Category" : d === "worksheet" ? "Worksheet" : "";
        let result = `<h2>Pricing Summary</h2><table><thead><tr><th style="text-align:left">${escapeHtml(dimensionLabel(builder.rowDimension))}</th>`;
        for (const column of columns) {
          result += `<th class="num">${escapeHtml(column.label)}</th>`;
        }
        result += `${showCost ? `<th class="num">Cost</th>` : ""}<th class="num">Amount</th></tr></thead><tbody>`;

        for (const row of rows) {
          const total = axisTotal(builder.rowDimension, row.sourceId);
          result += `<tr><td>${escapeHtml(row.label)}</td>`;
          for (const column of columns) {
            result += `<td class="num">${formatMoney(resolveCell(row.sourceId, column.sourceId).value)}</td>`;
          }
          if (showCost) {
            result += `<td class="num">${formatMoney(total?.cost ?? 0)}</td>`;
          }
          result += `<td class="num">${formatMoney(total?.value ?? 0)}</td></tr>`;
        }

        for (const adjustment of adjustmentTotals) {
          result += `<tr><td colspan="${columns.length + (showCost ? 1 : 0) + 1}" style="text-align:left">${escapeHtml(adjustment.label)}</td><td class="num">${formatMoney(adjustment.value)}</td></tr>`;
        }

        if (builder.totals.visible) {
          result += `<tr style="font-weight:700;border-top:2px solid #333"><td>${escapeHtml(builder.totals.label)}</td>`;
          for (const column of columns) {
            const total = axisTotal(builder.columnDimension, column.sourceId);
            result += `<td class="num">${formatMoney(total?.value ?? 0)}</td>`;
          }
          if (showCost) {
            result += `<td class="num">${formatMoney(data.cost)}</td>`;
          }
          result += `<td class="num">${formatMoney(data.subtotal)}</td></tr>`;
        }

        result += `</tbody></table>`;
        return result;
      }

      if (builder.mode === "grouped") {
        const rows = [...builder.rows].filter((row) => row.visible).sort((a, b) => a.order - b.order);
        let result = `<h2>Pricing Summary</h2><table><thead><tr><th style="text-align:left">Description</th>${showCost ? `<th class="num">Cost</th>` : ""}<th class="num">Amount</th></tr></thead><tbody>`;

        for (const row of rows) {
          const total = axisTotal(builder.rowDimension, row.sourceId);
          result += `<tr><td>${escapeHtml(row.label)}</td>${showCost ? `<td class="num">${formatMoney(total?.cost ?? 0)}</td>` : ""}<td class="num">${formatMoney(total?.value ?? 0)}</td></tr>`;
        }

        for (const adjustment of adjustmentTotals) {
          result += `<tr><td>${escapeHtml(adjustment.label)}</td>${showCost ? `<td class="num">${formatMoney(adjustment.cost)}</td>` : ""}<td class="num">${formatMoney(adjustment.value)}</td></tr>`;
        }

        if (builder.totals.visible) {
          result += `<tr style="font-weight:700;border-top:2px solid #333"><td>${escapeHtml(builder.totals.label)}</td>${showCost ? `<td class="num">${formatMoney(data.cost)}</td>` : ""}<td class="num">${formatMoney(data.subtotal)}</td></tr>`;
        }

        result += `</tbody></table>`;
        return result;
      }

      if (builder.mode === "total") {
        return `<h2>Pricing Summary</h2><table><thead><tr><th style="text-align:left">Description</th>${showCost ? `<th class="num">Cost</th>` : ""}<th class="num">Amount</th></tr></thead><tbody><tr style="font-weight:700"><td>${escapeHtml(builder.totals.label)}</td>${showCost ? `<td class="num">${formatMoney(data.cost)}</td>` : ""}<td class="num">${formatMoney(data.subtotal)}</td></tr></tbody></table>`;
      }
    }

    const visibleRows = data.summaryRows.filter((r) => r.visible).sort((a, b) => a.order - b.order);
    if (visibleRows.length === 0) return "";

    const colCount = showCost ? 3 : 2;
    let result = `<h2>Pricing Summary</h2><table><thead><tr><th style="text-align:left">Description</th>${showCost ? `<th class="num">Cost</th>` : ""}<th class="num">Amount</th></tr></thead><tbody>`;

    for (const row of visibleRows) {
      if (row.type === "separator") {
        result += `<tr><td colspan="${colCount}" style="border:none;height:8px"></td></tr>`;
        continue;
      }
      const isSubtotal = row.type === "subtotal";
      const style = row.style === "highlight"
        ? `background:#f0f4ff;font-weight:600`
        : isSubtotal ? `font-weight:700;border-top:2px solid #333` : "";
      result += `<tr${style ? ` style="${style}"` : ""}>
        <td>${isSubtotal ? `<strong>${escapeHtml(row.label)}</strong>` : escapeHtml(row.label)}</td>
        ${showCost ? `<td class="num">${formatMoney(row.computedCost)}</td>` : ""}
        <td class="num">${isSubtotal ? `<strong>${formatMoney(row.computedValue)}</strong>` : formatMoney(row.computedValue)}</td>
      </tr>`;
    }
    result += `</tbody></table>`;

    return result;
  };

  const renderLineItems = (): string => {
    if (templateType === "closeout") return "";

    const backupCol = templateType === "backup";
    const showCost = opts.customerFacing ? false : opts.lineItemOptions.showCostColumn;
    const showMarkup = opts.customerFacing ? false : opts.lineItemOptions.showMarkupColumn;
    const groupBy = opts.lineItemOptions.groupBy;
    const showWorksheetColumn = backupCol && groupBy !== "worksheet";
    const descriptorColumnCount = showWorksheetColumn ? 6 : 5;
    const getItemHours = (item: PdfDataPackage["lineItems"][0]) => item.unit1 + item.unit2 + item.unit3;

    const renderItemRow = (item: PdfDataPackage["lineItems"][0]) => {
      const hours = getItemHours(item);
      let row = `<tr>
        <td>${item.lineOrder}</td>
        <td><strong>${escapeHtml(item.entityName)}</strong>${item.description ? `<br><span style="color:#888">${escapeHtml(item.description)}</span>` : ""}</td>
        <td>${escapeHtml(item.category)}</td>
        ${showWorksheetColumn ? `<td>${escapeHtml(item.worksheetName)}</td>` : ""}
        <td class="num">${item.quantity}</td>
        <td>${escapeHtml(item.uom)}</td>
        ${showCost ? `<td class="num">${formatMoney(item.cost)}</td>` : ""}
        ${showMarkup ? `<td class="num">${formatPct(item.markup)}</td>` : ""}
        <td class="num">${hours > 0 ? hours.toLocaleString() : ""}</td>
        <td class="num"><strong>${formatMoney(item.price)}</strong></td>
      </tr>`;
      return row;
    };

    const renderTotalsRow = (items: PdfDataPackage["lineItems"], label = `Total (${items.length} items)`) => {
      const totalCost = items.reduce((sum, item) => sum + item.cost, 0);
      const totalPrice = items.reduce((sum, item) => sum + item.price, 0);
      const totalHrs = items.reduce((sum, item) => sum + getItemHours(item), 0);
      let row = `<tr class="totals"><td colspan="${descriptorColumnCount}">${escapeHtml(label)}</td>`;
      if (showCost) row += `<td class="num">${formatMoney(totalCost)}</td>`;
      if (showMarkup) row += `<td></td>`;
      row += `<td class="num">${totalHrs.toLocaleString()}</td><td class="num">${formatMoney(totalPrice)}</td></tr>`;
      return row;
    };

    const renderTable = (items: PdfDataPackage["lineItems"], label?: string) => {
      let table = label
        ? `<div class="line-item-group"><h3 class="line-item-group-title">${escapeHtml(label)}</h3><div class="line-item-group-meta">${items.length} items</div>`
        : "";
      table += `<table>
        <thead><tr>
          <th>#</th><th>Item</th><th>Category</th>
          ${showWorksheetColumn ? "<th>Worksheet</th>" : ""}
          <th class="num">Qty</th><th>UOM</th>
          ${showCost ? '<th class="num">Cost</th>' : ""}
          ${showMarkup ? '<th class="num">Markup</th>' : ""}
          <th class="num">Hours</th><th class="num">Price</th>
        </tr></thead><tbody>`;
      for (const item of items) table += renderItemRow(item);
      table += renderTotalsRow(items);
      table += `</tbody></table>`;
      if (label) table += `</div>`;
      return table;
    };

    let result = `<h2>Line Items</h2>`;

    if (groupBy === "none") {
      result += renderTable(data.lineItems);
      return result;
    }

    const groups = new Map<string, PdfDataPackage["lineItems"]>();
    for (const item of data.lineItems) {
      const key = groupBy === "phase"
        ? item.phaseName || "Unphased"
        : item.worksheetName || "Default";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }

    for (const [label, items] of groups) {
      result += renderTable(items, label);
    }

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

  const renderAdjustments = (): string => {
    const visibleAdjustments = data.adjustments.filter((adjustment) => adjustment.show !== "No");
    if (visibleAdjustments.length === 0) return "";
    let result = `<h2>Adjustments</h2><table><thead><tr><th>Name</th><th>Mode</th><th>Applies To</th><th class="num">%</th><th class="num">Amount</th></tr></thead><tbody>`;
    for (const adjustment of visibleAdjustments) {
      result += `<tr><td>${escapeHtml(adjustment.name)}</td><td>${escapeHtml(adjustment.type || adjustment.pricingMode)}</td><td>${escapeHtml(adjustment.appliesTo)}</td><td class="num">${adjustment.percentage != null ? formatPct(adjustment.percentage) : ""}</td><td class="num">${adjustment.amount != null ? formatMoney(adjustment.amount) : ""}</td></tr>`;
    }
    result += `</tbody></table>`;
    return result;
  };

  const renderConditions = (): string => {
    const hasConditions = inclusions.length > 0 || exclusions.length > 0;
    const hasOrgTerms = !!data.orgTermsAndConditions?.trim();
    if (!hasConditions && !hasOrgTerms) return "";
    let result = `<h2>Conditions</h2>`;
    if (hasConditions) {
      result += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">`;
      if (inclusions.length > 0) {
        result += `<div><h3>Inclusions</h3><ul>${inclusions.map((c) => `<li>${escapeHtml(c.value)}</li>`).join("")}</ul></div>`;
      }
      if (exclusions.length > 0) {
        result += `<div><h3>Exclusions</h3><ul>${exclusions.map((c) => `<li>${escapeHtml(c.value)}</li>`).join("")}</ul></div>`;
      }
      result += `</div>`;
    }
    if (hasOrgTerms) {
      result += `<div class="section-body" style="margin-top:16px;white-space:pre-wrap">${escapeHtml(data.orgTermsAndConditions)}</div>`;
    }
    return result;
  };

  const renderHoursSummary = (): string => {
    if (templateType === "closeout") return "";
    return `<h2>Hours Summary</h2>
      <table><thead><tr><th>Regular</th><th>Overtime (1.5x)</th><th>Double Time (2x)</th><th>Total</th></tr></thead>
      <tbody><tr>
        <td class="num">${data.lineItems.reduce((s, i) => s + i.unit1 * i.quantity, 0).toLocaleString()}</td>
        <td class="num">${data.lineItems.reduce((s, i) => s + i.unit2 * i.quantity, 0).toLocaleString()}</td>
        <td class="num">${data.lineItems.reduce((s, i) => s + i.unit3 * i.quantity, 0).toLocaleString()}</td>
        <td class="num"><strong>${data.totalHours.toLocaleString()}</strong></td>
      </tr></tbody></table>`;
  };

  const renderLabourSummary = (): string => {
    if (opts.customerFacing) return "";
    // Group labour by phase and compute totals
    const phaseLabour = new Map<string, { reg: number; ot: number; dt: number; total: number; cost: number }>();
    for (const item of data.lineItems) {
      const key = item.phaseName || "Unphased";
      const existing = phaseLabour.get(key) ?? { reg: 0, ot: 0, dt: 0, total: 0, cost: 0 };
      const reg = item.unit1 * item.quantity;
      const ot = item.unit2 * item.quantity;
      const dt = item.unit3 * item.quantity;
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
      const kids = children(section.id);
      if (kids.length > 0) {
        result += `<div class="report-nested">`;
        for (const child of kids) {
          result += renderReportSection(child);
        }
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
    pricingSummary: renderPricingSummary,
    lineItems: renderLineItems,
    phases: renderPhases,
    modifiers: renderAdjustments,
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
  const hasCoverPage = opts.sections.coverPage && opts.sectionOrder.includes("coverPage");
  const pageDimensionsMm: Record<PdfLayoutOptions["pageSetup"]["pageSize"], { width: number; height: number }> = {
    letter: { width: 215.9, height: 279.4 },
    a4: { width: 210, height: 297 },
    legal: { width: 215.9, height: 355.6 },
  };
  const pageDimensions = pageDimensionsMm[opts.pageSetup.pageSize] ?? pageDimensionsMm.letter;
  const sheetHeightMm = orientation === "landscape" ? pageDimensions.width : pageDimensions.height;
  const coverMinHeight = `${Math.max(sheetHeightMm - PDF_PAGE_MARGINS_MM.top - PDF_PAGE_MARGINS_MM.bottom, 140)}mm`;

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  @page {
    size: ${pageSize} ${orientation};
    margin: ${PDF_PAGE_MARGINS_MM.top}mm ${PDF_PAGE_MARGINS_MM.right}mm ${PDF_PAGE_MARGINS_MM.bottom}mm ${PDF_PAGE_MARGINS_MM.left}mm;
    ${opts.headerFooter.showPageNumbers ? `@bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 9px; color: #999; }` : ""}
    ${opts.headerFooter.showHeader && headerText ? `@top-center { content: "${escapeForCssContent(headerText)}"; font-size: 9px; color: #666; }` : ""}
    ${opts.headerFooter.showFooter && footerText ? `@bottom-center { content: "${escapeForCssContent(footerText)}"; font-size: 9px; color: #666; }` : ""}
  }
  ${hasCoverPage ? `@page :first {
    ${opts.headerFooter.showPageNumbers ? `@bottom-right { content: ""; }` : ""}
    ${opts.headerFooter.showHeader && headerText ? `@top-center { content: ""; }` : ""}
    ${opts.headerFooter.showFooter && footerText ? `@bottom-center { content: ""; }` : ""}
  }` : ""}
  * { box-sizing: border-box; }
  body { font-family: ${fontStack}; color: #1a1a1a; margin: 0; padding: ${PDF_BODY_PADDING_PX}px; font-size: 12px; line-height: 1.6; }
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
  .line-item-group { margin: 18px 0 24px; page-break-inside: avoid; }
  .line-item-group-title { margin: 0 0 2px; color: #111; }
  .line-item-group-meta { margin-bottom: 8px; font-size: 10px; letter-spacing: 0.04em; text-transform: uppercase; color: #666; }
  .section-body { color: #444; line-height: 1.7; margin-bottom: 8px; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
  .summary-card { background: #fff; border: 1px solid #e5e5e5; border-left: 3px solid ${accent}; border-radius: 6px; padding: 14px 16px; }
  .summary-card .label { font-size: 10px; text-transform: uppercase; color: #888; letter-spacing: 0.05em; }
  .summary-card .value { font-size: 20px; font-weight: 700; margin-top: 4px; color: #111; }
  .conditions li { margin-bottom: 4px; }

  /* Cover page */
  .cover-page { margin: -${PDF_BODY_PADDING_PX}px -${PDF_BODY_PADDING_PX}px -${PDF_BODY_PADDING_PX}px; page-break-after: always; overflow: hidden; }
  .cover-page-inner { min-height: ${coverMinHeight}; padding: 30px ${PDF_BODY_PADDING_PX}px 36px; display: flex; flex-direction: column; align-items: center; text-align: center; }
  .cover-page.cover-accent { background: linear-gradient(155deg, ${accent}28 0%, ${accent}08 38%, transparent 58%), linear-gradient(320deg, ${headerBg}18 0%, transparent 46%), linear-gradient(180deg, #ffffff 0%, #f8fafc 100%); }
  .cover-page.cover-grid { background-color: #f8fafc; background-image: linear-gradient(to right, rgba(148, 163, 184, 0.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(148, 163, 184, 0.18) 1px, transparent 1px), radial-gradient(circle at top right, ${accent}18 0%, transparent 34%); background-size: 24px 24px, 24px 24px, auto; }
  .cover-page.cover-minimal { background: linear-gradient(180deg, #ffffff 0%, #f9fafb 100%); }
  .cover-top { width: 100%; display: flex; flex-direction: column; align-items: center; }
  .cover-logo { max-width: 180px; max-height: 80px; margin-bottom: 18px; object-fit: contain; }
  .cover-body { width: 100%; max-width: 560px; margin: auto 0; }
  .cover-company { font-size: 13px; text-transform: uppercase; letter-spacing: 0.15em; color: ${accent}; font-weight: 600; margin-bottom: 0; }
  .cover-divider { width: 72px; height: 3px; background: ${accent}; margin: 0 auto 24px; border-radius: 2px; }
  .cover-title { font-size: 34px; font-weight: 700; color: #111; margin-bottom: 18px; letter-spacing: -0.02em; line-height: 1.15; }
  .cover-meta { font-size: 14px; color: #4b5563; margin-bottom: 6px; }
  .cover-details { width: 100%; display: flex; flex-wrap: wrap; justify-content: center; gap: 10px 14px; align-items: center; padding-top: 22px; border-top: 1px solid rgba(15, 23, 42, 0.08); }
  .cover-detail { border: 1px solid rgba(15, 23, 42, 0.08); border-radius: 999px; padding: 6px 12px; background: rgba(255, 255, 255, 0.72); font-size: 11px; color: #6b7280; }

  /* Header/footer bars */
  .html-header { background: ${headerBg}; color: #fff; padding: 8px 16px; font-size: 10px; display: flex; justify-content: space-between; align-items: center; margin: -${PDF_BODY_PADDING_PX}px -${PDF_BODY_PADDING_PX}px 20px; }
  .html-footer { margin: 28px -${PDF_BODY_PADDING_PX}px -${PDF_BODY_PADDING_PX}px; padding: 10px 16px; background: #f5f5f5; border-top: 2px solid #e5e5e5; font-size: 10px; color: #666; display: flex; justify-content: space-between; align-items: center; }
  .post-cover-header { margin: -${PDF_BODY_PADDING_PX}px -${PDF_BODY_PADDING_PX}px 20px; padding: 18px ${PDF_BODY_PADDING_PX}px 14px; background: linear-gradient(180deg, #f8fafc 0%, #ffffff 72%); }

  /* Report sections */
  .report-section { margin: 16px 0; border-radius: 8px; overflow: hidden; border: 1px solid #e5e5e5; page-break-inside: avoid; }
  .report-section-header { display: flex; align-items: center; gap: 12px; padding: 14px 18px; border-bottom: 1px solid #e5e5e5; }
  .report-section-icon { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: white; font-size: 14px; flex-shrink: 0; }
  .report-section-title { font-size: 15px; font-weight: 600; color: #111827; margin: 0; }
  .report-section-body { padding: 18px; font-size: 12px; line-height: 1.7; color: #374151; }
  .report-section-body img { max-width: 100%; height: auto; border-radius: 8px; margin-bottom: 12px; }
  .report-image-caption { font-size: 11px; color: #6b7280; font-style: italic; margin-top: 8px; }
  .report-section.content { background: #f9fafb; }
  .report-section.image { background: #faf5ff; border-color: #e9d5ff; }
  .report-section.summary { background: linear-gradient(135deg, #fef3c7, #fde68a); border-color: #f59e0b; }
  .report-section.recommendations { background: linear-gradient(135deg, #fef2f2, #fee2e2); border-color: #ef4444; }
  .report-icon-content { background: linear-gradient(135deg, #10b981, #059669); }
  .report-icon-image { background: linear-gradient(135deg, #8b5cf6, #7c3aed); }
  .report-icon-summary { background: linear-gradient(135deg, #f59e0b, #d97706); }
  .report-icon-recommendations { background: linear-gradient(135deg, #ef4444, #dc2626); }
  .report-nested { margin-left: 28px; margin-top: 12px; border-left: 3px solid #d1d5db; padding-left: 16px; }
  .report-nested .report-section { border-radius: 6px; }
  .report-nested .report-section-header { padding: 10px 14px; }
  .report-nested .report-section-icon { width: 26px; height: 26px; font-size: 12px; }
  .report-nested .report-section-title { font-size: 13px; }

  @media print { body { margin: 0; padding: ${PDF_BODY_PADDING_PX}px; } }
</style></head><body>`;

  // Render ordered sections
  for (const sectionKey of opts.sectionOrder) {
    const customSectionId = getCustomSectionId(sectionKey);
    if (customSectionId) {
      const customSection = opts.customSections.find((section) => section.id === customSectionId);
      if (!customSection) continue;
      html += `<h2>${escapeHtml(customSection.title)}</h2><div class="section-body">${customSection.content}</div>`;
      continue;
    }

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
      html += `<div class="header post-cover-header">
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
      if (!opts.customerFacing) {
        html += `<div class="summary-grid">
          <div class="summary-card"><div class="label">Subtotal</div><div class="value">${formatMoney(data.subtotal)}</div></div>
          <div class="summary-card"><div class="label">Cost</div><div class="value">${formatMoney(data.cost)}</div></div>
          <div class="summary-card"><div class="label">Profit</div><div class="value">${formatMoney(data.estimatedProfit)}</div></div>
          <div class="summary-card"><div class="label">Margin</div><div class="value">${formatPct(data.estimatedMargin)}</div></div>
        </div>`;
      }
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
      const headerBlock = (opts.headerFooter.showHeader && headerText
        ? `<div class="html-header"><span>${escapeHtml(headerText)}</span><span>${escapeHtml(data.quoteNumber)}</span></div>`
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
        ${!opts.customerFacing ? `<div class="summary-grid">
          <div class="summary-card"><div class="label">Subtotal</div><div class="value">${formatMoney(data.subtotal)}</div></div>
          <div class="summary-card"><div class="label">Cost</div><div class="value">${formatMoney(data.cost)}</div></div>
          <div class="summary-card"><div class="label">Profit</div><div class="value">${formatMoney(data.estimatedProfit)}</div></div>
          <div class="summary-card"><div class="label">Margin</div><div class="value">${formatPct(data.estimatedMargin)}</div></div>
        </div>` : ""}`;
      html = html.slice(0, afterBody) + headerBlock + html.slice(afterBody);
    }
  }

  // HTML footer bar
  if (opts.headerFooter.showFooter) {
    html += `<div class="html-footer"><span>${escapeHtml(footerText)}</span><span>${new Date().toLocaleDateString()}</span></div>`;
  }

  html += `</body></html>`;

  return html;
}

function renderReportSection(section: PdfDataPackage["reportSections"][number]): string {
  const typeConfig: Record<string, { iconClass: string; emoji: string }> = {
    content:         { iconClass: "report-icon-content", emoji: "&#128221;" },
    heading:         { iconClass: "report-icon-content", emoji: "&#128204;" },
    image:           { iconClass: "report-icon-image",   emoji: "&#128247;" },
    summary:         { iconClass: "report-icon-summary", emoji: "&#128202;" },
    recommendations: { iconClass: "report-icon-recommendations", emoji: "&#128161;" },
  };
  const config = typeConfig[section.sectionType] ?? typeConfig.content;
  const sectionClass = section.sectionType;

  // Heading type renders as a plain styled heading
  if (section.sectionType === "heading") {
    return `<h3 style="margin:20px 0 8px;font-size:15px;font-weight:600;color:#1a1a1a">${escapeHtml(section.title)}</h3>`;
  }

  // Image sections: parse JSON content to render actual image + caption
  if (section.sectionType === "image") {
    let imageHtml = "";
    let caption = "";
    try {
      const parsed = JSON.parse(section.content);
      if (parsed.resolvedImagePath) {
        imageHtml = `<img src="file://${parsed.resolvedImagePath}" alt="${escapeHtml(section.title)}" style="max-width:100%;max-height:500px;object-fit:contain;border-radius:8px;" />`;
      }
      caption = parsed.caption || "";
    } catch {
      caption = section.content || "";
    }

    let html = `<div class="report-section ${sectionClass}">`;
    html += `<div class="report-section-header">`;
    html += `<div class="report-section-icon ${config.iconClass}">${config.emoji}</div>`;
    html += `<div class="report-section-title">${escapeHtml(section.title)}</div>`;
    html += `</div>`;
    html += `<div class="report-section-body">`;
    if (imageHtml) html += imageHtml;
    if (caption) html += `<div class="report-image-caption">${escapeHtml(caption)}</div>`;
    html += `</div></div>`;
    return html;
  }

  // Standard sections: content, summary, recommendations
  let html = `<div class="report-section ${sectionClass}">`;
  html += `<div class="report-section-header">`;
  html += `<div class="report-section-icon ${config.iconClass}">${config.emoji}</div>`;
  html += `<div class="report-section-title">${escapeHtml(section.title)}</div>`;
  html += `</div>`;
  if (section.content) {
    // Content may contain HTML from the rich text editor — render as-is
    html += `<div class="report-section-body">${section.content}</div>`;
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

function escapeForCssContent(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, " ");
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

  let page: import("playwright").Page | null = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdfBuffer = await page.pdf({
      format: format as any,
      landscape,
      printBackground: true,
      margin: {
        top: `${PDF_PAGE_MARGINS_MM.top}mm`,
        right: `${PDF_PAGE_MARGINS_MM.right}mm`,
        bottom: `${PDF_PAGE_MARGINS_MM.bottom}mm`,
        left: `${PDF_PAGE_MARGINS_MM.left}mm`,
      },
    });
    const buffer = Buffer.from(pdfBuffer);
    if (buffer.subarray(0, 5).toString("utf8") !== "%PDF-") {
      throw new Error("Playwright returned a non-PDF response");
    }
    return { buffer, contentType: "application/pdf" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`PDF generation failed: ${message}`);
  } finally {
    await page?.close().catch(() => {});
  }
}
