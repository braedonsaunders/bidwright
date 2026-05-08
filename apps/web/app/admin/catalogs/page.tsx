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
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  Label,
  ModalBackdrop,
  Select,
  Textarea,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Edit3,
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
      <table className="w-full table-fixed text-xs">
        <thead className="border-b border-line bg-panel2/50 text-fg/40">
          <tr>
            <th className="w-28 px-3 py-2 text-left font-medium">Code</th>
            <th className="px-3 py-2 text-left font-medium">Name</th>
            <th className="w-20 px-3 py-2 text-left font-medium">Unit</th>
            <th className="w-24 px-3 py-2 text-right font-medium">Cost</th>
            <th className="w-24 px-3 py-2 text-right font-medium">Price</th>
            <th className="w-36 px-3 py-2 text-left font-medium">Category</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const category = typeof item.metadata?.category === "string" ? item.metadata.category : "";
            return (
              <tr key={item.id} className="border-b border-line/50 last:border-b-0 hover:bg-panel2/30">
                <td className="truncate px-3 py-2 font-mono text-[11px] text-fg/50">{item.code || "-"}</td>
                <td className="truncate px-3 py-2 text-fg/80">{item.name}</td>
                <td className="truncate px-3 py-2 text-fg/55">{item.unit || "-"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-fg/70">{formatNumber(item.unitCost)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-fg/70">{formatNumber(item.unitPrice)}</td>
                <td className="truncate px-3 py-2 text-fg/50">{category || "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
        <Button variant="ghost" size="xs" disabled={page === 0} onClick={() => onPageChange(0)}>
          <ChevronsLeft className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="xs" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="h-3 w-3" />
        </Button>
        <span className="px-2 text-fg/60">
          Page {page + 1} of {totalPages}
        </span>
        <Button variant="ghost" size="xs" disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)}>
          <ChevronRight className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="xs" disabled={page >= totalPages - 1} onClick={() => onPageChange(totalPages - 1)}>
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [itemCache, setItemCache] = useState<Record<string, CatalogTemplateDetails>>({});
  const [itemPage, setItemPage] = useState(0);
  const [filter, setFilter] = useState("");
  const [filterInput, setFilterInput] = useState("");
  const [itemsLoading, setItemsLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<CatalogSummary | null>(null);

  const templateCountLabel = useMemo(
    () => `${templates.length} template${templates.length === 1 ? "" : "s"} available`,
    [templates.length],
  );

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

  const toggleExpand = useCallback(async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    setItemPage(0);
    setFilter("");
    setFilterInput("");
    await loadItems(id, 0);
  }, [expandedId, loadItems]);

  const handleFilter = useCallback((id: string) => {
    setFilter(filterInput);
    loadItems(id, 0, filterInput);
  }, [filterInput, loadItems]);

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!confirm(`Delete catalog template "${name}"? This cannot be undone.`)) return;
    await adminDeleteCatalogTemplate(id);
    setTemplates((prev) => prev.filter((template) => template.id !== id));
    setItemCache((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (expandedId === id) setExpandedId(null);
  }, [expandedId]);

  const handleSaved = useCallback(async () => {
    await fetchTemplates();
    if (expandedId) {
      await loadItems(expandedId, itemPage, filter || undefined);
    }
    setShowCreate(false);
    setEditingTemplate(null);
  }, [expandedId, fetchTemplates, filter, itemPage, loadItems]);

  return (
    <div className="flex h-full flex-col overflow-hidden p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-fg">Library</h2>
          <p className="mt-1 text-xs text-fg/40">
            System catalog templates and cross-organization library management.
          </p>
        </div>
        {adminTab === "templates" && (
          <Button variant="accent" size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New Template
          </Button>
        )}
      </div>

      <div className="mb-4 flex items-center gap-1 shrink-0">
        {ADMIN_TABS.map((t) => {
          const active = adminTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setAdminTab(t.id)}
              className={cn(
                "px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap",
                active ? "bg-panel2 text-fg" : "text-fg/40 hover:text-fg/60",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {adminTab === "templates" && (
          loading ? (
            <div className="text-xs text-fg/40">Loading...</div>
          ) : templates.length === 0 ? (
            <Card>
              <CardBody>
                <div className="py-8 text-center text-sm text-fg/40">
                  No catalog templates yet. Create one to make it available for organization libraries.
                </div>
              </CardBody>
            </Card>
          ) : (
            <div className="space-y-2">
              {templates.map((template) => {
                const isExpanded = expandedId === template.id;
                const details = itemCache[template.id];
                const itemCount = template.itemCount ?? details?.total ?? 0;

                return (
                  <Card key={template.id}>
                    <CardBody>
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-panel2">
                            <Library className="h-4 w-4 text-fg/40" />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-fg">{template.name}</div>
                            <div className="truncate text-xs text-fg/40">
                              {template.description || "No description"}
                            </div>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-3 text-xs text-fg/40">
                          <Badge tone="info" className="text-[10px]">
                            {catalogKindLabel(template.kind)}
                          </Badge>
                          <span>{itemCount.toLocaleString()} items</span>
                          <span>{template.source}</span>
                          <div className="flex items-center gap-1.5">
                            <Button variant="ghost" size="xs" onClick={() => toggleExpand(template.id)}>
                              {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                              Items
                            </Button>
                            <Button variant="ghost" size="xs" onClick={() => setEditingTemplate(template)}>
                              <Edit3 className="h-3 w-3" />
                            </Button>
                            <Button variant="danger" size="xs" onClick={() => handleDelete(template.id, template.name)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="mt-3 border-t border-line pt-3">
                          <div className="mb-3 grid gap-2 text-xs text-fg/45 md:grid-cols-3">
                            <div>
                              <span className="block text-[10px] font-medium text-fg/30">SCOPE</span>
                              {template.scope}
                            </div>
                            <div>
                              <span className="block text-[10px] font-medium text-fg/30">SOURCE</span>
                              {template.sourceDescription || template.source || "-"}
                            </div>
                            <div>
                              <span className="block text-[10px] font-medium text-fg/30">UPDATED</span>
                              {new Date(template.updatedAt).toLocaleDateString()}
                            </div>
                          </div>

                          <div className="mb-3 flex items-center gap-2">
                            <div className="relative max-w-sm flex-1">
                              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/30" />
                              <Input
                                value={filterInput}
                                onChange={(event) => setFilterInput(event.target.value)}
                                onKeyDown={(event) => event.key === "Enter" && handleFilter(template.id)}
                                placeholder="Search items..."
                                className="h-8 pl-8 text-xs"
                              />
                            </div>
                            <Button variant="ghost" size="xs" onClick={() => handleFilter(template.id)}>
                              Search
                            </Button>
                            {filter && (
                              <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => {
                                  setFilter("");
                                  setFilterInput("");
                                  loadItems(template.id, 0);
                                }}
                              >
                                Clear
                              </Button>
                            )}
                          </div>

                          {!details || itemsLoading ? (
                            <div className="text-xs text-fg/40">Loading items...</div>
                          ) : details.items.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-line py-8 text-center text-sm text-fg/40">
                              No items{filter ? " matching this search" : " have been imported for this template yet"}.
                            </div>
                          ) : (
                            <>
                              <ItemTable items={details.items} />
                              <PaginationControls
                                page={itemPage}
                                total={details.total}
                                onPageChange={(page) => loadItems(template.id, page, filter || undefined)}
                              />
                            </>
                          )}
                        </div>
                      )}
                    </CardBody>
                  </Card>
                );
              })}
              <p className="text-xs text-fg/30">{templateCountLabel}.</p>
            </div>
          )
        )}

        {adminTab === "import" && (
          <CrossOrgImportPanel />
        )}
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
        />
      )}
    </div>
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
        <CardBody className="space-y-4">
          <p className="text-xs text-fg/50">
            Select a source organization to copy library data from and a target organization to copy into.
            This will add new records without modifying or deleting existing data in the target.
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <Label>Source Organization (copy from)</Label>
              <Select
                value={sourceOrgId}
                onValueChange={setSourceOrgId}
                options={[{ value: "", label: "Select source organization..." }, ...orgOptions]}
              />
              {sourceOrg && (
                <p className="mt-1 text-[11px] text-fg/35">
                  {sourceOrg.userCount} users, {sourceOrg.projectCount} projects
                </p>
              )}
            </div>
            <div>
              <Label>Target Organization (copy into)</Label>
              <Select
                value={targetOrgId}
                onValueChange={setTargetOrgId}
                options={[{ value: "", label: "Select target organization..." }, ...orgOptions]}
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
              variant="accent"
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
        </CardBody>
      </Card>
    </div>
  );
}

function CatalogTemplateModal({
  mode,
  template,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  template?: CatalogSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [kind, setKind] = useState(template?.kind ?? "materials");
  const [description, setDescription] = useState(template?.description ?? "");
  const [source, setSource] = useState(template?.source ?? "manual");
  const [sourceDescription, setSourceDescription] = useState(template?.sourceDescription ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
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
    <ModalBackdrop open={true} onClose={onClose} size="lg">
      <Card>
        <CardHeader>
          <CardTitle>{mode === "create" ? "New Catalog Template" : "Edit Catalog Template"}</CardTitle>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
                {error}
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label htmlFor="catalog-template-name">Name</Label>
                <Input
                  id="catalog-template-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div>
                <Label htmlFor="catalog-template-kind">Kind</Label>
                <Select
                  id="catalog-template-kind"
                  value={kind}
                  onValueChange={setKind}
                  options={KIND_OPTIONS}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="catalog-template-description">Description</Label>
              <Textarea
                id="catalog-template-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label htmlFor="catalog-template-source">Source</Label>
                <Input
                  id="catalog-template-source"
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  disabled={mode === "edit"}
                />
              </div>
              <div>
                <Label htmlFor="catalog-template-source-description">Source Description</Label>
                <Input
                  id="catalog-template-source-description"
                  value={sourceDescription}
                  onChange={(event) => setSourceDescription(event.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
              <Button variant="accent" type="submit" disabled={saving || !name.trim()}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </ModalBackdrop>
  );
}
