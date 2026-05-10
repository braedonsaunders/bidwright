"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layers, Plus, Trash2, X } from "lucide-react";
import * as RadixSelect from "@radix-ui/react-select";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, CardBody, CardHeader, CardTitle, Input, ModalBackdrop } from "@/components/ui";
import {
  createProjectFederation,
  deleteProjectFederation,
  listProjectFederations,
  removeFederationMember,
  upsertFederationMember,
  type FederationDiscipline,
  type FederationRole,
  type ModelFederation,
} from "@/lib/api";

/** Discipline ordering for the picker — keep MEP-related grouped together. */
const DISCIPLINES: { id: FederationDiscipline; label: string; tone: string }[] = [
  { id: "architecture", label: "Architecture", tone: "bg-violet-500/15 text-violet-500" },
  { id: "structure",    label: "Structure",    tone: "bg-amber-500/15 text-amber-500" },
  { id: "mep",          label: "MEP",          tone: "bg-sky-500/15 text-sky-500" },
  { id: "fp",           label: "Fire Prot.",   tone: "bg-rose-500/15 text-rose-500" },
  { id: "civil",        label: "Civil",        tone: "bg-emerald-500/15 text-emerald-500" },
  { id: "landscape",    label: "Landscape",    tone: "bg-lime-500/15 text-lime-500" },
  { id: "other",        label: "Other",        tone: "bg-fg/10 text-fg/60" },
];

const ROLES: { id: FederationRole; label: string; help: string }[] = [
  { id: "primary",   label: "Primary",   help: "Contributes quantities to the takeoff." },
  { id: "reference", label: "Reference", help: "Visible in the viewer only — does not roll up." },
  { id: "clash",     label: "Clash",     help: "Used for coordination/clash detection only." },
];

function disciplineTone(id: string): string {
  return DISCIPLINES.find((d) => d.id === id)?.tone ?? "bg-fg/10 text-fg/60";
}

function disciplineLabel(id: string): string {
  return DISCIPLINES.find((d) => d.id === id)?.label ?? id;
}

export interface BimDocumentSummary {
  id: string;
  fileName: string;
  modelAssetId?: string;
}

export interface BimFederationSwitcherProps {
  projectId: string;
  /** All BIM-kind documents in the project. The switcher uses these as the
   *  "add to federation" pool and to look up filenames when rendering members. */
  bimDocuments: BimDocumentSummary[];
  /** null = "loose" (no federation filter — show all BIM models). */
  selectedFederationId: string | null;
  onSelectFederation: (federationId: string | null) => void;
  /** Notification when the active federation object resolves or changes shape
   *  (members added/removed). null when the user selects "loose" or the
   *  federation no longer exists. The callback is held in a ref so the parent
   *  can pass an unstable handler without causing the switcher to re-emit. */
  onActiveFederationChange?: (federation: ModelFederation | null) => void;
  /** Optional. When the federation membership changes (add/remove/reorder), the
   *  caller can refetch elements/quantities so derived takeoff numbers reflect
   *  the new member set. */
  onMembershipChanged?: () => void;
  /** Optional QuoteRevision id to default new federations into. Lets the user
   *  pin a federation to a specific scenario without picking it manually. */
  defaultRevisionId?: string | null;
}

/**
 * Federation switcher + member management for the BIM intake panel.
 *
 * Two modes:
 *  - "Loose" (no federation): caller renders the unfiltered BIM document list.
 *  - Federation selected: switcher exposes the member list with discipline +
 *    role chips and lets the user add/remove models or change tags inline.
 *
 * The component is purely a control surface — it doesn't render the actual
 * model list (the parent does, via `selectedFederation` or unfiltered
 * `bimDocuments`). It also exposes a helper {@link filterDocumentsByFederation}
 * that the parent uses to slice bimDocuments down to federation members.
 */
export function BimFederationSwitcher({
  projectId,
  bimDocuments,
  selectedFederationId,
  onSelectFederation,
  onActiveFederationChange,
  onMembershipChanged,
  defaultRevisionId = null,
}: BimFederationSwitcherProps) {
  const [federations, setFederations] = useState<ModelFederation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { federations: fetched } = await listProjectFederations(projectId);
      setFederations(fetched);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load federations");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedFederation = useMemo(
    () => federations.find((f) => f.id === selectedFederationId) ?? null,
    [federations, selectedFederationId],
  );

  // Emit the resolved federation upward whenever it changes shape (selection
  // change, membership update, or initial load). The callback is held in a
  // ref so an unstable parent prop doesn't re-trigger the effect — only a
  // genuine federation change does.
  const onActiveFederationChangeRef = useRef(onActiveFederationChange);
  useEffect(() => {
    onActiveFederationChangeRef.current = onActiveFederationChange;
  }, [onActiveFederationChange]);
  useEffect(() => {
    onActiveFederationChangeRef.current?.(selectedFederation);
  }, [selectedFederation]);

  const memberModelIds = useMemo(() => {
    if (!selectedFederation) return new Set<string>();
    return new Set(selectedFederation.members.map((m) => m.modelId));
  }, [selectedFederation]);

  const candidatesToAdd = useMemo(() => {
    return bimDocuments.filter(
      (doc) => doc.modelAssetId && !memberModelIds.has(doc.modelAssetId),
    );
  }, [bimDocuments, memberModelIds]);

  const handleCreate = async () => {
    if (!createName.trim() || createBusy) return;
    setCreateBusy(true);
    setError(null);
    try {
      const { federation } = await createProjectFederation(projectId, {
        name: createName.trim(),
        description: createDescription.trim() || undefined,
        revisionId: defaultRevisionId,
      });
      setFederations((prev) => [federation, ...prev]);
      onSelectFederation(federation.id);
      setCreateOpen(false);
      setCreateName("");
      setCreateDescription("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create federation");
    } finally {
      setCreateBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedFederation) return;
    if (!confirm(`Delete federation "${selectedFederation.name}"? Members are not deleted, only the grouping.`)) return;
    setError(null);
    try {
      await deleteProjectFederation(projectId, selectedFederation.id);
      onSelectFederation(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete federation");
    }
  };

  const handleAddMember = async (modelId: string, discipline: FederationDiscipline) => {
    if (!selectedFederation) return;
    setError(null);
    try {
      await upsertFederationMember(projectId, selectedFederation.id, {
        modelId,
        discipline,
        role: "primary",
        position: selectedFederation.members.length,
      });
      await refresh();
      onMembershipChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add member");
    }
  };

  const handleRemoveMember = async (modelId: string) => {
    if (!selectedFederation) return;
    setError(null);
    try {
      await removeFederationMember(projectId, selectedFederation.id, modelId);
      await refresh();
      onMembershipChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove member");
    }
  };

  const handleSetDiscipline = async (modelId: string, discipline: FederationDiscipline) => {
    if (!selectedFederation) return;
    setError(null);
    try {
      await upsertFederationMember(projectId, selectedFederation.id, { modelId, discipline });
      await refresh();
      onMembershipChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update discipline");
    }
  };

  const handleSetRole = async (modelId: string, role: FederationRole) => {
    if (!selectedFederation) return;
    setError(null);
    try {
      await upsertFederationMember(projectId, selectedFederation.id, { modelId, role });
      await refresh();
      onMembershipChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update role");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-panel text-fg/60">
          <Layers className="h-3.5 w-3.5" />
        </span>
        <RadixSelect.Root
          value={selectedFederationId ?? "__loose__"}
          onValueChange={(v) => onSelectFederation(v === "__loose__" ? null : v)}
        >
          <RadixSelect.Trigger className="inline-flex h-7 min-w-0 flex-1 items-center gap-1.5 truncate rounded-md border border-line bg-bg/50 px-2 text-xs text-fg outline-none transition-colors hover:border-accent/30 focus:border-accent/50 focus:ring-1 focus:ring-accent/20">
            <RadixSelect.Value placeholder="Loose — all BIM models">
              {selectedFederation ? (
                <span className="truncate">
                  {selectedFederation.name}
                  <span className="ml-1 text-fg/40">· {selectedFederation.members.length}</span>
                </span>
              ) : (
                "Loose — all BIM models"
              )}
            </RadixSelect.Value>
            <RadixSelect.Icon className="ml-auto shrink-0">
              <ChevronDown className="h-3.5 w-3.5 text-fg/40" />
            </RadixSelect.Icon>
          </RadixSelect.Trigger>
          <RadixSelect.Portal>
            <RadixSelect.Content
              position="popper"
              sideOffset={4}
              className="z-[100] max-h-72 overflow-hidden rounded-lg border border-line bg-panel shadow-xl"
            >
              <RadixSelect.Viewport className="p-1">
                <RadixSelect.Item
                  value="__loose__"
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-fg outline-none data-[highlighted]:bg-accent/10"
                >
                  <RadixSelect.ItemIndicator className="shrink-0">
                    <Check className="h-3 w-3 text-accent" />
                  </RadixSelect.ItemIndicator>
                  <RadixSelect.ItemText>Loose — all BIM models</RadixSelect.ItemText>
                </RadixSelect.Item>
                {federations.length > 0 && (
                  <RadixSelect.Group>
                    <RadixSelect.Label className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-fg/40">
                      Federations
                    </RadixSelect.Label>
                    {federations.map((federation) => (
                      <RadixSelect.Item
                        key={federation.id}
                        value={federation.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-fg outline-none data-[highlighted]:bg-accent/10"
                      >
                        <RadixSelect.ItemIndicator className="shrink-0">
                          <Check className="h-3 w-3 text-accent" />
                        </RadixSelect.ItemIndicator>
                        <span className="flex min-w-0 flex-1 items-baseline gap-2">
                          <RadixSelect.ItemText>
                            <span className="truncate">{federation.name}</span>
                          </RadixSelect.ItemText>
                          <span className="ml-auto shrink-0 text-[10px] text-fg/40">
                            {federation.members.length} {federation.members.length === 1 ? "model" : "models"}
                          </span>
                        </span>
                      </RadixSelect.Item>
                    ))}
                  </RadixSelect.Group>
                )}
              </RadixSelect.Viewport>
            </RadixSelect.Content>
          </RadixSelect.Portal>
        </RadixSelect.Root>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setCreateOpen(true)}
          title="Create federation"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
        {selectedFederation && (
          <Button
            variant="ghost"
            size="xs"
            onClick={handleDelete}
            title="Delete federation"
            className="text-fg/60 hover:text-rose-500"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-500">
          {error}
        </div>
      )}

      {selectedFederation && (
        <div className="rounded-md border border-line bg-bg/30 p-2">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-fg/45">Members</p>
            {candidatesToAdd.length > 0 && (
              <Button variant="ghost" size="xs" onClick={() => setAddOpen(true)}>
                <Plus className="h-3 w-3" />
                Add model
              </Button>
            )}
          </div>
          {selectedFederation.members.length === 0 ? (
            <p className="px-1 py-2 text-center text-[11px] text-fg/40">
              No models federated yet. Add one to drive the takeoff from a coordinated set.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {selectedFederation.members.map((member) => {
                const fileName = member.model?.fileName ?? bimDocuments.find((d) => d.modelAssetId === member.modelId)?.fileName ?? member.modelId;
                return (
                  <li
                    key={member.id}
                    className="flex items-center gap-1.5 rounded border border-line bg-panel/60 px-2 py-1"
                  >
                    <span className="min-w-0 flex-1 truncate text-[11px] text-fg/80">{fileName}</span>
                    <DisciplineSelect
                      value={member.discipline}
                      onChange={(d) => handleSetDiscipline(member.modelId, d)}
                    />
                    <RoleSelect
                      value={member.role}
                      onChange={(r) => handleSetRole(member.modelId, r)}
                    />
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => handleRemoveMember(member.modelId)}
                      title="Remove from federation"
                      className="!h-6 !w-6 !p-0 text-fg/60 hover:text-rose-500"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Create federation modal */}
      <ModalBackdrop open={createOpen} onClose={() => setCreateOpen(false)} size="sm">
        <CardHeader>
          <CardTitle>New federation</CardTitle>
          <p className="mt-1 text-xs text-fg/55">
            Group BIM models that should drive a single coordinated takeoff
            (architectural + structural + MEP, etc).
          </p>
        </CardHeader>
        <CardBody>
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-fg/70">Name</span>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Tower A — coordinated"
                autoFocus
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-fg/70">Description (optional)</span>
              <Input
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder="What scenario does this federation represent?"
              />
            </label>
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)} disabled={createBusy}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!createName.trim() || createBusy}
            >
              {createBusy ? "Creating…" : "Create"}
            </Button>
          </div>
        </CardBody>
      </ModalBackdrop>

      {/* Add member modal */}
      <ModalBackdrop open={addOpen} onClose={() => setAddOpen(false)} size="sm">
        <CardHeader>
          <CardTitle>Add model to federation</CardTitle>
          <p className="mt-1 text-xs text-fg/55">
            Pick a BIM model to federate. Change its discipline below before
            adding, or update it later inline.
          </p>
        </CardHeader>
        <CardBody>
          <div className="max-h-72 overflow-y-auto">
            {candidatesToAdd.length === 0 ? (
              <p className="py-4 text-center text-xs text-fg/40">
                All BIM models in this project are already federated.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {candidatesToAdd.map((doc) => (
                  <AddMemberRow
                    key={doc.id}
                    fileName={doc.fileName}
                    onAdd={async (discipline) => {
                      if (!doc.modelAssetId) return;
                      await handleAddMember(doc.modelAssetId, discipline);
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAddOpen(false)}>
              Done
            </Button>
          </div>
        </CardBody>
      </ModalBackdrop>

      {loading && federations.length === 0 && (
        <p className="text-[10px] text-fg/35">Loading federations…</p>
      )}
    </div>
  );
}

function DisciplineSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: FederationDiscipline) => void;
}) {
  return (
    <RadixSelect.Root value={value} onValueChange={(v) => onChange(v as FederationDiscipline)}>
      <RadixSelect.Trigger
        className={cn(
          "inline-flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] font-medium outline-none focus:ring-1 focus:ring-accent/30",
          disciplineTone(value),
        )}
        title="Discipline"
      >
        <RadixSelect.Value>{disciplineLabel(value)}</RadixSelect.Value>
        <RadixSelect.Icon>
          <ChevronDown className="h-2.5 w-2.5 opacity-60" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="z-[100] overflow-hidden rounded-lg border border-line bg-panel shadow-xl"
        >
          <RadixSelect.Viewport className="p-1">
            {DISCIPLINES.map((d) => (
              <RadixSelect.Item
                key={d.id}
                value={d.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-fg outline-none data-[highlighted]:bg-accent/10"
              >
                <RadixSelect.ItemIndicator className="shrink-0">
                  <Check className="h-3 w-3 text-accent" />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{d.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

function RoleSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: FederationRole) => void;
}) {
  const help = ROLES.find((r) => r.id === value)?.help ?? "";
  return (
    <RadixSelect.Root value={value} onValueChange={(v) => onChange(v as FederationRole)}>
      <RadixSelect.Trigger
        className="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-line bg-bg/50 px-1.5 text-[10px] font-medium text-fg/70 outline-none hover:border-accent/30 focus:ring-1 focus:ring-accent/30"
        title={help}
      >
        <RadixSelect.Value>{ROLES.find((r) => r.id === value)?.label ?? value}</RadixSelect.Value>
        <RadixSelect.Icon>
          <ChevronDown className="h-2.5 w-2.5 opacity-60" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="z-[100] overflow-hidden rounded-lg border border-line bg-panel shadow-xl"
        >
          <RadixSelect.Viewport className="p-1">
            {ROLES.map((r) => (
              <RadixSelect.Item
                key={r.id}
                value={r.id}
                className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-xs text-fg outline-none data-[highlighted]:bg-accent/10"
              >
                <RadixSelect.ItemIndicator className="mt-0.5 shrink-0">
                  <Check className="h-3 w-3 text-accent" />
                </RadixSelect.ItemIndicator>
                <span className="flex min-w-0 flex-col">
                  <RadixSelect.ItemText>{r.label}</RadixSelect.ItemText>
                  <span className="text-[10px] text-fg/40">{r.help}</span>
                </span>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

function AddMemberRow({
  fileName,
  onAdd,
}: {
  fileName: string;
  onAdd: (discipline: FederationDiscipline) => Promise<void>;
}) {
  const [discipline, setDiscipline] = useState<FederationDiscipline>("architecture");
  const [busy, setBusy] = useState(false);
  return (
    <li className="flex items-center gap-1.5 rounded border border-line bg-panel/60 px-2 py-1">
      <span className="min-w-0 flex-1 truncate text-xs text-fg/80">{fileName}</span>
      <DisciplineSelect value={discipline} onChange={setDiscipline} />
      <Button
        variant="secondary"
        size="xs"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onAdd(discipline);
          } finally {
            setBusy(false);
          }
        }}
      >
        Add
      </Button>
    </li>
  );
}

/**
 * Slice a list of BIM documents down to the members of `federation`. The
 * caller passes its full BIM doc list (so other workflows like "loose" view
 * stay simple), and renders only the result of this filter when a federation
 * is selected. Documents whose modelAssetId isn't a member are excluded.
 */
export function filterDocumentsByFederation<T extends { modelAssetId?: string }>(
  documents: T[],
  federation: ModelFederation | null,
): T[] {
  if (!federation) return documents;
  const memberIds = new Set(federation.members.map((m) => m.modelId));
  return documents.filter((doc) => doc.modelAssetId && memberIds.has(doc.modelAssetId));
}
