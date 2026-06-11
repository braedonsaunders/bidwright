"use client";

import { useEffect, useState, useTransition, useRef, useCallback, useMemo } from "react";
import ReactDOM from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Boxes,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Hammer,
  Layers,
  Loader2,
  PlugZap,
  Plus,
  Save,
  SaveAll,
  Search,
  SlidersHorizontal,
  Store,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type {
  ConditionLibraryEntry,
  LaborUnitLibraryRecord,
  LineItemSearchSourceType,
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
  createCondition,
  createConditionLibraryEntry,
  createCustomer,
  createCustomerContact,
  deleteCondition,
  deleteConditionLibraryEntry,
  deleteProjectRateSchedule,
  getConditionLibrary,
  getCustomers,
  getCustomer,
  getDepartments,
  listLaborUnitLibraries,
  mergeWorkspacePatch,
  reorderConditions,
  updateCondition,
  updateProjectRateScheduleItem,
  updateQuote,
  updateRevision,
} from "@/lib/api";
import type { Customer, CustomerContact, Department } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Combobox,
  EmptyState,
  Input,
  Label,
  ModalBackdrop,
  Select,
  Textarea,
  Toggle,
} from "@/components/ui";
import { RichTextEditor } from "@/components/rich-text-editor";
import { ImportRateSchedulesModal } from "@/components/workspace/import-rate-schedules-modal";
import { cn } from "@/lib/utils";
import * as RadixSelect from "@radix-ui/react-select";
import { useAuth } from "@/components/auth-provider";
import type { AuthUser } from "@/lib/api";
import { listUsers } from "@/lib/api";

/* ─── Types ─── */

type SetupSubTab = "general" | "conditions" | "notes" | "rates" | "search" | "other";

type EstimateSearchSettings = {
  disabledSourceTypes: LineItemSearchSourceType[];
  disabledLaborLibraryIds: string[];
  disabledCatalogIds: string[];
};

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
  onApply: (next: WorkspaceResponse | ((prev: WorkspaceResponse) => WorkspaceResponse)) => void;
  onError: (msg: string) => void;
  highlightField?: string;
}

/* ─── Constants ─── */

const subTabs: Array<{ id: SetupSubTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "conditions", label: "Conditions" },
  { id: "notes", label: "Notes" },
  { id: "rates", label: "Rates" },
  { id: "search", label: "Search" },
  { id: "other", label: "Other" },
];

const ESTIMATE_SEARCH_PREF_KEY = "estimateSearch";

const LINE_ITEM_SEARCH_SOURCE_TYPES: LineItemSearchSourceType[] = [
  "catalog_item",
  "rate_schedule_item",
  "labor_unit",
  "effective_cost",
  "assembly",
  "plugin_tool",
  "external_action",
];

const CATALOG_SEARCH_SOURCE_TYPES: LineItemSearchSourceType[] = ["catalog_item"];
const LABOR_SEARCH_SOURCE_TYPES: LineItemSearchSourceType[] = ["labor_unit"];

const ESTIMATE_SEARCH_SOURCE_CONTROLS: Array<{
  label: string;
  detail: string;
  sourceTypes: LineItemSearchSourceType[];
  Icon: typeof BookOpen;
  accent: string;
}> = [
  {
    label: "Imported rate books",
    detail: "Quote-linked labour and equipment rates.",
    sourceTypes: ["rate_schedule_item"],
    Icon: Zap,
    accent: "border-accent/25 bg-accent/8 text-accent",
  },
  {
    label: "Catalogs",
    detail: "Library catalog items.",
    sourceTypes: ["catalog_item"],
    Icon: Boxes,
    accent: "border-fg/15 bg-bg text-fg/70",
  },
  {
    label: "Labour unit libraries",
    detail: "Production units, crews, and rate-book prompts.",
    sourceTypes: ["labor_unit"],
    Icon: Hammer,
    accent: "border-warning/25 bg-warning/8 text-warning",
  },
  {
    label: "Cost intelligence",
    detail: "Effective vendor and market cost observations.",
    sourceTypes: ["effective_cost"],
    Icon: BrainCircuit,
    accent: "border-success/25 bg-success/8 text-success",
  },
  {
    label: "Assemblies",
    detail: "Saved build-ups and multi-line selections.",
    sourceTypes: ["assembly"],
    Icon: Layers,
    accent: "border-success/25 bg-success/8 text-success",
  },
  {
    label: "External searches",
    detail: "Provider and supplier searches that return line items.",
    sourceTypes: ["external_action"],
    Icon: Store,
    accent: "border-accent/25 bg-accent/8 text-accent",
  },
  {
    label: "Plugin calculators",
    detail: "Tools that create worksheet lines when searched by name.",
    sourceTypes: ["plugin_tool"],
    Icon: PlugZap,
    accent: "border-accent/25 bg-accent/8 text-accent",
  },
];

/* ─── Condition Type Metadata ─── */

type ConditionBadgeTone = "success" | "danger" | "info" | "warning" | "default";

interface ConditionTypeMeta {
  label: string;
  tone: ConditionBadgeTone;
}

const CONDITION_TYPE_META: Record<string, ConditionTypeMeta> = {
  inclusion: { label: "Inclusions", tone: "success" },
  exclusion: { label: "Exclusions", tone: "danger" },
  clarification: { label: "Clarifications", tone: "info" },
  assumption: { label: "Assumptions", tone: "warning" },
  general: { label: "General", tone: "default" },
};

const CONDITION_TYPE_KEYS = ["inclusion", "exclusion", "clarification", "assumption", "general"] as const;

function conditionTypeMeta(raw: string): ConditionTypeMeta {
  const key = raw.trim().toLowerCase();
  if (CONDITION_TYPE_META[key]) return CONDITION_TYPE_META[key];
  const label = key
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return { label, tone: "default" };
}

function conditionTypeBadgeClasses(tone: ConditionBadgeTone): string {
  const map: Record<ConditionBadgeTone, string> = {
    success: "border-success/20 bg-success/8 text-success",
    danger: "border-danger/20 bg-danger/8 text-danger",
    info: "border-accent/20 bg-accent/8 text-accent",
    warning: "border-warning/20 bg-warning/8 text-warning",
    default: "border-line bg-panel2 text-fg/70",
  };
  return map[tone];
}

function conditionTypeSectionAccent(tone: ConditionBadgeTone): string {
  const map: Record<ConditionBadgeTone, string> = {
    success: "border-l-success/40",
    danger: "border-l-danger/40",
    info: "border-l-accent/40",
    warning: "border-l-warning/40",
    default: "border-l-fg/20",
  };
  return map[tone];
}

const CONDITION_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

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

function asPlainRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0)));
}

function isLineItemSearchSourceType(value: string): value is LineItemSearchSourceType {
  return LINE_ITEM_SEARCH_SOURCE_TYPES.includes(value as LineItemSearchSourceType);
}

function readEstimateSearchSettings(pdfPreferences: Record<string, unknown> | null | undefined): EstimateSearchSettings {
  const preferences = asPlainRecord(pdfPreferences);
  const rawSettings = asPlainRecord(preferences[ESTIMATE_SEARCH_PREF_KEY]);
  return {
    disabledSourceTypes: uniqueStrings(rawSettings.disabledSourceTypes).filter(isLineItemSearchSourceType),
    disabledLaborLibraryIds: uniqueStrings(rawSettings.disabledLaborLibraryIds),
    disabledCatalogIds: uniqueStrings(rawSettings.disabledCatalogIds),
  };
}

function cleanEstimateSearchSettings(settings: EstimateSearchSettings): EstimateSearchSettings {
  return {
    disabledSourceTypes: Array.from(new Set(settings.disabledSourceTypes.filter(isLineItemSearchSourceType))),
    disabledLaborLibraryIds: Array.from(new Set(settings.disabledLaborLibraryIds.filter(Boolean))),
    disabledCatalogIds: Array.from(new Set(settings.disabledCatalogIds.filter(Boolean))),
  };
}

function searchFieldsMatch(query: string, fields: Array<string | null | undefined>) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.filter(Boolean).join(" ").toLowerCase().includes(needle);
}

function formatScheduleDate(value: string | null | undefined) {
  if (!value) return "";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

function formatScheduleDateRange(start: string | null | undefined, end: string | null | undefined) {
  if (start && end) return `${formatScheduleDate(start)} - ${formatScheduleDate(end)}`;
  if (start) return `From ${formatScheduleDate(start)}`;
  if (end) return `Until ${formatScheduleDate(end)}`;
  return "";
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
    else if (highlightField === "estimateSearch") setSubTab("search");
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
    // Only merge an explicit patch object — never a (synthetic) event accidentally
    // passed by a raw event-handler binding (e.g. onBlur={saveRevision}). An event's
    // circular nativeEvent/target/view refs would break JSON serialization of the
    // request body ("circular JSON" error on save).
    if (patch && typeof patch === "object" && !("nativeEvent" in patch) && !(patch instanceof Event)) {
      Object.assign(payload, patch);
    }

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
        {subTab === "search" && (
          <EstimateSearchSubTab
            workspace={workspace}
            saveRevision={saveRevision}
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
  const [contactQuickAddOpen, setContactQuickAddOpen] = useState(false);
  const [contactQuickAddName, setContactQuickAddName] = useState("");
  const [contactQuickAddSaving, setContactQuickAddSaving] = useState(false);
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

  useEffect(() => {
    setCustomerId(quote.customerId ?? "");
    setCustomerContactId(quote.customerContactId ?? "");
    setDepartmentId(quote.departmentId ?? "");
    setQuoteType(rev.type ?? "Firm");
    setDateQuote(toDateInput(rev.dateQuote));
    setDateDue(toDateInput(rev.dateDue));
  }, [
    quote.customerId,
    quote.customerContactId,
    quote.departmentId,
    rev.type,
    rev.dateQuote,
    rev.dateDue,
  ]);

  const selectedCustomer = useMemo(
    () => customerOptions.find((c) => c.id === customerId) ?? null,
    [customerId, customerOptions],
  );
  const sourceClientLabel = (quote.customerString || workspace.project.clientName || "").trim();
  const showClientAliasNote = Boolean(
    selectedCustomer
    && sourceClientLabel
    && sourceClientLabel !== selectedCustomer.name,
  );

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

  async function handleContactQuickAdd() {
    if (!contactQuickAddName.trim() || !customerId) return;
    setContactQuickAddSaving(true);
    try {
      const created = await createCustomerContact(customerId, { name: contactQuickAddName.trim(), active: true });
      setContactOptions((prev) => [...prev, created]);
      setCustomerContactId(created.id);
      setContactQuickAddName("");
      setContactQuickAddOpen(false);
      setTimeout(() => doSave(), 0);
    } catch {
      /* ignore */
    } finally {
      setContactQuickAddSaving(false);
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

          {/* Client / Contact / Department / Type */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[minmax(200px,1.35fr)_minmax(200px,1.35fr)_minmax(170px,1fr)_minmax(140px,0.8fr)]">
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
                  <Combobox
                    value={customerId}
                    onChange={(v) => {
                      setCustomerId(v);
                      setCustomerContactId("");
                      setTimeout(() => doSave(), 0);
                    }}
                    options={customerOptions.filter((c) => c.active).map((c) => ({
                      value: c.id,
                      label: c.name + (c.shortName ? ` (${c.shortName})` : ""),
                    }))}
                    placeholder="Select client..."
                    className="flex-1"
                  />
                  <Button type="button" size="xs" variant="secondary" onClick={() => setQuickAddOpen(true)} title="Add new client">
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              )}
              {showClientAliasNote && (
                <p className="mt-1 text-[11px] text-fg/40">
                  Linked customer: {selectedCustomer?.name}. Source/import label on this quote: {sourceClientLabel}.
                </p>
              )}
            </div>
            <div>
              <Label>Contact</Label>
              {contactQuickAddOpen ? (
                <div className="flex gap-1.5">
                  <Input
                    placeholder="New contact name"
                    value={contactQuickAddName}
                    onChange={(e) => setContactQuickAddName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleContactQuickAdd())}
                    autoFocus
                  />
                  <Button type="button" size="xs" variant="accent" onClick={handleContactQuickAdd} disabled={contactQuickAddSaving || !contactQuickAddName.trim()}>
                    {contactQuickAddSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  </Button>
                  <Button type="button" size="xs" variant="secondary" onClick={() => { setContactQuickAddOpen(false); setContactQuickAddName(""); }}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <Combobox
                    value={customerContactId}
                    onChange={(v) => {
                      setCustomerContactId(v);
                      setTimeout(() => doSave(), 0);
                    }}
                    options={contactOptions.filter((c) => c.active).map((c) => ({
                      value: c.id,
                      label: c.name + (c.email ? ` (${c.email})` : ""),
                    }))}
                    placeholder="Select contact..."
                    disabled={!customerId}
                    className="flex-1"
                  />
                  <Button type="button" size="xs" variant="secondary" onClick={() => setContactQuickAddOpen(true)} title="Add new contact" disabled={!customerId}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              )}
              {!customerId && <p className="mt-1 text-[11px] text-fg/40">Select a client first</p>}
            </div>
            <div>
              <Label>Department</Label>
              <Combobox
                value={departmentId}
                onChange={(v) => {
                  setDepartmentId(v);
                  setTimeout(() => doSave(), 0);
                }}
                options={departmentOptions.filter((d) => d.active).map((d) => ({
                  value: d.id,
                  label: d.name + (d.code ? ` (${d.code})` : ""),
                }))}
                placeholder="Select department..."
              />
            </div>
            <div>
              <Label>Type</Label>
              <Combobox
                value={quoteType}
                onChange={(v) => {
                  setQuoteType(v as "Firm" | "Budget" | "BudgetDNE");
                  setTimeout(() => doSave(), 0);
                }}
                options={[
                  { value: "Firm", label: "Firm" },
                  { value: "Budget", label: "Budget" },
                  { value: "BudgetDNE", label: "Budget DNE" },
                ]}
                placeholder="Select type..."
              />
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
   Conditions Sub-Tab
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

  const allConditions = workspace.conditions ?? [];

  const conditionsByType = useMemo(() => {
    const grouped = new Map<string, ProjectCondition[]>();
    for (const key of CONDITION_TYPE_KEYS) grouped.set(key, []);
    for (const c of allConditions) {
      const key = c.type.trim().toLowerCase();
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(c);
    }
    for (const conditions of grouped.values()) {
      conditions.sort((a, b) => a.order - b.order);
    }
    return grouped;
  }, [allConditions]);

  const countsByType = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of allConditions) {
      const key = c.type.trim().toLowerCase();
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [allConditions]);

  const pillTypes = useMemo(() => {
    const seen = new Set<string>(CONDITION_TYPE_KEYS);
    const extras: string[] = [];
    for (const key of countsByType.keys()) {
      if (!seen.has(key)) {
        seen.add(key);
        extras.push(key);
      }
    }
    return [...CONDITION_TYPE_KEYS, ...extras.sort()];
  }, [countsByType]);

  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [pageSize, setPageSize] = useState<number>(25);
  const [pageIndex, setPageIndex] = useState(0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allConditions
      .slice()
      .sort((a, b) => a.order - b.order)
      .filter((c) => {
        if (activeFilter !== "all" && c.type.trim().toLowerCase() !== activeFilter) return false;
        if (q && !c.value.toLowerCase().includes(q) && !c.type.trim().toLowerCase().includes(q)) return false;
        return true;
      });
  }, [allConditions, search, activeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const pageRows = useMemo(
    () => filtered.slice(safePageIndex * pageSize, safePageIndex * pageSize + pageSize),
    [filtered, safePageIndex, pageSize],
  );

  useEffect(() => {
    setPageIndex(0);
  }, [search, activeFilter, pageSize]);

  // Library
  const [library, setLibrary] = useState<ConditionLibraryEntry[]>([]);
  useEffect(() => {
    getConditionLibrary().then(setLibrary).catch(() => {});
  }, []);
  const [libraryDrawerOpen, setLibraryDrawerOpen] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryTypeFilter, setLibraryTypeFilter] = useState<string>("all");
  const refreshLibrary = useCallback(() => getConditionLibrary().then(setLibrary).catch(() => {}), []);
  const libraryTypeKeys = useMemo(() => {
    const seen = new Set<string>(CONDITION_TYPE_KEYS);
    for (const entry of library) seen.add(entry.type.trim().toLowerCase());
    return [...CONDITION_TYPE_KEYS, ...Array.from(seen).filter((k) => !(CONDITION_TYPE_KEYS as readonly string[]).includes(k)).sort()];
  }, [library]);
  const filteredLibrary = useMemo(() => {
    const q = librarySearch.trim().toLowerCase();
    return library.filter((entry) => {
      if (libraryTypeFilter !== "all" && entry.type.trim().toLowerCase() !== libraryTypeFilter) return false;
      if (q && !entry.value.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [library, librarySearch, libraryTypeFilter]);

  // Drawer
  const [drawerMode, setDrawerMode] = useState<"create" | "edit" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<{ type: string; value: string }>({ type: "inclusion", value: "" });
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setEditingId(null);
    const defaultType = activeFilter !== "all" && CONDITION_TYPE_META[activeFilter] ? activeFilter : "inclusion";
    setForm({ type: defaultType, value: "" });
    setDrawerMode("create");
  }

  function openEdit(c: ProjectCondition) {
    setEditingId(c.id);
    setForm({ type: c.type.trim().toLowerCase(), value: c.value });
    setDrawerMode("edit");
  }

  function closeDrawer() {
    setDrawerMode(null);
    setEditingId(null);
    setSaving(false);
  }

  function handleDrawerSave() {
    const trimmed = form.value.trim();
    const type = form.type.trim().toLowerCase();
    if (!trimmed || !type) return;
    setSaving(true);
    startTransition(async () => {
      try {
        if (drawerMode === "create") {
          onApply(await createCondition(workspace.project.id, { type, value: trimmed, order: allConditions.length + 1 }));
        } else if (drawerMode === "edit" && editingId) {
          onApply(await updateCondition(workspace.project.id, editingId, { type, value: trimmed }));
        }
        closeDrawer();
      } catch (e) {
        onError(e instanceof Error ? e.message : "Save failed.");
        setSaving(false);
      }
    });
  }

  function handleDrawerDelete() {
    if (!editingId) return;
    if (!confirm("Delete this condition?")) return;
    setSaving(true);
    startTransition(async () => {
      try {
        onApply(await deleteCondition(workspace.project.id, editingId));
        closeDrawer();
      } catch (e) {
        onError(e instanceof Error ? e.message : "Delete failed.");
        setSaving(false);
      }
    });
  }

  function moveCondition(condition: ProjectCondition, direction: "up" | "down") {
    const typeKey = condition.type.trim().toLowerCase();
    const conditions = conditionsByType.get(typeKey) ?? [];
    const idx = conditions.findIndex((c) => c.id === condition.id);
    if (idx < 0) return;
    const swapIndex = direction === "up" ? idx - 1 : idx + 1;
    if (swapIndex < 0 || swapIndex >= conditions.length) return;
    const reordered = [...conditions];
    [reordered[idx], reordered[swapIndex]] = [reordered[swapIndex], reordered[idx]];
    const otherConditions = allConditions.filter((c) => c.type.trim().toLowerCase() !== typeKey);
    const orderedIds = [...otherConditions.map((c) => c.id), ...reordered.map((c) => c.id)];
    startTransition(async () => {
      try {
        onApply(await reorderConditions(workspace.project.id, orderedIds));
      } catch (e) {
        onError(e instanceof Error ? e.message : "Reorder failed.");
      }
    });
  }

  function saveToLibrary(value: string, type: string) {
    startTransition(async () => {
      try {
        await createConditionLibraryEntry({ type, value });
        refreshLibrary();
      } catch (e) {
        onError(e instanceof Error ? e.message : "Failed to save to library.");
      }
    });
  }

  function addConditionFromLibrary(entry: ConditionLibraryEntry) {
    startTransition(async () => {
      try {
        const next = await createCondition(workspace.project.id, {
          type: entry.type.trim().toLowerCase(),
          value: entry.value,
          order: (conditionsByType.get(entry.type.trim().toLowerCase())?.length ?? 0) + 1,
        });
        onApply(next);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Add failed.");
      }
    });
  }

  function removeFromLibrary(entryId: string) {
    startTransition(async () => {
      try {
        await deleteConditionLibraryEntry(entryId);
        refreshLibrary();
      } catch (e) {
        onError(e instanceof Error ? e.message : "Failed to remove from library.");
      }
    });
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="rounded-lg border border-line bg-panel flex flex-col flex-1 min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line bg-panel2/40 shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-fg">Conditions</h3>
            <p className="text-xs text-fg/45 mt-0.5">
              {allConditions.length} condition{allConditions.length !== 1 ? "s" : ""} across this quote
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setLibrarySearch("");
                setLibraryTypeFilter("all");
                refreshLibrary();
                setLibraryDrawerOpen(true);
              }}
              disabled={loading}
            >
              <BookOpen className="h-3.5 w-3.5" />
              Library
            </Button>
            <Button variant="accent" size="sm" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" />
              New Condition
            </Button>
          </div>
        </div>

        {/* Search + filters */}
        <div className="px-4 py-3 space-y-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg/30" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search conditions..."
                className="pl-9"
              />
            </div>
            <Select
              className="w-32"
              value={String(pageSize)}
              onValueChange={(v) => setPageSize(Number(v) || 25)}
              options={CONDITION_PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: `${n} per page` }))}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <ConditionFilterPill
              label="All"
              count={allConditions.length}
              active={activeFilter === "all"}
              tone="default"
              onClick={() => setActiveFilter("all")}
            />
            {pillTypes.map((key) => {
              const meta = conditionTypeMeta(key);
              return (
                <ConditionFilterPill
                  key={key}
                  label={meta.label}
                  count={countsByType.get(key) ?? 0}
                  active={activeFilter === key}
                  tone={meta.tone}
                  onClick={() => setActiveFilter(key)}
                />
              );
            })}
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4">
          <div className="rounded-lg border border-line overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-panel2/60 sticky top-0">
                <tr className="text-left text-[11px] uppercase tracking-wider text-fg/45">
                  <th className="px-4 py-2 w-36 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Value</th>
                  <th className="px-4 py-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-10">
                      <EmptyState>
                        {search || activeFilter !== "all"
                          ? "No conditions match your filters."
                          : "No conditions yet. Click \"New Condition\" to add one."}
                      </EmptyState>
                    </td>
                  </tr>
                )}
                {pageRows.map((c) => {
                  const meta = conditionTypeMeta(c.type);
                  return (
                    <tr
                      key={c.id}
                      onClick={() => openEdit(c)}
                      className="border-t border-line hover:bg-panel2/40 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-2.5 align-top">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-fg/90 leading-relaxed">
                        <div className="line-clamp-2">{c.value}</div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-fg/30">
                        <ChevronRight className="inline h-3.5 w-3.5" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        {filtered.length > 0 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-line text-xs text-fg/50 shrink-0">
            <span>
              Showing {safePageIndex * pageSize + 1}–{Math.min((safePageIndex + 1) * pageSize, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={safePageIndex === 0}
                onClick={() => setPageIndex(Math.max(0, safePageIndex - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Prev
              </Button>
              <span className="text-fg/40">
                Page {safePageIndex + 1} / {totalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={safePageIndex >= totalPages - 1}
                onClick={() => setPageIndex(Math.min(totalPages - 1, safePageIndex + 1))}
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Edit/Create Drawer ── */}
      {typeof document !== "undefined" &&
        ReactDOM.createPortal(
          <AnimatePresence>
            {drawerMode && (
              <>
                <motion.div
                  key="condition-drawer-backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="fixed inset-0 z-[200] bg-black/30"
                  onClick={closeDrawer}
                />
                <motion.div
                  key="condition-drawer"
                  initial={{ x: 480 }}
                  animate={{ x: 0 }}
                  exit={{ x: 480 }}
                  transition={{ type: "spring", damping: 30, stiffness: 300 }}
                  className="fixed inset-y-0 right-0 z-[201] w-[480px] bg-panel border-l border-line shadow-2xl flex flex-col"
                >
                  <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line bg-panel2/40">
                    <div>
                      <p className="text-[10px] font-semibold text-fg/45 uppercase tracking-wider">
                        {drawerMode === "create" ? "New Condition" : "Edit Condition"}
                      </p>
                      <h3 className="text-sm font-medium text-fg mt-0.5">
                        {drawerMode === "create" ? "Add to this quote" : "Update condition"}
                      </h3>
                    </div>
                    <button
                      onClick={closeDrawer}
                      className="rounded p-1 text-fg/40 hover:bg-panel2 hover:text-fg transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                    <div>
                      <label className="text-[10px] font-medium text-fg/40 uppercase tracking-wider">Type</label>
                      <Select
                        className="mt-1"
                        value={form.type}
                        onValueChange={(v) => setForm({ ...form, type: v })}
                        options={pillTypes.map((key) => ({
                          value: key,
                          label: conditionTypeMeta(key).label,
                        }))}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-fg/40 uppercase tracking-wider">Value</label>
                      <Textarea
                        className="mt-1 min-h-[140px]"
                        value={form.value}
                        onChange={(e) => setForm({ ...form, value: e.target.value })}
                        placeholder="Enter the clause text..."
                        autoFocus
                        onKeyDown={(e) => {
                          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                            e.preventDefault();
                            handleDrawerSave();
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            closeDrawer();
                          }
                        }}
                      />
                      <p className="mt-1.5 text-[10px] text-fg/40">⌘/Ctrl + Enter to save · Esc to cancel</p>
                    </div>

                    {drawerMode === "edit" && editingId && (
                      <div>
                        <label className="text-[10px] font-medium text-fg/40 uppercase tracking-wider">Reorder</label>
                        <div className="flex items-center gap-2 mt-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const c = allConditions.find((x) => x.id === editingId);
                              if (c) moveCondition(c, "up");
                            }}
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                            Move Up
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const c = allConditions.find((x) => x.id === editingId);
                              if (c) moveCondition(c, "down");
                            }}
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                            Move Down
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-line px-5 py-3 flex items-center justify-between gap-2 bg-panel2/40">
                    <div className="flex items-center gap-2">
                      {drawerMode === "edit" && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleDrawerDelete}
                            disabled={saving}
                            className="text-danger hover:bg-danger/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => saveToLibrary(form.value, form.type)}
                            disabled={saving || !form.value.trim()}
                          >
                            <SaveAll className="h-3.5 w-3.5" />
                            Save to Library
                          </Button>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={closeDrawer} disabled={saving}>
                        Cancel
                      </Button>
                      <Button
                        variant="accent"
                        size="sm"
                        onClick={handleDrawerSave}
                        disabled={saving || !form.value.trim() || !form.type.trim()}
                      >
                        {saving ? "Saving..." : drawerMode === "create" ? "Create" : "Save"}
                      </Button>
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body,
        )}

      {/* ── Library Drawer ── */}
      <ModalBackdrop open={libraryDrawerOpen} onClose={() => setLibraryDrawerOpen(false)} size="lg">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Condition Library</CardTitle>
              <button
                onClick={() => setLibraryDrawerOpen(false)}
                className="rounded p-1 text-fg/40 hover:bg-panel2 hover:text-fg transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-fg/50 mt-1">
              Search and filter the library, then click items to add them to this quote.
            </p>
          </CardHeader>
          <CardBody className="space-y-3 max-h-[60vh] overflow-y-auto">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg/30" />
                <Input
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                  placeholder="Search conditions..."
                  className="pl-9"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <ConditionFilterPill
                label="All"
                count={library.length}
                active={libraryTypeFilter === "all"}
                tone="default"
                onClick={() => setLibraryTypeFilter("all")}
              />
              {libraryTypeKeys.map((key) => {
                const meta = conditionTypeMeta(key);
                const count = library.filter((e) => e.type.trim().toLowerCase() === key).length;
                return (
                  <ConditionFilterPill
                    key={key}
                    label={meta.label}
                    count={count}
                    active={libraryTypeFilter === key}
                    tone={meta.tone}
                    onClick={() => setLibraryTypeFilter(key)}
                  />
                );
              })}
            </div>
            {filteredLibrary.length === 0 ? (
              <EmptyState>
                {librarySearch || libraryTypeFilter !== "all"
                  ? "No conditions match your filters."
                  : "No conditions in the library yet."}
              </EmptyState>
            ) : (
              <div className="space-y-1">
                {filteredLibrary.map((entry) => {
                  const meta = conditionTypeMeta(entry.type);
                  return (
                    <div
                      key={entry.id}
                      className="group flex items-center gap-3 rounded-lg border border-line/60 px-3 py-2 text-sm hover:bg-panel2/40 transition-colors"
                    >
                      <Badge tone={meta.tone} className="shrink-0">
                        {meta.label}
                      </Badge>
                      <span className="flex-1 text-fg/80 truncate">{entry.value}</span>
                      <div className="flex items-center gap-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => addConditionFromLibrary(entry)}
                          disabled={loading}
                        >
                          <Plus className="h-3 w-3" /> Add
                        </Button>
                        <button
                          className="rounded p-1 text-fg/30 hover:bg-panel2 hover:text-danger disabled:opacity-30"
                          onClick={() => removeFromLibrary(entry.id)}
                          disabled={loading}
                          title="Remove from library"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>
      </ModalBackdrop>
    </div>
  );
}

function ConditionFilterPill({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  tone: ConditionBadgeTone;
  onClick: () => void;
}) {
  const toneClasses: Record<ConditionBadgeTone, string> = {
    default: "border-line bg-panel2 text-fg/70 hover:bg-panel2/80",
    success: "border-success/20 bg-success/8 text-success hover:bg-success/12",
    warning: "border-warning/20 bg-warning/8 text-warning hover:bg-warning/12",
    danger: "border-danger/20 bg-danger/8 text-danger hover:bg-danger/12",
    info: "border-accent/20 bg-accent/8 text-accent hover:bg-accent/12",
  };
  const activeRing = "ring-2 ring-accent/40 ring-offset-1 ring-offset-panel";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
        toneClasses[tone],
        active && activeRing,
      )}
    >
      <span>{label}</span>
      <span className="rounded-full bg-bg/40 px-1.5 py-0.5 text-[9.5px] font-semibold tabular-nums">
        {count}
      </span>
    </button>
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
          <div onBlur={() => saveRevision()} onInput={() => markDirty("notes")} className="flex-1 flex flex-col min-h-[200px]">
            <RichTextEditor
              value={revDraft.notes}
              onChange={(html) => setRevDraft((d) => ({ ...d, notes: html }))}
              placeholder="Customer-facing estimate notes..."
              className="flex-1 flex flex-col"
              minHeight="100%"
            />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Notes Sub-Tab
   ═══════════════════════════════════════════════════════════════════════════ */

function RatesSubTab({
  workspace,
  onApply,
  onError,
  busy: parentBusy,
}: {
  workspace: ProjectWorkspaceData;
  onApply: (next: WorkspaceResponse | ((prev: WorkspaceResponse) => WorkspaceResponse)) => void;
  onError: (msg: string) => void;
  busy: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const busy = parentBusy || isPending;

  /* ─── Rate Schedule state ─── */

  const [showImportPicker, setShowImportPicker] = useState(false);

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

  function handleOpenImportPicker() {
    setShowImportPicker(true);
  }

  function handleDeleteSchedule(scheduleId: string) {
    startTransition(async () => {
      try {
        const patch = await deleteProjectRateSchedule(workspace.project.id, scheduleId);
        onApply((prev) => mergeWorkspacePatch(prev, patch));
      } catch (e) {
        onError(e instanceof Error ? e.message : "Delete failed.");
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
        const patch = await updateProjectRateScheduleItem(
          workspace.project.id,
          editingCell.scheduleId,
          editingCell.itemId,
          { rates: updatedRates }
        );
        onApply((prev) => mergeWorkspacePatch(prev, patch));
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
          <ImportRateSchedulesModal
            open={showImportPicker}
            onClose={() => setShowImportPicker(false)}
            projectId={workspace.project.id}
            existingScheduleIds={workspace.rateSchedules.map((s) => s.id)}
            onImported={(patch) => onApply((prev) => mergeWorkspacePatch(prev, patch))}
            onError={onError}
          />

          {/* Schedule list or empty state */}
          {workspace.rateSchedules.length === 0 ? (
            <EmptyState>
                                              No rate schedules imported. Import from your organization's rate library.
            </EmptyState>
          ) : (
            <div className="space-y-3">
              {workspace.rateSchedules.map((schedule) => {
                const expanded = expandedSchedules.has(schedule.id);
                const colorClass = categoryColors[schedule.category.toLowerCase()] ?? "bg-fg/10 text-fg/60";
                const effectiveRange = formatScheduleDateRange(schedule.effectiveDate, schedule.expiryDate);
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
                        {effectiveRange && (
                          <span className="text-xs text-fg/35">{effectiveRange}</span>
                        )}
                      </div>
                      <div
                        className="flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
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
   Estimate Search Sub-Tab
   ═══════════════════════════════════════════════════════════════════════════ */

function EstimateSearchSubTab({
  workspace,
  saveRevision,
  busy,
}: {
  workspace: ProjectWorkspaceData;
  saveRevision: (patch?: Partial<RevisionPatchInput>) => void;
  busy: boolean;
}) {
  const serverSettings = useMemo(
    () => readEstimateSearchSettings(workspace.currentRevision.pdfPreferences),
    [workspace.currentRevision.pdfPreferences],
  );
  const serverSettingsKey = useMemo(() => JSON.stringify(serverSettings), [serverSettings]);
  const [settings, setSettings] = useState<EstimateSearchSettings>(serverSettings);
  const [libraries, setLibraries] = useState<LaborUnitLibraryRecord[]>([]);
  const [librariesLoading, setLibrariesLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [libraryQuery, setLibraryQuery] = useState("");

  useEffect(() => {
    setSettings(serverSettings);
  }, [serverSettingsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let active = true;
    setLibrariesLoading(true);
    setLibraryError(null);
    listLaborUnitLibraries("all")
      .then((records) => {
        if (!active) return;
        setLibraries(records);
      })
      .catch((error) => {
        if (!active) return;
        setLibraries([]);
        setLibraryError(error instanceof Error ? error.message : "Could not load labour unit libraries.");
      })
      .finally(() => {
        if (active) setLibrariesLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const disabledSourceTypes = useMemo(() => new Set(settings.disabledSourceTypes), [settings.disabledSourceTypes]);
  const disabledLaborLibraryIds = useMemo(
    () => new Set(settings.disabledLaborLibraryIds),
    [settings.disabledLaborLibraryIds],
  );
  const disabledCatalogIds = useMemo(() => new Set(settings.disabledCatalogIds), [settings.disabledCatalogIds]);
  const enabledSourceTypeCount = LINE_ITEM_SEARCH_SOURCE_TYPES.filter((sourceType) => !disabledSourceTypes.has(sourceType)).length;
  const labourLibrariesEnabled = LABOR_SEARCH_SOURCE_TYPES.every((sourceType) => !disabledSourceTypes.has(sourceType));
  const disabledLibraryCount = libraries.filter((library) => disabledLaborLibraryIds.has(library.id)).length;
  const enabledLibraryCount = Math.max(0, libraries.length - disabledLibraryCount);
  const cataloguesEnabled = CATALOG_SEARCH_SOURCE_TYPES.every((sourceType) => !disabledSourceTypes.has(sourceType));
  const disabledCatalogCount = workspace.catalogs.filter((catalog) => disabledCatalogIds.has(catalog.id)).length;
  const enabledCatalogCount = Math.max(0, workspace.catalogs.length - disabledCatalogCount);
  const filteredLibraries = useMemo(
    () => libraries.filter((library) => searchFieldsMatch(libraryQuery, [
      library.name,
      library.description,
      library.provider,
      library.discipline,
      library.sourceDescription,
      ...(library.tags ?? []),
    ])),
    [libraries, libraryQuery],
  );
  const filteredCatalogs = useMemo(
    () => workspace.catalogs.filter((catalog) => searchFieldsMatch(catalogQuery, [
      catalog.name,
      catalog.kind,
      catalog.scope,
      catalog.description,
      catalog.source,
      catalog.sourceDescription,
    ])),
    [catalogQuery, workspace.catalogs],
  );
  const filteredLibraryIds = useMemo(() => filteredLibraries.map((library) => library.id), [filteredLibraries]);
  const filteredCatalogIds = useMemo(() => filteredCatalogs.map((catalog) => catalog.id), [filteredCatalogs]);
  const libraryGroups = useMemo(() => {
    const grouped = new Map<string, LaborUnitLibraryRecord[]>();
    for (const library of filteredLibraries) {
      const key = library.discipline?.trim() || library.provider?.trim() || "General";
      const items = grouped.get(key) ?? [];
      items.push(library);
      grouped.set(key, items);
    }
    return Array.from(grouped.entries())
      .map(([label, items]) => ({
        label,
        items: items.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [filteredLibraries]);
  const catalogGroups = useMemo(() => {
    const grouped = new Map<string, typeof workspace.catalogs>();
    for (const catalog of filteredCatalogs) {
      const key = catalog.kind?.trim() || catalog.scope?.trim() || "Catalogs";
      const items = grouped.get(key) ?? [];
      items.push(catalog);
      grouped.set(key, items);
    }
    return Array.from(grouped.entries())
      .map(([label, items]) => ({
        label,
        items: items.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [filteredCatalogs]);

  const saveSettings = useCallback((nextSettings: EstimateSearchSettings) => {
    const clean = cleanEstimateSearchSettings(nextSettings);
    setSettings(clean);
    saveRevision({
      pdfPreferences: {
        ...asPlainRecord(workspace.currentRevision.pdfPreferences),
        [ESTIMATE_SEARCH_PREF_KEY]: clean,
      },
    });
  }, [saveRevision, workspace.currentRevision.pdfPreferences]);

  const setSourceTypesEnabled = useCallback((sourceTypes: LineItemSearchSourceType[], enabled: boolean) => {
    if (busy) return;
    const nextDisabled = new Set(settings.disabledSourceTypes);
    for (const sourceType of sourceTypes) {
      if (enabled) nextDisabled.delete(sourceType);
      else nextDisabled.add(sourceType);
    }
    saveSettings({
      ...settings,
      disabledSourceTypes: Array.from(nextDisabled),
    });
  }, [busy, saveSettings, settings]);

  const setLaborLibrariesEnabled = useCallback((libraryIds: string[], enabled: boolean) => {
    if (busy) return;
    const nextDisabled = new Set(settings.disabledLaborLibraryIds);
    for (const libraryId of libraryIds) {
      if (enabled) nextDisabled.delete(libraryId);
      else nextDisabled.add(libraryId);
    }
    saveSettings({
      ...settings,
      disabledLaborLibraryIds: Array.from(nextDisabled),
    });
  }, [busy, saveSettings, settings]);

  const setCatalogsEnabled = useCallback((catalogIds: string[], enabled: boolean) => {
    if (busy) return;
    const nextDisabled = new Set(settings.disabledCatalogIds);
    for (const catalogId of catalogIds) {
      if (enabled) nextDisabled.delete(catalogId);
      else nextDisabled.add(catalogId);
    }
    saveSettings({
      ...settings,
      disabledCatalogIds: Array.from(nextDisabled),
    });
  }, [busy, saveSettings, settings]);

  return (
    <div data-field="estimateSearch" className="flex-1 min-h-0 overflow-y-auto">
      <Card className="min-h-full">
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-accent" />
                Estimate Search
              </CardTitle>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-fg/45">
                Quote-level controls for line item search sources, catalog visibility, and labour unit libraries.
              </p>
            </div>
            <span className="shrink-0 rounded-lg border border-line bg-bg/55 px-2.5 py-1 text-[11px] font-medium text-fg/55">
              {enabledSourceTypeCount}/{LINE_ITEM_SEARCH_SOURCE_TYPES.length} source types on
            </span>
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <div className="rounded-lg border border-line bg-bg/35 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-normal text-fg/35">Sources</div>
              <div className="mt-1 text-sm font-semibold text-fg">{enabledSourceTypeCount}/{LINE_ITEM_SEARCH_SOURCE_TYPES.length} enabled</div>
            </div>
            <div className="rounded-lg border border-line bg-bg/35 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-normal text-fg/35">Catalogs</div>
              <div className="mt-1 text-sm font-semibold text-fg">{enabledCatalogCount}/{workspace.catalogs.length} visible</div>
            </div>
            <div className="rounded-lg border border-line bg-bg/35 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-normal text-fg/35">Labour units</div>
              <div className="mt-1 text-sm font-semibold text-fg">
                {librariesLoading ? "Loading" : `${enabledLibraryCount}/${libraries.length} visible`}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-4">
            {ESTIMATE_SEARCH_SOURCE_CONTROLS.map((control) => {
              const enabled = control.sourceTypes.every((sourceType) => !disabledSourceTypes.has(sourceType));
              const ControlIcon = control.Icon;
              return (
                <div
                  key={control.label}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                    enabled ? "border-line bg-bg/45" : "border-line/70 bg-bg/20 opacity-65",
                  )}
                >
                  <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md border", control.accent)}>
                    <ControlIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-fg">{control.label}</div>
                        <div className="mt-0.5 truncate text-[10px] leading-4 text-fg/42">{control.detail}</div>
                      </div>
                      <Toggle
                        checked={enabled}
                        onChange={(checked) => setSourceTypesEnabled(control.sourceTypes, checked)}
                      />
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {control.sourceTypes.map((sourceType) => (
                        <span
                          key={sourceType}
                          className={cn(
                            "rounded border px-1.5 py-0.5 text-[9px] font-medium leading-3",
                            disabledSourceTypes.has(sourceType)
                              ? "border-line bg-panel2 text-fg/28"
                              : "border-accent/20 bg-accent/8 text-accent",
                          )}
                        >
                          {sourceType.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-lg border border-line bg-bg/35">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel2/25 px-3 py-3">
                <div className="min-w-0">
                  <h4 className="flex items-center gap-2 text-sm font-semibold text-fg">
                    <BookOpen className="h-4 w-4 text-fg/55" />
                    Catalogs
                  </h4>
                  <p className="mt-0.5 text-[11px] text-fg/42">
                    {cataloguesEnabled ? `${enabledCatalogCount}/${workspace.catalogs.length} visible` : "Source disabled"}
                  </p>
                </div>
                <Toggle
                  checked={cataloguesEnabled}
                  onChange={(checked) => setSourceTypesEnabled(CATALOG_SEARCH_SOURCE_TYPES, checked)}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
                <div className="relative min-w-[180px] flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/30" />
                  <Input
                    className="h-8 pl-8 text-xs"
                    value={catalogQuery}
                    onChange={(event) => setCatalogQuery(event.target.value)}
                    placeholder="Filter catalogs..."
                  />
                </div>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={busy || filteredCatalogIds.length === 0}
                  onClick={() => setCatalogsEnabled(filteredCatalogIds, true)}
                >
                  Enable visible
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={busy || filteredCatalogIds.length === 0}
                  onClick={() => setCatalogsEnabled(filteredCatalogIds, false)}
                >
                  Disable visible
                </Button>
              </div>
              <div className={cn("max-h-[420px] overflow-y-auto", !cataloguesEnabled && "opacity-55")}>
                {workspace.catalogs.length === 0 ? (
                  <div className="px-3 py-8 text-center text-xs text-fg/42">No catalogs available.</div>
                ) : filteredCatalogs.length === 0 ? (
                  <div className="px-3 py-8 text-center text-xs text-fg/42">No catalogs match this filter.</div>
                ) : (
                  catalogGroups.map((group) => {
                    const groupIds = group.items.map((catalog) => catalog.id);
                    const enabledInGroup = group.items.filter((catalog) => !disabledCatalogIds.has(catalog.id)).length;
                    const groupEnabled = enabledInGroup === group.items.length;
                    return (
                      <div key={group.label}>
                        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-panel px-3 py-1.5">
                          <div className="min-w-0">
                            <span className="block truncate text-[10px] font-semibold uppercase tracking-normal text-fg/42">{group.label}</span>
                            <span className="text-[10px] text-fg/32">{enabledInGroup}/{group.items.length} visible</span>
                          </div>
                          <Toggle
                            checked={groupEnabled}
                            onChange={(checked) => setCatalogsEnabled(groupIds, checked)}
                          />
                        </div>
                        {group.items.map((catalog) => {
                          const enabled = !disabledCatalogIds.has(catalog.id);
                          const detail = catalog.sourceDescription || catalog.description || catalog.source;
                          return (
                            <div
                              key={catalog.id}
                              className={cn(
                                "flex items-center gap-3 border-b border-line/50 px-3 py-2 last:border-b-0",
                                enabled ? "bg-bg/25" : "bg-bg/10 opacity-65",
                              )}
                            >
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-fg/10 bg-panel text-fg/55">
                                <BookOpen className="h-3.5 w-3.5" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className="truncate text-xs font-semibold text-fg">{catalog.name}</span>
                                  {catalog.scope && (
                                    <span className="shrink-0 rounded border border-line bg-panel px-1.5 py-0.5 text-[9px] leading-3 text-fg/45">
                                      {catalog.scope}
                                    </span>
                                  )}
                                </div>
                                <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] leading-3 text-fg/40">
                                  {detail && <span className="truncate">{detail}</span>}
                                  {catalog.itemCount != null && <span className="shrink-0">{catalog.itemCount.toLocaleString()} items</span>}
                                </div>
                              </div>
                              <Toggle
                                checked={enabled}
                                onChange={(checked) => setCatalogsEnabled([catalog.id], checked)}
                              />
                            </div>
                          );
                        })}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="rounded-lg border border-line bg-bg/35">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel2/25 px-3 py-3">
                <div className="min-w-0">
                  <h4 className="flex items-center gap-2 text-sm font-semibold text-fg">
                    <Hammer className="h-4 w-4 text-warning" />
                    Labour Unit Libraries
                  </h4>
                  <p className="mt-0.5 text-[11px] text-fg/42">
                    {labourLibrariesEnabled ? `${enabledLibraryCount}/${libraries.length} visible` : "Source disabled"}
                  </p>
                </div>
                <Toggle
                  checked={labourLibrariesEnabled}
                  onChange={(checked) => setSourceTypesEnabled(LABOR_SEARCH_SOURCE_TYPES, checked)}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
                <div className="relative min-w-[180px] flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/30" />
                  <Input
                    className="h-8 pl-8 text-xs"
                    value={libraryQuery}
                    onChange={(event) => setLibraryQuery(event.target.value)}
                    placeholder="Filter libraries..."
                  />
                </div>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={busy || filteredLibraryIds.length === 0}
                  onClick={() => setLaborLibrariesEnabled(filteredLibraryIds, true)}
                >
                  Enable visible
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={busy || filteredLibraryIds.length === 0}
                  onClick={() => setLaborLibrariesEnabled(filteredLibraryIds, false)}
                >
                  Disable visible
                </Button>
              </div>
              {librariesLoading ? (
                <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-fg/45">
                  <Loader2 className="h-4 w-4 animate-spin text-accent" />
                  Loading labour libraries...
                </div>
              ) : libraryError ? (
                <div className="px-3 py-8 text-center text-xs text-danger">{libraryError}</div>
              ) : libraries.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-fg/42">No labour unit libraries available.</div>
              ) : filteredLibraries.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-fg/42">No libraries match this filter.</div>
              ) : (
                <div className={cn("max-h-[420px] overflow-y-auto", !labourLibrariesEnabled && "opacity-55")}>
                  {libraryGroups.map((group) => {
                    const groupIds = group.items.map((library) => library.id);
                    const enabledInGroup = group.items.filter((library) => !disabledLaborLibraryIds.has(library.id)).length;
                    const groupEnabled = enabledInGroup === group.items.length;
                    return (
                      <div key={group.label}>
                        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-panel px-3 py-1.5">
                          <div className="min-w-0">
                            <span className="block truncate text-[10px] font-semibold uppercase tracking-normal text-fg/42">{group.label}</span>
                            <span className="text-[10px] text-fg/32">{enabledInGroup}/{group.items.length} visible</span>
                          </div>
                          <Toggle
                            checked={groupEnabled}
                            onChange={(checked) => setLaborLibrariesEnabled(groupIds, checked)}
                          />
                        </div>
                        {group.items.map((library) => {
                          const enabled = !disabledLaborLibraryIds.has(library.id);
                          const detail = library.sourceDescription || library.description || library.source;
                          return (
                            <div
                              key={library.id}
                              className={cn(
                                "flex items-center gap-3 border-b border-line/50 px-3 py-2 last:border-b-0",
                                enabled ? "bg-bg/25" : "bg-bg/10 opacity-65",
                              )}
                            >
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-warning/20 bg-warning/8 text-warning">
                                <Hammer className="h-3.5 w-3.5" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className="truncate text-xs font-semibold text-fg">{library.name}</span>
                                  {library.provider && (
                                    <span className="shrink-0 rounded border border-line bg-panel px-1.5 py-0.5 text-[9px] leading-3 text-fg/45">
                                      {library.provider}
                                    </span>
                                  )}
                                </div>
                                <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] leading-3 text-fg/40">
                                  {detail && <span className="truncate">{detail}</span>}
                                  {library.unitCount != null && <span className="shrink-0">{library.unitCount.toLocaleString()} units</span>}
                                </div>
                              </div>
                              <Toggle
                                checked={enabled}
                                onChange={(checked) => setLaborLibrariesEnabled([library.id], checked)}
                              />
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
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
  const saveQuoteRef = useRef(saveQuote);
  saveQuoteRef.current = saveQuote;
  const currentUserEmail = currentUser?.email.trim().toLowerCase() ?? "";
  const currentOrgUser = useMemo(() => {
    if (!currentUser) return null;
    return orgUsers.find((u) => u.id === currentUser.id)
      ?? orgUsers.find((u) => currentUserEmail && u.email.trim().toLowerCase() === currentUserEmail)
      ?? null;
  }, [currentUser, currentUserEmail, orgUsers]);

  // Load org users. The authenticated identity can be a super admin while
  // impersonating, so quote.userId must come from the organization users list.
  useEffect(() => {
    let cancelled = false;
    listUsers().then((users) => {
      if (!cancelled) setOrgUsers(users.filter((u) => u.active));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (quote.userId || !currentOrgUser) return;
    setUserId(currentOrgUser.id);
    saveQuoteRef.current({ userId: currentOrgUser.id });
  }, [currentOrgUser, quote.userId]);

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
                            {u.name}{u.id === currentOrgUser?.id ? " (you)" : ""}
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
