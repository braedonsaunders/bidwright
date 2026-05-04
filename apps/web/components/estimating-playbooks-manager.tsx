"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  ClipboardList,
  Database,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from "lucide-react";

import {
  Badge,
  Button,
  Input,
  Label,
  MultiSelect,
  Select,
  Textarea,
  Toggle,
} from "@/components/ui";
import {
  createPersona,
  deletePersona,
  listKnowledgeBooks,
  listKnowledgeDocuments,
  listPersonas,
  updatePersona,
  type EstimatorPersona,
  type KnowledgeBookRecord,
  type KnowledgeDocumentRecord,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type JsonObject = Record<string, unknown>;

type RoleCoverageRole = {
  id: string;
  label: string;
  aliases: string[];
  ratio: string;
  threshold: string;
  placement: string;
  notes: string;
};

type RoleCoveragePolicy = {
  coverageMode: string;
  roles: RoleCoverageRole[];
  overheadWorksheetMatchers: string[];
};

const pricingModeOptions = [
  { value: "detailed", label: "Detailed build-up" },
  { value: "allowance", label: "Allowance" },
  { value: "subcontract", label: "External price" },
  { value: "historical_allowance", label: "Historical allowance" },
];

const coverageModeOptions = [
  { value: "single_source", label: "Single source" },
  { value: "embedded", label: "Embedded in work packages" },
  { value: "general_conditions", label: "Shared overhead package" },
  { value: "hybrid", label: "Hybrid with documented split" },
];

const executionModeOptions = [
  { value: "", label: "No default" },
  { value: "self_perform", label: "Internal execution" },
  { value: "subcontract", label: "External provider" },
  { value: "allowance", label: "Allowance" },
  { value: "historical_allowance", label: "Historical allowance" },
  { value: "mixed", label: "Mixed" },
];

function emptyPlaybook(order: number): EstimatorPersona {
  return {
    id: `new-${Date.now()}`,
    organizationId: "",
    name: "",
    trade: "general",
    description: "",
    systemPrompt: "",
    knowledgeBookIds: [],
    knowledgeDocumentIds: [],
    datasetTags: [],
    packageBuckets: [],
    defaultAssumptions: {},
    productivityGuidance: {
      roleCoverage: {
        coverageMode: "single_source",
        roles: [],
        overheadWorksheetMatchers: ["general conditions", "overhead", "shared support"],
      },
    },
    commercialGuidance: {
      packaging: {
        weakEvidencePricingMode: "allowance",
        offsiteProductionPricingMode: "detailed",
      },
    },
    reviewFocusAreas: [],
    isDefault: false,
    enabled: true,
    order,
    createdAt: "",
    updatedAt: "",
  };
}

function asObject(value: unknown): JsonObject {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function parseJsonForSave(value: unknown, label: string): JsonObject {
  if (typeof value !== "string") return asObject(value);
  const trimmed = value.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as JsonObject;
  } catch (error) {
    throw new Error(`${label} is not valid JSON.`);
  }
  throw new Error(`${label} must be a JSON object.`);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinList(value: unknown): string {
  return asStringArray(value).join(", ");
}

function jsonDisplay(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(asObject(value), null, 2);
}

function normalizeRole(raw: unknown, index: number): RoleCoverageRole {
  const role = asObject(raw);
  return {
    id: String(role.id ?? `role-${index + 1}`),
    label: String(role.label ?? role.name ?? ""),
    aliases: asStringArray(role.aliases),
    ratio: String(role.ratio ?? role.coverageRatio ?? ""),
    threshold: String(role.threshold ?? role.escalationThreshold ?? ""),
    placement: String(role.placement ?? ""),
    notes: String(role.notes ?? ""),
  };
}

function roleCoverageFrom(productivityGuidanceValue: unknown): RoleCoveragePolicy {
  const productivityGuidance = asObject(productivityGuidanceValue);
  const roleCoverage = asObject(
    productivityGuidance.roleCoverage
      ?? productivityGuidance.management
      ?? productivityGuidance.supervision,
  );
  const legacySupervision = asObject(productivityGuidance.supervision);
  const roles = Array.isArray(roleCoverage.roles)
    ? roleCoverage.roles.map((role, index) => {
      if (typeof role === "string") return normalizeRole({ label: role }, index);
      return normalizeRole(role, index);
    })
    : [];

  const legacyRoles: RoleCoverageRole[] = [];
  if (legacySupervision.foremanToTrades) {
    legacyRoles.push({
      id: "coordination-lead",
      label: "Coordination lead",
      aliases: ["foreman", "lead", "supervisor"],
      ratio: String(legacySupervision.foremanToTrades),
      threshold: "",
      placement: "",
      notes: "Imported from legacy foreman-to-trades policy.",
    });
  }
  if (legacySupervision.superintendentThresholdWeeks) {
    legacyRoles.push({
      id: "senior-oversight",
      label: "Senior oversight",
      aliases: ["superintendent", "project manager", "program manager"],
      ratio: "",
      threshold: `${legacySupervision.superintendentThresholdWeeks} weeks`,
      placement: "",
      notes: "Imported from legacy duration threshold policy.",
    });
  }

  return {
    coverageMode: String(
      roleCoverage.coverageMode
        ?? productivityGuidance.roleCoverageMode
        ?? productivityGuidance.supervisionMode
        ?? legacySupervision.coverageMode
        ?? "single_source",
    ),
    roles: roles.length > 0 ? roles : legacyRoles,
    overheadWorksheetMatchers: asStringArray(roleCoverage.overheadWorksheetMatchers).length > 0
      ? asStringArray(roleCoverage.overheadWorksheetMatchers)
      : ["general conditions", "overhead", "shared support"],
  };
}

function packagingFrom(commercialGuidanceValue: unknown): JsonObject {
  return asObject(asObject(commercialGuidanceValue).packaging);
}

function patchNestedJson(
  rootValue: unknown,
  section: string,
  patch: JsonObject,
): JsonObject {
  const root = asObject(rootValue);
  const current = asObject(root[section]);
  return {
    ...root,
    [section]: {
      ...current,
      ...patch,
    },
  };
}

function patchProductivityRoleCoverage(currentValue: unknown, patch: Partial<RoleCoveragePolicy>): JsonObject {
  const current = asObject(currentValue);
  const roleCoverage = roleCoverageFrom(current);
  return {
    ...current,
    roleCoverage: {
      ...roleCoverage,
      ...patch,
    },
  };
}

function normalizePlaybookForSave(playbook: EstimatorPersona): Partial<EstimatorPersona> {
  return {
    ...playbook,
    name: playbook.name.trim(),
    trade: playbook.trade.trim() || "general",
    description: playbook.description.trim(),
    systemPrompt: playbook.systemPrompt,
    knowledgeBookIds: playbook.knowledgeBookIds ?? [],
    knowledgeDocumentIds: playbook.knowledgeDocumentIds ?? [],
    datasetTags: playbook.datasetTags ?? [],
    packageBuckets: playbook.packageBuckets ?? [],
    reviewFocusAreas: playbook.reviewFocusAreas ?? [],
    defaultAssumptions: parseJsonForSave(playbook.defaultAssumptions, "Default assumptions"),
    productivityGuidance: parseJsonForSave(playbook.productivityGuidance, "Productivity guidance"),
    commercialGuidance: parseJsonForSave(playbook.commercialGuidance, "Commercial guidance"),
  };
}

function LibraryStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 rounded-md border border-line/65 bg-bg/35 px-2 py-1.5">
      <div className="truncate text-[10px] text-fg/35">{label}</div>
      <div className="truncate text-xs font-semibold tabular-nums text-fg/75">{value}</div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  detail,
}: {
  icon: typeof ClipboardList;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-bg/50 text-accent">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-semibold text-fg">{title}</div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-fg/45">{detail}</div>
      </div>
    </div>
  );
}

function RawJsonField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Textarea
        className="min-h-[120px] resize-y font-mono text-xs leading-relaxed"
        value={jsonDisplay(value)}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function EstimatingPlaybooksManager({
  initialPlaybooks = [],
  initialKnowledgeBooks = [],
  initialKnowledgeDocuments = [],
  onPlaybooksChange,
}: {
  initialPlaybooks?: EstimatorPersona[];
  initialKnowledgeBooks?: KnowledgeBookRecord[];
  initialKnowledgeDocuments?: KnowledgeDocumentRecord[];
  onPlaybooksChange?: (playbooks: EstimatorPersona[]) => void;
}) {
  const [playbooks, setPlaybooks] = useState<EstimatorPersona[]>(initialPlaybooks);
  const [knowledgeBooks, setKnowledgeBooks] = useState<KnowledgeBookRecord[]>(initialKnowledgeBooks);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocumentRecord[]>(initialKnowledgeDocuments);
  const [selectedId, setSelectedId] = useState<string | null>(initialPlaybooks[0]?.id ?? null);
  const [edits, setEdits] = useState<Record<string, Partial<EstimatorPersona>>>({});
  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPlaybooks(initialPlaybooks);
    setSelectedId((current) => current && initialPlaybooks.some((playbook) => playbook.id === current)
      ? current
      : initialPlaybooks[0]?.id ?? null);
  }, [initialPlaybooks]);

  useEffect(() => {
    setKnowledgeBooks(initialKnowledgeBooks);
  }, [initialKnowledgeBooks]);

  useEffect(() => {
    setKnowledgeDocuments(initialKnowledgeDocuments);
  }, [initialKnowledgeDocuments]);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      listPersonas(),
      listKnowledgeBooks(),
      listKnowledgeDocuments(),
    ]).then(([playbooksResult, booksResult, documentsResult]) => {
      if (!active) return;
      if (playbooksResult.status === "fulfilled") {
        const sorted = [...playbooksResult.value].sort((left, right) => left.order - right.order);
        setPlaybooks(sorted);
        onPlaybooksChange?.(sorted);
        setSelectedId((current) => current && sorted.some((playbook) => playbook.id === current)
          ? current
          : sorted[0]?.id ?? null);
      }
      if (booksResult.status === "fulfilled") setKnowledgeBooks(booksResult.value);
      if (documentsResult.status === "fulfilled") setKnowledgeDocuments(documentsResult.value);
    }).catch(() => {});
    return () => { active = false; };
  }, [onPlaybooksChange]);

  const publishPlaybooks = useCallback((next: EstimatorPersona[]) => {
    setPlaybooks(next);
    onPlaybooksChange?.(next);
  }, [onPlaybooksChange]);

  const visiblePlaybooks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return playbooks;
    return playbooks.filter((playbook) =>
      [playbook.name, playbook.trade, playbook.description, playbook.datasetTags?.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [playbooks, query]);

  const selectedBase = selectedId ? playbooks.find((playbook) => playbook.id === selectedId) ?? null : null;
  const selected = selectedBase
    ? { ...selectedBase, ...(edits[selectedBase.id] ?? {}) } as EstimatorPersona
    : null;

  const updateEdit = useCallback((id: string, patch: Partial<EstimatorPersona>) => {
    setEdits((previous) => ({
      ...previous,
      [id]: {
        ...previous[id],
        ...patch,
      },
    }));
  }, []);

  const addPlaybook = useCallback(() => {
    const next = emptyPlaybook(playbooks.length);
    publishPlaybooks([...playbooks, next]);
    setSelectedId(next.id);
    setError(null);
  }, [playbooks, publishPlaybooks]);

  const savePlaybook = useCallback(async (playbook: EstimatorPersona) => {
    setError(null);
    if (!playbook.name.trim()) {
      setError("Estimator name is required.");
      return;
    }
    setSavingId(playbook.id);
    try {
      const normalized = normalizePlaybookForSave(playbook);
      if (playbook.id.startsWith("new-")) {
        const created = await createPersona(normalized);
        const next = playbooks.map((candidate) => candidate.id === playbook.id ? created : candidate);
        publishPlaybooks(next);
        setSelectedId(created.id);
        setEdits((previous) => {
          const copy = { ...previous };
          delete copy[playbook.id];
          return copy;
        });
      } else {
        const updated = await updatePersona(playbook.id, normalized);
        const next = playbooks.map((candidate) => candidate.id === playbook.id ? updated : candidate);
        publishPlaybooks(next);
        setEdits((previous) => {
          const copy = { ...previous };
          delete copy[playbook.id];
          return copy;
        });
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Estimator could not be saved.");
    } finally {
      setSavingId(null);
    }
  }, [playbooks, publishPlaybooks]);

  const deletePlaybook = useCallback(async (playbook: EstimatorPersona) => {
    setError(null);
    try {
      if (!playbook.id.startsWith("new-")) await deletePersona(playbook.id);
      const next = playbooks.filter((candidate) => candidate.id !== playbook.id);
      publishPlaybooks(next);
      setSelectedId(next[0]?.id ?? null);
      setEdits((previous) => {
        const copy = { ...previous };
        delete copy[playbook.id];
        return copy;
      });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Estimator could not be deleted.");
    } finally {
      setDeleteConfirmId(null);
    }
  }, [playbooks, publishPlaybooks]);

  const setEnabled = useCallback((playbook: EstimatorPersona, enabled: boolean) => {
    updateEdit(playbook.id, { enabled });
    if (!playbook.id.startsWith("new-")) {
      updatePersona(playbook.id, { enabled })
        .then((updated) => publishPlaybooks(playbooks.map((candidate) => candidate.id === updated.id ? updated : candidate)))
        .catch(() => {});
    }
  }, [playbooks, publishPlaybooks, updateEdit]);

  const activeCount = playbooks.filter((playbook) => playbook.enabled !== false).length;
  const defaultCount = playbooks.filter((playbook) => playbook.isDefault).length;
  const boundSourceCount = playbooks.reduce(
    (sum, playbook) => sum + (playbook.knowledgeBookIds?.length ?? 0) + (playbook.knowledgeDocumentIds?.length ?? 0) + (playbook.datasetTags?.length ?? 0),
    0,
  );

  const defaultAssumptions = asObject(selected?.defaultAssumptions);
  const productivityGuidance = asObject(selected?.productivityGuidance);
  const commercialGuidance = asObject(selected?.commercialGuidance);
  const roleCoverage = roleCoverageFrom(productivityGuidance);
  const packaging = packagingFrom(commercialGuidance);
  const externalPricingDefaults = asStringArray(defaultAssumptions.externalPricingDefaults).length > 0
    ? asStringArray(defaultAssumptions.externalPricingDefaults)
    : asStringArray(defaultAssumptions.subcontractDefaults);
  const methodology = asObject(productivityGuidance.methodology);

  return (
    <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-panel">
        <div className="shrink-0 border-b border-line px-3 py-2">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-fg">Estimators</div>
              <div className="mt-0.5 truncate text-[11px] text-fg/45">Reusable estimator behavior, policy, and source bindings</div>
            </div>
            <Button size="xs" variant="accent" onClick={addPlaybook}>
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <LibraryStat label="Total" value={playbooks.length} />
            <LibraryStat label="Active" value={activeCount} />
            <LibraryStat label="Bindings" value={boundSourceCount} />
          </div>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/30" />
            <Input
              className="h-8 pl-8 text-xs"
              placeholder="Search estimators"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {visiblePlaybooks.map((playbook) => {
            const edited = { ...playbook, ...(edits[playbook.id] ?? {}) } as EstimatorPersona;
            const active = playbook.id === selectedId;
            return (
              <button
                key={playbook.id}
                type="button"
                onClick={() => setSelectedId(playbook.id)}
                className={cn(
                  "mb-2 flex w-full min-w-0 flex-col rounded-lg border px-3 py-2 text-left transition-colors",
                  active ? "border-accent/45 bg-accent/8" : "border-line bg-bg/35 hover:border-fg/20 hover:bg-panel2/40",
                )}
              >
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-fg">{edited.name || "Untitled estimator"}</div>
                    <div className="mt-0.5 truncate text-[10px] text-fg/40">{edited.trade || "general"}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {edited.isDefault && <Star className="h-3.5 w-3.5 fill-warning text-warning" />}
                    <Badge tone={edited.enabled === false ? "default" : "success"}>{edited.enabled === false ? "Off" : "On"}</Badge>
                  </div>
                </div>
                {edited.description && (
                  <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-fg/45">{edited.description}</div>
                )}
                <div className="mt-2 flex min-w-0 flex-wrap gap-1">
                  {(edited.packageBuckets ?? []).slice(0, 3).map((bucket) => (
                    <span key={bucket} className="rounded bg-panel2 px-1.5 py-0.5 text-[10px] text-fg/45">{bucket}</span>
                  ))}
                </div>
              </button>
            );
          })}
          {visiblePlaybooks.length === 0 && (
            <div className="px-3 py-10 text-center text-sm text-fg/40">No estimators match this search.</div>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-panel">
        {selected ? (
          <>
            <div className="shrink-0 border-b border-line px-3 py-2">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <h2 className="truncate text-sm font-semibold text-fg">{selected.name || "Untitled estimator"}</h2>
                    {selected.isDefault && <Badge tone="warning">Default</Badge>}
                    <Badge tone={selected.enabled === false ? "default" : "success"}>{selected.enabled === false ? "Disabled" : "Enabled"}</Badge>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-fg/45">Domain, source bindings, estimating policy, and raw JSON override surface</div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {deleteConfirmId === selected.id ? (
                    <>
                      <Button size="xs" variant="danger" onClick={() => deletePlaybook(selected)}>
                        <Check className="h-3.5 w-3.5" />
                        Confirm
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => setDeleteConfirmId(null)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  ) : (
                    <Button size="xs" variant="ghost" onClick={() => setDeleteConfirmId(selected.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button size="xs" variant="accent" onClick={() => savePlaybook(selected)} disabled={savingId === selected.id}>
                    <Save className="h-3.5 w-3.5" />
                    {savingId === selected.id ? "Saving" : "Save"}
                  </Button>
                </div>
              </div>
              {error && <div className="mt-2 rounded-md border border-danger/25 bg-danger/8 px-2 py-1.5 text-xs text-danger">{error}</div>}
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-3">
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
                <div className="space-y-3">
                  <section className="rounded-lg border border-line/70 bg-bg/25 p-3">
                    <SectionHeader
                      icon={ClipboardList}
                      title="Identity"
                      detail="Use domain-neutral labels. Discipline can be construction, manufacturing, software services, facilities, maintenance, or any other estimating context."
                    />
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div>
                        <Label>Name</Label>
                        <Input value={selected.name} onChange={(event) => updateEdit(selected.id, { name: event.target.value })} placeholder="Industrial shutdown estimator" />
                      </div>
                      <div>
                        <Label>Domain / Discipline</Label>
                        <Input value={selected.trade} onChange={(event) => updateEdit(selected.id, { trade: event.target.value })} placeholder="mechanical, electrical, SaaS services, facilities" />
                      </div>
                    </div>
                    <div className="mt-3">
                      <Label>Description</Label>
                      <Input value={selected.description} onChange={(event) => updateEdit(selected.id, { description: event.target.value })} placeholder="What this estimator is best at" />
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className="flex items-center justify-between gap-3 rounded-md border border-line/65 bg-panel px-3 py-2 text-sm text-fg">
                        <span>Default estimator</span>
                        <input
                          type="checkbox"
                          checked={selected.isDefault}
                          onChange={(event) => updateEdit(selected.id, { isDefault: event.target.checked })}
                          className="rounded border-line"
                        />
                      </label>
                      <div className="flex items-center justify-between gap-3 rounded-md border border-line/65 bg-panel px-3 py-2">
                        <span className="text-sm text-fg">Enabled</span>
                        <Toggle checked={selected.enabled !== false} onChange={(enabled) => setEnabled(selected, enabled)} />
                      </div>
                    </div>
                  </section>

                  <section className="rounded-lg border border-line/70 bg-bg/25 p-3">
                    <SectionHeader
                      icon={BookOpen}
                      title="Library Bindings"
                      detail="Prioritize specific library sources while still allowing the agent to search the full library when evidence is missing."
                    />
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div>
                        <Label>Priority Knowledge Books</Label>
                        <MultiSelect
                          options={knowledgeBooks
                            .filter((book) => book.status === "indexed")
                            .map((book) => ({
                              value: book.id,
                              label: book.name,
                              description: `${book.category} - ${book.pageCount} pages`,
                            }))}
                          selected={selected.knowledgeBookIds ?? []}
                          onChange={(knowledgeBookIds) => updateEdit(selected.id, { knowledgeBookIds })}
                          placeholder="Select books"
                        />
                      </div>
                      <div>
                        <Label>Priority Knowledge Pages</Label>
                        <MultiSelect
                          options={knowledgeDocuments
                            .filter((document) => document.status === "indexed" || document.status === "draft")
                            .map((document) => ({
                              value: document.id,
                              label: document.title,
                              description: `${document.category} - ${(document.tags ?? []).join(", ")}`,
                            }))}
                          selected={selected.knowledgeDocumentIds ?? []}
                          onChange={(knowledgeDocumentIds) => updateEdit(selected.id, { knowledgeDocumentIds })}
                          placeholder="Select page libraries"
                        />
                      </div>
                      <div>
                        <Label>Dataset Tags</Label>
                        <Input
                          value={(selected.datasetTags ?? []).join(", ")}
                          onChange={(event) => updateEdit(selected.id, { datasetTags: splitList(event.target.value) })}
                          placeholder="labor-units, vendor-costs, benchmarks"
                        />
                      </div>
                      <div>
                        <Label>Package Buckets</Label>
                        <Input
                          value={(selected.packageBuckets ?? []).join(", ")}
                          onChange={(event) => updateEdit(selected.id, { packageBuckets: splitList(event.target.value) })}
                          placeholder="Discovery, Production, QA, Overhead"
                        />
                      </div>
                    </div>
                  </section>

                  <section className="rounded-lg border border-line/70 bg-bg/25 p-3">
                    <SectionHeader
                      icon={SlidersHorizontal}
                      title="Methodology"
                      detail="These fields guide how the agent breaks work down, which quantities drive effort, and which factors must be checked before pricing."
                    />
                    <div className="mt-3 grid gap-3">
                      <div>
                        <Label>Breakdown Axes</Label>
                        <Input
                          value={joinList(methodology.breakdownAxes ?? productivityGuidance.breakdownAxes)}
                          onChange={(event) => updateEdit(selected.id, {
                            productivityGuidance: patchNestedJson(productivityGuidance, "methodology", { breakdownAxes: splitList(event.target.value) }),
                          })}
                          placeholder="system, location, phase, size class, complexity"
                        />
                      </div>
                      <div>
                        <Label>Quantity Drivers</Label>
                        <Input
                          value={joinList(methodology.quantityDrivers ?? productivityGuidance.quantityDrivers)}
                          onChange={(event) => updateEdit(selected.id, {
                            productivityGuidance: patchNestedJson(productivityGuidance, "methodology", { quantityDrivers: splitList(event.target.value) }),
                          })}
                          placeholder="units, hours, transactions, devices, joints, assets"
                        />
                      </div>
                      <div>
                        <Label>Correction Factors</Label>
                        <Input
                          value={joinList(methodology.correctionFactors ?? productivityGuidance.correctionFactors)}
                          onChange={(event) => updateEdit(selected.id, {
                            productivityGuidance: patchNestedJson(productivityGuidance, "methodology", { correctionFactors: splitList(event.target.value) }),
                          })}
                          placeholder="access, complexity, material, region, schedule pressure"
                        />
                      </div>
                    </div>
                  </section>
                </div>

                <div className="space-y-3">
                  <section className="rounded-lg border border-line/70 bg-bg/25 p-3">
                    <SectionHeader
                      icon={Database}
                      title="Commercial Policy"
                      detail="Control when weak evidence becomes an allowance, when external providers should be used, and how offsite or preproduction work is priced."
                    />
                    <div className="mt-3 grid gap-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <Label>Evidence-Light Pricing</Label>
                          <Select
                            value={String(packaging.weakEvidencePricingMode ?? "allowance")}
                            onValueChange={(value) => updateEdit(selected.id, {
                              commercialGuidance: patchNestedJson(commercialGuidance, "packaging", { weakEvidencePricingMode: value }),
                            })}
                            options={pricingModeOptions}
                          />
                        </div>
                        <div>
                          <Label>Offsite / Preproduction Pricing</Label>
                          <Select
                            value={String(packaging.offsiteProductionPricingMode ?? packaging.shopFabricationPricingMode ?? "detailed")}
                            onValueChange={(value) => updateEdit(selected.id, {
                              commercialGuidance: patchNestedJson(commercialGuidance, "packaging", {
                                offsiteProductionPricingMode: value,
                                shopFabricationPricingMode: value,
                              }),
                            })}
                            options={pricingModeOptions}
                          />
                        </div>
                      </div>
                      <div>
                        <Label>Default Execution Model</Label>
                        <Select
                          value={String(packaging.defaultExecutionMode ?? "")}
                          onValueChange={(value) => updateEdit(selected.id, {
                            commercialGuidance: patchNestedJson(commercialGuidance, "packaging", { defaultExecutionMode: value || undefined }),
                          })}
                          options={executionModeOptions}
                        />
                      </div>
                      <div>
                        <Label>Activities Usually Priced Commercially</Label>
                        <Input
                          value={externalPricingDefaults.join(", ")}
                          onChange={(event) => updateEdit(selected.id, {
                            defaultAssumptions: {
                              ...defaultAssumptions,
                              externalPricingDefaults: splitList(event.target.value),
                            },
                          })}
                          placeholder="specialty vendors, permit fees, cloud services, third-party testing"
                        />
                      </div>
                      <div>
                        <Label>Evidence Policy</Label>
                        <Input
                          value={String(packaging.evidencePolicy ?? "")}
                          onChange={(event) => updateEdit(selected.id, {
                            commercialGuidance: patchNestedJson(commercialGuidance, "packaging", { evidencePolicy: event.target.value }),
                          })}
                          placeholder="Use allowance when quantity, rate, or execution model cannot be evidenced"
                        />
                      </div>
                    </div>
                  </section>

                  <section className="rounded-lg border border-line/70 bg-bg/25 p-3">
                    <SectionHeader
                      icon={ClipboardList}
                      title="Role Coverage"
                      detail="Generalized coordination, management, QA, or oversight policy. Configure aliases so validation can detect your industry's role names."
                    />
                    <div className="mt-3 grid gap-3">
                      <div>
                        <Label>Coverage Mode</Label>
                        <Select
                          value={roleCoverage.coverageMode}
                          onValueChange={(coverageMode) => updateEdit(selected.id, {
                            productivityGuidance: patchProductivityRoleCoverage(productivityGuidance, { coverageMode }),
                          })}
                          options={coverageModeOptions}
                        />
                      </div>
                      <div>
                        <Label>Shared Overhead Worksheet Matchers</Label>
                        <Input
                          value={roleCoverage.overheadWorksheetMatchers.join(", ")}
                          onChange={(event) => updateEdit(selected.id, {
                            productivityGuidance: patchProductivityRoleCoverage(productivityGuidance, {
                              overheadWorksheetMatchers: splitList(event.target.value),
                            }),
                          })}
                          placeholder="general conditions, overhead, shared support"
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label className="mb-0">Roles</Label>
                          <Button
                            size="xs"
                            variant="secondary"
                            onClick={() => updateEdit(selected.id, {
                              productivityGuidance: patchProductivityRoleCoverage(productivityGuidance, {
                                roles: [
                                  ...roleCoverage.roles,
                                  {
                                    id: `role-${Date.now()}`,
                                    label: "",
                                    aliases: [],
                                    ratio: "",
                                    threshold: "",
                                    placement: "",
                                    notes: "",
                                  },
                                ],
                              }),
                            })}
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Role
                          </Button>
                        </div>
                        {roleCoverage.roles.map((role, index) => {
                          const patchRole = (patch: Partial<RoleCoverageRole>) => {
                            const nextRoles = roleCoverage.roles.map((candidate, candidateIndex) =>
                              candidateIndex === index ? { ...candidate, ...patch } : candidate,
                            );
                            updateEdit(selected.id, {
                              productivityGuidance: patchProductivityRoleCoverage(productivityGuidance, { roles: nextRoles }),
                            });
                          };
                          return (
                            <div key={role.id || index} className="rounded-md border border-line/65 bg-panel p-2">
                              <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                                <Input value={role.label} onChange={(event) => patchRole({ label: event.target.value })} placeholder="Role label" />
                                <Input value={role.aliases.join(", ")} onChange={(event) => patchRole({ aliases: splitList(event.target.value) })} placeholder="aliases" />
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  onClick={() => updateEdit(selected.id, {
                                    productivityGuidance: patchProductivityRoleCoverage(productivityGuidance, {
                                      roles: roleCoverage.roles.filter((_, candidateIndex) => candidateIndex !== index),
                                    }),
                                  })}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                              <div className="mt-2 grid gap-2 md:grid-cols-3">
                                <Input value={role.ratio} onChange={(event) => patchRole({ ratio: event.target.value })} placeholder="ratio, e.g. 1:6" />
                                <Input value={role.threshold} onChange={(event) => patchRole({ threshold: event.target.value })} placeholder="threshold, e.g. 4 weeks" />
                                <Input value={role.placement} onChange={(event) => patchRole({ placement: event.target.value })} placeholder="placement preference" />
                              </div>
                              <Input className="mt-2" value={role.notes} onChange={(event) => patchRole({ notes: event.target.value })} placeholder="notes" />
                            </div>
                          );
                        })}
                        {roleCoverage.roles.length === 0 && (
                          <div className="rounded-md border border-dashed border-line px-3 py-5 text-center text-xs text-fg/40">
                            Add role policies only when this estimator needs explicit coordination, QA, or oversight logic.
                          </div>
                        )}
                      </div>
                    </div>
                  </section>

                  <section className="rounded-lg border border-line/70 bg-bg/25 p-3">
                    <SectionHeader
                      icon={Search}
                      title="Review Behavior"
                      detail="Tell the reconcile pass which scopes, risks, or estimate mechanics deserve extra scrutiny."
                    />
                    <div className="mt-3">
                      <Label>Review Focus Areas</Label>
                      <Input
                        value={(selected.reviewFocusAreas ?? []).join(", ")}
                        onChange={(event) => updateEdit(selected.id, { reviewFocusAreas: splitList(event.target.value) })}
                        placeholder="coverage gaps, evidence-light pricing, role duplication, lead times"
                      />
                    </div>
                  </section>
                </div>
              </div>

              <section className="mt-3 rounded-lg border border-line/70 bg-bg/25 p-3">
                <SectionHeader
                  icon={BookOpen}
                  title="Agent Instructions"
                  detail="Narrative guidance is still useful, but keep supervision, commercialization, and source policy in the structured sections above whenever possible."
                />
                <div className="mt-3">
                  <Label>System Instructions</Label>
                  <Textarea
                    className="min-h-[180px] resize-y font-mono text-xs leading-relaxed"
                    value={selected.systemPrompt}
                    onChange={(event) => updateEdit(selected.id, { systemPrompt: event.target.value })}
                    placeholder="Describe the estimator methodology, assumptions to challenge, common misses, and how to reason in this domain."
                  />
                </div>
              </section>

              <section className="mt-3 rounded-lg border border-line/70 bg-bg/25 p-3">
                <SectionHeader
                  icon={Database}
                  title="Raw Structured Policy"
                  detail="Advanced JSON override surface. These objects are injected into the agent estimator and read by final validation."
                />
                <div className="mt-3 grid gap-3 lg:grid-cols-3">
                  <RawJsonField label="Default Assumptions JSON" value={selected.defaultAssumptions} onChange={(value) => updateEdit(selected.id, { defaultAssumptions: value as any })} />
                  <RawJsonField label="Productivity Guidance JSON" value={selected.productivityGuidance} onChange={(value) => updateEdit(selected.id, { productivityGuidance: value as any })} />
                  <RawJsonField label="Commercial Guidance JSON" value={selected.commercialGuidance} onChange={(value) => updateEdit(selected.id, { commercialGuidance: value as any })} />
                </div>
              </section>
            </div>
          </>
        ) : (
          <div className="flex h-full min-h-0 items-center justify-center p-8 text-center">
            <div>
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-bg/45 text-accent">
                <BookOpen className="h-5 w-5" />
              </div>
              <div className="mt-3 text-sm font-semibold text-fg">No estimator selected</div>
              <div className="mt-1 max-w-sm text-xs leading-relaxed text-fg/45">
                Create an estimator to bind domain method, source priorities, commercial policy, and review behavior.
              </div>
              <Button className="mt-4" size="sm" variant="accent" onClick={addPlaybook}>
                <Plus className="h-3.5 w-3.5" />
                Add Estimator
              </Button>
            </div>
          </div>
        )}
      </div>

      {defaultCount > 1 && (
        <div className="fixed bottom-4 right-4 z-40 rounded-lg border border-warning/25 bg-panel px-3 py-2 text-xs text-warning shadow-lg">
          More than one default estimator is enabled. Save one as default and clear the others.
        </div>
      )}
    </div>
  );
}
