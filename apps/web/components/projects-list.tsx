"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Folder,
  FolderOpen,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import {
  createCustomer,
  createProject,
  getCustomers,
  type Customer,
  type ProjectListItem,
} from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import {
  Badge,
  Button,
  Dialog,
  Input,
  ListPageLayout,
  PageHeader,
  RecordList,
  type RecordColumn,
} from "@appkit/ui";
import { FadeIn } from "@/components/legacy-controls";
import { SearchablePicker } from "@/components/shared/searchable-picker";

type SortKey = "name" | "client" | "quoteCount" | "subtotal" | "updated";
type SortDir = "asc" | "desc";

export function ProjectsList({ projects }: { projects: ProjectListItem[] }) {
  const t = useTranslations("Projects");
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createCustomerId, setCreateCustomerId] = useState("");
  const [createCustomerOptions, setCreateCustomerOptions] = useState<Customer[]>([]);
  const [createLocation, setCreateLocation] = useState("");
  const [createError, setCreateError] = useState("");
  const [createSaving, setCreateSaving] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddName, setQuickAddName] = useState("");
  const [quickAddSaving, setQuickAddSaving] = useState(false);

  // Real (container) projects only — shadow projects belong on the quotes list.
  const containerProjects = useMemo(
    () => projects.filter((p) => p.isStandalone === false),
    [projects],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = [...containerProjects];
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.clientName.toLowerCase().includes(q) ||
          (p.location || "").toLowerCase().includes(q),
      );
    }
    list.sort((a, b) => {
      let cmp = 0;
      const aQuotes = a.quotes ?? [];
      const bQuotes = b.quotes ?? [];
      const aSubtotal = aQuotes.reduce((s, q) => s + (q.latestRevision?.subtotal ?? 0), 0);
      const bSubtotal = bQuotes.reduce((s, q) => s + (q.latestRevision?.subtotal ?? 0), 0);
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name); break;
        case "client":
          cmp = a.clientName.localeCompare(b.clientName); break;
        case "quoteCount":
          cmp = aQuotes.length - bQuotes.length; break;
        case "subtotal":
          cmp = aSubtotal - bSubtotal; break;
        case "updated":
          cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [containerProjects, search, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function openCreateModal() {
    setCreateName("");
    setCreateCustomerId("");
    setCreateLocation("");
    setCreateError("");
    setQuickAddOpen(false);
    setQuickAddName("");
    setCreateOpen(true);
    if (createCustomerOptions.length === 0) {
      getCustomers().then(setCreateCustomerOptions).catch(() => {});
    }
  }

  function closeCreateModal() {
    if (createSaving) return;
    setCreateOpen(false);
  }

  async function handleQuickAddCustomer() {
    const name = quickAddName.trim();
    if (!name) return;
    setQuickAddSaving(true);
    try {
      const created = await createCustomer({ name, active: true });
      setCreateCustomerOptions((prev) =>
        prev.some((c) => c.id === created.id) ? prev : [...prev, created],
      );
      setCreateCustomerId(created.id);
      setQuickAddName("");
      setQuickAddOpen(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : t("create.failedClient"));
    } finally {
      setQuickAddSaving(false);
    }
  }

  async function handleCreateSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = createName.trim();
    if (!name) {
      setCreateError(t("create.nameRequired"));
      return;
    }
    setCreateSaving(true);
    setCreateError("");
    try {
      const selectedCustomer = createCustomerOptions.find((c) => c.id === createCustomerId) ?? null;
      const result = await createProject({
        name,
        clientName: selectedCustomer?.name || t("create.unassignedClient"),
        customerId: selectedCustomer?.id ?? null,
        location: createLocation.trim() || "TBD",
        creationMode: "container",
      });
      router.push(`/projects/${result.project.id}`);
    } catch (error) {
      setCreateSaving(false);
      setCreateError(error instanceof Error ? error.message : t("create.error"));
    }
  }

  const columns = useMemo<RecordColumn<ProjectListItem>[]>(() => [
    {
      key: "name",
      label: t("table.name"),
      sortable: true,
      render: (project) => (
        <Link
          href={`/projects/${project.id}`}
          className="inline-flex min-w-[16rem] items-center gap-2 font-medium text-fg hover:text-primary"
        >
          <FolderOpen className="size-4 text-primary" />
          <span>{project.name}</span>
          {project.location ? <span className="font-normal text-fg-muted">· {project.location}</span> : null}
        </Link>
      ),
    },
    {
      key: "client",
      label: t("table.client"),
      sortable: true,
      width: "12rem",
      render: (project) => <span className="text-fg-muted">{project.clientName || "—"}</span>,
    },
    {
      key: "quoteCount",
      label: t("table.quotes"),
      sortable: true,
      align: "right",
      width: "6rem",
      render: (project) => (
        <div className="text-right">
          <Badge variant="secondary">{project.quotes?.length ?? 0}</Badge>
        </div>
      ),
    },
    {
      key: "subtotal",
      label: t("table.subtotal"),
      sortable: true,
      kind: "amount",
      width: "9rem",
      render: (project) => (
        <div className="text-right font-medium tabular-nums">
          {formatMoney((project.quotes ?? []).reduce((sum, quote) => sum + (quote.latestRevision?.subtotal ?? 0), 0))}
        </div>
      ),
    },
    {
      key: "updated",
      label: t("table.updated"),
      sortable: true,
      width: "8rem",
      render: (project) => <span className="whitespace-nowrap text-fg-muted">{formatDate(project.updatedAt)}</span>,
    },
  ], [t]);

  return (
    <ListPageLayout
      className="space-y-5"
      header={
        <PageHeader
          title={t("title")}
          description={t("subtitle")}
          actions={
            <Button variant="default" size="sm" onClick={openCreateModal}>
              <Plus className="h-3.5 w-3.5" />
              {t("newProjectButton")}
            </Button>
          }
        />
      }
    >

      <Dialog
        open={createOpen}
        onClose={closeCreateModal}
        size="md"
        title={t("create.title")}
        description={t("create.description")}
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={closeCreateModal} disabled={createSaving}>
              {t("create.cancel")}
            </Button>
            <Button type="submit" form="create-project-form" variant="default" size="sm" disabled={createSaving}>
              {createSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
              {t("create.submit")}
            </Button>
          </>
        }
      >
        <form id="create-project-form" onSubmit={handleCreateSubmit} className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-fg/65">{t("create.nameLabel")}</span>
              <Input
                autoFocus
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder={t("create.namePlaceholder")}
                disabled={createSaving}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <span className="text-xs font-medium text-fg/65">{t("create.client")}</span>
                {quickAddOpen ? (
                  <div className="flex min-w-0 gap-1.5">
                    <Input
                      value={quickAddName}
                      onChange={(event) => setQuickAddName(event.target.value)}
                      placeholder={t("create.newClientName")}
                      autoFocus
                      disabled={quickAddSaving}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="default"
                      onClick={handleQuickAddCustomer}
                      disabled={quickAddSaving || !quickAddName.trim()}
                    >
                      {quickAddSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => { setQuickAddOpen(false); setQuickAddName(""); }}
                      disabled={quickAddSaving}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex min-w-0 gap-1.5">
                    <div className="min-w-0 flex-1">
                      <SearchablePicker
                        value={createCustomerId || null}
                        onSelect={setCreateCustomerId}
                        options={createCustomerOptions
                          .filter((c) => c.active)
                          .map((c) => ({
                            id: c.id,
                            label: c.name,
                            secondary: c.shortName || undefined,
                          }))}
                        placeholder={t("create.selectClient")}
                        searchPlaceholder={t("create.searchClients")}
                        disabled={createSaving}
                        triggerClassName="h-9 rounded-lg px-3 text-sm bg-bg/50"
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setQuickAddOpen(true)}
                      disabled={createSaving}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-fg/65">{t("create.location")}</span>
                <Input
                  value={createLocation}
                  onChange={(event) => setCreateLocation(event.target.value)}
                  placeholder={t("create.locationPlaceholder")}
                  disabled={createSaving}
                />
              </label>
            </div>
            {createError && (
              <div className="rounded-lg border border-danger/25 bg-danger/8 px-3 py-2 text-xs text-danger">
                {createError}
              </div>
            )}
        </form>
      </Dialog>

      {/* View tabs: mirror of the toggle on the quotes page */}
      <FadeIn delay={0.05}>
        <div className="flex items-center gap-1 border-b border-line">
          <Link
            href="/quotes"
            className="border-b-2 border-transparent px-3 py-2 text-xs font-medium text-fg/45 transition-colors hover:text-fg/80"
          >
            {t("tabs.quotes")}
          </Link>
          <span className="border-b-2 border-accent px-3 py-2 text-xs font-medium text-fg">
            {t("tabs.projects")}
          </span>
        </div>
      </FadeIn>

      <FadeIn delay={0.15}>
        <RecordList
          columns={columns}
          rows={filtered}
          getRowId={(project) => project.id}
          search={{ value: search, onChange: setSearch, placeholder: t("filters.searchPlaceholder") }}
          toolbarActions={
            <span className="whitespace-nowrap text-xs tabular-nums text-fg-muted">
              {t("filters.resultCount", { count: filtered.length })}
            </span>
          }
          sort={{ key: sortKey, dir: sortDir }}
          onSortChange={(key) => handleSort(key as SortKey)}
          onRowClick={(project) => router.push(`/projects/${project.id}`)}
          empty={{
            title: search ? t("emptyFiltered") : t("empty"),
            icon: <Folder className="size-8" />,
          }}
        />
      </FadeIn>
    </ListPageLayout>
  );
}
