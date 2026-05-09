"use client";

import { Fragment, useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import * as Popover from "@radix-ui/react-popover";
import {
  ArrowUpDown,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  PencilLine,
  Plus,
  Search,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney, formatPercent, formatDate } from "@/lib/format";
import {
  addQuoteToProject,
  createCustomer,
  createProject,
  getCustomers,
  listRateBookAssignments,
  promoteProject,
  type Customer,
  type ProjectListItem,
  type ProjectQuoteEntry,
  type ProjectQuoteSummary,
  type OrgUser,
  type OrgDepartment,
} from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import {
  Badge,
  Button,
  Card,
  FadeIn,
  Input,
  ModalBackdrop,
} from "@/components/ui";
import { getClientDisplayName } from "@/lib/client-display";
import { SearchablePicker } from "@/components/shared/searchable-picker";

type SortKey =
  | "quoteNumber"
  | "kind"
  | "title"
  | "client"
  | "estimator"
  | "status"
  | "subtotal"
  | "margin"
  | "updated";

type SortDir = "asc" | "desc";

const STATUS_OPTIONS = [
  { value: "Open", labelKey: "Open", tone: "info" },
  { value: "Pending", labelKey: "Pending", tone: "warning" },
  { value: "Awarded", labelKey: "Awarded", tone: "success" },
  { value: "DidNotGet", labelKey: "DidNotGet", tone: "danger" },
  { value: "Declined", labelKey: "Declined", tone: "danger" },
  { value: "Cancelled", labelKey: "Cancelled", tone: "default" },
  { value: "Closed", labelKey: "Closed", tone: "default" },
  { value: "Other", labelKey: "Other", tone: "default" },
] as const;

type QuoteStatusValue = (typeof STATUS_OPTIONS)[number]["value"];

function statusTone(status: string) {
  return STATUS_OPTIONS.find((s) => s.value === status)?.tone ?? ("default" as const);
}

function statusLabelKey(status: string): QuoteStatusValue {
  return STATUS_OPTIONS.some((s) => s.value === status) ? (status as QuoteStatusValue) : "Other";
}

function getQuoteKind(project: ProjectListItem): "snap" | "full" {
  const state = project.workspaceState?.state;
  return state?.quoteMode === "snap" && state.snapUpgraded !== true ? "snap" : "full";
}

function getEstimatorLabelForQuote(
  quote: ProjectQuoteSummary | null | undefined,
  userMap: Map<string, OrgUser>,
  departmentMap: Map<string, OrgDepartment>,
  unassignedLabel = "Unassigned",
) {
  if (!quote) return unassignedLabel;
  return (
    (quote.userId && userMap.get(quote.userId)?.name) ||
    quote.userName ||
    (quote.departmentId && departmentMap.get(quote.departmentId)?.name) ||
    unassignedLabel
  );
}

// Each row shown in the quotes list is one of three kinds. Standalone projects
// render as flat quote rows (current look); container projects render as a
// parent row with their quotes nested underneath when expanded.
type StandaloneRow = {
  kind: "standalone";
  project: ProjectListItem;
  entry: ProjectQuoteEntry;
};
type ContainerRow = {
  kind: "container";
  project: ProjectListItem;
  matching: ProjectQuoteEntry[]; // children that pass the filters
  totalQuotes: number; // unfiltered quote count, for the "X quotes" label
  aggregateSubtotal: number;
  latestUpdate: string;
};
type Row = StandaloneRow | ContainerRow;

/* ─── Filter Dropdown ─── */

function FilterDropdown({
  label,
  options,
  selected,
  onChange,
  renderOption,
  clearLabel,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onChange: (values: string[]) => void;
  renderOption?: (opt: { value: string; label: string }, isSelected: boolean) => React.ReactNode;
  clearLabel: string;
}) {
  const [open, setOpen] = useState(false);

  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  };

  const selectedLabels = options
    .filter((o) => selected.includes(o.value))
    .map((o) => o.label);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border px-2.5 h-8 text-xs font-medium transition-colors",
            selected.length > 0
              ? "border-accent/30 bg-accent/5 text-accent hover:bg-accent/10"
              : "border-line bg-bg/50 text-fg/50 hover:text-fg/70 hover:border-line"
          )}
        >
          {label}
          {selected.length > 0 && (
            <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent">
              {selected.length}
            </span>
          )}
          <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 min-w-[180px] rounded-lg border border-line bg-panel shadow-xl py-1"
          sideOffset={4}
          align="start"
        >
          {options.map((opt) => {
            const isSelected = selected.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-1.5 text-xs text-left transition-colors hover:bg-panel2/60",
                  isSelected && "bg-accent/5"
                )}
              >
                <span
                  className={cn(
                    "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors",
                    isSelected ? "border-accent bg-accent text-white" : "border-line bg-bg",
                  )}
                >
                  {isSelected && (
                    <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
                {renderOption ? renderOption(opt, isSelected) : (
                  <span className="text-fg/70">{opt.label}</span>
                )}
              </button>
            );
          })}
          {selected.length > 0 && (
            <>
              <div className="my-1 border-t border-line" />
              <button
                type="button"
                onClick={() => onChange([])}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-fg/40 hover:text-fg/60 transition-colors"
              >
                <X className="h-3 w-3" /> {clearLabel}
              </button>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ─── Row action menu (three-dot) ─── */

function RowActionMenu({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="rounded-md p-1 text-fg/30 transition-colors hover:bg-panel2 hover:text-fg/70"
          aria-label="Row actions"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 w-48 rounded-lg border border-line bg-panel p-1 shadow-xl"
          sideOffset={4}
          align="end"
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ─── Main Component ─── */

export function QuotesList({ projects, users = [], departments = [] }: {
  projects: ProjectListItem[];
  users?: OrgUser[];
  departments?: OrgDepartment[];
}) {
  const t = useTranslations("Quotes");
  const router = useRouter();
  const { user: currentUser } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [clientFilter, setClientFilter] = useState<string[]>([]);
  const [userFilter, setUserFilter] = useState<string[]>(() => {
    // Default: estimators see only their own quotes
    if (currentUser?.role === "estimator" && currentUser.id) return [currentUser.id];
    return [];
  });
  const [departmentFilter, setDepartmentFilter] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [newQuoteMenuOpen, setNewQuoteMenuOpen] = useState(false);
  const [manualCreationMode, setManualCreationMode] = useState<"quote" | "snap">("quote");
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualTitle, setManualTitle] = useState("");
  const [manualCustomerId, setManualCustomerId] = useState("");
  const [manualCustomerOptions, setManualCustomerOptions] = useState<Customer[]>([]);
  const [manualLocation, setManualLocation] = useState("");
  const [manualParentProjectId, setManualParentProjectId] = useState<string | null>(null);
  const [manualParentPickerOpen, setManualParentPickerOpen] = useState(false);
  const [manualError, setManualError] = useState("");
  const [manualSaving, setManualSaving] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddName, setQuickAddName] = useState("");
  const [quickAddSaving, setQuickAddSaving] = useState(false);
  // Container projects expand on click. Initial state: collapsed by default
  // so the table doesn't overwhelm — users opt-in to seeing children.
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(new Set());
  // Promote-shadow-into-container modal state.
  const [promoteFor, setPromoteFor] = useState<{ project: ProjectListItem; quoteTitle: string } | null>(null);
  const [promoteName, setPromoteName] = useState("");
  const [promoteError, setPromoteError] = useState("");
  const [promoteSaving, setPromoteSaving] = useState(false);
  // Per-row action menu visibility (one open at a time).
  const [openRowMenu, setOpenRowMenu] = useState<string | null>(null);
  const unassignedLabel = t("unassigned");

  useEffect(() => {
    if (!manualModalOpen) return;
    let cancelled = false;
    getCustomers()
      .then((customers) => {
        if (cancelled) return;
        setManualCustomerOptions(customers);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [manualModalOpen]);

  // Build a flat list of every (project, quote) pair across the org. Container
  // projects contribute one entry per quote; standalone projects contribute one.
  const allEntries = useMemo(() => {
    const out: Array<{ project: ProjectListItem; entry: ProjectQuoteEntry }> = [];
    for (const p of projects) {
      const list = p.quotes && p.quotes.length > 0
        ? p.quotes
        : p.quote
          ? [{ quote: p.quote, latestRevision: p.latestRevision }]
          : [];
      for (const entry of list) {
        out.push({ project: p, entry });
      }
    }
    return out;
  }, [projects]);

  // Container projects with quotes — these render as expandable parent rows.
  // Real projects with 0 quotes are managed from the projects list page, not here.
  const containerProjects = useMemo(() => {
    return projects.filter((p) => p.isStandalone === false && (p.quotes?.length ?? 0) > 0);
  }, [projects]);

  const standaloneEntries = useMemo(() => {
    return allEntries.filter(({ project }) => project.isStandalone !== false);
  }, [allEntries]);

  // Available existing container projects (for the "Add to existing project"
  // picker in the new-quote modal). Only shown if any exist.
  const existingContainerOptions = useMemo(() => {
    return projects
      .filter((p) => p.isStandalone === false)
      .map((p) => ({
        id: p.id,
        label: p.name,
        secondary: p.clientName || undefined,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [projects]);

  // Derive unique filter options from data
  const clientOptions = useMemo(() => {
    const clients = new Map<string, string>();
    for (const { project, entry } of allEntries) {
      const clientLabel = getClientDisplayName(project, entry.quote);
      if (clientLabel && clientLabel !== "—") clients.set(clientLabel, clientLabel);
    }
    return [...clients.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allEntries]);

  const userMap = useMemo(() => {
    const m = new Map<string, OrgUser>();
    for (const u of users) m.set(u.id, u);
    return m;
  }, [users]);

  const userOptions = useMemo(() => {
    return users.map((u) => ({ value: u.id, label: u.name || u.email }));
  }, [users]);

  const departmentOptions = useMemo(() => {
    return departments.map((d) => ({ value: d.id, label: d.name }));
  }, [departments]);

  const departmentMap = useMemo(() => {
    const m = new Map<string, OrgDepartment>();
    for (const d of departments) m.set(d.id, d);
    return m;
  }, [departments]);

  const hasActiveFilters = statusFilter.length > 0 || clientFilter.length > 0 || userFilter.length > 0 || departmentFilter.length > 0;

  function clearAllFilters() {
    setStatusFilter([]);
    setClientFilter([]);
    setUserFilter([]);
    setDepartmentFilter([]);
    setSearch("");
  }

  function openManualQuoteModal(mode: "quote" | "snap" = "quote", parentProjectId: string | null = null) {
    setManualCreationMode(mode);
    setNewQuoteMenuOpen(false);
    setManualError("");
    setManualParentProjectId(parentProjectId);
    setManualParentPickerOpen(parentProjectId != null);
    setManualModalOpen(true);
  }

  function closeManualQuoteModal() {
    if (manualSaving) return;
    setManualModalOpen(false);
    setManualError("");
    setQuickAddOpen(false);
    setQuickAddName("");
    setManualParentProjectId(null);
    setManualParentPickerOpen(false);
  }

  function toggleExpand(projectId: string) {
    setExpandedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  function openPromoteModal(project: ProjectListItem, entry: ProjectQuoteEntry) {
    setPromoteFor({ project, quoteTitle: entry.quote.title || entry.quote.quoteNumber });
    setPromoteName(project.name);
    setPromoteError("");
    setOpenRowMenu(null);
  }

  function closePromoteModal() {
    if (promoteSaving) return;
    setPromoteFor(null);
    setPromoteError("");
  }

  async function handlePromoteSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!promoteFor) return;
    const name = promoteName.trim();
    if (!name) {
      setPromoteError(t("promote.nameRequired"));
      return;
    }
    setPromoteSaving(true);
    setPromoteError("");
    try {
      await promoteProject(promoteFor.project.id, { name });
      setPromoteFor(null);
      setPromoteSaving(false);
      // Reload to pick up the new isStandalone state.
      router.refresh();
    } catch (error) {
      setPromoteSaving(false);
      setPromoteError(error instanceof Error ? error.message : t("promote.error"));
    }
  }

  async function handleQuickAddCustomer() {
    const name = quickAddName.trim();
    if (!name) return;
    setQuickAddSaving(true);
    setManualError("");
    try {
      const created = await createCustomer({ name, active: true });
      setManualCustomerOptions((prev) => {
        if (prev.some((c) => c.id === created.id)) return prev;
        return [...prev, created];
      });
      setManualCustomerId(created.id);
      setQuickAddName("");
      setQuickAddOpen(false);
    } catch (error) {
      setManualError(error instanceof Error ? error.message : t("manual.failedClient"));
    } finally {
      setQuickAddSaving(false);
    }
  }

  async function handleManualQuoteSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = manualTitle.trim();
    if (!title) {
      setManualError(t("manual.titleRequired"));
      return;
    }

    setManualSaving(true);
    setManualError("");
    try {
      const isSnap = manualCreationMode === "snap";
      const selectedCustomer = manualCustomerOptions.find((c) => c.id === manualCustomerId) ?? null;
      if (isSnap && selectedCustomer) {
        const defaultRatebooks = await listRateBookAssignments({
          customerId: selectedCustomer.id,
          active: true,
        });
        if (defaultRatebooks.length === 0) {
          setManualSaving(false);
          setManualError(`Snap quotes need a default ratebook for ${selectedCustomer.name}. Add one on the client Ratebooks tab, then try again.`);
          return;
        }
      }

      // Path 1: Add the new quote to an existing container project.
      if (manualParentProjectId) {
        const result = await addQuoteToProject(manualParentProjectId, {
          title,
          customerId: selectedCustomer?.id ?? null,
          creationMode: isSnap ? "snap" : "manual",
        });
        router.push(`/projects/${result.project.id}?tab=estimate&subtab=worksheets`);
        return;
      }

      // Path 2: Create a standalone (shadow) project that wraps this single quote.
      const clientName = selectedCustomer?.name || t("manual.unassignedClient");
      const location = manualLocation.trim() || "TBD";
      const result = await createProject({
        name: title,
        clientName,
        customerId: selectedCustomer?.id ?? null,
        location,
        creationMode: isSnap ? "snap" : "manual",
        packageName: isSnap ? `${title} Snap` : `${title} Manual Quote`,
        summary: isSnap ? "Snap quote created for quick small-work pricing." : undefined,
        // Explicit (defaults match server side, but be clear about intent).
        isStandalone: true,
      });

      router.push(`/projects/${result.project.id}?tab=estimate&subtab=worksheets`);
    } catch (error) {
      setManualSaving(false);
      setManualError(error instanceof Error ? error.message : t("manual.createError"));
    }
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const matchesFilters = useMemo(() => {
    const trimmed = search.trim().toLowerCase();
    return (project: ProjectListItem, entry: ProjectQuoteEntry): boolean => {
      const q = entry.quote;
      if (statusFilter.length > 0 && !statusFilter.includes(q.status)) return false;
      if (clientFilter.length > 0 && !clientFilter.includes(getClientDisplayName(project, q))) return false;
      if (userFilter.length > 0 && !(q.userId && userFilter.includes(q.userId))) return false;
      if (departmentFilter.length > 0 && !(q.departmentId && departmentFilter.includes(q.departmentId))) return false;
      if (trimmed) {
        if (
          !q.quoteNumber.toLowerCase().includes(trimmed) &&
          !q.title.toLowerCase().includes(trimmed) &&
          !getClientDisplayName(project, q).toLowerCase().includes(trimmed) &&
          !project.name.toLowerCase().includes(trimmed) &&
          !(project.location || "").toLowerCase().includes(trimmed)
        ) return false;
      }
      return true;
    };
  }, [search, statusFilter, clientFilter, userFilter, departmentFilter]);

  // Sort comparator that operates on a (project, entry) pair. Used for both
  // sorting child quotes within a container and sorting top-level rows
  // (containers use their first matching child for the value).
  const compareEntries = useMemo(() => {
    return (
      a: { project: ProjectListItem; entry: ProjectQuoteEntry },
      b: { project: ProjectListItem; entry: ProjectQuoteEntry },
    ) => {
      let cmp = 0;
      switch (sortKey) {
        case "quoteNumber":
          cmp = a.entry.quote.quoteNumber.localeCompare(b.entry.quote.quoteNumber); break;
        case "kind":
          cmp = getQuoteKind(a.project).localeCompare(getQuoteKind(b.project)); break;
        case "title":
          cmp = a.entry.quote.title.localeCompare(b.entry.quote.title); break;
        case "client":
          cmp = getClientDisplayName(a.project, a.entry.quote).localeCompare(getClientDisplayName(b.project, b.entry.quote)); break;
        case "estimator": {
          const aName = getEstimatorLabelForQuote(a.entry.quote, userMap, departmentMap, unassignedLabel);
          const bName = getEstimatorLabelForQuote(b.entry.quote, userMap, departmentMap, unassignedLabel);
          cmp = aName.localeCompare(bName); break;
        }
        case "status":
          cmp = a.entry.quote.status.localeCompare(b.entry.quote.status); break;
        case "subtotal":
          cmp = (a.entry.latestRevision?.subtotal ?? 0) - (b.entry.latestRevision?.subtotal ?? 0); break;
        case "margin":
          cmp = (a.entry.latestRevision?.estimatedMargin ?? 0) - (b.entry.latestRevision?.estimatedMargin ?? 0); break;
        case "updated": {
          const aT = new Date(a.entry.quote.updatedAt || a.project.updatedAt).getTime();
          const bT = new Date(b.entry.quote.updatedAt || b.project.updatedAt).getTime();
          cmp = aT - bT; break;
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    };
  }, [sortKey, sortDir, userMap, departmentMap, unassignedLabel]);

  // Build the top-level row list: standalone quotes + container projects with
  // at least one matching child. Children inside a container are pre-sorted.
  const { rows, matchedQuoteCount, totalQuoteCount } = useMemo(() => {
    // Standalone rows: one per matching standalone entry.
    const standaloneRows: StandaloneRow[] = standaloneEntries
      .filter(({ project, entry }) => matchesFilters(project, entry))
      .map(({ project, entry }) => ({ kind: "standalone", project, entry }));

    // Container rows: one per container project that has any matching child.
    const containerRows: ContainerRow[] = [];
    for (const project of containerProjects) {
      const allChildren = project.quotes ?? [];
      const matching = allChildren.filter((entry) => matchesFilters(project, entry));
      if (matching.length === 0) continue;
      const sortedChildren = [...matching].sort((a, b) =>
        compareEntries({ project, entry: a }, { project, entry: b }),
      );
      const aggregateSubtotal = sortedChildren.reduce(
        (sum, c) => sum + (c.latestRevision?.subtotal ?? 0),
        0,
      );
      const latestUpdate = sortedChildren
        .map((c) => c.quote.updatedAt || project.updatedAt)
        .sort()
        .reverse()[0] || project.updatedAt;
      containerRows.push({
        kind: "container",
        project,
        matching: sortedChildren,
        totalQuotes: allChildren.length,
        aggregateSubtotal,
        latestUpdate,
      });
    }

    // Sort the merged list. Containers compare via their first (already-sorted)
    // matching child — except the "subtotal" sort key, which uses the aggregate.
    const merged: Row[] = [...standaloneRows, ...containerRows];
    merged.sort((a, b) => {
      const aPair = a.kind === "standalone"
        ? { project: a.project, entry: a.entry }
        : { project: a.project, entry: a.matching[0] };
      const bPair = b.kind === "standalone"
        ? { project: b.project, entry: b.entry }
        : { project: b.project, entry: b.matching[0] };
      if (sortKey === "subtotal") {
        const aSub = a.kind === "container" ? a.aggregateSubtotal : (a.entry.latestRevision?.subtotal ?? 0);
        const bSub = b.kind === "container" ? b.aggregateSubtotal : (b.entry.latestRevision?.subtotal ?? 0);
        return sortDir === "asc" ? aSub - bSub : bSub - aSub;
      }
      return compareEntries(aPair, bPair);
    });

    const matchedQuotes =
      standaloneRows.length +
      containerRows.reduce((sum, r) => sum + r.matching.length, 0);
    return { rows: merged, matchedQuoteCount: matchedQuotes, totalQuoteCount: allEntries.length };
  }, [standaloneEntries, containerProjects, matchesFilters, compareEntries, sortKey, sortDir, allEntries.length]);

  const headers: { key: SortKey; label: string; className?: string }[] = [
    { key: "quoteNumber", label: t("table.quoteNumber"), className: "w-32" },
    { key: "kind", label: t("table.kind"), className: "w-20" },
    { key: "title", label: t("table.title") },
    { key: "client", label: t("table.client"), className: "w-40" },
    { key: "estimator", label: t("table.estimator"), className: "w-36" },
    { key: "status", label: t("table.status"), className: "w-24" },
    { key: "subtotal", label: t("table.subtotal"), className: "w-28 text-right" },
    { key: "margin", label: t("table.margin"), className: "w-20 text-right" },
    { key: "updated", label: t("table.updated"), className: "w-28" },
  ];
  const manualIsSnap = manualCreationMode === "snap";

  return (
    <div className="space-y-5">
      {/* Header */}
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-fg">{t("title")}</h1>
            <p className="text-xs text-fg/50">{t("subtitle")}</p>
          </div>
          <Popover.Root open={newQuoteMenuOpen} onOpenChange={setNewQuoteMenuOpen}>
            <Popover.Trigger asChild>
              <Button variant="accent" size="sm">
                <Plus className="h-3.5 w-3.5" />
                {t("newQuoteButton")}
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", newQuoteMenuOpen && "rotate-180")} />
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className="z-50 w-52 rounded-lg border border-line bg-panel p-1 shadow-xl"
                sideOffset={6}
                align="end"
              >
                <Link
                  href="/intake"
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-fg/75 transition-colors hover:bg-panel2 hover:text-fg"
                  onClick={() => setNewQuoteMenuOpen(false)}
                >
                  <Bot className="h-3.5 w-3.5 text-accent" />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{t("menu.aiIntake")}</span>
                    <span className="text-[11px] text-fg/40">{t("menu.aiIntakeDescription")}</span>
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => openManualQuoteModal("quote")}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-fg/75 transition-colors hover:bg-panel2 hover:text-fg"
                >
                  <PencilLine className="h-3.5 w-3.5 text-accent" />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{t("menu.newQuote")}</span>
                    <span className="text-[11px] text-fg/40">{t("menu.newQuoteDescription")}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => openManualQuoteModal("snap")}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-fg/75 transition-colors hover:bg-panel2 hover:text-fg"
                >
                  <Zap className="h-3.5 w-3.5 text-accent" />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{t("menu.newSnap")}</span>
                    <span className="text-[11px] text-fg/40">{t("menu.newSnapDescription")}</span>
                  </span>
                </button>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
      </FadeIn>

      <ModalBackdrop open={manualModalOpen} onClose={closeManualQuoteModal} size="md">
        <form onSubmit={handleManualQuoteSubmit} className="rounded-xl border border-line bg-panel shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-fg">{manualIsSnap ? t("manual.snapTitle") : t("manual.quoteTitle")}</h2>
              <p className="mt-0.5 text-xs text-fg/50">
                {manualIsSnap
                  ? t("manual.snapDescription")
                  : t("manual.quoteDescription")}
              </p>
            </div>
            <button
              type="button"
              onClick={closeManualQuoteModal}
              className="rounded-md p-1 text-fg/35 transition-colors hover:bg-panel2 hover:text-fg/70"
              aria-label={t("manual.close")}
              disabled={manualSaving}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3 px-5 py-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-fg/65">{manualIsSnap ? t("manual.snapTitleLabel") : t("manual.quoteTitleLabel")}</span>
              <Input
                autoFocus
                value={manualTitle}
                onChange={(event) => setManualTitle(event.target.value)}
                placeholder={manualIsSnap ? t("manual.snapTitlePlaceholder") : t("manual.quoteTitlePlaceholder")}
                disabled={manualSaving}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <span className="text-xs font-medium text-fg/65">{t("manual.client")}</span>
                {quickAddOpen ? (
                  <div className="flex min-w-0 gap-1.5">
                    <Input
                      value={quickAddName}
                      onChange={(event) => setQuickAddName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          handleQuickAddCustomer();
                        }
                      }}
                      placeholder={t("manual.newClientName")}
                      autoFocus
                      disabled={quickAddSaving}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="accent"
                      onClick={handleQuickAddCustomer}
                      disabled={quickAddSaving || !quickAddName.trim()}
                    >
                      {quickAddSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setQuickAddOpen(false);
                        setQuickAddName("");
                      }}
                      disabled={quickAddSaving}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex min-w-0 gap-1.5">
                    <div className="min-w-0 flex-1">
                      <SearchablePicker
                        value={manualCustomerId || null}
                        onSelect={setManualCustomerId}
                        options={manualCustomerOptions
                          .filter((c) => c.active)
                          .map((c) => ({
                            id: c.id,
                            label: c.name,
                            secondary: c.shortName || undefined,
                          }))}
                        placeholder={t("manual.selectClient")}
                        searchPlaceholder={t("manual.searchClients")}
                        disabled={manualSaving}
                        triggerClassName="h-9 rounded-lg px-3 text-sm bg-bg/50"
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setQuickAddOpen(true)}
                      disabled={manualSaving}
                      title={t("manual.addClient")}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-fg/65">{t("manual.location")}</span>
                <Input
                  value={manualLocation}
                  onChange={(event) => setManualLocation(event.target.value)}
                  placeholder={t("manual.locationPlaceholder")}
                  disabled={manualSaving || manualParentProjectId != null}
                />
              </label>
            </div>

            {/* Optional: add this quote to an existing container project. */}
            {existingContainerOptions.length > 0 && (
              <div className="space-y-1.5">
                {!manualParentPickerOpen ? (
                  <button
                    type="button"
                    onClick={() => setManualParentPickerOpen(true)}
                    disabled={manualSaving}
                    className="inline-flex items-center gap-1.5 text-[11px] text-fg/50 hover:text-fg/80 transition-colors"
                  >
                    <Folder className="h-3 w-3" />
                    {t("manual.addToProject")}
                  </button>
                ) : (
                  <div className="space-y-1.5">
                    <span className="flex items-center justify-between text-xs font-medium text-fg/65">
                      {t("manual.parentProject")}
                      <button
                        type="button"
                        onClick={() => {
                          setManualParentPickerOpen(false);
                          setManualParentProjectId(null);
                        }}
                        disabled={manualSaving}
                        className="text-[11px] text-fg/40 hover:text-fg/70"
                      >
                        {t("manual.standaloneQuote")}
                      </button>
                    </span>
                    <SearchablePicker
                      value={manualParentProjectId}
                      onSelect={setManualParentProjectId}
                      options={existingContainerOptions}
                      placeholder={t("manual.selectProject")}
                      searchPlaceholder={t("manual.searchProjects")}
                      disabled={manualSaving}
                      triggerClassName="h-9 rounded-lg px-3 text-sm bg-bg/50"
                    />
                    {manualParentProjectId && (
                      <p className="text-[11px] text-fg/40">{t("manual.parentProjectHint")}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {manualError && (
              <div className="rounded-lg border border-danger/25 bg-danger/8 px-3 py-2 text-xs text-danger">
                {manualError}
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
            <Button type="button" variant="ghost" size="sm" onClick={closeManualQuoteModal} disabled={manualSaving}>
              {t("manual.cancel")}
            </Button>
            <Button type="submit" variant="accent" size="sm" disabled={manualSaving}>
              {manualSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {manualIsSnap ? t("manual.createSnap") : t("manual.createQuote")}
            </Button>
          </div>
        </form>
      </ModalBackdrop>

      {/* Promote (group into project) modal */}
      <ModalBackdrop open={promoteFor != null} onClose={closePromoteModal} size="sm">
        {promoteFor && (
          <form onSubmit={handlePromoteSubmit} className="rounded-xl border border-line bg-panel shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-fg">{t("promote.title")}</h2>
                <p className="mt-0.5 text-xs text-fg/50">
                  {t("promote.description", { quote: promoteFor.quoteTitle })}
                </p>
              </div>
              <button
                type="button"
                onClick={closePromoteModal}
                className="rounded-md p-1 text-fg/35 transition-colors hover:bg-panel2 hover:text-fg/70"
                aria-label={t("manual.close")}
                disabled={promoteSaving}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-fg/65">{t("promote.nameLabel")}</span>
                <Input
                  autoFocus
                  value={promoteName}
                  onChange={(event) => setPromoteName(event.target.value)}
                  placeholder={t("promote.namePlaceholder")}
                  disabled={promoteSaving}
                />
              </label>
              <p className="text-[11px] text-fg/45">{t("promote.hint")}</p>
              {promoteError && (
                <div className="rounded-lg border border-danger/25 bg-danger/8 px-3 py-2 text-xs text-danger">
                  {promoteError}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
              <Button type="button" variant="ghost" size="sm" onClick={closePromoteModal} disabled={promoteSaving}>
                {t("manual.cancel")}
              </Button>
              <Button type="submit" variant="accent" size="sm" disabled={promoteSaving}>
                {promoteSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderPlus className="h-3.5 w-3.5" />}
                {t("promote.submit")}
              </Button>
            </div>
          </form>
        )}
      </ModalBackdrop>

      {/* View tabs: switch between flat quote list and projects list */}
      <FadeIn delay={0.05}>
        <div className="flex items-center gap-1 border-b border-line">
          <span className="border-b-2 border-accent px-3 py-2 text-xs font-medium text-fg">
            {t("tabs.quotes")}
          </span>
          <Link
            href="/projects"
            className="border-b-2 border-transparent px-3 py-2 text-xs font-medium text-fg/45 transition-colors hover:text-fg/80"
          >
            {t("tabs.projects")}
          </Link>
        </div>
      </FadeIn>

      {/* Filter bar */}
      <FadeIn delay={0.1}>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[280px] max-w-lg">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/25" />
            <Input
              className="h-8 pl-9 text-xs"
              placeholder={t("filters.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg/30 hover:text-fg/60 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Status filter */}
          <FilterDropdown
            label={t("filters.status")}
            options={STATUS_OPTIONS.map((s) => ({ value: s.value, label: t(`status.${s.labelKey}`) }))}
            selected={statusFilter}
            onChange={setStatusFilter}
            clearLabel={t("filters.clear")}
            renderOption={(opt) => (
              <span className="flex items-center gap-2">
                <Badge tone={statusTone(opt.value) as any} className="text-[9px]">{opt.label}</Badge>
              </span>
            )}
          />

          {/* Client filter */}
          {clientOptions.length > 0 && (
            <FilterDropdown
              label={t("filters.client")}
              options={clientOptions}
              selected={clientFilter}
              onChange={setClientFilter}
              clearLabel={t("filters.clear")}
            />
          )}

          {/* Estimator filter */}
          <FilterDropdown
            label={t("filters.estimator")}
            options={userOptions}
            selected={userFilter}
            onChange={setUserFilter}
            clearLabel={t("filters.clear")}
          />

          {/* Department filter */}
          {departmentOptions.length > 0 && (
            <FilterDropdown
              label={t("filters.department")}
              options={departmentOptions}
              selected={departmentFilter}
              onChange={setDepartmentFilter}
              clearLabel={t("filters.clear")}
            />
          )}

          {/* Clear all */}
          {(hasActiveFilters || search) && (
            <button
              onClick={clearAllFilters}
              className="inline-flex items-center gap-1 rounded-lg px-2 h-8 text-xs text-fg/40 hover:text-fg/70 transition-colors"
            >
              <X className="h-3 w-3" /> {t("filters.clearAll")}
            </button>
          )}

          {/* Result count */}
          <span className="ml-auto text-[11px] text-fg/30 tabular-nums shrink-0">
            {matchedQuoteCount === totalQuoteCount
              ? t("filters.resultCount", { count: matchedQuoteCount })
              : t("filters.filteredResultCount", { filtered: matchedQuoteCount, total: totalQuoteCount })}
          </span>
        </div>
      </FadeIn>

      {/* Table */}
      <FadeIn delay={0.15}>
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  {headers.map((h) => (
                    <th
                      key={h.key}
                      className={cn(
                        "px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40 cursor-pointer select-none hover:text-fg/70 transition-colors",
                        h.className
                      )}
                      onClick={() => handleSort(h.key)}
                    >
                      <span className="inline-flex items-center gap-1">
                        {h.label}
                        <ArrowUpDown
                          className={cn("h-3 w-3", sortKey === h.key ? "text-accent" : "text-fg/15")}
                        />
                      </span>
                    </th>
                  ))}
                  <th className="w-8 px-2 py-2.5" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={headers.length + 1} className="px-5 py-12 text-center text-sm text-fg/40">
                      <FileText className="mx-auto mb-2 h-8 w-8 text-fg/20" />
                      {hasActiveFilters || search ? t("emptyFiltered") : t("empty")}
                    </td>
                  </tr>
                )}
                {rows.map((row, i) => {
                  if (row.kind === "standalone") {
                    const project = row.project;
                    const entry = row.entry;
                    const quoteKind = getQuoteKind(project);
                    const rowKey = `q:${entry.quote.id}`;
                    return (
                      <motion.tr
                        key={rowKey}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, delay: i * 0.02, ease: "easeOut" }}
                        className="group border-b border-line last:border-0 hover:bg-panel2/40 transition-colors"
                      >
                        <td className="px-4 py-2.5 text-xs font-medium text-accent whitespace-nowrap">
                          <Link href={`/projects/${project.id}`} className="hover:underline">
                            {entry.quote.quoteNumber}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge tone={quoteKind === "snap" ? "info" : "default"} className="gap-1">
                            {quoteKind === "snap" && <Zap className="h-3 w-3" />}
                            {quoteKind === "snap" ? t("kind.snap") : t("kind.full")}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-fg/80">
                          <Link href={`/projects/${project.id}`} className="hover:underline">
                            {entry.quote.title || project.name}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-fg/60">
                          {getClientDisplayName(project, entry.quote)}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-fg/60">
                          {getEstimatorLabelForQuote(entry.quote, userMap, departmentMap, unassignedLabel)}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge tone={statusTone(entry.quote.status) as any}>
                            {t(`status.${statusLabelKey(entry.quote.status)}`)}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs font-medium text-fg/80 tabular-nums">
                          {formatMoney(entry.latestRevision?.subtotal ?? 0)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs text-fg/60 tabular-nums">
                          {formatPercent(entry.latestRevision?.estimatedMargin ?? 0)}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-fg/50">
                          {formatDate(entry.quote.updatedAt || project.updatedAt)}
                        </td>
                        <td className="w-8 px-2 py-2.5 text-right">
                          <RowActionMenu
                            open={openRowMenu === rowKey}
                            onOpenChange={(open) => setOpenRowMenu(open ? rowKey : null)}
                          >
                            <button
                              type="button"
                              onClick={() => openPromoteModal(project, entry)}
                              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-fg/75 transition-colors hover:bg-panel2 hover:text-fg"
                            >
                              <FolderPlus className="h-3.5 w-3.5 text-accent" />
                              {t("actions.groupIntoProject")}
                            </button>
                          </RowActionMenu>
                        </td>
                      </motion.tr>
                    );
                  }

                  // Container row + (when expanded) its matching children.
                  const project = row.project;
                  const expanded = expandedProjectIds.has(project.id);
                  const childKind = getQuoteKind(project);
                  return (
                    <Fragment key={`p:${project.id}`}>
                      <motion.tr
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, delay: i * 0.02, ease: "easeOut" }}
                        className="border-b border-line last:border-0 cursor-pointer bg-panel2/30 hover:bg-panel2/60 transition-colors"
                        onClick={() => toggleExpand(project.id)}
                      >
                        <td className="px-4 py-2.5 text-xs font-medium text-fg/70 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <ChevronRight
                              className={cn("h-3.5 w-3.5 text-fg/50 transition-transform", expanded && "rotate-90")}
                            />
                            {expanded ? <FolderOpen className="h-3.5 w-3.5 text-accent" /> : <Folder className="h-3.5 w-3.5 text-accent" />}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge tone="default" className="text-[10px]">
                            {t("group.quotesCount", { count: row.totalQuotes })}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-xs font-medium text-fg/85" colSpan={2}>
                          <Link
                            href={`/projects/${project.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:underline"
                          >
                            {project.name}
                          </Link>
                          {project.clientName ? (
                            <span className="ml-2 text-fg/40">· {project.clientName}</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-fg/40" colSpan={2}>
                          {/* estimator + status: not aggregated for containers */}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs font-medium text-fg/80 tabular-nums">
                          {formatMoney(row.aggregateSubtotal)}
                        </td>
                        <td className="px-4 py-2.5" />
                        <td className="px-4 py-2.5 text-xs text-fg/50">
                          {formatDate(row.latestUpdate)}
                        </td>
                        <td className="w-8 px-2 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                          <RowActionMenu
                            open={openRowMenu === `p:${project.id}`}
                            onOpenChange={(open) => setOpenRowMenu(open ? `p:${project.id}` : null)}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setOpenRowMenu(null);
                                openManualQuoteModal("quote", project.id);
                              }}
                              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-fg/75 transition-colors hover:bg-panel2 hover:text-fg"
                            >
                              <Plus className="h-3.5 w-3.5 text-accent" />
                              {t("actions.addQuote")}
                            </button>
                          </RowActionMenu>
                        </td>
                      </motion.tr>
                      {expanded && row.matching.map((entry) => {
                        const childKey = `q:${entry.quote.id}`;
                        return (
                          <motion.tr
                            key={childKey}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.15 }}
                            className="border-b border-line last:border-0 hover:bg-panel2/40 transition-colors"
                          >
                            <td className="px-4 py-2.5 pl-10 text-xs font-medium text-accent whitespace-nowrap">
                              <Link href={`/projects/${project.id}`} className="hover:underline">
                                {entry.quote.quoteNumber}
                              </Link>
                            </td>
                            <td className="px-4 py-2.5">
                              <Badge tone={childKind === "snap" ? "info" : "default"} className="gap-1">
                                {childKind === "snap" && <Zap className="h-3 w-3" />}
                                {childKind === "snap" ? t("kind.snap") : t("kind.full")}
                              </Badge>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-fg/80">
                              <Link href={`/projects/${project.id}`} className="hover:underline">
                                {entry.quote.title || project.name}
                              </Link>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-fg/60">
                              {getClientDisplayName(project, entry.quote)}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-fg/60">
                              {getEstimatorLabelForQuote(entry.quote, userMap, departmentMap, unassignedLabel)}
                            </td>
                            <td className="px-4 py-2.5">
                              <Badge tone={statusTone(entry.quote.status) as any}>
                                {t(`status.${statusLabelKey(entry.quote.status)}`)}
                              </Badge>
                            </td>
                            <td className="px-4 py-2.5 text-right text-xs font-medium text-fg/80 tabular-nums">
                              {formatMoney(entry.latestRevision?.subtotal ?? 0)}
                            </td>
                            <td className="px-4 py-2.5 text-right text-xs text-fg/60 tabular-nums">
                              {formatPercent(entry.latestRevision?.estimatedMargin ?? 0)}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-fg/50">
                              {formatDate(entry.quote.updatedAt || project.updatedAt)}
                            </td>
                            <td className="w-8 px-2 py-2.5 text-right" />
                          </motion.tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </FadeIn>
    </div>
  );
}
