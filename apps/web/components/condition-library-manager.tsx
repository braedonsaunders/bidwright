"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getConditionLibrary,
  createConditionLibraryEntry,
  updateConditionLibraryEntry,
  deleteConditionLibraryEntry,
  type ConditionLibraryEntry,
} from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  Drawer,
  RecordList,
  type RecordColumn,
  SearchSelect,
  Textarea,
} from "@appkit/ui";

/* ─────────────────────── Types & constants ─────────────────────── */

type DrawerMode = "create" | "edit" | null;

type BadgeTone = "default" | "success" | "warning" | "danger" | "info";

interface TypeMeta {
  label: string;
  tone: BadgeTone;
}

function badgeVariant(tone: BadgeTone): "secondary" | "success" | "warning" | "destructive" | "info" {
  if (tone === "default") return "secondary";
  if (tone === "danger") return "destructive";
  return tone;
}

/**
 * Built-in condition types. The `type` column on ConditionLibraryEntry is a
 * freeform string so estimators can introduce additional types over time
 * (e.g., "scope_note"). Anything not in this map renders with the default
 * tone and a Title Case label.
 */
const TYPE_META: Record<string, TypeMeta> = {
  inclusion: { label: "Inclusion", tone: "success" },
  exclusion: { label: "Exclusion", tone: "danger" },
  clarification: { label: "Clarification", tone: "info" },
  assumption: { label: "Assumption", tone: "warning" },
  general: { label: "General", tone: "default" },
};

const DEFAULT_TYPE_KEYS = ["inclusion", "exclusion", "clarification", "assumption", "general"] as const;

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

function normalizeType(raw: string): string {
  return raw.trim().toLowerCase();
}

function typeMeta(raw: string): TypeMeta {
  const key = normalizeType(raw);
  if (TYPE_META[key]) return TYPE_META[key];
  // Title Case fallback so unknown types still render cleanly.
  const label = key
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return { label: label || raw, tone: "default" };
}

/* ─────────────────────── Component ─────────────────────── */

export function ConditionLibraryManager() {
  const [entries, setEntries] = useState<ConditionLibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [pageSize, setPageSize] = useState<number>(25);
  const [pageIndex, setPageIndex] = useState(0);

  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<{ type: string; value: string }>({ type: "inclusion", value: "" });
  const [saving, setSaving] = useState(false);

  /* ─── Data fetch ─── */

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await getConditionLibrary();
      setEntries(rows);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load conditions";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /* ─── Counts + derived pill list ─── */

  const countsByType = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      const key = normalizeType(e.type);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [entries]);

  /** All distinct types across data + the built-in defaults, in a stable order. */
  const pillTypes = useMemo(() => {
    const seen = new Set<string>(DEFAULT_TYPE_KEYS);
    const extras: string[] = [];
    for (const key of countsByType.keys()) {
      if (!seen.has(key)) {
        seen.add(key);
        extras.push(key);
      }
    }
    return [...DEFAULT_TYPE_KEYS, ...extras.sort()];
  }, [countsByType]);

  /* ─── Filter + paginate ─── */

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (activeFilter !== "all" && normalizeType(e.type) !== activeFilter) return false;
      if (q && !e.value.toLowerCase().includes(q) && !normalizeType(e.type).includes(q)) return false;
      return true;
    });
  }, [entries, search, activeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const pageRows = useMemo(
    () => filtered.slice(safePageIndex * pageSize, safePageIndex * pageSize + pageSize),
    [filtered, safePageIndex, pageSize],
  );

  // Reset to page 0 whenever filters change so users don't land on an empty page.
  useEffect(() => {
    setPageIndex(0);
  }, [search, activeFilter, pageSize]);

  /* ─── Drawer ─── */

  function openCreate() {
    setEditingId(null);
    // Default the new entry to whatever pill the user is filtered to (so a
    // user filtering exclusions and pressing "+ New" gets an exclusion form).
    const defaultType =
      activeFilter !== "all" && TYPE_META[activeFilter] ? activeFilter : "inclusion";
    setForm({ type: defaultType, value: "" });
    setDrawerMode("create");
  }

  function openEdit(entry: ConditionLibraryEntry) {
    setEditingId(entry.id);
    setForm({ type: normalizeType(entry.type), value: entry.value });
    setDrawerMode("edit");
  }

  function closeDrawer() {
    setDrawerMode(null);
    setEditingId(null);
    setSaving(false);
  }

  async function handleSave() {
    const trimmed = form.value.trim();
    const type = normalizeType(form.type);
    if (!trimmed || !type) return;
    setSaving(true);
    try {
      if (drawerMode === "create") {
        const created = await createConditionLibraryEntry({ type, value: trimmed });
        setEntries((prev) => [...prev, created]);
      } else if (drawerMode === "edit" && editingId) {
        const updated = await updateConditionLibraryEntry(editingId, { type, value: trimmed });
        setEntries((prev) => prev.map((e) => (e.id === editingId ? updated : e)));
      }
      closeDrawer();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setError(msg);
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editingId) return;
    if (!confirm("Delete this condition? This cannot be undone.")) return;
    setSaving(true);
    try {
      await deleteConditionLibraryEntry(editingId);
      setEntries((prev) => prev.filter((e) => e.id !== editingId));
      closeDrawer();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Delete failed";
      setError(msg);
      setSaving(false);
    }
  }

  const columns = useMemo<RecordColumn<ConditionLibraryEntry>[]>(() => [
    {
      key: "type",
      label: "Type",
      width: 144,
      render: (entry) => {
        const meta = typeMeta(entry.type);
        return <Badge variant={badgeVariant(meta.tone)}>{meta.label}</Badge>;
      },
    },
    {
      key: "value",
      label: "Value",
      render: (entry) => <div className="line-clamp-2 leading-relaxed text-fg/90">{entry.value}</div>,
    },
  ], []);

  /* ─── Render ─── */

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Conditions Library</CardTitle>
            <p className="text-xs text-fg/50 mt-1">
              Standard inclusions, exclusions, clarifications, and other clauses available to add to project quotes.
            </p>
          </div>
          <Button variant="default" size="sm" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            New Condition
          </Button>
        </div>
      </CardHeader>

      <div className="px-5 pb-5">
        {error && (
          <div className="mb-3 rounded-lg border border-danger/20 bg-danger/8 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-10 text-center text-xs text-fg/40">Loading conditions...</div>
        ) : (
          <RecordList
            columns={columns}
            rows={pageRows}
            getRowId={(entry) => entry.id}
            search={{ value: search, onChange: setSearch, placeholder: "Search conditions..." }}
            filters={(
              <div className="flex flex-wrap items-center gap-1.5">
                <FilterPill
                  label="All"
                  count={entries.length}
                  active={activeFilter === "all"}
                  tone="default"
                  onClick={() => setActiveFilter("all")}
                />
                {pillTypes.map((key) => {
                  const meta = typeMeta(key);
                  return (
                    <FilterPill
                      key={key}
                      label={meta.label}
                      count={countsByType.get(key) ?? 0}
                      active={activeFilter === key}
                      tone={meta.tone}
                      onClick={() => setActiveFilter(key)}
                    />
                  );
                })}
              </div>
            )}
            toolbarActions={(
              <SearchSelect
                className="w-36"
                value={String(pageSize)}
                onChange={(value) => setPageSize(Number(value) || 25)}
                options={PAGE_SIZE_OPTIONS.map((value) => ({
                  value: String(value),
                  label: `${value} per page`,
                }))}
                searchable={false}
                ariaLabel="Conditions per page"
              />
            )}
            pagination={{
              page: safePageIndex + 1,
              perPage: pageSize,
              total: filtered.length,
              onPageChange: (nextPage) => setPageIndex(nextPage - 1),
            }}
            empty={{
              title: search || activeFilter !== "all" ? "No conditions match your filters" : "No conditions yet",
              description: search || activeFilter !== "all"
                ? "Try a broader search or another condition type."
                : "Add a standard clause so it can be reused across project quotes.",
              action: search || activeFilter !== "all" ? undefined : (
                <Button size="sm" onClick={openCreate}>
                  <Plus className="h-3.5 w-3.5" /> New condition
                </Button>
              ),
            }}
            onRowClick={openEdit}
          />
        )}
      </div>

      <Drawer
        open={drawerMode !== null}
        onClose={closeDrawer}
        size="sm"
        title={drawerMode === "create" ? "New Condition" : "Edit Condition"}
        description={drawerMode === "create" ? "Add a reusable clause to the library." : "Update this reusable clause."}
        footer={(
          <div className="flex w-full items-center justify-between gap-2">
            <div>
              {drawerMode === "edit" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDelete}
                  disabled={saving}
                  className="text-danger hover:bg-danger/10"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={closeDrawer} disabled={saving}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || !form.value.trim() || !form.type.trim()}
              >
                {saving ? "Saving..." : drawerMode === "create" ? "Create" : "Save"}
              </Button>
            </div>
          </div>
        )}
      >
        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wider text-fg/40">Type</label>
            <SearchSelect
              className="mt-1"
              value={form.type}
              onChange={(value) => setForm({ ...form, type: value })}
              options={pillTypes.map((key) => ({ value: key, label: typeMeta(key).label }))}
              sheetTitle="Condition type"
              ariaLabel="Condition type"
            />
            <p className="mt-1.5 text-[10px] text-fg/40">
              Determines how the condition is grouped on quotes and reports.
            </p>
          </div>

          <div>
            <label className="text-[10px] font-medium uppercase tracking-wider text-fg/40">Value</label>
            <Textarea
              className="mt-1 min-h-[140px]"
              value={form.value}
              onChange={(event) => setForm({ ...form, value: event.target.value })}
              placeholder="Enter the clause text..."
              autoFocus
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void handleSave();
                }
              }}
            />
            <p className="mt-1.5 text-[10px] text-fg/40">⌘/Ctrl + Enter to save · Esc to cancel</p>
          </div>
        </div>
      </Drawer>
    </Card>
  );
}

/* ─────────────────────── Helpers ─────────────────────── */

function FilterPill({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  tone: BadgeTone;
  onClick: () => void;
}) {
  const toneClasses: Record<BadgeTone, string> = {
    default: "border-line bg-panel2 text-fg/70 hover:bg-panel2/80",
    success: "border-success/20 bg-success/8 text-success hover:bg-success/12",
    warning: "border-warning/20 bg-warning/8 text-warning hover:bg-warning/12",
    danger: "border-danger/20 bg-danger/8 text-danger hover:bg-danger/12",
    info: "border-accent/20 bg-accent/8 text-accent hover:bg-accent/12",
  };
  const activeRing = "ring-2 ring-accent/40 ring-offset-1 ring-offset-panel";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
        toneClasses[tone],
        active && activeRing,
      )}
    >
      <span>{label}</span>
      <span className="rounded-full bg-bg/40 px-1.5 py-0.5 text-[9.5px] font-semibold tabular-nums">
        {count}
      </span>
    </button>
  );
}
