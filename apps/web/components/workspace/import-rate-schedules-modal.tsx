"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, ModalBackdrop } from "@/components/ui";
import { importRateSchedule, listRateSchedules, type RateSchedule, type WorkspaceResponse } from "@/lib/api";

interface ImportRateSchedulesModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  existingScheduleIds?: string[];
  onImported: (workspace: WorkspaceResponse) => void;
  onError: (msg: string) => void;
}

export function ImportRateSchedulesModal({
  open,
  onClose,
  projectId,
  existingScheduleIds = [],
  onImported,
  onError,
}: ImportRateSchedulesModalProps) {
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [schedules, setSchedules] = useState<RateSchedule[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setSelected(new Set());
    setSearch("");
    listRateSchedules()
      .then((rows) => {
        if (cancelled) return;
        setSchedules(rows);
      })
      .catch(() => {
        if (cancelled) return;
        onError("Failed to load rate schedule library.");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, onError]);

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? schedules.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.description?.toLowerCase().includes(q) ?? false) ||
            s.category.toLowerCase().includes(q),
        )
      : schedules;

    const groups: Record<string, RateSchedule[]> = {};
    for (const s of filtered) {
      const key = s.category || "Uncategorized";
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    }
    for (const list of Object.values(groups)) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [schedules, search]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroup = (items: RateSchedule[]) => {
    const ids = items.map((i) => i.id);
    const allSelected = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
      return next;
    });
  };

  const handleImport = async () => {
    if (selected.size === 0 || importing) return;
    setImporting(true);
    try {
      let last: WorkspaceResponse | null = null;
      for (const id of selected) {
        last = await importRateSchedule(projectId, id);
      }
      if (last) onImported(last);
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <ModalBackdrop open={open} onClose={importing ? () => {} : onClose} size="xl">
      <div className="rounded-xl border border-line bg-panel shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-fg">Import rate schedules</h2>
            <p className="mt-0.5 text-xs text-fg/50">
              Select one or more schedules from your organization&rsquo;s library to import into this project.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            className="rounded-md p-1 text-fg/35 transition-colors hover:bg-panel2 hover:text-fg/70 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-line px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/30" />
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search schedules by name, category, or description..."
              className="h-8 w-full rounded-md border border-line bg-bg/50 pl-8 pr-8 text-xs text-fg outline-none focus:border-accent/50"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-fg/30 hover:text-fg/60"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-xs text-fg/40">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading library...
            </div>
          ) : grouped.length === 0 ? (
            <div className="py-12 text-center text-xs text-fg/40">
              {search ? `No schedules match "${search}"` : "No rate schedules in your library yet."}
            </div>
          ) : (
            <div className="divide-y divide-line">
              {grouped.map(([category, items]) => {
                const allChecked = items.every((i) => selected.has(i.id));
                const someChecked = items.some((i) => selected.has(i.id));
                return (
                  <div key={category}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(items)}
                      className="sticky top-0 z-10 flex w-full items-center gap-2 bg-panel2/60 px-4 py-2 text-left backdrop-blur transition-colors hover:bg-panel2"
                    >
                      <span
                        className={cn(
                          "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors",
                          allChecked
                            ? "border-accent bg-accent text-white"
                            : someChecked
                              ? "border-accent/60 bg-accent/30 text-white"
                              : "border-line bg-bg",
                        )}
                      >
                        {allChecked && (
                          <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                        {!allChecked && someChecked && (
                          <span className="block h-1 w-1.5 rounded-sm bg-white" />
                        )}
                      </span>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-fg/55">
                        {category}
                      </span>
                      <span className="text-[10px] text-fg/30">{items.length}</span>
                    </button>
                    {items.map((s) => {
                      const isSelected = selected.has(s.id);
                      const alreadyImported = existingScheduleIds.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => toggle(s.id)}
                          className={cn(
                            "flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-panel2/40",
                            isSelected && "bg-accent/5",
                          )}
                        >
                          <span
                            className={cn(
                              "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                              isSelected ? "border-accent bg-accent text-white" : "border-line bg-bg",
                            )}
                          >
                            {isSelected && (
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-fg">{s.name}</span>
                              {alreadyImported && (
                                <span className="shrink-0 rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">
                                  Already imported
                                </span>
                              )}
                            </div>
                            {s.description && (
                              <p className="mt-0.5 truncate text-xs text-fg/45">{s.description}</p>
                            )}
                          </div>
                          <div className="shrink-0 text-[10px] text-fg/35 tabular-nums">
                            {s.items?.length ?? 0} items · {s.tiers?.length ?? 0} tiers
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3.5">
          <div className="text-xs text-fg/50">
            {selected.size > 0
              ? `${selected.size} schedule${selected.size === 1 ? "" : "s"} selected`
              : "No schedules selected"}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={importing}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="accent"
              size="sm"
              onClick={handleImport}
              disabled={selected.size === 0 || importing}
            >
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Import {selected.size > 0 ? selected.size : ""}
            </Button>
          </div>
        </div>
      </div>
    </ModalBackdrop>
  );
}
