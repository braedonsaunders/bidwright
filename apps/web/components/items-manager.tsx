"use client";

import { useState, useMemo, useCallback } from "react";
import { motion } from "motion/react";
import {
  Package,
  Plus,
  Search,
  Trash2,
  Upload,
  Check,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import type { CatalogSummary, CatalogItem } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  FadeIn,
  Input,
} from "@/components/ui";

interface LocalCatalogItem {
  id: string;
  catalogId: string;
  code: string;
  name: string;
  unit: string;
  unitCost: number;
  unitPrice: number;
  category: string;
  isNew?: boolean;
}

function generateId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ItemsManager({
  catalogs: initialCatalogs,
}: {
  catalogs: CatalogSummary[];
}) {
  const [catalogs, setCatalogs] = useState(initialCatalogs);
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | null>(
    initialCatalogs[0]?.id ?? null
  );
  const [search, setSearch] = useState("");
  const [editingCell, setEditingCell] = useState<{
    itemId: string;
    field: string;
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [newCatalogName, setNewCatalogName] = useState("");
  const [showNewCatalog, setShowNewCatalog] = useState(false);

  const selectedCatalog = catalogs.find((c) => c.id === selectedCatalogId);

  const items: LocalCatalogItem[] = useMemo(() => {
    if (!selectedCatalog?.items) return [];
    return selectedCatalog.items.map((item) => ({
      ...item,
      category: (item.metadata?.category as string) ?? "",
    }));
  }, [selectedCatalog]);

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (item) =>
        item.code.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
    );
  }, [items, search]);

  const startEdit = (itemId: string, field: string, currentValue: string | number) => {
    setEditingCell({ itemId, field });
    setEditValue(String(currentValue));
  };

  const commitEdit = () => {
    if (!editingCell || !selectedCatalogId) return;
    const { itemId, field } = editingCell;

    setCatalogs((prev) =>
      prev.map((cat) => {
        if (cat.id !== selectedCatalogId || !cat.items) return cat;
        return {
          ...cat,
          items: cat.items.map((item) => {
            if (item.id !== itemId) return item;
            const numericFields = ["unitCost", "unitPrice"];
            const value = numericFields.includes(field)
              ? parseFloat(editValue) || 0
              : editValue;
            if (field === "category") {
              return {
                ...item,
                metadata: { ...item.metadata, category: value as string },
              };
            }
            return { ...item, [field]: value };
          }),
        };
      })
    );
    setEditingCell(null);
  };

  const cancelEdit = () => {
    setEditingCell(null);
  };

  const addItem = () => {
    if (!selectedCatalogId) return;
    const newItem: CatalogItem = {
      id: generateId(),
      catalogId: selectedCatalogId,
      code: "",
      name: "New Item",
      unit: "EA",
      unitCost: 0,
      unitPrice: 0,
      metadata: { category: "" },
    };

    setCatalogs((prev) =>
      prev.map((cat) => {
        if (cat.id !== selectedCatalogId) return cat;
        return { ...cat, items: [...(cat.items ?? []), newItem] };
      })
    );
  };

  const deleteItem = (itemId: string) => {
    if (!selectedCatalogId) return;
    setCatalogs((prev) =>
      prev.map((cat) => {
        if (cat.id !== selectedCatalogId || !cat.items) return cat;
        return {
          ...cat,
          items: cat.items.filter((item) => item.id !== itemId),
        };
      })
    );
  };

  const addCatalog = () => {
    if (!newCatalogName.trim()) return;
    const newCatalog: CatalogSummary = {
      id: generateId(),
      name: newCatalogName.trim(),
      kind: "material",
      scope: "global",
      projectId: null,
      description: "",
      items: [],
    };
    setCatalogs((prev) => [...prev, newCatalog]);
    setSelectedCatalogId(newCatalog.id);
    setNewCatalogName("");
    setShowNewCatalog(false);
  };

  const columns = [
    { key: "code", label: "Code", className: "w-28" },
    { key: "name", label: "Name" },
    { key: "unit", label: "Unit", className: "w-20" },
    { key: "unitCost", label: "Unit Cost", className: "w-28 text-right" },
    { key: "unitPrice", label: "Unit Price", className: "w-28 text-right" },
    { key: "category", label: "Category", className: "w-36" },
  ];

  return (
    <div className="space-y-5">
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-fg">Items &amp; Catalogs</h1>
            <p className="text-xs text-fg/50">
              Manage your material and labor catalogs
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled>
              <Upload className="h-3.5 w-3.5" />
              Import
            </Button>
          </div>
        </div>
      </FadeIn>

      <div className="flex gap-5">
        {/* Catalog sidebar */}
        <FadeIn delay={0.05} className="w-56 shrink-0">
          <Card className="overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Catalogs</CardTitle>
              <button
                onClick={() => setShowNewCatalog(true)}
                className="text-fg/40 hover:text-accent transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>
            </CardHeader>
            <div className="p-2">
              {showNewCatalog && (
                <div className="flex items-center gap-1 px-2 py-1 mb-1">
                  <Input
                    className="h-7 text-xs"
                    placeholder="Catalog name"
                    value={newCatalogName}
                    onChange={(e) => setNewCatalogName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addCatalog();
                      if (e.key === "Escape") setShowNewCatalog(false);
                    }}
                    autoFocus
                  />
                  <button
                    onClick={addCatalog}
                    className="text-success hover:text-success/80"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setShowNewCatalog(false)}
                    className="text-fg/40 hover:text-fg/60"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              {catalogs.length === 0 && !showNewCatalog && (
                <p className="px-3 py-4 text-center text-xs text-fg/40">
                  No catalogs yet
                </p>
              )}
              {catalogs.map((catalog) => (
                <button
                  key={catalog.id}
                  onClick={() => setSelectedCatalogId(catalog.id)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors",
                    selectedCatalogId === catalog.id
                      ? "bg-accent/10 text-accent font-medium"
                      : "text-fg/60 hover:bg-panel2 hover:text-fg/80"
                  )}
                >
                  <span className="truncate">{catalog.name}</span>
                  <Badge tone="default" className="shrink-0">
                    {catalog.items?.length ?? 0}
                  </Badge>
                </button>
              ))}
            </div>
          </Card>
        </FadeIn>

        {/* Items table */}
        <FadeIn delay={0.1} className="min-w-0 flex-1">
          <Card>
            <div className="flex items-center gap-3 border-b border-line px-5 py-3">
              <div className="relative flex-1 max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/25" />
                <Input
                  className="h-8 pl-8 text-xs"
                  placeholder="Search items..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Button variant="accent" size="sm" onClick={addItem} disabled={!selectedCatalogId}>
                <Plus className="h-3.5 w-3.5" />
                Add Item
              </Button>
            </div>

            {!selectedCatalog ? (
              <EmptyState className="m-5">
                <Package className="mx-auto mb-2 h-8 w-8 text-fg/20" />
                Select a catalog to view items
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      {columns.map((col) => (
                        <th
                          key={col.key}
                          className={cn(
                            "px-5 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40",
                            col.className
                          )}
                        >
                          {col.label}
                        </th>
                      ))}
                      <th className="w-12 px-3 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.length === 0 && (
                      <tr>
                        <td
                          colSpan={columns.length + 1}
                          className="px-5 py-12 text-center text-sm text-fg/40"
                        >
                          <Package className="mx-auto mb-2 h-8 w-8 text-fg/20" />
                          No items in this catalog
                        </td>
                      </tr>
                    )}
                    {filteredItems.map((item, i) => (
                      <motion.tr
                        key={item.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          duration: 0.2,
                          delay: i * 0.02,
                          ease: "easeOut",
                        }}
                        className="border-b border-line last:border-0 hover:bg-panel2/40 transition-colors group"
                      >
                        {columns.map((col) => {
                          const isEditing =
                            editingCell?.itemId === item.id &&
                            editingCell?.field === col.key;
                          const rawValue =
                            col.key === "category"
                              ? item.category
                              : (item as unknown as Record<string, unknown>)[col.key];
                          const displayValue =
                            col.key === "unitCost" || col.key === "unitPrice"
                              ? formatMoney(rawValue as number, 2)
                              : String(rawValue ?? "");

                          return (
                            <td
                              key={col.key}
                              className={cn(
                                "px-5 py-2.5 text-xs",
                                col.className,
                                !isEditing && "cursor-pointer"
                              )}
                              onClick={() => {
                                if (!isEditing) startEdit(item.id, col.key, rawValue as string | number);
                              }}
                            >
                              {isEditing ? (
                                <Input
                                  className="h-7 text-xs"
                                  value={editValue}
                                  onChange={(e) =>
                                    setEditValue(e.target.value)
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") commitEdit();
                                    if (e.key === "Escape") cancelEdit();
                                  }}
                                  onBlur={commitEdit}
                                  autoFocus
                                />
                              ) : (
                                <span className="text-fg/70">
                                  {displayValue || (
                                    <span className="text-fg/25 italic">
                                      empty
                                    </span>
                                  )}
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2.5">
                          <button
                            onClick={() => deleteItem(item.id)}
                            className="opacity-0 group-hover:opacity-100 text-fg/30 hover:text-danger transition-all"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </FadeIn>
      </div>
    </div>
  );
}
