"use client";

import { useState, useMemo } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  Label,
  ModalBackdrop,
  Select,
} from "@/components/ui";
import type { WorkspaceWorksheet, WorkspaceWorksheetItem } from "@/lib/api";

/* ─── Props ─── */

interface LinkToLineItemModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (data: {
    worksheetItemId: string;
    quantityField: string;
    multiplier: number;
  }) => void;
  /** The annotation's measurement object */
  measurement?: { value?: number; unit?: string; area?: number; volume?: number };
  /** All worksheets with items */
  worksheets: WorkspaceWorksheet[];
}

/* ─── Helpers ─── */

const QUANTITY_FIELDS = [
  { value: "value", label: "Length / Distance" },
  { value: "area", label: "Area" },
  { value: "volume", label: "Volume" },
  { value: "count", label: "Count" },
] as const;

function availableFields(measurement?: LinkToLineItemModalProps["measurement"]) {
  if (!measurement) return QUANTITY_FIELDS.filter((f) => f.value === "value");
  return QUANTITY_FIELDS.filter((f) => {
    if (f.value === "value") return measurement.value !== undefined;
    if (f.value === "area") return measurement.area !== undefined && measurement.area > 0;
    if (f.value === "volume") return measurement.volume !== undefined && measurement.volume > 0;
    if (f.value === "count") return true; // always available since value can be a count
    return false;
  });
}

/* ─── Component ─── */

export function LinkToLineItemModal({
  open,
  onClose,
  onConfirm,
  measurement,
  worksheets,
}: LinkToLineItemModalProps) {
  const [selectedWsId, setSelectedWsId] = useState<string>(worksheets[0]?.id ?? "");
  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [quantityField, setQuantityField] = useState("value");
  const [wastePercent, setWastePercent] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");

  const selectedWs = worksheets.find((w) => w.id === selectedWsId);
  const items = useMemo(() => {
    const wsItems = selectedWs?.items ?? [];
    if (!searchTerm) return wsItems;
    const q = searchTerm.toLowerCase();
    return wsItems.filter(
      (i) =>
        i.entityName.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q),
    );
  }, [selectedWs, searchTerm]);

  const fields = availableFields(measurement);
  const multiplier = 1 + wastePercent / 100;

  // Preview: what quantity will be set
  const rawValue = measurement
    ? Number((measurement as Record<string, unknown>)[quantityField] ?? measurement.value ?? 0) || 0
    : 0;
  const derivedQty = rawValue * multiplier;

  function handleConfirm() {
    if (!selectedItemId) return;
    onConfirm({ worksheetItemId: selectedItemId, quantityField, multiplier });
  }

  return (
    <ModalBackdrop open={open} onClose={onClose} size="md">
      <Card>
        <CardHeader>
          <CardTitle>Link to Line Item</CardTitle>
          <p className="mt-0.5 text-[11px] text-fg/40">
            Connect this annotation&rsquo;s measurement to a worksheet line item
          </p>
        </CardHeader>
        <CardBody className="space-y-4">
          {/* Worksheet selector */}
          {worksheets.length > 1 && (
            <div>
              <Label>Worksheet</Label>
              <Select
                value={selectedWsId}
                onValueChange={(v) => {
                  setSelectedWsId(v);
                  setSelectedItemId("");
                }}
                options={worksheets.map((ws) => ({ value: ws.id, label: ws.name }))}
              />
            </div>
          )}

          {/* Search items */}
          <div>
            <Label>Line Item</Label>
            <Input
              placeholder="Search items..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="mb-2"
            />
            <div className="max-h-48 overflow-auto rounded-md border border-line">
              {items.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-fg/40">No items found</p>
              ) : (
                items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedItemId(item.id)}
                    className={`flex w-full items-center gap-2 border-b border-line/50 px-3 py-2 text-left text-xs transition-colors last:border-b-0 ${
                      selectedItemId === item.id
                        ? "bg-accent/10 text-accent"
                        : "hover:bg-panel2/60 text-fg/70"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{item.entityName || "Unnamed"}</span>
                    <span className="shrink-0 text-[11px] text-fg/30">{item.category}</span>
                    <span className="shrink-0 text-[11px] text-fg/30">
                      {item.quantity} {item.uom}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Quantity field selector */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Measurement Field</Label>
              <Select
                value={quantityField}
                onValueChange={setQuantityField}
                options={fields.map((f) => ({ value: f.value, label: f.label }))}
              />
            </div>
            <div>
              <Label>Waste / Safety Factor %</Label>
              <Input
                type="number"
                min={0}
                max={100}
                step={1}
                value={wastePercent}
                onChange={(e) => setWastePercent(Number(e.target.value) || 0)}
              />
            </div>
          </div>

          {/* Preview */}
          <div className="rounded-md bg-panel2/50 px-3 py-2">
            <p className="text-[11px] text-fg/40">Preview</p>
            <p className="text-sm font-medium text-fg">
              {rawValue.toFixed(2)} {measurement?.unit ?? ""} &times; {multiplier.toFixed(2)} ={" "}
              <span className="text-accent">{derivedQty.toFixed(2)}</span>
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={!selectedItemId}
            >
              Link
            </Button>
          </div>
        </CardBody>
      </Card>
    </ModalBackdrop>
  );
}
