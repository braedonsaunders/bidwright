"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Layers, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type AssemblyParameterRecord,
  type AssemblyRecord,
  type AssemblySummaryRecord,
  type WorkspaceResponse,
  getAssembly,
  insertAssemblyIntoWorksheet,
  listAssemblies,
} from "@/lib/api";
import { Button, Input, Label, ModalBackdrop } from "@/components/ui";

interface AssemblyInsertModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  worksheetId: string | null;
  phaseId?: string | null;
  onInserted: (workspace: WorkspaceResponse, info: { warnings: string[]; itemIds: string[] }) => void;
}

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

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    listAssemblies()
      .then((rows) => setList(rows))
      .catch((e: any) => setError(e?.message ?? "Failed to load assemblies"))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setDetail(null);
      setSearch("");
      setQuantity("1");
      setParamValues({});
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    getAssembly(selectedId)
      .then((row) => {
        if (cancelled) return;
        setDetail(row);
        const initial: Record<string, string> = {};
        for (const p of row.parameters) initial[p.key] = p.defaultValue ?? "";
        setParamValues(initial);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message ?? "Failed to load assembly");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const filtered = useMemo(() => {
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(
      (a) => a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q) || a.category.toLowerCase().includes(q),
    );
  }, [list, search]);

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

  if (!open) return null;

  return (
    <ModalBackdrop open={open} onClose={onClose}>
      <div className="bg-panel rounded-lg shadow-2xl w-[760px] max-w-[95vw] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-fg/10">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            <div className="text-sm font-medium">Insert assembly into worksheet</div>
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
            <div className="p-3 relative">
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg/40" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search assemblies"
                className="pl-7 text-xs"
              />
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
              {loading && <div className="text-xs text-fg/40 p-2">Loading…</div>}
              {!loading && filtered.length === 0 && (
                <div className="text-xs text-fg/40 p-2">No assemblies match.</div>
              )}
              {filtered.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setSelectedId(a.id)}
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
              <div className="flex items-center justify-center text-xs text-fg/40 h-full">
                Select an assembly to insert
              </div>
            ) : (
              <>
                <div className="p-4 overflow-y-auto flex-1 space-y-3">
                  <div>
                    <div className="text-sm font-medium">{detail.name}</div>
                    {detail.description && <div className="text-xs text-fg/50 mt-1">{detail.description}</div>}
                  </div>

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
                        <div className="text-[11px] text-fg/40 p-3">This assembly has no components yet.</div>
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
                  <Button size="sm" onClick={handleInsert} disabled={submitting || !worksheetId} className="text-xs">
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
