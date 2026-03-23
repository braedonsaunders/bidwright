"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CatalogItem, CatalogSummary } from "@/lib/api";

/* ─── Types ─── */

export interface CatalogPickerItem {
  id: string;
  catalogId: string;
  code: string;
  name: string;
  unit: string;
  unitCost: number;
  unitPrice: number;
  category: string;
  catalogName: string;
  catalogKind: string;
}

export interface CatalogItemPickerProps {
  /** Loaded catalogs with items populated */
  catalogs: CatalogSummary[];
  /** Optional filter by catalog kind(s) */
  filterKinds?: string[];
  /** Currently selected item id (for controlled mode) */
  value?: string | null;
  /** Placeholder text */
  placeholder?: string;
  /** Callback when an item is selected */
  onSelect: (item: CatalogPickerItem) => void;
  /** Optional: allow free-text entry alongside picker */
  allowFreeText?: boolean;
  /** Free-text value (only used if allowFreeText) */
  freeTextValue?: string;
  /** Free-text change handler */
  onFreeTextChange?: (val: string) => void;
  /** Additional className */
  className?: string;
  /** Disabled state */
  disabled?: boolean;
}

/* ─── Component ─── */

export function CatalogItemPicker({
  catalogs,
  filterKinds,
  value,
  placeholder = "Select item...",
  onSelect,
  allowFreeText,
  freeTextValue,
  onFreeTextChange,
  className,
  disabled,
}: CatalogItemPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Build flat item list from catalogs
  const allItems = useMemo(() => {
    const items: CatalogPickerItem[] = [];
    for (const catalog of catalogs) {
      if (filterKinds && !filterKinds.includes(catalog.kind)) continue;
      for (const ci of catalog.items ?? []) {
        items.push({
          id: ci.id,
          catalogId: catalog.id,
          code: ci.code,
          name: ci.name,
          unit: ci.unit,
          unitCost: ci.unitCost,
          unitPrice: ci.unitPrice,
          category: (ci.metadata as Record<string, string>)?.category || "",
          catalogName: catalog.name,
          catalogKind: catalog.kind,
        });
      }
    }
    return items;
  }, [catalogs, filterKinds]);

  // Group by category
  const groupedItems = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = q
      ? allItems.filter(
          (i) =>
            i.name.toLowerCase().includes(q) ||
            i.code.toLowerCase().includes(q) ||
            i.category.toLowerCase().includes(q)
        )
      : allItems;

    const groups: Record<string, CatalogPickerItem[]> = {};
    for (const item of filtered) {
      const key = item.category || "Uncategorized";
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }

    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [allItems, search]);

  const selectedItem = value ? allItems.find((i) => i.id === value) : null;

  // Focus input when popover opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setSearch("");
    }
  }, [open]);

  const handleSelect = useCallback(
    (item: CatalogPickerItem) => {
      onSelect(item);
      setOpen(false);
      setSearch("");
    },
    [onSelect]
  );

  const fmt = (n: number) => (n ? `$${n.toFixed(2)}` : "");

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            "flex items-center justify-between gap-1 h-9 w-full rounded-lg border border-line bg-bg/50 px-3 text-sm text-fg outline-none transition-colors",
            "hover:border-fg/20 focus:border-accent/50 focus:ring-1 focus:ring-accent/20",
            disabled && "opacity-50 cursor-not-allowed",
            className
          )}
        >
          <span className={cn("truncate", !selectedItem && !freeTextValue && "text-fg/40")}>
            {selectedItem
              ? selectedItem.name
              : freeTextValue || placeholder}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg/30" />
        </button>
      </Popover.Trigger>

      <AnimatePresence>
        {open && (
          <Popover.Portal forceMount>
            <Popover.Content
              asChild
              sideOffset={4}
              align="start"
              className="z-50"
            >
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.15 }}
                className="w-[360px] rounded-lg border border-line bg-panel shadow-xl"
              >
                {/* Search header */}
                <div className="p-2 border-b border-line">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg/30" />
                    <input
                      ref={inputRef}
                      type="text"
                      className="w-full h-8 rounded border border-line bg-bg pl-8 pr-8 text-xs text-fg outline-none focus:border-accent/50"
                      placeholder="Search items by name, code, or category..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setOpen(false);
                      }}
                    />
                    {search && (
                      <button
                        onClick={() => setSearch("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-fg/30 hover:text-fg/60"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  {allowFreeText && (
                    <div className="mt-2">
                      <input
                        type="text"
                        className="w-full h-7 rounded border border-dashed border-line bg-bg/30 px-2.5 text-xs text-fg outline-none focus:border-accent/40 placeholder:text-fg/30"
                        placeholder="Or type a custom name..."
                        value={freeTextValue || ""}
                        onChange={(e) => onFreeTextChange?.(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setOpen(false);
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Item list */}
                <div className="max-h-72 overflow-y-auto py-1">
                  {groupedItems.length === 0 ? (
                    <div className="py-6 text-center text-xs text-fg/40">
                      {search ? "No items match your search" : "No catalog items available"}
                    </div>
                  ) : (
                    groupedItems.map(([category, items]) => (
                      <div key={category}>
                        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase text-fg/35 tracking-wider bg-panel2/30 sticky top-0">
                          {category}
                          <span className="ml-1.5 text-fg/20 font-normal">{items.length}</span>
                        </div>
                        {items.map((item) => (
                          <button
                            key={item.id}
                            className={cn(
                              "w-full text-left px-3 py-1.5 text-xs hover:bg-accent/10 transition-colors flex items-center justify-between gap-2",
                              value === item.id && "bg-accent/5"
                            )}
                            onClick={() => handleSelect(item)}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {item.code && (
                                <span className="shrink-0 font-mono text-fg/40 text-[10px]">
                                  {item.code}
                                </span>
                              )}
                              <span className="truncate text-fg">{item.name}</span>
                            </div>
                            <div className="shrink-0 flex items-center gap-2 text-[10px] text-fg/30 tabular-nums">
                              <span className="text-fg/20">{item.unit}</span>
                              {(item.unitCost > 0 || item.unitPrice > 0) && (
                                <span>
                                  {fmt(item.unitCost)}
                                  {item.unitCost > 0 && item.unitPrice > 0 && " / "}
                                  {fmt(item.unitPrice)}
                                </span>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            </Popover.Content>
          </Popover.Portal>
        )}
      </AnimatePresence>
    </Popover.Root>
  );
}
