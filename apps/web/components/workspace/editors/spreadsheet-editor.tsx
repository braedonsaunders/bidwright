"use client";

import { useRef } from "react";
import { Workbook } from "@fortune-sheet/react";
import type { Sheet } from "@fortune-sheet/core";
import "@fortune-sheet/react/dist/index.css";
import { Save, X } from "lucide-react";
import { Button } from "@/components/ui";

interface SpreadsheetEditorProps {
  fileName: string;
  onSave?: (blob: Blob) => void;
  onClose?: () => void;
}

const defaultSheets: Sheet[] = [
  { name: "Sheet1", celldata: [], order: 0, row: 36, column: 18 },
];

async function sheetsToXlsx(sheets: Sheet[]): Promise<Blob> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  for (const sheet of sheets) {
    // Convert fortune-sheet celldata to a 2D array
    const rows: unknown[][] = [];
    if (sheet.data) {
      // data is a CellMatrix (2D array)
      for (let r = 0; r < sheet.data.length; r++) {
        const row: unknown[] = [];
        if (sheet.data[r]) {
          for (let c = 0; c < sheet.data[r]!.length; c++) {
            const cell = sheet.data[r]![c];
            row.push(cell?.v ?? cell?.m ?? "");
          }
        }
        rows.push(row);
      }
    } else if (sheet.celldata) {
      // celldata is sparse [{r, c, v}]
      for (const cd of sheet.celldata) {
        const r = cd.r;
        const c = cd.c;
        while (rows.length <= r) rows.push([]);
        while (rows[r].length <= c) rows[r].push("");
        rows[r][c] = cd.v?.v ?? cd.v?.m ?? "";
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name || `Sheet${sheets.indexOf(sheet) + 1}`);
  }

  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function SpreadsheetEditor({
  fileName,
  onSave,
  onClose,
}: SpreadsheetEditorProps) {
  const sheetDataRef = useRef<Sheet[]>(defaultSheets);

  const handleSave = async () => {
    if (!onSave) return;
    const blob = await sheetsToXlsx(sheetDataRef.current);
    onSave(blob);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-line bg-panel">
        <span className="text-sm font-medium text-fg truncate">{fileName}</span>
        <div className="flex items-center gap-1">
          {onSave && (
            <Button variant="ghost" size="xs" onClick={handleSave}>
              <Save className="w-4 h-4 mr-1" />
              Save
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="xs" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <Workbook data={defaultSheets} onChange={(d: Sheet[]) => { sheetDataRef.current = d; }} />
      </div>
    </div>
  );
}
