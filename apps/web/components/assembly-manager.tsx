"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Layers, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type AssemblyRecord,
  type AssemblySummaryRecord,
  createAssembly,
  deleteAssembly,
  getAssembly,
  listAssemblies,
} from "@/lib/api";
import { Badge, Button, Card, CardHeader, CardTitle, EmptyState, Input } from "@/components/ui";
import {
  AssemblyHeaderEditor,
  ComponentsEditor,
  ParametersEditor,
  useAssemblyAuthoringContext,
} from "@/components/assembly-authoring";

export function AssemblyManager() {
  const [list, setList] = useState<AssemblySummaryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AssemblyRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const otherAssemblyOptions = useMemo(
    () => list.filter((a) => a.id !== detail?.id).map((a) => ({ id: a.id, label: a.name, unit: a.unit })),
    [list, detail?.id],
  );

  const refreshDetailAndList = useCallback(() => {
    if (detail) void loadDetail(detail.id);
    void refreshList();
  }, [detail, loadDetail, refreshList]);

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
              <div className="flex flex-col gap-4">
                <AssemblyHeaderEditor
                  assembly={detail}
                  onChange={refreshDetailAndList}
                  onDelete={() => handleDelete(detail.id)}
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
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
