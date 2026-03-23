"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  adminListDatasetTemplates,
  adminGetDatasetTemplate,
  adminDeleteDatasetTemplate,
  type DatasetRecord,
  type DatasetRowRecord,
} from "@/lib/api";
import {
  Button,
  Card,
  CardBody,
  Badge,
} from "@/components/ui";
import { ChevronDown, ChevronUp, Database, Search, Trash2, ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

const CATEGORY_LABELS: Record<string, string> = {
  labour_units: "Labour Units",
  equipment_rates: "Equipment Rates",
  material_prices: "Material Prices",
  productivity: "Productivity",
  burden_rates: "Burden Rates",
  custom: "Custom",
};

const PAGE_SIZE = 500;
const ROW_HEIGHT = 32;
const TABLE_HEIGHT = 600;

/* ── Virtualized Table ─────────────────────────────────────────────────── */

function VirtualizedTable({
  columns,
  rows,
  rowOffset,
}: {
  columns: DatasetRecord["columns"];
  rows: DatasetRowRecord[];
  rowOffset: number;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 30,
  });

  return (
    <div className="rounded-lg border border-line overflow-hidden">
      {/* Sticky header */}
      <div className="bg-panel2/50 border-b border-line">
        <table className="w-full text-xs table-fixed">
          <thead>
            <tr>
              <th className="text-left py-2 px-3 font-medium text-fg/40 w-14">#</th>
              {columns.map((col) => (
                <th key={col.key} className="text-left py-2 px-3 font-medium text-fg/40">
                  {col.name}
                </th>
              ))}
            </tr>
          </thead>
        </table>
      </div>

      {/* Virtualized body */}
      <div
        ref={parentRef}
        className="overflow-auto"
        style={{ height: Math.min(TABLE_HEIGHT, rows.length * ROW_HEIGHT + 2) }}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          <table className="w-full text-xs table-fixed" style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
            <tbody>
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index];
                return (
                  <tr
                    key={row.id}
                    className="border-b border-line/50 hover:bg-panel2/30"
                    style={{
                      height: ROW_HEIGHT,
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <td className="py-1.5 px-3 text-fg/30 w-14">{rowOffset + virtualRow.index + 1}</td>
                    {columns.map((col) => (
                      <td key={col.key} className="py-1.5 px-3 text-fg/80 truncate">
                        {col.type === "number"
                          ? (typeof row.data[col.key] === "number" ? (row.data[col.key] as number).toFixed(2) : row.data[col.key] as string)
                          : String(row.data[col.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Pagination Controls ───────────────────────────────────────────────── */

function PaginationControls({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);

  return (
    <div className="flex items-center justify-between mt-2 text-xs text-fg/40">
      <span>
        Showing {start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="xs" disabled={page === 0} onClick={() => onPageChange(0)}>
          <ChevronsLeft className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="xs" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="h-3 w-3" />
        </Button>
        <span className="px-2 text-fg/60">
          Page {page + 1} of {totalPages}
        </span>
        <Button variant="ghost" size="xs" disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)}>
          <ChevronRight className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="xs" disabled={page >= totalPages - 1} onClick={() => onPageChange(totalPages - 1)}>
          <ChevronsRight className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

/* ── Main Page ─────────────────────────────────────────────────────────── */

export default function AdminDatasetsPage() {
  const [templates, setTemplates] = useState<DatasetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rowsCache, setRowsCache] = useState<Record<string, { rows: DatasetRowRecord[]; total: number }>>({});
  const [rowPage, setRowPage] = useState(0);
  const [filter, setFilter] = useState("");
  const [filterInput, setFilterInput] = useState("");
  const [rowsLoading, setRowsLoading] = useState(false);

  const fetchTemplates = useCallback(async () => {
    try {
      const data = await adminListDatasetTemplates();
      setTemplates(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const loadPage = useCallback(async (id: string, page: number, f?: string) => {
    setRowsLoading(true);
    try {
      const data = await adminGetDatasetTemplate(id, {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        filter: f || undefined,
      });
      setRowsCache((prev) => ({ ...prev, [id]: { rows: data.rows, total: data.total } }));
      setRowPage(page);
    } catch { /* ignore */ }
    finally { setRowsLoading(false); }
  }, []);

  const toggleExpand = useCallback(async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    setRowPage(0);
    setFilter("");
    setFilterInput("");
    if (!rowsCache[id]) {
      await loadPage(id, 0);
    }
  }, [expandedId, rowsCache, loadPage]);

  const handleFilter = useCallback((id: string) => {
    setFilter(filterInput);
    loadPage(id, 0, filterInput);
  }, [filterInput, loadPage]);

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!confirm(`Delete template "${name}"? This cannot be undone.`)) return;
    try {
      await adminDeleteDatasetTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      if (expandedId === id) setExpandedId(null);
    } catch { /* ignore */ }
  }, [expandedId]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-fg">Dataset Library</h2>
          <p className="text-xs text-fg/40 mt-1">
            Template datasets that organizations can adopt. {templates.length} template{templates.length !== 1 ? "s" : ""} available.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="text-xs text-fg/40">Loading...</div>
      ) : templates.length === 0 ? (
        <Card>
          <CardBody>
            <div className="py-8 text-center text-sm text-fg/40">
              No dataset templates yet. Use the import script to add data.
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => {
            const isExpanded = expandedId === t.id;
            const cached = rowsCache[t.id];
            const totalPages = cached ? Math.ceil(cached.total / PAGE_SIZE) : 0;

            return (
              <Card key={t.id}>
                <CardBody>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-panel2">
                        <Database className="h-4 w-4 text-fg/40" />
                      </div>
                      <div>
                        <div className="font-medium text-sm text-fg">{t.name}</div>
                        <div className="text-xs text-fg/40">
                          {t.description ? `${t.description.slice(0, 80)}${t.description.length > 80 ? "..." : ""}` : "No description"}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-fg/40">
                      <Badge tone="info" className="text-[10px]">
                        {CATEGORY_LABELS[t.category] ?? t.category}
                      </Badge>
                      <span>{t.rowCount.toLocaleString()} rows</span>
                      <span>{t.source}</span>
                      <Button variant="ghost" size="xs" onClick={() => toggleExpand(t.id)}>
                        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        Rows
                      </Button>
                      <Button variant="danger" size="xs" onClick={() => handleDelete(t.id, t.name)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 border-t border-line pt-3">
                      {/* Column schema */}
                      <div className="mb-3">
                        <p className="text-[10px] text-fg/30 font-medium mb-1.5">COLUMNS</p>
                        <div className="flex flex-wrap gap-1.5">
                          {t.columns.map((col) => (
                            <Badge key={col.key} tone="default" className="text-[10px]">
                              {col.name}
                              {col.unit ? ` (${col.unit})` : ""}
                              <span className="ml-1 text-fg/30">{col.type}</span>
                            </Badge>
                          ))}
                        </div>
                      </div>

                      {/* Filter */}
                      <div className="flex items-center gap-2 mb-3">
                        <div className="relative flex-1 max-w-xs">
                          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-fg/30" />
                          <input
                            type="text"
                            placeholder="Search all rows..."
                            value={filterInput}
                            onChange={(e) => setFilterInput(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleFilter(t.id)}
                            className="w-full rounded-md border border-line bg-bg pl-7 pr-3 py-1.5 text-xs text-fg placeholder:text-fg/30 focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                        </div>
                        <Button variant="ghost" size="xs" onClick={() => handleFilter(t.id)}>Search</Button>
                        {filter && (
                          <Button variant="ghost" size="xs" onClick={() => {
                            setFilterInput("");
                            setFilter("");
                            loadPage(t.id, 0, "");
                          }}>Clear</Button>
                        )}
                      </div>

                      {/* Rows table */}
                      {!cached || rowsLoading ? (
                        <div className="text-xs text-fg/40">Loading rows...</div>
                      ) : cached.rows.length === 0 ? (
                        <div className="text-xs text-fg/40">No rows{filter ? " matching filter" : ""}.</div>
                      ) : (
                        <>
                          <VirtualizedTable
                            columns={t.columns}
                            rows={cached.rows}
                            rowOffset={rowPage * PAGE_SIZE}
                          />

                          {totalPages > 1 && (
                            <PaginationControls
                              page={rowPage}
                              totalPages={totalPages}
                              total={cached.total}
                              pageSize={PAGE_SIZE}
                              onPageChange={(p) => loadPage(t.id, p, filter || undefined)}
                            />
                          )}
                        </>
                      )}
                    </div>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
