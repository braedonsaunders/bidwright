"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  adminCreateCatalogTemplate,
  adminDeleteCatalogTemplate,
  adminGetCatalogTemplate,
  adminListCatalogTemplates,
  adminUpdateCatalogTemplate,
  type CatalogItem,
  type CatalogSummary,
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
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  Edit3,
  Library,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

const PAGE_SIZE = 250;

const KIND_OPTIONS = [
  { value: "materials", label: "Materials" },
  { value: "labour", label: "Labour" },
  { value: "equipment", label: "Equipment" },
  { value: "subcontract", label: "Subcontract" },
  { value: "mixed", label: "Mixed" },
  { value: "custom", label: "Custom" },
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
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-fg">Catalog Library</h2>
          <p className="mt-1 text-xs text-fg/40">
            System catalog templates that organizations can adopt. {templateCountLabel}.
          </p>
        </div>
        <Button variant="accent" size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          New Template
        </Button>
      </div>

      {loading ? (
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
        </div>
      )}

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
