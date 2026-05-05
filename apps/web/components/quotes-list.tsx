"use client";

import { useEffect, useState, useMemo } from "react";
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
  FileText,
  Loader2,
  PencilLine,
  Plus,
  Search,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney, formatPercent, formatDate } from "@/lib/format";
import {
  createCustomer,
  createProject,
  getCustomers,
  type Customer,
  type ProjectListItem,
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

function getEstimatorLabel(
  project: ProjectListItem,
  userMap: Map<string, OrgUser>,
  departmentMap: Map<string, OrgDepartment>,
  unassignedLabel = "Unassigned",
) {
  const quote = project.quote;
  if (!quote) return unassignedLabel;
  return (
    (quote.userId && userMap.get(quote.userId)?.name) ||
    quote.userName ||
    (quote.departmentId && departmentMap.get(quote.departmentId)?.name) ||
    unassignedLabel
  );
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
  const [manualError, setManualError] = useState("");
  const [manualSaving, setManualSaving] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddName, setQuickAddName] = useState("");
  const [quickAddSaving, setQuickAddSaving] = useState(false);
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

  // Only include projects that have a quote
  const projectsWithQuotes = useMemo(
    () => projects.filter((p): p is ProjectListItem & { quote: NonNullable<ProjectListItem["quote"]> } => p.quote != null),
    [projects],
  );

  // Derive unique filter options from data
  const clientOptions = useMemo(() => {
    const clients = new Map<string, string>();
    for (const p of projectsWithQuotes) {
      const clientLabel = getClientDisplayName(p, p.quote);
      if (clientLabel && clientLabel !== "—") clients.set(clientLabel, clientLabel);
    }
    return [...clients.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [projectsWithQuotes]);

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

  function openManualQuoteModal(mode: "quote" | "snap" = "quote") {
    setManualCreationMode(mode);
    setNewQuoteMenuOpen(false);
    setManualError("");
    setManualModalOpen(true);
  }

  function closeManualQuoteModal() {
    if (manualSaving) return;
    setManualModalOpen(false);
    setManualError("");
    setQuickAddOpen(false);
    setQuickAddName("");
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

  const filtered = useMemo(() => {
    let list = [...projectsWithQuotes];

    if (statusFilter.length > 0) {
      list = list.filter((p) => statusFilter.includes(p.quote.status));
    }

    if (clientFilter.length > 0) {
      list = list.filter((p) => clientFilter.includes(getClientDisplayName(p, p.quote)));
    }

    if (userFilter.length > 0) {
      list = list.filter((p) => p.quote.userId && userFilter.includes(p.quote.userId));
    }

    if (departmentFilter.length > 0) {
      list = list.filter((p) => p.quote.departmentId && departmentFilter.includes(p.quote.departmentId));
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.quote.quoteNumber.toLowerCase().includes(q) ||
          p.quote.title.toLowerCase().includes(q) ||
          getClientDisplayName(p, p.quote).toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          (p.location || "").toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "quoteNumber":
          cmp = a.quote.quoteNumber.localeCompare(b.quote.quoteNumber);
          break;
        case "kind":
          cmp = getQuoteKind(a).localeCompare(getQuoteKind(b));
          break;
        case "title":
          cmp = a.quote.title.localeCompare(b.quote.title);
          break;
        case "client":
          cmp = getClientDisplayName(a, a.quote).localeCompare(getClientDisplayName(b, b.quote));
          break;
        case "estimator": {
          const aName = getEstimatorLabel(a, userMap, departmentMap, unassignedLabel);
          const bName = getEstimatorLabel(b, userMap, departmentMap, unassignedLabel);
          cmp = aName.localeCompare(bName);
          break;
        }
        case "status":
          cmp = a.quote.status.localeCompare(b.quote.status);
          break;
        case "subtotal":
          cmp = (a.latestRevision?.subtotal ?? 0) - (b.latestRevision?.subtotal ?? 0);
          break;
        case "margin":
          cmp = (a.latestRevision?.estimatedMargin ?? 0) - (b.latestRevision?.estimatedMargin ?? 0);
          break;
        case "updated":
          cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [projectsWithQuotes, search, statusFilter, clientFilter, userFilter, departmentFilter, sortKey, sortDir, userMap, departmentMap, unassignedLabel]);

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
                  disabled={manualSaving}
                />
              </label>
            </div>
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
            {filtered.length === projectsWithQuotes.length
              ? t("filters.resultCount", { count: filtered.length })
              : t("filters.filteredResultCount", { filtered: filtered.length, total: projectsWithQuotes.length })}
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
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={headers.length} className="px-5 py-12 text-center text-sm text-fg/40">
                      <FileText className="mx-auto mb-2 h-8 w-8 text-fg/20" />
                      {hasActiveFilters || search ? t("emptyFiltered") : t("empty")}
                    </td>
                  </tr>
                )}
                {filtered.map((project, i) => {
                  const quoteKind = getQuoteKind(project);
                  return (
                    <motion.tr
                      key={project.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: i * 0.02, ease: "easeOut" }}
                      className="border-b border-line last:border-0 hover:bg-panel2/40 transition-colors"
                    >
                      <td className="px-4 py-2.5 text-xs font-medium text-accent whitespace-nowrap">
                        <Link href={`/projects/${project.id}`} className="hover:underline">
                          {project.quote.quoteNumber}
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
                          {project.quote.title || project.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-fg/60">
                        {getClientDisplayName(project, project.quote)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-fg/60">
                        {getEstimatorLabel(project, userMap, departmentMap, unassignedLabel)}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={statusTone(project.quote.status) as any}>
                          {t(`status.${statusLabelKey(project.quote.status)}`)}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs font-medium text-fg/80 tabular-nums">
                        {formatMoney(project.latestRevision?.subtotal ?? 0)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-fg/60 tabular-nums">
                        {formatPercent(project.latestRevision?.estimatedMargin ?? 0)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-fg/50">
                        {formatDate(project.updatedAt)}
                      </td>
                    </motion.tr>
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
