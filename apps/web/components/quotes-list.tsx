"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import * as Popover from "@radix-ui/react-popover";
import {
  AlertCircle,
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
  getProjectsWithFilters,
  listRateBookAssignments,
  promoteProject,
  type Customer,
  type ProjectListItem,
  type ProjectQuoteEntry,
  type ProjectQuoteSummary,
  type ProjectsResponse,
  type QuotesSortKey,
} from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Input,
  ListNavProvider,
  ListPageLayout,
  PageHeader,
  RecordList,
  SearchInput,
  type RecordColumn,
} from "@appkit/ui";
import {
  FadeIn,
  ModalBackdrop,
} from "@/components/legacy-controls";
import { getClientDisplayName } from "@/lib/client-display";
import { SearchablePicker } from "@/components/shared/searchable-picker";

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

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [25, 50, 100];
const DEFAULT_SORT_KEY: QuotesSortKey = "updated";
const DEFAULT_SORT_DIR: SortDir = "desc";

type QuoteStatusValue = (typeof STATUS_OPTIONS)[number]["value"];

function statusTone(status: string) {
  const tone = STATUS_OPTIONS.find((s) => s.value === status)?.tone ?? "default";
  return tone === "danger" ? "destructive" : tone === "default" ? "secondary" : tone;
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
  unassignedLabel = "Unassigned",
) {
  if (!quote) return unassignedLabel;
  return quote.userName || quote.departmentName || unassignedLabel;
}

type QuotesQueryParams = {
  page: number;
  pageSize: number;
  search: string;
  status: string[];
  clientNames: string[];
  userIds: string[];
  departmentIds: string[];
  sortKey: QuotesSortKey;
  sortDir: SortDir;
};

type QuoteRecordRow = {
  id: string;
  rowType: "project" | "quote";
  project: ProjectListItem;
  entry: ProjectQuoteEntry | null;
  isChild: boolean;
  quoteNumber: string;
  quoteKind: "snap" | "full" | "project";
  title: string;
  client: string;
  estimator: string;
  status: string;
  subtotal: number;
  margin: number | null;
  updated: string;
};

function useQuotesQuery() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const params = useMemo<QuotesQueryParams>(() => ({
    page: Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1),
    pageSize: Math.max(1, parseInt(searchParams.get("size") || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE),
    search: searchParams.get("q") || "",
    status: searchParams.getAll("status"),
    clientNames: searchParams.getAll("clients"),
    userIds: searchParams.getAll("users"),
    departmentIds: searchParams.getAll("depts"),
    sortKey: (searchParams.get("sort") as QuotesSortKey) || DEFAULT_SORT_KEY,
    sortDir: (searchParams.get("dir") as SortDir) || DEFAULT_SORT_DIR,
  }), [searchParams]);

  const update = useCallback((next: Partial<QuotesQueryParams>, opts?: { resetPage?: boolean }) => {
    const merged = { ...params, ...next };
    if (opts?.resetPage) merged.page = 1;
    const sp = new URLSearchParams();
    if (merged.page !== 1) sp.set("page", String(merged.page));
    if (merged.pageSize !== DEFAULT_PAGE_SIZE) sp.set("size", String(merged.pageSize));
    if (merged.search) sp.set("q", merged.search);
    for (const v of merged.status) sp.append("status", v);
    for (const v of merged.clientNames) sp.append("clients", v);
    for (const v of merged.userIds) sp.append("users", v);
    for (const v of merged.departmentIds) sp.append("depts", v);
    if (merged.sortKey !== DEFAULT_SORT_KEY) sp.set("sort", merged.sortKey);
    if (merged.sortDir !== DEFAULT_SORT_DIR) sp.set("dir", merged.sortDir);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, router, pathname]);

  return { params, update, rawSearchString: searchParams.toString() };
}

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
          className="z-50 min-w-[180px] max-h-[320px] overflow-y-auto rounded-lg border border-line bg-panel shadow-xl py-1"
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

/* ─── Row action menu ─── */

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

export function QuotesList() {
  const t = useTranslations("Quotes");
  const router = useRouter();
  const { user: currentUser } = useAuth();
  const { params, update, rawSearchString } = useQuotesQuery();
  const pathname = usePathname();
  const listNav = useMemo(() => ({
    pathname,
    search: rawSearchString,
    replace: (href: string) => router.replace(href, { scroll: false }),
    push: (href: string) => router.push(href, { scroll: false }),
  }), [pathname, rawSearchString, router]);

  // Estimator default: on first mount with no URL state, scope to own quotes
  const initialMountHandled = useRef(false);
  useEffect(() => {
    if (initialMountHandled.current) return;
    if (!currentUser) return;
    initialMountHandled.current = true;
    if (
      rawSearchString === "" &&
      currentUser.role === "estimator" &&
      currentUser.id
    ) {
      update({ userIds: [currentUser.id] });
    }
  }, [currentUser, rawSearchString, update]);

  // ── Modal/quick-add state ────────────────────────────────────────────────
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
  // Container projects expand on click; collapsed by default.
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

  // ── Server fetch ─────────────────────────────────────────────────────────
  const [data, setData] = useState<ProjectsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getProjectsWithFilters({
      page: params.page,
      pageSize: params.pageSize,
      search: params.search || undefined,
      status: params.status.length ? params.status : undefined,
      userIds: params.userIds.length ? params.userIds : undefined,
      departmentIds: params.departmentIds.length ? params.departmentIds : undefined,
      clientNames: params.clientNames.length ? params.clientNames : undefined,
      sortKey: params.sortKey,
      sortDir: params.sortDir,
    })
      .then((res) => {
        if (cancelled) return;
        setData(res);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("loadError"));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    params.page,
    params.pageSize,
    params.search,
    params.sortKey,
    params.sortDir,
    params.status.join(","),
    params.userIds.join(","),
    params.departmentIds.join(","),
    params.clientNames.join(","),
    reloadTick,
    t,
  ]);

  // After page-bounds shift (e.g. delete leaves empty page), redirect to page 1
  useEffect(() => {
    if (!data?.pagination) return;
    if (params.page > data.pagination.totalPages) {
      update({ page: 1 });
    }
  }, [data, params.page, update]);

  const projects = data?.projects ?? [];
  const users = data?.users ?? [];
  const departments = data?.departments ?? [];
  const pagination = data?.pagination;
  const total = pagination?.total ?? 0;
  const isInitialLoading = loading && !data;
  const isRevalidating = loading && !!data;

  const clientOptions = useMemo(() => {
    if (data?.clientOptions && data.clientOptions.length > 0) return data.clientOptions;
    // Fallback: derive from current page
    const set = new Map<string, string>();
    for (const p of projects) {
      const name = getClientDisplayName(p, p.quote);
      if (name && name !== "—") set.set(name, name);
    }
    return [...set.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [data, projects]);

  const userOptions = useMemo(
    () => users.map((u) => ({ value: u.id, label: u.name || u.email })),
    [users],
  );
  const departmentOptions = useMemo(
    () => departments.map((d) => ({ value: d.id, label: d.name })),
    [departments],
  );

  // Existing container projects (for the "Add to existing project" picker).
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

  const hasActiveFilters =
    params.status.length > 0 ||
    params.clientNames.length > 0 ||
    params.userIds.length > 0 ||
    params.departmentIds.length > 0;

  function clearAllFilters() {
    update({
      status: [],
      clientNames: [],
      userIds: [],
      departmentIds: [],
      search: "",
    }, { resetPage: true });
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
      // Force a refetch so the row re-renders as a container.
      setReloadTick((n) => n + 1);
    } catch (err) {
      setPromoteSaving(false);
      setPromoteError(err instanceof Error ? err.message : t("promote.error"));
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
    } catch (err) {
      setManualError(err instanceof Error ? err.message : t("manual.failedClient"));
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

      // Path 1: add this quote to an existing container project.
      if (manualParentProjectId) {
        const result = await addQuoteToProject(manualParentProjectId, {
          title,
          customerId: selectedCustomer?.id ?? null,
          creationMode: isSnap ? "snap" : "manual",
        });
        router.push(`/projects/${result.project.id}?tab=estimate&subtab=worksheets`);
        return;
      }

      // Path 2: create a standalone (shadow) project that wraps this quote.
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
        isStandalone: true,
      });

      router.push(`/projects/${result.project.id}?tab=estimate&subtab=worksheets`);
    } catch (err) {
      setManualSaving(false);
      setManualError(err instanceof Error ? err.message : t("manual.createError"));
    }
  }

  function handleSort(key: QuotesSortKey) {
    if (params.sortKey === key) {
      update({ sortDir: params.sortDir === "asc" ? "desc" : "asc" }, { resetPage: true });
    } else {
      update({ sortKey: key, sortDir: "asc" }, { resetPage: true });
    }
  }

  const manualIsSnap = manualCreationMode === "snap";
  const recordRows = useMemo<QuoteRecordRow[]>(() => {
    const result: QuoteRecordRow[] = [];
    for (const project of projects) {
      const entries = project.quotes && project.quotes.length > 0
        ? project.quotes
        : project.quote
          ? [{ quote: project.quote, latestRevision: project.latestRevision }]
          : [];
      const isContainer = project.isStandalone === false && entries.length > 0;
      if (isContainer) {
        const latestUpdate = entries
          .map((entry) => entry.quote.updatedAt || project.updatedAt)
          .sort()
          .reverse()[0] || project.updatedAt;
        result.push({
          id: `p:${project.id}`,
          rowType: "project",
          project,
          entry: null,
          isChild: false,
          quoteNumber: "",
          quoteKind: "project",
          title: project.name,
          client: project.clientName || "—",
          estimator: "",
          status: "",
          subtotal: entries.reduce((sum, entry) => sum + (entry.latestRevision?.subtotal ?? 0), 0),
          margin: null,
          updated: latestUpdate,
        });
        if (!expandedProjectIds.has(project.id)) continue;
      }
      for (const entry of entries) {
        result.push({
          id: `q:${entry.quote.id}`,
          rowType: "quote",
          project,
          entry,
          isChild: isContainer,
          quoteNumber: entry.quote.quoteNumber,
          quoteKind: getQuoteKind(project),
          title: entry.quote.title || project.name,
          client: getClientDisplayName(project, entry.quote),
          estimator: getEstimatorLabelForQuote(entry.quote, unassignedLabel),
          status: entry.quote.status,
          subtotal: entry.latestRevision?.subtotal ?? 0,
          margin: entry.latestRevision?.estimatedMargin ?? 0,
          updated: entry.quote.updatedAt || project.updatedAt,
        });
      }
    }
    return result;
  }, [expandedProjectIds, projects, unassignedLabel]);

  const columns: RecordColumn<QuoteRecordRow>[] = [
    {
      key: "quoteNumber",
      label: t("table.quoteNumber"),
      sortable: true,
      width: "8rem",
      render: (row) => row.rowType === "project" ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            toggleExpand(row.project.id);
          }}
          className="inline-flex items-center gap-1.5 font-medium text-fg-muted hover:text-fg"
        >
          <ChevronRight
            className={cn("size-4 transition-transform", expandedProjectIds.has(row.project.id) && "rotate-90")}
          />
          {expandedProjectIds.has(row.project.id)
            ? <FolderOpen className="size-4 text-primary" />
            : <Folder className="size-4 text-primary" />}
        </button>
      ) : (
        <Link
          href={`/projects/${row.project.id}`}
          onClick={(event) => event.stopPropagation()}
          className={cn(
            "inline-flex whitespace-nowrap font-medium text-primary hover:underline",
            row.isChild && "pl-7",
          )}
        >
          {row.quoteNumber}
        </Link>
      ),
    },
    {
      key: "kind",
      label: t("table.kind"),
      sortable: true,
      width: "7rem",
      render: (row) => row.rowType === "project" ? (
        <Badge variant="secondary">{t("group.quotesCount", { count: row.project.quotes?.length ?? 0 })}</Badge>
      ) : (
        <Badge variant={row.quoteKind === "snap" ? "info" : "secondary"}>
          {row.quoteKind === "snap" && <Zap className="size-3" />}
          {row.quoteKind === "snap" ? t("kind.snap") : t("kind.full")}
        </Badge>
      ),
    },
    {
      key: "title",
      label: t("table.title"),
      sortable: true,
      render: (row) => (
        <Link
          href={`/projects/${row.project.id}`}
          onClick={(event) => event.stopPropagation()}
          className={cn("font-medium hover:text-primary", row.rowType === "project" && "text-fg")}
        >
          {row.title}
        </Link>
      ),
    },
    {
      key: "client",
      label: t("table.client"),
      sortable: true,
      width: "10rem",
      render: (row) => <span className="text-fg-muted">{row.client}</span>,
    },
    {
      key: "estimator",
      label: t("table.estimator"),
      sortable: true,
      width: "9rem",
      render: (row) => <span className="text-fg-muted">{row.estimator || "—"}</span>,
    },
    {
      key: "status",
      label: t("table.status"),
      sortable: true,
      width: "7rem",
      render: (row) => row.status ? (
        <Badge variant={statusTone(row.status)}>
          {t(`status.${statusLabelKey(row.status)}`)}
        </Badge>
      ) : <span className="text-fg-subtle">—</span>,
    },
    {
      key: "subtotal",
      label: t("table.subtotal"),
      sortable: true,
      kind: "amount",
      width: "8rem",
      render: (row) => <div className="text-right font-medium tabular-nums">{formatMoney(row.subtotal)}</div>,
    },
    {
      key: "margin",
      label: t("table.margin"),
      sortable: true,
      kind: "amount",
      width: "6rem",
      render: (row) => (
        <div className="text-right tabular-nums">
          {row.margin == null ? "—" : formatPercent(row.margin)}
        </div>
      ),
    },
    {
      key: "updated",
      label: t("table.updated"),
      sortable: true,
      width: "8rem",
      render: (row) => <span className="whitespace-nowrap text-fg-muted">{formatDate(row.updated)}</span>,
    },
    {
      key: "actions",
      label: "",
      kind: "actions",
      width: "2rem",
      render: (row) => {
        if (row.rowType === "quote" && !row.isChild && row.entry) {
          return (
            <RowActionMenu
              open={openRowMenu === row.id}
              onOpenChange={(open) => setOpenRowMenu(open ? row.id : null)}
            >
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  openPromoteModal(row.project, row.entry!);
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-fg-muted hover:bg-surface-hover hover:text-fg"
              >
                <FolderPlus className="size-4 text-primary" />
                {t("actions.groupIntoProject")}
              </button>
            </RowActionMenu>
          );
        }
        if (row.rowType === "project") {
          return (
            <RowActionMenu
              open={openRowMenu === row.id}
              onOpenChange={(open) => setOpenRowMenu(open ? row.id : null)}
            >
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setOpenRowMenu(null);
                  openManualQuoteModal("quote", row.project.id);
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-fg-muted hover:bg-surface-hover hover:text-fg"
              >
                <Plus className="size-4 text-primary" />
                {t("actions.addQuote")}
              </button>
            </RowActionMenu>
          );
        }
        return null;
      },
    },
  ];

  return (
    <ListNavProvider value={listNav}>
    <ListPageLayout
      className="flex min-h-full flex-col gap-5"
      header={
        <PageHeader
          title={t("title")}
          description={t("subtitle")}
          actions={
          <Popover.Root open={newQuoteMenuOpen} onOpenChange={setNewQuoteMenuOpen}>
            <Popover.Trigger asChild>
              <Button variant="default" size="sm">
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
          }
        />
      }
    >

      <Dialog
        open={manualModalOpen}
        onClose={closeManualQuoteModal}
        size="md"
        title={manualIsSnap ? t("manual.snapTitle") : t("manual.quoteTitle")}
        description={manualIsSnap ? t("manual.snapDescription") : t("manual.quoteDescription")}
        closeLabel={t("manual.close")}
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={closeManualQuoteModal} disabled={manualSaving}>
              {t("manual.cancel")}
            </Button>
            <Button type="submit" form="create-quote-form" variant="default" size="sm" disabled={manualSaving}>
              {manualSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {manualIsSnap ? t("manual.createSnap") : t("manual.createQuote")}
            </Button>
          </>
        }
      >
        <form id="create-quote-form" onSubmit={handleManualQuoteSubmit} className="space-y-3">
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
                    <Button type="button" size="sm" variant="default" onClick={handleQuickAddCustomer} disabled={quickAddSaving || !quickAddName.trim()}>
                      {quickAddSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => { setQuickAddOpen(false); setQuickAddName(""); }} disabled={quickAddSaving}>
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
                          .map((c) => ({ id: c.id, label: c.name, secondary: c.shortName || undefined }))}
                        placeholder={t("manual.selectClient")}
                        searchPlaceholder={t("manual.searchClients")}
                        disabled={manualSaving}
                        triggerClassName="h-9 rounded-lg px-3 text-sm bg-bg/50"
                      />
                    </div>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setQuickAddOpen(true)} disabled={manualSaving} title={t("manual.addClient")}>
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
                        onClick={() => { setManualParentPickerOpen(false); setManualParentProjectId(null); }}
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
        </form>
      </Dialog>

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
              <Button type="submit" variant="default" size="sm" disabled={promoteSaving}>
                {promoteSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderPlus className="h-3.5 w-3.5" />}
                {t("promote.submit")}
              </Button>
            </div>
          </form>
        )}
      </ModalBackdrop>

      {/* View tabs: switch between flat quote list and projects list */}
      <FadeIn delay={0.05} className="shrink-0">
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

      <FadeIn delay={0.1} className="min-h-0 flex-1">
        {isInitialLoading ? (
          <Card className="min-h-0 overflow-auto">
            <div className="space-y-3 p-4" aria-label="Loading quotes">
              {Array.from({ length: Math.min(params.pageSize, 8) }).map((_, index) => (
                <div key={index} className="h-10 animate-pulse rounded-md bg-bg-subtle" />
              ))}
            </div>
          </Card>
        ) : error ? (
          <Card>
            <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-5 py-12 text-center text-fg-muted">
              <AlertCircle className="size-8 text-danger" />
              <div>
                <p className="font-medium text-fg">{t("loadErrorTitle")}</p>
                <p className="mt-1 text-xs">{error}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setReloadTick((value) => value + 1)}>
                {t("retry")}
              </Button>
            </div>
          </Card>
        ) : (
          <div className={cn(isRevalidating && "opacity-60 transition-opacity")}>
            <RecordList
                columns={columns}
                rows={recordRows}
                getRowId={(row) => row.id}
                filters={
                  <>
                    <SearchInput
                      placeholder={t("filters.searchPlaceholder")}
                      searchLabel={t("filters.searchPlaceholder")}
                      clearLabel={t("filters.clear")}
                    />
                    <FilterDropdown
                      label={t("filters.status")}
                      options={STATUS_OPTIONS.map((status) => ({
                        value: status.value,
                        label: t(`status.${status.labelKey}`),
                      }))}
                      selected={params.status}
                      onChange={(values) => update({ status: values }, { resetPage: true })}
                      clearLabel={t("filters.clear")}
                      renderOption={(option) => (
                        <Badge variant={statusTone(option.value)}>{option.label}</Badge>
                      )}
                    />
                    {clientOptions.length > 0 ? (
                      <FilterDropdown
                        label={t("filters.client")}
                        options={clientOptions}
                        selected={params.clientNames}
                        onChange={(values) => update({ clientNames: values }, { resetPage: true })}
                        clearLabel={t("filters.clear")}
                      />
                    ) : null}
                    <FilterDropdown
                      label={t("filters.estimator")}
                      options={userOptions}
                      selected={params.userIds}
                      onChange={(values) => update({ userIds: values }, { resetPage: true })}
                      clearLabel={t("filters.clear")}
                    />
                    {departmentOptions.length > 0 ? (
                      <FilterDropdown
                        label={t("filters.department")}
                        options={departmentOptions}
                        selected={params.departmentIds}
                        onChange={(values) => update({ departmentIds: values }, { resetPage: true })}
                        clearLabel={t("filters.clear")}
                      />
                    ) : null}
                    {(hasActiveFilters || params.search) ? (
                      <Button variant="ghost" size="sm" onClick={clearAllFilters}>
                        <X className="size-3" />
                        {t("filters.clearAll")}
                      </Button>
                    ) : null}
                  </>
                }
                toolbarActions={
                  <>
                    {isRevalidating ? <Loader2 className="size-4 animate-spin text-fg-muted" /> : null}
                    <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-fg-muted">
                      <span>{t("pagination.rowsPerPage")}</span>
                      <select
                        value={params.pageSize}
                        onChange={(event) => update(
                          { pageSize: Number.parseInt(event.target.value, 10) },
                          { resetPage: true },
                        )}
                        className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-fg"
                      >
                        {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
                      </select>
                    </label>
                  </>
                }
                sort={{ key: params.sortKey, dir: params.sortDir }}
                onSortChange={(key) => handleSort(key as QuotesSortKey)}
                pagination={{
                  page: params.page,
                  perPage: params.pageSize,
                  total,
                  onPageChange: (page) => update({ page }),
                }}
                onRowClick={(row) => {
                  if (row.rowType === "project") toggleExpand(row.project.id);
                  else router.push(`/projects/${row.project.id}`);
                }}
                empty={{
                  title: hasActiveFilters || params.search ? t("emptyFiltered") : t("empty"),
                  icon: <FileText className="size-8" />,
                }}
            />
          </div>
        )}
      </FadeIn>
    </ListPageLayout>
    </ListNavProvider>
  );
}
