"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Building2,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Plus,
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
import {
  Badge,
  Button,
  Drawer,
  Input,
  Label,
  ListPageLayout,
  PageHeader,
  RecordList,
  type RecordColumn,
} from "@braedonsaunders/appkit-ui";
import { FadeIn } from "@/components/legacy-controls";

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
  const columns = useMemo<RecordColumn<ClientPortfolioRow>[]>(() => [
    {
      key: "name",
      label: t("table.client"),
      sortable: true,
      width: "24%",
      render: (row) => (
        <Link href={clientHref(row)} className="group flex min-w-[14rem] items-center gap-3">
          <ClientAvatar name={row.name} active={row.active} />
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="block truncate font-semibold text-fg group-hover:text-primary">{row.name}</span>
              {!row.active && <Badge variant="secondary" className="shrink-0 text-[9px]">{t("inactive")}</Badge>}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-muted">
              <MapPin className="size-3" />
              <span className="truncate">{row.location || t("noLocation")}</span>
            </span>
          </span>
        </Link>
      ),
    },
    {
      key: "contact",
      label: t("table.contact"),
      width: "20%",
      render: (row) => (
        <div className="flex min-w-[12rem] flex-col gap-1 text-xs text-fg-muted">
          <span className="flex items-center gap-1.5 truncate">
            <Mail className="size-3 text-fg-subtle" />
            <span className="truncate">{row.email || t("noEmail")}</span>
          </span>
          <span className="flex items-center gap-1.5 truncate">
            <Phone className="size-3 text-fg-subtle" />
            <span className="truncate">{row.phone || t("noPhone")}</span>
          </span>
        </div>
      ),
    },
    {
      key: "quotes",
      label: t("table.quotes"),
      sortable: true,
      align: "right",
      render: (row) => (
        <div className="flex min-w-24 flex-col items-end gap-1 tabular-nums">
          <span>{row.metrics.quoteCount}</span>
          <MiniPipeline row={row} />
        </div>
      ),
    },
    {
      key: "activeValue",
      label: t("table.active"),
      sortable: true,
      kind: "amount",
      render: (row) => <div className="text-right font-medium tabular-nums">{formatCompactMoney(row.metrics.activeValue)}</div>,
    },
    {
      key: "wonValue",
      label: t("table.awarded"),
      sortable: true,
      kind: "amount",
      render: (row) => <div className="text-right font-medium tabular-nums">{formatCompactMoney(row.metrics.wonValue)}</div>,
    },
    {
      key: "winRate",
      label: t("table.win"),
      sortable: true,
      kind: "amount",
      render: (row) => (
        <div className="text-right tabular-nums">
          {row.metrics.wonCount + row.metrics.lostCount > 0 ? formatPercent(row.metrics.winRate) : "—"}
        </div>
      ),
    },
    {
      key: "margin",
      label: t("table.margin"),
      sortable: true,
      kind: "amount",
      render: (row) => (
        <div className="text-right tabular-nums">
          {row.metrics.quoteCount > 0 ? formatPercent(row.metrics.avgMargin) : "—"}
        </div>
      ),
    },
    {
      key: "updated",
      label: t("table.updated"),
      sortable: true,
      render: (row) => <span className="whitespace-nowrap text-fg-muted">{formatDate(row.metrics.lastActivityAt)}</span>,
    },
  ], [t]);

  return (
    <ListPageLayout
      className="flex min-h-full flex-col gap-4"
      header={
        <PageHeader
          title={t("title")}
          description={t("subtitle")}
          actions={
            <Button variant="default" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              {t("newClient")}
            </Button>
          }
        />
      }
    >

      <FadeIn delay={0.1} className="min-h-0 flex-1">
        <RecordList
          columns={columns}
          rows={filtered}
          getRowId={(row) => row.id}
          search={{ value: search, onChange: setSearch, placeholder: t("searchPlaceholder") }}
          filters={
            <div className="flex flex-wrap gap-1">
              {filters.map((filter) => (
                <Button
                  key={filter.key}
                  type="button"
                  size="sm"
                  variant={quickFilter === filter.key ? "secondary" : "ghost"}
                  onClick={() => setQuickFilter(filter.key)}
                >
                  {filter.label}
                  <span className="tabular-nums text-fg-muted">{filter.count}</span>
                </Button>
              ))}
            </div>
          }
          toolbarActions={
            <span className="whitespace-nowrap text-xs tabular-nums text-fg-muted">
              {filtered.length === rows.length
                ? t("resultCount", { count: filtered.length })
                : t("filteredResultCount", { filtered: filtered.length, total: rows.length })}
            </span>
          }
          sort={{ key: sortKey, dir: sortDir }}
          onSortChange={(key) => handleSort(key as SortKey)}
          onRowClick={(row) => router.push(clientHref(row))}
          empty={{ title: t("noMatches"), icon: <Building2 className="size-8" /> }}
        />
      </FadeIn>

      {/* Flyout rather than a centred modal: creating a client is a side task
          done against the list, so the list stays visible behind it. */}
      <Drawer
        open={createOpen}
        onClose={() => !createSaving && setCreateOpen(false)}
        size="lg"
        side="right"
        title={t("modal.title")}
        description={t("modal.description")}
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setCreateOpen(false)} disabled={createSaving}>
              {t("modal.cancel")}
            </Button>
            <Button type="submit" form="create-client-form" variant="default" size="sm" disabled={createSaving}>
              {createSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {t("modal.create")}
            </Button>
          </>
        }
      >
        <form id="create-client-form" onSubmit={handleCreateSubmit} className="grid gap-3 sm:grid-cols-2">
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
        </form>
      </Drawer>
    </ListPageLayout>
  );
}
