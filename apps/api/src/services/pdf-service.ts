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
}

export function buildPdfDataPackage(workspace: any): PdfDataPackage {
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

  html += `<div class="footer">Generated by Bidwright &middot; ${new Date().toLocaleDateString()}</div>`;
  html += `</body></html>`;

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
