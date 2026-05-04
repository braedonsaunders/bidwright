"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  GripVertical,
  Plus,
  Save,
  Trash2,
  FileText,
  BarChart3,
  Lightbulb,
  Image as ImageIcon,
  Copy,
  Upload,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type {
  ProjectWorkspaceData,
  ReportSection,
  WorkspaceResponse,
} from "@/lib/api";
import {
  createReportSection,
  deleteReportSection,
  reorderReportSections,
  updateReportSection,
  updateRevision,
  uploadFile,
  getFileDownloadUrl,
} from "@/lib/api";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Label,
} from "@/components/ui";
import { RichTextEditor } from "@/components/rich-text-editor";
import { FileBrowser, type FileBrowserProps } from "@/components/workspace/file-browser";
import { ScheduleTab } from "@/components/workspace/schedule-tab";
import { cn } from "@/lib/utils";

/* ─── Types ─── */

type SubTab = "knowledge" | "schedule" | "report" | "lead-letter" | "scratchpad";

interface DocumentationTabProps {
  workspace: ProjectWorkspaceData;
  apply: (next: WorkspaceResponse) => void;
  packages?: FileBrowserProps["packages"];
  highlightDocumentId?: string;
  selectedWorksheet?: FileBrowserProps["selectedWorksheet"];
  modelEditorChannelName?: string;
}

/* ─── Sub-tab config ─── */

const subTabs: { id: SubTab; label: string }[] = [
  { id: "knowledge", label: "Files" },
  { id: "schedule", label: "Schedule" },
  { id: "report", label: "Report" },
  { id: "lead-letter", label: "Lead Letter" },
  { id: "scratchpad", label: "Scratchpad" },
];

/* ─── Main Component ─── */

export function DocumentationTab({
  workspace,
  apply,
  packages,
  highlightDocumentId,
  selectedWorksheet,
  modelEditorChannelName,
}: DocumentationTabProps) {
  const [activeTab, setActiveTab] = useState<SubTab>("knowledge");
  const [error, setError] = useState<string | null>(null);

  // Scroll to highlighted document from global search
  useEffect(() => {
    if (!highlightDocumentId) return;
    setActiveTab("knowledge");
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-document-id="${highlightDocumentId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-accent/50");
        setTimeout(() => el.classList.remove("ring-2", "ring-accent/50"), 2500);
      }
    });
  }, [highlightDocumentId]);

  return (
    <div className="flex flex-col h-full min-h-0 gap-3 pb-1">
      {/* Sub-tab bar */}
      <div className="flex items-center gap-1 shrink-0">
        {subTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => { setActiveTab(t.id); setError(null); }}
            className={cn(
              "px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap",
              activeTab === t.id
                ? "bg-panel2 text-fg"
                : "text-fg/40 hover:text-fg/60"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger shrink-0">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        {activeTab === "knowledge" && (
          <FileBrowser
            workspace={workspace}
            packages={packages}
            selectedWorksheet={selectedWorksheet}
            modelEditorChannelName={modelEditorChannelName}
          />
        )}
        {activeTab === "schedule" && (
          <ScheduleTab workspace={workspace} apply={apply} />
        )}
        {activeTab === "report" && (
          <ReportTab workspace={workspace} apply={apply} setError={setError} />
        )}
        {activeTab === "lead-letter" && (
          <LeadLetterTab workspace={workspace} apply={apply} setError={setError} />
        )}
        {activeTab === "scratchpad" && (
          <ScratchpadTab workspace={workspace} apply={apply} setError={setError} />
        )}
      </div>
    </div>
  );
}

/* ─── Section type config ─── */

const SECTION_TYPES = [
  { type: "content",         label: "Content",         icon: FileText,   badgeClass: "text-blue-600 bg-blue-50 border-blue-200",    btnClass: "border-blue-300 text-blue-600 hover:bg-blue-50",    defaultTitle: "New Section" },
  { type: "image",           label: "Image",           icon: ImageIcon,  badgeClass: "text-purple-600 bg-purple-50 border-purple-200", btnClass: "border-purple-300 text-purple-600 hover:bg-purple-50", defaultTitle: "Image Section" },
  { type: "summary",         label: "Summary",         icon: BarChart3,  badgeClass: "text-emerald-600 bg-emerald-50 border-emerald-200", btnClass: "border-emerald-300 text-emerald-600 hover:bg-emerald-50", defaultTitle: "Inspection Summary" },
  { type: "recommendations", label: "Recommendations", icon: Lightbulb,  badgeClass: "text-amber-600 bg-amber-50 border-amber-200", btnClass: "border-amber-300 text-amber-600 hover:bg-amber-50", defaultTitle: "Recommendations" },
] as const;

function getSectionConfig(type: string) {
  return SECTION_TYPES.find((t) => t.type === type) ?? SECTION_TYPES[0];
}

/* ─── Image content helpers ─── */

interface ImageContent {
  documentId?: string;
  fileNodeId?: string;
  caption?: string;
}

function parseImageContent(content: string): ImageContent {
  try { return JSON.parse(content); } catch { return { caption: content }; }
}

function serializeImageContent(data: ImageContent): string {
  return JSON.stringify(data);
}

/* ─── Report Tab ─── */

function ReportTab({
  workspace,
  apply,
  setError,
}: {
  workspace: ProjectWorkspaceData;
  apply: (next: WorkspaceResponse) => void;
  setError: (e: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const projectId = workspace.project.id;
  const sections = useSortedSections(workspace);

  // Track which section was just created so we can auto-focus its title
  const [focusSectionId, setFocusSectionId] = useState<string | null>(null);

  // Drag-and-drop state
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  /* ── Auto-save helper ── */
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const debouncedUpdate = useCallback(
    (sectionId: string, patch: Partial<ReportSection>) => {
      const key = sectionId;
      const existing = saveTimers.current.get(key);
      if (existing) clearTimeout(existing);
      saveTimers.current.set(
        key,
        setTimeout(() => {
          saveTimers.current.delete(key);
          startTransition(async () => {
            try {
              apply(await updateReportSection(projectId, sectionId, patch));
            } catch (e) {
              setError(e instanceof Error ? e.message : "Failed to save.");
            }
          });
        }, 1200)
      );
    },
    [projectId, apply, setError]
  );

  // Flush pending saves on blur (immediate save)
  const flushUpdate = useCallback(
    (sectionId: string, patch: Partial<ReportSection>) => {
      const existing = saveTimers.current.get(sectionId);
      if (existing) clearTimeout(existing);
      saveTimers.current.delete(sectionId);
      startTransition(async () => {
        try {
          apply(await updateReportSection(projectId, sectionId, patch));
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to save.");
        }
      });
    },
    [projectId, apply, setError]
  );

  /* ── Add section ── */
  function addSection(type: string, parentSectionId?: string | null) {
    const config = getSectionConfig(type);
    startTransition(async () => {
      try {
        const next = await createReportSection(projectId, {
          sectionType: type,
          title: config.defaultTitle,
          content: "",
          order: sections.length + 1,
          parentSectionId: parentSectionId ?? null,
        });
        apply(next);
        // Find the newly created section to focus it
        // The new section will be in next.reportSections or we re-fetch
        setFocusSectionId("__latest__");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create section.");
      }
    });
  }

  /* ── Duplicate section ── */
  function duplicateSection(section: ReportSection) {
    startTransition(async () => {
      try {
        const next = await createReportSection(projectId, {
          sectionType: section.sectionType,
          title: (section.title || "Section") + " (Copy)",
          content: section.content,
          order: section.order + 1,
          parentSectionId: section.parentSectionId,
        });
        apply(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to duplicate section.");
      }
    });
  }

  /* ── Delete section ── */
  function removeSection(sectionId: string) {
    if (!confirm("Delete this section?")) return;
    startTransition(async () => {
      try {
        apply(await deleteReportSection(projectId, sectionId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete section.");
      }
    });
  }

  /* ── Image upload ── */
  function handleImageUpload(sectionId: string, file: File) {
    startTransition(async () => {
      try {
        const fileNode = await uploadFile(projectId, file);
        const existing = sections.find((s) => s.id === sectionId);
        const prev = existing ? parseImageContent(existing.content) : {};
        const content = serializeImageContent({ ...prev, fileNodeId: fileNode.id });
        apply(await updateReportSection(projectId, sectionId, { content }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to upload image.");
      }
    });
  }

  /* ── Drag-and-drop ── */
  function handleDragStart(e: React.DragEvent, sectionId: string) {
    setDragId(sectionId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", sectionId);
  }

  function handleDragOver(e: React.DragEvent, sectionId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (sectionId !== dragId) setDragOverId(sectionId);
  }

  function handleDragLeave() {
    setDragOverId(null);
  }

  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    setDragOverId(null);
    setDragId(null);
    const sourceId = e.dataTransfer.getData("text/plain");
    if (!sourceId || sourceId === targetId) return;

    const ids = sections.map((s) => s.id);
    const fromIdx = ids.indexOf(sourceId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    const reordered = [...ids];
    reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, sourceId);

    startTransition(async () => {
      try {
        apply(await reorderReportSections(projectId, reordered));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to reorder.");
      }
    });
  }

  function handleDragEnd() {
    setDragId(null);
    setDragOverId(null);
  }

  /* ── Add-section buttons ── */
  const addButtons = (
    <div className="flex flex-wrap gap-2">
      {SECTION_TYPES.map(({ type, label, icon: Icon, btnClass }) => (
        <button
          key={type}
          onClick={() => addSection(type)}
          disabled={pending}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40",
            btnClass
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          Add {label}
        </button>
      ))}
    </div>
  );

  /* ── Render ── */
  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg">Report Sections</h3>
      </div>

      {/* Empty state */}
      {sections.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-line bg-panel2/30 py-12 flex flex-col items-center gap-3">
          <FileText className="h-10 w-10 text-fg/20" />
          <div className="text-center">
            <p className="text-sm font-medium text-fg/60">Start Building Your Report</p>
            <p className="text-xs text-fg/40 mt-0.5">Add sections below to create a comprehensive report</p>
          </div>
          <div className="mt-2">{addButtons}</div>
        </div>
      )}

      {/* Sections */}
      {sections.map((section) => (
        <ReportSectionItem
          key={section.id}
          section={section}
          projectId={projectId}
          pending={pending}
          focusSectionId={focusSectionId}
          setFocusSectionId={setFocusSectionId}
          debouncedUpdate={debouncedUpdate}
          flushUpdate={flushUpdate}
          onAddSubSection={(type) => addSection(type, section.id)}
          onDuplicate={() => duplicateSection(section)}
          onDelete={() => removeSection(section.id)}
          onImageUpload={(file) => handleImageUpload(section.id, file)}
          isDragging={dragId === section.id}
          isDragOver={dragOverId === section.id}
          onDragStart={(e) => handleDragStart(e, section.id)}
          onDragOver={(e) => handleDragOver(e, section.id)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, section.id)}
          onDragEnd={handleDragEnd}
        />
      ))}

      {/* Add section buttons at bottom */}
      {sections.length > 0 && addButtons}
    </div>
  );
}

/* ─── Section Item ─── */

interface ReportSectionItemProps {
  section: ReportSection;
  projectId: string;
  pending: boolean;
  focusSectionId: string | null;
  setFocusSectionId: (id: string | null) => void;
  debouncedUpdate: (id: string, patch: Partial<ReportSection>) => void;
  flushUpdate: (id: string, patch: Partial<ReportSection>) => void;
  onAddSubSection: (type: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onImageUpload: (file: File) => void;
  isDragging: boolean;
  isDragOver: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

function ReportSectionItem({
  section,
  projectId,
  pending,
  focusSectionId,
  setFocusSectionId,
  debouncedUpdate,
  flushUpdate,
  onAddSubSection,
  onDuplicate,
  onDelete,
  onImageUpload,
  isDragging,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: ReportSectionItemProps) {
  const config = getSectionConfig(section.sectionType);
  const Icon = config.icon;
  const titleRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Local state for title & content so edits feel instant
  const [title, setTitle] = useState(section.title);
  const [content, setContent] = useState(section.content);

  // Sync from server when section data changes externally
  useEffect(() => { setTitle(section.title); }, [section.title]);
  useEffect(() => { setContent(section.content); }, [section.content]);

  // Auto-focus newly created section title
  useEffect(() => {
    if (focusSectionId === "__latest__" && titleRef.current) {
      // Focus the last section created - rely on parent rendering order
      // A small delay ensures DOM is ready
      const timer = setTimeout(() => {
        titleRef.current?.focus();
        titleRef.current?.select();
        setFocusSectionId(null);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [focusSectionId, setFocusSectionId]);

  const isImage = section.sectionType === "image";
  const imageData = isImage ? parseImageContent(content) : null;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={cn(
        "group rounded-lg border bg-panel2/50 transition-all",
        section.parentSectionId && "ml-8 border-l-2 border-l-accent/30",
        isDragging && "opacity-50 rotate-[0.5deg] shadow-lg",
        isDragOver && "border-accent ring-2 ring-accent/20",
        !isDragging && !isDragOver && "border-line hover:border-fg/20 hover:shadow-sm"
      )}
    >
      {/* Section header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-panel2/60 rounded-t-lg cursor-move border-b border-line/50">
        <GripVertical className="h-3.5 w-3.5 text-fg/20 shrink-0" />
        <span className={cn(
          "flex items-center justify-center h-5 w-5 rounded shrink-0",
          config.badgeClass, "border"
        )}>
          <Icon className="h-3 w-3" />
        </span>
        <span className={cn(
          "text-[10px] font-medium rounded px-1.5 py-0.5 border uppercase tracking-wider",
          config.badgeClass
        )}>
          {config.label}
        </span>
        <div className="flex-1" />

        {/* Hover-reveal controls */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Add sub-section dropdown */}
          {!section.parentSectionId && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  className="h-6 w-6 flex items-center justify-center rounded text-fg/30 hover:text-fg/60 hover:bg-panel2 transition-colors"
                  title="Add sub-section"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="z-[100] min-w-[160px] rounded-lg border border-line bg-panel p-1 shadow-xl"
                  sideOffset={4}
                  align="end"
                >
                  <DropdownMenu.Item
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-fg/70 outline-none cursor-pointer hover:bg-panel2 transition-colors"
                    onSelect={() => onAddSubSection("content")}
                  >
                    <FileText className="h-3.5 w-3.5 text-blue-500" />
                    Content
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-fg/70 outline-none cursor-pointer hover:bg-panel2 transition-colors"
                    onSelect={() => onAddSubSection("image")}
                  >
                    <ImageIcon className="h-3.5 w-3.5 text-purple-500" />
                    Image
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
          {/* Duplicate */}
          <button
            onClick={onDuplicate}
            disabled={pending}
            className="h-6 w-6 flex items-center justify-center rounded text-fg/30 hover:text-fg/60 hover:bg-panel2 transition-colors disabled:opacity-30"
            title="Duplicate"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          {/* Delete */}
          <button
            onClick={onDelete}
            disabled={pending}
            className="h-6 w-6 flex items-center justify-center rounded text-fg/30 hover:text-danger hover:bg-danger/10 transition-colors disabled:opacity-30"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Section body */}
      <div className="px-4 py-3 space-y-2">
        {/* Inline title */}
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            debouncedUpdate(section.id, { title: e.target.value });
          }}
          onBlur={() => {
            if (title !== section.title) flushUpdate(section.id, { title });
          }}
          placeholder="Section title..."
          className="w-full bg-transparent border-none outline-none text-sm font-semibold text-fg placeholder:text-fg/30 px-0 py-1 focus:bg-panel focus:border focus:border-line focus:rounded-md focus:px-2 transition-all"
        />

        {/* Content area — varies by type */}
        {isImage ? (
          <div className="space-y-2">
            {/* Image upload area */}
            {imageData?.fileNodeId ? (
              <div
                className="relative rounded-lg border-2 border-emerald-300 bg-emerald-50/30 overflow-hidden cursor-pointer group/img"
                onClick={() => fileInputRef.current?.click()}
              >
                <img
                  src={getFileDownloadUrl(projectId, imageData.fileNodeId, true)}
                  alt={title}
                  className="max-h-[200px] w-auto object-contain mx-auto"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="text-white text-xs font-medium">Click to replace</span>
                </div>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-[150px] rounded-lg border-2 border-dashed border-line hover:border-purple-400 hover:bg-purple-50/30 transition-colors flex flex-col items-center justify-center gap-2 cursor-pointer"
              >
                <Upload className="h-6 w-6 text-fg/30" />
                <span className="text-xs text-fg/40">Click to upload image</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImageUpload(file);
                e.target.value = "";
              }}
            />
            {/* Caption */}
            <textarea
              value={imageData?.caption ?? ""}
              onChange={(e) => {
                const newContent = serializeImageContent({ ...imageData, caption: e.target.value });
                setContent(newContent);
                debouncedUpdate(section.id, { content: newContent });
              }}
              onBlur={(e) => {
                const newContent = serializeImageContent({ ...imageData, caption: e.target.value });
                if (newContent !== section.content) flushUpdate(section.id, { content: newContent });
              }}
              onInput={(e) => {
                const t = e.target as HTMLTextAreaElement;
                t.style.height = "auto";
                t.style.height = t.scrollHeight + "px";
              }}
              placeholder="Image caption (optional)..."
              className="w-full bg-transparent border-none outline-none text-xs text-fg/60 placeholder:text-fg/30 px-0 py-1 resize-none overflow-hidden min-h-[28px] focus:bg-panel focus:border focus:border-line focus:rounded-md focus:px-2 transition-all"
              rows={1}
            />
          </div>
        ) : (
          <RichTextEditor
            value={content}
            onChange={(html) => {
              setContent(html);
              debouncedUpdate(section.id, { content: html });
            }}
            placeholder="Section content..."
            minHeight="80px"
          />
        )}
      </div>
    </div>
  );
}

/* ─── Lead Letter Tab ─── */

function LeadLetterTab({
  workspace,
  apply,
  setError,
}: {
  workspace: ProjectWorkspaceData;
  apply: (next: WorkspaceResponse) => void;
  setError: (e: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(workspace.currentRevision.leadLetter);
  const projectId = workspace.project.id;
  const revisionId = workspace.currentRevision.id;

  // Sync when workspace changes externally
  useEffect(() => {
    setValue(workspace.currentRevision.leadLetter);
  }, [workspace.currentRevision.leadLetter]);

  function save() {
    startTransition(async () => {
      try {
        apply(await updateRevision(projectId, revisionId, { leadLetter: value }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save lead letter.");
      }
    });
  }

  return (
    <Card className="flex flex-col flex-1 min-h-0">
      <CardHeader className="flex flex-row items-center justify-between shrink-0">
        <CardTitle>Lead Letter</CardTitle>
        <Button size="sm" onClick={save} disabled={pending}>
          <Save className="h-3.5 w-3.5" /> Save
        </Button>
      </CardHeader>
      <CardBody className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 flex flex-col min-h-[200px]">
          <RichTextEditor
            value={value}
            onChange={(html) => setValue(html)}
            placeholder="Enter lead letter content..."
            className="flex-1 flex flex-col"
            minHeight="100%"
          />
        </div>
      </CardBody>
    </Card>
  );
}

/* ─── Scratchpad Tab ─── */

function ScratchpadTab({
  workspace,
  apply,
  setError,
}: {
  workspace: ProjectWorkspaceData;
  apply: (next: WorkspaceResponse) => void;
  setError: (e: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(workspace.currentRevision.scratchpad);
  const projectId = workspace.project.id;
  const revisionId = workspace.currentRevision.id;

  useEffect(() => {
    setValue(workspace.currentRevision.scratchpad);
  }, [workspace.currentRevision.scratchpad]);

  function save() {
    startTransition(async () => {
      try {
        apply(await updateRevision(projectId, revisionId, { scratchpad: value }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save scratchpad.");
      }
    });
  }

  return (
    <Card className="flex flex-col flex-1 min-h-0">
      <CardHeader className="flex flex-row items-center justify-between shrink-0">
        <CardTitle>Scratchpad</CardTitle>
        <Button size="sm" onClick={save} disabled={pending}>
          <Save className="h-3.5 w-3.5" /> Save
        </Button>
      </CardHeader>
      <CardBody className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 flex flex-col min-h-[200px]">
          <RichTextEditor
            value={value}
            onChange={(html) => setValue(html)}
            placeholder="Estimator notes and scratch work..."
            className="flex-1 flex flex-col"
            minHeight="100%"
          />
        </div>
      </CardBody>
    </Card>
  );
}

/* ─── Hooks ─── */

function useSortedSections(workspace: ProjectWorkspaceData): ReportSection[] {
  // Report sections are not on the workspace data directly;
  // we fetch them on mount and after mutations via the workspace response.
  const [sections, setSections] = useState<ReportSection[]>([]);
  const [loaded, setLoaded] = useState(false);
  const projectId = workspace.project.id;

  useEffect(() => {
    let cancelled = false;
    import("@/lib/api").then(({ getReportSections }) =>
      getReportSections(projectId).then((data) => {
        if (!cancelled) {
          setSections(data.sort((a, b) => a.order - b.order));
          setLoaded(true);
        }
      })
    ).catch(() => {
      // Sections may not exist yet — that's fine
      if (!cancelled) setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [projectId]);

  // When workspace is refreshed via apply, re-fetch sections
  const revUpdatedAt = workspace.currentRevision.updatedAt;
  const prevRef = useRef(revUpdatedAt);
  useEffect(() => {
    if (prevRef.current === revUpdatedAt) return;
    prevRef.current = revUpdatedAt;
    import("@/lib/api").then(({ getReportSections }) =>
      getReportSections(projectId).then((data) => {
        setSections(data.sort((a, b) => a.order - b.order));
      })
    ).catch(() => {});
  }, [revUpdatedAt, projectId]);

  return sections;
}
