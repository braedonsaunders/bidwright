"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Layers, Plus, Search, Trash2, Variable } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type AssemblyComponentRecord,
  type AssemblyComponentTypeValue,
  type AssemblyParameterRecord,
  type AssemblyRecord,
  type AssemblySummaryRecord,
  type CatalogItem,
  type CatalogSummary,
  type RateSchedule,
  createAssembly,
  createAssemblyComponent,
  createAssemblyParameter,
  deleteAssembly,
  deleteAssemblyComponent,
  deleteAssemblyParameter,
  getAssembly,
  getCatalogs,
  listAssemblies,
  listCatalogItems,
  listRateSchedules,
  updateAssembly,
  updateAssemblyComponent,
  updateAssemblyParameter,
} from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Select,
} from "@/components/ui";

interface CatalogItemRow {
  id: string;
  code: string;
  name: string;
  unit: string;
  catalogName: string;
}

interface RateItemRow {
  id: string;
  code: string;
  name: string;
  unit: string;
  scheduleName: string;
}

const COMPONENT_TYPE_LABELS: Record<AssemblyComponentTypeValue, string> = {
  catalog_item: "Catalog item",
  rate_schedule_item: "Rate-schedule item",
  sub_assembly: "Sub-assembly",
};

export function AssemblyManager() {
  const [list, setList] = useState<AssemblySummaryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AssemblyRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [catalogItems, setCatalogItems] = useState<CatalogItemRow[]>([]);
  const [rateItems, setRateItems] = useState<RateItemRow[]>([]);

  const refreshList = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listAssemblies();
      setList(rows);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load assemblies");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      const row = await getAssembly(id);
      setDetail(row);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load assembly");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  // Load catalog and rate-schedule items once for component pickers
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
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(
      (a) => a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q) || a.category.toLowerCase().includes(q),
    );
  }, [list, search]);

  const handleCreate = useCallback(async () => {
    setError(null);
    try {
      const created = await createAssembly({ name: "New assembly", unit: "EA" });
      await refreshList();
      setSelectedId(created.id);
    } catch (e: any) {
      setError(e?.message ?? "Failed to create assembly");
    }
  }, [refreshList]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm("Delete this assembly? This cannot be undone.")) return;
      setError(null);
      try {
        await deleteAssembly(id);
        if (selectedId === id) setSelectedId(null);
        await refreshList();
      } catch (e: any) {
        setError(e?.message ?? "Failed to delete assembly");
      }
    },
    [refreshList, selectedId],
  );

  const handleHeaderPatch = useCallback(
    async (patch: Partial<AssemblyRecord>) => {
      if (!detail) return;
      setError(null);
      try {
        const updated = await updateAssembly(detail.id, patch);
        setDetail((prev) => (prev ? { ...prev, ...updated } : prev));
        await refreshList();
      } catch (e: any) {
        setError(e?.message ?? "Failed to update assembly");
      }
    },
    [detail, refreshList],
  );

  const otherAssemblyOptions = useMemo(
    () => list.filter((a) => a.id !== detail?.id).map((a) => ({ id: a.id, label: a.name, unit: a.unit })),
    [list, detail?.id],
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Layers className="w-4 h-4" /> Assemblies
          </CardTitle>
          <Button onClick={handleCreate} className="text-xs">
            <Plus className="w-3.5 h-3.5 mr-1" /> New assembly
          </Button>
        </div>
      </CardHeader>

      <div className="px-5 pb-5">
        <p className="text-xs text-fg/50 mb-4">
          Reusable kits of catalog items, labour rates, and nested sub-assemblies. Drop them into worksheets at a quantity to expand into priced line items.
        </p>

        {error && (
          <div className="mb-3 px-3 py-2 rounded-md bg-red-500/10 text-xs text-red-400 border border-red-500/30">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          {/* List */}
          <div className="flex flex-col">
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg/40" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search assemblies"
                className="pl-8 text-xs"
              />
            </div>
            <div className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto">
              {loading && <div className="text-xs text-fg/40 p-2">Loading…</div>}
              {!loading && filtered.length === 0 && (
                <EmptyState className="!py-8">
                  <div className="text-xs">No assemblies yet</div>
                </EmptyState>
              )}
              {filtered.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setSelectedId(a.id)}
                  className={cn(
                    "text-left px-2.5 py-2 rounded-md border transition-colors",
                    selectedId === a.id
                      ? "bg-panel2 border-fg/20"
                      : "bg-transparent border-fg/10 hover:bg-panel2/50",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">{a.name || "Untitled"}</div>
                      <div className="text-[10px] text-fg/45 truncate">
                        {a.code || "no code"} · {a.unit || "EA"} · {a.componentCount} comp · {a.parameterCount} param
                      </div>
                    </div>
                    {a.category && (
                      <Badge tone="default" className="text-[9px]">
                        {a.category}
                      </Badge>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Detail */}
          <div className="min-w-0">
            {!selectedId && (
              <EmptyState className="!py-12">
                <div className="text-xs">Select an assembly to edit</div>
              </EmptyState>
            )}
            {selectedId && detailLoading && <div className="text-xs text-fg/40 p-3">Loading…</div>}
            {selectedId && detail && (
              <AssemblyDetail
                assembly={detail}
                catalogItems={catalogItems}
                rateItems={rateItems}
                otherAssemblyOptions={otherAssemblyOptions}
                onPatch={handleHeaderPatch}
                onDelete={() => handleDelete(detail.id)}
                onChange={() => loadDetail(detail.id)}
              />
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function AssemblyDetail({
  assembly,
  catalogItems,
  rateItems,
  otherAssemblyOptions,
  onPatch,
  onDelete,
  onChange,
}: {
  assembly: AssemblyRecord;
  catalogItems: CatalogItemRow[];
  rateItems: RateItemRow[];
  otherAssemblyOptions: { id: string; label: string; unit: string }[];
  onPatch: (patch: Partial<AssemblyRecord>) => Promise<void>;
  onDelete: () => void;
  onChange: () => void;
}) {
  const [name, setName] = useState(assembly.name);
  const [code, setCode] = useState(assembly.code);
  const [category, setCategory] = useState(assembly.category);
  const [unit, setUnit] = useState(assembly.unit);
  const [description, setDescription] = useState(assembly.description);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(assembly.name);
    setCode(assembly.code);
    setCategory(assembly.category);
    setUnit(assembly.unit);
    setDescription(assembly.description);
  }, [assembly.id, assembly.name, assembly.code, assembly.category, assembly.unit, assembly.description]);

  const commitHeader = useCallback(
    () => onPatch({ name, code, category, unit, description }),
    [name, code, category, unit, description, onPatch],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="grid grid-cols-2 gap-3 p-3 rounded-md border border-fg/10 bg-panel2/40">
        <div className="col-span-2">
          <Label className="text-[10px]">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={commitHeader} className="text-xs" />
        </div>
        <div>
          <Label className="text-[10px]">Code</Label>
          <Input value={code} onChange={(e) => setCode(e.target.value)} onBlur={commitHeader} className="text-xs" />
        </div>
        <div>
          <Label className="text-[10px]">Category</Label>
          <Input value={category} onChange={(e) => setCategory(e.target.value)} onBlur={commitHeader} className="text-xs" />
        </div>
        <div>
          <Label className="text-[10px]">Unit (per assembly)</Label>
          <Input value={unit} onChange={(e) => setUnit(e.target.value)} onBlur={commitHeader} className="text-xs" />
        </div>
        <div className="col-span-2">
          <Label className="text-[10px]">Description</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} onBlur={commitHeader} className="text-xs" />
        </div>
        <div className="col-span-2 flex justify-end">
          <Button variant="ghost" onClick={onDelete} className="text-xs text-red-400">
            <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete assembly
          </Button>
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-md bg-red-500/10 text-xs text-red-400 border border-red-500/30">
          {error}
        </div>
      )}

      {/* Parameters */}
      <ParametersEditor
        assemblyId={assembly.id}
        parameters={assembly.parameters}
        onChange={onChange}
        onError={setError}
      />

      {/* Components */}
      <ComponentsEditor
        assemblyId={assembly.id}
        components={assembly.components}
        parameters={assembly.parameters}
        catalogItems={catalogItems}
        rateItems={rateItems}
        otherAssemblyOptions={otherAssemblyOptions}
        onChange={onChange}
        onError={setError}
      />
    </div>
  );
}

function ParametersEditor({
  assemblyId,
  parameters,
  onChange,
  onError,
}: {
  assemblyId: string;
  parameters: AssemblyParameterRecord[];
  onChange: () => void;
  onError: (msg: string | null) => void;
}) {
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
          <ParameterRow key={p.id} parameter={p} onPatch={(patchData) => patch(p.id, patchData)} onRemove={() => remove(p.id)} />
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
        onBlur={() => {
          if (key !== parameter.key) onPatch({ key });
        }}
        className="text-xs font-mono"
      />
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => {
          if (label !== parameter.label) onPatch({ label });
        }}
        className="text-xs"
      />
      <Input
        value={defaultValue}
        onChange={(e) => setDefaultValue(e.target.value)}
        onBlur={() => {
          if (defaultValue !== parameter.defaultValue) onPatch({ defaultValue });
        }}
        className="text-xs font-mono"
      />
      <Input
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
        onBlur={() => {
          if (unit !== parameter.unit) onPatch({ unit });
        }}
        className="text-xs"
      />
      <Button variant="ghost" onClick={onRemove} className="text-xs text-fg/50 hover:text-red-400">
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

function ComponentsEditor({
  assemblyId,
  components,
  parameters,
  catalogItems,
  rateItems,
  otherAssemblyOptions,
  onChange,
  onError,
}: {
  assemblyId: string;
  components: AssemblyComponentRecord[];
  parameters: AssemblyParameterRecord[];
  catalogItems: CatalogItemRow[];
  rateItems: RateItemRow[];
  otherAssemblyOptions: { id: string; label: string; unit: string }[];
  onChange: () => void;
  onError: (msg: string | null) => void;
}) {
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
  otherAssemblyOptions: { id: string; label: string; unit: string }[];
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
        onBlur={() => {
          if (qty !== component.quantityExpr) onPatch({ quantityExpr: qty || "1" });
        }}
        placeholder="qty / expr"
        className="text-xs font-mono"
      />
      <Button variant="ghost" onClick={onRemove} className="text-xs text-fg/50 hover:text-red-400">
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
