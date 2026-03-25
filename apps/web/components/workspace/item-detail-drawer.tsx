"use client";

import { useEffect, useState, useTransition } from "react";
import { motion } from "motion/react";
import { Copy, Info, Trash2, X } from "lucide-react";
import type {
  EntityCategory,
  ProjectWorkspaceData,
  WorkspaceWorksheetItem,
} from "@/lib/api";
import { updateWorksheetItem } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { Badge, Button, Input, Select } from "@/components/ui";

const CATEGORY_COLORS: Record<string, string> = {
  Labour: "info",
  Equipment: "warning",
  Material: "success",
  Consumables: "default",
  "Stock Items": "default",
  "Other Charges": "danger",
  "Travel & Per Diem": "warning",
  Subcontractors: "info",
  "Rental Equipment": "warning",
};

export interface ItemDetailDrawerProps {
  item: WorkspaceWorksheetItem;
  workspace: ProjectWorkspaceData;
  entityCategories: EntityCategory[];
  onSave: (next: unknown) => void;
  onDelete: (itemId: string) => void;
  onDuplicate: (itemId: string) => void;
  onClose: () => void;
}

export function ItemDetailDrawer({
  item,
  workspace,
  entityCategories,
  onSave,
  onDelete,
  onDuplicate,
  onClose,
}: ItemDetailDrawerProps) {
  const [isPending, startTransition] = useTransition();

  const [form, setForm] = useState({
    entityName: item.entityName,
    vendor: item.vendor ?? "",
    description: item.description,
    quantity: item.quantity,
    uom: item.uom,
    cost: item.cost,
    markup: item.markup,
    price: item.price,
    unit1: item.unit1,
    unit2: item.unit2,
    unit3: item.unit3,
    phaseId: item.phaseId ?? "",
  });

  useEffect(() => {
    setForm({
      entityName: item.entityName,
      vendor: item.vendor ?? "",
      description: item.description,
      quantity: item.quantity,
      uom: item.uom,
      cost: item.cost,
      markup: item.markup,
      price: item.price,
      unit1: item.unit1,
      unit2: item.unit2,
      unit3: item.unit3,
      phaseId: item.phaseId ?? "",
    });
  }, [item]);

  const catDef = entityCategories.find((c) => c.name === item.category);
  const ws = (workspace.worksheets ?? []).find((w) => w.id === item.worksheetId);
  const extCost = item.cost * item.quantity;
  const margin =
    item.price > 0
      ? ((item.price - extCost) / item.price * 100).toFixed(1) + "%"
      : "--";

  function handleFieldBlur(field: string, value: string | number) {
    let patch: Record<string, unknown> = {};

    if (field === "markup") {
      const num = Number(value);
      if (!Number.isFinite(num)) return;
      patch = { markup: num };
    } else if (
      field === "quantity" ||
      field === "cost" ||
      field === "price" ||
      field === "unit1" ||
      field === "unit2" ||
      field === "unit3"
    ) {
      const num = Number(value);
      if (!Number.isFinite(num)) return;
      patch = { [field]: num };
    } else if (field === "phaseId") {
      patch = { phaseId: value || null };
    } else {
      patch = { [field]: value };
    }

    startTransition(async () => {
      try {
        const next = await updateWorksheetItem(workspace.project.id, item.id, patch);
        onSave(next);
      } catch {
        // handled by parent
      }
    });
  }

  const isEditable = (field: string) =>
    catDef?.editableFields?.[field as keyof typeof catDef.editableFields] !== false;

  function renderNumericField(
    field: keyof typeof form,
    label: string,
    value: number,
  ) {
    if (!isEditable(field)) {
      return (
        <div>
          <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
            {label}
          </label>
          <div className="mt-1 rounded bg-panel2/30 px-3 py-2 text-sm italic text-fg/50">
            {typeof value === "number" ? formatMoney(value, 2) : value}{" "}
            <span className="text-[10px] text-fg/30 ml-1">calculated</span>
          </div>
        </div>
      );
    }
    return (
      <div>
        <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
          {label}
        </label>
        <Input
          className="mt-1"
          type="number"
          step="0.01"
          value={(form as Record<string, unknown>)[field] as number}
          onChange={(e) =>
            setForm({ ...form, [field]: Number(e.target.value) || 0 })
          }
          onBlur={() =>
            handleFieldBlur(field, (form as Record<string, unknown>)[field] as number)
          }
        />
      </div>
    );
  }

  const calcInfoText = (() => {
    if (!catDef) return null;
    switch (catDef.calculationType) {
      case "auto_labour":
        return "Price calculated from labour rates \u00d7 hours \u00d7 quantity";
      case "auto_equipment":
        return "Price calculated from equipment rate \u00d7 duration \u00d7 quantity";
      case "formula":
        return catDef.calcFormula
          ? `Formula: ${catDef.calcFormula}`
          : null;
      default:
        return null;
    }
  })();

  return (
    <motion.div
      initial={{ x: 420 }}
      animate={{ x: 0 }}
      exit={{ x: 420 }}
      transition={{ type: "spring", damping: 30, stiffness: 300 }}
      className="fixed inset-y-0 right-0 z-40 w-[420px] bg-panel border-l border-line shadow-2xl flex flex-col"
    >
      {/* Category Color Stripe */}
      <div className="h-1 w-full" style={{ backgroundColor: catDef?.color ?? '#6b7280' }} />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-line bg-panel2/40">
        <div className="flex items-center gap-2">
          <Badge
            tone="info"
            style={{ backgroundColor: (catDef?.color ?? '#6b7280') + '20', color: catDef?.color ?? '#6b7280' }}
          >
            {catDef?.shortform} {item.category}
          </Badge>
          <span className="text-sm font-medium truncate max-w-[200px]">
            {item.entityName}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="p-1.5 rounded hover:bg-panel2/60 text-fg/40 hover:text-fg/70 transition-colors"
            onClick={() => onDuplicate(item.id)}
            title="Duplicate"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            className="p-1.5 rounded hover:bg-danger/10 text-fg/40 hover:text-danger transition-colors"
            onClick={() => onDelete(item.id)}
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            className="p-1.5 rounded hover:bg-panel2/60 text-fg/40 hover:text-fg/70 transition-colors"
            onClick={onClose}
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-center gap-2 text-xs text-fg/50">
          <span>
            Worksheet:{" "}
            <span className="text-fg/70 font-medium">{ws?.name ?? "Unknown"}</span>
          </span>
          <span>
            Line:{" "}
            <span className="text-fg/70 font-medium">{item.lineOrder}</span>
          </span>
        </div>

        <div>
          <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
            Entity Name
          </label>
          <Input
            className="mt-1"
            value={form.entityName}
            onChange={(e) => setForm({ ...form, entityName: e.target.value })}
            onBlur={() => handleFieldBlur("entityName", form.entityName)}
          />
        </div>

        <div>
          <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
            Vendor
          </label>
          <Input
            className="mt-1"
            value={form.vendor}
            onChange={(e) => setForm({ ...form, vendor: e.target.value })}
            onBlur={() => handleFieldBlur("vendor", form.vendor)}
          />
        </div>

        <div>
          <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
            Description
          </label>
          <textarea
            className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent/50 resize-y"
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            onBlur={() => handleFieldBlur("description", form.description)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          {renderNumericField("quantity", "Quantity", form.quantity)}
          <div>
            <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
              UOM
            </label>
            {catDef?.validUoms && catDef.validUoms.length > 0 ? (
              <Select
                className="mt-1"
                value={form.uom}
                onChange={(e) => {
                  setForm({ ...form, uom: e.target.value });
                  handleFieldBlur("uom", e.target.value);
                }}
              >
                {catDef.validUoms.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </Select>
            ) : (
              <Input
                className="mt-1"
                value={form.uom}
                onChange={(e) => setForm({ ...form, uom: e.target.value })}
                onBlur={() => handleFieldBlur("uom", form.uom)}
              />
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {renderNumericField("cost", "Cost", form.cost)}
          {renderNumericField("markup", "Markup", form.markup)}
          {renderNumericField("price", "Price", form.price)}
        </div>

        <div className="grid grid-cols-2 gap-3 p-3 bg-panel2/30 rounded-lg">
          <div>
            <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
              Ext. Cost
            </label>
            <div className="mt-1 text-sm font-medium tabular-nums">
              {formatMoney(extCost, 2)}
            </div>
          </div>
          <div>
            <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
              Margin
            </label>
            <div className="mt-1 text-sm font-medium tabular-nums">{margin}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {renderNumericField(
            "unit1",
            catDef?.unitLabels.unit1 || "Unit 1",
            form.unit1,
          )}
          {renderNumericField(
            "unit2",
            catDef?.unitLabels.unit2 || "Unit 2",
            form.unit2,
          )}
          {renderNumericField(
            "unit3",
            catDef?.unitLabels.unit3 || "Unit 3",
            form.unit3,
          )}
        </div>

        <div>
          <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
            Phase
          </label>
          <Select
            className="mt-1"
            value={form.phaseId}
            onChange={(e) => {
              setForm({ ...form, phaseId: e.target.value });
              handleFieldBlur("phaseId", e.target.value);
            }}
          >
            <option value="">None</option>
            {(workspace.phases ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.number} - {p.name}
              </option>
            ))}
          </Select>
        </div>

        {calcInfoText && (
          <div className="flex items-start gap-2 rounded-lg bg-accent/5 border border-accent/10 px-3 py-2.5">
            <Info className="h-3.5 w-3.5 mt-0.5 text-accent/60 shrink-0" />
            <span className="text-xs text-fg/50">{calcInfoText}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
