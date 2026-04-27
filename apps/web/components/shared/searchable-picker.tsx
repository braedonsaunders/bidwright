"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SearchablePickerOption {
  id: string;
  label: string;
  secondary?: string;
  group?: string;
  code?: string;
}

export interface SearchablePickerProps {
  value: string | null;
  options: SearchablePickerOption[];
  onSelect: (id: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
  /** Width of the popover content; defaults to 360 */
  width?: number;
  /** Empty-state message when there are no options at all */
  emptyMessage?: string;
}

export function SearchablePicker({
  value,
  options,
  onSelect,
  placeholder = "Choose…",
  searchPlaceholder = "Search…",
  className,
  triggerClassName,
  disabled,
  width = 360,
  emptyMessage = "No matches",
}: SearchablePickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const grouped = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = q
      ? options.filter(
          (o) =>
            o.label.toLowerCase().includes(q) ||
            (o.secondary?.toLowerCase().includes(q) ?? false) ||
            (o.code?.toLowerCase().includes(q) ?? false) ||
            (o.group?.toLowerCase().includes(q) ?? false),
        )
      : options;

    const groups: Record<string, SearchablePickerOption[]> = {};
    for (const opt of filtered) {
      const key = opt.group ?? "";
      if (!groups[key]) groups[key] = [];
      groups[key].push(opt);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [options, search]);

  const selected = value ? options.find((o) => o.id === value) : null;

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
    else setSearch("");
  }, [open]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            "flex items-center justify-between gap-1 h-7 w-full rounded-md border border-line bg-bg/45 px-2 text-[11px] text-fg outline-none transition-colors",
            "hover:border-accent/30 focus-visible:border-accent/50 focus-visible:ring-1 focus-visible:ring-accent/20",
            disabled && "opacity-40 pointer-events-none",
            triggerClassName,
            className,
          )}
        >
          <span className={cn("truncate", !selected && "text-fg/40")}>{selected ? selected.label : placeholder}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg/35" />
        </button>
      </Popover.Trigger>

      <AnimatePresence>
        {open && (
          <Popover.Portal forceMount>
            <Popover.Content asChild sideOffset={4} align="start" className="z-50">
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.12 }}
                style={{ width }}
                className="rounded-lg border border-line bg-panel shadow-xl"
              >
                <div className="p-2 border-b border-line">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg/30" />
                    <input
                      ref={inputRef}
                      type="text"
                      className="w-full h-8 rounded border border-line bg-bg pl-8 pr-8 text-xs text-fg outline-none focus:border-accent/50"
                      placeholder={searchPlaceholder}
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
                        type="button"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="max-h-72 overflow-y-auto py-1">
                  {options.length === 0 ? (
                    <div className="py-6 text-center text-xs text-fg/40">{emptyMessage}</div>
                  ) : grouped.length === 0 ? (
                    <div className="py-6 text-center text-xs text-fg/40">No items match "{search}"</div>
                  ) : (
                    grouped.map(([groupName, items]) => (
                      <div key={groupName}>
                        {groupName && (
                          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase text-fg/35 tracking-wider bg-panel2/30 sticky top-0">
                            {groupName}
                            <span className="ml-1.5 text-fg/20 font-normal">{items.length}</span>
                          </div>
                        )}
                        {items.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className={cn(
                              "w-full text-left px-3 py-1.5 text-xs hover:bg-accent/10 transition-colors flex items-center justify-between gap-2",
                              value === item.id && "bg-accent/5",
                            )}
                            onClick={() => {
                              onSelect(item.id);
                              setOpen(false);
                              setSearch("");
                            }}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {item.code && <span className="shrink-0 font-mono text-fg/40 text-[10px]">{item.code}</span>}
                              <span className="truncate text-fg">{item.label}</span>
                            </div>
                            {item.secondary && <span className="shrink-0 text-[10px] text-fg/35">{item.secondary}</span>}
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
