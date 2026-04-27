"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Edit3, Layers, Plus, Search, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type AssemblyParameterRecord,
  type AssemblyRecord,
  type AssemblySummaryRecord,
  type WorkspaceResponse,
  createAssembly,
  deleteAssembly,
  getAssembly,
  insertAssemblyIntoWorksheet,
  listAssemblies,
} from "@/lib/api";
import { Button, Input, Label, ModalBackdrop } from "@/components/ui";
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

  const { catalogItems, rateItems } = useAssemblyAuthoringContext();

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

  useEffect(() => {
    if (open) {
      setError(null);
      void refreshList();
    } else {
      setSelectedId(null);
      setDetail(null);
      setSearch("");
      setQuantity("1");
      setParamValues({});
      setError(null);
      setPaneMode("insert");
    }
  }, [open, refreshList]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void reloadDetail(selectedId);
  }, [selectedId, reloadDetail]);

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

  if (!open) return null;

  const canInsert = detail !== null && detail.components.length > 0;

  return (
    <ModalBackdrop open={open} onClose={onClose}>
      <div className="bg-panel rounded-lg shadow-2xl w-[860px] max-w-[95vw] max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-fg/10">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            <div className="text-sm font-medium">
              {paneMode === "author" ? "Author assembly" : "Insert assembly into worksheet"}
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
              <>
                <div className="px-4 py-2 border-b border-fg/10 flex items-center justify-between gap-2">
                  <div className="text-xs text-fg/50">Edit components and parameters</div>
                  <Button size="sm" variant="ghost" onClick={() => setPaneMode("insert")} className="text-xs" disabled={!canInsert}>
                    Done — go to insert
                  </Button>
                </div>
                <div className="p-4 overflow-y-auto flex-1 space-y-3">
                  <AssemblyHeaderEditor
                    assembly={detail}
                    onChange={refreshDetailAndList}
                    onDelete={handleDelete}
                    onError={setError}
                  />
                  <ParametersEditor
                    assemblyId={detail.id}
                    parameters={detail.parameters}
                    onChange={refreshDetailAndList}
                    onError={setError}
                  />
                  <ComponentsEditor
                    assemblyId={detail.id}
                    components={detail.components}
                    parameters={detail.parameters}
                    catalogItems={catalogItems}
                    rateItems={rateItems}
                    otherAssemblyOptions={otherAssemblyOptions}
                    onChange={refreshDetailAndList}
                    onError={setError}
                  />
                </div>
              </>
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
                    <Label className="text-[10px]">Components ({detail.components.length})</Label>
                    <div className="rounded-md border border-fg/10 bg-panel2/40 max-h-[180px] overflow-y-auto">
                      {detail.components.length === 0 && (
                        <div className="text-[11px] text-fg/40 p-3">
                          This assembly has no components yet.{" "}
                          <button onClick={() => setPaneMode("author")} className="underline text-fg/60">
                            Add some
                          </button>
                          .
                        </div>
                      )}
                      {detail.components.map((c) => (
                        <div key={c.id} className="px-3 py-1.5 text-[11px] border-b border-fg/5 last:border-b-0 flex items-center justify-between gap-2">
                          <div className="truncate">
                            <span className="text-fg/40 mr-2">{c.componentType.replace(/_/g, " ")}</span>
                            {c.description || c.category || "(referenced item)"}
                          </div>
                          <code className="text-fg/60 font-mono">{c.quantityExpr}</code>
                        </div>
                      ))}
                    </div>
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
      </div>
    </ModalBackdrop>
  );
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
