"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { ChevronLeft, ChevronRight, Plus, Search, Trash2, X } from "lucide-react";
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
  EmptyState,
  Input,
  Select,
  Textarea,
} from "@/components/ui";

/* ─────────────────────── Types & constants ─────────────────────── */

type DrawerMode = "create" | "edit" | null;

type BadgeTone = "default" | "success" | "warning" | "danger" | "info";

interface TypeMeta {
  label: string;
  tone: BadgeTone;
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
          <Button variant="accent" size="sm" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            New Condition
          </Button>
        </div>
      </CardHeader>

      <div className="px-5 pb-5">
        {/* Search + page size */}
        <div className="flex items-center gap-3 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg/30" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conditions..."
              className="pl-9"
            />
          </div>
          <Select
            className="w-32"
            value={String(pageSize)}
            onValueChange={(v) => setPageSize(Number(v) || 25)}
            options={PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: `${n} per page` }))}
          />
        </div>

        {/* Type filter pills */}
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
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

        {/* Error banner */}
        {error && (
          <div className="mb-3 rounded-lg border border-danger/20 bg-danger/8 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        {/* Table */}
        <div className="rounded-lg border border-line overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-panel2/60">
              <tr className="text-left text-[11px] uppercase tracking-wider text-fg/45">
                <th className="px-4 py-2 w-36 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Value</th>
                <th className="px-4 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-xs text-fg/40">
                    Loading conditions...
                  </td>
                </tr>
              )}
              {!loading && pageRows.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-10">
                    <EmptyState>
                      {search || activeFilter !== "all"
                        ? "No conditions match your filters."
                        : "No conditions yet. Click \"New Condition\" to add one."}
                    </EmptyState>
                  </td>
                </tr>
              )}
              {!loading &&
                pageRows.map((entry) => {
                  const meta = typeMeta(entry.type);
                  return (
                    <tr
                      key={entry.id}
                      onClick={() => openEdit(entry)}
                      className="border-t border-line hover:bg-panel2/40 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-2.5 align-top">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-fg/90 leading-relaxed">
                        <div className="line-clamp-2">{entry.value}</div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-fg/30">
                        <ChevronRight className="inline h-3.5 w-3.5" />
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        {!loading && filtered.length > 0 && (
          <div className="flex items-center justify-between mt-3 text-xs text-fg/50">
            <span>
              Showing {safePageIndex * pageSize + 1}–
              {Math.min((safePageIndex + 1) * pageSize, filtered.length)} of {filtered.length}
              {filtered.length !== entries.length && ` (filtered from ${entries.length})`}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={safePageIndex === 0}
                onClick={() => setPageIndex(Math.max(0, safePageIndex - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Prev
              </Button>
              <span className="text-fg/40">
                Page {safePageIndex + 1} / {totalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={safePageIndex >= totalPages - 1}
                onClick={() => setPageIndex(Math.min(totalPages - 1, safePageIndex + 1))}
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Drawer (portalled) ── */}
      {typeof document !== "undefined" &&
        ReactDOM.createPortal(
          <AnimatePresence>
            {drawerMode && (
              <>
                <motion.div
                  key="condition-drawer-backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="fixed inset-0 z-30 bg-black/30"
                  onClick={closeDrawer}
                />
                <motion.div
                  key="condition-drawer"
                  initial={{ x: 480 }}
                  animate={{ x: 0 }}
                  exit={{ x: 480 }}
                  transition={{ type: "spring", damping: 30, stiffness: 300 }}
                  className="fixed inset-y-0 right-0 z-40 w-[480px] bg-panel border-l border-line shadow-2xl flex flex-col"
                >
                  {/* Drawer header */}
                  <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line bg-panel2/40">
                    <div>
                      <p className="text-[10px] font-semibold text-fg/45 uppercase tracking-wider">
                        {drawerMode === "create" ? "New Condition" : "Edit Condition"}
                      </p>
                      <h3 className="text-sm font-medium text-fg mt-0.5">
                        {drawerMode === "create" ? "Add to library" : "Update entry"}
                      </h3>
                    </div>
                    <button
                      onClick={closeDrawer}
                      className="rounded p-1 text-fg/40 hover:bg-panel2 hover:text-fg transition-colors"
                      aria-label="Close"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Drawer body */}
                  <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                    <div>
                      <label className="text-[10px] font-medium text-fg/40 uppercase tracking-wider">
                        Type
                      </label>
                      <Select
                        className="mt-1"
                        value={form.type}
                        onValueChange={(v) => setForm({ ...form, type: v })}
                        options={pillTypes.map((key) => ({
                          value: key,
                          label: typeMeta(key).label,
                        }))}
                      />
                      <p className="mt-1.5 text-[10px] text-fg/40">
                        Determines how the condition is grouped on quotes and reports.
                      </p>
                    </div>

                    <div>
                      <label className="text-[10px] font-medium text-fg/40 uppercase tracking-wider">
                        Value
                      </label>
                      <Textarea
                        className="mt-1 min-h-[140px]"
                        value={form.value}
                        onChange={(e) => setForm({ ...form, value: e.target.value })}
                        placeholder="Enter the clause text..."
                        autoFocus
                        onKeyDown={(e) => {
                          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                            e.preventDefault();
                            handleSave();
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            closeDrawer();
                          }
                        }}
                      />
                      <p className="mt-1.5 text-[10px] text-fg/40">
                        ⌘/Ctrl + Enter to save · Esc to cancel
                      </p>
                    </div>
                  </div>

                  {/* Drawer footer */}
                  <div className="border-t border-line px-5 py-3 flex items-center justify-between gap-2 bg-panel2/40">
                    <div>
                      {drawerMode === "edit" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleDelete}
                          disabled={saving}
                          className="text-danger hover:bg-danger/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={closeDrawer} disabled={saving}>
                        Cancel
                      </Button>
                      <Button
                        variant="accent"
                        size="sm"
                        onClick={handleSave}
                        disabled={saving || !form.value.trim() || !form.type.trim()}
                      >
                        {saving ? "Saving..." : drawerMode === "create" ? "Create" : "Save"}
                      </Button>
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body,
        )}
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
