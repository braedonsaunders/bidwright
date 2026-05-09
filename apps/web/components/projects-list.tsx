"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import {
  ArrowUpDown,
  Folder,
  FolderOpen,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
  Card,
  FadeIn,
  Input,
  ModalBackdrop,
} from "@/components/ui";
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

  const headers: Array<{ key: SortKey; label: string; className?: string }> = [
    { key: "name", label: t("table.name") },
    { key: "client", label: t("table.client"), className: "w-48" },
    { key: "quoteCount", label: t("table.quotes"), className: "w-20 text-right" },
    { key: "subtotal", label: t("table.subtotal"), className: "w-32 text-right" },
    { key: "updated", label: t("table.updated"), className: "w-28" },
  ];

  return (
    <div className="space-y-5">
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-fg">{t("title")}</h1>
            <p className="text-xs text-fg/50">{t("subtitle")}</p>
          </div>
          <Button variant="accent" size="sm" onClick={openCreateModal}>
            <Plus className="h-3.5 w-3.5" />
            {t("newProjectButton")}
          </Button>
        </div>
      </FadeIn>

      <ModalBackdrop open={createOpen} onClose={closeCreateModal} size="md">
        <form onSubmit={handleCreateSubmit} className="rounded-xl border border-line bg-panel shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-fg">{t("create.title")}</h2>
              <p className="mt-0.5 text-xs text-fg/50">{t("create.description")}</p>
            </div>
            <button
              type="button"
              onClick={closeCreateModal}
              className="rounded-md p-1 text-fg/35 transition-colors hover:bg-panel2 hover:text-fg/70"
              disabled={createSaving}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3 px-5 py-4">
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
                      variant="accent"
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
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
            <Button type="button" variant="ghost" size="sm" onClick={closeCreateModal} disabled={createSaving}>
              {t("create.cancel")}
            </Button>
            <Button type="submit" variant="accent" size="sm" disabled={createSaving}>
              {createSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
              {t("create.submit")}
            </Button>
          </div>
        </form>
      </ModalBackdrop>

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

      <FadeIn delay={0.1}>
        <div className="flex items-center gap-2 flex-wrap">
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
          <span className="ml-auto text-[11px] text-fg/30 tabular-nums shrink-0">
            {t("filters.resultCount", { count: filtered.length })}
          </span>
        </div>
      </FadeIn>

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
                        h.className,
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
                      <Folder className="mx-auto mb-2 h-8 w-8 text-fg/20" />
                      {search ? t("emptyFiltered") : t("empty")}
                    </td>
                  </tr>
                )}
                {filtered.map((project, i) => {
                  const quotes = project.quotes ?? [];
                  const subtotal = quotes.reduce((s, q) => s + (q.latestRevision?.subtotal ?? 0), 0);
                  return (
                    <motion.tr
                      key={project.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: i * 0.02, ease: "easeOut" }}
                      className="border-b border-line last:border-0 hover:bg-panel2/40 transition-colors"
                    >
                      <td className="px-4 py-2.5 text-xs">
                        <Link href={`/projects/${project.id}`} className="font-medium text-fg/85 hover:text-accent transition-colors inline-flex items-center gap-2">
                          <FolderOpen className="h-3.5 w-3.5 text-accent" />
                          {project.name}
                        </Link>
                        {project.location ? (
                          <span className="ml-2 text-fg/40">· {project.location}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-fg/60">
                        {project.clientName || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-fg/70 tabular-nums">
                        <Badge tone="default" className="text-[10px]">
                          {quotes.length}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs font-medium text-fg/80 tabular-nums">
                        {formatMoney(subtotal)}
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
