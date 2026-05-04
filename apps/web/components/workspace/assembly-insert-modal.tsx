"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, Edit3, Layers, Plus, RefreshCw, Search, Sparkles, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type AssemblyInstanceSummary,
  type AssemblyParameterRecord,
  type AssemblyPreviewResult,
  type AssemblyRecord,
  type AssemblySummaryRecord,
  type WorkspaceResponse,
  createAssembly,
  deleteAssembly,
  deleteAssemblyInstance,
  getAssembly,
  insertAssemblyIntoWorksheet,
  listAssemblies,
  listAssemblyInstances,
  previewAssemblyExpansion,
  resyncAssemblyInstance,
} from "@/lib/api";
import { Button, Input, Label, ModalBackdrop, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import {
  AssemblyHeaderEditor,
  ComponentsEditor,
  ParametersEditor,
  useAssemblyAuthoringContext,
} from "@/components/assembly-authoring";

interface AssemblyInsertModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  worksheetId: string | null;
  phaseId?: string | null;
  onInserted: (workspace: WorkspaceResponse, info: { warnings: string[]; itemIds: string[] }) => void;
}

type ScopeTab = "library" | "groups";
type PaneMode = "insert" | "author";

export function AssemblyInsertModal({
  open,
  onClose,
  projectId,
  worksheetId,
  phaseId,
  onInserted,
}: AssemblyInsertModalProps) {
  const [list, setList] = useState<AssemblySummaryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AssemblyRecord | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState("1");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paneMode, setPaneMode] = useState<PaneMode>("insert");
  const [preview, setPreview] = useState<AssemblyPreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [scope, setScope] = useState<ScopeTab>("library");
  const [instances, setInstances] = useState<AssemblyInstanceSummary[]>([]);
  const [instancesLoading, setInstancesLoading] = useState(false);
  const [editingInstanceId, setEditingInstanceId] = useState<string | null>(null);
  const [editingInstanceDetail, setEditingInstanceDetail] = useState<AssemblyRecord | null>(null);
  const [editInstanceQty, setEditInstanceQty] = useState("1");
  const [editInstanceParams, setEditInstanceParams] = useState<Record<string, string>>({});
  const [instanceBusy, setInstanceBusy] = useState(false);

  const { catalogItems, rateItems, laborUnits, effectiveCosts } = useAssemblyAuthoringContext();

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

  const reloadDetail = useCallback(async (id: string) => {
    try {
      const row = await getAssembly(id);
      setDetail(row);
      const initial: Record<string, string> = {};
      for (const p of row.parameters) initial[p.key] = p.defaultValue ?? "";
      setParamValues((prev) => {
        const next = { ...initial };
        for (const k of Object.keys(prev)) {
          if (k in initial && prev[k] !== undefined) next[k] = prev[k]!;
        }
        return next;
      });
    } catch (e: any) {
      setError(e?.message ?? "Failed to load assembly");
    }
  }, []);

  const refreshInstances = useCallback(async () => {
    if (!worksheetId) {
      setInstances([]);
      return;
    }
    setInstancesLoading(true);
    try {
      const rows = await listAssemblyInstances(projectId, worksheetId);
      setInstances(rows);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load groups");
    } finally {
      setInstancesLoading(false);
    }
  }, [projectId, worksheetId]);

  useEffect(() => {
    if (open) {
      setError(null);
      void refreshList();
      void refreshInstances();
    } else {
      setSelectedId(null);
      setDetail(null);
      setSearch("");
      setQuantity("1");
      setParamValues({});
      setError(null);
      setPaneMode("insert");
      setScope("library");
      setEditingInstanceId(null);
      setEditingInstanceDetail(null);
    }
  }, [open, refreshList, refreshInstances]);

  // Load detail of the assembly tied to the instance the user is editing.
  useEffect(() => {
    if (!editingInstanceId) {
      setEditingInstanceDetail(null);
      return;
    }
    const inst = instances.find((i) => i.id === editingInstanceId);
    if (!inst || !inst.assemblyId) {
      setEditingInstanceDetail(null);
      return;
    }
    setEditInstanceQty(String(inst.quantity));
    const initial: Record<string, string> = {};
    for (const [k, v] of Object.entries(inst.parameterValues ?? {})) initial[k] = String(v);
    setEditInstanceParams(initial);
    void getAssembly(inst.assemblyId).then(setEditingInstanceDetail).catch(() => setEditingInstanceDetail(null));
  }, [editingInstanceId, instances]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void reloadDetail(selectedId);
  }, [selectedId, reloadDetail]);

  // Debounced cost preview when in insert mode and parameters/quantity change.
  useEffect(() => {
    if (!detail || paneMode !== "insert") {
      setPreview(null);
      return;
    }
    const qty = Number.parseFloat(quantity);
    if (!Number.isFinite(qty)) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await previewAssemblyExpansion({
          assemblyId: detail.id,
          quantity: qty,
          parameterValues: paramValues,
        });
        if (!cancelled) setPreview(result);
      } catch {
        if (!cancelled) setPreview(null);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [detail, paneMode, quantity, paramValues]);

  const filtered = useMemo(() => {
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(
      (a) => a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q) || a.category.toLowerCase().includes(q),
    );
  }, [list, search]);

  const otherAssemblyOptions = useMemo(
    () => list.filter((a) => a.id !== detail?.id).map((a) => ({ id: a.id, label: a.name, unit: a.unit })),
    [list, detail?.id],
  );

  const handleCreate = useCallback(async () => {
    setError(null);
    try {
      const created = await createAssembly({ name: "New assembly", unit: "EA" });
      await refreshList();
      setSelectedId(created.id);
      setPaneMode("author");
    } catch (e: any) {
      setError(e?.message ?? "Failed to create assembly");
    }
  }, [refreshList]);

  const handleDelete = useCallback(async () => {
    if (!detail) return;
    if (!confirm(`Delete assembly "${detail.name}"? This cannot be undone.`)) return;
    setError(null);
    try {
      await deleteAssembly(detail.id);
      setSelectedId(null);
      setDetail(null);
      setPaneMode("insert");
      await refreshList();
    } catch (e: any) {
      setError(e?.message ?? "Failed to delete assembly");
    }
  }, [detail, refreshList]);

  const handleInsert = useCallback(async () => {
    if (!detail || !worksheetId) return;
    const qty = Number.parseFloat(quantity);
    if (!Number.isFinite(qty)) {
      setError("Quantity must be a number");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await insertAssemblyIntoWorksheet(projectId, worksheetId, {
        assemblyId: detail.id,
        quantity: qty,
        parameterValues: paramValues,
        phaseId: phaseId ?? null,
      });
      onInserted(result.workspace, { warnings: result.insertion.warnings, itemIds: result.insertion.itemIds });
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed to insert assembly");
    } finally {
      setSubmitting(false);
    }
  }, [detail, worksheetId, projectId, quantity, paramValues, phaseId, onInserted, onClose]);

  const refreshDetailAndList = useCallback(() => {
    if (selectedId) void reloadDetail(selectedId);
    void refreshList();
  }, [selectedId, reloadDetail, refreshList]);

  const handleDeleteInstance = useCallback(
    async (instanceId: string) => {
      if (!confirm("Delete this assembly group and all its line items?")) return;
      setInstanceBusy(true);
      setError(null);
      try {
        const result = await deleteAssemblyInstance(projectId, instanceId);
        // Reuse onInserted to bubble the workspace back up to the parent.
        onInserted(result.workspace, { warnings: [], itemIds: [] });
        await refreshInstances();
        if (editingInstanceId === instanceId) setEditingInstanceId(null);
      } catch (e: any) {
        setError(e?.message ?? "Failed to delete group");
      } finally {
        setInstanceBusy(false);
      }
    },
    [projectId, refreshInstances, editingInstanceId, onInserted],
  );

  const handleResyncInstance = useCallback(
    async (instanceId: string, opts?: { quantity?: number; parameterValues?: Record<string, string> }) => {
      setInstanceBusy(true);
      setError(null);
      try {
        const result = await resyncAssemblyInstance(projectId, instanceId, {
          quantity: opts?.quantity,
          parameterValues: opts?.parameterValues,
        });
        onInserted(result.workspace, { warnings: result.resync.warnings, itemIds: result.resync.itemIds });
        await refreshInstances();
        setEditingInstanceId(null);
      } catch (e: any) {
        setError(e?.message ?? "Failed to re-sync");
      } finally {
        setInstanceBusy(false);
      }
    },
    [projectId, refreshInstances, onInserted],
  );

  if (!open) return null;

  const canInsert = detail !== null && detail.components.length > 0;

  return (
    <ModalBackdrop open={open} onClose={onClose}>
      <div className="bg-panel rounded-lg shadow-2xl w-[860px] max-w-[95vw] h-[680px] max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-fg/10">
          <div className="flex items-center gap-3">
            <Layers className="w-4 h-4" />
            <div className="flex gap-1 rounded-md bg-panel2/45 p-0.5">
              <button
                onClick={() => setScope("library")}
                className={cn(
                  "px-2.5 py-1 text-[11px] rounded transition-colors",
                  scope === "library" ? "bg-panel text-fg shadow-sm" : "text-fg/45 hover:text-fg/75",
                )}
              >
                Library
              </button>
              <button
                onClick={() => {
                  setScope("groups");
                  void refreshInstances();
                }}
                className={cn(
                  "px-2.5 py-1 text-[11px] rounded transition-colors",
                  scope === "groups" ? "bg-panel text-fg shadow-sm" : "text-fg/45 hover:text-fg/75",
                )}
              >
                Groups{worksheetId && instances.length > 0 ? ` (${instances.length})` : ""}
              </button>
            </div>
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

        {scope === "library" ? (
        <div className="flex-1 grid grid-cols-[260px_1fr] gap-0 overflow-hidden">
          {/* List */}
          <div className="border-r border-fg/10 flex flex-col">
            <div className="p-3 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg/40" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search"
                  className="pl-7 text-xs"
                />
              </div>
              <Button size="sm" onClick={handleCreate} className="text-xs px-2 py-1.5" title="Create new assembly">
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
              {loading && <div className="text-xs text-fg/40 p-2">Loading…</div>}
              {!loading && filtered.length === 0 && (
                <div className="text-xs text-fg/40 p-2">
                  No assemblies. Click <Plus className="inline w-3 h-3 align-text-bottom" /> to create one.
                </div>
              )}
              {filtered.map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    setSelectedId(a.id);
                    setPaneMode("insert");
                  }}
                  className={cn(
                    "w-full text-left px-2.5 py-2 rounded-md border transition-colors",
                    selectedId === a.id ? "bg-panel2 border-fg/20" : "border-transparent hover:bg-panel2/60",
                  )}
                >
                  <div className="text-xs font-medium truncate">{a.name || "Untitled"}</div>
                  <div className="text-[10px] text-fg/45 truncate">
                    {a.code || "no code"} · per {a.unit || "EA"} · {a.componentCount} comp · {a.parameterCount} param
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Detail / Form */}
          <div className="flex flex-col overflow-hidden">
            {!detail ? (
              <div className="flex flex-col items-center justify-center text-xs text-fg/40 h-full gap-3 p-6">
                <Sparkles className="w-5 h-5 text-fg/30" />
                <div>Select an assembly on the left, or create a new one.</div>
                <Button size="sm" onClick={handleCreate} className="text-xs">
                  <Plus className="w-3.5 h-3.5 mr-1" /> New assembly
                </Button>
              </div>
            ) : paneMode === "author" ? (
              <Tabs defaultValue="components" className="flex flex-col flex-1 overflow-hidden">
                <div className="px-4 py-2 border-b border-fg/10 flex items-center justify-between gap-2">
                  <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="parameters">
                      Parameters
                      <span className="ml-1 text-fg/35">{detail.parameters.length}</span>
                    </TabsTrigger>
                    <TabsTrigger value="components">
                      Components
                      <span className="ml-1 text-fg/35">{detail.components.length}</span>
                    </TabsTrigger>
                  </TabsList>
                  <Button size="sm" variant="ghost" onClick={() => setPaneMode("insert")} className="text-xs" disabled={!canInsert}>
                    Done — go to insert
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  <TabsContent value="overview" className="space-y-3 m-0">
                    <AssemblyHeaderEditor
                      assembly={detail}
                      onChange={refreshDetailAndList}
                      onDelete={handleDelete}
                      onError={setError}
                    />
                  </TabsContent>
                  <TabsContent value="parameters" className="m-0">
                    <ParametersEditor
                      assemblyId={detail.id}
                      parameters={detail.parameters}
                      onChange={refreshDetailAndList}
                      onError={setError}
                    />
                  </TabsContent>
                  <TabsContent value="components" className="m-0">
	                    <ComponentsEditor
	                      assemblyId={detail.id}
	                      components={detail.components}
	                      parameters={detail.parameters}
	                      catalogItems={catalogItems}
	                      rateItems={rateItems}
	                      laborUnits={laborUnits}
	                      effectiveCosts={effectiveCosts}
	                      otherAssemblyOptions={otherAssemblyOptions}
	                      onChange={refreshDetailAndList}
	                      onError={setError}
                    />
                  </TabsContent>
                </div>
              </Tabs>
            ) : (
              <>
                <div className="px-4 py-2 border-b border-fg/10 flex items-center justify-between gap-2">
                  <div className="text-xs font-medium truncate">{detail.name}</div>
                  <Button size="sm" variant="ghost" onClick={() => setPaneMode("author")} className="text-xs">
                    <Edit3 className="w-3.5 h-3.5 mr-1" /> Edit
                  </Button>
                </div>
                <div className="p-4 overflow-y-auto flex-1 space-y-3">
                  {detail.description && <div className="text-xs text-fg/50">{detail.description}</div>}

                  <div>
                    <Label className="text-[10px]">Quantity (number of {detail.unit || "EA"})</Label>
                    <Input
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      className="text-xs font-mono"
                      placeholder="1"
                    />
                  </div>

                  {detail.parameters.length > 0 && (
                    <div>
                      <Label className="text-[10px] mb-1">Parameters</Label>
                      <div className="space-y-2">
                        {detail.parameters.map((p) => (
                          <ParamInput
                            key={p.id}
                            parameter={p}
                            value={paramValues[p.key] ?? ""}
                            onChange={(next) => setParamValues((prev) => ({ ...prev, [p.key]: next }))}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <Label className="text-[10px]">Preview</Label>
                    {!preview && !previewLoading && (
                      <div className="text-[11px] text-fg/40">Set a quantity to preview the expansion.</div>
                    )}
                    {previewLoading && <div className="text-[11px] text-fg/40">Calculating…</div>}
                    {preview && (
                      <div className="rounded-md border border-fg/10 bg-panel2/40">
                        <div className="px-3 py-2 border-b border-fg/10 flex items-center justify-between text-[11px]">
                          <div className="text-fg/60">
                            <span className="font-medium text-fg">{preview.totals.lineCount}</span> line
                            {preview.totals.lineCount === 1 ? "" : "s"}
                          </div>
                          <div className="flex gap-3 tabular-nums">
                            <div>
                              <span className="text-fg/40">cost</span>{" "}
                              <span className="font-medium text-fg">{formatCurrency(preview.totals.cost)}</span>
                            </div>
                            <div>
                              <span className="text-fg/40">price</span>{" "}
                              <span className="font-medium text-fg">{formatCurrency(preview.totals.price)}</span>
                            </div>
                          </div>
                        </div>
                        {preview.resourceRollup?.length > 0 && (
                          <div className="border-b border-fg/10">
                            <div className="px-3 py-2 flex items-center justify-between text-[11px]">
                              <div className="flex items-center gap-1.5 font-medium text-fg/70">
                                <Boxes className="w-3.5 h-3.5" />
                                Resource recipe
                              </div>
                              <div className="text-fg/45">
                                {preview.resourceRollup.length} resource
                                {preview.resourceRollup.length === 1 ? "" : "s"}
                              </div>
                            </div>
                            <div className="max-h-[128px] overflow-y-auto">
                              {preview.resourceRollup.map((resource) => (
                                <div
                                  key={resource.key}
                                  className="px-3 py-1.5 text-[11px] border-t border-fg/5 first:border-t-0 grid grid-cols-[1fr_82px_76px_76px] gap-2 items-center"
                                >
                                  <div className="min-w-0">
                                    <div className="truncate">
                                      <span className="text-fg/40 mr-2">{resource.category}</span>
                                      {resource.entityName}
                                    </div>
                                    <div className="text-[10px] text-fg/35 truncate">
                                      {resource.componentCount} component{resource.componentCount === 1 ? "" : "s"}
                                    </div>
                                  </div>
                                  <div className="text-right text-fg/55 tabular-nums">
                                    {formatNumber(resource.quantity)} {resource.uom}
                                  </div>
                                  <div className="text-right text-fg/55 tabular-nums">
                                    {formatCurrency(resource.lineCost)}
                                  </div>
                                  <div className="text-right text-fg/55 tabular-nums">
                                    {formatCurrency(resource.linePrice)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="px-3 py-1.5 text-[10px] font-medium uppercase text-fg/35 border-b border-fg/10">
                          Expanded lines
                        </div>
                        <div className="max-h-[180px] overflow-y-auto">
                          {preview.items.map((it, idx) => (
                            <div
                              key={`${it.entityName}-${idx}`}
                              className="px-3 py-1.5 text-[11px] border-b border-fg/5 last:border-b-0 grid grid-cols-[1fr_70px_70px_70px] gap-2 items-center"
                            >
                              <div className="truncate">
                                <span className="text-fg/40 mr-2">{it.category}</span>
                                {it.entityName}
                              </div>
                              <div className="text-right text-fg/55 tabular-nums">
                                {it.quantity.toFixed(2)} {it.uom}
                              </div>
                              <div className="text-right text-fg/55 tabular-nums">{formatCurrency(it.lineCost)}</div>
                              <div className="text-right text-fg/55 tabular-nums">{formatCurrency(it.linePrice)}</div>
                            </div>
                          ))}
                        </div>
                        {preview.warnings.length > 0 && (
                          <div className="px-3 py-2 text-[11px] text-amber-400 border-t border-fg/10 space-y-0.5">
                            {preview.warnings.map((w, i) => (
                              <div key={i}>⚠ {w}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="px-4 py-3 border-t border-fg/10 flex items-center justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleInsert}
                    disabled={submitting || !worksheetId || !canInsert}
                    className="text-xs"
                  >
                    {submitting ? "Inserting…" : "Insert into worksheet"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
        ) : (
          /* ── Groups in this worksheet ── */
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {!worksheetId && (
              <div className="text-xs text-fg/40 py-12 text-center">No worksheet selected.</div>
            )}
            {worksheetId && instancesLoading && <div className="text-xs text-fg/40">Loading…</div>}
            {worksheetId && !instancesLoading && instances.length === 0 && (
              <div className="text-xs text-fg/40 py-12 text-center">
                No assembly groups in this worksheet yet. Switch to <button onClick={() => setScope("library")} className="underline">Library</button> to insert one.
              </div>
            )}
            {instances.map((inst) => (
              <div key={inst.id} className="rounded-md border border-fg/10 bg-panel2/40">
                <div className="px-3 py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">{inst.assemblyName ?? "(deleted assembly)"}</div>
                    <div className="text-[10px] text-fg/45 truncate">
                      qty {inst.quantity} · {inst.itemCount} line{inst.itemCount === 1 ? "" : "s"}
                      {Object.keys(inst.parameterValues).length > 0 &&
                        ` · ${Object.entries(inst.parameterValues)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(", ")}`}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingInstanceId(editingInstanceId === inst.id ? null : inst.id)}
                      disabled={!inst.assemblyId || instanceBusy}
                      className="text-xs"
                      title={!inst.assemblyId ? "Source assembly was deleted" : "Re-sync or scale"}
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeleteInstance(inst.id)}
                      disabled={instanceBusy}
                      className="text-xs text-red-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {editingInstanceId === inst.id && editingInstanceDetail && (
                  <div className="px-3 py-3 border-t border-fg/10 space-y-2">
                    <div>
                      <Label className="text-[10px]">Quantity</Label>
                      <Input
                        value={editInstanceQty}
                        onChange={(e) => setEditInstanceQty(e.target.value)}
                        className="text-xs font-mono"
                      />
                    </div>
                    {editingInstanceDetail.parameters.length > 0 && (
                      <div className="space-y-1.5">
                        <Label className="text-[10px]">Parameters</Label>
                        {editingInstanceDetail.parameters.map((p) => (
                          <div key={p.id} className="grid grid-cols-[1fr_120px_60px] gap-2 items-center">
                            <div className="text-xs">
                              <div className="font-medium">{p.label || p.key}</div>
                              {!p.label && <div className="text-[10px] font-mono text-fg/45">{p.key}</div>}
                            </div>
                            <Input
                              value={editInstanceParams[p.key] ?? ""}
                              onChange={(e) => setEditInstanceParams((prev) => ({ ...prev, [p.key]: e.target.value }))}
                              className="text-xs font-mono"
                              placeholder={p.defaultValue}
                            />
                            <div className="text-[10px] text-fg/45">{p.unit}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex justify-end gap-2 pt-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditingInstanceId(null)} className="text-xs">
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          const qty = Number.parseFloat(editInstanceQty);
                          if (!Number.isFinite(qty)) {
                            setError("Quantity must be a number");
                            return;
                          }
                          void handleResyncInstance(inst.id, { quantity: qty, parameterValues: editInstanceParams });
                        }}
                        disabled={instanceBusy}
                        className="text-xs"
                      >
                        {instanceBusy ? "Re-syncing…" : "Re-sync"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
}

function formatCurrency(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
}

function ParamInput({
  parameter,
  value,
  onChange,
}: {
  parameter: AssemblyParameterRecord;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_120px_60px] gap-2 items-center">
      <div className="text-xs">
        <div className="font-medium">{parameter.label || parameter.key}</div>
        {parameter.description && <div className="text-[10px] text-fg/45">{parameter.description}</div>}
        {!parameter.label && <div className="text-[10px] font-mono text-fg/45">{parameter.key}</div>}
      </div>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="text-xs font-mono" placeholder={parameter.defaultValue} />
      <div className="text-[10px] text-fg/45">{parameter.unit}</div>
    </div>
  );
}
