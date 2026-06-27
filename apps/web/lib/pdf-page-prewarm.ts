export interface PdfPrewarmOptions {
  radius?: number;
  includeCurrent?: boolean;
}

export function buildPdfPrewarmQueue(
  currentPage: number,
  pageCount: number,
  options: PdfPrewarmOptions = {},
): number[] {
  if (!Number.isFinite(currentPage) || !Number.isFinite(pageCount) || pageCount <= 0) return [];

  const radius = Math.max(0, Math.floor(options.radius ?? 2));
  const current = Math.max(1, Math.min(Math.floor(currentPage), Math.floor(pageCount)));
  const pages: number[] = [];

  if (options.includeCurrent) {
    pages.push(current);
  }

  for (let distance = 1; distance <= radius; distance += 1) {
    const previous = current - distance;
    const next = current + distance;
    if (previous >= 1) pages.push(previous);
    if (next <= pageCount) pages.push(next);
  }

  return pages;
}
