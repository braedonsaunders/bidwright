"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ChevronDown, Copy, Info, Puzzle, Trash2, X } from "lucide-react";
import type {
  EntityCategory,
  ProjectWorkspaceData,
  WorksheetItemPatchInput,
  WorkspaceWorksheetItem,
} from "@/lib/api";
import { listPluginExecutions } from "@/lib/api";
import {
  categoryAllowsEditingUnitSlot,
  getCalculationTypeOption,
  getCategoryUnitLabel,
} from "@/lib/entity-category-calculation";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, Input, Select, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { UomSelect } from "@/components/shared/uom-select";
import { ItemPluginTab } from "./item-plugin-tab";

export interface ItemDetailDrawerProps {
  item: WorkspaceWorksheetItem;
  workspace: ProjectWorkspaceData;
  entityCategories: EntityCategory[];
  onPatchItem: (itemId: string, patch: WorksheetItemPatchInput) => void;
  onDelete: (itemId: string) => void;
  onDuplicate: (itemId: string) => void;
  onRefreshWorkspace: () => void;
  onError: (message: string) => void;
  onClose: () => void;
}

export function ItemDetailDrawer({
  item,
  workspace,
  entityCategories,
  onPatchItem,
  onDelete,
  onDuplicate,
  onRefreshWorkspace,
  onError,
  onClose,
}: ItemDetailDrawerProps) {
  const [showSources, setShowSources] = useState(!!item.sourceNotes);
  const [activeTab, setActiveTab] = useState("details");
  const [showPluginTab, setShowPluginTab] = useState(false);
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
    masterFormatCode: typeof item.classification?.masterformat === "string" ? item.classification.masterformat : "",
    costCode: item.costCode ?? "",
    sourceNotes: item.sourceNotes ?? "",
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
      masterFormatCode: typeof item.classification?.masterformat === "string" ? item.classification.masterformat : "",
      costCode: item.costCode ?? "",
      sourceNotes: item.sourceNotes ?? "",
    });
    setShowSources(!!item.sourceNotes);
    setActiveTab("details");
  }, [item]);

  useEffect(() => {
    let cancelled = false;

    setShowPluginTab(false);

    listPluginExecutions(workspace.project.id)
      .then((executions) => {
        if (cancelled) {
          return;
        }
        setShowPluginTab(
          executions.some(
            (execution) =>
              execution.output?.type === "line_items" &&
              (execution.appliedLineItemIds ?? []).includes(item.id),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setShowPluginTab(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [item.id, workspace.project.id]);

  const catDef = entityCategories.find((c) => c.name === item.category);
  const ws = (workspace.worksheets ?? []).find((w) => w.id === item.worksheetId);
  const extCost = item.cost * item.quantity;
  const margin =
    item.price > 0
      ? ((item.price - extCost) / item.price * 100).toFixed(1) + "%"
      : "--";

  function nextClassification(key: string, value: string) {
    const next = { ...(item.classification ?? {}) };
    if (form.masterFormatCode.trim()) {
      next.masterformat = form.masterFormatCode.trim();
    }
    if (form.costCode.trim()) {
      next.costCode = form.costCode.trim();
    }
    const trimmed = value.trim();
    if (trimmed) {
      next[key] = trimmed;
    } else {
      delete next[key];
    }
    return next;
  }

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
    } else if (field === "masterFormatCode") {
      patch = { classification: nextClassification("masterformat", String(value)) };
    } else if (field === "costCode") {
      patch = {
        costCode: String(value).trim() || null,
        classification: nextClassification("costCode", String(value)),
      };
    } else {
      patch = { [field]: value };
    }

    onPatchItem(item.id, patch);
  }

  const isEditable = (field: string) => {
    if (!catDef) return true;
    if (field === "unit1" || field === "unit2" || field === "unit3") {
      return categoryAllowsEditingUnitSlot(catDef, field);
    }
    return catDef.editableFields?.[field as keyof typeof catDef.editableFields] !== false;
  };

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
    if (catDef.calculationType === "formula" && catDef.calcFormula) {
      return `Formula: ${catDef.calcFormula}`;
    }
    return getCalculationTypeOption(catDef.calculationType).description;
  })();

  return (
    <motion.div
      initial={{ x: showPluginTab && activeTab === "plugin" ? 760 : 420 }}
      animate={{ x: 0 }}
      exit={{ x: showPluginTab && activeTab === "plugin" ? 760 : 420 }}
      transition={{ type: "spring", damping: 30, stiffness: 300 }}
      className={cn(
        "fixed inset-y-0 right-0 z-40 border-l border-line bg-panel shadow-2xl flex flex-col",
        showPluginTab && activeTab === "plugin" ? "w-full max-w-[780px]" : "w-full max-w-[420px]",
      )}
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
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex min-h-0 flex-1 flex-col"
      >
        {showPluginTab && (
          <div className="border-b border-line px-4 py-2">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="plugin" className="gap-1.5">
                <Puzzle className="h-3.5 w-3.5" />
                Plugin
              </TabsTrigger>
            </TabsList>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <TabsContent value="details" className="mt-0 space-y-4">
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
                Line Item Name
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
                    onValueChange={(v) => {
                      setForm({ ...form, uom: v });
                      handleFieldBlur("uom", v);
                    }}
                    options={catDef.validUoms.map((u) => ({ value: u, label: u }))}
                  />
                ) : (
                  <UomSelect
                    className="mt-1"
                    value={form.uom}
                    onValueChange={(v) => {
                      setForm({ ...form, uom: v });
                      handleFieldBlur("uom", v);
                    }}
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
                getCategoryUnitLabel(catDef, "unit1", "Unit 1"),
                form.unit1,
              )}
              {renderNumericField(
                "unit2",
                getCategoryUnitLabel(catDef, "unit2", "Unit 2"),
                form.unit2,
              )}
              {renderNumericField(
                "unit3",
                getCategoryUnitLabel(catDef, "unit3", "Unit 3"),
                form.unit3,
              )}
            </div>

            <div>
              <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
                Phase
              </label>
              <Select
                className="mt-1"
                value={form.phaseId || "__none__"}
                onValueChange={(v) => {
                  const next = v === "__none__" ? "" : v;
                  setForm({ ...form, phaseId: next });
                  handleFieldBlur("phaseId", next);
                }}
                options={[
                  { value: "__none__", label: "None" },
                  ...(workspace.phases ?? []).map((p) => ({ value: p.id, label: `${p.number} - ${p.name}` })),
                ]}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
                  MasterFormat
                </label>
                <Input
                  className="mt-1"
                  value={form.masterFormatCode}
                  onChange={(e) => setForm({ ...form, masterFormatCode: e.target.value })}
                  onBlur={() => handleFieldBlur("masterFormatCode", form.masterFormatCode)}
                  placeholder="03 30 00"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
                  Cost Code
                </label>
                <Input
                  className="mt-1"
                  value={form.costCode}
                  onChange={(e) => setForm({ ...form, costCode: e.target.value })}
                  onBlur={() => handleFieldBlur("costCode", form.costCode)}
                  placeholder="03-0330"
                />
              </div>
            </div>

            <div className="border border-line rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setShowSources(!showSources)}
                className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-medium text-fg/40 uppercase tracking-wider hover:bg-panel2/30 transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  Sources & Notes
                  {form.sourceNotes && (
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent/60" />
                  )}
                </span>
                <ChevronDown className={cn("h-3 w-3 transition-transform", showSources && "rotate-180")} />
              </button>
              {showSources && (
                <div className="px-3 pb-3">
                  <textarea
                    className="w-full rounded border border-line bg-bg px-3 py-2 text-xs font-mono leading-relaxed outline-none focus:border-accent/50 resize-y"
                    rows={6}
                    placeholder="Knowledge book refs, dataset lookups, correction factors, web search results, assumptions..."
                    value={form.sourceNotes}
                    onChange={(e) => setForm({ ...form, sourceNotes: e.target.value })}
                    onBlur={() => handleFieldBlur("sourceNotes", form.sourceNotes)}
                  />
                </div>
              )}
            </div>

            {calcInfoText && (
              <div className="flex items-start gap-2 rounded-lg bg-accent/5 border border-accent/10 px-3 py-2.5">
                <Info className="h-3.5 w-3.5 mt-0.5 text-accent/60 shrink-0" />
                <span className="text-xs text-fg/50">{calcInfoText}</span>
              </div>
            )}
          </TabsContent>

          {showPluginTab && (
            <TabsContent value="plugin" className="mt-0">
              <ItemPluginTab
                item={item}
                workspace={workspace}
                onRefreshWorkspace={onRefreshWorkspace}
                onError={onError}
              />
            </TabsContent>
          )}
        </div>
      </Tabs>
    </motion.div>
  );
}
