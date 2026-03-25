"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

import "@fortune-sheet/react/dist/index.css";

interface XlsxViewerProps {
  url: string;
  fileName: string;
}

interface CellData {
  r: number;
  c: number;
  v: { v: unknown; m: string };
}

interface SheetData {
  name: string;
  celldata: CellData[];
  row: number;
  column: number;
  order: number;
  status: number;
}

function workbookToFortuneSheets(wb: XLSX.WorkBook): SheetData[] {
  return wb.SheetNames.map((name, index) => {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 }) as unknown[][];
    const celldata: CellData[] = [];
    let maxCol = 0;

    for (let r = 0; r < rows.length; r++) {
      if (!rows[r]) continue;
      for (let c = 0; c < rows[r].length; c++) {
        const val = rows[r][c];
        if (val !== undefined && val !== null && val !== "") {
          celldata.push({ r, c, v: { v: val, m: String(val) } });
          if (c > maxCol) maxCol = c;
        }
      }
    }

    return {
      name,
      celldata,
      row: Math.max(rows.length, 50),
      column: Math.max(maxCol + 1, 26),
      order: index,
      status: index === 0 ? 1 : 0,
    };
  });
}

export function XlsxViewer({ url, fileName }: XlsxViewerProps) {
  const [sheets, setSheets] = useState<SheetData[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [WorkbookComponent, setWorkbookComponent] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSpreadsheet() {
      setLoading(true);
      setError(null);

      try {
        const [response, fortuneSheet] = await Promise.all([
          fetch(url),
          import("@fortune-sheet/react"),
        ]);

        if (!response.ok) throw new Error(`Failed to fetch file: ${response.statusText}`);
        if (cancelled) return;

        setWorkbookComponent(() => fortuneSheet.Workbook);

        const data = await response.arrayBuffer();
        if (cancelled) return;

        const wb = XLSX.read(data);
        const converted = workbookToFortuneSheets(wb);
        setSheets(converted);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load spreadsheet");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSpreadsheet();
    return () => { cancelled = true; };
  }, [url]);

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
        <AlertTriangle className="h-10 w-10 text-yellow-500" />
        <p className="text-sm text-text-secondary">{error}</p>
        <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  if (loading || !sheets || !WorkbookComponent) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-text-secondary" />
        <span className="ml-2 text-sm text-text-secondary">Loading spreadsheet...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2">
        <FileSpreadsheet className="h-4 w-4 text-text-secondary" />
        <span className="text-sm font-medium text-text-primary truncate">{fileName}</span>
      </div>
      <div className="flex-1 overflow-hidden">
        <WorkbookComponent data={sheets} />
      </div>
    </div>
  );
}
