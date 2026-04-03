"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { Search, X, FileText, Settings2, Layers3, Hash, SlidersHorizontal, ListChecks, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectWorkspaceData } from "@/lib/api";

/* ─── Navigation target types ─── */

export type SearchNavigationTarget =
  | { tab: "setup"; field?: string }
  | { tab: "estimate"; subTab: "worksheets"; worksheetId: string; itemId: string }
  | { tab: "estimate"; subTab: "phases"; phaseId: string }
  | { tab: "documents"; documentId: string }
  | { tab: "summarize" };

interface SearchResult {
  id: string;
  category: string;
  icon: typeof Search;
  label: string;
  context: string;
  target: SearchNavigationTarget;
}

/* ─── Helpers ─── */

const CATEGORY_ORDER = ["Setup", "Customer", "Line Items", "Phases", "Modifiers", "Conditions", "Additional Items", "Documents"];
const MAX_PER_CATEGORY = 8;
const MAX_TOTAL = 40;
const CONTEXT_RADIUS = 50;
const EXTRACTED_TEXT_CAP = 100_000;

const CATEGORY_ICONS: Record<string, typeof Search> = {
  "Setup": Settings2,
  "Customer": Settings2,
  "Line Items": Layers3,
  "Phases": Hash,
  "Modifiers": SlidersHorizontal,
  "Conditions": ListChecks,
  "Additional Items": ClipboardList,
  "Documents": FileText,
};

function snippetAround(text: string, query: string, radius = CONTEXT_RADIUS): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = "…" + snippet;
  if (end < text.length) snippet = snippet + "…";
  return snippet;
}

function highlightMatch(text: string, query: string): React.ReactNode[] {
  if (!query) return [text];
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let idx = lower.indexOf(qLower);
  let key = 0;
  while (idx !== -1 && key < 20) {
    if (idx > lastIdx) parts.push(text.slice(lastIdx, idx));
    parts.push(
      <mark key={key++} className="bg-accent/20 text-accent font-semibold rounded-sm px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
    );
    lastIdx = idx + query.length;
    idx = lower.indexOf(qLower, lastIdx);
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}

/* ─── Search index builder ─── */

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
}

function buildSearchIndex(workspace: ProjectWorkspaceData): Array<Omit<SearchResult, "context"> & { searchText: string; rawText: string }> {
  const entries: Array<Omit<SearchResult, "context"> & { searchText: string; rawText: string }> = [];
  const rev = workspace?.currentRevision;
  if (!rev) return entries;

  // Setup fields — strip HTML from rich-text fields
  const setupFields: Array<{ field: string; label: string; value: string }> = [
    { field: "title", label: "Title", value: rev.title ?? "" },
    { field: "description", label: "Description", value: stripHtml(rev.description ?? "") },
    { field: "notes", label: "Notes", value: stripHtml(rev.notes ?? "") },
    { field: "scratchpad", label: "Scratchpad", value: stripHtml(rev.scratchpad ?? "") },
    { field: "leadLetter", label: "Lead Letter", value: stripHtml(rev.leadLetter ?? "") },
    { field: "followUpNote", label: "Follow-up Note", value: stripHtml(rev.followUpNote ?? "") },
  ];
  for (const sf of setupFields) {
    if (!sf.value) continue;
    entries.push({
      id: `setup-${sf.field}`,
      category: "Setup",
      icon: Settings2,
      label: sf.label,
      searchText: sf.value.toLowerCase(),
      rawText: sf.value,
      target: { tab: "setup", field: sf.field },
    });
  }

  // Customer
  const customerFields = [
    { label: "Customer", value: workspace.quote?.customerString ?? "" },
    { label: "Contact", value: workspace.quote?.customerContactString ?? "" },
  ];
  for (const cf of customerFields) {
    if (!cf.value) continue;
    entries.push({
      id: `customer-${cf.label}`,
      category: "Customer",
      icon: Settings2,
      label: cf.label,
      searchText: cf.value.toLowerCase(),
      rawText: cf.value,
      target: { tab: "setup" },
    });
  }

  // Line items
  for (const ws of (workspace.worksheets ?? [])) {
    for (const item of (ws.items ?? [])) {
      const text = [item.entityName, item.description, item.category, item.vendor || ""].join(" ");
      entries.push({
        id: `item-${item.id}`,
        category: "Line Items",
        icon: Layers3,
        label: item.entityName || item.description || item.category,
        searchText: text.toLowerCase(),
        rawText: text,
        target: { tab: "estimate", subTab: "worksheets", worksheetId: ws.id, itemId: item.id },
      });
    }
  }

  // Phases
  for (const phase of (workspace.phases ?? [])) {
    const text = [phase.name, phase.description].join(" ");
    entries.push({
      id: `phase-${phase.id}`,
      category: "Phases",
      icon: Hash,
      label: `${phase.number ? phase.number + " — " : ""}${phase.name}`,
      searchText: text.toLowerCase(),
      rawText: text,
      target: { tab: "estimate", subTab: "phases", phaseId: phase.id },
    });
  }

  // Modifiers
  for (const mod of (workspace.modifiers ?? [])) {
    const text = [mod.name, mod.type].join(" ");
    entries.push({
      id: `mod-${mod.id}`,
      category: "Modifiers",
      icon: SlidersHorizontal,
      label: mod.name,
      searchText: text.toLowerCase(),
      rawText: text,
      target: { tab: "setup" },
    });
  }

  // Conditions (inclusions, exclusions, etc.)
  for (const cond of (workspace.conditions ?? [])) {
    const text = [cond.type, cond.value].join(" ");
    entries.push({
      id: `cond-${cond.id}`,
      category: "Conditions",
      icon: ListChecks,
      label: `${cond.type}: ${cond.value}`,
      searchText: text.toLowerCase(),
      rawText: text,
      target: { tab: "setup" },
    });
  }

  // Additional line items
  for (const ali of (workspace.additionalLineItems ?? [])) {
    const text = [ali.name, ali.description || ""].join(" ");
    entries.push({
      id: `ali-${ali.id}`,
      category: "Additional Items",
      icon: ClipboardList,
      label: ali.name,
      searchText: text.toLowerCase(),
      rawText: text,
      target: { tab: "setup" },
    });
  }

  // Documents (file names + extracted text)
  for (const doc of (workspace.sourceDocuments ?? [])) {
    const extracted = (doc.extractedText || "").slice(0, EXTRACTED_TEXT_CAP);
    const text = [doc.fileName, extracted].join(" ");
    entries.push({
      id: `doc-${doc.id}`,
      category: "Documents",
      icon: FileText,
      label: doc.fileName,
      searchText: text.toLowerCase(),
      rawText: text,
      target: { tab: "documents", documentId: doc.id },
    });
  }

  return entries;
}

/* ─── Component ─── */

export interface WorkspaceSearchProps {
  workspace: ProjectWorkspaceData;
  onNavigate: (target: SearchNavigationTarget) => void;
}

export function WorkspaceSearch({ workspace, onNavigate }: WorkspaceSearchProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Build index once when workspace changes
  const searchIndex = useMemo(() => buildSearchIndex(workspace), [workspace]);

  // Debounced query
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 120);
    return () => clearTimeout(t);
  }, [query]);

  // Filtered results
  const groupedResults = useMemo(() => {
    const q = debouncedQuery.toLowerCase();
    if (!q) return [];

    // Filter matches
    const matches: SearchResult[] = [];
    const categoryCounts: Record<string, number> = {};

    for (const entry of searchIndex) {
      if (matches.length >= MAX_TOTAL) break;
      const cat = entry.category;
      if ((categoryCounts[cat] ?? 0) >= MAX_PER_CATEGORY) continue;

      if (entry.searchText.includes(q)) {
        categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
        matches.push({
          id: entry.id,
          category: cat,
          icon: entry.icon,
          label: entry.label,
          context: snippetAround(entry.rawText, debouncedQuery),
          target: entry.target,
        });
      }
    }

    // Group by category, maintain order
    const groups: Array<{ category: string; icon: typeof Search; results: SearchResult[] }> = [];
    const seen = new Set<string>();
    for (const cat of CATEGORY_ORDER) {
      const catResults = matches.filter((r) => r.category === cat);
      if (catResults.length > 0 && !seen.has(cat)) {
        seen.add(cat);
        groups.push({ category: cat, icon: CATEGORY_ICONS[cat] ?? Search, results: catResults });
      }
    }
    return groups;
  }, [debouncedQuery, searchIndex]);

  // Flat list for keyboard nav
  const flatResults = useMemo(() => groupedResults.flatMap((g) => g.results), [groupedResults]);

  // Reset active index on results change
  useEffect(() => {
    setActiveIndex(0);
  }, [flatResults.length, debouncedQuery]);

  // Keyboard shortcut: Cmd+K
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      onNavigate(result.target);
      setIsOpen(false);
      setQuery("");
    },
    [onNavigate]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, flatResults.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && flatResults[activeIndex]) {
        e.preventDefault();
        handleSelect(flatResults[activeIndex]);
      } else if (e.key === "Escape") {
        setIsOpen(false);
        setQuery("");
      }
    },
    [flatResults, activeIndex, handleSelect]
  );

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-result-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Focus input when opening
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
      setActiveIndex(0);
    }
  }, [isOpen]);

  // Refs for click-outside and dropdown positioning
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on click outside (checks both trigger and portal dropdown)
  useEffect(() => {
    if (!isOpen) return;
    function onClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [isOpen]);

  // Compute dropdown position from trigger rect
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    if (!isOpen || !containerRef.current) { setDropdownPos(null); return; }
    const rect = containerRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + 6,
      right: window.innerWidth - rect.right,
    });
  }, [isOpen, debouncedQuery]);

  const showResults = isOpen && debouncedQuery.length > 0;
  let flatIndex = -1;

  return (
    <div ref={containerRef} className="relative flex items-center">
      {/* Inline search bar: icon + expanding input */}
      <div
        className={cn(
          "flex items-center rounded-lg transition-colors",
          isOpen
            ? "bg-panel2/60 border border-line"
            : "hover:bg-panel2/40"
        )}
      >
        <button
          type="button"
          className="flex items-center gap-1.5 px-2 py-1.5 text-fg/40 hover:text-fg/70 transition-colors shrink-0"
          onClick={() => {
            setIsOpen(true);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
          title="Search workspace (⌘K)"
        >
          <Search className="h-3.5 w-3.5" />
          {!isOpen && (
            <span className="hidden sm:block text-fg/25 text-[10px] font-medium">
              ⌘K
            </span>
          )}
        </button>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 220, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden flex items-center"
            >
              <input
                ref={inputRef}
                type="text"
                className="w-full bg-transparent text-xs text-fg outline-none placeholder:text-fg/30 pr-2 py-1.5"
                placeholder="Search quote…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              {query && (
                <button
                  onClick={() => { setQuery(""); inputRef.current?.focus(); }}
                  className="shrink-0 mr-1.5 text-fg/30 hover:text-fg/60 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Results dropdown — portaled to body to escape overflow-x-auto clipping */}
      {showResults && dropdownPos && ReactDOM.createPortal(
        <div
          ref={dropdownRef}
          className="fixed w-[380px] rounded-xl border border-line bg-panel shadow-2xl z-[200]"
          style={{ top: dropdownPos.top, right: dropdownPos.right }}
        >
          <div ref={listRef} className="max-h-[360px] overflow-y-auto">
            {groupedResults.length === 0 && (
              <div className="py-8 text-center text-xs text-fg/35">
                No results for &ldquo;{debouncedQuery}&rdquo;
              </div>
            )}

            {groupedResults.map((group) => (
              <div key={group.category}>
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg/35 bg-panel2/30 sticky top-0 flex items-center gap-1.5">
                  {(() => { const Icon = group.icon; return <Icon className="h-3 w-3" />; })()}
                  {group.category}
                  <span className="text-fg/20 font-normal">{group.results.length}</span>
                </div>
                {group.results.map((result) => {
                  flatIndex++;
                  const idx = flatIndex;
                  return (
                    <button
                      key={result.id}
                      data-result-index={idx}
                      className={cn(
                        "w-full text-left px-3 py-2 text-xs transition-colors flex flex-col gap-0.5",
                        idx === activeIndex
                          ? "bg-accent/10 text-fg"
                          : "hover:bg-panel2/50 text-fg/80"
                      )}
                      onClick={() => handleSelect(result)}
                      onMouseEnter={() => setActiveIndex(idx)}
                    >
                      <span className="font-medium truncate">
                        {highlightMatch(result.label, debouncedQuery)}
                      </span>
                      {result.context !== result.label && (
                        <span className="text-[11px] text-fg/40 truncate leading-relaxed">
                          {highlightMatch(result.context, debouncedQuery)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Footer with hint */}
          {flatResults.length > 0 && (
            <div className="flex items-center justify-between px-3 py-1.5 border-t border-line text-[10px] text-fg/25">
              <span>↑↓ navigate</span>
              <span>↵ select</span>
              <span>esc close</span>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
