"use client";

import { useEffect, useState, useTransition, useRef, useCallback } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Calculator,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Plus,
  Save,
  SaveAll,
  Trash2,
  X,
} from "lucide-react";
import type {
  ConditionLibraryEntry,
  ProjectCondition,
  ProjectWorkspaceData,
  QuotePatchInput,
  RateSchedule,
  RateScheduleItem,
  RateScheduleTier,
  RevisionPatchInput,
  WorkspaceResponse,
} from "@/lib/api";
import {
  autoCalculateProjectRateSchedule,
  createCondition,
  createConditionLibraryEntry,
  createCustomer,
  deleteCondition,
  deleteConditionLibraryEntry,
  deleteProjectRateSchedule,
  getConditionLibrary,
  getCustomers,
  getCustomer,
  getDepartments,
  importRateSchedule,
  listRateSchedules,
  reorderConditions,
  updateCondition,
  updateProjectRateScheduleItem,
  updateQuote,
  updateRevision,
} from "@/lib/api";
import type { Customer, CustomerContact, Department } from "@/lib/api";
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
  Separator,
  Textarea,
  Toggle,
} from "@/components/ui";
import { RichTextEditor } from "@/components/rich-text-editor";
import { cn } from "@/lib/utils";
import * as RadixSelect from "@radix-ui/react-select";
import { useAuth } from "@/components/auth-provider";
import type { AuthUser } from "@/lib/api";
import { listUsers } from "@/lib/api";

/* ─── Types ─── */

type SetupSubTab = "general" | "conditions" | "notes" | "rates" | "other" | "settings";

type RevisionDraft = {
  title: string;
  description: string;
  notes: string;
  breakoutStyle: string;
};

export interface SetupTabProps {
  workspace: ProjectWorkspaceData;
  revDraft: RevisionDraft;
  setRevDraft: React.Dispatch<React.SetStateAction<RevisionDraft>>;
  isPending: boolean;
  onApply: (next: WorkspaceResponse) => void;
  onError: (msg: string) => void;
  highlightField?: string;
}

/* ─── Constants ─── */

const subTabs: Array<{ id: SetupSubTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "conditions", label: "Conditions" },
  { id: "notes", label: "Notes" },
  { id: "rates", label: "Rates" },
  { id: "other", label: "Other" },
  { id: "settings", label: "Settings" },
];

/* ─── Helpers ─── */

function parseNum(value: string, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toDateInput(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function fromDateInput(value: string): string | null {
  return value || null;
}

function useDebouncedSave(saveFn: () => void, delay = 800) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestFn = useRef(saveFn);
  latestFn.current = saveFn;

  const trigger = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => latestFn.current(), delay);
  }, [delay]);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      latestFn.current();
    }
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { trigger, flush };
}

/* ─── Main Component ─── */

export function SetupTab({
  workspace,
  revDraft,
  setRevDraft,
  isPending: parentPending,
  onApply,
  onError,
  highlightField,
}: SetupTabProps) {
  const [subTab, setSubTab] = useState<SetupSubTab>("general");
  const [isPending, startTransition] = useTransition();
  const busy = parentPending || isPending;

  // Track which revDraft fields the user has actively edited in this session.
  // saveRevision only sends dirty fields to avoid overwriting agent updates.
  const dirtyFieldsRef = useRef<Set<string>>(new Set());
  const markDirty = useCallback((field: string) => { dirtyFieldsRef.current.add(field); }, []);

  // Clear dirty flags when workspace data refreshes from the server
  const prevRevKey = useRef("");
  useEffect(() => {
    const key = workspace.currentRevision.id + String(workspace.currentRevision.description?.length ?? 0);
    if (key !== prevRevKey.current) {
      dirtyFieldsRef.current.clear();
      prevRevKey.current = key;
    }
  }, [workspace.currentRevision]);

  // Scroll to highlighted field from global search
  useEffect(() => {
    if (!highlightField) return;
    // Switch to the correct sub-tab based on field
    const notesFields = ["notes", "scratchpad", "leadLetter", "followUpNote"];
    const conditionFields = ["inclusions", "exclusions", "conditions"];
    if (conditionFields.includes(highlightField)) setSubTab("conditions");
    else if (notesFields.includes(highlightField)) setSubTab("notes");
    else setSubTab("general");

    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-field="${highlightField}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-accent/50");
        setTimeout(() => el.classList.remove("ring-2", "ring-accent/50"), 2500);
      }
    });
  }, [highlightField]);

  function saveRevision(patch?: Partial<RevisionPatchInput>) {
    // Build payload from only locally-dirty fields + explicit patch to avoid
    // overwriting concurrent agent updates with stale local state
    const dirty = dirtyFieldsRef.current;
    const payload: Partial<RevisionPatchInput> = {};
    if (dirty.has("title")) payload.title = revDraft.title;
    if (dirty.has("description")) payload.description = revDraft.description;
    if (dirty.has("notes")) payload.notes = revDraft.notes;
    if (dirty.has("breakoutStyle")) payload.breakoutStyle = revDraft.breakoutStyle;
    Object.assign(payload, patch);

    // Nothing to save
    if (Object.keys(payload).length === 0) return;

    startTransition(async () => {
      try {
        onApply(await updateRevision(workspace.project.id, workspace.currentRevision.id, payload as RevisionPatchInput));
        // Clear dirty flags for saved fields
        for (const key of Object.keys(payload)) dirty.delete(key);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Save failed.");
      }
    });
  }

  function saveQuote(patch: QuotePatchInput) {
    startTransition(async () => {
      try {
        onApply(await updateQuote(workspace.project.id, patch));
      } catch (e) {
        onError(e instanceof Error ? e.message : "Save failed.");
      }
    });
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      {/* Sub-tab navigation */}
      <div className="flex items-center gap-1 shrink-0">
        {subTabs.map((t) => {
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={cn(
                "px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap",
                active
                  ? "bg-panel2 text-fg"
                  : "text-fg/40 hover:text-fg/60"
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {subTab === "general" && (
          <GeneralSubTab
            workspace={workspace}
            revDraft={revDraft}
            setRevDraft={setRevDraft}
            saveRevision={saveRevision}
            saveQuote={saveQuote}
            busy={busy}
            markDirty={markDirty}
          />
        )}
        {subTab === "conditions" && (
          <ConditionsSubTab
            workspace={workspace}
            onApply={onApply}
            onError={onError}
            busy={busy}
          />
        )}
        {subTab === "notes" && (
          <NotesSubTab
            workspace={workspace}
            revDraft={revDraft}
            setRevDraft={setRevDraft}
            saveRevision={saveRevision}
            busy={busy}
            markDirty={markDirty}
          />
        )}
        {subTab === "rates" && (
          <RatesSubTab
            workspace={workspace}
            onApply={onApply}
            onError={onError}
            busy={busy}
          />
        )}
        {subTab === "other" && (
          <OtherSubTab
            workspace={workspace}
            saveRevision={saveRevision}
            saveQuote={saveQuote}
            busy={busy}
          />
        )}
        {subTab === "settings" && (
          <SettingsSubTab
            workspace={workspace}
            revDraft={revDraft}
            setRevDraft={setRevDraft}
            saveRevision={saveRevision}
            busy={busy}
            markDirty={markDirty}
          />
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   General Sub-Tab
   ═══════════════════════════════════════════════════════════════════════════ */

function GeneralSubTab({
  workspace,
  revDraft,
  setRevDraft,
  saveRevision,
  saveQuote,
  busy,
  markDirty,
}: {
  workspace: ProjectWorkspaceData;
  revDraft: RevisionDraft;
  setRevDraft: React.Dispatch<React.SetStateAction<RevisionDraft>>;
  saveRevision: (patch?: Partial<RevisionPatchInput>) => void;
  saveQuote: (patch: QuotePatchInput) => void;
  busy: boolean;
  markDirty: (field: string) => void;
}) {
  const rev = workspace.currentRevision;
  const quote = workspace.quote;

  const [customerId, setCustomerId] = useState(quote.customerId ?? "");
  const [customerContactId, setCustomerContactId] = useState(quote.customerContactId ?? "");
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddName, setQuickAddName] = useState("");
  const [quickAddSaving, setQuickAddSaving] = useState(false);
  const [departmentId, setDepartmentId] = useState(quote.departmentId ?? "");
  const [quoteType, setQuoteType] = useState<"Firm" | "Budget" | "BudgetDNE">(rev.type ?? "Firm");
  const [dateQuote, setDateQuote] = useState(toDateInput(rev.dateQuote));
  const [dateDue, setDateDue] = useState(toDateInput(rev.dateDue));

  // Loaded dropdown options
  const [customerOptions, setCustomerOptions] = useState<Customer[]>([]);
  const [contactOptions, setContactOptions] = useState<CustomerContact[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<Department[]>([]);

  // Load customers and departments on mount
  useEffect(() => {
    getCustomers().then(setCustomerOptions).catch(() => {});
    getDepartments().then(setDepartmentOptions).catch(() => {});
  }, []);

  // Load contacts when customer selection changes
  useEffect(() => {
    if (customerId) {
      getCustomer(customerId).then((c) => {
        setContactOptions(c.contacts);
      }).catch(() => setContactOptions([]));
    } else {
      setContactOptions([]);
    }
  }, [customerId]);

  // Refs for latest state values used by auto-save
  const stateRef = useRef({ customerId, customerContactId, departmentId, quoteType, dateQuote, dateDue });
  stateRef.current = { customerId, customerContactId, departmentId, quoteType, dateQuote, dateDue };
  const optionsRef = useRef({ customerOptions, contactOptions });
  optionsRef.current = { customerOptions, contactOptions };

  const doSave = useCallback(() => {
    const s = stateRef.current;
    const o = optionsRef.current;
    const selectedCustomer = o.customerOptions.find((c) => c.id === s.customerId);
    const selectedContact = o.contactOptions.find((c) => c.id === s.customerContactId);

    saveQuote({
      customerExistingNew: "Existing",
      customerId: s.customerId || null,
      customerString: selectedCustomer?.name ?? "",
      customerContactId: s.customerContactId || null,
      customerContactString: selectedContact?.name ?? "",
      customerContactEmailString: selectedContact?.email ?? "",
      departmentId: s.departmentId || null,
    });
    saveRevision({
      type: s.quoteType,
      dateQuote: fromDateInput(s.dateQuote),
      dateDue: fromDateInput(s.dateDue),
    });
  }, [saveQuote, saveRevision]);

  const { trigger: debouncedSave } = useDebouncedSave(doSave);

  async function handleQuickAdd() {
    if (!quickAddName.trim()) return;
    setQuickAddSaving(true);
    try {
      const created = await createCustomer({ name: quickAddName.trim(), active: true });
      setCustomerOptions((prev) => [...prev, created]);
      setCustomerId(created.id);
      setQuickAddName("");
      setQuickAddOpen(false);
      setTimeout(() => doSave(), 0);
    } catch {
      /* ignore */
    } finally {
      setQuickAddSaving(false);
    }
  }

  // Auto-save on select/date changes
  function onSelectChange(setter: (v: string) => void, value: string) {
    setter(value);
    // Use setTimeout to let state update before saving
    setTimeout(() => doSave(), 0);
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
      <Card className="flex flex-col">
        <CardHeader className="shrink-0">
          <CardTitle>Quote Details</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          {/* Title with quote number */}
          <div data-field="title">
            <Label>Quote Title</Label>
            <div className="flex items-center gap-2">
              <span className="flex h-9 shrink-0 items-center rounded-lg border border-line bg-panel2 px-3 text-sm text-fg/60">
                {quote.quoteNumber}
              </span>
              <Input
                value={revDraft.title}
                onChange={(e) => { markDirty("title"); setRevDraft((d) => ({ ...d, title: e.target.value })); }}
                onBlur={() => saveRevision()}
                placeholder="Quote title"
              />
            </div>
          </div>

          {/* Client */}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Client</Label>
              {quickAddOpen ? (
                <div className="flex gap-1.5">
                  <Input
                    placeholder="New client name"
                    value={quickAddName}
                    onChange={(e) => setQuickAddName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleQuickAdd())}
                    autoFocus
                  />
                  <Button type="button" size="xs" variant="accent" onClick={handleQuickAdd} disabled={quickAddSaving || !quickAddName.trim()}>
                    {quickAddSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  </Button>
                  <Button type="button" size="xs" variant="secondary" onClick={() => { setQuickAddOpen(false); setQuickAddName(""); }}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <Select
                    value={customerId}
                    onChange={(e) => {
                      setCustomerId(e.target.value);
                      setCustomerContactId("");
                      setTimeout(() => doSave(), 0);
                    }}
                    className="flex-1"
                  >
                    <option value="">Select client...</option>
                    {customerOptions.filter((c) => c.active).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}{c.shortName ? ` (${c.shortName})` : ""}</option>
                    ))}
                  </Select>
                  <Button type="button" size="xs" variant="secondary" onClick={() => setQuickAddOpen(true)} title="Add new client">
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
            <div>
              <Label>Contact</Label>
              <Select
                value={customerContactId}
                onChange={(e) => {
                  setCustomerContactId(e.target.value);
                  setTimeout(() => doSave(), 0);
                }}
                disabled={!customerId}
              >
                <option value="">Select contact...</option>
                {contactOptions.filter((c) => c.active).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.email ? ` (${c.email})` : ""}</option>
                ))}
              </Select>
              {!customerId && <p className="mt-1 text-[11px] text-fg/40">Select a client first</p>}
            </div>
          </div>

          {/* Department / Type */}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Department</Label>
              <Select
                value={departmentId}
                onChange={(e) => {
                  setDepartmentId(e.target.value);
                  setTimeout(() => doSave(), 0);
                }}
              >
                <option value="">— Select a department —</option>
                {departmentOptions.filter((d) => d.active).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}{d.code ? ` (${d.code})` : ""}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Type</Label>
              <Select
                value={quoteType}
                onChange={(e) => {
                  setQuoteType(e.target.value as "Firm" | "Budget" | "BudgetDNE");
                  setTimeout(() => doSave(), 0);
                }}
              >
                <option value="Firm">Firm</option>
                <option value="Budget">Budget</option>
                <option value="BudgetDNE">Budget DNE</option>
              </Select>
            </div>
          </div>

          {/* Dates */}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Quote Date</Label>
              <Input
                type="date"
                value={dateQuote}
                onChange={(e) => {
                  setDateQuote(e.target.value);
                  setTimeout(() => doSave(), 0);
                }}
              />
            </div>
            <div>
              <Label>Due Date</Label>
              <Input
                type="date"
                value={dateDue}
                onChange={(e) => {
                  setDateDue(e.target.value);
                  setTimeout(() => doSave(), 0);
                }}
              />
            </div>
          </div>

          {/* Description — fills remaining space */}
          <div data-field="description" className="flex-1 min-h-[120px] flex flex-col">
            <Label className="shrink-0">Description / Scope of Work</Label>
            <div onBlur={() => saveRevision()} onInput={() => markDirty("description")} className="flex-1 flex flex-col mt-1.5">
              <RichTextEditor
                value={revDraft.description}
                onChange={(html) => setRevDraft((d) => ({ ...d, description: html }))}
                placeholder="Scope of work description..."
                className="flex-1 flex flex-col"
                minHeight="100%"
              />
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Inclusions & Exclusions Sub-Tab
   ═══════════════════════════════════════════════════════════════════════════ */

function ConditionsSubTab({
  workspace,
  onApply,
  onError,
  busy,
}: {
  workspace: ProjectWorkspaceData;
  onApply: (next: WorkspaceResponse) => void;
  onError: (msg: string) => void;
  busy: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const loading = busy || isPending;

  const [library, setLibrary] = useState<ConditionLibraryEntry[]>([]);
  useEffect(() => {
    getConditionLibrary().then(setLibrary).catch(() => {});
  }, []);

  const inclusions = [...(workspace.conditions ?? []).filter((c) => c.type === "inclusion")].sort(
    (a, b) => a.order - b.order
  );
  const exclusions = [...(workspace.conditions ?? []).filter((c) => c.type === "exclusion")].sort(
    (a, b) => a.order - b.order
  );
  const clarifications = [...(workspace.conditions ?? []).filter((c) => c.type === "clarification")].sort(
    (a, b) => a.order - b.order
  );

  const inclusionLibrary = library.filter((l) => l.type === "inclusion" || l.type === "Inclusion");
  const exclusionLibrary = library.filter((l) => l.type === "exclusion" || l.type === "Exclusion");
  const clarificationLibrary = library.filter((l) => l.type === "clarification" || l.type === "Clarification");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
      <ConditionList
        title="Inclusions"
        type="inclusion"
        conditions={inclusions}
        allConditions={workspace.conditions ?? []}
        projectId={workspace.project.id}
        libraryEntries={inclusionLibrary}
        onApply={onApply}
        onError={onError}
        loading={loading}
        onLibraryChange={() => getConditionLibrary().then(setLibrary).catch(() => {})}
      />
      <ConditionList
        title="Exclusions"
        type="exclusion"
        conditions={exclusions}
        allConditions={workspace.conditions ?? []}
        projectId={workspace.project.id}
        libraryEntries={exclusionLibrary}
        onApply={onApply}
        onError={onError}
        loading={loading}
        onLibraryChange={() => getConditionLibrary().then(setLibrary).catch(() => {})}
      />
      <ConditionList
        title="Clarifications"
        type="clarification"
        conditions={clarifications}
        allConditions={workspace.conditions ?? []}
        projectId={workspace.project.id}
        libraryEntries={clarificationLibrary}
        onApply={onApply}
        onError={onError}
        loading={loading}
        onLibraryChange={() => getConditionLibrary().then(setLibrary).catch(() => {})}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Notes Sub-Tab
   ═══════════════════════════════════════════════════════════════════════════ */

function NotesSubTab({
  workspace,
  revDraft,
  setRevDraft,
  saveRevision,
  busy,
  markDirty,
}: {
  workspace: ProjectWorkspaceData;
  revDraft: RevisionDraft;
  setRevDraft: React.Dispatch<React.SetStateAction<RevisionDraft>>;
  saveRevision: () => void;
  busy: boolean;
  markDirty: (field: string) => void;
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Card data-field="notes" className="flex flex-col flex-1 min-h-0">
        <CardHeader className="shrink-0">
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardBody className="flex-1 min-h-0 flex flex-col">
          <div onBlur={saveRevision} onInput={() => markDirty("notes")} className="flex-1 flex flex-col min-h-[200px]">
            <RichTextEditor
              value={revDraft.notes}
              onChange={(html) => setRevDraft((d) => ({ ...d, notes: html }))}
              placeholder="General notes..."
              className="flex-1 flex flex-col"
              minHeight="100%"
            />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/* ─── Condition List ─── */

function ConditionList({
  title,
  type,
  conditions,
  allConditions,
  projectId,
  libraryEntries,
  onApply,
  onError,
  loading,
  onLibraryChange,
}: {
  title: string;
  type: string;
  conditions: ProjectCondition[];
  allConditions: ProjectCondition[];
  projectId: string;
  libraryEntries: ConditionLibraryEntry[];
  onApply: (next: WorkspaceResponse) => void;
  onError: (msg: string) => void;
  loading: boolean;
  onLibraryChange?: () => void;
}) {
  const [newValue, setNewValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showLibrary, setShowLibrary] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = loading || isPending;

  function addCondition(value?: string) {
    const text = (value ?? newValue).trim();
    if (!text) return;
    startTransition(async () => {
      try {
        const next = await createCondition(projectId, {
          type,
          value: text,
          order: conditions.length + 1,
        });
        onApply(next);
        setNewValue("");
      } catch (e) {
        onError(e instanceof Error ? e.message : "Add failed.");
      }
    });
  }

  function removeCondition(id: string) {
    startTransition(async () => {
      try {
        onApply(await deleteCondition(projectId, id));
      } catch (e) {
        onError(e instanceof Error ? e.message : "Delete failed.");
      }
    });
  }

  function saveEdit(id: string) {
    if (!editValue.trim()) return;
    startTransition(async () => {
      try {
        onApply(await updateCondition(projectId, id, { value: editValue.trim() }));
        setEditingId(null);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Update failed.");
      }
    });
  }

  function moveCondition(index: number, direction: "up" | "down") {
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= conditions.length) return;
    const reordered = [...conditions];
    [reordered[index], reordered[swapIndex]] = [reordered[swapIndex], reordered[index]];
    const otherConditions = allConditions.filter((c) => c.type !== type);
    const orderedIds = [
      ...otherConditions.map((c) => c.id),
      ...reordered.map((c) => c.id),
    ];
    startTransition(async () => {
      try {
        onApply(await reorderConditions(projectId, orderedIds));
      } catch (e) {
        onError(e instanceof Error ? e.message : "Reorder failed.");
      }
    });
  }

  function saveToLibrary(value: string) {
    startTransition(async () => {
      try {
        await createConditionLibraryEntry({ type, value });
        onLibraryChange?.();
      } catch (e) {
        onError(e instanceof Error ? e.message : "Failed to save to library.");
      }
    });
  }

  function removeFromLibrary(entryId: string) {
    startTransition(async () => {
      try {
        await deleteConditionLibraryEntry(entryId);
        onLibraryChange?.();
      } catch (e) {
        onError(e instanceof Error ? e.message : "Failed to remove from library.");
      }
    });
  }

  return (
    <Card className="flex flex-col h-full min-h-0">
      <CardHeader className="flex items-center justify-between shrink-0">
        <CardTitle>{title}</CardTitle>
        <Button size="xs" variant="ghost" onClick={() => setShowLibrary(!showLibrary)} disabled={busy}>
          <BookOpen className="h-3.5 w-3.5" /> Library
        </Button>
      </CardHeader>
      <CardBody className="space-y-3 flex-1 min-h-0 overflow-y-auto">
        {/* Library panel */}
        {showLibrary && (
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2 max-h-48 overflow-y-auto">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-fg/60">Condition Library — {title}</span>
              <button onClick={() => setShowLibrary(false)} className="text-fg/40 hover:text-fg/60">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {libraryEntries.length === 0 ? (
              <p className="text-xs text-fg/40">No library entries. Save conditions to build your reusable library.</p>
            ) : (
              libraryEntries.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-fg/70 truncate flex-1">{entry.value}</span>
                  <div className="flex gap-1 shrink-0">
                    <Button size="xs" variant="ghost" onClick={() => addCondition(entry.value)} disabled={busy}>
                      <Plus className="h-3 w-3" /> Use
                    </Button>
                    <Button size="xs" variant="danger" onClick={() => removeFromLibrary(entry.id)} disabled={busy}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Condition list */}
        {conditions.length === 0 && !showLibrary ? (
          <EmptyState>No {title.toLowerCase()} added</EmptyState>
        ) : conditions.length > 0 ? (
          <div className="space-y-1">
            {conditions.map((c, idx) => (
              <div
                key={c.id}
                className="group flex items-center gap-2 rounded-lg border border-line bg-bg/30 px-3 py-2 text-sm"
              >
                {editingId === c.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <Input
                      className="flex-1"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit(c.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      autoFocus
                    />
                    <Button size="xs" onClick={() => saveEdit(c.id)} disabled={busy}>
                      <Save className="h-3 w-3" />
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <>
                    <span
                      className="flex-1 cursor-pointer"
                      onDoubleClick={() => {
                        setEditingId(c.id);
                        setEditValue(c.value);
                      }}
                    >
                      {c.value}
                    </span>
                    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        className="rounded p-1 text-fg/30 hover:bg-panel2 hover:text-accent disabled:opacity-30"
                        onClick={() => saveToLibrary(c.value)}
                        disabled={busy}
                        title="Save to library"
                      >
                        <SaveAll className="h-3 w-3" />
                      </button>
                      <button
                        className="rounded p-1 text-fg/30 hover:bg-panel2 hover:text-fg/60 disabled:opacity-30"
                        onClick={() => moveCondition(idx, "up")}
                        disabled={idx === 0 || busy}
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        className="rounded p-1 text-fg/30 hover:bg-panel2 hover:text-fg/60 disabled:opacity-30"
                        onClick={() => moveCondition(idx, "down")}
                        disabled={idx === conditions.length - 1 || busy}
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                      <button
                        className="rounded p-1 text-fg/30 hover:bg-panel2 hover:text-danger disabled:opacity-30"
                        onClick={() => removeCondition(c.id)}
                        disabled={busy}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </CardBody>

      {/* Add new — pinned to bottom, always visible */}
      <div className="flex items-center gap-2 shrink-0 border-t border-line px-5 py-3">
        <Input
          className="flex-1"
          placeholder={`Add ${type}...`}
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addCondition();
          }}
        />
        <Button size="sm" onClick={() => addCondition()} disabled={busy || !newValue.trim()}>
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Rates Sub-Tab
   ═══════════════════════════════════════════════════════════════════════════ */

function RatesSubTab({
  workspace,
  onApply,
  onError,
  busy: parentBusy,
}: {
  workspace: ProjectWorkspaceData;
  onApply: (next: WorkspaceResponse) => void;
  onError: (msg: string) => void;
  busy: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const busy = parentBusy || isPending;

  /* ─── Rate Schedule state ─── */

  const [showImportPicker, setShowImportPicker] = useState(false);
  const [masterSchedules, setMasterSchedules] = useState<RateSchedule[]>([]);
  const [selectedImportId, setSelectedImportId] = useState<string>("");
  const [loadingMasters, setLoadingMasters] = useState(false);

  const [editingCell, setEditingCell] = useState<{ scheduleId: string; itemId: string; tierId: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  const [expandedSchedules, setExpandedSchedules] = useState<Set<string>>(
    new Set(workspace.rateSchedules.map((s) => s.id))
  );
  function toggleSchedule(id: string) {
    setExpandedSchedules((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleOpenImportPicker() {
    setShowImportPicker(true);
    setLoadingMasters(true);
    try {
      const schedules = await listRateSchedules();
      setMasterSchedules(schedules);
    } catch {
      onError("Failed to load rate schedule library.");
    } finally {
      setLoadingMasters(false);
    }
  }

  function handleImportSchedule() {
    if (!selectedImportId) return;
    startTransition(async () => {
      try {
        onApply(await importRateSchedule(workspace.project.id, selectedImportId));
        setShowImportPicker(false);
        setSelectedImportId("");
      } catch (e) {
        onError(e instanceof Error ? e.message : "Import failed.");
      }
    });
  }

  function handleDeleteSchedule(scheduleId: string) {
    startTransition(async () => {
      try {
        onApply(await deleteProjectRateSchedule(workspace.project.id, scheduleId));
      } catch (e) {
        onError(e instanceof Error ? e.message : "Delete failed.");
      }
    });
  }

  function handleAutoCalculate(scheduleId: string) {
    startTransition(async () => {
      try {
        onApply(await autoCalculateProjectRateSchedule(workspace.project.id, scheduleId));
      } catch (e) {
        onError(e instanceof Error ? e.message : "Auto-calculate failed.");
      }
    });
  }

  function startCellEdit(scheduleId: string, item: RateScheduleItem, tierId: string) {
    setEditingCell({ scheduleId, itemId: item.id, tierId });
    setEditValue(String(item.rates[tierId] ?? 0));
  }

  function cancelCellEdit() {
    setEditingCell(null);
    setEditValue("");
  }

  function saveCellEdit(item: RateScheduleItem) {
    if (!editingCell) return;
    const newRateValue = parseNum(editValue);
    const updatedRates = { ...item.rates, [editingCell.tierId]: newRateValue };
    startTransition(async () => {
      try {
        onApply(
          await updateProjectRateScheduleItem(
            workspace.project.id,
            editingCell.scheduleId,
            editingCell.itemId,
            { rates: updatedRates }
          )
        );
        setEditingCell(null);
        setEditValue("");
      } catch (e) {
        onError(e instanceof Error ? e.message : "Update failed.");
      }
    });
  }

  const categoryColors: Record<string, string> = {
    labour: "bg-blue-500/15 text-blue-400",
    material: "bg-emerald-500/15 text-emerald-400",
    equipment: "bg-amber-500/15 text-amber-400",
    subcontract: "bg-purple-500/15 text-purple-400",
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
      {/* ═══ Section 1: Rate Schedules ═══ */}
      <Card className="flex flex-col flex-1 min-h-0">
        <CardHeader className="flex items-center justify-between shrink-0">
          <CardTitle>Rate Schedules</CardTitle>
          <Button size="sm" onClick={handleOpenImportPicker} disabled={busy}>
            <Download className="h-3.5 w-3.5" />
            Import from Library
          </Button>
        </CardHeader>
        <CardBody className="space-y-4 flex-1 min-h-0 overflow-y-auto">
          {/* Import picker */}
          {showImportPicker && (
            <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 p-3">
              {loadingMasters ? (
                <span className="text-sm text-fg/50">Loading schedules...</span>
              ) : (
                <>
                  <Select
                    className="flex-1"
                    value={selectedImportId}
                    onChange={(e) => setSelectedImportId(e.target.value)}
                  >
                    <option value="">Select a rate schedule...</option>
                    {masterSchedules.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.category})
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    onClick={handleImportSchedule}
                    disabled={busy || !selectedImportId}
                  >
                    Import
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowImportPicker(false);
                      setSelectedImportId("");
                    }}
                  >
                    Cancel
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Schedule list or empty state */}
          {workspace.rateSchedules.length === 0 ? (
            <EmptyState>
              No rate schedules imported. Import from your organization&apos;s rate library.
            </EmptyState>
          ) : (
            <div className="space-y-3">
              {workspace.rateSchedules.map((schedule) => {
                const expanded = expandedSchedules.has(schedule.id);
                const colorClass = categoryColors[schedule.category.toLowerCase()] ?? "bg-fg/10 text-fg/60";
                return (
                  <div
                    key={schedule.id}
                    className="rounded-lg border border-line bg-bg/30"
                  >
                    {/* Schedule header */}
                    <div
                      className="flex cursor-pointer items-center gap-3 px-4 py-3"
                      onClick={() => toggleSchedule(schedule.id)}
                    >
                      {expanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-fg/40" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-fg/40" />
                      )}
                      <div className="flex flex-1 items-center gap-2">
                        <span className="text-sm font-medium text-fg">{schedule.name}</span>
                        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium uppercase", colorClass)}>
                          {schedule.category}
                        </span>
                        {schedule.description && (
                          <span className="text-xs text-fg/40">{schedule.description}</span>
                        )}
                      </div>
                      <div
                        className="flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {schedule.autoCalculate && (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => handleAutoCalculate(schedule.id)}
                            disabled={busy}
                            title="Auto-calculate rates"
                          >
                            <Calculator className="h-3 w-3" />
                          </Button>
                        )}
                        <button
                          className="rounded p-1 text-fg/30 hover:bg-panel2 hover:text-danger"
                          onClick={() => handleDeleteSchedule(schedule.id)}
                          disabled={busy}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Expanded content: rate table */}
                    {expanded && (
                      <div className="border-t border-line px-4 py-3">
                        {schedule.items.length === 0 ? (
                          <p className="text-xs text-fg/40">No rate items in this schedule.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-line text-left text-xs text-fg/40">
                                  <th className="pb-2 pr-4 font-medium">Item</th>
                                  {schedule.tiers
                                    .sort((a, b) => a.sortOrder - b.sortOrder)
                                    .map((tier) => (
                                      <th
                                        key={tier.id}
                                        className="pb-2 pr-4 font-medium text-right"
                                      >
                                        {tier.name}
                                      </th>
                                    ))}
                                </tr>
                              </thead>
                              <tbody>
                                {schedule.items
                                  .sort((a, b) => a.sortOrder - b.sortOrder)
                                  .map((item) => (
                                    <tr
                                      key={item.id}
                                      className="border-b border-line/50 last:border-0"
                                    >
                                      <td className="py-2 pr-4">
                                        <span className="text-fg">{item.name}</span>
                                        {item.code && (
                                          <span className="ml-1.5 text-xs text-fg/35">
                                            ({item.code})
                                          </span>
                                        )}
                                      </td>
                                      {schedule.tiers
                                        .sort((a, b) => a.sortOrder - b.sortOrder)
                                        .map((tier) => {
                                          const isEditing =
                                            editingCell?.scheduleId === schedule.id &&
                                            editingCell?.itemId === item.id &&
                                            editingCell?.tierId === tier.id;
                                          return (
                                            <td
                                              key={tier.id}
                                              className="py-2 pr-4 text-right tabular-nums"
                                            >
                                              {isEditing ? (
                                                <Input
                                                  type="number"
                                                  step="0.01"
                                                  value={editValue}
                                                  onChange={(e) => setEditValue(e.target.value)}
                                                  onKeyDown={(e) => {
                                                    if (e.key === "Enter") saveCellEdit(item);
                                                    if (e.key === "Escape") cancelCellEdit();
                                                  }}
                                                  onBlur={() => saveCellEdit(item)}
                                                  className="h-7 w-24 text-right"
                                                  autoFocus
                                                />
                                              ) : (
                                                <span
                                                  className="cursor-pointer rounded px-1 py-0.5 hover:bg-panel2"
                                                  onDoubleClick={() =>
                                                    startCellEdit(schedule.id, item, tier.id)
                                                  }
                                                >
                                                  ${(item.rates[tier.id] ?? 0).toFixed(2)}
                                                </span>
                                              )}
                                            </td>
                                          );
                                        })}
                                    </tr>
                                  ))}
                                {/* Cost rates footer row */}
                                {schedule.items.some(
                                  (item) => Object.keys(item.costRates).length > 0
                                ) && (
                                  <>
                                    <tr>
                                      <td
                                        colSpan={1 + schedule.tiers.length}
                                        className="pt-2 pb-1"
                                      >
                                        <span className="text-[10px] font-medium uppercase text-fg/30">
                                          Cost Rates
                                        </span>
                                      </td>
                                    </tr>
                                    {schedule.items
                                      .filter(
                                        (item) =>
                                          Object.keys(item.costRates).length > 0
                                      )
                                      .sort((a, b) => a.sortOrder - b.sortOrder)
                                      .map((item) => (
                                        <tr
                                          key={`cost-${item.id}`}
                                          className="text-fg/35"
                                        >
                                          <td className="py-1 pr-4 text-xs">
                                            {item.name}
                                          </td>
                                          {schedule.tiers
                                            .sort((a, b) => a.sortOrder - b.sortOrder)
                                            .map((tier) => (
                                              <td
                                                key={tier.id}
                                                className="py-1 pr-4 text-right text-xs tabular-nums"
                                              >
                                                {item.costRates[tier.id] != null
                                                  ? `$${item.costRates[tier.id].toFixed(2)}`
                                                  : ""}
                                              </td>
                                            ))}
                                        </tr>
                                      ))}
                                  </>
                                )}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Other Sub-Tab
   ═══════════════════════════════════════════════════════════════════════════ */

function OtherSubTab({
  workspace,
  saveRevision,
  saveQuote,
  busy,
}: {
  workspace: ProjectWorkspaceData;
  saveRevision: (patch?: Partial<RevisionPatchInput>) => void;
  saveQuote: (patch: QuotePatchInput) => void;
  busy: boolean;
}) {
  const rev = workspace.currentRevision;
  const quote = workspace.quote;
  const { user: currentUser } = useAuth();

  const [dateEstimatedShip, setDateEstimatedShip] = useState(toDateInput(rev.dateEstimatedShip));
  const [shippingMethod, setShippingMethod] = useState(rev.shippingMethod ?? "");
  const [freightOnBoard, setFreightOnBoard] = useState(rev.freightOnBoard ?? "");
  const [dateWalkdown, setDateWalkdown] = useState(toDateInput(rev.dateWalkdown));
  const [dateWorkStart, setDateWorkStart] = useState(toDateInput(rev.dateWorkStart));
  const [dateWorkEnd, setDateWorkEnd] = useState(toDateInput(rev.dateWorkEnd));
  const [followUpNote, setFollowUpNote] = useState(rev.followUpNote ?? "");
  const [userId, setUserId] = useState(quote.userId ?? "");
  const [orgUsers, setOrgUsers] = useState<AuthUser[]>([]);

  // Load org users and auto-fill with current user if not yet assigned
  useEffect(() => {
    listUsers().then((users) => {
      setOrgUsers(users.filter((u) => u.active));
      // Auto-fill with current user if userId is empty
      if (!quote.userId && currentUser?.id) {
        setUserId(currentUser.id);
        saveQuote({ userId: currentUser.id });
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const otherStateRef = useRef({ dateEstimatedShip, shippingMethod, freightOnBoard, dateWalkdown, dateWorkStart, dateWorkEnd, followUpNote });
  otherStateRef.current = { dateEstimatedShip, shippingMethod, freightOnBoard, dateWalkdown, dateWorkStart, dateWorkEnd, followUpNote };

  const doSaveOther = useCallback(() => {
    const s = otherStateRef.current;
    saveRevision({
      dateEstimatedShip: fromDateInput(s.dateEstimatedShip),
      shippingMethod: s.shippingMethod,
      freightOnBoard: s.freightOnBoard,
      dateWalkdown: fromDateInput(s.dateWalkdown),
      dateWorkStart: fromDateInput(s.dateWorkStart),
      dateWorkEnd: fromDateInput(s.dateWorkEnd),
      followUpNote: s.followUpNote,
    });
  }, [saveRevision]);

  const { trigger: debouncedSaveOther } = useDebouncedSave(doSaveOther);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Shipping & Logistics</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>Estimated Ship Date</Label>
              <Input
                type="date"
                value={dateEstimatedShip}
                onChange={(e) => {
                  setDateEstimatedShip(e.target.value);
                  setTimeout(() => doSaveOther(), 0);
                }}
              />
            </div>
            <div>
              <Label>Shipping Method</Label>
              <Input
                value={shippingMethod}
                onChange={(e) => setShippingMethod(e.target.value)}
                onBlur={debouncedSaveOther}
                placeholder="e.g. Ground, Air, LTL"
              />
            </div>
            <div>
              <Label>Freight On Board</Label>
              <Input
                value={freightOnBoard}
                onChange={(e) => setFreightOnBoard(e.target.value)}
                onBlur={debouncedSaveOther}
                placeholder="e.g. Origin, Destination"
              />
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>Walkdown Date</Label>
              <Input
                type="date"
                value={dateWalkdown}
                onChange={(e) => {
                  setDateWalkdown(e.target.value);
                  setTimeout(() => doSaveOther(), 0);
                }}
              />
            </div>
            <div>
              <Label>Work Start Date</Label>
              <Input
                type="date"
                value={dateWorkStart}
                onChange={(e) => {
                  setDateWorkStart(e.target.value);
                  setTimeout(() => doSaveOther(), 0);
                }}
              />
            </div>
            <div>
              <Label>Work End Date</Label>
              <Input
                type="date"
                value={dateWorkEnd}
                onChange={(e) => {
                  setDateWorkEnd(e.target.value);
                  setTimeout(() => doSaveOther(), 0);
                }}
              />
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Follow-Up & Assignment</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div>
            <Label>Follow-Up Note</Label>
            <Textarea
              rows={3}
              value={followUpNote}
              onChange={(e) => setFollowUpNote(e.target.value)}
              onBlur={debouncedSaveOther}
              placeholder="Follow-up notes..."
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Assigned Estimator</Label>
              <RadixSelect.Root
                value={userId || undefined}
                onValueChange={(val) => {
                  setUserId(val);
                  saveQuote({ userId: val || null });
                }}
              >
                <RadixSelect.Trigger className="inline-flex items-center justify-between w-full h-9 px-3 text-sm rounded-lg border border-line bg-bg/50 text-fg outline-none hover:border-accent/30 focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-colors">
                  <RadixSelect.Value placeholder="Select estimator..." />
                  <RadixSelect.Icon className="ml-2 shrink-0">
                    <ChevronDown className="h-3.5 w-3.5 text-fg/40" />
                  </RadixSelect.Icon>
                </RadixSelect.Trigger>
                <RadixSelect.Portal>
                  <RadixSelect.Content className="z-50 rounded-lg border border-line bg-panel shadow-xl" position="popper" sideOffset={4}>
                    <RadixSelect.Viewport className="p-1">
                      {orgUsers.map((u) => (
                        <RadixSelect.Item
                          key={u.id}
                          value={u.id}
                          className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-md outline-none cursor-pointer hover:bg-accent/10 data-[highlighted]:bg-accent/10 data-[state=checked]:text-accent"
                        >
                          <RadixSelect.ItemIndicator className="shrink-0">
                            <Check className="h-3 w-3" />
                          </RadixSelect.ItemIndicator>
                          <RadixSelect.ItemText>
                            {u.name}{u.id === currentUser?.id ? " (you)" : ""}
                          </RadixSelect.ItemText>
                          <span className="ml-auto text-[10px] text-fg/30">{u.role}</span>
                        </RadixSelect.Item>
                      ))}
                    </RadixSelect.Viewport>
                  </RadixSelect.Content>
                </RadixSelect.Portal>
              </RadixSelect.Root>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Settings Sub-Tab
   ═══════════════════════════════════════════════════════════════════════════ */

function SettingsSubTab({
  workspace,
  revDraft,
  setRevDraft,
  saveRevision,
  busy,
  markDirty,
}: {
  workspace: ProjectWorkspaceData;
  revDraft: RevisionDraft;
  setRevDraft: React.Dispatch<React.SetStateAction<RevisionDraft>>;
  saveRevision: (patch?: Partial<RevisionPatchInput>) => void;
  busy: boolean;
  markDirty: (field: string) => void;
}) {
  const rev = workspace.currentRevision;

  const [defaultMarkup, setDefaultMarkup] = useState(String(rev.defaultMarkup ?? 0));

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-5">
      {/* Pricing */}
      <Card>
        <CardHeader>
          <CardTitle>Pricing</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Default Markup (%)</Label>
              <Input
                type="number"
                step="0.1"
                value={defaultMarkup}
                onChange={(e) => setDefaultMarkup(e.target.value)}
                onBlur={() => saveRevision({ defaultMarkup: parseNum(defaultMarkup) })}
                placeholder="0"
              />
              <p className="mt-1 text-[11px] text-fg/40">Applied to new line items added to this estimate</p>
            </div>
            <div>
              <Label>Breakout Style</Label>
              <Select
                value={revDraft.breakoutStyle}
                onChange={(e) => {
                  setRevDraft((d) => ({ ...d, breakoutStyle: e.target.value }));
                  saveRevision({ breakoutStyle: e.target.value });
                }}
              >
                <option value="category">By Category</option>
                <option value="phase">By Phase</option>
                <option value="flat">Flat (No Breakout)</option>
              </Select>
              <p className="mt-1 text-[11px] text-fg/40">How line items are grouped in the estimate view</p>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
