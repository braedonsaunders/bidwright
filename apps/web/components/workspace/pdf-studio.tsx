"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Loader2,
  Minus,
  Palette,
  Plus,
  Save,
  Send,
  Settings2,
  Type,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button, Input, Label, Select, Toggle } from "@/components/ui";
import { getQuotePdfPreviewUrl, fetchQuotePdfBlobUrl, getPdfPreferences, savePdfPreferences } from "@/lib/api";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────

export interface PdfLayoutOptions {
  sections: {
    coverPage: boolean;
    scopeOfWork: boolean;
    leadLetter: boolean;
    lineItems: boolean;
    phases: boolean;
    modifiers: boolean;
    conditions: boolean;
    hoursSummary: boolean;
    labourSummary: boolean;
    notes: boolean;
    reportSections: boolean;
  };
  sectionOrder: string[];
  lineItemOptions: {
    showCostColumn: boolean;
    showMarkupColumn: boolean;
    groupBy: "none" | "phase" | "worksheet";
  };
  branding: {
    accentColor: string;
    headerBgColor: string;
    fontFamily: "sans" | "serif" | "mono";
  };
  pageSetup: {
    orientation: "portrait" | "landscape";
    pageSize: "letter" | "a4" | "legal";
  };
  coverPageOptions: {
    companyName: string;
    tagline: string;
    logoUrl: string;
  };
  headerFooter: {
    showHeader: boolean;
    showFooter: boolean;
    headerText: string;
    footerText: string;
    showPageNumbers: boolean;
  };
  customSections: Array<{
    id: string;
    title: string;
    content: string;
    order: number;
  }>;
}

const DEFAULT_OPTIONS: PdfLayoutOptions = {
  sections: {
    coverPage: true,
    scopeOfWork: true,
    leadLetter: true,
    lineItems: true,
    phases: true,
    modifiers: true,
    conditions: true,
    hoursSummary: true,
    labourSummary: false,
    notes: true,
    reportSections: true,
  },
  sectionOrder: [
    "coverPage", "scopeOfWork", "leadLetter", "lineItems", "phases",
    "modifiers", "conditions", "hoursSummary", "labourSummary", "notes", "reportSections",
  ],
  lineItemOptions: { showCostColumn: true, showMarkupColumn: true, groupBy: "none" },
  branding: { accentColor: "#3b82f6", headerBgColor: "#1a1a1a", fontFamily: "sans" },
  pageSetup: { orientation: "portrait", pageSize: "letter" },
  coverPageOptions: { companyName: "", tagline: "", logoUrl: "" },
  headerFooter: { showHeader: true, showFooter: true, headerText: "", footerText: "", showPageNumbers: true },
  customSections: [],
};

const SECTION_LABELS: Record<string, string> = {
  coverPage: "Cover Page",
  scopeOfWork: "Scope of Work",
  leadLetter: "Lead Letter",
  lineItems: "Line Items",
  phases: "Phases",
  modifiers: "Modifiers",
  conditions: "Terms & Conditions",
  hoursSummary: "Hours Summary",
  labourSummary: "Labour Summary",
  notes: "Notes",
  reportSections: "Report Sections",
};

const TEMPLATES: Array<{ id: string; label: string; description: string }> = [
  { id: "standard", label: "Standard", description: "Full quote with all sections" },
  { id: "detailed", label: "Detailed", description: "Includes worksheets & backup detail" },
  { id: "summary", label: "Summary", description: "Totals and conditions only" },
  { id: "client", label: "Client-Facing", description: "Clean presentation for clients" },
];

interface PdfStudioProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────

export function PdfStudio({ projectId, open, onClose }: PdfStudioProps) {
  const [options, setOptions] = useState<PdfLayoutOptions>(DEFAULT_OPTIONS);
  const [activeTemplate, setActiveTemplate] = useState("standard");
  const [previewKey, setPreviewKey] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingPrefs, setLoadingPrefs] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [expandedPanels, setExpandedPanels] = useState<Set<string>>(new Set(["template", "sections"]));
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const loadedRef = useRef(false);

  // Debounced preview refresh
  const refreshPreview = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPreviewLoading(true);
      setPreviewKey((k) => k + 1);
    }, 600);
  }, []);

  // Refresh preview when options change
  useEffect(() => {
    refreshPreview();
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [options, activeTemplate, refreshPreview]);

  // Load saved preferences when opened
  useEffect(() => {
    if (!open) {
      loadedRef.current = false;
      return;
    }
    if (loadedRef.current) return;
    loadedRef.current = true;

    setLoadingPrefs(true);
    getPdfPreferences(projectId)
      .then((saved) => {
        if (saved && Object.keys(saved).length > 0) {
          const merged = deepMergeOptions(DEFAULT_OPTIONS, saved as Partial<PdfLayoutOptions>);
          setOptions(merged);
          if ((saved as any).activeTemplate) setActiveTemplate((saved as any).activeTemplate);
        } else {
          setOptions(DEFAULT_OPTIONS);
          setActiveTemplate("standard");
        }
        setDirty(false);
      })
      .catch(() => {
        setOptions(DEFAULT_OPTIONS);
        setActiveTemplate("standard");
      })
      .finally(() => {
        setLoadingPrefs(false);
        setZoom(100);
        setPreviewLoading(true);
        setPreviewKey((k) => k + 1);
      });
  }, [open, projectId]);

  // Auto-save preferences debounced (2s after last change)
  useEffect(() => {
    if (!open || !dirty || loadingPrefs) return;
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(() => {
      const payload = { ...options, activeTemplate } as Record<string, unknown>;
      savePdfPreferences(projectId, payload).catch(() => {});
      setDirty(false);
    }, 2000);
    return () => { if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current); };
  }, [open, dirty, options, activeTemplate, projectId, loadingPrefs]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = { ...options, activeTemplate } as Record<string, unknown>;
      await savePdfPreferences(projectId, payload);
      setDirty(false);
    } catch (e) {
      console.error("Save PDF preferences failed:", e);
    } finally {
      setSaving(false);
    }
  };

  const previewUrl = useMemo(() => {
    const templateType = activeTemplate === "client" ? "main" : activeTemplate === "standard" ? "main" : activeTemplate;
    return getQuotePdfPreviewUrl(projectId, templateType, options as unknown as Record<string, unknown>);
  }, [projectId, activeTemplate, options]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      // Save preferences before downloading
      const payload = { ...options, activeTemplate } as Record<string, unknown>;
      savePdfPreferences(projectId, payload).catch(() => {});

      const templateType = activeTemplate === "client" ? "main" : activeTemplate === "standard" ? "main" : activeTemplate;
      const blobUrl = await fetchQuotePdfBlobUrl(projectId, templateType, options as unknown as Record<string, unknown>);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `quote-${Date.now()}.pdf`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error("PDF download failed:", e);
    } finally {
      setDownloading(false);
    }
  };

  // Option updaters — all mark dirty
  const updateSections = (key: string, value: boolean) => {
    setOptions((prev) => ({ ...prev, sections: { ...prev.sections, [key]: value } }));
    setDirty(true);
  };

  const updateLineItemOptions = <K extends keyof PdfLayoutOptions["lineItemOptions"]>(key: K, value: PdfLayoutOptions["lineItemOptions"][K]) => {
    setOptions((prev) => ({ ...prev, lineItemOptions: { ...prev.lineItemOptions, [key]: value } }));
    setDirty(true);
  };

  const updateBranding = <K extends keyof PdfLayoutOptions["branding"]>(key: K, value: PdfLayoutOptions["branding"][K]) => {
    setOptions((prev) => ({ ...prev, branding: { ...prev.branding, [key]: value } }));
    setDirty(true);
  };

  const updatePageSetup = <K extends keyof PdfLayoutOptions["pageSetup"]>(key: K, value: PdfLayoutOptions["pageSetup"][K]) => {
    setOptions((prev) => ({ ...prev, pageSetup: { ...prev.pageSetup, [key]: value } }));
    setDirty(true);
  };

  const updateCoverPage = <K extends keyof PdfLayoutOptions["coverPageOptions"]>(key: K, value: PdfLayoutOptions["coverPageOptions"][K]) => {
    setOptions((prev) => ({ ...prev, coverPageOptions: { ...prev.coverPageOptions, [key]: value } }));
    setDirty(true);
  };

  const updateHeaderFooter = <K extends keyof PdfLayoutOptions["headerFooter"]>(key: K, value: PdfLayoutOptions["headerFooter"][K]) => {
    setOptions((prev) => ({ ...prev, headerFooter: { ...prev.headerFooter, [key]: value } }));
    setDirty(true);
  };

  // Section reordering
  const moveSection = (key: string, direction: "up" | "down") => {
    setOptions((prev) => {
      const order = [...prev.sectionOrder];
      const idx = order.indexOf(key);
      if (idx < 0) return prev;
      const target = direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= order.length) return prev;
      [order[idx], order[target]] = [order[target], order[idx]];
      return { ...prev, sectionOrder: order };
    });
    setDirty(true);
  };

  // Custom section management
  const addCustomSection = () => {
    setOptions((prev) => ({
      ...prev,
      customSections: [
        ...prev.customSections,
        { id: `custom-${Date.now()}`, title: "New Section", content: "", order: prev.customSections.length },
      ],
    }));
    setDirty(true);
  };

  const updateCustomSection = (id: string, field: "title" | "content", value: string) => {
    setOptions((prev) => ({
      ...prev,
      customSections: prev.customSections.map((s) => (s.id === id ? { ...s, [field]: value } : s)),
    }));
    setDirty(true);
  };

  const removeCustomSection = (id: string) => {
    setOptions((prev) => ({
      ...prev,
      customSections: prev.customSections.filter((s) => s.id !== id),
    }));
    setDirty(true);
  };

  const togglePanel = (panel: string) => {
    setExpandedPanels((prev) => {
      const next = new Set(prev);
      if (next.has(panel)) next.delete(panel);
      else next.add(panel);
      return next;
    });
  };

  const toggleSectionExpand = (key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Template presets
  const applyTemplate = (templateId: string) => {
    setActiveTemplate(templateId);
    setDirty(true);
    switch (templateId) {
      case "summary":
        setOptions((prev) => ({
          ...prev,
          sections: {
            ...prev.sections,
            coverPage: true,
            scopeOfWork: true,
            leadLetter: false,
            lineItems: false,
            phases: false,
            modifiers: true,
            conditions: true,
            hoursSummary: false,
            labourSummary: false,
            notes: true,
            reportSections: false,
          },
        }));
        break;
      case "client":
        setOptions((prev) => ({
          ...prev,
          sections: {
            ...prev.sections,
            coverPage: true,
            scopeOfWork: true,
            leadLetter: true,
            lineItems: true,
            phases: true,
            modifiers: false,
            conditions: true,
            hoursSummary: false,
            labourSummary: false,
            notes: false,
            reportSections: true,
          },
          lineItemOptions: { ...prev.lineItemOptions, showCostColumn: false, showMarkupColumn: false },
        }));
        break;
      case "detailed":
        setOptions((prev) => ({
          ...prev,
          sections: {
            coverPage: true,
            scopeOfWork: true,
            leadLetter: true,
            lineItems: true,
            phases: true,
            modifiers: true,
            conditions: true,
            hoursSummary: true,
            labourSummary: true,
            notes: true,
            reportSections: true,
          },
          lineItemOptions: { showCostColumn: true, showMarkupColumn: true, groupBy: "phase" },
        }));
        break;
      default: // standard
        setOptions(DEFAULT_OPTIONS);
        break;
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex bg-black/60 backdrop-blur-sm"
        >
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ type: "spring", damping: 30, stiffness: 300, delay: 0.05 }}
            className="m-3 flex flex-1 overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
          >
            {/* ─── Left Sidebar ─── */}
            <div className="flex w-[340px] flex-shrink-0 flex-col border-r border-line">
              {/* Sidebar header */}
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10">
                    <FileText className="h-3.5 w-3.5 text-accent" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">PDF Studio</div>
                    <div className="text-[10px] text-fg/35">Document Builder</div>
                  </div>
                </div>
                <button onClick={onClose} className="rounded-md p-1.5 text-fg/40 hover:bg-panel2 hover:text-fg transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {loadingPrefs ? (
                <div className="flex flex-1 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-fg/30" />
                  <span className="ml-2 text-xs text-fg/40">Loading preferences...</span>
                </div>
              ) : (
                <>
                  {/* Sidebar content (scrollable) */}
                  <div className="flex-1 overflow-y-auto">
                    {/* Template picker */}
                    <SidebarPanel
                      title="Template"
                      icon={<FileText className="h-3.5 w-3.5" />}
                      expanded={expandedPanels.has("template")}
                      onToggle={() => togglePanel("template")}
                    >
                      <div className="grid grid-cols-2 gap-2">
                        {TEMPLATES.map((t) => (
                          <button
                            key={t.id}
                            onClick={() => applyTemplate(t.id)}
                            className={cn(
                              "rounded-lg border p-2.5 text-left transition-all",
                              activeTemplate === t.id
                                ? "border-accent bg-accent/5 ring-1 ring-accent/20"
                                : "border-line hover:border-fg/20 hover:bg-panel2/50"
                            )}
                          >
                            <div className="text-xs font-medium">{t.label}</div>
                            <div className="mt-0.5 text-[10px] text-fg/40 leading-tight">{t.description}</div>
                          </button>
                        ))}
                      </div>
                    </SidebarPanel>

                    {/* Page Setup */}
                    <SidebarPanel
                      title="Page Setup"
                      icon={<Settings2 className="h-3.5 w-3.5" />}
                      expanded={expandedPanels.has("pageSetup")}
                      onToggle={() => togglePanel("pageSetup")}
                    >
                      <div className="space-y-3">
                        <div>
                          <Label className="text-[10px] uppercase text-fg/40">Orientation</Label>
                          <div className="mt-1 flex gap-2">
                            {(["portrait", "landscape"] as const).map((o) => (
                              <button
                                key={o}
                                onClick={() => updatePageSetup("orientation", o)}
                                className={cn(
                                  "flex-1 rounded-md border px-3 py-1.5 text-xs capitalize transition-all",
                                  options.pageSetup.orientation === o
                                    ? "border-accent bg-accent/5 text-accent"
                                    : "border-line text-fg/60 hover:border-fg/20"
                                )}
                              >
                                {o}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <Label className="text-[10px] uppercase text-fg/40">Page Size</Label>
                          <Select
                            className="mt-1"
                            value={options.pageSetup.pageSize}
                            onChange={(e) => updatePageSetup("pageSize", e.target.value as "letter" | "a4" | "legal")}
                          >
                            <option value="letter">Letter (8.5 x 11)</option>
                            <option value="a4">A4 (210 x 297mm)</option>
                            <option value="legal">Legal (8.5 x 14)</option>
                          </Select>
                        </div>
                      </div>
                    </SidebarPanel>

                    {/* Sections */}
                    <SidebarPanel
                      title="Sections"
                      icon={<ClipboardIcon className="h-3.5 w-3.5" />}
                      expanded={expandedPanels.has("sections")}
                      onToggle={() => togglePanel("sections")}
                    >
                      <div className="space-y-0.5">
                        {options.sectionOrder.map((key, idx) => {
                          const label = SECTION_LABELS[key];
                          if (!label) return null;
                          const enabled = options.sections[key as keyof typeof options.sections];
                          const hasSubOptions = key === "lineItems" || key === "coverPage";
                          const isExpanded = expandedSections.has(key);

                          return (
                            <div key={key} className="group">
                              <div className={cn(
                                "flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors",
                                enabled ? "bg-transparent" : "opacity-50"
                              )}>
                                {/* Reorder buttons */}
                                <div className="flex flex-col gap-0">
                                  <button
                                    onClick={() => moveSection(key, "up")}
                                    disabled={idx === 0}
                                    className="text-fg/20 hover:text-fg/60 disabled:opacity-0 p-0 leading-none"
                                  >
                                    <ArrowUp className="h-2.5 w-2.5" />
                                  </button>
                                  <button
                                    onClick={() => moveSection(key, "down")}
                                    disabled={idx === options.sectionOrder.length - 1}
                                    className="text-fg/20 hover:text-fg/60 disabled:opacity-0 p-0 leading-none"
                                  >
                                    <ArrowDown className="h-2.5 w-2.5" />
                                  </button>
                                </div>

                                {/* Expand arrow for sub-options */}
                                {hasSubOptions ? (
                                  <button onClick={() => toggleSectionExpand(key)} className="text-fg/30 hover:text-fg/60">
                                    {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                  </button>
                                ) : (
                                  <div className="w-3" />
                                )}

                                <span className="flex-1 text-xs text-fg/70">{label}</span>
                                <Toggle
                                  checked={enabled}
                                  onChange={(v) => updateSections(key, v)}
                                />
                              </div>

                              {/* Sub-options */}
                              {hasSubOptions && isExpanded && enabled && (
                                <div className="ml-8 mb-2 space-y-2 border-l-2 border-line pl-3 pt-1">
                                  {key === "lineItems" && (
                                    <>
                                      <div className="flex items-center justify-between">
                                        <span className="text-[11px] text-fg/50">Show Cost Column</span>
                                        <Toggle
                                          checked={options.lineItemOptions.showCostColumn}
                                          onChange={(v) => updateLineItemOptions("showCostColumn", v)}
                                        />
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <span className="text-[11px] text-fg/50">Show Markup Column</span>
                                        <Toggle
                                          checked={options.lineItemOptions.showMarkupColumn}
                                          onChange={(v) => updateLineItemOptions("showMarkupColumn", v)}
                                        />
                                      </div>
                                      <div>
                                        <span className="text-[11px] text-fg/50">Group By</span>
                                        <Select
                                          className="mt-1 h-7 text-xs"
                                          value={options.lineItemOptions.groupBy}
                                          onChange={(e) => updateLineItemOptions("groupBy", e.target.value as "none" | "phase" | "worksheet")}
                                        >
                                          <option value="none">No Grouping</option>
                                          <option value="phase">By Phase</option>
                                          <option value="worksheet">By Worksheet</option>
                                        </Select>
                                      </div>
                                    </>
                                  )}
                                  {key === "coverPage" && (
                                    <>
                                      <div>
                                        <Label className="text-[10px] text-fg/40">Company Name</Label>
                                        <Input
                                          className="mt-0.5 h-7 text-xs"
                                          value={options.coverPageOptions.companyName}
                                          onChange={(e) => updateCoverPage("companyName", e.target.value)}
                                          placeholder="Your Company"
                                        />
                                      </div>
                                      <div>
                                        <Label className="text-[10px] text-fg/40">Tagline</Label>
                                        <Input
                                          className="mt-0.5 h-7 text-xs"
                                          value={options.coverPageOptions.tagline}
                                          onChange={(e) => updateCoverPage("tagline", e.target.value)}
                                          placeholder="Quality work, every time"
                                        />
                                      </div>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Custom sections */}
                      {options.customSections.length > 0 && (
                        <div className="mt-3 border-t border-line pt-3">
                          <div className="text-[10px] font-medium uppercase text-fg/30 mb-2">Custom Sections</div>
                          {options.customSections.map((cs) => (
                            <div key={cs.id} className="mb-2 rounded-md border border-line p-2">
                              <div className="flex items-center gap-2 mb-1.5">
                                <Input
                                  className="h-6 flex-1 text-xs"
                                  value={cs.title}
                                  onChange={(e) => updateCustomSection(cs.id, "title", e.target.value)}
                                  placeholder="Section title"
                                />
                                <button
                                  onClick={() => removeCustomSection(cs.id)}
                                  className="text-fg/30 hover:text-danger transition-colors"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              <textarea
                                className="w-full rounded-md border border-line bg-transparent px-2 py-1.5 text-xs text-fg/70 resize-none focus:border-accent focus:outline-none"
                                rows={3}
                                value={cs.content}
                                onChange={(e) => updateCustomSection(cs.id, "content", e.target.value)}
                                placeholder="Section content..."
                              />
                            </div>
                          ))}
                        </div>
                      )}
                      <button
                        onClick={addCustomSection}
                        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line px-3 py-2 text-xs text-fg/40 hover:border-fg/30 hover:text-fg/60 transition-colors"
                      >
                        <Plus className="h-3 w-3" /> Add Custom Section
                      </button>
                    </SidebarPanel>

                    {/* Branding */}
                    <SidebarPanel
                      title="Branding"
                      icon={<Palette className="h-3.5 w-3.5" />}
                      expanded={expandedPanels.has("branding")}
                      onToggle={() => togglePanel("branding")}
                    >
                      <div className="space-y-3">
                        <div>
                          <Label className="text-[10px] uppercase text-fg/40">Accent Color</Label>
                          <div className="mt-1 flex items-center gap-2">
                            <input
                              type="color"
                              value={options.branding.accentColor}
                              onChange={(e) => updateBranding("accentColor", e.target.value)}
                              className="h-8 w-8 cursor-pointer rounded border border-line"
                            />
                            <Input
                              className="h-7 flex-1 text-xs font-mono"
                              value={options.branding.accentColor}
                              onChange={(e) => updateBranding("accentColor", e.target.value)}
                            />
                          </div>
                        </div>
                        <div>
                          <Label className="text-[10px] uppercase text-fg/40">Header Background</Label>
                          <div className="mt-1 flex items-center gap-2">
                            <input
                              type="color"
                              value={options.branding.headerBgColor}
                              onChange={(e) => updateBranding("headerBgColor", e.target.value)}
                              className="h-8 w-8 cursor-pointer rounded border border-line"
                            />
                            <Input
                              className="h-7 flex-1 text-xs font-mono"
                              value={options.branding.headerBgColor}
                              onChange={(e) => updateBranding("headerBgColor", e.target.value)}
                            />
                          </div>
                        </div>
                        <div>
                          <Label className="text-[10px] uppercase text-fg/40">Font</Label>
                          <div className="mt-1 flex gap-2">
                            {(["sans", "serif", "mono"] as const).map((f) => (
                              <button
                                key={f}
                                onClick={() => updateBranding("fontFamily", f)}
                                className={cn(
                                  "flex-1 rounded-md border px-2 py-1.5 text-xs capitalize transition-all",
                                  f === "serif" && "font-serif",
                                  f === "mono" && "font-mono",
                                  options.branding.fontFamily === f
                                    ? "border-accent bg-accent/5 text-accent"
                                    : "border-line text-fg/60 hover:border-fg/20"
                                )}
                              >
                                {f === "sans" ? "Sans Serif" : f === "serif" ? "Serif" : "Monospace"}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </SidebarPanel>

                    {/* Header & Footer */}
                    <SidebarPanel
                      title="Header & Footer"
                      icon={<Type className="h-3.5 w-3.5" />}
                      expanded={expandedPanels.has("headerFooter")}
                      onToggle={() => togglePanel("headerFooter")}
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-fg/60">Show Header</span>
                          <Toggle checked={options.headerFooter.showHeader} onChange={(v) => updateHeaderFooter("showHeader", v)} />
                        </div>
                        {options.headerFooter.showHeader && (
                          <div>
                            <Label className="text-[10px] text-fg/40">Header Text</Label>
                            <Input
                              className="mt-0.5 h-7 text-xs"
                              value={options.headerFooter.headerText}
                              onChange={(e) => updateHeaderFooter("headerText", e.target.value)}
                              placeholder="Company name or quote ref"
                            />
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-fg/60">Show Footer</span>
                          <Toggle checked={options.headerFooter.showFooter} onChange={(v) => updateHeaderFooter("showFooter", v)} />
                        </div>
                        {options.headerFooter.showFooter && (
                          <div>
                            <Label className="text-[10px] text-fg/40">Footer Text</Label>
                            <Input
                              className="mt-0.5 h-7 text-xs"
                              value={options.headerFooter.footerText}
                              onChange={(e) => updateHeaderFooter("footerText", e.target.value)}
                              placeholder="Confidential / proprietary"
                            />
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-fg/60">Page Numbers</span>
                          <Toggle checked={options.headerFooter.showPageNumbers} onChange={(v) => updateHeaderFooter("showPageNumbers", v)} />
                        </div>
                      </div>
                    </SidebarPanel>
                  </div>

                  {/* Sidebar footer */}
                  <div className="border-t border-line p-3 space-y-2">
                    <div className="flex gap-2">
                      <Button
                        variant="accent"
                        size="sm"
                        className="flex-1"
                        onClick={handleDownload}
                        disabled={downloading}
                      >
                        {downloading ? (
                          <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating...</>
                        ) : (
                          <><Download className="h-3.5 w-3.5" /> Download PDF</>
                        )}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleSave}
                        disabled={saving || !dirty}
                        title="Save PDF preferences for this quote"
                      >
                        {saving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Save className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                    {dirty && (
                      <div className="text-[10px] text-fg/30 text-center">Unsaved changes (auto-saves in 2s)</div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* ─── Right Preview Panel ─── */}
            <div className="flex flex-1 flex-col bg-panel2/30">
              {/* Preview toolbar */}
              <div className="flex items-center justify-between border-b border-line px-4 py-2">
                <div className="flex items-center gap-2">
                  <Eye className="h-3.5 w-3.5 text-fg/40" />
                  <span className="text-xs font-medium text-fg/60">Live Preview</span>
                  {previewLoading && (
                    <Loader2 className="h-3 w-3 animate-spin text-fg/30" />
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setZoom((z) => Math.max(50, z - 10))}
                    className="rounded p-1 text-fg/40 hover:bg-panel2 hover:text-fg/60 transition-colors"
                  >
                    <ZoomOut className="h-3.5 w-3.5" />
                  </button>
                  <span className="min-w-[3rem] text-center text-[10px] text-fg/40 tabular-nums">{zoom}%</span>
                  <button
                    onClick={() => setZoom((z) => Math.min(200, z + 10))}
                    className="rounded p-1 text-fg/40 hover:bg-panel2 hover:text-fg/60 transition-colors"
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </button>
                  <div className="mx-2 h-4 w-px bg-line" />
                  <button
                    onClick={() => { setPreviewLoading(true); setPreviewKey((k) => k + 1); }}
                    className="rounded px-2 py-1 text-[10px] text-fg/40 hover:bg-panel2 hover:text-fg/60 transition-colors"
                  >
                    Refresh
                  </button>
                </div>
              </div>

              {/* Preview iframe */}
              <div className="flex-1 overflow-auto p-6">
                <div
                  className="mx-auto bg-white rounded-lg shadow-lg overflow-hidden transition-transform origin-top-left"
                  style={{
                    width: options.pageSetup.orientation === "landscape" ? 1056 : 816,
                    height: options.pageSetup.orientation === "landscape" ? 816 : 1056,
                    transform: `scale(${zoom / 100})`,
                    transformOrigin: "top center",
                  }}
                >
                  <iframe
                    ref={iframeRef}
                    key={previewKey}
                    src={previewUrl}
                    className="h-full w-full border-0"
                    title="PDF Preview"
                    onLoad={() => setPreviewLoading(false)}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

function deepMergeOptions(base: PdfLayoutOptions, overrides: Partial<PdfLayoutOptions>): PdfLayoutOptions {
  const result = { ...base };
  for (const key of Object.keys(overrides) as (keyof PdfLayoutOptions)[]) {
    const val = overrides[key];
    if (val === undefined) continue;
    if (typeof val === "object" && !Array.isArray(val) && val !== null) {
      (result as any)[key] = { ...(base[key] as any), ...(val as any) };
    } else {
      (result as any)[key] = val;
    }
  }
  return result;
}

// ─── Sub-components ───────────────────────────────────────────────────

function SidebarPanel({
  title,
  icon,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-line">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-panel2/30 transition-colors"
      >
        <span className="text-fg/40">{icon}</span>
        <span className="flex-1 text-xs font-medium text-fg/70">{title}</span>
        <ChevronDown className={cn("h-3 w-3 text-fg/30 transition-transform", expanded && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ClipboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="8" height="12" rx="1" />
      <path d="M6 2V1.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V2" />
      <path d="M6.5 6h3M6.5 8.5h3M6.5 11h2" />
    </svg>
  );
}
