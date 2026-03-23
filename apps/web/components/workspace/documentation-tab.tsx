"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Plus,
  Save,
  Trash2,
  FileText,
  Heading,
  BarChart3,
  Lightbulb,
  Image,
  CornerDownRight,
} from "lucide-react";
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
} from "@/lib/api";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui";
import { RichTextEditor } from "@/components/rich-text-editor";
import { FileBrowser, type FileBrowserProps } from "@/components/workspace/file-browser";
import { cn } from "@/lib/utils";

/* ─── Types ─── */

type SubTab = "knowledge" | "report" | "lead-letter" | "scratchpad";

interface DocumentationTabProps {
  workspace: ProjectWorkspaceData;
  apply: (next: WorkspaceResponse) => void;
  packages?: FileBrowserProps["packages"];
}

/* ─── Sub-tab config ─── */

const subTabs: { id: SubTab; label: string }[] = [
  { id: "knowledge", label: "Knowledge" },
  { id: "report", label: "Report" },
  { id: "lead-letter", label: "Lead Letter" },
  { id: "scratchpad", label: "Scratchpad" },
];

/* ─── Main Component ─── */

export function DocumentationTab({ workspace, apply, packages }: DocumentationTabProps) {
  const [activeTab, setActiveTab] = useState<SubTab>("knowledge");
  const [error, setError] = useState<string | null>(null);

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
          <FileBrowser workspace={workspace} packages={packages} />
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

/* ─── Section type helpers ─── */

const SECTION_TYPE_CONFIG: Record<string, { icon: typeof FileText; badgeClass: string }> = {
  content:         { icon: FileText,  badgeClass: "text-fg/40 bg-panel2 border-line" },
  heading:         { icon: Heading,   badgeClass: "text-blue-600 bg-blue-50 border-blue-200" },
  summary:         { icon: BarChart3, badgeClass: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  recommendations: { icon: Lightbulb, badgeClass: "text-amber-600 bg-amber-50 border-amber-200" },
  image:           { icon: Image,     badgeClass: "text-purple-600 bg-purple-50 border-purple-200" },
};

function SectionTypeIcon({ type }: { type: string }) {
  const config = SECTION_TYPE_CONFIG[type] ?? SECTION_TYPE_CONFIG.content;
  const Icon = config.icon;
  return <Icon className="h-3.5 w-3.5 text-fg/40 shrink-0" />;
}

function sectionTypeBadgeClass(type: string) {
  return (SECTION_TYPE_CONFIG[type] ?? SECTION_TYPE_CONFIG.content).badgeClass;
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

  // Gather report sections sorted by order
  const sections = useSortedSections(workspace);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    title: string;
    content: string;
    sectionType: string;
    parentSectionId: string | null;
  }>({ title: "", content: "", sectionType: "content", parentSectionId: null });

  const [newSection, setNewSection] = useState(false);
  const [newDraft, setNewDraft] = useState({
    title: "",
    content: "",
    sectionType: "content",
    parentSectionId: null as string | null,
  });

  function startEdit(s: ReportSection) {
    setEditingId(s.id);
    setEditDraft({ title: s.title, content: s.content, sectionType: s.sectionType, parentSectionId: s.parentSectionId });
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function saveEdit(sectionId: string) {
    startTransition(async () => {
      try {
        const next = await updateReportSection(projectId, sectionId, editDraft);
        apply(next);
        setEditingId(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update section.");
      }
    });
  }

  function addSection() {
    startTransition(async () => {
      try {
        const next = await createReportSection(projectId, {
          ...newDraft,
          order: sections.length + 1,
        });
        apply(next);
        setNewSection(false);
        setNewDraft({ title: "", content: "", sectionType: "content", parentSectionId: null });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create section.");
      }
    });
  }

  function removeSection(sectionId: string) {
    startTransition(async () => {
      try {
        apply(await deleteReportSection(projectId, sectionId));
        if (editingId === sectionId) setEditingId(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete section.");
      }
    });
  }

  function moveSection(index: number, direction: "up" | "down") {
    const newOrder = [...sections];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newOrder.length) return;
    [newOrder[index], newOrder[swapIndex]] = [newOrder[swapIndex], newOrder[index]];
    const orderedIds = newOrder.map((s) => s.id);
    startTransition(async () => {
      try {
        apply(await reorderReportSections(projectId, orderedIds));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to reorder sections.");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Report Sections</CardTitle>
        <Button size="sm" onClick={() => setNewSection(true)} disabled={newSection || pending}>
          <Plus className="h-3.5 w-3.5" /> Add Section
        </Button>
      </CardHeader>
      <CardBody className="space-y-3">
        {newSection && (
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Title</Label>
                <Input
                  value={newDraft.title}
                  onChange={(e) => setNewDraft({ ...newDraft, title: e.target.value })}
                  placeholder="Section title"
                />
              </div>
              <div>
                <Label>Section Type</Label>
                <Select
                  value={newDraft.sectionType}
                  onChange={(e) => setNewDraft({ ...newDraft, sectionType: e.target.value })}
                >
                  <option value="content">Content</option>
                  <option value="heading">Heading</option>
                  <option value="summary">Summary</option>
                  <option value="recommendations">Recommendations</option>
                  <option value="image">Image</option>
                </Select>
              </div>
            </div>
            {sections.length > 0 && (
              <div>
                <Label>Parent Section (optional)</Label>
                <Select
                  value={newDraft.parentSectionId ?? ""}
                  onChange={(e) => setNewDraft({ ...newDraft, parentSectionId: e.target.value || null })}
                >
                  <option value="">None (top level)</option>
                  {sections.filter((s) => !s.parentSectionId).map((s) => (
                    <option key={s.id} value={s.id}>{s.title || "(Untitled)"}</option>
                  ))}
                </Select>
              </div>
            )}
            <div>
              <Label>Content</Label>
              <RichTextEditor
                value={newDraft.content}
                onChange={(html) => setNewDraft({ ...newDraft, content: html })}
                placeholder="Section content..."
                minHeight="160px"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setNewSection(false);
                  setNewDraft({ title: "", content: "", sectionType: "content", parentSectionId: null });
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={addSection} disabled={pending || !newDraft.title.trim()}>
                <Save className="h-3.5 w-3.5" /> Save
              </Button>
            </div>
          </div>
        )}

        {sections.length === 0 && !newSection && (
          <EmptyState>No report sections yet. Add one to get started.</EmptyState>
        )}

        {sections.map((section, idx) => (
          <div
            key={section.id}
            className={cn(
              "rounded-lg border border-line bg-panel2/50 p-4",
              section.parentSectionId && "ml-8 border-l-2 border-l-accent/30"
            )}
          >
            {editingId === section.id ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Title</Label>
                    <Input
                      value={editDraft.title}
                      onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Section Type</Label>
                    <Select
                      value={editDraft.sectionType}
                      onChange={(e) => setEditDraft({ ...editDraft, sectionType: e.target.value })}
                    >
                      <option value="content">Content</option>
                      <option value="heading">Heading</option>
                      <option value="summary">Summary</option>
                      <option value="recommendations">Recommendations</option>
                      <option value="image">Image</option>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Parent Section</Label>
                  <Select
                    value={editDraft.parentSectionId ?? ""}
                    onChange={(e) => setEditDraft({ ...editDraft, parentSectionId: e.target.value || null })}
                  >
                    <option value="">None (top level)</option>
                    {sections.filter((s) => !s.parentSectionId && s.id !== section.id).map((s) => (
                      <option key={s.id} value={s.id}>{s.title || "(Untitled)"}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Content</Label>
                  <RichTextEditor
                    value={editDraft.content}
                    onChange={(html) => setEditDraft({ ...editDraft, content: html })}
                    placeholder="Section content..."
                    minHeight="160px"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="ghost" onClick={cancelEdit}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => saveEdit(section.id)}
                    disabled={pending}
                  >
                    <Save className="h-3.5 w-3.5" /> Save
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <div className="flex flex-col gap-1 pt-0.5">
                  <button
                    className="text-fg/30 hover:text-fg/60 disabled:opacity-30"
                    onClick={() => moveSection(idx, "up")}
                    disabled={idx === 0 || pending}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <GripVertical className="h-4 w-4 text-fg/20" />
                  <button
                    className="text-fg/30 hover:text-fg/60 disabled:opacity-30"
                    onClick={() => moveSection(idx, "down")}
                    disabled={idx === sections.length - 1 || pending}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <SectionTypeIcon type={section.sectionType} />
                    <span className="text-sm font-medium text-fg">{section.title || "(Untitled)"}</span>
                    <span className={cn(
                      "text-[11px] rounded px-1.5 py-0.5 border",
                      sectionTypeBadgeClass(section.sectionType)
                    )}>
                      {section.sectionType}
                    </span>
                    {section.parentSectionId && (
                      <CornerDownRight className="h-3 w-3 text-fg/30" />
                    )}
                  </div>
                  {section.content && (
                    <div className="text-xs text-fg/60 line-clamp-3 prose prose-xs max-w-none" dangerouslySetInnerHTML={{ __html: section.content }} />
                  )}
                </div>
                <div className="flex gap-1">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => startEdit(section)}
                    disabled={pending}
                  >
                    Edit
                  </Button>
                  <Button
                    size="xs"
                    variant="danger"
                    onClick={() => removeSection(section.id)}
                    disabled={pending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </CardBody>
    </Card>
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
  const [value, setValue] = useState(workspace.currentRevision.description);
  const projectId = workspace.project.id;
  const revisionId = workspace.currentRevision.id;

  // Sync when workspace changes externally
  useEffect(() => {
    setValue(workspace.currentRevision.description);
  }, [workspace.currentRevision.description]);

  function save() {
    startTransition(async () => {
      try {
        apply(await updateRevision(projectId, revisionId, { description: value }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save lead letter.");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Lead Letter</CardTitle>
        <Button size="sm" onClick={save} disabled={pending}>
          <Save className="h-3.5 w-3.5" /> Save
        </Button>
      </CardHeader>
      <CardBody>
        <RichTextEditor
          value={value}
          onChange={(html) => setValue(html)}
          placeholder="Enter lead letter content..."
          minHeight="280px"
        />
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
  const [value, setValue] = useState(workspace.currentRevision.notes);
  const projectId = workspace.project.id;
  const revisionId = workspace.currentRevision.id;

  useEffect(() => {
    setValue(workspace.currentRevision.notes);
  }, [workspace.currentRevision.notes]);

  function save() {
    startTransition(async () => {
      try {
        apply(await updateRevision(projectId, revisionId, { notes: value }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save scratchpad.");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Scratchpad</CardTitle>
        <Button size="sm" onClick={save} disabled={pending}>
          <Save className="h-3.5 w-3.5" /> Save
        </Button>
      </CardHeader>
      <CardBody>
        <RichTextEditor
          value={value}
          onChange={(html) => setValue(html)}
          placeholder="Estimator notes and scratch work..."
          minHeight="280px"
        />
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
