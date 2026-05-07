"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Layers, Plus, Trash2, Variable } from "lucide-react";
import { evalExpression } from "@bidwright/domain";
import { cn } from "@/lib/utils";
import {
  type AssemblyComponentRecord,
  type AssemblyComponentTypeValue,
  type AssemblyParameterRecord,
  type AssemblyRecord,
  type CatalogItem,
  type CatalogSummary,
  type EffectiveCostRecord,
  type LaborUnitRecord,
  type RateSchedule,
  createAssemblyComponent,
  createAssemblyParameter,
  deleteAssemblyComponent,
  deleteAssemblyParameter,
  getCatalogs,
  listEffectiveCosts,
  listCatalogItems,
  listLaborUnits,
  listRateSchedules,
  updateAssembly,
  updateAssemblyComponent,
  updateAssemblyParameter,
} from "@/lib/api";
import { Badge, Button, CompactSelect, Input, Label } from "@/components/ui";
import { SearchablePicker, type SearchablePickerOption } from "@/components/shared/searchable-picker";
import { UomSelect } from "@/components/shared/uom-select";

export interface CatalogItemRow {
  id: string;
  code: string;
  name: string;
  unit: string;
  unitCost: number;
  unitPrice: number;
  catalogName: string;
}

export interface RateItemRow {
  id: string;
  code: string;
  name: string;
  unit: string;
  unitCost: number;
  unitPrice: number;
  scheduleName: string;
}

export interface LaborUnitRow {
  id: string;
  code: string;
  name: string;
  provider: string;
  discipline: string;
  category: string;
  className: string;
  subClassName: string;
  outputUom: string;
  hoursNormal: number;
}

export interface EffectiveCostRow {
  id: string;
  resourceId: string | null;
  catalogItemId: string | null;
  code: string;
  name: string;
  description: string;
  category: string;
  resourceType: string;
  uom: string;
  defaultUom: string;
  unitCost: number;
  unitPrice: number | null;
  vendorName: string;
  region: string;
  method: string;
  effectiveDate: string | null;
  confidence: number;
}

export interface AssemblyOption {
  id: string;
  label: string;
  unit: string;
}

const COMPONENT_TYPE_LABELS: Record<AssemblyComponentTypeValue, string> = {
  catalog_item: "Catalog item",
  rate_schedule_item: "Rate-schedule item",
  labor_unit: "Labor unit",
  cost_intelligence: "Cost Intelligence",
  sub_assembly: "Sub-assembly",
};
const COMPONENT_GRID_COLUMNS = "grid-cols-[0.9fr_minmax(0,2.4fr)_0.78fr_0.5fr_0.78fr_0.62fr_0.85fr_32px]";

function firstFiniteNumber(values: unknown) {
  if (!values || typeof values !== "object") return 0;
  for (const value of Object.values(values as Record<string, unknown>)) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function formatCurrency(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatNumber(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: Number.isInteger(value) ? 0 : Math.min(2, digits),
  }).format(value);
}

function formatPercent(value: number | null | undefined, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: digits,
  }).format(value);
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function metadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" ? value.trim() : "";
}

function effectiveCostItem(cost: EffectiveCostRecord) {
  const costItem = metadataObject(cost.metadata?.costItem);
  return {
    code: cost.resource?.code || metadataString(costItem, "code"),
    name: cost.resource?.name?.trim() || metadataString(costItem, "name") || "Cost intelligence item",
    description: cost.resource?.description || metadataString(costItem, "description"),
    category: cost.resource?.category || metadataString(costItem, "category"),
    resourceType: cost.resource?.resourceType || metadataString(costItem, "resourceType"),
    defaultUom: cost.resource?.defaultUom || metadataString(costItem, "defaultUom") || cost.uom || "EA",
  };
}

function formatMarkupInput(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "";
  return String(Math.round(value * 1000) / 10);
}

function parseNullableNumber(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function parseMarkupPercent(value: string): number | null | undefined {
  const numeric = parseNullableNumber(value);
  return numeric === undefined || numeric === null ? numeric : numeric / 100;
}

// Loads assembly component sources from the API. Used by both the
// settings-page authoring view and the estimate-page quick-create flow so the
// pickers are populated identically.
export function useAssemblyAuthoringContext() {
  const [catalogItems, setCatalogItems] = useState<CatalogItemRow[]>([]);
  const [rateItems, setRateItems] = useState<RateItemRow[]>([]);
  const [laborUnits, setLaborUnits] = useState<LaborUnitRow[]>([]);
  const [effectiveCosts, setEffectiveCosts] = useState<EffectiveCostRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cats: CatalogSummary[] = await getCatalogs();
        const allItems: CatalogItemRow[] = [];
        for (const cat of cats) {
          try {
            const items: CatalogItem[] = await listCatalogItems(cat.id);
            for (const it of items) {
              allItems.push({
                id: it.id,
                code: it.code,
                name: it.name,
                unit: it.unit,
                unitCost: it.unitCost,
                unitPrice: it.unitPrice,
                catalogName: cat.name,
              });
            }
          } catch {
            /* ignore */
          }
        }
        if (!cancelled) setCatalogItems(allItems);
      } catch {
        /* ignore */
      }

      try {
        const schedules: RateSchedule[] = await listRateSchedules();
        const flat: RateItemRow[] = [];
        for (const sched of schedules) {
          for (const it of sched.items ?? []) {
            flat.push({
              id: it.id,
              code: it.code,
              name: it.name,
              unit: it.unit,
              unitCost: firstFiniteNumber(it.costRates),
              unitPrice: firstFiniteNumber(it.rates),
              scheduleName: sched.name,
            });
          }
        }
        if (!cancelled) setRateItems(flat);
      } catch {
        /* ignore */
      }

      try {
        const result = await listLaborUnits({ limit: 750 });
        const flat: LaborUnitRow[] = (result.units ?? []).map((unit: LaborUnitRecord) => ({
          id: unit.id,
          code: unit.code,
          name: unit.name,
          provider: String(unit.sourceRef?.provider ?? unit.discipline ?? "").trim(),
          discipline: unit.discipline,
          category: unit.category,
          className: unit.className,
          subClassName: unit.subClassName,
          outputUom: unit.outputUom,
          hoursNormal: unit.hoursNormal,
        }));
        if (!cancelled) setLaborUnits(flat);
      } catch {
        /* ignore */
      }

      try {
        const rows = await listEffectiveCosts({ limit: 5000 });
        const flat: EffectiveCostRow[] = rows.map((cost: EffectiveCostRecord) => {
          const item = effectiveCostItem(cost);
          return {
            id: cost.id,
            resourceId: cost.resourceId,
            catalogItemId: cost.resource?.catalogItemId ?? null,
            code: item.code,
            name: item.name,
            description: item.description,
            category: item.category,
            resourceType: item.resourceType,
            uom: cost.uom,
            defaultUom: item.defaultUom,
            unitCost: cost.unitCost,
            unitPrice: cost.unitPrice ?? null,
            vendorName: cost.vendorName,
            region: cost.region,
            method: cost.method,
            effectiveDate: cost.effectiveDate,
            confidence: cost.confidence,
          };
        });
        if (!cancelled) setEffectiveCosts(flat);
      } catch {
        /* ignore */
      }

      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { catalogItems, rateItems, laborUnits, effectiveCosts, loaded };
}

export interface AssemblyHeaderEditorProps {
  assembly: AssemblyRecord;
  onChange: () => void;
  onDelete?: () => void;
  onError: (msg: string | null) => void;
}

export function AssemblyHeaderEditor({ assembly, onChange, onDelete, onError }: AssemblyHeaderEditorProps) {
  const [name, setName] = useState(assembly.name);
  const [code, setCode] = useState(assembly.code);
  const [category, setCategory] = useState(assembly.category);
  const [unit, setUnit] = useState(assembly.unit);
  const [description, setDescription] = useState(assembly.description);

  useEffect(() => {
    setName(assembly.name);
    setCode(assembly.code);
    setCategory(assembly.category);
    setUnit(assembly.unit);
    setDescription(assembly.description);
  }, [assembly.id, assembly.name, assembly.code, assembly.category, assembly.unit, assembly.description]);

  const commit = useCallback(
    async (patch: Partial<AssemblyRecord>) => {
      onError(null);
      try {
        await updateAssembly(assembly.id, patch);
        onChange();
      } catch (e: any) {
        onError(e?.message ?? "Failed to update assembly");
      }
    },
    [assembly.id, onChange, onError],
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px] gap-3 rounded-md border border-fg/10 bg-panel2/40 p-3">
      <div className="col-span-3">
        <Label className="text-[10px]">Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== assembly.name && commit({ name })}
          className="text-xs"
        />
      </div>
      <div className="min-w-0">
        <Label className="text-[10px]">Code</Label>
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onBlur={() => code !== assembly.code && commit({ code })}
          className="text-xs"
        />
      </div>
      <div className="min-w-0">
        <Label className="text-[10px]">Category</Label>
        <Input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          onBlur={() => category !== assembly.category && commit({ category })}
          className="text-xs"
        />
      </div>
      <div className="min-w-0">
        <Label className="text-[10px]">Unit</Label>
        <UomSelect
          compact
          value={unit}
          onValueChange={(v) => {
            setUnit(v);
            if (v !== assembly.unit) commit({ unit: v });
          }}
          placeholder="Unit"
        />
      </div>
      <div className="col-span-3">
        <Label className="text-[10px]">Description</Label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => description !== assembly.description && commit({ description })}
          className="text-xs"
        />
      </div>
      {onDelete && (
        <div className="col-span-3 flex justify-end">
          <Button variant="ghost" onClick={onDelete} className="text-xs text-red-400">
            <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete assembly
          </Button>
        </div>
      )}
    </div>
  );
}

export interface ParametersEditorProps {
  assemblyId: string;
  parameters: AssemblyParameterRecord[];
  onChange: () => void;
  onError: (msg: string | null) => void;
}

export function ParametersEditor({ assemblyId, parameters, onChange, onError }: ParametersEditorProps) {
  const [draftKey, setDraftKey] = useState("");
  const [draftDefault, setDraftDefault] = useState("0");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftUnit, setDraftUnit] = useState("");

  const add = useCallback(async () => {
    if (!draftKey.trim()) return;
    onError(null);
    try {
      await createAssemblyParameter(assemblyId, {
        key: draftKey.trim(),
        label: draftLabel,
        defaultValue: draftDefault,
        unit: draftUnit,
      });
      setDraftKey("");
      setDraftLabel("");
      setDraftDefault("0");
      setDraftUnit("");
      onChange();
    } catch (e: any) {
      onError(e?.message ?? "Failed to add parameter");
    }
  }, [assemblyId, draftKey, draftLabel, draftDefault, draftUnit, onChange, onError]);

  const patch = useCallback(
    async (id: string, patchData: Partial<AssemblyParameterRecord>) => {
      onError(null);
      try {
        await updateAssemblyParameter(assemblyId, id, patchData);
        onChange();
      } catch (e: any) {
        onError(e?.message ?? "Failed to update parameter");
      }
    },
    [assemblyId, onChange, onError],
  );

  const remove = useCallback(
    async (id: string) => {
      onError(null);
      try {
        await deleteAssemblyParameter(assemblyId, id);
        onChange();
      } catch (e: any) {
        onError(e?.message ?? "Failed to delete parameter");
      }
    },
    [assemblyId, onChange, onError],
  );

  return (
    <div className="rounded-md border border-fg/10 bg-panel2/40">
      <div className="px-3 py-2 border-b border-fg/10 flex items-center gap-2">
        <Variable className="w-3.5 h-3.5 text-fg/60" />
        <div className="text-xs font-medium">Parameters</div>
        <span className="text-[10px] text-fg/40">{parameters.length}</span>
      </div>
      <div className="p-3 space-y-2">
        {parameters.length === 0 && (
          <div className="text-[11px] text-fg/40">
            No parameters. Add one to make component quantities scale dynamically (e.g. <code>wallHeight</code>).
          </div>
        )}
        {parameters.map((p) => (
          <ParameterRow
            key={p.id}
            parameter={p}
            onPatch={(patchData) => patch(p.id, patchData)}
            onRemove={() => remove(p.id)}
          />
        ))}
        <div className="grid grid-cols-[1fr_1fr_1fr_80px_auto] gap-2 pt-2 border-t border-fg/10">
          <Input value={draftKey} onChange={(e) => setDraftKey(e.target.value)} placeholder="key (e.g. wallHeight)" className="text-xs" />
          <Input value={draftLabel} onChange={(e) => setDraftLabel(e.target.value)} placeholder="label" className="text-xs" />
          <Input value={draftDefault} onChange={(e) => setDraftDefault(e.target.value)} placeholder="default" className="text-xs" />
          <UomSelect
            compact
            value={draftUnit}
            onValueChange={setDraftUnit}
            includeBlank
            blankLabel="—"
            placeholder="unit"
          />
          <Button onClick={add} disabled={!draftKey.trim()} className="text-xs">
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function validateExpression(expr: string, scope: Record<string, number>): { ok: boolean; message?: string; value?: number } {
  if (!expr || !expr.trim()) return { ok: true, value: 0 };
  try {
    const value = evalExpression(expr, scope);
    if (!Number.isFinite(value)) return { ok: false, message: "Expression evaluates to a non-finite value" };
    return { ok: true, value };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

function ParameterRow({
  parameter,
  onPatch,
  onRemove,
}: {
  parameter: AssemblyParameterRecord;
  onPatch: (patch: Partial<AssemblyParameterRecord>) => void;
  onRemove: () => void;
}) {
  const [key, setKey] = useState(parameter.key);
  const [label, setLabel] = useState(parameter.label);
  const [defaultValue, setDefaultValue] = useState(parameter.defaultValue);
  const [unit, setUnit] = useState(parameter.unit);

  useEffect(() => {
    setKey(parameter.key);
    setLabel(parameter.label);
    setDefaultValue(parameter.defaultValue);
    setUnit(parameter.unit);
  }, [parameter.id, parameter.key, parameter.label, parameter.defaultValue, parameter.unit]);

  const defaultValidation = useMemo(() => validateExpression(defaultValue, {}), [defaultValue]);

  return (
    <div className="grid grid-cols-[1fr_1fr_1fr_80px_auto] gap-2 items-center">
      <Input
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onBlur={() => key !== parameter.key && onPatch({ key })}
        className="text-xs font-mono"
      />
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => label !== parameter.label && onPatch({ label })}
        className="text-xs"
      />
      <div className="flex flex-col gap-0.5">
        <Input
          value={defaultValue}
          onChange={(e) => setDefaultValue(e.target.value)}
          onBlur={() => defaultValue !== parameter.defaultValue && defaultValidation.ok && onPatch({ defaultValue })}
          className={cn("text-xs font-mono", !defaultValidation.ok && "border-red-400")}
          title={defaultValidation.ok ? "" : defaultValidation.message}
        />
        {!defaultValidation.ok && (
          <div className="text-[9px] text-red-400 truncate" title={defaultValidation.message}>
            {defaultValidation.message}
          </div>
        )}
      </div>
      <UomSelect
        compact
        value={unit}
        onValueChange={(v) => {
          setUnit(v);
          if (v !== parameter.unit) onPatch({ unit: v });
        }}
        includeBlank
        blankLabel="—"
        placeholder="Unit"
      />
      <Button variant="ghost" onClick={onRemove} className="text-xs text-fg/50 hover:text-red-400">
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

export interface ComponentsEditorProps {
  assemblyId: string;
  components: AssemblyComponentRecord[];
  parameters: AssemblyParameterRecord[];
  catalogItems: CatalogItemRow[];
  rateItems: RateItemRow[];
  laborUnits: LaborUnitRow[];
  effectiveCosts: EffectiveCostRow[];
  otherAssemblyOptions: AssemblyOption[];
  onChange: () => void;
  onError: (msg: string | null) => void;
}

export function ComponentsEditor({
  assemblyId,
  components,
  parameters,
  catalogItems,
  rateItems,
  laborUnits,
  effectiveCosts,
  otherAssemblyOptions,
  onChange,
  onError,
}: ComponentsEditorProps) {
  const [draftType, setDraftType] = useState<AssemblyComponentTypeValue>("catalog_item");
  const [draftRef, setDraftRef] = useState("");
  const [draftLaborRateRef, setDraftLaborRateRef] = useState("");
  const [draftQty, setDraftQty] = useState("1");
  const [draftUom, setDraftUom] = useState("");
  const [draftCost, setDraftCost] = useState("");
  const [draftMarkup, setDraftMarkup] = useState("");

  const add = useCallback(async () => {
    if (!draftRef) return;
    onError(null);
    try {
      const costOverride = parseNullableNumber(draftCost);
      const markupOverride = parseMarkupPercent(draftMarkup);
      if (costOverride === undefined || markupOverride === undefined) {
        onError("Cost and markup overrides must be valid numbers.");
        return;
      }
      const payload: Parameters<typeof createAssemblyComponent>[1] = {
        componentType: draftType,
        quantityExpr: draftQty || "1",
        uomOverride: draftUom.trim() || null,
        costOverride,
        markupOverride,
      };
      if (draftType === "catalog_item") payload.catalogItemId = draftRef;
      else if (draftType === "rate_schedule_item") payload.rateScheduleItemId = draftRef;
      else if (draftType === "labor_unit") {
        if (!draftLaborRateRef) {
          onError("Choose a labor rate for the labor unit.");
          return;
        }
        payload.laborUnitId = draftRef;
        payload.rateScheduleItemId = draftLaborRateRef;
      }
      else if (draftType === "cost_intelligence") {
        const cost = effectiveCosts.find((candidate) => candidate.id === draftRef);
        payload.effectiveCostId = draftRef;
        payload.costResourceId = cost?.resourceId ?? null;
      }
      else payload.subAssemblyId = draftRef;
      await createAssemblyComponent(assemblyId, payload);
      setDraftRef("");
      setDraftLaborRateRef("");
      setDraftQty("1");
      setDraftUom("");
      setDraftCost("");
      setDraftMarkup("");
      onChange();
    } catch (e: any) {
      onError(e?.message ?? "Failed to add component");
    }
  }, [assemblyId, draftCost, draftLaborRateRef, draftMarkup, draftQty, draftRef, draftType, draftUom, effectiveCosts, onChange, onError]);

  const patch = useCallback(
    async (id: string, patchData: Partial<AssemblyComponentRecord>) => {
      onError(null);
      try {
        await updateAssemblyComponent(assemblyId, id, patchData);
        onChange();
      } catch (e: any) {
        onError(e?.message ?? "Failed to update component");
      }
    },
    [assemblyId, onChange, onError],
  );

  const remove = useCallback(
    async (id: string) => {
      onError(null);
      try {
        await deleteAssemblyComponent(assemblyId, id);
        onChange();
      } catch (e: any) {
        onError(e?.message ?? "Failed to remove component");
      }
    },
    [assemblyId, onChange, onError],
  );

  const refOptions: SearchablePickerOption[] = useMemo(() => {
    if (draftType === "catalog_item") {
      return catalogItems.map((c) => ({
        id: c.id,
        label: c.name,
        code: c.code || undefined,
        secondary: c.unit,
        group: c.catalogName || "Uncategorized",
      }));
    }
    if (draftType === "rate_schedule_item") {
      return rateItems.map((r) => ({
        id: r.id,
        label: r.name,
        code: r.code || undefined,
        secondary: r.unit,
        group: r.scheduleName || "Uncategorized",
      }));
    }
    if (draftType === "labor_unit") {
      return laborUnits.map((unit) => ({
        id: unit.id,
        label: unit.name,
        code: unit.code || undefined,
        secondary: `${formatNumber(unit.hoursNormal)} hr/${unit.outputUom || "EA"}`,
        group: [unit.category, unit.className].filter(Boolean).join(" / ") || unit.discipline || "Labor Units",
      }));
    }
    if (draftType === "cost_intelligence") {
      return effectiveCosts.map((cost) => ({
        id: cost.id,
        label: cost.name,
        code: cost.code || undefined,
        secondary: `${formatCurrency(cost.unitCost)} / ${cost.uom || cost.defaultUom || "EA"}`,
        group: [cost.category || cost.resourceType || "Cost Intelligence", cost.vendorName].filter(Boolean).join(" / "),
      }));
    }
    return otherAssemblyOptions.map((a) => ({
      id: a.id,
      label: a.label,
      secondary: a.unit,
    }));
  }, [draftType, catalogItems, rateItems, laborUnits, effectiveCosts, otherAssemblyOptions]);

  const refSearchPlaceholder =
    draftType === "catalog_item"
      ? "Search catalog items by name, code, or catalog…"
      : draftType === "rate_schedule_item"
      ? "Search labor rates by name, code, or schedule…"
      : draftType === "labor_unit"
      ? "Search labor units by category, class, or hours…"
      : draftType === "cost_intelligence"
      ? "Search Cost Intelligence by item, code, vendor, or category…"
      : "Search assemblies by name…";

  const refEmptyMessage =
    draftType === "catalog_item"
      ? "No catalog items available. Add some in Settings → Items & Catalogs."
      : draftType === "rate_schedule_item"
      ? "No rate-schedule items available. Add some in Settings → Rate Schedules."
      : draftType === "labor_unit"
      ? "No labor units available. Add labor-unit catalogs from your own source data."
      : draftType === "cost_intelligence"
      ? "No cost intelligence costs available. Add cost basis rows in Library → Cost Intelligence."
      : "No other assemblies available to nest.";

  return (
    <div className="rounded-md border border-fg/10 bg-panel2/40">
      <div className="px-3 py-2 border-b border-fg/10 flex items-center gap-2">
        <Layers className="w-3.5 h-3.5 text-fg/60" />
        <div className="text-xs font-medium">Components</div>
        <span className="text-[10px] text-fg/40">{components.length}</span>
      </div>
      <div className="p-3">
        {components.length === 0 && (
	          <div className="mb-3 text-[11px] text-fg/40">No components. Add a catalog item, labor rate, cost basis, or sub-assembly.</div>
        )}
        <div className="min-w-0 overflow-hidden">
          <div className="w-full min-w-0">
            <div className={cn("grid gap-2 border-b border-fg/10 px-1 pb-2 text-[10px] font-medium uppercase tracking-wide text-fg/35", COMPONENT_GRID_COLUMNS)}>
              <div className="min-w-0 truncate">Type</div>
              <div className="min-w-0 truncate">Component</div>
              <div className="min-w-0 truncate">Qty</div>
              <div className="min-w-0 truncate">UOM</div>
              <div className="min-w-0 truncate">Unit Cost</div>
              <div className="min-w-0 truncate">MU %</div>
              <div className="min-w-0 truncate">Ext. Cost</div>
              <div />
            </div>
            {components.map((c) => (
	              <ComponentRow
	                key={c.id}
	                component={c}
	                catalogItems={catalogItems}
	                rateItems={rateItems}
	                laborUnits={laborUnits}
	                effectiveCosts={effectiveCosts}
	                otherAssemblyOptions={otherAssemblyOptions}
	                parameters={parameters}
                onPatch={(patchData) => patch(c.id, patchData)}
                onRemove={() => remove(c.id)}
              />
            ))}
            <div className={cn("grid items-start gap-2 border-t border-fg/10 px-1 pt-3", COMPONENT_GRID_COLUMNS)}>
              <div className="min-w-0">
                <CompactSelect
                  value={draftType}
                  onValueChange={(v) => {
                    setDraftType(v as AssemblyComponentTypeValue);
                    setDraftRef("");
                    setDraftLaborRateRef("");
                  }}
                  options={(["catalog_item", "rate_schedule_item", "labor_unit", "cost_intelligence", "sub_assembly"] as AssemblyComponentTypeValue[]).map((t) => ({
                    value: t,
                    label: COMPONENT_TYPE_LABELS[t],
                  }))}
                />
              </div>
              <div className="min-w-0">
                <SearchablePicker
                  value={draftRef || null}
                  options={refOptions}
                  onSelect={(id) => setDraftRef(id)}
                  placeholder="Choose…"
                  searchPlaceholder={refSearchPlaceholder}
                  emptyMessage={refEmptyMessage}
                />
              </div>
              <Input value={draftQty} onChange={(e) => setDraftQty(e.target.value)} placeholder="qty / expr" className="h-7 min-w-0 text-xs font-mono" />
              <UomSelect
                compact
                value={draftUom}
                onValueChange={setDraftUom}
                includeBlank
                blankLabel="Source"
                placeholder="uom"
              />
              {draftType === "labor_unit" ? (
                <SearchablePicker
                  value={draftLaborRateRef || null}
                  options={rateItems.map((r) => ({
                    id: r.id,
                    label: r.name,
                    code: r.code || undefined,
                    secondary: r.unit,
                    group: r.scheduleName || "Rates",
                  }))}
                  onSelect={(id) => setDraftLaborRateRef(id)}
                  placeholder="Labor rate"
                  searchPlaceholder="Search labor rates…"
                  emptyMessage="No rate items available."
                />
              ) : (
                <Input value={draftCost} onChange={(e) => setDraftCost(e.target.value)} placeholder="source" type="number" step="0.01" className="h-7 min-w-0 text-xs tabular-nums" />
              )}
              <Input value={draftMarkup} onChange={(e) => setDraftMarkup(e.target.value)} placeholder="0" type="number" step="0.1" className="h-7 min-w-0 text-xs tabular-nums" />
              <div className="flex h-7 min-w-0 items-center justify-end truncate rounded-md border border-line/70 bg-bg/30 px-2 text-xs text-fg/35">auto</div>
              <Button onClick={add} disabled={!draftRef || (draftType === "labor_unit" && !draftLaborRateRef)} className="h-7 min-w-0 px-2 text-xs" title="Add component">
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ComponentRow({
  component,
  catalogItems,
  rateItems,
  laborUnits,
  effectiveCosts,
  otherAssemblyOptions,
  parameters,
  onPatch,
  onRemove,
	}: {
	  component: AssemblyComponentRecord;
	  catalogItems: CatalogItemRow[];
	  rateItems: RateItemRow[];
	  laborUnits: LaborUnitRow[];
	  effectiveCosts: EffectiveCostRow[];
	  otherAssemblyOptions: AssemblyOption[];
  parameters: AssemblyParameterRecord[];
  onPatch: (patch: Partial<AssemblyComponentRecord>) => void;
  onRemove: () => void;
}) {
  const [qty, setQty] = useState(component.quantityExpr);
  const [uomDraft, setUomDraft] = useState(component.uomOverride ?? "");
  const [costDraft, setCostDraft] = useState(component.costOverride == null ? "" : String(component.costOverride));
  const [markupDraft, setMarkupDraft] = useState(formatMarkupInput(component.markupOverride));
  const [bindingsText, setBindingsText] = useState(JSON.stringify(component.parameterBindings ?? {}));
  const [bindingsValid, setBindingsValid] = useState(true);

  useEffect(() => {
    setQty(component.quantityExpr);
    setUomDraft(component.uomOverride ?? "");
    setCostDraft(component.costOverride == null ? "" : String(component.costOverride));
    setMarkupDraft(formatMarkupInput(component.markupOverride));
    setBindingsText(JSON.stringify(component.parameterBindings ?? {}));
  }, [component.id, component.quantityExpr, component.uomOverride, component.costOverride, component.markupOverride, component.parameterBindings]);

  // Validate the quantity expression against all known parameter keys (using
  // their defaults as sample values) so users see syntax / unknown-identifier
  // errors before they save.
  const qtyScope = useMemo(() => {
    const scope: Record<string, number> = {};
    for (const p of parameters) {
      try {
        scope[p.key] = evalExpression(p.defaultValue || "0", {});
      } catch {
        scope[p.key] = 0;
      }
    }
    return scope;
  }, [parameters]);
  const qtyValidation = useMemo(() => validateExpression(qty, qtyScope), [qty, qtyScope]);

  const reference = useMemo(() => {
    if (component.componentType === "catalog_item") {
      const ci = catalogItems.find((c) => c.id === component.catalogItemId);
      return ci
        ? {
            label: ci.name,
            code: ci.code,
            group: ci.catalogName,
            unit: ci.unit,
            unitCost: ci.unitCost,
            unitPrice: ci.unitPrice,
          }
        : { label: "(catalog item missing)", code: "", group: "", unit: "", unitCost: 0, unitPrice: 0 };
    }
    if (component.componentType === "rate_schedule_item") {
      const ri = rateItems.find((r) => r.id === component.rateScheduleItemId);
      return ri
        ? {
            label: ri.name,
            code: ri.code,
            group: ri.scheduleName,
            unit: ri.unit,
            unitCost: ri.unitCost,
            unitPrice: ri.unitPrice,
          }
        : { label: "(rate item missing)", code: "", group: "", unit: "", unitCost: 0, unitPrice: 0 };
    }
    if (component.componentType === "labor_unit") {
      const unit = laborUnits.find((candidate) => candidate.id === component.laborUnitId);
      const rate = rateItems.find((candidate) => candidate.id === component.rateScheduleItemId);
      return unit
        ? {
            label: unit.name,
            code: unit.code,
            group: [unit.category, unit.className, unit.subClassName].filter(Boolean).join(" / "),
            unit: unit.outputUom,
            unitCost: unit.hoursNormal,
            unitPrice: rate?.unitPrice ?? 0,
            rateName: rate?.name ?? "(labor rate missing)",
          }
        : { label: "(labor unit missing)", code: "", group: "", unit: "", unitCost: 0, unitPrice: 0, rateName: "" };
    }
    if (component.componentType === "cost_intelligence") {
      const cost = effectiveCosts.find((candidate) => candidate.id === component.effectiveCostId);
      return cost
        ? {
            label: cost.name,
            code: cost.code,
            group: cost.category || cost.resourceType || "Cost Intelligence",
            unit: cost.uom || cost.defaultUom,
            unitCost: cost.unitCost,
            unitPrice: cost.unitPrice ?? cost.unitCost,
            vendorName: cost.vendorName,
          }
        : { label: "(cost intelligence cost missing)", code: "", group: "", unit: "", unitCost: 0, unitPrice: 0, vendorName: "" };
    }
    const sub = otherAssemblyOptions.find((a) => a.id === component.subAssemblyId);
    return sub
      ? { label: sub.label, code: "", group: "Sub-assembly", unit: sub.unit, unitCost: 0, unitPrice: 0 }
      : { label: "(sub-assembly missing)", code: "", group: "", unit: "", unitCost: 0, unitPrice: 0 };
  }, [component, catalogItems, rateItems, laborUnits, effectiveCosts, otherAssemblyOptions]);

  const isSubAssembly = component.componentType === "sub_assembly";
  const isLaborUnit = component.componentType === "labor_unit";
  const isCostIntelligence = component.componentType === "cost_intelligence";
  const effectiveUom = component.uomOverride || reference.unit || (component.componentType === "rate_schedule_item" ? "HR" : "EA");
  const effectiveUnitCost = component.costOverride ?? reference.unitCost;
  const effectiveMarkup = component.markupOverride ?? 0;
  const quantityValue = qtyValidation.ok ? (qtyValidation.value ?? 0) : null;
  const extendedCost = quantityValue == null ? null : quantityValue * effectiveUnitCost;
  const extendedSell = extendedCost == null ? null : extendedCost * (1 + effectiveMarkup);

  function commitNullableNumber(field: "costOverride" | "markupOverride", draft: string, current: number | null) {
    const next = field === "markupOverride" ? parseMarkupPercent(draft) : parseNullableNumber(draft);
    if (next === undefined) return;
    if (next !== current) onPatch({ [field]: next } as Partial<AssemblyComponentRecord>);
  }

  return (
    <div className={cn("grid items-start gap-2 border-b border-fg/5 px-1 py-2 last:border-b-0", COMPONENT_GRID_COLUMNS)}>
      <div className="min-w-0 pt-1">
        <Badge tone="default" className="max-w-full truncate text-[9px]" title={COMPONENT_TYPE_LABELS[component.componentType]}>
          {COMPONENT_TYPE_LABELS[component.componentType]}
        </Badge>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="truncate text-xs font-medium">{reference.code ? `${reference.code} - ` : ""}{reference.label}</div>
        <div className="truncate text-[10px] text-fg/40">
          {reference.group || "Source"} · source {reference.unit || "EA"} · {isLaborUnit ? `${formatNumber(reference.unitCost)} hr/${reference.unit || "EA"}` : `cost ${formatCurrency(reference.unitCost)}`}
          {!isLaborUnit && reference.unitPrice ? ` · price ${formatCurrency(reference.unitPrice)}` : ""}
          {isCostIntelligence && "vendorName" in reference && reference.vendorName ? ` · ${reference.vendorName}` : ""}
        </div>
        {isLaborUnit && "rateName" in reference && (
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1 truncate text-[10px] text-fg/35">Rate: {reference.rateName}</div>
          </div>
        )}
        {isSubAssembly && parameters.length === 0 && component.parameterBindings && Object.keys(component.parameterBindings).length === 0 && (
          <div className="text-[10px] text-fg/40">No parameter bindings (sub-assembly will use its defaults)</div>
        )}
        {isSubAssembly && (
          <div className="flex flex-col gap-1">
            <Label className="text-[10px]">Parameter bindings (JSON, e.g. <code>{'{"count":"wallHeight"}'}</code>)</Label>
            <Input
              value={bindingsText}
              onChange={(e) => {
                setBindingsText(e.target.value);
                try {
                  JSON.parse(e.target.value);
                  setBindingsValid(true);
                } catch {
                  setBindingsValid(false);
                }
              }}
              onBlur={() => {
                if (!bindingsValid) return;
                try {
                  const parsed = JSON.parse(bindingsText);
                  onPatch({ parameterBindings: parsed });
                } catch {
                  /* keep stale */
                }
              }}
              className={cn("text-xs font-mono", !bindingsValid && "border-red-400")}
            />
          </div>
        )}
        {component.notes && <div className="truncate text-[10px] text-fg/35">{component.notes}</div>}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <Input
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onBlur={() => qty !== component.quantityExpr && qtyValidation.ok && onPatch({ quantityExpr: qty || "1" })}
          placeholder="qty / expr"
          className={cn("h-7 min-w-0 text-xs font-mono", !qtyValidation.ok && "border-red-400")}
          title={qtyValidation.ok ? "" : qtyValidation.message}
        />
        {!qtyValidation.ok && (
          <div className="text-[9px] text-red-400 truncate flex items-center gap-1" title={qtyValidation.message}>
            <AlertCircle className="w-2.5 h-2.5 shrink-0" />
            <span className="truncate">{qtyValidation.message}</span>
          </div>
        )}
        {qtyValidation.ok && qtyValidation.value !== undefined && parameters.length > 0 && (
          <div className="text-[9px] text-fg/35">≈ {formatNumber(qtyValidation.value)} with defaults</div>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <UomSelect
          compact
          value={uomDraft}
          onValueChange={(v) => {
            setUomDraft(v);
            const next = v || null;
            if (next !== (component.uomOverride ?? null)) onPatch({ uomOverride: next });
          }}
          includeBlank
          blankLabel={reference.unit ? `Source ${reference.unit}` : "Source"}
          placeholder={reference.unit || "EA"}
        />
        {component.uomOverride && <span className="text-[9px] text-accent/70">override</span>}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <Input
          value={costDraft}
          onChange={(e) => setCostDraft(e.target.value)}
          onBlur={() => commitNullableNumber("costOverride", costDraft, component.costOverride)}
          placeholder={formatNumber(reference.unitCost)}
          type="number"
          step="0.01"
          className="h-7 min-w-0 text-xs tabular-nums"
        />
        <span className="text-[9px] text-fg/35">per {effectiveUom}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <Input
          value={markupDraft}
          onChange={(e) => setMarkupDraft(e.target.value)}
          onBlur={() => commitNullableNumber("markupOverride", markupDraft, component.markupOverride)}
          placeholder="0"
          type="number"
          step="0.1"
          className="h-7 min-w-0 text-xs tabular-nums"
        />
        <span className="text-[9px] text-fg/35">{formatPercent(effectiveMarkup)}</span>
      </div>
      <div className="flex min-h-7 min-w-0 flex-col items-end justify-center rounded-md border border-line/70 bg-bg/30 px-2 py-1 text-xs font-medium tabular-nums text-fg/70">
        <span className="max-w-full truncate">{formatCurrency(extendedCost)}</span>
        {effectiveMarkup > 0 && <span className="max-w-full truncate text-[9px] font-normal text-fg/35">sell {formatCurrency(extendedSell)}</span>}
      </div>
      <Button variant="ghost" onClick={onRemove} className="h-7 px-2 text-xs text-fg/50 hover:text-red-400">
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
