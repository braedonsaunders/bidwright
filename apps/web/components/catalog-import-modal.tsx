"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, Sparkles, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type CatalogImportAnalysis,
  type CatalogImportTable,
  type CatalogItemTargetField,
  type CatalogSummary,
  analyzeCatalogImport,
  commitCatalogImport,
} from "@/lib/api";
import { Button, CompactSelect, Input, Label, ModalBackdrop } from "@/components/ui";

const FIELD_OPTIONS: Array<{ value: CatalogItemTargetField; label: string }> = [
  { value: "name", label: "Item name" },
  { value: "code", label: "Code / SKU" },
  { value: "unit", label: "Unit (UoM)" },
  { value: "unitCost", label: "Unit cost" },
  { value: "unitPrice", label: "Unit price" },
  { value: "category", label: "Category" },
  { value: "ignore", label: "Ignore" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  catalogs: CatalogSummary[];
  defaultCatalogId?: string;
  /** Pre-loaded analysis (e.g. from a knowledge book). When set, skips the file upload step. */
  prefillAnalysis?: CatalogImportAnalysis | null;
  /** Source label shown when prefillAnalysis is set (e.g. "from Rate Sheet 2026.xlsx"). */
  sourceLabel?: string;
  onImported?: (info: { catalogId: string; created: number; skipped: number }) => void;
}

export function CatalogImportModal({
  open,
  onClose,
  catalogs,
  defaultCatalogId,
  prefillAnalysis,
  sourceLabel,
  onImported,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<CatalogImportAnalysis | null>(null);
  const [tableIdx, setTableIdx] = useState(0);
  const [mapping, setMapping] = useState<Record<string, CatalogItemTargetField>>({});
  const [defaultCategory, setDefaultCategory] = useState("");
  const [targetCatalogId, setTargetCatalogId] = useState(defaultCatalogId ?? "");
  const [analyzing, setAnalyzing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committed, setCommitted] = useState<{ created: number; skipped: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setAnalysis(null);
      setTableIdx(0);
      setMapping({});
      setDefaultCategory("");
      setError(null);
      setCommitted(null);
      setAnalyzing(false);
      setCommitting(false);
      setTargetCatalogId(defaultCatalogId ?? "");
    } else if (prefillAnalysis) {
      // Skip upload step — populate analysis directly from prefill.
      setAnalysis(prefillAnalysis);
      setTableIdx(prefillAnalysis.selectedTableIndex);
      setMapping(prefillAnalysis.mapping.byHeader ?? {});
    }
  }, [open, defaultCatalogId, prefillAnalysis]);

  const currentTable = analysis?.tables[tableIdx] ?? null;

  const handleAnalyze = useCallback(async (f: File) => {
    setAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeCatalogImport(f);
      setAnalysis(result);
      setTableIdx(result.selectedTableIndex);
      setMapping(result.mapping.byHeader ?? {});
    } catch (e: any) {
      setError(e?.message ?? "Failed to analyze file");
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const handleFile = useCallback(
    (f: File | null) => {
      setFile(f);
      setAnalysis(null);
      setMapping({});
      setCommitted(null);
      if (f) void handleAnalyze(f);
    },
    [handleAnalyze],
  );

  // When the user switches tabs (different sheet), reset mapping to the
  // detected one for that table — heuristic only since AI mapping was for the
  // selected table.
  const onSelectTable = (idx: number) => {
    setTableIdx(idx);
    if (analysis) {
      const table = analysis.tables[idx];
      if (table) {
        const next: Record<string, CatalogItemTargetField> = {};
        for (const h of table.headers) {
          // Prefer existing entry if user already picked something for this header.
          next[h] = (mapping[h] as CatalogItemTargetField | undefined) ?? "ignore";
        }
        setMapping(next);
      }
    }
  };

  const validForCommit = useMemo(() => {
    if (!currentTable || !targetCatalogId) return false;
    return Object.values(mapping).some((v) => v === "name");
  }, [currentTable, targetCatalogId, mapping]);

  const handleCommit = useCallback(async () => {
    if (!currentTable || !targetCatalogId) return;
    setCommitting(true);
    setError(null);
    try {
      const result = await commitCatalogImport(targetCatalogId, {
        table: currentTable,
        mapping: { byHeader: mapping },
        defaultCategory: defaultCategory || undefined,
      });
      setCommitted({ created: result.created, skipped: result.skipped });
      onImported?.({ catalogId: result.catalogId, created: result.created, skipped: result.skipped });
    } catch (e: any) {
      setError(e?.message ?? "Failed to commit import");
    } finally {
      setCommitting(false);
    }
  }, [currentTable, targetCatalogId, mapping, defaultCategory, onImported]);

  if (!open) return null;

  return (
    <ModalBackdrop open={open} onClose={onClose}>
      <div className="bg-panel rounded-lg shadow-2xl w-[920px] max-w-[95vw] max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-fg/10">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4" />
            <div className="text-sm font-medium">Import items from spreadsheet</div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>

        {error && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-red-500/10 text-xs text-red-400 border border-red-500/30">
            {error}
          </div>
        )}

        {/* Upload + target */}
        <div className="p-4 grid grid-cols-2 gap-3 border-b border-fg/10 items-start">
          {prefillAnalysis ? (
            <div>
              <Label className="text-[10px]">Source</Label>
              <div className="flex items-center gap-2 h-7 rounded-md border border-line bg-bg/45 px-2 text-[11px] text-fg/70">
                <FileSpreadsheet className="w-3.5 h-3.5" />
                {sourceLabel ?? "Pre-loaded from knowledge"}
              </div>
            </div>
          ) : (
            <div>
              <Label className="text-[10px]">File (XLSX, CSV, or PDF)</Label>
              <div className="flex gap-2 items-center">
                <label className="flex-1">
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls,.xlsm,.pdf"
                    onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                    className="hidden"
                  />
                  <span className="flex items-center gap-2 h-7 rounded-md border border-line bg-bg/45 px-2 text-[11px] text-fg cursor-pointer hover:border-accent/30">
                    <Upload className="w-3.5 h-3.5" />
                    {file ? file.name : "Choose a file…"}
                  </span>
                </label>
              </div>
              {analyzing && <div className="text-[10px] text-fg/45 mt-1">Analyzing with AI…</div>}
            </div>
          )}
          <div>
            <Label className="text-[10px]">Target catalog</Label>
            <CompactSelect
              value={targetCatalogId}
              onValueChange={setTargetCatalogId}
              options={catalogs.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Select catalog"
            />
          </div>
        </div>

        {analysis && currentTable && !committed && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* AI summary */}
            <div className="rounded-md border border-fg/10 bg-panel2/40 p-3 space-y-1.5">
              <div className="flex items-center gap-2 text-[11px]">
                <Sparkles className="w-3.5 h-3.5 text-fg/60" />
                <span className="font-medium">AI mapping</span>
                <span className="text-fg/45">
                  detected: <span className="font-mono">{analysis.detectedKind}</span> · confidence{" "}
                  {(analysis.confidence * 100).toFixed(0)}%
                </span>
              </div>
              {analysis.notes && <div className="text-[11px] text-fg/60">{analysis.notes}</div>}
              {analysis.warnings.length > 0 && (
                <div className="text-[11px] text-amber-400 space-y-0.5">
                  {analysis.warnings.map((w, i) => (
                    <div key={i}>⚠ {w}</div>
                  ))}
                </div>
              )}
            </div>

            {/* Table tabs */}
            {analysis.tables.length > 1 && (
              <div className="flex gap-1 overflow-x-auto">
                {analysis.tables.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => onSelectTable(i)}
                    className={cn(
                      "px-2.5 py-1 text-[11px] rounded-md transition-colors whitespace-nowrap",
                      i === tableIdx ? "bg-panel2 text-fg" : "text-fg/45 hover:text-fg/75",
                    )}
                  >
                    {t.sheetName} <span className="text-fg/30">({t.rows.length} rows)</span>
                  </button>
                ))}
              </div>
            )}

            {/* Mapping editor */}
            <div className="rounded-md border border-fg/10 overflow-hidden">
              <div className="px-3 py-2 border-b border-fg/10 bg-panel2/40 text-[11px] font-medium">
                Column mapping ({currentTable.headers.length} columns, {currentTable.rows.length} rows)
              </div>
              <div className="grid grid-cols-2 gap-2 p-3">
                {currentTable.headers.map((h) => (
                  <div key={h} className="grid grid-cols-[1fr_140px] gap-2 items-center">
                    <div className="text-xs truncate" title={h}>
                      {h || <span className="text-fg/30">(empty)</span>}
                    </div>
                    <CompactSelect
                      value={mapping[h] ?? "ignore"}
                      onValueChange={(v) => setMapping((prev) => ({ ...prev, [h]: v as CatalogItemTargetField }))}
                      options={FIELD_OPTIONS}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Sample preview */}
            <div className="rounded-md border border-fg/10 overflow-hidden">
              <div className="px-3 py-2 border-b border-fg/10 bg-panel2/40 text-[11px] font-medium">
                Sample (first 5 rows)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-panel2/30 text-fg/45">
                    <tr>
                      {currentTable.headers.map((h, i) => (
                        <th key={i} className="px-2 py-1 text-left whitespace-nowrap">
                          {h}
                          <div className="text-[9px] text-fg/35 normal-case">{mapping[h] ?? "ignore"}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {currentTable.rows.slice(0, 5).map((r, ri) => (
                      <tr key={ri} className="border-t border-fg/5">
                        {r.map((c, ci) => (
                          <td key={ci} className="px-2 py-1 text-fg/70 whitespace-nowrap">{c}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <Label className="text-[10px]">Default category (used when row's category is empty)</Label>
              <Input
                value={defaultCategory}
                onChange={(e) => setDefaultCategory(e.target.value)}
                placeholder="e.g. Lighting, Plumbing"
                className="text-xs"
              />
            </div>
          </div>
        )}

        {committed && (
          <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center gap-2">
            <div className="text-sm font-medium">✓ Imported {committed.created} item{committed.created === 1 ? "" : "s"}</div>
            {committed.skipped > 0 && <div className="text-xs text-fg/50">Skipped {committed.skipped} row(s) with no name.</div>}
          </div>
        )}

        {!analysis && !committed && !analyzing && (
          <div className="flex-1 flex items-center justify-center text-xs text-fg/40 p-6">
            Choose a file to begin.
          </div>
        )}

        <div className="px-4 py-3 border-t border-fg/10 flex items-center justify-end gap-2">
          {committed ? (
            <Button size="sm" onClick={onClose} className="text-xs">
              Done
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleCommit} disabled={!validForCommit || committing} className="text-xs">
                {committing ? "Importing…" : "Import"}
              </Button>
            </>
          )}
        </div>
      </div>
    </ModalBackdrop>
  );
}
