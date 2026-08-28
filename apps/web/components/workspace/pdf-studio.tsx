"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
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
  Paperclip,
  Plus,
  Save,
  Send,
  Settings2,
  Type,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  Button,
  Input,
  Label,
} from "@braedonsaunders/appkit-ui";
import {
  Select,
  Toggle,
} from "@/components/legacy-controls";
import {
  fetchQuotePdfBlob,
  getFileTree,
  getPdfPreferences,
  getQuotePdfPreviewUrl,
  listProjectDocuments,
  savePdfPreferences,
  type FileNode,
  type SourceDocument,
} from "@/lib/api";
import { loadPdfJs, type PDFDocumentLoadingTask, type PDFDocumentProxy, type RenderTask } from "@/lib/pdfjs-loader";
import { cn } from "@/lib/utils";
import {
  PDF_DOCUMENT_PROFILES,
  PDF_SECTION_KEYS,
  getPdfAttachmentSectionId,
  getPdfAttachmentSectionKey,
  insertPdfAttachmentAfterReport,
  normalizePdfDocumentType,
  pdfAttachmentIdForSource,
  type PdfDocumentType,
  type PdfFileAttachment,
  type PdfSectionKey,
} from "@bidwright/domain";

// ─── Types ────────────────────────────────────────────────────────────

export interface PdfLayoutOptions {
  sections: {
    coverPage: boolean;
    scopeOfWork: boolean;
    leadLetter: boolean;
    lineItems: boolean;
    phases: boolean;
    conditions: boolean;
    terms: boolean;
    pricingSummary: boolean;
    hoursSummary: boolean;
    labourSummary: boolean;
    notes: boolean;
    reportSections: boolean;
    schedule: boolean;
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
    showLogo: boolean;
    backgroundStyle: "minimal" | "accent" | "grid";
  };
  headerFooter: {
    showHeader: boolean;
    showFooter: boolean;
    showPageNumbers: boolean;
  };
  customerFacing: boolean;
  customSections: Array<{
    id: string;
    title: string;
    content: string;
    order: number;
  }>;
  attachments: PdfFileAttachment[];
}

type PdfTemplateType = PdfDocumentType;
type LineItemGroupBy = PdfLayoutOptions["lineItemOptions"]["groupBy"];
type CustomSection = PdfLayoutOptions["customSections"][number];

const DEFAULT_OPTIONS: PdfLayoutOptions = {
  sections: {
    coverPage: true,
    scopeOfWork: true,
    leadLetter: true,
    lineItems: false,
    phases: false,
    conditions: true,
    terms: true,
    pricingSummary: true,
    hoursSummary: false,
    labourSummary: false,
    notes: true,
    reportSections: true,
    schedule: false,
  },
  sectionOrder: [
    "coverPage", "scopeOfWork", "notes", "leadLetter", "lineItems", "phases",
    "conditions", "hoursSummary", "labourSummary", "reportSections", "pricingSummary", "schedule", "terms",
  ],
  lineItemOptions: { showCostColumn: true, showMarkupColumn: true, groupBy: "worksheet" },
  branding: { accentColor: "#3b82f6", headerBgColor: "#1a1a1a", fontFamily: "sans" },
  pageSetup: { orientation: "portrait", pageSize: "letter" },
  coverPageOptions: { showLogo: true, backgroundStyle: "accent" },
  headerFooter: { showHeader: true, showFooter: true, showPageNumbers: true },
  customerFacing: true,
  customSections: [],
  attachments: [],
};

const DEFAULT_SECTION_ORDER = [...DEFAULT_OPTIONS.sectionOrder];
const BASE_SECTION_KEYS = new Set(DEFAULT_SECTION_ORDER);
const CUSTOM_SECTION_PREFIX = "custom:";
const PDF_PREVIEW_BASE_SCALE = 96 / 72;

const SECTION_LABELS: Record<string, string> = Object.fromEntries(
  PDF_SECTION_KEYS.map((key) => [key, PDF_DOCUMENT_PROFILES.main.sections[key].label]),
);

const DOCUMENT_TYPES = Object.values(PDF_DOCUMENT_PROFILES);

function normalizeTemplateType(value: unknown): PdfTemplateType {
  return normalizePdfDocumentType(value);
}

function optionsForDocumentType(
  templateType: PdfTemplateType,
  source: PdfLayoutOptions = DEFAULT_OPTIONS,
  useProfileDefaults = false,
) {
  const profile = PDF_DOCUMENT_PROFILES[templateType];
  const next = deepMergeOptions(DEFAULT_OPTIONS, source);
  next.customerFacing = profile.customerFacing;
  for (const key of PDF_SECTION_KEYS) {
    const capability = profile.sections[key];
    if (!capability.available) next.sections[key] = false;
    else if (useProfileDefaults || capability.locked) next.sections[key] = capability.defaultEnabled;
  }
  if (profile.customerFacing) {
    next.lineItemOptions.showCostColumn = false;
    next.lineItemOptions.showMarkupColumn = false;
  }
  next.sectionOrder = normalizeSectionOrder(next.sectionOrder, next.customSections, next.attachments);
  return next;
}

function defaultDocumentLayouts(): Record<PdfTemplateType, PdfLayoutOptions> {
  return {
    main: optionsForDocumentType("main", DEFAULT_OPTIONS, true),
    backup: optionsForDocumentType("backup", DEFAULT_OPTIONS, true),
    sitecopy: optionsForDocumentType("sitecopy", DEFAULT_OPTIONS, true),
  };
}

function normalizeLineItemGroupBy(value: unknown): LineItemGroupBy {
  switch (value) {
    case "none":
    case "phase":
    case "worksheet":
      return value;
    default:
      return "worksheet";
  }
}

function getCustomSectionKey(id: string) {
  return `${CUSTOM_SECTION_PREFIX}${id}`;
}

function getCustomSectionId(sectionKey: string) {
  return sectionKey.startsWith(CUSTOM_SECTION_PREFIX)
    ? sectionKey.slice(CUSTOM_SECTION_PREFIX.length)
    : null;
}

function insertBeforePricingSummary(order: string[], key: string) {
  const pricingIndex = order.indexOf("pricingSummary");
  if (pricingIndex === -1) order.push(key);
  else order.splice(pricingIndex, 0, key);
}

function normalizeSectionOrder(
  order: string[],
  customSections: CustomSection[],
  attachments: PdfFileAttachment[] = [],
) {
  const seen = new Set<string>();
  const customIds = new Set(customSections.map((section) => section.id));
  const attachmentIds = new Set(attachments.map((attachment) => attachment.id));
  const normalized: string[] = [];

  for (const sectionKey of order) {
    if (seen.has(sectionKey)) continue;
    const customId = getCustomSectionId(sectionKey);
    if (customId) {
      if (customIds.has(customId)) {
        normalized.push(sectionKey);
        seen.add(sectionKey);
      }
      continue;
    }
    const attachmentId = getPdfAttachmentSectionId(sectionKey);
    if (attachmentId) {
      if (attachmentIds.has(attachmentId)) {
        normalized.push(sectionKey);
        seen.add(sectionKey);
      }
      continue;
    }
    if (BASE_SECTION_KEYS.has(sectionKey)) {
      normalized.push(sectionKey);
      seen.add(sectionKey);
    }
  }

  for (const sectionKey of DEFAULT_SECTION_ORDER) {
    if (seen.has(sectionKey)) continue;
    normalized.push(sectionKey);
    seen.add(sectionKey);
  }

  for (const customSection of customSections) {
    const sectionKey = getCustomSectionKey(customSection.id);
    if (seen.has(sectionKey)) continue;
    insertBeforePricingSummary(normalized, sectionKey);
    seen.add(sectionKey);
  }

  for (const attachment of attachments) {
    const sectionKey = getPdfAttachmentSectionKey(attachment.id);
    if (seen.has(sectionKey)) continue;
    insertPdfAttachmentAfterReport(normalized, sectionKey);
    seen.add(sectionKey);
  }

  return normalized;
}

function isPdfCandidate(name: string, fileType?: string | null) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return true;
  const type = (fileType ?? "").toLowerCase();
  return type === "pdf" || type.includes("application/pdf");
}

function attachmentPickerKey(attachment: PdfFileAttachment) {
  if (attachment.fileNodeId) return `file:${attachment.fileNodeId}`;
  if (attachment.documentId) return `doc:${attachment.documentId}`;
  return `id:${attachment.id}`;
}

function collectQuotePdfCandidates(fileNodes: FileNode[], documents: SourceDocument[]): PdfFileAttachment[] {
  const candidates: PdfFileAttachment[] = [];
  const seenDocuments = new Set<string>();

  for (const node of fileNodes) {
    if (node.type !== "file" || !isPdfCandidate(node.name, node.fileType)) continue;
    if (node.documentId) seenDocuments.add(node.documentId);
    candidates.push({
      id: pdfAttachmentIdForSource({ fileNodeId: node.id, documentId: node.documentId }),
      title: node.name,
      fileNodeId: node.id,
      documentId: node.documentId,
    });
  }

  for (const document of documents) {
    if (seenDocuments.has(document.id) || !isPdfCandidate(document.fileName, document.fileType)) continue;
    seenDocuments.add(document.id);
    candidates.push({
      id: pdfAttachmentIdForSource({ documentId: document.id }),
      title: document.fileName,
      documentId: document.id,
    });
  }

  return candidates.sort((left, right) => left.title.localeCompare(right.title));
}

interface PdfStudioProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
  pendingAttachment?: PdfFileAttachment | null;
  onPendingAttachmentConsumed?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────

export function PdfStudio({
  projectId,
  open,
  onClose,
  pendingAttachment,
  onPendingAttachmentConsumed,
}: PdfStudioProps) {
  const [options, setOptions] = useState<PdfLayoutOptions>(() => defaultDocumentLayouts().main);
  const [documentLayouts, setDocumentLayouts] = useState<Record<PdfTemplateType, PdfLayoutOptions>>(
    () => defaultDocumentLayouts(),
  );
  const [activeTemplate, setActiveTemplate] = useState<PdfTemplateType>("main");
  const [customSectionDrafts, setCustomSectionDrafts] = useState<Record<string, { title: string; content: string }>>({});
  const [previewKey, setPreviewKey] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadWarnings, setDownloadWarnings] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [pickerItems, setPickerItems] = useState<PdfFileAttachment[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingPrefs, setLoadingPrefs] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [expandedPanels, setExpandedPanels] = useState<Set<string>>(new Set(["documentType", "sections"]));
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [dragSectionKey, setDragSectionKey] = useState<string | null>(null);
  const [dragOverSectionKey, setDragOverSectionKey] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout>>(null);
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
          const active = normalizeTemplateType((saved as any).activeTemplate);
          const defaults = defaultDocumentLayouts();
          const savedLayouts = (saved as any).layouts;
          const layouts = savedLayouts && typeof savedLayouts === "object"
            ? {
                main: optionsForDocumentType("main", deepMergeOptions(defaults.main, savedLayouts.main ?? {})),
                backup: optionsForDocumentType("backup", deepMergeOptions(defaults.backup, savedLayouts.backup ?? {})),
                sitecopy: optionsForDocumentType("sitecopy", deepMergeOptions(defaults.sitecopy, savedLayouts.sitecopy ?? {})),
              }
            : {
                ...defaults,
                [active]: optionsForDocumentType(active, deepMergeOptions(defaults[active], saved as Partial<PdfLayoutOptions>)),
              };
          for (const layout of Object.values(layouts)) {
            layout.attachments = Array.isArray(layout.attachments) ? layout.attachments : [];
            layout.lineItemOptions.groupBy = normalizeLineItemGroupBy(layout.lineItemOptions.groupBy);
            layout.sectionOrder = normalizeSectionOrder(layout.sectionOrder, layout.customSections, layout.attachments);
          }
          const merged = layouts[active];
          setDocumentLayouts(layouts);
          setOptions(merged);
          setCustomSectionDrafts(Object.fromEntries(
            merged.customSections.map((section) => [section.id, { title: section.title, content: section.content }])
          ));
          setActiveTemplate(active);
        } else {
          const layouts = defaultDocumentLayouts();
          setDocumentLayouts(layouts);
          setOptions(layouts.main);
          setCustomSectionDrafts({});
          setActiveTemplate("main");
        }
        setDirty(false);
      })
      .catch(() => {
        const layouts = defaultDocumentLayouts();
        setDocumentLayouts(layouts);
        setOptions(layouts.main);
        setCustomSectionDrafts({});
        setActiveTemplate("main");
      })
      .finally(() => {
        setLoadingPrefs(false);
        setZoom(100);
        setPreviewLoading(true);
        setPreviewKey((k) => k + 1);
      });
  }, [open, projectId]);

  useEffect(() => {
    setCustomSectionDrafts((prev) => {
      const next: Record<string, { title: string; content: string }> = {};
      for (const section of options.customSections) {
        next[section.id] = prev[section.id] ?? { title: section.title, content: section.content };
      }
      return next;
    });
  }, [options.customSections]);

  const withCommittedCustomSectionDrafts = useCallback((source: PdfLayoutOptions) => {
    let changed = false;
    const customSections = source.customSections.map((section) => {
      const draft = customSectionDrafts[section.id];
      if (!draft) return section;
      if (draft.title === section.title && draft.content === section.content) return section;
      changed = true;
      return { ...section, title: draft.title, content: draft.content };
    });
    if (!changed) return source;
    return {
      ...source,
      customSections,
      sectionOrder: normalizeSectionOrder(source.sectionOrder, customSections, source.attachments),
    };
  }, [customSectionDrafts]);

  // Auto-save preferences debounced (2s after last change)
  useEffect(() => {
    if (!open || !dirty || loadingPrefs) return;
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(() => {
      const layouts = { ...documentLayouts, [activeTemplate]: options };
      const payload = { layouts, activeTemplate } as Record<string, unknown>;
      savePdfPreferences(projectId, payload).catch(() => {});
      setDirty(false);
    }, 2000);
    return () => { if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current); };
  }, [open, dirty, options, documentLayouts, activeTemplate, projectId, loadingPrefs]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const committedOptions = withCommittedCustomSectionDrafts(options);
      if (committedOptions !== options) {
        setOptions(committedOptions);
      }
      const layouts = { ...documentLayouts, [activeTemplate]: committedOptions };
      setDocumentLayouts(layouts);
      const payload = { layouts, activeTemplate } as Record<string, unknown>;
      await savePdfPreferences(projectId, payload);
      setDirty(false);
    } catch (e) {
      console.error("Save PDF preferences failed:", e);
    } finally {
      setSaving(false);
    }
  };

  const previewUrl = useMemo(() => {
    return getQuotePdfPreviewUrl(projectId, activeTemplate, options as unknown as Record<string, unknown>);
  }, [projectId, activeTemplate, options]);

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError(null);
    setDownloadWarnings([]);
    try {
      const committedOptions = withCommittedCustomSectionDrafts(options);
      if (committedOptions !== options) {
        setOptions(committedOptions);
      }
      // Save preferences before downloading
      const layouts = { ...documentLayouts, [activeTemplate]: committedOptions };
      setDocumentLayouts(layouts);
      const payload = { layouts, activeTemplate } as Record<string, unknown>;
      savePdfPreferences(projectId, payload).catch(() => {});

      const { url: blobUrl, warnings } = await fetchQuotePdfBlob(
        projectId,
        activeTemplate,
        committedOptions as unknown as Record<string, unknown>,
      );
      setDownloadWarnings(warnings);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `quote-${Date.now()}.pdf`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error("PDF download failed:", e);
      setDownloadError(e instanceof Error ? e.message : "PDF download failed");
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
      const order = normalizeSectionOrder([...prev.sectionOrder], prev.customSections, prev.attachments);
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
    const id = `custom-${Date.now()}`;
    const section = { id, title: "New Section", content: "", order: options.customSections.length };
    setCustomSectionDrafts((prev) => ({ ...prev, [id]: { title: section.title, content: section.content } }));
    setOptions((prev) => {
      const nextCustomSections = [
        ...prev.customSections,
        section,
      ];
      const nextSectionOrder = normalizeSectionOrder(
        [...prev.sectionOrder, getCustomSectionKey(id)],
        nextCustomSections,
        prev.attachments,
      );
      return {
        ...prev,
        customSections: nextCustomSections,
        sectionOrder: nextSectionOrder,
      };
    });
    setDirty(true);
  };

  const updateCustomSection = (id: string, field: "title" | "content", value: string) => {
    setCustomSectionDrafts((prev) => ({
      ...prev,
      [id]: {
        title: field === "title" ? value : (prev[id]?.title ?? options.customSections.find((section) => section.id === id)?.title ?? ""),
        content: field === "content" ? value : (prev[id]?.content ?? options.customSections.find((section) => section.id === id)?.content ?? ""),
      },
    }));
  };

  const commitCustomSection = (id: string) => {
    const draft = customSectionDrafts[id];
    if (!draft) return;
    setOptions((prev) => {
      const customSections = prev.customSections.map((section) => (
        section.id === id
          ? { ...section, title: draft.title, content: draft.content }
          : section
      ));
      const changed = customSections.some((section, index) =>
        section.title !== prev.customSections[index]?.title || section.content !== prev.customSections[index]?.content
      );
      if (!changed) return prev;
      return {
        ...prev,
        customSections,
        sectionOrder: normalizeSectionOrder(prev.sectionOrder, customSections, prev.attachments),
      };
    });
    const stored = options.customSections.find((section) => section.id === id);
    if (!stored || stored.title !== draft.title || stored.content !== draft.content) {
      setDirty(true);
    }
  };

  const removeCustomSection = (id: string) => {
    setCustomSectionDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setOptions((prev) => {
      const customSections = prev.customSections.filter((s) => s.id !== id);
      const sectionOrder = normalizeSectionOrder(
        prev.sectionOrder.filter((sectionKey) => sectionKey !== getCustomSectionKey(id)),
        customSections,
        prev.attachments,
      );
      return {
        ...prev,
        customSections,
        sectionOrder,
      };
    });
    setDirty(true);
  };

  const moveSectionTo = (sourceKey: string, targetKey: string) => {
    if (sourceKey === targetKey) return;
    setOptions((prev) => {
      const order = normalizeSectionOrder([...prev.sectionOrder], prev.customSections, prev.attachments);
      const sourceIndex = order.indexOf(sourceKey);
      const targetIndex = order.indexOf(targetKey);
      if (sourceIndex === -1 || targetIndex === -1) return prev;
      order.splice(sourceIndex, 1);
      order.splice(targetIndex, 0, sourceKey);
      return { ...prev, sectionOrder: order };
    });
    setDirty(true);
  };

  const addAttachment = useCallback((attachment: PdfFileAttachment) => {
    setOptions((prev) => {
      if (prev.attachments.some((existing) => existing.id === attachment.id)) {
        return {
          ...prev,
          sectionOrder: normalizeSectionOrder(
            [...prev.sectionOrder, getPdfAttachmentSectionKey(attachment.id)],
            prev.customSections,
            prev.attachments,
          ),
        };
      }
      const attachments = [...prev.attachments, attachment];
      return {
        ...prev,
        attachments,
        sectionOrder: normalizeSectionOrder(
          [...prev.sectionOrder, getPdfAttachmentSectionKey(attachment.id)],
          prev.customSections,
          attachments,
        ),
      };
    });
    setDirty(true);
  }, []);

  const removeAttachment = (id: string) => {
    setOptions((prev) => {
      const attachments = prev.attachments.filter((attachment) => attachment.id !== id);
      return {
        ...prev,
        attachments,
        sectionOrder: normalizeSectionOrder(
          prev.sectionOrder.filter((sectionKey) => sectionKey !== getPdfAttachmentSectionKey(id)),
          prev.customSections,
          attachments,
        ),
      };
    });
    setDirty(true);
  };

  const loadPickerItems = useCallback(async () => {
    setPickerLoading(true);
    setPickerError(null);
    try {
      const [fileNodes, documents] = await Promise.all([
        getFileTree(projectId),
        listProjectDocuments(projectId),
      ]);
      setPickerItems(collectQuotePdfCandidates(fileNodes, documents));
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : "Could not load Files");
      setPickerItems([]);
    } finally {
      setPickerLoading(false);
    }
  }, [projectId]);

  const togglePicker = () => {
    const next = !pickerOpen;
    setPickerOpen(next);
    if (next) void loadPickerItems();
  };

  useEffect(() => {
    if (!open || loadingPrefs || !pendingAttachment) return;
    addAttachment(pendingAttachment);
    onPendingAttachmentConsumed?.();
  }, [open, loadingPrefs, pendingAttachment, addAttachment, onPendingAttachmentConsumed]);

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

  const applyTemplate = (templateId: PdfTemplateType) => {
    const layouts = { ...documentLayouts, [activeTemplate]: options };
    const next = optionsForDocumentType(templateId, layouts[templateId]);
    setDocumentLayouts(layouts);
    setActiveTemplate(templateId);
    setOptions(next);
    setCustomSectionDrafts(Object.fromEntries(
      next.customSections.map((section) => [section.id, { title: section.title, content: section.content }]),
    ));
    setDirty(true);
  };

  const activeProfile = PDF_DOCUMENT_PROFILES[activeTemplate];
  const attachmentsById = new Map(options.attachments.map((attachment) => [attachment.id, attachment] as const));
  const attachedPickerKeys = new Set(options.attachments.map(attachmentPickerKey));
  const orderedSectionKeys = normalizeSectionOrder(options.sectionOrder, options.customSections, options.attachments)
    .filter((key) => {
      if (getPdfAttachmentSectionId(key)) return true;
      const customId = getCustomSectionId(key);
      return customId ? true : activeProfile.sections[key as PdfSectionKey]?.available;
    });
  const customSectionsById = new Map(options.customSections.map((section) => [section.id, section] as const));

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
                    {/* Document type picker */}
                    <SidebarPanel
                      title="Document Type"
                      icon={<FileText className="h-3.5 w-3.5" />}
                      expanded={expandedPanels.has("documentType")}
                      onToggle={() => togglePanel("documentType")}
                    >
                      <div className="grid grid-cols-3 gap-1.5">
                        {DOCUMENT_TYPES.map((t) => (
                          <button
                            key={t.id}
                            onClick={() => applyTemplate(t.id)}
                            title={t.description}
                            className={cn(
                              "rounded-lg border px-1.5 py-2 text-center transition-all",
                              activeTemplate === t.id
                                ? "border-accent bg-accent/5 ring-1 ring-accent/20"
                                : "border-line hover:border-fg/20 hover:bg-panel2/50"
                            )}
                          >
                            <div className="text-[11px] font-medium leading-snug">{t.label}</div>
                          </button>
                        ))}
                      </div>
                      <div className="mt-2 text-[10px] leading-snug text-fg/40">
                        {DOCUMENT_TYPES.find((t) => t.id === activeTemplate)?.description}
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
                            onValueChange={(v) => updatePageSetup("pageSize", v as "letter" | "a4" | "legal")}
                            options={[
                              { value: "letter", label: "Letter (8.5 x 11)" },
                              { value: "a4", label: "A4 (210 x 297mm)" },
                              { value: "legal", label: "Legal (8.5 x 14)" },
                            ]}
                          />
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
                        {orderedSectionKeys.map((key, idx) => {
                          const customSectionId = getCustomSectionId(key);
                          const customSection = customSectionId ? customSectionsById.get(customSectionId) : null;
                          const attachmentId = getPdfAttachmentSectionId(key);
                          const attachment = attachmentId ? attachmentsById.get(attachmentId) : null;
                          const draft = customSectionId ? customSectionDrafts[customSectionId] : null;
                          const capability = customSectionId || attachment ? null : activeProfile.sections[key as PdfSectionKey];
                          const label = attachment
                            ? attachment.title
                            : customSection
                              ? (draft?.title || customSection.title || "Custom Section")
                              : capability?.label ?? SECTION_LABELS[key];
                          if (!label) return null;
                          const enabled = customSection || attachment ? true : options.sections[key as keyof typeof options.sections];
                          const hasSubOptions = key === "lineItems" || key === "coverPage";
                          const isExpanded = expandedSections.has(key);
                          const isCustomSection = !!customSection;
                          const isAttachment = !!attachment;
                          const isDragOver = dragOverSectionKey === key && dragSectionKey !== key;

                          return (
                            <div
                              key={key}
                              className={cn(
                                "group rounded-md transition-all",
                                isDragOver && "ring-2 ring-accent/20"
                              )}
                              draggable
                              onDragStart={(e) => {
                                setDragSectionKey(key);
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData("text/plain", key);
                              }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                if (dragSectionKey && dragSectionKey !== key) {
                                  setDragOverSectionKey(key);
                                }
                              }}
                              onDragLeave={() => {
                                if (dragOverSectionKey === key) setDragOverSectionKey(null);
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                const sourceKey = e.dataTransfer.getData("text/plain") || dragSectionKey;
                                if (sourceKey) moveSectionTo(sourceKey, key);
                                setDragSectionKey(null);
                                setDragOverSectionKey(null);
                              }}
                              onDragEnd={() => {
                                setDragSectionKey(null);
                                setDragOverSectionKey(null);
                              }}
                            >
                              <div className={cn(
                                "flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors",
                                enabled ? "bg-transparent" : "opacity-50",
                                dragSectionKey === key && "opacity-50"
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
                                    disabled={idx === orderedSectionKeys.length - 1}
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

                                {isAttachment && <Paperclip className="h-3 w-3 text-fg/35" />}
                                <span className="flex-1 text-xs text-fg/70">{label}</span>
                                {capability?.locked && capability.reason && (
                                  <span className="max-w-[115px] text-right text-[9px] leading-tight text-fg/35" title={capability.reason}>
                                    Required
                                  </span>
                                )}
                                {isAttachment ? (
                                  <button
                                    type="button"
                                    onClick={() => removeAttachment(attachment.id)}
                                    className="text-fg/30 hover:text-danger transition-colors"
                                    title="Remove from quote PDF"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                ) : isCustomSection ? (
                                  <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-accent">
                                    Drag
                                  </span>
                                ) : (
                                  <Toggle
                                    checked={enabled}
                                    disabled={capability?.locked}
                                    onChange={(v) => updateSections(key, v)}
                                  />
                                )}
                              </div>

                              {/* Sub-options */}
                              {hasSubOptions && isExpanded && enabled && (
                                <div className="ml-8 mb-2 space-y-2 border-l-2 border-line pl-3 pt-1">
                                  {key === "lineItems" && (
                                    <>
                                      {!options.customerFacing && (
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
                                        </>
                                      )}
                                      <div>
                                        <span className="text-[11px] text-fg/50">Group By</span>
                                        <Select
                                          className="mt-1 h-7 text-xs"
                                          size="xs"
                                          value={options.lineItemOptions.groupBy}
                                          onValueChange={(v) => updateLineItemOptions("groupBy", v as "none" | "phase" | "worksheet")}
                                          options={[
                                            { value: "worksheet", label: "Separate Tables by Worksheet" },
                                            { value: "none", label: "Combined Table" },
                                            { value: "phase", label: "Separate Tables by Phase" },
                                          ]}
                                        />
                                      </div>
                                    </>
                                  )}
                                  {key === "coverPage" && (
                                    <>
                                      <div className="flex items-center justify-between">
                                        <span className="text-[11px] text-fg/50">Show Organization Logo</span>
                                        <Toggle
                                          checked={options.coverPageOptions.showLogo}
                                          onChange={(v) => updateCoverPage("showLogo", v)}
                                        />
                                      </div>
                                      <div>
                                        <Label className="text-[10px] text-fg/40">Cover Background</Label>
                                        <Select
                                          className="mt-1 h-7 text-xs"
                                          size="xs"
                                          value={options.coverPageOptions.backgroundStyle}
                                          onValueChange={(v) => updateCoverPage("backgroundStyle", v as PdfLayoutOptions["coverPageOptions"]["backgroundStyle"])}
                                          options={[
                                            { value: "minimal", label: "Minimal" },
                                            { value: "accent", label: "Accent Wash" },
                                            { value: "grid", label: "Grid Texture" },
                                          ]}
                                        />
                                      </div>
                                      <div className="text-[10px] text-fg/40">
                                        Organization branding is pulled automatically from settings.
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
                              <div className="mb-1 text-[10px] text-fg/35">
                                Drag this section in the list above to place it anywhere in the PDF.
                              </div>
                              <div className="flex items-center gap-2 mb-1.5">
                                <Input
                                  className="h-6 flex-1 text-xs"
                                  value={customSectionDrafts[cs.id]?.title ?? cs.title}
                                  onChange={(e) => updateCustomSection(cs.id, "title", e.target.value)}
                                  onBlur={() => commitCustomSection(cs.id)}
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
                                value={customSectionDrafts[cs.id]?.content ?? cs.content}
                                onChange={(e) => updateCustomSection(cs.id, "content", e.target.value)}
                                onBlur={() => commitCustomSection(cs.id)}
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
                      <button
                        onClick={togglePicker}
                        className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line px-3 py-2 text-xs text-fg/40 hover:border-fg/30 hover:text-fg/60 transition-colors"
                      >
                        <Paperclip className="h-3 w-3" /> Add from Files
                      </button>
                      {pickerOpen && (
                        <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-line">
                          {pickerLoading ? (
                            <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-fg/40">
                              <Loader2 className="h-3 w-3 animate-spin" /> Loading PDFs...
                            </div>
                          ) : pickerError ? (
                            <div className="px-3 py-2 text-[11px] text-danger">{pickerError}</div>
                          ) : pickerItems.length === 0 ? (
                            <div className="px-3 py-2 text-[11px] text-fg/40">No PDFs found in Files.</div>
                          ) : (
                            pickerItems.map((item) => {
                              const alreadyAdded = attachedPickerKeys.has(attachmentPickerKey(item));
                              return (
                                <button
                                  key={attachmentPickerKey(item)}
                                  type="button"
                                  disabled={alreadyAdded}
                                  onClick={() => addAttachment(item)}
                                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-fg/70 hover:bg-panel2 disabled:opacity-40"
                                >
                                  <Paperclip className="h-3 w-3 shrink-0 text-fg/30" />
                                  <span className="flex-1 truncate">{item.title}</span>
                                  {alreadyAdded && <span className="text-[10px] text-fg/35">Added</span>}
                                </button>
                              );
                            })
                          )}
                        </div>
                      )}
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
                          <div className="rounded-md border border-line px-3 py-2 text-[10px] text-fg/40">
                            Header uses the organization name and quote number automatically.
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-fg/60">Show Footer</span>
                          <Toggle checked={options.headerFooter.showFooter} onChange={(v) => updateHeaderFooter("showFooter", v)} />
                        </div>
                        {options.headerFooter.showFooter && (
                          <div className="rounded-md border border-line px-3 py-2 text-[10px] text-fg/40">
                            Footer uses the organization website and issue date automatically.
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
                        variant="default"
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
                    {downloadError && (
                      <div className="text-center text-[10px] text-danger">{downloadError}</div>
                    )}
                    {downloadWarnings.length > 0 && (
                      <div className="rounded-md border border-amber-400/40 bg-amber-50 px-2 py-1.5 text-[10px] leading-snug text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-300">
                        {downloadWarnings.join(" ")}
                      </div>
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

              {/* Warning when not customer-facing */}
              {!options.customerFacing && (
                <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-amber-400/50 bg-amber-50 px-3 py-2 dark:border-amber-500/30 dark:bg-amber-950/30">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span className="text-xs font-medium text-amber-800 dark:text-amber-300">
                    Internal mode — cost, markup, margin & profit are visible. Do not share with customers.
                  </span>
                </div>
              )}

              {/* Preview pages */}
              <div className="flex-1 overflow-auto p-6">
                <PdfPagePreview
                  url={previewUrl}
                  refreshKey={previewKey}
                  zoom={zoom}
                  onLoadingChange={setPreviewLoading}
                />
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

export interface PdfPagePreviewProps {
  url: string;
  refreshKey: number;
  zoom: number;
  onLoadingChange: (loading: boolean) => void;
}

export function PdfPagePreview({ url, refreshKey, zoom, onLoadingChange }: PdfPagePreviewProps) {
  const [pageNumbers, setPageNumbers] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>());
  const renderTasksRef = useRef(new Map<number, RenderTask>());

  const cancelRenderTasks = useCallback(() => {
    for (const task of renderTasksRef.current.values()) {
      task.cancel();
    }
    renderTasksRef.current.clear();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    async function loadPdf() {
      try {
        setError(null);
        setPageNumbers([]);
        onLoadingChange(true);
        cancelRenderTasks();

        if (pdfDocRef.current) {
          pdfDocRef.current.destroy();
          pdfDocRef.current = null;
        }

        const pdfjs = await loadPdfJs();
        if (cancelled) return;

        loadingTask = pdfjs.getDocument({ url, withCredentials: true });
        const doc = await loadingTask.promise;
        if (cancelled) {
          doc.destroy();
          return;
        }

        pdfDocRef.current = doc;
        setPageNumbers(Array.from({ length: doc.numPages }, (_, index) => index + 1));
        onLoadingChange(false);
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Failed to load PDF preview";
          setError(message.includes("Invalid PDF")
            ? "Preview could not load a PDF response."
            : message);
          onLoadingChange(false);
        }
      }
    }

    loadPdf();

    return () => {
      cancelled = true;
      loadingTask?.destroy();
      cancelRenderTasks();
    };
  }, [cancelRenderTasks, onLoadingChange, refreshKey, url]);

  useEffect(() => {
    const doc = pdfDocRef.current;
    if (!doc || pageNumbers.length === 0) return;
    const activeDoc = doc;

    let cancelled = false;
    cancelRenderTasks();

    async function renderPages() {
      for (const pageNumber of pageNumbers) {
        if (cancelled) return;
        const canvas = canvasRefs.current.get(pageNumber);
        if (!canvas) continue;

        try {
          const page = await activeDoc.getPage(pageNumber);
          if (cancelled) return;

          const viewport = page.getViewport({ scale: PDF_PREVIEW_BASE_SCALE * (zoom / 100) });
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;

          const renderTask = page.render({ canvas, viewport });
          renderTasksRef.current.set(pageNumber, renderTask);
          await renderTask.promise;
          renderTasksRef.current.delete(pageNumber);
        } catch (err) {
          if (err instanceof Error && err.message.includes("Rendering cancelled")) continue;
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Failed to render PDF preview");
          }
        }
      }
    }

    renderPages();

    return () => {
      cancelled = true;
      cancelRenderTasks();
    };
  }, [cancelRenderTasks, pageNumbers, zoom]);

  if (error) {
    return (
      <div className="mx-auto flex min-h-[18rem] max-w-md items-center justify-center rounded-lg border border-line bg-panel px-6 text-center text-xs text-fg/50">
        {error}
      </div>
    );
  }

  if (pageNumbers.length === 0) {
    return (
      <div className="flex min-h-[18rem] items-center justify-center text-xs text-fg/35">
        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
        Loading preview...
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-max flex-col items-center gap-6 pb-10">
      {pageNumbers.map((pageNumber) => (
        <div
          key={pageNumber}
          className="overflow-hidden rounded-[2px] bg-white shadow-lg ring-1 ring-black/10"
        >
          <canvas
            ref={(canvas) => {
              if (canvas) canvasRefs.current.set(pageNumber, canvas);
              else canvasRefs.current.delete(pageNumber);
            }}
          />
        </div>
      ))}
    </div>
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeOptionBranch(base: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const [key, val] of Object.entries(overrides ?? {})) {
    if (!(key in base) || val === undefined) continue;
    const baseValue = base[key];
    if (isPlainObject(baseValue) && isPlainObject(val)) {
      result[key] = mergeOptionBranch(baseValue, val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

function deepMergeOptions(base: PdfLayoutOptions, overrides: Partial<PdfLayoutOptions>): PdfLayoutOptions {
  return mergeOptionBranch(
    base as unknown as Record<string, unknown>,
    (overrides ?? {}) as Record<string, unknown>,
  ) as unknown as PdfLayoutOptions;
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
