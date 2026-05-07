"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Layers, Loader2, Ruler, Table2 } from "lucide-react";
import { Badge } from "@/components/ui";
import { inspectFileIngest, type FileIngestManifestResponse } from "@/lib/api";

type MarkupManifest = NonNullable<FileIngestManifestResponse["manifest"]["markups"]>;

interface BluebeamMarkupsViewerProps {
  projectId: string;
  sourceKind: "source_document" | "file_node";
  sourceId: string;
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export function BluebeamMarkupsViewer({ projectId, sourceKind, sourceId }: BluebeamMarkupsViewerProps) {
  const [markups, setMarkups] = useState<MarkupManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMarkups(null);

    inspectFileIngest(projectId, { sourceKind, sourceId })
      .then((result) => {
        if (!cancelled) setMarkups(result.manifest.markups ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Markup inspection failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, sourceKind, sourceId]);

  const totals = useMemo(() => {
    const byType = new Map<string, { quantity: number; unit: string | null; count: number }>();
    for (const item of markups?.quantities ?? []) {
      const key = `${item.measurementType ?? "quantity"}::${item.unit ?? ""}`;
      const current = byType.get(key) ?? {
        quantity: 0,
        unit: item.unit ?? null,
        count: 0,
      };
      current.quantity += item.quantity;
      current.count += 1;
      byType.set(key, current);
    }
    return Array.from(byType.entries()).map(([key, value]) => ({
      measurementType: key.split("::")[0],
      ...value,
    }));
  }, [markups]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-2 text-xs text-fg/45">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking for markup quantities...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 border-b border-yellow-500/20 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-600">
        <AlertTriangle className="h-3.5 w-3.5" />
        {error}
      </div>
    );
  }

  if (!markups) {
    return null;
  }

  return (
    <div className="shrink-0 border-b border-line bg-panel">
      <div className="flex items-center gap-2 px-3 py-2">
        <Ruler className="h-4 w-4 text-accent" />
        <span className="text-sm font-semibold text-fg">Bluebeam Markups</span>
        <Badge tone="info" className="ml-auto">
          {markups.quantityCount} quantities
        </Badge>
      </div>

      <div className="grid gap-2 px-3 pb-3 md:grid-cols-3">
        <div className="rounded-md border border-line bg-bg/40 px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase text-fg/35">
            <Table2 className="h-3.5 w-3.5" />
            Rows
          </div>
          <p className="mt-1 text-lg font-semibold text-fg">{markups.rowCount}</p>
        </div>
        <div className="rounded-md border border-line bg-bg/40 px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase text-fg/35">
            <Layers className="h-3.5 w-3.5" />
            Subjects
          </div>
          <p className="mt-1 truncate text-lg font-semibold text-fg">{markups.subjects.length || "-"}</p>
        </div>
        <div className="rounded-md border border-line bg-bg/40 px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase text-fg/35">
            <Ruler className="h-3.5 w-3.5" />
            Units
          </div>
          <p className="mt-1 truncate text-lg font-semibold text-fg">{markups.units.join(", ") || "-"}</p>
        </div>
      </div>

      {totals.length > 0 && (
        <div className="border-t border-line px-3 py-2">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {totals.map((total) => (
              <div key={`${total.measurementType}-${total.unit ?? ""}`} className="min-w-[140px] rounded-md border border-line bg-bg/35 px-2.5 py-2">
                <p className="truncate text-[11px] font-medium uppercase text-fg/35">{total.measurementType}</p>
                <p className="mt-1 text-sm font-semibold text-fg">
                  {formatQuantity(total.quantity)} {total.unit ?? ""}
                </p>
                <p className="mt-0.5 text-[11px] text-fg/35">{total.count} row{total.count !== 1 ? "s" : ""}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="max-h-52 overflow-auto border-t border-line">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-panel text-[10px] uppercase text-fg/35">
            <tr>
              <th className="px-3 py-1.5 font-medium">Page</th>
              <th className="px-3 py-1.5 font-medium">Subject</th>
              <th className="px-3 py-1.5 font-medium">Label</th>
              <th className="px-3 py-1.5 text-right font-medium">Quantity</th>
              <th className="px-3 py-1.5 font-medium">Unit</th>
            </tr>
          </thead>
          <tbody>
            {markups.quantities.slice(0, 80).map((item) => (
              <tr key={item.id} className="border-t border-line/70">
                <td className="px-3 py-1.5 text-fg/45">{item.pageLabel ?? "-"}</td>
                <td className="max-w-[140px] truncate px-3 py-1.5 text-fg/70">{item.subject ?? "-"}</td>
                <td className="max-w-[180px] truncate px-3 py-1.5 text-fg/55">{item.label ?? item.comment ?? "-"}</td>
                <td className="px-3 py-1.5 text-right font-medium text-fg">{formatQuantity(item.quantity)}</td>
                <td className="px-3 py-1.5 text-fg/45">{item.unit ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {markups.quantities.length > 80 && (
          <div className="border-t border-line px-3 py-1.5 text-xs text-fg/35">
            Showing first 80 of {markups.quantities.length} markup quantities.
          </div>
        )}
      </div>
    </div>
  );
}
