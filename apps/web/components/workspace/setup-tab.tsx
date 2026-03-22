"use client";

import { useEffect, useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  Plus,
  Save,
  Settings,
  Trash2,
} from "lucide-react";
import type {
  ConditionLibraryEntry,
  LabourRate,
  ProjectCondition,
  ProjectWorkspaceData,
  QuotePatchInput,
  RevisionPatchInput,
  WorkspaceResponse,
} from "@/lib/api";
import {
  createCondition,
  createLabourRate,
  deleteCondition,
  deleteLabourRate,
  getConditionLibrary,
  reorderConditions,
  updateCondition,
  updateLabourRate,
  updateQuote,
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
  Separator,
  Textarea,
  Toggle,
} from "@/components/ui";
import { RichTextEditor } from "@/components/rich-text-editor";
import { cn } from "@/lib/utils";

/* ─── Types ─── */

type SetupSubTab = "general" | "notes" | "rates" | "other" | "settings";

type RevisionDraft = {
  title: string;
  description: string;
  notes: string;
  breakoutStyle: string;
  phaseWorksheetEnabled: boolean;
  useCalculatedTotal: boolean;
};

export interface SetupTabProps {
  workspace: ProjectWorkspaceData;
  revDraft: RevisionDraft;
  setRevDraft: React.Dispatch<React.SetStateAction<RevisionDraft>>;
  isPending: boolean;
  onApply: (next: WorkspaceResponse) => void;
  onError: (msg: string) => void;
}

/* ─── Constants ─── */

const subTabs: Array<{ id: SetupSubTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "notes", label: "Notes & Conditions" },
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

/* ─── Main Component ─── */

export function SetupTab({
  workspace,
  revDraft,
  setRevDraft,
  isPending: parentPending,
  onApply,
  onError,
}: SetupTabProps) {
  const [subTab, setSubTab] = useState<SetupSubTab>("general");
  const [isPending, startTransition] = useTransition();
  const busy = parentPending || isPending;

  function saveRevision(patch?: Partial<RevisionPatchInput>) {
    const payload: RevisionPatchInput = {
      title: revDraft.title,
      description: revDraft.description,
      notes: revDraft.notes,
      breakoutStyle: revDraft.breakoutStyle,
      phaseWorksheetEnabled: revDraft.phaseWorksheetEnabled,
      useCalculatedTotal: revDraft.useCalculatedTotal,
      ...patch,
    };
    startTransition(async () => {
      try {
        onApply(await updateRevision(workspace.project.id, workspace.currentRevision.id, payload));
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
    <div className="space-y-4">
      {/* Sub-tab navigation */}
      <div className="flex items-center gap-1 border-b border-line pb-px">
        {subTabs.map((t) => {
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
                active
                  ? "border-accent text-accent"
                  : "border-transparent text-fg/45 hover:text-fg/70"
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {subTab === "general" && (
        <GeneralSubTab
          workspace={workspace}
          revDraft={revDraft}
          setRevDraft={setRevDraft}
          saveRevision={saveRevision}
          saveQuote={saveQuote}
          busy={busy}
        />
      )}
      {subTab === "notes" && (
        <NotesSubTab
          workspace={workspace}
          revDraft={revDraft}
          setRevDraft={setRevDraft}
          saveRevision={saveRevision}
          onApply={onApply}
          onError={onError}
          busy={busy}
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
        />
      )}
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
}: {
  workspace: ProjectWorkspaceData;
  revDraft: RevisionDraft;
  setRevDraft: React.Dispatch<React.SetStateAction<RevisionDraft>>;
  saveRevision: (patch?: Partial<RevisionPatchInput>) => void;
  saveQuote: (patch: QuotePatchInput) => void;
  busy: boolean;
}) {
  const rev = workspace.currentRevision;
  const quote = workspace.quote;

  const [customerMode, setCustomerMode] = useState<"Existing" | "New">(quote.customerExistingNew ?? "New");
  const [customerId, setCustomerId] = useState(quote.customerId ?? "");
  const [customerString, setCustomerString] = useState(quote.customerString ?? "");
  const [customerContactId, setCustomerContactId] = useState(quote.customerContactId ?? "");
  const [customerContactString, setCustomerContactString] = useState(quote.customerContactString ?? "");
  const [departmentId, setDepartmentId] = useState(quote.departmentId ?? "");
  const [quoteType, setQuoteType] = useState<"Firm" | "Budget" | "BudgetDNE">(rev.type ?? "Firm");
  const [dateQuote, setDateQuote] = useState(toDateInput(rev.dateQuote));
  const [dateDue, setDateDue] = useState(toDateInput(rev.dateDue));

  function handleSave() {
    saveQuote({
      customerExistingNew: customerMode,
      customerId: customerMode === "Existing" ? (customerId || null) : null,
      customerString: customerMode === "New" ? customerString : "",
      customerContactId: customerMode === "Existing" ? (customerContactId || null) : null,
      customerContactString: customerMode === "New" ? customerContactString : "",
      departmentId: departmentId || null,
    });
    saveRevision({
      type: quoteType,
      dateQuote: fromDateInput(dateQuote),
      dateDue: fromDateInput(dateDue),
    });
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Quote Details</CardTitle>
          <Button size="sm" onClick={handleSave} disabled={busy}>
            <Save className="h-3.5 w-3.5" />
            Save
          </Button>
        </CardHeader>
        <CardBody className="space-y-4">
          {/* Title with quote number */}
          <div>
            <Label>Quote Title</Label>
            <div className="flex items-center gap-2">
              <span className="flex h-9 shrink-0 items-center rounded-lg border border-line bg-panel2 px-3 text-sm text-fg/60">
                {quote.quoteNumber}
              </span>
              <Input
                value={revDraft.title}
                onChange={(e) => setRevDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="Quote title"
              />
            </div>
          </div>

          {/* Customer */}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Customer</Label>
              <Select
                value={customerMode}
                onChange={(e) => setCustomerMode(e.target.value as "Existing" | "New")}
              >
                <option value="Existing">Existing Customer</option>
                <option value="New">New Customer</option>
              </Select>
            </div>
            <div>
              {customerMode === "Existing" ? (
                <>
                  <Label>Customer ID</Label>
                  <Input
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    placeholder="Enter customer ID"
                  />
                </>
              ) : (
                <>
                  <Label>Customer Name</Label>
                  <Input
                    value={customerString}
                    onChange={(e) => setCustomerString(e.target.value)}
                    placeholder="Enter customer name"
                  />
                </>
              )}
            </div>
          </div>

          {/* Customer Contact */}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              {customerMode === "Existing" ? (
                <>
                  <Label>Customer Contact ID</Label>
                  <Input
                    value={customerContactId}
                    onChange={(e) => setCustomerContactId(e.target.value)}
                    placeholder="Select contact ID"
                  />
                </>
              ) : (
                <>
                  <Label>Contact Name</Label>
                  <Input
                    value={customerContactString}
                    onChange={(e) => setCustomerContactString(e.target.value)}
                    placeholder="Enter contact name"
                  />
                </>
              )}
            </div>
            <div>
              <Label>Department</Label>
              <Input
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                placeholder="Department ID"
              />
            </div>
          </div>

          {/* Type / Dates */}
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>Type</Label>
              <Select
                value={quoteType}
                onChange={(e) => setQuoteType(e.target.value as "Firm" | "Budget" | "BudgetDNE")}
              >
                <option value="Firm">Firm</option>
                <option value="Budget">Budget</option>
                <option value="BudgetDNE">Budget DNE</option>
              </Select>
            </div>
            <div>
              <Label>Quote Date</Label>
              <Input
                type="date"
                value={dateQuote}
                onChange={(e) => setDateQuote(e.target.value)}
              />
            </div>
            <div>
              <Label>Due Date</Label>
              <Input
                type="date"
                value={dateDue}
                onChange={(e) => setDateDue(e.target.value)}
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <Label>Description / Scope of Work</Label>
            <RichTextEditor
              value={revDraft.description}
              onChange={(html) => setRevDraft((d) => ({ ...d, description: html }))}
              placeholder="Scope of work description..."
              minHeight="100px"
            />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Notes & Conditions Sub-Tab
   ═══════════════════════════════════════════════════════════════════════════ */

function NotesSubTab({
  workspace,
  revDraft,
  setRevDraft,
  saveRevision,
  onApply,
  onError,
  busy,
}: {
  workspace: ProjectWorkspaceData;
  revDraft: RevisionDraft;
  setRevDraft: React.Dispatch<React.SetStateAction<RevisionDraft>>;
  saveRevision: () => void;
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

  const inclusionLibrary = library.filter((l) => l.type === "inclusion" || l.type === "Inclusion");
  const exclusionLibrary = library.filter((l) => l.type === "exclusion" || l.type === "Exclusion");

  return (
    <div className="space-y-5">
      {/* Inclusions */}
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
      />

      {/* Exclusions */}
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
      />

      {/* Notes */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Notes</CardTitle>
          <Button size="sm" onClick={saveRevision} disabled={loading}>
            <Save className="h-3.5 w-3.5" />
            Save
          </Button>
        </CardHeader>
        <CardBody>
          <RichTextEditor
            value={revDraft.notes}
            onChange={(html) => setRevDraft((d) => ({ ...d, notes: html }))}
            placeholder="General notes..."
            minHeight="100px"
          />
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
}) {
  const [newValue, setNewValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
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

  function handleImport(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    if (!val) return;
    addCondition(val);
    e.target.value = "";
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{title}</CardTitle>
        {libraryEntries.length > 0 && (
          <Select className="w-48" onChange={handleImport} value="">
            <option value="">Import from library...</option>
            {libraryEntries.map((entry) => (
              <option key={entry.id} value={entry.value}>
                {entry.value.length > 60 ? entry.value.slice(0, 57) + "..." : entry.value}
              </option>
            ))}
          </Select>
        )}
      </CardHeader>
      <CardBody className="space-y-3">
        {conditions.length === 0 ? (
          <EmptyState>No {title.toLowerCase()} added</EmptyState>
        ) : (
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
        )}

        <div className="flex items-center gap-2">
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
      </CardBody>
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

  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [rateDraft, setRateDraft] = useState<{
    name: string;
    regularRate: string;
    overtimeRate: string;
    doubleRate: string;
  }>({ name: "", regularRate: "", overtimeRate: "", doubleRate: "" });

  function startEditRate(rate: LabourRate) {
    setEditingRateId(rate.id);
    setRateDraft({
      name: rate.name,
      regularRate: String(rate.regularRate),
      overtimeRate: String(rate.overtimeRate),
      doubleRate: String(rate.doubleRate),
    });
  }

  function cancelEditRate() {
    setEditingRateId(null);
    setRateDraft({ name: "", regularRate: "", overtimeRate: "", doubleRate: "" });
  }

  function saveRate(rateId: string) {
    startTransition(async () => {
      try {
        onApply(
          await updateLabourRate(workspace.project.id, rateId, {
            name: rateDraft.name,
            regularRate: parseNum(rateDraft.regularRate),
            overtimeRate: parseNum(rateDraft.overtimeRate),
            doubleRate: parseNum(rateDraft.doubleRate),
          })
        );
        setEditingRateId(null);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Update failed.");
      }
    });
  }

  function addRate() {
    startTransition(async () => {
      try {
        onApply(
          await createLabourRate(workspace.project.id, {
            name: "New Rate",
            regularRate: 0,
            overtimeRate: 0,
            doubleRate: 0,
          })
        );
      } catch (e) {
        onError(e instanceof Error ? e.message : "Add failed.");
      }
    });
  }

  function removeRate(id: string) {
    startTransition(async () => {
      try {
        onApply(await deleteLabourRate(workspace.project.id, id));
      } catch (e) {
        onError(e instanceof Error ? e.message : "Delete failed.");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Labour Rates</CardTitle>
        <Button size="sm" onClick={addRate} disabled={busy}>
          <Plus className="h-3.5 w-3.5" />
          Add Rate
        </Button>
      </CardHeader>
      <CardBody>
        {(workspace.labourRates ?? []).length === 0 ? (
          <EmptyState>No labour rates defined</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-fg/40">
                  <th className="pb-2 pr-4 font-medium">Name</th>
                  <th className="pb-2 pr-4 font-medium text-right">Regular Rate ($)</th>
                  <th className="pb-2 pr-4 font-medium text-right">Overtime Rate ($)</th>
                  <th className="pb-2 pr-4 font-medium text-right">Double-Time Rate ($)</th>
                  <th className="pb-2 font-medium text-right w-20" />
                </tr>
              </thead>
              <tbody>
                {(workspace.labourRates ?? []).map((rate) => (
                  <tr key={rate.id} className="border-b border-line/50 last:border-0">
                    {editingRateId === rate.id ? (
                      <>
                        <td className="py-2 pr-4">
                          <Input
                            value={rateDraft.name}
                            onChange={(e) => setRateDraft((d) => ({ ...d, name: e.target.value }))}
                            className="h-8"
                            autoFocus
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <Input
                            type="number"
                            step="0.01"
                            value={rateDraft.regularRate}
                            onChange={(e) => setRateDraft((d) => ({ ...d, regularRate: e.target.value }))}
                            className="h-8 text-right"
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <Input
                            type="number"
                            step="0.01"
                            value={rateDraft.overtimeRate}
                            onChange={(e) => setRateDraft((d) => ({ ...d, overtimeRate: e.target.value }))}
                            className="h-8 text-right"
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <Input
                            type="number"
                            step="0.01"
                            value={rateDraft.doubleRate}
                            onChange={(e) => setRateDraft((d) => ({ ...d, doubleRate: e.target.value }))}
                            className="h-8 text-right"
                          />
                        </td>
                        <td className="py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="xs" onClick={() => saveRate(rate.id)} disabled={busy}>
                              <Save className="h-3 w-3" />
                            </Button>
                            <Button size="xs" variant="ghost" onClick={cancelEditRate}>
                              Cancel
                            </Button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td
                          className="py-2 pr-4 cursor-pointer"
                          onDoubleClick={() => startEditRate(rate)}
                        >
                          {rate.name}
                        </td>
                        <td
                          className="py-2 pr-4 text-right tabular-nums cursor-pointer"
                          onDoubleClick={() => startEditRate(rate)}
                        >
                          ${rate.regularRate.toFixed(2)}
                        </td>
                        <td
                          className="py-2 pr-4 text-right tabular-nums cursor-pointer"
                          onDoubleClick={() => startEditRate(rate)}
                        >
                          ${rate.overtimeRate.toFixed(2)}
                        </td>
                        <td
                          className="py-2 pr-4 text-right tabular-nums cursor-pointer"
                          onDoubleClick={() => startEditRate(rate)}
                        >
                          ${rate.doubleRate.toFixed(2)}
                        </td>
                        <td className="py-2 text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity [tr:hover_&]:opacity-100">
                            <button
                              className="rounded p-1 text-fg/30 hover:bg-panel2 hover:text-fg/60"
                              onClick={() => startEditRate(rate)}
                            >
                              <Settings className="h-3 w-3" />
                            </button>
                            <button
                              className="rounded p-1 text-fg/30 hover:bg-panel2 hover:text-danger"
                              onClick={() => removeRate(rate.id)}
                              disabled={busy}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
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

  const [dateEstimatedShip, setDateEstimatedShip] = useState(toDateInput(rev.dateEstimatedShip));
  const [shippingMethod, setShippingMethod] = useState(rev.shippingMethod ?? "");
  const [freightOnBoard, setFreightOnBoard] = useState(rev.freightOnBoard ?? "");
  const [dateWalkdown, setDateWalkdown] = useState(toDateInput(rev.dateWalkdown));
  const [dateWorkStart, setDateWorkStart] = useState(toDateInput(rev.dateWorkStart));
  const [dateWorkEnd, setDateWorkEnd] = useState(toDateInput(rev.dateWorkEnd));
  const [followUpNote, setFollowUpNote] = useState(rev.followUpNote ?? "");
  const [userId, setUserId] = useState(quote.userId ?? "");

  function handleSave() {
    saveRevision({
      dateEstimatedShip: fromDateInput(dateEstimatedShip),
      shippingMethod,
      freightOnBoard,
      dateWalkdown: fromDateInput(dateWalkdown),
      dateWorkStart: fromDateInput(dateWorkStart),
      dateWorkEnd: fromDateInput(dateWorkEnd),
      followUpNote,
    });
    if (userId !== (quote.userId ?? "")) {
      saveQuote({ userId: userId || null });
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Shipping & Logistics</CardTitle>
          <Button size="sm" onClick={handleSave} disabled={busy}>
            <Save className="h-3.5 w-3.5" />
            Save
          </Button>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>Estimated Ship Date</Label>
              <Input
                type="date"
                value={dateEstimatedShip}
                onChange={(e) => setDateEstimatedShip(e.target.value)}
              />
            </div>
            <div>
              <Label>Shipping Method</Label>
              <Input
                value={shippingMethod}
                onChange={(e) => setShippingMethod(e.target.value)}
                placeholder="e.g. Ground, Air, LTL"
              />
            </div>
            <div>
              <Label>Freight On Board</Label>
              <Input
                value={freightOnBoard}
                onChange={(e) => setFreightOnBoard(e.target.value)}
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
                onChange={(e) => setDateWalkdown(e.target.value)}
              />
            </div>
            <div>
              <Label>Work Start Date</Label>
              <Input
                type="date"
                value={dateWorkStart}
                onChange={(e) => setDateWorkStart(e.target.value)}
              />
            </div>
            <div>
              <Label>Work End Date</Label>
              <Input
                type="date"
                value={dateWorkEnd}
                onChange={(e) => setDateWorkEnd(e.target.value)}
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
              placeholder="Follow-up notes..."
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Estimator / User</Label>
              <Input
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="User ID"
              />
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
}: {
  workspace: ProjectWorkspaceData;
  revDraft: RevisionDraft;
  setRevDraft: React.Dispatch<React.SetStateAction<RevisionDraft>>;
  saveRevision: (patch?: Partial<RevisionPatchInput>) => void;
  busy: boolean;
}) {
  const rev = workspace.currentRevision;

  const [defaultMarkup, setDefaultMarkup] = useState(String(rev.defaultMarkup ?? 0));
  const [printEmptyNotesColumn, setPrintEmptyNotesColumn] = useState(rev.printEmptyNotesColumn ?? false);
  const [printPhaseTotalOnly, setPrintPhaseTotalOnly] = useState(rev.printPhaseTotalOnly ?? false);
  const [showOvertimeDoubletime, setShowOvertimeDoubletime] = useState(rev.showOvertimeDoubletime ?? false);
  const [necaDifficulty, setNecaDifficulty] = useState(rev.necaDifficulty ?? "Normal");

  function handleSave() {
    saveRevision({
      defaultMarkup: parseNum(defaultMarkup),
      printEmptyNotesColumn,
      printPhaseTotalOnly,
      showOvertimeDoubletime,
      necaDifficulty,
    });
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Worksheet Settings</CardTitle>
          <Button size="sm" onClick={handleSave} disabled={busy}>
            <Save className="h-3.5 w-3.5" />
            Save
          </Button>
        </CardHeader>
        <CardBody className="space-y-5">
          {/* Phase worksheet toggle */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-fg">Phase Worksheet Mode</div>
              <div className="text-xs text-fg/40">Enable phase-based worksheet organization</div>
            </div>
            <Toggle
              checked={revDraft.phaseWorksheetEnabled}
              onChange={(checked) => {
                setRevDraft((d) => ({ ...d, phaseWorksheetEnabled: checked }));
                saveRevision({ phaseWorksheetEnabled: checked });
              }}
            />
          </div>

          <Separator />

          {/* Use calculated total */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-fg">Use Calculated Total</div>
              <div className="text-xs text-fg/40">
                Derive quote total from line items instead of manual entry
              </div>
            </div>
            <Toggle
              checked={revDraft.useCalculatedTotal}
              onChange={(checked) => {
                setRevDraft((d) => ({ ...d, useCalculatedTotal: checked }));
                saveRevision({ useCalculatedTotal: checked });
              }}
            />
          </div>

          <Separator />

          {/* Default Markup */}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Default Markup (%)</Label>
              <Input
                type="number"
                step="0.1"
                value={defaultMarkup}
                onChange={(e) => setDefaultMarkup(e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <Label>NECA Difficulty</Label>
              <Select
                value={necaDifficulty}
                onChange={(e) => setNecaDifficulty(e.target.value)}
              >
                <option value="Normal">Normal</option>
                <option value="Difficult">Difficult</option>
                <option value="Very Difficult">Very Difficult</option>
              </Select>
            </div>
          </div>

          <Separator />

          {/* Print settings */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-fg">Print Empty Notes Column</div>
              <div className="text-xs text-fg/40">Include an empty notes column on printed output</div>
            </div>
            <Toggle
              checked={printEmptyNotesColumn}
              onChange={setPrintEmptyNotesColumn}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-fg">Print Phase Total Only</div>
              <div className="text-xs text-fg/40">Show only phase totals on printed output, hide line details</div>
            </div>
            <Toggle
              checked={printPhaseTotalOnly}
              onChange={setPrintPhaseTotalOnly}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-fg">Show Overtime / Doubletime</div>
              <div className="text-xs text-fg/40">Display overtime and double-time columns in worksheets</div>
            </div>
            <Toggle
              checked={showOvertimeDoubletime}
              onChange={setShowOvertimeDoubletime}
            />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
