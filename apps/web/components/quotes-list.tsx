"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import * as Popover from "@radix-ui/react-popover";
import {
  ArrowUpDown,
  ChevronDown,
  FileText,
  Plus,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney, formatPercent, formatDate } from "@/lib/format";
import type { ProjectListItem, OrgUser, OrgDepartment } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  FadeIn,
  Input,
} from "@/components/ui";

type SortKey =
  | "quoteNumber"
  | "title"
  | "client"
  | "status"
  | "subtotal"
  | "margin"
  | "updated";

type SortDir = "asc" | "desc";

const STATUS_OPTIONS = [
  { value: "Open", label: "Open", tone: "info" },
  { value: "Pending", label: "Pending", tone: "warning" },
  { value: "Awarded", label: "Awarded", tone: "success" },
  { value: "DidNotGet", label: "Did Not Get", tone: "danger" },
  { value: "Declined", label: "Declined", tone: "danger" },
  { value: "Cancelled", label: "Cancelled", tone: "default" },
  { value: "Closed", label: "Closed", tone: "default" },
  { value: "Other", label: "Other", tone: "default" },
] as const;

function statusTone(status: string) {
  return STATUS_OPTIONS.find((s) => s.value === status)?.tone ?? ("default" as const);
}

/* ─── Filter Dropdown ─── */

function FilterDropdown({
  label,
  options,
  selected,
  onChange,
  renderOption,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onChange: (values: string[]) => void;
  renderOption?: (opt: { value: string; label: string }, isSelected: boolean) => React.ReactNode;
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
                <X className="h-3 w-3" /> Clear
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
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [clientFilter, setClientFilter] = useState<string[]>([]);
  const [userFilter, setUserFilter] = useState<string[]>([]);
  const [departmentFilter, setDepartmentFilter] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Only include projects that have a quote
  const projectsWithQuotes = useMemo(
    () => projects.filter((p): p is ProjectListItem & { quote: NonNullable<ProjectListItem["quote"]> } => p.quote != null),
    [projects],
  );

  // Derive unique filter options from data
  const clientOptions = useMemo(() => {
    const clients = new Map<string, string>();
    for (const p of projectsWithQuotes) {
      if (p.clientName) clients.set(p.clientName, p.clientName);
    }
    return [...clients.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [projectsWithQuotes]);

  const userOptions = useMemo(() => {
    return users.map((u) => ({ value: u.id, label: u.name || u.email }));
  }, [users]);

  const departmentOptions = useMemo(() => {
    return departments.map((d) => ({ value: d.id, label: d.name }));
  }, [departments]);

  const hasActiveFilters = statusFilter.length > 0 || clientFilter.length > 0 || userFilter.length > 0 || departmentFilter.length > 0;

  function clearAllFilters() {
    setStatusFilter([]);
    setClientFilter([]);
    setUserFilter([]);
    setDepartmentFilter([]);
    setSearch("");
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
      list = list.filter((p) => clientFilter.includes(p.clientName));
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
          p.clientName.toLowerCase().includes(q) ||
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
        case "title":
          cmp = a.quote.title.localeCompare(b.quote.title);
          break;
        case "client":
          cmp = a.clientName.localeCompare(b.clientName);
          break;
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
  }, [projectsWithQuotes, search, statusFilter, clientFilter, userFilter, departmentFilter, sortKey, sortDir]);

  const totalValue = projectsWithQuotes.reduce((sum, p) => sum + (p.latestRevision?.subtotal ?? 0), 0);
  const avgMargin = projectsWithQuotes.length > 0
    ? projectsWithQuotes.reduce((sum, p) => sum + (p.latestRevision?.estimatedMargin ?? 0), 0) / projectsWithQuotes.length
    : 0;

  const headers: { key: SortKey; label: string; className?: string }[] = [
    { key: "quoteNumber", label: "Quote #", className: "w-28" },
    { key: "title", label: "Title" },
    { key: "client", label: "Client", className: "w-40" },
    { key: "status", label: "Status", className: "w-24" },
    { key: "subtotal", label: "Subtotal", className: "w-28 text-right" },
    { key: "margin", label: "Margin", className: "w-20 text-right" },
    { key: "updated", label: "Updated", className: "w-28" },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-fg">Quotes</h1>
            <p className="text-xs text-fg/50">Manage and track all your quotes</p>
          </div>
          <Link href="/intake">
            <Button variant="accent" size="sm">
              <Plus className="h-3.5 w-3.5" /> New Quote
            </Button>
          </Link>
        </div>
      </FadeIn>

      {/* Summary stats */}
      <FadeIn delay={0.05}>
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <div className="px-5 py-4">
              <p className="text-xs text-fg/50">Total Quotes</p>
              <p className="mt-1 text-xl font-semibold text-fg">{projectsWithQuotes.length}</p>
            </div>
          </Card>
          <Card>
            <div className="px-5 py-4">
              <p className="text-xs text-fg/50">Total Value</p>
              <p className="mt-1 text-xl font-semibold text-fg">{formatMoney(totalValue)}</p>
            </div>
          </Card>
          <Card>
            <div className="px-5 py-4">
              <p className="text-xs text-fg/50">Avg Margin</p>
              <p className="mt-1 text-xl font-semibold text-fg">{formatPercent(avgMargin)}</p>
            </div>
          </Card>
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
              placeholder="Search by quote #, title, client, project, location..."
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
            label="Status"
            options={STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
            selected={statusFilter}
            onChange={setStatusFilter}
            renderOption={(opt) => (
              <span className="flex items-center gap-2">
                <Badge tone={statusTone(opt.value) as any} className="text-[9px]">{opt.label}</Badge>
              </span>
            )}
          />

          {/* Client filter */}
          {clientOptions.length > 0 && (
            <FilterDropdown
              label="Client"
              options={clientOptions}
              selected={clientFilter}
              onChange={setClientFilter}
            />
          )}

          {/* Estimator filter */}
          <FilterDropdown
            label="Estimator"
            options={userOptions}
            selected={userFilter}
            onChange={setUserFilter}
          />

          {/* Department filter */}
          {departmentOptions.length > 0 && (
            <FilterDropdown
              label="Department"
              options={departmentOptions}
              selected={departmentFilter}
              onChange={setDepartmentFilter}
            />
          )}

          {/* Clear all */}
          {(hasActiveFilters || search) && (
            <button
              onClick={clearAllFilters}
              className="inline-flex items-center gap-1 rounded-lg px-2 h-8 text-xs text-fg/40 hover:text-fg/70 transition-colors"
            >
              <X className="h-3 w-3" /> Clear all
            </button>
          )}

          {/* Result count */}
          <span className="ml-auto text-[11px] text-fg/30 tabular-nums shrink-0">
            {filtered.length === projectsWithQuotes.length
              ? `${filtered.length} quotes`
              : `${filtered.length} of ${projectsWithQuotes.length} quotes`}
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
                      {hasActiveFilters || search ? "No quotes match your filters" : "No quotes found"}
                    </td>
                  </tr>
                )}
                {filtered.map((project, i) => (
                  <motion.tr
                    key={project.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: i * 0.02, ease: "easeOut" }}
                    className="border-b border-line last:border-0 hover:bg-panel2/40 transition-colors"
                  >
                    <td className="px-4 py-2.5 text-xs font-medium text-accent">
                      <Link href={`/projects/${project.id}`} className="hover:underline">
                        {project.quote.quoteNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-fg/80">
                      <Link href={`/projects/${project.id}`} className="hover:underline">
                        {project.quote.title || project.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-fg/60">
                      {project.clientName || "\u2014"}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={statusTone(project.quote.status) as any}>
                        {project.quote.status === "DidNotGet" ? "Did Not Get" : project.quote.status}
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
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </FadeIn>
    </div>
  );
}
