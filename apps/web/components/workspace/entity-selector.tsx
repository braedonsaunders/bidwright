"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { EntityCategory, CatalogSummary } from "@/lib/api";
import { cn } from "@/lib/utils";

/* ─── Types ─── */

export interface EntityOptionItem {
  label: string;
  value: string;
  unitCost?: number;
  unitPrice?: number;
  unit?: string;
  description?: string;
}

export interface EntityOptionGroup {
  categoryName: string;
  categoryId: string;
  entityType: string;
  defaultUom: string;
  items: EntityOptionItem[];
}

export interface EntitySelectorProps {
  /** All entity categories */
  categories: EntityCategory[];
  /** Catalog data for building options */
  catalogs: CatalogSummary[];
  /** The current row's category (used for prioritization) */
  currentCategory: string;
  /** Controlled search term */
  searchTerm: string;
  /** Callback when search term changes */
  onSearchChange: (term: string) => void;
  /** Callback when an entity is selected */
  onSelect: (
    entityName: string,
    categoryName: string,
    entityType: string,
    defaultUom: string,
    catalogData?: { cost?: number; uom?: string; description?: string }
  ) => void;
  /** Callback to close the dropdown */
  onClose: () => void;
}

/* ─── Component ─── */

/**
 * Standalone entity selector dropdown with category-aware prioritization.
 *
 * Shows items matching the current row's category first under a "Matching" header,
 * then other categories under an "Other" section.
 * Displays unit cost and unit price next to catalog items.
 */
export function EntitySelector({
  categories,
  catalogs,
  currentCategory,
  searchTerm,
  onSearchChange,
  onSelect,
  onClose,
}: EntitySelectorProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const groups = useMemo(() => {
    const result: EntityOptionGroup[] = [];

    for (const cat of categories) {
      const items: EntityOptionItem[] = [];

      if (cat.name === "Labour") {
        for (const catalog of catalogs) {
          if (catalog.kind === "labor") {
            for (const ci of catalog.items ?? []) {
              if (!items.some((i) => i.value === ci.name)) {
                items.push({
                  label: ci.name,
                  value: ci.name,
                  unitCost: ci.unitCost,
                  unitPrice: ci.unitPrice,
                  unit: ci.unit,
                });
              }
            }
          }
        }
        if (items.length === 0) items.push({ label: "Labour", value: "Labour" });
      } else if (cat.name === "Equipment") {
        for (const catalog of catalogs) {
          if (catalog.kind === "equipment") {
            for (const ci of catalog.items ?? []) {
              items.push({
                label: ci.name,
                value: ci.name,
                unitCost: ci.unitCost,
                unitPrice: ci.unitPrice,
                unit: ci.unit,
              });
            }
          }
        }
        if (items.length === 0) items.push({ label: "Equipment", value: "Equipment" });
      } else if (cat.name === "Stock Items" || cat.name === "Consumables") {
        for (const catalog of catalogs) {
          if (catalog.kind === "materials") {
            for (const ci of catalog.items ?? []) {
              items.push({
                label: ci.name,
                value: ci.name,
                unitCost: ci.unitCost,
                unitPrice: ci.unitPrice,
                unit: ci.unit,
              });
            }
          }
        }
        if (items.length === 0) items.push({ label: cat.name, value: cat.name });
      } else {
        items.push({ label: cat.name, value: cat.name });
      }

      result.push({
        categoryName: cat.name,
        categoryId: cat.id,
        entityType: cat.entityType,
        defaultUom: cat.defaultUom,
        items,
      });
    }

    return result;
  }, [categories, catalogs]);

  const q = searchTerm.toLowerCase();
  const matchingGroups = groups.filter((g) => g.categoryName === currentCategory);
  const otherGroups = groups.filter((g) => g.categoryName !== currentCategory);

  function renderItems(group: EntityOptionGroup, filtered: EntityOptionItem[]) {
    return filtered.map((item) => (
      <button
        key={`${group.categoryId}-${item.value}`}
        className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/10 transition-colors flex items-center justify-between"
        onClick={() =>
          onSelect(
            item.value,
            group.categoryName,
            group.entityType,
            group.defaultUom,
            item.unitCost !== undefined
              ? { cost: item.unitCost, uom: item.unit, description: item.label }
              : undefined
          )
        }
      >
        <span className="truncate">{item.label}</span>
        {(item.unitCost !== undefined || item.unitPrice !== undefined) && (
          <span className="ml-2 text-[10px] text-fg/30 tabular-nums whitespace-nowrap">
            {item.unitCost !== undefined && `$${item.unitCost.toFixed(2)}`}
            {item.unitCost !== undefined && item.unitPrice !== undefined && " / "}
            {item.unitPrice !== undefined && `$${item.unitPrice.toFixed(2)}`}
          </span>
        )}
      </button>
    ));
  }

  return (
    <div
      className="absolute left-0 top-full z-50 mt-1 w-80 rounded-lg border border-line bg-panel shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="p-2 border-b border-line">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-fg/30" />
          <input
            ref={inputRef}
            type="text"
            className="w-full h-7 rounded border border-line bg-bg pl-7 pr-2 text-xs outline-none focus:border-accent/50"
            placeholder="Search entities..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
            }}
          />
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto py-1">
        {/* Matching category first */}
        {matchingGroups.map((group) => {
          const filtered = q
            ? group.items.filter((it) => it.label.toLowerCase().includes(q))
            : group.items;
          if (filtered.length === 0 && q) return null;
          return (
            <div key={group.categoryId}>
              <div className="px-3 py-1 text-[10px] font-semibold uppercase text-accent/60 tracking-wider bg-accent/5">
                Matching &mdash; {group.categoryName}
              </div>
              {renderItems(group, filtered)}
            </div>
          );
        })}

        {/* Other categories */}
        {otherGroups.length > 0 && (
          <>
            {matchingGroups.length > 0 && (
              <div className="px-3 py-1 text-[10px] font-semibold uppercase text-fg/25 tracking-wider bg-panel2/20 border-t border-line mt-1">
                Other
              </div>
            )}
            {otherGroups.map((group) => {
              const filtered = q
                ? group.items.filter((it) => it.label.toLowerCase().includes(q))
                : group.items;
              if (filtered.length === 0 && q) return null;
              return (
                <div key={group.categoryId}>
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase text-fg/35 tracking-wider bg-panel2/40">
                    {group.categoryName}
                  </div>
                  {renderItems(group, filtered)}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
