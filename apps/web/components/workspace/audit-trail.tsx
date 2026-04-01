"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  CalendarClock,
  CalendarMinus,
  CalendarPlus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileEdit,
  FolderMinus,
  FolderPlus,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type { Activity, ProjectWorkspaceData, WorkspaceResponse } from "@/lib/api";
import { getActivities, revertActivity } from "@/lib/api";
import { Badge, Button, EmptyState, Input, Select } from "@/components/ui";

// ── Activity type display config ────────────────────────────────────────

type ActivityTone = "info" | "success" | "warning" | "danger";

interface ActivityTypeConfig {
  icon: typeof Plus;
  label: (data: Record<string, unknown>) => string;
  tone: ActivityTone;
  category: string;
}

const ACTIVITY_TYPE_CONFIG: Record<string, ActivityTypeConfig> = {
  item_created: {
    icon: Plus,
    label: (d) => `Added ${bold(d.entityName)}${d.category ? ` to ${d.category}` : ""}`,
    tone: "success",
    category: "Line Items",
  },
  item_updated: {
    icon: Pencil,
    label: (d) => {
      const n = Array.isArray(d.patch) ? d.patch.length : 0;
      return `Updated ${bold(d.entityName)}${n > 0 ? ` (${fieldWord(n)})` : ""}`;
    },
    tone: "info",
    category: "Line Items",
  },
  item_deleted: {
    icon: Trash2,
    label: (d) => `Removed ${bold(d.entityName)}`,
    tone: "danger",
    category: "Line Items",
  },
  revision_updated: {
    icon: FileEdit,
    label: (d) => {
      const fields = Array.isArray(d.fields) ? d.fields : [];
      return `Updated revision settings${fields.length > 0 ? ` (${fields.slice(0, 3).join(", ")}${fields.length > 3 ? `, +${fields.length - 3} more` : ""})` : ""}`;
    },
    tone: "info",
    category: "Revision",
  },
  phase_created: {
    icon: FolderPlus,
    label: (d) => `Created phase ${bold(d.name)}`,
    tone: "success",
    category: "Phases",
  },
  phase_updated: {
    icon: FolderPlus,
    label: (d) => {
      const n = Array.isArray(d.patch) ? d.patch.length : 0;
      return `Updated phase ${bold(d.name)}${n > 0 ? ` (${fieldWord(n)})` : ""}`;
    },
    tone: "info",
    category: "Phases",
  },
  phase_deleted: {
    icon: FolderMinus,
    label: (d) => `Deleted phase ${bold(d.name)}`,
    tone: "danger",
    category: "Phases",
  },
  schedule_task_created: {
    icon: CalendarPlus,
    label: (d) => `Created task ${bold(d.name)}`,
    tone: "success",
    category: "Schedule",
  },
  schedule_task_updated: {
    icon: CalendarClock,
    label: (d) => {
      const n = Array.isArray(d.patch) ? d.patch.length : 0;
      return `Updated task ${bold(d.name)}${n > 0 ? ` (${fieldWord(n)})` : ""}`;
    },
    tone: "info",
    category: "Schedule",
  },
  schedule_task_deleted: {
    icon: CalendarMinus,
    label: (d) => `Deleted task ${bold(d.name)}`,
    tone: "danger",
    category: "Schedule",
  },
  quote_sent: {
    icon: Send,
    label: (d) => {
      const recipients = d.recipients;
      if (Array.isArray(recipients) && recipients.length > 0) return `Sent quote to ${bold(recipients.join(", "))}`;
      return "Sent quote";
    },
    tone: "success",
    category: "Quote",
  },
  ai_phases_accepted: {
    icon: Sparkles,
    label: (d) => `Accepted ${d.phaseCount ?? ""} AI-generated phases`,
    tone: "info",
    category: "AI",
  },
  ai_equipment_accepted: {
    icon: Sparkles,
    label: (d) => `Accepted ${d.equipmentCount ?? ""} AI-generated items`,
    tone: "info",
    category: "AI",
  },
};

function bold(v: unknown) { return v ? `**${v}**` : "item"; }
function fieldWord(n: number) { return `${n} field${n > 1 ? "s" : ""}`; }

function getRevertConfig(type: string): ActivityTypeConfig {
  const originalType = type.replace("revert:", "");
  const original = ACTIVITY_TYPE_CONFIG[originalType];
  return {
    icon: Undo2,
    label: (d) => {
      const orig = original?.label(d) ?? originalType.replaceAll("_", " ");
      return `Reverted: ${orig}`;
    },
    tone: "warning",
    category: "Revert",
  };
}

function getConfig(type: string): ActivityTypeConfig {
  if (type.startsWith("revert:")) return getRevertConfig(type);
  return ACTIVITY_TYPE_CONFIG[type] ?? { icon: FileEdit, label: () => type.replaceAll("_", " "), tone: "info", category: "Other" };
}

// ── Action type filter options ──────────────────────────────────────────

const ACTION_TYPES = [
  { value: "", label: "All actions" },
  { value: "created", label: "Created" },
  { value: "updated", label: "Updated" },
  { value: "deleted", label: "Deleted" },
  { value: "revert", label: "Reverted" },
  { value: "sent", label: "Sent" },
  { value: "ai", label: "AI" },
];

// ── Pagination ──────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

// ── Helpers ─────────────────────────────────────────────────────────────

function RichLabel({ text }: { text: string }) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return (
    <span>
      {parts.map((part, i) =>
        i % 2 === 1 ? <span key={i} className="font-semibold text-fg">{part}</span> : <span key={i}>{part}</span>
      )}
    </span>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fullTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "\u2014";
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "yes" : "no";
  if (typeof val === "string") return val || '""';
  return JSON.stringify(val);
}

// ── Expand row: before/after diff ───────────────────────────────────────

function ChangeSummary({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  if (!before && !after) return null;

  const isCreate = !before && after;
  const isDelete = before && !after;

  const keys = isCreate ? Object.keys(after!) : isDelete ? Object.keys(before!) : [...new Set([...Object.keys(before!), ...Object.keys(after!)])];
  const filteredKeys = keys.filter((k) => !["id", "worksheetId", "revisionId", "projectId", "createdAt", "updatedAt", "quoteId"].includes(k));
  if (filteredKeys.length === 0) return null;

  return (
    <div className="rounded-md border border-line bg-bg/40 px-3 py-2 text-[11px] font-mono space-y-0.5 max-h-48 overflow-y-auto">
      {filteredKeys.map((key) => {
        if (isCreate) {
          return (
            <div key={key} className="text-success/80">
              <span className="text-fg/40">{key}:</span> {formatValue(after![key])}
            </div>
          );
        }
        if (isDelete) {
          return (
            <div key={key} className="text-danger/80">
              <span className="text-fg/40">{key}:</span> {formatValue(before![key])}
            </div>
          );
        }
        const oldVal = before![key];
        const newVal = after![key];
        if (JSON.stringify(oldVal) === JSON.stringify(newVal)) return null;
        return (
          <div key={key}>
            <span className="text-fg/40">{key}:</span>{" "}
            <span className="text-danger/70 line-through">{formatValue(oldVal)}</span>{" "}
            <span className="text-fg/30">&rarr;</span>{" "}
            <span className="text-success/80">{formatValue(newVal)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Confirm dialog ──────────────────────────────────────────────────────

function RevertConfirm({ open, onClose, onConfirm, isPending }: { open: boolean; onClose: () => void; onConfirm: () => void; isPending: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl border border-line bg-panel p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold">Revert this action?</h3>
        <p className="mt-1.5 text-[13px] text-fg/50">
          This will undo the change and restore the previous state. A revert entry will be added to the audit trail.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button variant="danger" size="sm" onClick={onConfirm} disabled={isPending}>
            {isPending ? "Reverting..." : "Revert"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────

export function AuditTrailTab({
  workspace,
  onApply,
}: {
  workspace: ProjectWorkspaceData;
  onApply: (next: WorkspaceResponse) => void;
}) {
  const projectId = workspace.project.id;
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reverting, setReverting] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterUser, setFilterUser] = useState("");

  // Expand row
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Sort
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  // Pagination
  const [page, setPage] = useState(0);

  const fetchActivities = useCallback(async () => {
    try {
      const data = await getActivities(projectId);
      setActivities(data);
      setError(null);
    } catch {
      setError("Failed to load activity");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchActivities(); }, [fetchActivities]);

  // Derive unique users and categories for filter dropdowns
  const userOptions = useMemo(() => {
    const users = new Map<string, string>();
    for (const a of activities) {
      if (a.userName) users.set(a.userId ?? a.userName, a.userName);
    }
    return [...users.entries()].map(([id, name]) => ({ value: id, label: name }));
  }, [activities]);

  const categoryOptions = useMemo(() => {
    const cats = new Set<string>();
    for (const a of activities) cats.add(getConfig(a.type).category);
    return [...cats].sort().map((c) => ({ value: c, label: c }));
  }, [activities]);

  // Filter + search
  const filtered = useMemo(() => {
    let list = activities;

    if (filterCategory) {
      list = list.filter((a) => getConfig(a.type).category === filterCategory);
    }
    if (filterAction) {
      if (filterAction === "revert") {
        list = list.filter((a) => a.type.startsWith("revert:"));
      } else if (filterAction === "ai") {
        list = list.filter((a) => a.type.startsWith("ai_"));
      } else {
        list = list.filter((a) => a.type.includes(filterAction));
      }
    }
    if (filterUser) {
      list = list.filter((a) => (a.userId ?? a.userName) === filterUser);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((a) => {
        const config = getConfig(a.type);
        const label = config.label(a.data).toLowerCase();
        const user = (a.userName ?? "").toLowerCase();
        const type = a.type.toLowerCase();
        return label.includes(q) || user.includes(q) || type.includes(q);
      });
    }

    if (sortDir === "asc") list = [...list].reverse();

    return list;
  }, [activities, filterCategory, filterAction, filterUser, searchQuery, sortDir]);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [filterCategory, filterAction, filterUser, searchQuery, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const hasFilters = !!(filterCategory || filterAction || filterUser || searchQuery);

  function clearFilters() {
    setSearchQuery("");
    setFilterCategory("");
    setFilterAction("");
    setFilterUser("");
  }

  function handleRevertClick(id: string) { setConfirmId(id); }

  function handleRevertConfirm() {
    if (!confirmId) return;
    const activityId = confirmId;
    setConfirmId(null);
    setReverting(activityId);

    startTransition(async () => {
      try {
        const result = await revertActivity(projectId, activityId);
        onApply(result);
        await fetchActivities();
        setReverting(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Revert failed");
        setReverting(null);
      }
    });
  }

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2 pb-1">
      {/* ─── Filter bar (shrink-0, never scrolls) ─── */}
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg/30" />
          <Input
            className="h-8 pl-8 text-xs"
            placeholder="Search activity..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select className="h-8 text-xs w-[130px]" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="">All categories</option>
          {categoryOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Select className="h-8 text-xs w-[120px]" value={filterAction} onChange={(e) => setFilterAction(e.target.value)}>
          {ACTION_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        {userOptions.length > 1 && (
          <Select className="h-8 text-xs w-[130px]" value={filterUser} onChange={(e) => setFilterUser(e.target.value)}>
            <option value="">All users</option>
            {userOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        )}
        {hasFilters && (
          <Button variant="ghost" size="xs" onClick={clearFilters}>
            <X className="h-3 w-3" /> Clear
          </Button>
        )}
        <div className="flex-1" />
        <Button variant="ghost" size="xs" onClick={() => setSortDir((d) => d === "desc" ? "asc" : "desc")} title={sortDir === "desc" ? "Newest first" : "Oldest first"}>
          {sortDir === "desc" ? "\u2193" : "\u2191"} {sortDir === "desc" ? "Newest" : "Oldest"}
        </Button>
        <Button variant="ghost" size="xs" onClick={() => { setLoading(true); fetchActivities(); }}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* ─── Error ─── */}
      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger shrink-0">
          {error}
          <button className="ml-2 underline" onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {/* ─── Table (fills remaining height, scrolls internally) ─── */}
      <div className="flex-1 min-h-0">
        <div className="overflow-auto rounded-lg border border-line h-full">
          <table className="w-full text-sm">
            <thead className="bg-panel2 text-[11px] font-medium uppercase text-fg/35 sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left w-8" />
                <th className="px-3 py-2 text-left min-w-[280px]">Action</th>
                <th className="px-3 py-2 text-left w-[100px]">Category</th>
                <th className="px-3 py-2 text-left w-[120px]">User</th>
                <th className="px-3 py-2 text-left w-[140px]">When</th>
                <th className="px-3 py-2 text-right w-[90px]" />
              </tr>
            </thead>
            <tbody>
              {loading && activities.length === 0 ? (
                <tr><td colSpan={6} className="py-16 text-center text-sm text-fg/30">Loading activity...</td></tr>
              ) : paged.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center">
                    <EmptyState>
                      {hasFilters ? "No activity matches your filters." : "No activity recorded yet. Changes to this quote will appear here."}
                    </EmptyState>
                  </td>
                </tr>
              ) : paged.map((activity) => {
                const config = getConfig(activity.type);
                const Icon = config.icon;
                const isExpanded = expandedId === activity.id;
                const before = (activity.data.before as Record<string, unknown> | null) ?? null;
                const after = (activity.data.after as Record<string, unknown> | null) ?? null;
                const hasDetails = !!(before || after);

                return (
                  <Fragment key={activity.id}>
                    <tr
                      className={`group border-b border-line/30 transition-colors ${
                        hasDetails ? "cursor-pointer" : ""
                      } ${isExpanded ? "bg-accent/5" : hasDetails ? "hover:bg-panel2/20" : ""}`}
                      onClick={hasDetails ? () => setExpandedId(isExpanded ? null : activity.id) : undefined}
                    >
                      {/* Icon */}
                      <td className="px-3 py-2.5">
                        <div className={`flex h-6 w-6 items-center justify-center rounded-full ${
                          config.tone === "success" ? "bg-success/10 text-success" :
                          config.tone === "danger" ? "bg-danger/10 text-danger" :
                          config.tone === "warning" ? "bg-warning/10 text-warning" :
                          "bg-accent/10 text-accent"
                        }`}>
                          <Icon className="h-3 w-3" />
                        </div>
                      </td>
                      {/* Action description */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-fg/80">
                            <RichLabel text={config.label(activity.data)} />
                          </span>
                          {hasDetails && (
                            <ChevronDown className={`h-3 w-3 text-fg/20 transition-transform ${isExpanded ? "rotate-0" : "-rotate-90"}`} />
                          )}
                        </div>
                      </td>
                      {/* Category */}
                      <td className="px-3 py-2.5">
                        <Badge tone={config.tone === "success" ? "success" : config.tone === "danger" ? "danger" : config.tone === "warning" ? "warning" : "info"}>
                          {config.category}
                        </Badge>
                      </td>
                      {/* User */}
                      <td className="px-3 py-2.5 text-xs text-fg/50">
                        {activity.userName ?? <span className="text-fg/20">System</span>}
                      </td>
                      {/* When */}
                      <td className="px-3 py-2.5 text-xs text-fg/40" title={fullTimestamp(activity.createdAt)}>
                        {relativeTime(activity.createdAt)}
                      </td>
                      {/* Actions */}
                      <td className="px-3 py-2.5 text-right">
                        {activity.revertible && (
                          <Button
                            variant="ghost"
                            size="xs"
                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => { e.stopPropagation(); handleRevertClick(activity.id); }}
                            disabled={reverting === activity.id}
                          >
                            <Undo2 className="h-3 w-3" />
                            {reverting === activity.id ? "Reverting..." : "Revert"}
                          </Button>
                        )}
                      </td>
                    </tr>
                    {/* Expanded detail row */}
                    <AnimatePresence>
                      {isExpanded && hasDetails && (
                        <tr>
                          <td colSpan={6} className="px-3 pb-3">
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.15 }}
                              className="overflow-hidden"
                            >
                              <div className="pl-9 pt-1">
                                <ChangeSummary before={before} after={after} />
                              </div>
                            </motion.div>
                          </td>
                        </tr>
                      )}
                    </AnimatePresence>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Footer: pagination + count (shrink-0, never scrolls) ─── */}
      {activities.length > 0 && (
        <div className="flex items-center justify-between px-1 text-[11px] text-fg/35 shrink-0">
          <span>
            {hasFilters
              ? `${filtered.length} of ${activities.length} entries`
              : `${activities.length} entries`}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="xs" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-3 w-3" />
              </Button>
              <span className="px-1.5 text-[11px] text-fg/50">
                {page + 1} / {totalPages}
              </span>
              <Button variant="ghost" size="xs" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      )}

      <RevertConfirm
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        onConfirm={handleRevertConfirm}
        isPending={isPending}
      />
    </div>
  );
}
