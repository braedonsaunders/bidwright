const CSV_FORMULA_PREFIXES = new Set(["=", "+", "-", "@", "\t", "\r"]);

export function neutralizeCsvFormula(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return text.length > 0 && CSV_FORMULA_PREFIXES.has(text[0]) ? `'${text}` : text;
}

export function escapeCsvCell(value: unknown): string {
  const text = neutralizeCsvFormula(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(headers: Array<unknown>, rows: Array<Array<unknown>>): string {
  return [headers, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

export function downloadCsv(fileName: string, headers: Array<unknown>, rows: Array<Array<unknown>>) {
  const csv = buildCsv(headers, rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
