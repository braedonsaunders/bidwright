"use client";

import { useCallback, useEffect, useState } from "react";
import { Layers, Trash2, RefreshCw, X } from "lucide-react";
import {
  type AssemblyInstanceSummary,
  type AssemblyRecord,
  type WorkspaceResponse,
  deleteAssemblyInstance,
  getAssembly,
  listAssemblyInstances,
  resyncAssemblyInstance,
} from "@/lib/api";
import { Button, Input, Label, ModalBackdrop } from "@/components/ui";

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  worksheetId: string | null;
  onWorkspaceUpdated: (workspace: WorkspaceResponse) => void;
}

export function AssemblyInstancesModal({ open, onClose, projectId, worksheetId, onWorkspaceUpdated }: Props) {
  const [instances, setInstances] = useState<AssemblyInstanceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDetail, setEditingDetail] = useState<AssemblyRecord | null>(null);
  const [editQuantity, setEditQuantity] = useState("1");
  const [editParams, setEditParams] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!worksheetId) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await listAssemblyInstances(projectId, worksheetId);
      setInstances(rows);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load instances");
    } finally {
      setLoading(false);
    }
  }, [projectId, worksheetId]);

  useEffect(() => {
    if (open) {
      void refresh();
      setEditingId(null);
    }
  }, [open, refresh]);

  useEffect(() => {
    if (!editingId) {
      setEditingDetail(null);
      return;
    }
    const inst = instances.find((i) => i.id === editingId);
    if (!inst || !inst.assemblyId) {
      setEditingDetail(null);
      return;
    }
    setEditQuantity(String(inst.quantity));
    const initial: Record<string, string> = {};
    for (const [k, v] of Object.entries(inst.parameterValues ?? {})) initial[k] = String(v);
    setEditParams(initial);
    void getAssembly(inst.assemblyId).then(setEditingDetail).catch(() => setEditingDetail(null));
  }, [editingId, instances]);

  const handleDelete = useCallback(
    async (instanceId: string) => {
      if (!confirm("Delete this assembly group and all its line items?")) return;
      setBusy(true);
      setError(null);
      try {
        const result = await deleteAssemblyInstance(projectId, instanceId);
        onWorkspaceUpdated(result.workspace);
        await refresh();
      } catch (e: any) {
        setError(e?.message ?? "Failed to delete");
      } finally {
        setBusy(false);
      }
    },
    [projectId, refresh, onWorkspaceUpdated],
  );

  const handleResync = useCallback(
    async (instanceId: string, opts?: { quantity?: number; parameterValues?: Record<string, string> }) => {
      setBusy(true);
      setError(null);
      try {
        const result = await resyncAssemblyInstance(projectId, instanceId, {
          quantity: opts?.quantity,
          parameterValues: opts?.parameterValues,
        });
        onWorkspaceUpdated(result.workspace);
        if (result.resync.warnings.length > 0) {
          setError(`Re-synced with warnings: ${result.resync.warnings.join("; ")}`);
        }
        await refresh();
        setEditingId(null);
      } catch (e: any) {
        setError(e?.message ?? "Failed to re-sync");
      } finally {
        setBusy(false);
      }
    },
    [projectId, refresh, onWorkspaceUpdated],
  );

  if (!open) return null;

  return (
    <ModalBackdrop open={open} onClose={onClose}>
      <div className="bg-panel rounded-lg shadow-2xl w-[640px] max-w-[95vw] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-fg/10">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            <div className="text-sm font-medium">Assembly groups in this worksheet</div>
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

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading && <div className="text-xs text-fg/40">Loading…</div>}
          {!loading && instances.length === 0 && (
            <div className="text-xs text-fg/40 py-8 text-center">No assembly groups in this worksheet yet.</div>
          )}
          {instances.map((inst) => (
            <div key={inst.id} className="rounded-md border border-fg/10 bg-panel2/40">
              <div className="px-3 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate">{inst.assemblyName ?? "(deleted assembly)"}</div>
                  <div className="text-[10px] text-fg/45">
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
                    onClick={() => setEditingId(editingId === inst.id ? null : inst.id)}
                    disabled={!inst.assemblyId || busy}
                    className="text-xs"
                    title={!inst.assemblyId ? "Source assembly was deleted" : "Re-sync or scale"}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(inst.id)} disabled={busy} className="text-xs text-red-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {editingId === inst.id && editingDetail && (
                <div className="px-3 py-3 border-t border-fg/10 space-y-2">
                  <div>
                    <Label className="text-[10px]">Quantity</Label>
                    <Input value={editQuantity} onChange={(e) => setEditQuantity(e.target.value)} className="text-xs font-mono" />
                  </div>
                  {editingDetail.parameters.length > 0 && (
                    <div className="space-y-1.5">
                      <Label className="text-[10px]">Parameters</Label>
                      {editingDetail.parameters.map((p) => (
                        <div key={p.id} className="grid grid-cols-[1fr_120px_60px] gap-2 items-center">
                          <div className="text-xs">
                            <div className="font-medium">{p.label || p.key}</div>
                            {!p.label && <div className="text-[10px] font-mono text-fg/45">{p.key}</div>}
                          </div>
                          <Input
                            value={editParams[p.key] ?? ""}
                            onChange={(e) => setEditParams((prev) => ({ ...prev, [p.key]: e.target.value }))}
                            className="text-xs font-mono"
                            placeholder={p.defaultValue}
                          />
                          <div className="text-[10px] text-fg/45">{p.unit}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-end gap-2 pt-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} className="text-xs">
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        const qty = Number.parseFloat(editQuantity);
                        if (!Number.isFinite(qty)) {
                          setError("Quantity must be a number");
                          return;
                        }
                        void handleResync(inst.id, { quantity: qty, parameterValues: editParams });
                      }}
                      disabled={busy}
                      className="text-xs"
                    >
                      {busy ? "Re-syncing…" : "Re-sync"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-fg/10 flex items-center justify-end">
          <Button size="sm" variant="ghost" onClick={onClose}>Done</Button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
