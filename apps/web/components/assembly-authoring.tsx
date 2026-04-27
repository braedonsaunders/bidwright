"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Layers, Plus, Trash2, Variable } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type AssemblyComponentRecord,
  type AssemblyComponentTypeValue,
  type AssemblyParameterRecord,
  type AssemblyRecord,
  type CatalogItem,
  type CatalogSummary,
  type RateSchedule,
  createAssemblyComponent,
  createAssemblyParameter,
  deleteAssemblyComponent,
  deleteAssemblyParameter,
  getCatalogs,
  listCatalogItems,
  listRateSchedules,
  updateAssembly,
  updateAssemblyComponent,
  updateAssemblyParameter,
} from "@/lib/api";
import { Badge, Button, Input, Label, Select } from "@/components/ui";

export interface CatalogItemRow {
  id: string;
  code: string;
  name: string;
  unit: string;
  catalogName: string;
}

export interface RateItemRow {
  id: string;
  code: string;
  name: string;
  unit: string;
  scheduleName: string;
}

export interface AssemblyOption {
  id: string;
  label: string;
  unit: string;
}

const COMPONENT_TYPE_LABELS: Record<AssemblyComponentTypeValue, string> = {
  catalog_item: "Catalog item",
  rate_schedule_item: "Rate-schedule item",
  sub_assembly: "Sub-assembly",
};

// Loads catalog items + rate-schedule items from the API. Used by both the
// settings-page authoring view and the estimate-page quick-create flow so the
// pickers are populated identically.
export function useAssemblyAuthoringContext() {
  const [catalogItems, setCatalogItems] = useState<CatalogItemRow[]>([]);
  const [rateItems, setRateItems] = useState<RateItemRow[]>([]);
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
              scheduleName: sched.name,
            });
          }
        }
        if (!cancelled) setRateItems(flat);
      } catch {
        /* ignore */
      }

      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { catalogItems, rateItems, loaded };
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
    <div className="grid grid-cols-2 gap-3 p-3 rounded-md border border-fg/10 bg-panel2/40">
      <div className="col-span-2">
        <Label className="text-[10px]">Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== assembly.name && commit({ name })}
          className="text-xs"
        />
      </div>
      <div>
        <Label className="text-[10px]">Code</Label>
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onBlur={() => code !== assembly.code && commit({ code })}
          className="text-xs"
        />
      </div>
      <div>
        <Label className="text-[10px]">Category</Label>
        <Input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          onBlur={() => category !== assembly.category && commit({ category })}
          className="text-xs"
        />
      </div>
      <div>
        <Label className="text-[10px]">Unit (per assembly)</Label>
        <Input
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          onBlur={() => unit !== assembly.unit && commit({ unit })}
          className="text-xs"
        />
      </div>
      <div className="col-span-2">
        <Label className="text-[10px]">Description</Label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => description !== assembly.description && commit({ description })}
          className="text-xs"
        />
      </div>
      {onDelete && (
        <div className="col-span-2 flex justify-end">
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
          <Input value={draftUnit} onChange={(e) => setDraftUnit(e.target.value)} placeholder="unit" className="text-xs" />
          <Button onClick={add} disabled={!draftKey.trim()} className="text-xs">
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
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
      <Input
        value={defaultValue}
        onChange={(e) => setDefaultValue(e.target.value)}
        onBlur={() => defaultValue !== parameter.defaultValue && onPatch({ defaultValue })}
        className="text-xs font-mono"
      />
      <Input
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
        onBlur={() => unit !== parameter.unit && onPatch({ unit })}
        className="text-xs"
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
  otherAssemblyOptions,
  onChange,
  onError,
}: ComponentsEditorProps) {
  const [draftType, setDraftType] = useState<AssemblyComponentTypeValue>("catalog_item");
  const [draftRef, setDraftRef] = useState("");
  const [draftQty, setDraftQty] = useState("1");

  const add = useCallback(async () => {
    if (!draftRef) return;
    onError(null);
    try {
      const payload: Parameters<typeof createAssemblyComponent>[1] = {
        componentType: draftType,
        quantityExpr: draftQty || "1",
      };
      if (draftType === "catalog_item") payload.catalogItemId = draftRef;
      else if (draftType === "rate_schedule_item") payload.rateScheduleItemId = draftRef;
      else payload.subAssemblyId = draftRef;
      await createAssemblyComponent(assemblyId, payload);
      setDraftRef("");
      setDraftQty("1");
      onChange();
    } catch (e: any) {
      onError(e?.message ?? "Failed to add component");
    }
  }, [assemblyId, draftType, draftRef, draftQty, onChange, onError]);

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

  const refOptions = useMemo(() => {
    if (draftType === "catalog_item") {
      return catalogItems.map((c) => ({
        id: c.id,
        label: `${c.code ? `${c.code} — ` : ""}${c.name}`,
        secondary: `${c.catalogName} · ${c.unit}`,
      }));
    }
    if (draftType === "rate_schedule_item") {
      return rateItems.map((r) => ({
        id: r.id,
        label: `${r.code ? `${r.code} — ` : ""}${r.name}`,
        secondary: `${r.scheduleName} · ${r.unit}`,
      }));
    }
    return otherAssemblyOptions.map((a) => ({ id: a.id, label: a.label, secondary: a.unit }));
  }, [draftType, catalogItems, rateItems, otherAssemblyOptions]);

  return (
    <div className="rounded-md border border-fg/10 bg-panel2/40">
      <div className="px-3 py-2 border-b border-fg/10 flex items-center gap-2">
        <Layers className="w-3.5 h-3.5 text-fg/60" />
        <div className="text-xs font-medium">Components</div>
        <span className="text-[10px] text-fg/40">{components.length}</span>
      </div>
      <div className="p-3 space-y-2">
        {components.length === 0 && (
          <div className="text-[11px] text-fg/40">No components. Add a catalog item, labour rate, or sub-assembly.</div>
        )}
        {components.map((c) => (
          <ComponentRow
            key={c.id}
            component={c}
            catalogItems={catalogItems}
            rateItems={rateItems}
            otherAssemblyOptions={otherAssemblyOptions}
            parameters={parameters}
            onPatch={(patchData) => patch(c.id, patchData)}
            onRemove={() => remove(c.id)}
          />
        ))}
        <div className="grid grid-cols-[140px_1fr_120px_auto] gap-2 pt-2 border-t border-fg/10">
          <Select value={draftType} onChange={(e) => { setDraftType(e.target.value as AssemblyComponentTypeValue); setDraftRef(""); }} className="text-xs">
            {(["catalog_item", "rate_schedule_item", "sub_assembly"] as AssemblyComponentTypeValue[]).map((t) => (
              <option key={t} value={t}>{COMPONENT_TYPE_LABELS[t]}</option>
            ))}
          </Select>
          <Select value={draftRef} onChange={(e) => setDraftRef(e.target.value)} className="text-xs">
            <option value="">Choose…</option>
            {refOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label} ({opt.secondary})</option>
            ))}
          </Select>
          <Input value={draftQty} onChange={(e) => setDraftQty(e.target.value)} placeholder="qty / expr" className="text-xs font-mono" />
          <Button onClick={add} disabled={!draftRef} className="text-xs">
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function ComponentRow({
  component,
  catalogItems,
  rateItems,
  otherAssemblyOptions,
  parameters,
  onPatch,
  onRemove,
}: {
  component: AssemblyComponentRecord;
  catalogItems: CatalogItemRow[];
  rateItems: RateItemRow[];
  otherAssemblyOptions: AssemblyOption[];
  parameters: AssemblyParameterRecord[];
  onPatch: (patch: Partial<AssemblyComponentRecord>) => void;
  onRemove: () => void;
}) {
  const [qty, setQty] = useState(component.quantityExpr);
  const [bindingsText, setBindingsText] = useState(JSON.stringify(component.parameterBindings ?? {}));
  const [bindingsValid, setBindingsValid] = useState(true);

  useEffect(() => {
    setQty(component.quantityExpr);
    setBindingsText(JSON.stringify(component.parameterBindings ?? {}));
  }, [component.id, component.quantityExpr, component.parameterBindings]);

  const refLabel = useMemo(() => {
    if (component.componentType === "catalog_item") {
      const ci = catalogItems.find((c) => c.id === component.catalogItemId);
      return ci ? `${ci.code ? `${ci.code} — ` : ""}${ci.name} (${ci.catalogName})` : "(catalog item missing)";
    }
    if (component.componentType === "rate_schedule_item") {
      const ri = rateItems.find((r) => r.id === component.rateScheduleItemId);
      return ri ? `${ri.code ? `${ri.code} — ` : ""}${ri.name} (${ri.scheduleName})` : "(rate item missing)";
    }
    const sub = otherAssemblyOptions.find((a) => a.id === component.subAssemblyId);
    return sub ? `${sub.label} (sub-assembly)` : "(sub-assembly missing)";
  }, [component, catalogItems, rateItems, otherAssemblyOptions]);

  const isSubAssembly = component.componentType === "sub_assembly";

  return (
    <div className="grid grid-cols-[120px_1fr_120px_auto] gap-2 items-start py-2 border-b border-fg/5 last:border-b-0">
      <Badge tone="default" className="text-[9px]">
        {COMPONENT_TYPE_LABELS[component.componentType]}
      </Badge>
      <div className="flex flex-col gap-1 min-w-0">
        <div className="text-xs truncate">{refLabel}</div>
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
      </div>
      <Input
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        onBlur={() => qty !== component.quantityExpr && onPatch({ quantityExpr: qty || "1" })}
        placeholder="qty / expr"
        className="text-xs font-mono"
      />
      <Button variant="ghost" onClick={onRemove} className="text-xs text-fg/50 hover:text-red-400">
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
