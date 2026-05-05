"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import {
  ArrowUpDown,
  Building2,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildClientPortfolioRows,
  getClientInitials,
  statusToClientStage,
  type ClientPortfolioRow,
} from "@/lib/client-analytics";
import {
  createCustomer,
  type Customer,
  type ProjectListItem,
} from "@/lib/api";
import { formatCompactMoney, formatDate, formatPercent } from "@/lib/format";
import { Badge, Button, Card, FadeIn, Input, Label, ModalBackdrop } from "@/components/ui";

type SortKey = "name" | "quotes" | "activeValue" | "wonValue" | "winRate" | "margin" | "updated";
type SortDir = "asc" | "desc";
type QuickFilter = "all" | "active" | "quoted" | "prospects" | "inactive";

const EMPTY_CREATE_FORM = {
  name: "",
  shortName: "",
  email: "",
  phone: "",
  addressCity: "",
  addressProvince: "",
  website: "",
};

function clientHref(row: ClientPortfolioRow) {
  return `/clients/${row.id}`;
}

function ClientAvatar({ name, active }: { name: string; active: boolean }) {
  return (
    <span
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-[11px] font-semibold",
        active
          ? "border-accent/25 bg-accent/10 text-accent"
          : "border-line bg-panel2 text-fg/35",
      )}
    >
      {getClientInitials(name)}
    </span>
  );
}

function MiniPipeline({ row }: { row: ClientPortfolioRow }) {
  const stages = row.projects.reduce(
    (acc, project) => {
      acc[statusToClientStage(project.quote.status)] += 1;
      return acc;
    },
    { active: 0, won: 0, lost: 0, other: 0 },
  );
  const total = Math.max(row.projects.length, 1);
  const segments = [
    { key: "active", value: stages.active, className: "bg-accent" },
    { key: "won", value: stages.won, className: "bg-success" },
    { key: "lost", value: stages.lost, className: "bg-danger" },
    { key: "other", value: stages.other, className: "bg-fg/20" },
  ];

  return (
    <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-panel2 lg:flex">
      {segments.map((segment) => (
        <span
          key={segment.key}
          className={segment.className}
          style={{ width: `${(segment.value / total) * 100}%` }}
        />
      ))}
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  sortDir,
  className,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  sortDir: SortDir;
  className?: string;
  onSort: (key: SortKey) => void;
}) {
  return (
    <th
      className={cn(
        "px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40 cursor-pointer select-none hover:text-fg/70 transition-colors",
        className,
      )}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown
          className={cn(
            "h-3 w-3",
            activeKey === sortKey ? "text-accent" : "text-fg/15",
            activeKey === sortKey && sortDir === "desc" && "rotate-180",
          )}
        />
      </span>
    </th>
  );
}

export function ClientsList({
  customers: initialCustomers,
  projects,
}: {
  customers: Customer[];
  projects: ProjectListItem[];
}) {
  const t = useTranslations("Clients");
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>(initialCustomers);
  const [search, setSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_CREATE_FORM);
  const [createError, setCreateError] = useState("");
  const [createSaving, setCreateSaving] = useState(false);

  const rows = useMemo(() => buildClientPortfolioRows(customers, projects), [customers, projects]);

  const filtered = useMemo(() => {
    let list = [...rows];
    if (quickFilter === "active") list = list.filter((row) => row.active && row.metrics.activeCount > 0);
    if (quickFilter === "quoted") list = list.filter((row) => row.metrics.quoteCount > 0);
    if (quickFilter === "prospects") list = list.filter((row) => row.metrics.quoteCount === 0);
    if (quickFilter === "inactive") list = list.filter((row) => !row.active);

    if (search.trim()) {
      const query = search.toLowerCase();
      list = list.filter((row) =>
        [
          row.name,
          row.shortName,
          row.email,
          row.phone,
          row.location,
          ...row.projects.map((project) => project.quote.title || project.name),
        ]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(query)),
      );
    }

    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "quotes":
          cmp = a.metrics.quoteCount - b.metrics.quoteCount;
          break;
        case "activeValue":
          cmp = a.metrics.activeValue - b.metrics.activeValue;
          break;
        case "wonValue":
          cmp = a.metrics.wonValue - b.metrics.wonValue;
          break;
        case "winRate":
          cmp = a.metrics.winRate - b.metrics.winRate;
          break;
        case "margin":
          cmp = a.metrics.avgMargin - b.metrics.avgMargin;
          break;
        case "updated":
          cmp = new Date(a.metrics.lastActivityAt ?? 0).getTime() - new Date(b.metrics.lastActivityAt ?? 0).getTime();
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [quickFilter, rows, search, sortDir, sortKey]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  async function handleCreateSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = createForm.name.trim();
    if (!name) {
      setCreateError(t("modal.nameRequired"));
      return;
    }

    setCreateSaving(true);
    setCreateError("");
    try {
      const created = await createCustomer({
        ...createForm,
        name,
        active: true,
      });
      setCustomers((prev) => [...prev, created]);
      setCreateForm(EMPTY_CREATE_FORM);
      setCreateOpen(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : t("modal.createError"));
    } finally {
      setCreateSaving(false);
    }
  }

  const filters: Array<{ key: QuickFilter; label: string; count: number }> = [
    { key: "all", label: t("filters.all"), count: rows.length },
    { key: "active", label: t("filters.active"), count: rows.filter((row) => row.active && row.metrics.activeCount > 0).length },
    { key: "quoted", label: t("filters.quoted"), count: rows.filter((row) => row.metrics.quoteCount > 0).length },
    { key: "prospects", label: t("filters.prospects"), count: rows.filter((row) => row.metrics.quoteCount === 0).length },
    { key: "inactive", label: t("filters.inactive"), count: rows.filter((row) => !row.active).length },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <FadeIn className="shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-accent" />
              <h1 className="text-lg font-semibold text-fg">{t("title")}</h1>
            </div>
            <p className="mt-0.5 text-xs text-fg/50">{t("subtitle")}</p>
          </div>
          <Button variant="accent" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            {t("newClient")}
          </Button>
        </div>
      </FadeIn>

      <FadeIn delay={0.05} className="shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[280px] flex-1 max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/25" />
            <Input
              className="h-8 pl-9 text-xs"
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg/30 transition-colors hover:text-fg/60"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1 rounded-lg border border-line bg-panel p-1">
            {filters.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => setQuickFilter(filter.key)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                  quickFilter === filter.key
                    ? "bg-accent text-accent-fg"
                    : "text-fg/55 hover:bg-panel2 hover:text-fg/80",
                )}
              >
                {filter.label}
                <span className={cn("tabular-nums", quickFilter === filter.key ? "text-accent-fg/75" : "text-fg/35")}>
                  {filter.count}
                </span>
              </button>
            ))}
          </div>
          <span className="ml-auto text-[11px] text-fg/30 tabular-nums">
            {filtered.length === rows.length
              ? t("resultCount", { count: filtered.length })
              : t("filteredResultCount", { filtered: filtered.length, total: rows.length })}
          </span>
        </div>
      </FadeIn>

      <FadeIn delay={0.1} className="min-h-0 flex-1">
        <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg">
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            <table className="w-full table-fixed text-sm">
              <thead className="sticky top-0 z-10 bg-panel">
                <tr className="border-b border-line">
                  <SortHeader label={t("table.client")} sortKey="name" activeKey={sortKey} sortDir={sortDir} onSort={handleSort} className="w-[55%] sm:w-[34%] lg:w-[24%]" />
                  <th className="hidden w-[20%] px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40 lg:table-cell">{t("table.contact")}</th>
                  <SortHeader label={t("table.quotes")} sortKey="quotes" activeKey={sortKey} sortDir={sortDir} onSort={handleSort} className="w-[17%] px-2 text-right sm:w-[9%] sm:px-4" />
                  <SortHeader label={t("table.active")} sortKey="activeValue" activeKey={sortKey} sortDir={sortDir} onSort={handleSort} className="w-[28%] px-2 text-right sm:w-[11%] sm:px-4" />
                  <SortHeader label={t("table.awarded")} sortKey="wonValue" activeKey={sortKey} sortDir={sortDir} onSort={handleSort} className="hidden w-[11%] text-right xl:table-cell" />
                  <SortHeader label={t("table.win")} sortKey="winRate" activeKey={sortKey} sortDir={sortDir} onSort={handleSort} className="hidden w-[7%] text-right 2xl:table-cell" />
                  <SortHeader label={t("table.margin")} sortKey="margin" activeKey={sortKey} sortDir={sortDir} onSort={handleSort} className="hidden w-[8%] text-right lg:table-cell" />
                  <SortHeader label={t("table.updated")} sortKey="updated" activeKey={sortKey} sortDir={sortDir} onSort={handleSort} className="hidden w-[10%] md:table-cell" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center text-sm text-fg/40">
                      <Building2 className="mx-auto mb-2 h-8 w-8 text-fg/20" />
                      {t("noMatches")}
                    </td>
                  </tr>
                )}
                {filtered.map((row, index) => (
                  <motion.tr
                    key={row.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, delay: index * 0.015, ease: "easeOut" }}
                    onClick={() => router.push(clientHref(row))}
                    className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-panel2/40"
                  >
                    <td className="min-w-0 px-4 py-2.5">
                      <Link href={clientHref(row)} className="group flex min-w-0 items-center gap-3">
                        <ClientAvatar name={row.name} active={row.active} />
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="block truncate text-xs font-semibold text-fg group-hover:text-accent">{row.name}</span>
                            {!row.active && <Badge className="hidden shrink-0 text-[9px] sm:inline-flex">{t("inactive")}</Badge>}
                          </span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-fg/40">
                            <MapPin className="h-3 w-3" />
                            <span className="truncate">{row.location || t("noLocation")}</span>
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="hidden px-4 py-2.5 text-xs text-fg/55 lg:table-cell">
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="flex items-center gap-1.5 truncate">
                          <Mail className="h-3 w-3 text-fg/25" />
                          <span className="truncate">{row.email || t("noEmail")}</span>
                        </span>
                        <span className="flex items-center gap-1.5 truncate">
                          <Phone className="h-3 w-3 text-fg/25" />
                          <span className="truncate">{row.phone || t("noPhone")}</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-right text-xs tabular-nums text-fg/70 sm:px-4">
                      <div className="inline-flex flex-col items-end gap-1">
                        <span>{row.metrics.quoteCount}</span>
                        <MiniPipeline row={row} />
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-right text-xs font-medium tabular-nums text-fg/80 sm:px-4">
                      {formatCompactMoney(row.metrics.activeValue)}
                    </td>
                    <td className="hidden px-4 py-2.5 text-right text-xs font-medium tabular-nums text-fg/80 xl:table-cell">
                      {formatCompactMoney(row.metrics.wonValue)}
                    </td>
                    <td className="hidden px-4 py-2.5 text-right text-xs tabular-nums text-fg/60 2xl:table-cell">
                      {row.metrics.wonCount + row.metrics.lostCount > 0 ? formatPercent(row.metrics.winRate) : "-"}
                    </td>
                    <td className="hidden px-4 py-2.5 text-right text-xs tabular-nums text-fg/60 lg:table-cell">
                      {row.metrics.quoteCount > 0 ? formatPercent(row.metrics.avgMargin) : "-"}
                    </td>
                    <td className="hidden px-4 py-2.5 text-xs text-fg/50 md:table-cell">
                      {formatDate(row.metrics.lastActivityAt)}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </FadeIn>

      <ModalBackdrop open={createOpen} onClose={() => !createSaving && setCreateOpen(false)} size="lg">
        <form onSubmit={handleCreateSubmit} className="rounded-lg border border-line bg-panel shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-fg">{t("modal.title")}</h2>
              <p className="mt-0.5 text-xs text-fg/50">{t("modal.description")}</p>
            </div>
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              disabled={createSaving}
              className="rounded-md p-1 text-fg/35 transition-colors hover:bg-panel2 hover:text-fg/70"
              aria-label={t("modal.close")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>{t("modal.name")}</Label>
              <Input
                autoFocus
                value={createForm.name}
                onChange={(event) => setCreateForm((form) => ({ ...form, name: event.target.value }))}
                placeholder={t("modal.namePlaceholder")}
                disabled={createSaving}
              />
            </div>
            <div>
              <Label>{t("modal.shortName")}</Label>
              <Input value={createForm.shortName} onChange={(event) => setCreateForm((form) => ({ ...form, shortName: event.target.value }))} disabled={createSaving} />
            </div>
            <div>
              <Label>{t("modal.website")}</Label>
              <Input value={createForm.website} onChange={(event) => setCreateForm((form) => ({ ...form, website: event.target.value }))} placeholder="https://" disabled={createSaving} />
            </div>
            <div>
              <Label>{t("modal.email")}</Label>
              <Input value={createForm.email} onChange={(event) => setCreateForm((form) => ({ ...form, email: event.target.value }))} disabled={createSaving} />
            </div>
            <div>
              <Label>{t("modal.phone")}</Label>
              <Input value={createForm.phone} onChange={(event) => setCreateForm((form) => ({ ...form, phone: event.target.value }))} disabled={createSaving} />
            </div>
            <div>
              <Label>{t("modal.city")}</Label>
              <Input value={createForm.addressCity} onChange={(event) => setCreateForm((form) => ({ ...form, addressCity: event.target.value }))} disabled={createSaving} />
            </div>
            <div>
              <Label>{t("modal.provinceState")}</Label>
              <Input value={createForm.addressProvince} onChange={(event) => setCreateForm((form) => ({ ...form, addressProvince: event.target.value }))} disabled={createSaving} />
            </div>
            {createError && (
              <div className="sm:col-span-2 rounded-lg border border-danger/25 bg-danger/8 px-3 py-2 text-xs text-danger">
                {createError}
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
            <Button type="button" variant="ghost" size="sm" onClick={() => setCreateOpen(false)} disabled={createSaving}>
              {t("modal.cancel")}
            </Button>
            <Button type="submit" variant="accent" size="sm" disabled={createSaving}>
              {createSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {t("modal.create")}
            </Button>
          </div>
        </form>
      </ModalBackdrop>
    </div>
  );
}
