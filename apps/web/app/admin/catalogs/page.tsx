"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  adminCreateCatalogTemplate,
  adminDeleteCatalogTemplate,
  adminGetCatalogTemplate,
  adminListCatalogTemplates,
  adminUpdateCatalogTemplate,
  adminListOrganizations,
  adminCopyLibrary,
  type CatalogItem,
  type CatalogSummary,
  type AdminOrg,
} from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Drawer,
  EmptyState,
  Input,
  Label,
  PageHeader,
  RecordList,
  type RecordColumn,
  SearchSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  Textarea,
} from "@braedonsaunders/appkit-ui";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Library,
  Loader2,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

type AdminTab = "templates" | "import";

const ADMIN_TABS: { id: AdminTab; label: string }[] = [
  { id: "templates", label: "Templates" },
  { id: "import", label: "Cross-Org Import" },
];

const PAGE_SIZE = 250;

const KIND_OPTIONS = [
  { value: "materials", label: "Materials" },
  { value: "labour", label: "Labour" },
  { value: "equipment", label: "Equipment" },
  { value: "subcontract", label: "Subcontract" },
  { value: "mixed", label: "Mixed" },
  { value: "custom", label: "Custom" },
];

const IMPORT_SECTIONS = [
  { id: "catalogs", label: "Catalog Items", description: "Library catalog items with codes, costs, and pricing" },
  { id: "rates", label: "Rate Schedules", description: "Rate books with items and tier structures" },
  { id: "conditions", label: "Conditions", description: "Inclusion, exclusion, clarification templates" },
  { id: "assemblies", label: "Assemblies", description: "Saved multi-line build-ups and templates" },
  { id: "categories", label: "Entity Categories", description: "Classification categories for line items" },
];

type CatalogTemplateDetails = CatalogSummary & { items: CatalogItem[]; total: number };

function formatNumber(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function catalogKindLabel(kind: string) {
  return KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;
}

function ItemTable({ items }: { items: CatalogItem[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <Table>
        <TableHeader>
          <TableRow noAnimate>
            <TableHead className="w-28">Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="w-20">Unit</TableHead>
            <TableHead className="w-24 text-right">Cost</TableHead>
            <TableHead className="w-24 text-right">Price</TableHead>
            <TableHead className="w-36">Category</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const category = typeof item.metadata?.category === "string" ? item.metadata.category : "";
            return (
              <TableRow key={item.id}>
                <TableCell className="truncate font-mono text-[11px] text-fg-muted">{item.code || "—"}</TableCell>
                <TableCell className="truncate text-fg">{item.name}</TableCell>
                <TableCell className="truncate text-fg-muted">{item.unit || "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(item.unitCost)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(item.unitPrice)}</TableCell>
                <TableCell className="truncate text-fg-muted">{category || "—"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function PaginationControls({
  page,
  total,
  onPageChange,
}: {
  page: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const end = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <div className="mt-2 flex items-center justify-between text-xs text-fg/40">
      <span>
        Showing {start.toLocaleString()}-{end.toLocaleString()} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => onPageChange(0)}>
          <ChevronsLeft className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="h-3 w-3" />
        </Button>
        <span className="px-2 text-fg/60">
          Page {page + 1} of {totalPages}
        </span>
        <Button variant="ghost" size="sm" disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)}>
          <ChevronRight className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="sm" disabled={page >= totalPages - 1} onClick={() => onPageChange(totalPages - 1)}>
          <ChevronsRight className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

export default function AdminCatalogsPage() {
  const [adminTab, setAdminTab] = useState<AdminTab>("templates");
  const [templates, setTemplates] = useState<CatalogSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [templateSearch, setTemplateSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [itemCache, setItemCache] = useState<Record<string, CatalogTemplateDetails>>({});
  const [itemPage, setItemPage] = useState(0);
  const [filter, setFilter] = useState("");
  const [filterInput, setFilterInput] = useState("");
  const [itemsLoading, setItemsLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<CatalogSummary | null>(null);

  const fetchTemplates = useCallback(async () => {
    try {
      const data = await adminListCatalogTemplates();
      setTemplates(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const loadItems = useCallback(async (id: string, page: number, nextFilter?: string) => {
    setItemsLoading(true);
    try {
      const details = await adminGetCatalogTemplate(id, {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        filter: nextFilter || undefined,
      });
      setItemCache((prev) => ({ ...prev, [id]: details }));
      setItemPage(page);
    } finally {
      setItemsLoading(false);
    }
  }, []);

  const handleFilter = useCallback((id: string) => {
    setFilter(filterInput);
    loadItems(id, 0, filterInput);
  }, [filterInput, loadItems]);

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!confirm(`Delete catalog template "${name}"? This cannot be undone.`)) return false;
    await adminDeleteCatalogTemplate(id);
    setTemplates((prev) => prev.filter((template) => template.id !== id));
    setItemCache((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (expandedId === id) setExpandedId(null);
    return true;
  }, [expandedId]);

  const handleSaved = useCallback(async () => {
    await fetchTemplates();
    if (expandedId) {
      await loadItems(expandedId, itemPage, filter || undefined);
    }
    setShowCreate(false);
    setEditingTemplate(null);
  }, [expandedId, fetchTemplates, filter, itemPage, loadItems]);

  const columns = useMemo<RecordColumn<CatalogSummary>[]>(() => [
    {
      key: "name",
      label: "Template",
      width: "34%",
      render: (template) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-fg">{template.name}</div>
          <div className="truncate text-xs text-fg-muted">{template.description || "No description"}</div>
        </div>
      ),
    },
    {
      key: "kind",
      label: "Kind",
      render: (template) => <Badge variant="info">{catalogKindLabel(template.kind)}</Badge>,
    },
    {
      key: "itemCount",
      label: "Items",
      kind: "amount",
      format: (value) => Number(value ?? 0).toLocaleString(),
    },
    { key: "source", label: "Source" },
    {
      key: "updatedAt",
      label: "Updated",
      format: (value) => new Date(String(value)).toLocaleDateString(),
    },
    {
      key: "items",
      label: "",
      kind: "actions",
      render: (template) => (
        <Button
          variant="outline"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            setExpandedId(template.id);
            setItemPage(0);
            setFilter("");
            setFilterInput("");
            void loadItems(template.id, 0);
          }}
        >
          Browse items
        </Button>
      ),
    },
  ], [loadItems]);

  const browsedTemplate = templates.find((template) => template.id === expandedId) ?? null;
  const browsedDetails = expandedId ? itemCache[expandedId] : undefined;
  const visibleTemplates = useMemo(() => {
    const query = templateSearch.trim().toLowerCase();
    if (!query) return templates;
    return templates.filter((template) => [
      template.name,
      template.description,
      template.kind,
      template.source,
      template.sourceDescription,
    ].some((value) => value?.toLowerCase().includes(query)));
  }, [templateSearch, templates]);

  return (
    <>
      <div className="space-y-5">
        <PageHeader
          title="Shared library"
          description="System catalog templates and controlled cross-organization library transfers."
          actions={adminTab === "templates" ? (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="size-4" /> New template
            </Button>
          ) : undefined}
        />

        <Tabs
          value={adminTab}
          onValueChange={(value) => setAdminTab(value as AdminTab)}
          tabs={ADMIN_TABS.map((tab) => ({ value: tab.id, label: tab.label }))}
        />

        {adminTab === "templates" && (
          loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-fg-muted">
              <Loader2 className="mr-2 size-4 animate-spin" /> Loading templates…
            </div>
          ) : (
            <RecordList
              columns={columns}
              rows={visibleTemplates}
              getRowId={(template) => template.id}
              search={{
                value: templateSearch,
                onChange: setTemplateSearch,
                placeholder: "Search templates by name, kind, or source…",
              }}
              empty={{
                icon: <Library />,
                title: templateSearch ? "No templates match this search" : "No catalog templates yet",
                description: templateSearch
                  ? "Try a broader template name, kind, or source."
                  : "Create a template to make a shared catalog available to organization libraries.",
                action: templateSearch ? undefined : <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="size-4" /> New template</Button>,
              }}
              onRowClick={setEditingTemplate}
            />
          )
        )}

        {adminTab === "import" && <CrossOrgImportPanel />}
      </div>

      {showCreate && (
        <CatalogTemplateModal
          mode="create"
          onClose={() => setShowCreate(false)}
          onSaved={handleSaved}
        />
      )}
      {editingTemplate && (
        <CatalogTemplateModal
          mode="edit"
          template={editingTemplate}
          onClose={() => setEditingTemplate(null)}
          onSaved={handleSaved}
          onDelete={async () => {
            const deleted = await handleDelete(editingTemplate.id, editingTemplate.name);
            if (deleted) setEditingTemplate(null);
          }}
        />
      )}

      <Drawer
        open={Boolean(browsedTemplate)}
        onClose={() => setExpandedId(null)}
        size="xl"
        title={browsedTemplate?.name ?? "Catalog items"}
        description={browsedTemplate ? `${catalogKindLabel(browsedTemplate.kind)} · ${browsedDetails?.total ?? browsedTemplate.itemCount ?? 0} items` : undefined}
      >
        {browsedTemplate && (
          <div className="space-y-4">
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div><span className="block text-xs font-medium uppercase text-fg-subtle">Scope</span>{browsedTemplate.scope}</div>
              <div><span className="block text-xs font-medium uppercase text-fg-subtle">Source</span>{browsedTemplate.sourceDescription || browsedTemplate.source || "—"}</div>
              <div><span className="block text-xs font-medium uppercase text-fg-subtle">Updated</span>{new Date(browsedTemplate.updatedAt).toLocaleDateString()}</div>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative max-w-sm flex-1">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
                <Input
                  value={filterInput}
                  onChange={(event) => setFilterInput(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && handleFilter(browsedTemplate.id)}
                  placeholder="Search items…"
                  className="pl-8"
                />
              </div>
              <Button variant="outline" size="sm" onClick={() => handleFilter(browsedTemplate.id)}>Search</Button>
              {filter && (
                <Button variant="ghost" size="sm" onClick={() => {
                  setFilter("");
                  setFilterInput("");
                  void loadItems(browsedTemplate.id, 0);
                }}>Clear</Button>
              )}
            </div>

            {!browsedDetails || itemsLoading ? (
              <div className="flex items-center justify-center py-12 text-sm text-fg-muted">
                <Loader2 className="mr-2 size-4 animate-spin" /> Loading items…
              </div>
            ) : browsedDetails.items.length === 0 ? (
              <EmptyState
                title={filter ? "No items match this search" : "No items in this template"}
                description={filter ? "Try a broader item name or code." : "Import catalog items before using this template."}
              />
            ) : (
              <>
                <ItemTable items={browsedDetails.items} />
                <PaginationControls
                  page={itemPage}
                  total={browsedDetails.total}
                  onPageChange={(page) => loadItems(browsedTemplate.id, page, filter || undefined)}
                />
              </>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
}

function CrossOrgImportPanel() {
  const [orgs, setOrgs] = useState<AdminOrg[]>([]);
  const [sourceOrgId, setSourceOrgId] = useState("");
  const [targetOrgId, setTargetOrgId] = useState("");
  const [selectedSections, setSelectedSections] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [copying, setCopying] = useState(false);
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminListOrganizations()
      .then(setOrgs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggleSection = useCallback((id: string) => {
    setSelectedSections((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  }, []);

  const handleCopy = useCallback(async () => {
    if (!sourceOrgId || !targetOrgId || selectedSections.length === 0) return;
    setCopying(true);
    setError(null);
    setResult(null);
    try {
      const res = await adminCopyLibrary({
        sourceOrgId,
        targetOrgId,
        sections: selectedSections,
      });
      setResult(res.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copy failed");
    } finally {
      setCopying(false);
    }
  }, [sourceOrgId, targetOrgId, selectedSections]);

  const orgOptions = useMemo(
    () => orgs.map((o) => ({ value: o.id, label: `${o.name} (${o.slug})` })),
    [orgs],
  );

  const sourceOrg = orgs.find((o) => o.id === sourceOrgId);
  const targetOrg = orgs.find((o) => o.id === targetOrgId);

  if (loading) {
    return <div className="text-xs text-fg/40">Loading organizations...</div>;
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Copy Library Data Between Organizations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-fg/50">
            Select a source organization to copy library data from and a target organization to copy into.
            This will add new records without modifying or deleting existing data in the target.
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <Label>Source Organization (copy from)</Label>
              <SearchSelect
                value={sourceOrgId}
                onChange={setSourceOrgId}
                options={orgOptions}
                clearable
                placeholder="Select source organization…"
                searchable
              />
              {sourceOrg && (
                <p className="mt-1 text-[11px] text-fg/35">
                  {sourceOrg.userCount} users, {sourceOrg.projectCount} projects
                </p>
              )}
            </div>
            <div>
              <Label>Target Organization (copy into)</Label>
              <SearchSelect
                value={targetOrgId}
                onChange={setTargetOrgId}
                options={orgOptions}
                clearable
                placeholder="Select target organization…"
                searchable
              />
              {targetOrg && (
                <p className="mt-1 text-[11px] text-fg/35">
                  {targetOrg.userCount} users, {targetOrg.projectCount} projects
                </p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-line bg-panel2/30 p-4 space-y-2">
            <p className="text-xs font-medium text-fg/60">Select data to copy</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {IMPORT_SECTIONS.map((section) => {
                const selected = selectedSections.includes(section.id);
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => toggleSection(section.id)}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                      selected
                        ? "border-accent/40 bg-accent/8"
                        : "border-line bg-panel hover:bg-panel2/50",
                    )}
                  >
                    <div className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[10px]",
                      selected ? "border-accent bg-accent text-accent-fg" : "border-line bg-bg",
                    )}>
                      {selected && "✓"}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-fg">{section.label}</p>
                      <p className="mt-0.5 text-[11px] text-fg/40">{section.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          {result && (
            <div className="rounded-lg border border-success/30 bg-success/8 px-4 py-3 text-sm">
              <p className="font-medium text-success">Copy completed successfully</p>
              <div className="mt-2 grid gap-1 text-xs text-fg/60">
                {Object.entries(result).map(([section, count]) => {
                  const label = IMPORT_SECTIONS.find((s) => s.id === section)?.label ?? section;
                  return (
                    <div key={section} className="flex justify-between">
                      <span>{label}</span>
                      <span className="font-medium text-fg">{count} records copied</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <Button
              variant="default"
              size="sm"
              disabled={!sourceOrgId || !targetOrgId || selectedSections.length === 0 || copying || sourceOrgId === targetOrgId}
              onClick={handleCopy}
            >
              {copying ? (
                <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Copying...</>
              ) : (
                <><Copy className="mr-1.5 h-3.5 w-3.5" /> Copy {selectedSections.length} section{selectedSections.length === 1 ? "" : "s"}</>
              )}
            </Button>
          </div>

          {sourceOrgId && targetOrgId && sourceOrgId === targetOrgId && (
            <p className="text-xs text-danger">Source and target must be different organizations.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CatalogTemplateModal({
  mode,
  template,
  onClose,
  onSaved,
  onDelete,
}: {
  mode: "create" | "edit";
  template?: CatalogSummary;
  onClose: () => void;
  onSaved: () => void;
  onDelete?: () => Promise<void>;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [kind, setKind] = useState(template?.kind ?? "materials");
  const [description, setDescription] = useState(template?.description ?? "");
  const [source, setSource] = useState(template?.source ?? "manual");
  const [sourceDescription, setSourceDescription] = useState(template?.sourceDescription ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    setSaving(true);
    try {
      if (mode === "create") {
        await adminCreateCatalogTemplate({
          name: name.trim(),
          description: description.trim(),
          kind,
          source: source.trim() || "manual",
          sourceDescription: sourceDescription.trim(),
        });
      } else if (template) {
        await adminUpdateCatalogTemplate(template.id, {
          name: name.trim(),
          description: description.trim(),
          kind,
          sourceDescription: sourceDescription.trim(),
        });
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save catalog template");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      size="md"
      title={mode === "create" ? "New catalog template" : "Edit catalog template"}
      description={mode === "create" ? "Create a shared catalog definition." : "Update the template metadata used across organizations."}
      footer={(
        <div className="flex w-full items-center justify-between gap-2">
          <div>
            {mode === "edit" && onDelete && (
              <Button variant="destructive" size="sm" onClick={() => void onDelete()} disabled={saving}>
                <Trash2 className="size-3.5" /> Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={() => void handleSubmit()} disabled={saving || !name.trim()}>
              {saving ? "Saving…" : "Save template"}
            </Button>
          </div>
        </div>
      )}
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger-subtle px-4 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="catalog-template-name">Name</Label>
            <Input
              id="catalog-template-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="catalog-template-kind">Kind</Label>
            <SearchSelect
              id="catalog-template-kind"
              value={kind}
              onChange={setKind}
              options={KIND_OPTIONS}
              searchable={false}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="catalog-template-description">Description</Label>
          <Textarea
            id="catalog-template-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="catalog-template-source">Source</Label>
            <Input
              id="catalog-template-source"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              disabled={mode === "edit"}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="catalog-template-source-description">Source description</Label>
            <Input
              id="catalog-template-source-description"
              value={sourceDescription}
              onChange={(event) => setSourceDescription(event.target.value)}
            />
          </div>
        </div>
      </div>
    </Drawer>
  );
}
