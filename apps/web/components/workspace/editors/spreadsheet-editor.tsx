"use client";

import { useRef, useState } from "react";
import { Workbook } from "@fortune-sheet/react";
import type { Sheet } from "@fortune-sheet/core";
import "@fortune-sheet/react/dist/index.css";
import { Save, X } from "lucide-react";
import {
  Button,
} from "@braedonsaunders/appkit-ui";

interface SpreadsheetEditorProps {
  fileName: string;
  initialData?: Sheet[];
  onSave?: (blob: Blob) => void | Promise<void>;
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
  initialData,
  onSave,
  onClose,
}: SpreadsheetEditorProps) {
  const sheetDataRef = useRef<Sheet[]>(initialData ?? defaultSheets);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const handleSave = async () => {
    if (!onSave || saving) return;
    setSaving(true);
    try {
      const blob = await sheetsToXlsx(sheetDataRef.current);
      await onSave(blob);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="relative z-20 flex shrink-0 items-center justify-between border-b border-line bg-panel px-3 py-2 shadow-sm">
        <span className="min-w-0 truncate text-sm font-medium text-fg">
          {fileName}
          {dirty && <span className="ml-2 text-xs font-normal text-fg/45">Unsaved changes</span>}
        </span>
        <div className="flex items-center gap-1">
          {onSave && (
            <Button variant="default" size="sm" onClick={handleSave} disabled={saving}>
              <Save className="w-4 h-4 mr-1" />
              {saving ? "Saving..." : "Save changes"}
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose} disabled={saving} title="Exit editor">
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
      <div className="relative z-0 min-h-0 flex-1 overflow-hidden">
        <Workbook data={initialData ?? defaultSheets} onChange={(d: Sheet[]) => { sheetDataRef.current = d; setDirty(true); }} />
      </div>
    </div>
  );
}
