"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, Layers, Loader2, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type AssemblyRecord,
  type AssemblySummaryRecord,
  createAssembly,
  deleteAssembly,
  getAssembly,
  listAssemblies,
} from "@/lib/api";
import { Badge, Button, Card, CardHeader, CardTitle, EmptyState, Input, Label, Textarea } from "@/components/ui";
import { UomSelect } from "@/components/shared/uom-select";
import {
  AssemblyHeaderEditor,
  ComponentsEditor,
  ParametersEditor,
  useAssemblyAuthoringContext,
} from "@/components/assembly-authoring";

const PAGE_SIZE = 50;
const HISTORICAL_BUNDLE_PREFIX = /^(Electrical|Mechanical|Multi-Trade|Shop)\s+Historical\s+Bundle:\s*/i;

type CreateAssemblyForm = {
  name: string;
  code: string;
  category: string;
  unit: string;
  description: string;
};

function emptyCreateForm(): CreateAssemblyForm {
  return {
    name: "",
    code: "",
    category: "",
    unit: "EA",
    description: "",
  };
}

function displayAssemblyName(name: string) {
  return name.replace(HISTORICAL_BUNDLE_PREFIX, "").trim() || name || "Untitled assembly";
}

function displayAssemblyDescription(description: string) {
  return description
    .replace(/^Synthesized from\s+/i, "Imported from ")
    .replace(/\bCommon historical titles:\s*/i, "Reference scopes: ")
    .replace(/\bhistorical\b/gi, "source")
    .trim();
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value || "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function countLabel(count: number, singular: string) {
  const plural = singular.endsWith("y") ? `${singular.slice(0, -1)}ies` : `${singular}s`;
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

export function AssemblyManager({ embedded = false }: { embedded?: boolean } = {}) {
  const [list, setList] = useState<AssemblySummaryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createForm, setCreateForm] = useState<CreateAssemblyForm>(() => emptyCreateForm());
  const [detail, setDetail] = useState<AssemblyRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { catalogItems, rateItems, laborUnits, effectiveCosts } = useAssemblyAuthoringContext();

  const drawerOpen = creating || Boolean(selectedId);

  const closeDrawer = useCallback(() => {
    setCreating(false);
    setSelectedId(null);
    setDetail(null);
  }, []);

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

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDrawer();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeDrawer, drawerOpen]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((assembly) => {
      const haystack = [
        displayAssemblyName(assembly.name),
        assembly.code,
        assembly.category,
        assembly.unit,
        displayAssemblyDescription(assembly.description),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [list, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = useMemo(() => {
    const start = page * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  useEffect(() => {
    setPage(0);
  }, [search]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages - 1));
  }, [totalPages]);

  const openCreateDrawer = useCallback(() => {
    setError(null);
    setSelectedId(null);
    setDetail(null);
    setCreateForm(emptyCreateForm());
    setCreating(true);
  }, []);

  const openAssemblyDrawer = useCallback((id: string) => {
    setError(null);
    setCreating(false);
    setSelectedId(id);
  }, []);

  const handleCreate = useCallback(async () => {
    const name = createForm.name.trim();
    if (!name) {
      setError("Assembly name is required.");
      return;
    }
    setCreateSaving(true);
    setError(null);
    try {
      const created = await createAssembly({
        name,
        code: createForm.code.trim(),
        category: createForm.category.trim(),
        unit: createForm.unit.trim().toUpperCase() || "EA",
        description: createForm.description.trim(),
      });
      await refreshList();
      setCreating(false);
      setSelectedId(created.id);
      setDetail(created);
    } catch (e: any) {
      setError(e?.message ?? "Failed to create assembly");
    } finally {
      setCreateSaving(false);
    }
  }, [createForm, refreshList]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm("Delete this assembly? This cannot be undone.")) return;
      setError(null);
      try {
        await deleteAssembly(id);
        if (selectedId === id) closeDrawer();
        await refreshList();
      } catch (e: any) {
        setError(e?.message ?? "Failed to delete assembly");
      }
    },
    [closeDrawer, refreshList, selectedId],
  );

  const otherAssemblyOptions = useMemo(
    () => list.filter((assembly) => assembly.id !== detail?.id).map((assembly) => ({
      id: assembly.id,
      label: displayAssemblyName(assembly.name),
      unit: assembly.unit,
    })),
    [list, detail?.id],
  );

  const refreshDetailAndList = useCallback(() => {
    if (detail) void loadDetail(detail.id);
    void refreshList();
  }, [detail, loadDetail, refreshList]);

  return (
    <>
      <Card className={cn("flex min-h-0 flex-col overflow-hidden", embedded && "h-full")}>
        {!embedded && (
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2">
                <Layers className="h-4 w-4" /> Assemblies
              </CardTitle>
              <Button onClick={openCreateDrawer} className="text-xs">
                <Plus className="h-3.5 w-3.5" /> New
              </Button>
            </div>
          </CardHeader>
        )}

        {!embedded && (
          <p className="border-b border-line px-5 py-3 text-xs text-fg/50">
            Reusable, parameterized estimating recipes made from catalog items, labour rates, and nested assemblies.
          </p>
        )}

        {error && (
          <div className="mx-3 mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/30" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search assemblies by name, code, category, or scope..."
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Button onClick={openCreateDrawer} size="sm" variant="accent" className="shrink-0" title="Create assembly">
            <Plus className="h-3.5 w-3.5" />
            New
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <table className="w-full table-fixed text-sm">
            <thead className="sticky top-0 z-10 bg-panel">
              <tr className="border-b border-line">
                <th className="w-[38%] px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">Assembly</th>
                <th className="w-[14%] px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">Code</th>
                <th className="w-[16%] px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">Category</th>
                <th className="w-[7%] px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">Unit</th>
                <th className="w-[9%] px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider text-fg/40">Comp</th>
                <th className="w-[7%] px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider text-fg/40">Param</th>
                <th className="w-[9%] px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">Updated</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-fg/40">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading assemblies...
                    </span>
                  </td>
                </tr>
              )}

              {!loading && paginated.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10">
                    <EmptyState className="border-0 !py-8">
                      <Layers className="mx-auto mb-2 h-8 w-8 text-fg/20" />
                      <div className="text-sm">{search.trim() ? "No assemblies match this search" : "No assemblies yet"}</div>
                    </EmptyState>
                  </td>
                </tr>
              )}

              {!loading && paginated.map((assembly, index) => {
                const selected = selectedId === assembly.id;
                const description = displayAssemblyDescription(assembly.description);
                return (
                  <motion.tr
                    key={assembly.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.16, delay: Math.min(index * 0.012, 0.18) }}
                    role="button"
                    tabIndex={0}
                    onClick={() => openAssemblyDrawer(assembly.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openAssemblyDrawer(assembly.id);
                      }
                    }}
                    className={cn(
                      "cursor-pointer border-b border-line last:border-0 outline-none transition-colors",
                      selected ? "bg-accent/10" : "hover:bg-panel2/40 focus-visible:bg-panel2/60",
                    )}
                  >
                    <td className="min-w-0 px-3 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-fg">{displayAssemblyName(assembly.name)}</div>
                        <div className="mt-0.5 max-w-[52rem] truncate text-[11px] text-fg/45">
                          {description || "No description"}
                        </div>
                      </div>
                    </td>
                    <td className="min-w-0 truncate px-3 py-2.5 text-xs font-mono text-fg/55" title={assembly.code || undefined}>{assembly.code || "-"}</td>
                    <td className="min-w-0 px-3 py-2.5">
                      {assembly.category ? <Badge tone="default" className="max-w-full truncate text-[10px]" title={assembly.category}>{assembly.category}</Badge> : <span className="text-xs text-fg/30">-</span>}
                    </td>
                    <td className="truncate px-3 py-2.5 text-xs font-medium text-fg/65">{assembly.unit || "EA"}</td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums text-fg/70">{assembly.componentCount.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums text-fg/70">{assembly.parameterCount.toLocaleString()}</td>
                    <td className="truncate px-3 py-2.5 text-xs text-fg/45">{formatDate(assembly.updatedAt)}</td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-3 py-2 text-xs text-fg/45">
          <div>
            {countLabel(filtered.length, "assembly")}
            {filtered.length !== list.length && <span> filtered from {list.length.toLocaleString()}</span>}
          </div>
          <div className="flex items-center gap-2">
            <span>Page {page + 1} of {totalPages}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                disabled={page === 0}
                className="rounded p-1 text-fg/45 transition-colors hover:bg-panel2/70 hover:text-fg disabled:pointer-events-none disabled:opacity-30"
                title="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
                disabled={page >= totalPages - 1}
                className="rounded p-1 text-fg/45 transition-colors hover:bg-panel2/70 hover:text-fg disabled:pointer-events-none disabled:opacity-30"
                title="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </Card>

      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {drawerOpen && (
            <>
              <motion.div
                key="assembly-drawer-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 bg-black/20"
                onClick={closeDrawer}
              />
              <motion.aside
                key="assembly-drawer"
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ type: "spring", damping: 30, stiffness: 300 }}
                className="fixed inset-y-0 right-0 z-50 flex w-[min(1120px,calc(100vw-24px))] flex-col border-l border-line bg-panel shadow-2xl"
              >
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-panel2/35 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-accent" />
                      <h2 className="truncate text-sm font-semibold text-fg">
                        {creating ? "Create Assembly" : displayAssemblyName(detail?.name ?? "Assembly")}
                      </h2>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-fg/45">
                      {creating ? "Define the assembly shell, then add priced components." : "Edit the assembly definition, parameters, and component costing."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeDrawer}
                    className="rounded p-1.5 text-fg/45 transition-colors hover:bg-panel2/70 hover:text-fg"
                    title="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {creating ? (
                  <CreateAssemblyDrawer
                    form={createForm}
                    saving={createSaving}
                    onChange={(patch) => setCreateForm((current) => ({ ...current, ...patch }))}
                    onCancel={closeDrawer}
                    onSubmit={() => void handleCreate()}
                  />
                ) : (
                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    {detailLoading && (
                      <div className="flex items-center justify-center py-20 text-sm text-fg/45">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading assembly...
                      </div>
                    )}

                    {!detailLoading && selectedId && !detail && (
                      <EmptyState className="!py-14">
                        <div className="text-sm">Assembly could not be loaded.</div>
                      </EmptyState>
                    )}

                    {!detailLoading && detail && (
                      <div className="flex min-h-0 flex-col gap-4">
                        <div className="grid grid-cols-3 gap-2">
                          <MetricPill label="Components" value={detail.components.length.toLocaleString()} />
                          <MetricPill label="Parameters" value={detail.parameters.length.toLocaleString()} />
                          <MetricPill label="Updated" value={formatDate(detail.updatedAt)} />
                        </div>
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
	                          laborUnits={laborUnits}
	                          effectiveCosts={effectiveCosts}
	                          otherAssemblyOptions={otherAssemblyOptions}
	                          onChange={refreshDetailAndList}
	                          onError={setError}
                        />
                      </div>
                    )}
                  </div>
                )}
              </motion.aside>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-panel2/35 px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wider text-fg/35">{label}</div>
      <div className="mt-1 truncate text-xs font-semibold text-fg">{value}</div>
    </div>
  );
}

function CreateAssemblyDrawer({
  form,
  saving,
  onChange,
  onCancel,
  onSubmit,
}: {
  form: CreateAssemblyForm;
  saving: boolean;
  onChange: (patch: Partial<CreateAssemblyForm>) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px] gap-3 rounded-md border border-line bg-panel2/35 p-4">
          <div className="col-span-3">
            <Label>Name</Label>
            <Input
              value={form.name}
              onChange={(event) => onChange({ name: event.target.value })}
              placeholder="Assembly name"
              className="text-sm"
            />
          </div>
          <div className="min-w-0">
            <Label>Code</Label>
            <Input
              value={form.code}
              onChange={(event) => onChange({ code: event.target.value })}
              placeholder="Optional"
              className="text-sm"
            />
          </div>
          <div className="min-w-0">
            <Label>Category</Label>
            <Input
              value={form.category}
              onChange={(event) => onChange({ category: event.target.value })}
              placeholder="Mechanical, electrical, etc."
              className="text-sm"
            />
          </div>
          <div className="min-w-0">
            <Label>Unit</Label>
            <UomSelect
              compact
              value={form.unit}
              onValueChange={(unit) => onChange({ unit })}
              placeholder="Unit"
            />
          </div>
          <div className="col-span-3">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(event) => onChange({ description: event.target.value })}
              placeholder="Scope, assumptions, and how this assembly should be used."
              className="min-h-24 text-sm"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="accent" onClick={onSubmit} disabled={saving || !form.name.trim()}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Create
          </Button>
        </div>
      </div>
    </div>
  );
}
