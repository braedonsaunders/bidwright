"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Plus,
  Save,
  Trash2,
  X,
  BookOpen,
} from "lucide-react";
import type {
  ConditionLibraryEntry,
  ProjectCondition,
  ProjectWorkspaceData,
  ReportSection,
  WorkspaceResponse,
} from "@/lib/api";
import {
  createCondition,
  createReportSection,
  deleteCondition,
  deleteReportSection,
  getConditionLibrary,
  reorderConditions,
  reorderReportSections,
  updateCondition,
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
import { cn } from "@/lib/utils";

/* ─── Types ─── */

type SubTab = "report" | "lead-letter" | "scratchpad" | "conditions";

interface DocumentationTabProps {
  workspace: ProjectWorkspaceData;
  apply: (next: WorkspaceResponse) => void;
}

/* ─── Sub-tab config ─── */

const subTabs: { id: SubTab; label: string }[] = [
  { id: "report", label: "Report" },
  { id: "lead-letter", label: "Lead Letter" },
  { id: "scratchpad", label: "Scratchpad" },
  { id: "conditions", label: "Conditions" },
];

/* ─── Main Component ─── */

export function DocumentationTab({ workspace, apply }: DocumentationTabProps) {
  const [activeTab, setActiveTab] = useState<SubTab>("report");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex gap-1 border-b border-line">
        {subTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => { setActiveTab(t.id); setError(null); }}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
              activeTab === t.id
                ? "border-accent text-fg"
                : "border-transparent text-fg/50 hover:text-fg/70"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
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
      {activeTab === "conditions" && (
        <ConditionsTab workspace={workspace} apply={apply} setError={setError} />
      )}
    </div>
  );
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
  }>({ title: "", content: "", sectionType: "content" });

  const [newSection, setNewSection] = useState(false);
  const [newDraft, setNewDraft] = useState({
    title: "",
    content: "",
    sectionType: "content",
  });

  function startEdit(s: ReportSection) {
    setEditingId(s.id);
    setEditDraft({ title: s.title, content: s.content, sectionType: s.sectionType });
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
        setNewDraft({ title: "", content: "", sectionType: "content" });
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
                  <option value="document">Document</option>
                </Select>
              </div>
            </div>
            <div>
              <Label>Content</Label>
              <Textarea
                value={newDraft.content}
                onChange={(e) => setNewDraft({ ...newDraft, content: e.target.value })}
                placeholder="Section content..."
                rows={4}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setNewSection(false);
                  setNewDraft({ title: "", content: "", sectionType: "content" });
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
            className="rounded-lg border border-line bg-panel2/50 p-4"
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
                      <option value="document">Document</option>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Content</Label>
                  <Textarea
                    value={editDraft.content}
                    onChange={(e) => setEditDraft({ ...editDraft, content: e.target.value })}
                    rows={4}
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
                    <span className="text-sm font-medium text-fg">{section.title || "(Untitled)"}</span>
                    <span className="text-[11px] text-fg/40 bg-panel2 border border-line rounded px-1.5 py-0.5">
                      {section.sectionType}
                    </span>
                  </div>
                  {section.content && (
                    <p className="text-xs text-fg/60 line-clamp-3 whitespace-pre-wrap">
                      {section.content}
                    </p>
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

/* ─── Conditions Tab ─── */

function ConditionsTab({
  workspace,
  apply,
  setError,
}: {
  workspace: ProjectWorkspaceData;
  apply: (next: WorkspaceResponse) => void;
  setError: (e: string | null) => void;
}) {
  const projectId = workspace.project.id;
  const inclusions = (workspace.conditions ?? [])
    .filter((c) => c.type === "inclusion")
    .sort((a, b) => a.order - b.order);
  const exclusions = (workspace.conditions ?? [])
    .filter((c) => c.type === "exclusion")
    .sort((a, b) => a.order - b.order);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ConditionColumn
        title="Inclusions"
        type="inclusion"
        conditions={inclusions}
        projectId={projectId}
        apply={apply}
        setError={setError}
      />
      <ConditionColumn
        title="Exclusions"
        type="exclusion"
        conditions={exclusions}
        projectId={projectId}
        apply={apply}
        setError={setError}
      />
    </div>
  );
}

function ConditionColumn({
  title,
  type,
  conditions,
  projectId,
  apply,
  setError,
}: {
  title: string;
  type: string;
  conditions: ProjectCondition[];
  projectId: string;
  apply: (next: WorkspaceResponse) => void;
  setError: (e: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [newValue, setNewValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [library, setLibrary] = useState<ConditionLibraryEntry[] | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);

  function loadLibrary() {
    if (library !== null) {
      setShowLibrary(!showLibrary);
      return;
    }
    getConditionLibrary()
      .then((entries) => {
        setLibrary(entries);
        setShowLibrary(true);
      })
      .catch(() => setError("Failed to load condition library."));
  }

  function addCondition() {
    if (!newValue.trim()) return;
    startTransition(async () => {
      try {
        apply(
          await createCondition(projectId, {
            type,
            value: newValue.trim(),
            order: conditions.length + 1,
          })
        );
        setNewValue("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to add condition.");
      }
    });
  }

  function importFromLibrary(entry: ConditionLibraryEntry) {
    startTransition(async () => {
      try {
        apply(
          await createCondition(projectId, {
            type,
            value: entry.value,
            order: conditions.length + 1,
          })
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to import condition.");
      }
    });
  }

  function startEdit(c: ProjectCondition) {
    setEditingId(c.id);
    setEditValue(c.value);
  }

  function saveEdit(conditionId: string) {
    startTransition(async () => {
      try {
        apply(await updateCondition(projectId, conditionId, { value: editValue }));
        setEditingId(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update condition.");
      }
    });
  }

  function removeCondition(conditionId: string) {
    startTransition(async () => {
      try {
        apply(await deleteCondition(projectId, conditionId));
        if (editingId === conditionId) setEditingId(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete condition.");
      }
    });
  }

  function moveCondition(index: number, direction: "up" | "down") {
    const newOrder = [...conditions];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newOrder.length) return;
    [newOrder[index], newOrder[swapIndex]] = [newOrder[swapIndex], newOrder[index]];
    const orderedIds = newOrder.map((c) => c.id);
    startTransition(async () => {
      try {
        apply(await reorderConditions(projectId, orderedIds));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to reorder conditions.");
      }
    });
  }

  const filteredLibrary = library?.filter((entry) => entry.type === type) ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <Button size="xs" variant="ghost" onClick={loadLibrary} disabled={pending}>
          <BookOpen className="h-3.5 w-3.5" /> Library
        </Button>
      </CardHeader>
      <CardBody className="space-y-3">
        {/* Add new */}
        <div className="flex gap-2">
          <Input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder={`Add ${type}...`}
            onKeyDown={(e) => {
              if (e.key === "Enter") addCondition();
            }}
            className="flex-1"
          />
          <Button
            size="sm"
            onClick={addCondition}
            disabled={pending || !newValue.trim()}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Library dropdown */}
        {showLibrary && (
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2 max-h-48 overflow-y-auto">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-fg/60">Condition Library</span>
              <button
                onClick={() => setShowLibrary(false)}
                className="text-fg/40 hover:text-fg/60"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {filteredLibrary.length === 0 ? (
              <p className="text-xs text-fg/40">No library entries for this type.</p>
            ) : (
              filteredLibrary.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="text-fg/70 truncate flex-1">{entry.value}</span>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => importFromLibrary(entry)}
                    disabled={pending}
                  >
                    <Plus className="h-3 w-3" /> Add
                  </Button>
                </div>
              ))
            )}
          </div>
        )}

        {/* Condition list */}
        {conditions.length === 0 && (
          <EmptyState>No {type}s yet.</EmptyState>
        )}

        {conditions.map((cond, idx) => (
          <div
            key={cond.id}
            className="flex items-center gap-2 rounded-lg border border-line bg-panel2/50 px-3 py-2"
          >
            <div className="flex flex-col gap-0.5">
              <button
                className="text-fg/30 hover:text-fg/60 disabled:opacity-30"
                onClick={() => moveCondition(idx, "up")}
                disabled={idx === 0 || pending}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                className="text-fg/30 hover:text-fg/60 disabled:opacity-30"
                onClick={() => moveCondition(idx, "down")}
                disabled={idx === conditions.length - 1 || pending}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>

            {editingId === cond.id ? (
              <div className="flex-1 flex gap-2">
                <Input
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdit(cond.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="flex-1"
                  autoFocus
                />
                <Button
                  size="xs"
                  onClick={() => saveEdit(cond.id)}
                  disabled={pending}
                >
                  <Save className="h-3 w-3" />
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setEditingId(null)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <>
                <span
                  className="flex-1 text-sm text-fg/80 cursor-pointer hover:text-fg"
                  onClick={() => startEdit(cond)}
                >
                  {cond.value}
                </span>
                <Button
                  size="xs"
                  variant="danger"
                  onClick={() => removeCondition(cond.id)}
                  disabled={pending}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </>
            )}
          </div>
        ))}
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
