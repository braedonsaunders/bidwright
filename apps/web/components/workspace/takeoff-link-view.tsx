"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import {
  createDwgEntityLink,
  createModelTakeoffLink,
  createTakeoffLink,
  createWorksheetItem,
  deleteDwgEntityLink,
  deleteModelTakeoffLink,
  deleteTakeoffLink,
  listDwgEntityLinks,
  listModelTakeoffLinks,
  listTakeoffLinks,
  suggestLineItemsForAnnotation,
  type DwgEntityLinkRecord,
  type EntityCategory,
  type LineItemSuggestionRecord,
  type ModelTakeoffLinkRecord,
  type ProjectWorkspaceData,
  type TakeoffLinkRecord,
  type WorkspaceWorksheet,
} from "@/lib/api";
import type { BidwrightModelSelectionMessage } from "@/components/workspace/editors/bidwright-model-editor";
import { Button, Input, Label, Select } from "@/components/ui";
import type { TakeoffAnnotation } from "@/components/workspace/takeoff/annotation-canvas";
import { cn } from "@/lib/utils";

export type TakeoffSelection =
  | { kind: "annotation"; annotationId: string }
  | {
      kind: "model-selection";
      modelId: string;
      modelDocumentId?: string;
      fileName?: string;
      selectedCount: number;
      selectedNodeIds: string[];
      totals: { surfaceArea: number; volume: number; faceCount: number; solidCount: number };
    }
  | {
      kind: "model-element";
      assetId: string;
      elementId: string;
      elementName: string;
      elementClass?: string;
      material?: string;
      level?: string;
      quantitySummary?: string;
    }
  | {
      kind: "cad-entity";
      documentId: string;
      entityId: string;
      entityType?: string;
      layer?: string;
      label?: string;
      summary?: string;
    };

interface TakeoffLinkViewProps {
  workspace: ProjectWorkspaceData;
  selection: TakeoffSelection | null;
  annotations: TakeoffAnnotation[];
  activeWorksheetId?: string;
  onLinksMutated: () => void;
  /** Bridge to TakeoffTab's handleSendModelSelectionToEstimate. */
  onSendModelSelectionToEstimate?: (selection: BidwrightModelSelectionMessage) => Promise<void> | void;
  /** Bridge to TakeoffTab's per-element line-item creation flow. The side
   *  panel hands back the elementId; TakeoffTab looks up the element and
   *  drives the create+link sequence. */
  onCreateLineItemFromModelElement?: (elementId: string) => Promise<void> | void;
}

const QUANTITY_FIELDS = [
  { value: "value", label: "Length / Distance" },
  { value: "area", label: "Area" },
  { value: "volume", label: "Volume" },
  { value: "count", label: "Count" },
] as const;

function availableQuantityFields(measurement?: TakeoffAnnotation["measurement"]) {
  if (!measurement) return QUANTITY_FIELDS.filter((f) => f.value === "value");
  return QUANTITY_FIELDS.filter((f) => {
    if (f.value === "value") return measurement.value !== undefined;
    if (f.value === "area") return measurement.area !== undefined && measurement.area > 0;
    if (f.value === "volume") return measurement.volume !== undefined && measurement.volume > 0;
    if (f.value === "count") return true;
    return false;
  });
}

export function TakeoffLinkView({
  workspace,
  selection,
  annotations,
  activeWorksheetId,
  onLinksMutated,
  onSendModelSelectionToEstimate,
  onCreateLineItemFromModelElement,
}: TakeoffLinkViewProps) {
  if (!selection) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <Link2 className="h-5 w-5 text-fg/20" />
        <p className="text-[11px] leading-relaxed text-fg/45">
          Select an annotation, model element, or CAD entity in the takeoff to manage its links.
        </p>
      </div>
    );
  }

  if (selection.kind === "annotation") {
    return (
      <AnnotationLinkPane
        workspace={workspace}
        annotationId={selection.annotationId}
        annotations={annotations}
        activeWorksheetId={activeWorksheetId}
        onLinksMutated={onLinksMutated}
      />
    );
  }

  if (selection.kind === "model-selection") {
    return (
      <ModelSelectionLinkPane
        workspace={workspace}
        selection={selection}
        onLinksMutated={onLinksMutated}
        onSendToEstimate={onSendModelSelectionToEstimate}
      />
    );
  }

  if (selection.kind === "model-element") {
    return (
      <ModelElementLinkPane
        workspace={workspace}
        selection={selection}
        onLinksMutated={onLinksMutated}
        onCreateLineItem={onCreateLineItemFromModelElement}
      />
    );
  }

  return (
    <CadEntityLinkPane
      workspace={workspace}
      selection={selection}
      activeWorksheetId={activeWorksheetId}
      onLinksMutated={onLinksMutated}
    />
  );
}

function ModelSelectionLinkPane({
  workspace,
  selection,
  onLinksMutated,
  onSendToEstimate,
}: {
  workspace: ProjectWorkspaceData;
  selection: Extract<TakeoffSelection, { kind: "model-selection" }>;
  onLinksMutated: () => void;
  onSendToEstimate?: (selection: BidwrightModelSelectionMessage) => Promise<void> | void;
}) {
  const projectId = workspace.project.id;
  const [links, setLinks] = useState<ModelTakeoffLinkRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!projectId || !selection.modelId) return;
    setLoading(true);
    try {
      const next = await listModelTakeoffLinks(projectId, selection.modelId);
      setLinks(next.links ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load model links");
    } finally {
      setLoading(false);
    }
  }, [projectId, selection.modelId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleDelete = useCallback(
    async (linkId: string) => {
      if (!projectId || !selection.modelId) return;
      try {
        await deleteModelTakeoffLink(projectId, selection.modelId, linkId);
        await reload();
        onLinksMutated();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete link");
      }
    },
    [onLinksMutated, projectId, reload, selection.modelId],
  );

  const itemLookup = useMemo(() => {
    const map = new Map<string, { name: string; worksheetName: string; uom: string }>();
    for (const ws of workspace.worksheets) {
      for (const item of ws.items ?? []) {
        map.set(item.id, {
          name: item.entityName || "Unnamed",
          worksheetName: ws.name,
          uom: item.uom,
        });
      }
    }
    return map;
  }, [workspace.worksheets]);

  // Show only links that touch one of the currently selected nodes if any are
  // tagged with elementId/quantityId; otherwise show all links for the asset.
  const selectedNodeSet = useMemo(() => new Set(selection.selectedNodeIds), [selection.selectedNodeIds]);
  const visibleLinks = useMemo(() => {
    if (selectedNodeSet.size === 0) return links;
    const matching = links.filter((link) => {
      const sel = link.selection as { selectedNodeIds?: unknown } | undefined;
      const ids = Array.isArray(sel?.selectedNodeIds) ? (sel.selectedNodeIds as string[]) : [];
      return ids.some((id) => selectedNodeSet.has(id));
    });
    return matching.length > 0 ? matching : links;
  }, [links, selectedNodeSet]);

  return (
    <div className="flex h-full flex-col gap-3 text-xs">
      <SelectionHeader
        title={selection.fileName ?? "3D model selection"}
        subtitle={`${selection.selectedCount} node${selection.selectedCount === 1 ? "" : "s"} · ${selection.totals.solidCount} solids · ${selection.totals.faceCount} faces`}
      />

      <Section label={`Model links (${visibleLinks.length}${selectedNodeSet.size > 0 && visibleLinks.length === links.length ? " — showing all" : ""})`}>
        {loading && visibleLinks.length === 0 ? (
          <div className="flex items-center gap-2 text-fg/40">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        ) : visibleLinks.length === 0 ? (
          <p className="text-[11px] italic text-fg/40">No model links yet.</p>
        ) : (
          <ul className="space-y-1">
            {visibleLinks.map((link) => {
              const meta = itemLookup.get(link.worksheetItemId);
              return (
                <li
                  key={link.id}
                  className="flex items-start gap-2 rounded-md border border-line bg-panel/60 px-2 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-fg">{meta?.name ?? link.worksheetItemId}</p>
                    <p className="truncate text-[10px] text-fg/40">
                      {meta?.worksheetName ?? "—"} · {link.quantityField} · ×{link.multiplier.toFixed(2)} ={" "}
                      <span className="text-fg/60">
                        {link.derivedQuantity.toFixed(2)} {meta?.uom ?? ""}
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDelete(link.id)}
                    className="rounded p-1 text-fg/30 transition-colors hover:bg-danger/10 hover:text-danger"
                    title="Remove link"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {error && <p className="text-[11px] text-danger">{error}</p>}
      </Section>

      {onSendToEstimate && (
        <ModelSendToEstimateButton selection={selection} onSendToEstimate={onSendToEstimate} onSent={onLinksMutated} />
      )}
    </div>
  );
}

function ModelSendToEstimateButton({
  selection,
  onSendToEstimate,
  onSent,
}: {
  selection: Extract<TakeoffSelection, { kind: "model-selection" }>;
  onSendToEstimate: (selection: BidwrightModelSelectionMessage) => Promise<void> | void;
  onSent: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reconstruct the minimum-viable BidwrightModelSelectionMessage shape from
  // the trimmed selection we lifted up. The downstream handler reads `nodes`
  // and totals; we recreate placeholder nodes that carry just the IDs.
  const handleClick = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const message: BidwrightModelSelectionMessage = {
        type: "bidwright:model-selection",
        source: "bidwright-model-editor",
        version: 1,
        modelId: selection.modelId,
        modelDocumentId: selection.modelDocumentId,
        fileName: selection.fileName,
        selectedCount: selection.selectedCount,
        nodes: selection.selectedNodeIds.map((id) => ({
          id,
          name: "",
          path: [],
          surfaceArea: undefined,
          volume: undefined,
          faceCount: undefined,
          solidCount: undefined,
          // The downstream handler tolerates partial nodes — it primarily uses
          // the node ids and the aggregate totals on the message.
        })) as unknown as BidwrightModelSelectionMessage["nodes"],
        totals: selection.totals,
      };
      await onSendToEstimate(message);
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send to estimate failed");
    } finally {
      setBusy(false);
    }
  }, [onSendToEstimate, onSent, selection]);

  return (
    <Section label="Create line item">
      <Button size="sm" onClick={() => void handleClick()} disabled={busy} className="w-full">
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
        Send selection to estimate
      </Button>
      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
    </Section>
  );
}

function ModelElementLinkPane({
  workspace,
  selection,
  onLinksMutated,
  onCreateLineItem,
}: {
  workspace: ProjectWorkspaceData;
  selection: Extract<TakeoffSelection, { kind: "model-element" }>;
  onLinksMutated: () => void;
  onCreateLineItem?: (elementId: string) => Promise<void> | void;
}) {
  const projectId = workspace.project.id;
  const [links, setLinks] = useState<ModelTakeoffLinkRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!projectId || !selection.assetId) return;
    setLoading(true);
    try {
      const next = await listModelTakeoffLinks(projectId, selection.assetId);
      setLinks((next.links ?? []).filter((l) => l.modelElementId === selection.elementId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load links");
    } finally {
      setLoading(false);
    }
  }, [projectId, selection.assetId, selection.elementId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleDelete = useCallback(
    async (linkId: string) => {
      if (!projectId || !selection.assetId) return;
      try {
        await deleteModelTakeoffLink(projectId, selection.assetId, linkId);
        await reload();
        onLinksMutated();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete link");
      }
    },
    [onLinksMutated, projectId, reload, selection.assetId],
  );

  const itemLookup = useMemo(() => {
    const map = new Map<string, { name: string; worksheetName: string; uom: string }>();
    for (const ws of workspace.worksheets) {
      for (const item of ws.items ?? []) {
        map.set(item.id, {
          name: item.entityName || "Unnamed",
          worksheetName: ws.name,
          uom: item.uom,
        });
      }
    }
    return map;
  }, [workspace.worksheets]);

  const handleSent = useCallback(async () => {
    await reload();
    onLinksMutated();
  }, [onLinksMutated, reload]);

  const subtitle = [selection.elementClass, selection.material, selection.level, selection.quantitySummary]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 text-xs">
      <div className="shrink-0">
        <SelectionHeader title={selection.elementName} subtitle={subtitle || undefined} />
      </div>

      {/* Primary action is anchored high so it stays visible without scrolling
          when the linked-items list grows long. The list itself scrolls
          internally so the whole pane stays fit-to-panel-height. */}
      {onCreateLineItem && (
        <div className="shrink-0">
          <ModelElementSendToEstimateButton
            elementId={selection.elementId}
            onCreate={onCreateLineItem}
            onSent={handleSent}
          />
        </div>
      )}

      {projectId && (
        <div className="shrink-0">
          <CreateModelElementLinkForm
            projectId={projectId}
            selection={selection}
            worksheets={workspace.worksheets}
            onCreated={handleSent}
          />
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto">
        <Section label={`Linked items (${links.length})`}>
          {loading && links.length === 0 ? (
            <div className="flex items-center gap-2 text-fg/40">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading…
            </div>
          ) : links.length === 0 ? (
            <p className="text-[11px] italic text-fg/40">No links yet.</p>
          ) : (
            <ul className="space-y-1">
              {links.map((link) => {
                const meta = itemLookup.get(link.worksheetItemId);
                return (
                  <li
                    key={link.id}
                    className="flex items-start gap-2 rounded-md border border-line bg-panel/60 px-2 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-fg">{meta?.name ?? link.worksheetItemId}</p>
                      <p className="truncate text-[10px] text-fg/40">
                        {meta?.worksheetName ?? "—"} · {link.quantityField} · ×{link.multiplier.toFixed(2)} ={" "}
                        <span className="text-fg/60">
                          {link.derivedQuantity.toFixed(2)} {meta?.uom ?? ""}
                        </span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDelete(link.id)}
                      className="rounded p-1 text-fg/30 transition-colors hover:bg-danger/10 hover:text-danger"
                      title="Remove link"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {error && <p className="text-[11px] text-danger">{error}</p>}
        </Section>
      </div>
    </div>
  );
}

function CreateModelElementLinkForm({
  projectId,
  selection,
  worksheets,
  onCreated,
}: {
  projectId: string;
  selection: Extract<TakeoffSelection, { kind: "model-element" }>;
  worksheets: WorkspaceWorksheet[];
  onCreated: () => void | Promise<void>;
}) {
  const [wsId, setWsId] = useState(worksheets[0]?.id ?? "");
  const [itemId, setItemId] = useState("");
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ws = worksheets.find((w) => w.id === wsId);
  const filteredItems = useMemo(() => {
    const items = ws?.items ?? [];
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(
      (i) =>
        i.entityName.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q),
    );
  }, [ws, search]);

  const handleCreate = useCallback(async () => {
    if (!itemId) return;
    setSubmitting(true);
    setError(null);
    try {
      await createModelTakeoffLink(projectId, selection.assetId, {
        worksheetItemId: itemId,
        modelElementId: selection.elementId,
        selection: {
          mode: "side-panel",
          elementName: selection.elementName,
          elementClass: selection.elementClass,
          material: selection.material,
          level: selection.level,
        },
      });
      setItemId("");
      setSearch("");
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create link");
    } finally {
      setSubmitting(false);
    }
  }, [itemId, onCreated, projectId, selection]);

  return (
    <Section label="Link to existing item">
      <div className="space-y-2">
        {worksheets.length > 1 && (
          <div>
            <Label className="text-[10px]">Worksheet</Label>
            <Select
              value={wsId}
              onValueChange={(v) => {
                setWsId(v);
                setItemId("");
              }}
              options={worksheets.map((w) => ({ value: w.id, label: w.name }))}
            />
          </div>
        )}

        <div>
          <Label className="text-[10px]">Item</Label>
          <Input
            placeholder="Search items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-1.5"
          />
          <div className="max-h-40 overflow-auto rounded-md border border-line">
            {filteredItems.length === 0 ? (
              <p className="px-2 py-2 text-center text-[11px] text-fg/40">No items match.</p>
            ) : (
              filteredItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setItemId(item.id)}
                  className={cn(
                    "flex w-full items-center gap-2 border-b border-line/50 px-2 py-1.5 text-left text-[11px] transition-colors last:border-b-0",
                    itemId === item.id ? "bg-accent/10 text-accent" : "text-fg/70 hover:bg-panel2/60",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{item.entityName || "Unnamed"}</span>
                  <span className="shrink-0 text-[10px] text-fg/30">
                    {item.quantity} {item.uom}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {error && <p className="text-[11px] text-danger">{error}</p>}

        <Button size="sm" onClick={() => void handleCreate()} disabled={!itemId || submitting} className="w-full">
          {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Link to item
        </Button>
      </div>
    </Section>
  );
}

function ModelElementSendToEstimateButton({
  elementId,
  onCreate,
  onSent,
}: {
  elementId: string;
  onCreate: (elementId: string) => Promise<void> | void;
  onSent: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleClick = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await onCreate(elementId);
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send to estimate failed");
    } finally {
      setBusy(false);
    }
  }, [elementId, onCreate, onSent]);

  return (
    <Section label="Create line item">
      <Button size="sm" onClick={() => void handleClick()} disabled={busy} className="w-full">
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
        Send element to estimate
      </Button>
      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
    </Section>
  );
}

function CadEntityLinkPane({
  workspace,
  selection,
  activeWorksheetId,
  onLinksMutated,
}: {
  workspace: ProjectWorkspaceData;
  selection: Extract<TakeoffSelection, { kind: "cad-entity" }>;
  activeWorksheetId?: string;
  onLinksMutated: () => void;
}) {
  const projectId = workspace.project.id;
  const [links, setLinks] = useState<DwgEntityLinkRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const next = await listDwgEntityLinks(projectId, {
        documentId: selection.documentId,
        entityId: selection.entityId,
      });
      setLinks(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load links");
    } finally {
      setLoading(false);
    }
  }, [projectId, selection.documentId, selection.entityId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleDelete = useCallback(
    async (linkId: string) => {
      if (!projectId) return;
      try {
        await deleteDwgEntityLink(projectId, linkId);
        await reload();
        onLinksMutated();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete link");
      }
    },
    [onLinksMutated, projectId, reload],
  );

  const itemLookup = useMemo(() => {
    const map = new Map<string, { name: string; worksheetName: string; uom: string }>();
    for (const ws of workspace.worksheets) {
      for (const item of ws.items ?? []) {
        map.set(item.id, {
          name: item.entityName || "Unnamed",
          worksheetName: ws.name,
          uom: item.uom,
        });
      }
    }
    return map;
  }, [workspace.worksheets]);

  const handleCreated = useCallback(async () => {
    await reload();
    onLinksMutated();
  }, [onLinksMutated, reload]);

  const subtitle = [selection.entityType, selection.layer && `layer: ${selection.layer}`, selection.summary]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex h-full flex-col gap-3 text-xs">
      <SelectionHeader
        title={selection.label ?? `CAD entity ${selection.entityId.slice(0, 8)}`}
        subtitle={subtitle || selection.entityId}
      />

      <Section label={`Linked items (${links.length})`}>
        {loading && links.length === 0 ? (
          <div className="flex items-center gap-2 text-fg/40">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        ) : links.length === 0 ? (
          <p className="text-[11px] italic text-fg/40">No links yet.</p>
        ) : (
          <ul className="space-y-1">
            {links.map((link) => {
              const meta = itemLookup.get(link.worksheetItemId);
              return (
                <li
                  key={link.id}
                  className="flex items-start gap-2 rounded-md border border-line bg-panel/60 px-2 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-fg">{meta?.name ?? link.worksheetItemId}</p>
                    <p className="truncate text-[10px] text-fg/40">
                      {meta?.worksheetName ?? "—"} · ×{link.multiplier.toFixed(2)} ={" "}
                      <span className="text-fg/60">
                        {link.derivedQuantity.toFixed(2)} {meta?.uom ?? ""}
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDelete(link.id)}
                    className="rounded p-1 text-fg/30 transition-colors hover:bg-danger/10 hover:text-danger"
                    title="Remove link"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {error && <p className="text-[11px] text-danger">{error}</p>}
      </Section>

      {projectId && (
        <CreateDwgEntityLinkForm
          projectId={projectId}
          selection={selection}
          worksheets={workspace.worksheets}
          activeWorksheetId={activeWorksheetId}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}

function CreateDwgEntityLinkForm({
  projectId,
  selection,
  worksheets,
  activeWorksheetId,
  onCreated,
}: {
  projectId: string;
  selection: Extract<TakeoffSelection, { kind: "cad-entity" }>;
  worksheets: WorkspaceWorksheet[];
  activeWorksheetId?: string;
  onCreated: () => void | Promise<void>;
}) {
  const initialWsId =
    activeWorksheetId && activeWorksheetId !== "all" && worksheets.some((w) => w.id === activeWorksheetId)
      ? activeWorksheetId
      : worksheets[0]?.id ?? "";
  const [wsId, setWsId] = useState(initialWsId);
  const [itemId, setItemId] = useState("");
  const [search, setSearch] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [wastePct, setWastePct] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (activeWorksheetId && activeWorksheetId !== "all" && worksheets.some((w) => w.id === activeWorksheetId)) {
      setWsId(activeWorksheetId);
      setItemId("");
    }
  }, [activeWorksheetId, worksheets]);

  const ws = worksheets.find((w) => w.id === wsId);
  const filteredItems = useMemo(() => {
    const items = ws?.items ?? [];
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(
      (i) =>
        i.entityName.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q),
    );
  }, [ws, search]);

  const multiplier = 1 + wastePct / 100;
  const derived = quantity * multiplier;

  const handleCreate = useCallback(async () => {
    if (!itemId) return;
    setSubmitting(true);
    setError(null);
    try {
      await createDwgEntityLink(projectId, {
        documentId: selection.documentId,
        entityId: selection.entityId,
        entityType: selection.entityType,
        layer: selection.layer,
        worksheetItemId: itemId,
        quantity,
        multiplier,
        selection: {
          label: selection.label,
          summary: selection.summary,
        },
      });
      setItemId("");
      setSearch("");
      setQuantity(1);
      setWastePct(0);
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create link");
    } finally {
      setSubmitting(false);
    }
  }, [itemId, multiplier, onCreated, projectId, quantity, selection]);

  return (
    <Section label="Link to line item">
      <div className="space-y-2">
        {worksheets.length > 1 && (
          <div>
            <Label className="text-[10px]">Worksheet</Label>
            <Select
              value={wsId}
              onValueChange={(v) => {
                setWsId(v);
                setItemId("");
              }}
              options={worksheets.map((w) => ({ value: w.id, label: w.name }))}
            />
          </div>
        )}

        <div>
          <Label className="text-[10px]">Item</Label>
          <Input
            placeholder="Search items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-1.5"
          />
          <div className="max-h-40 overflow-auto rounded-md border border-line">
            {filteredItems.length === 0 ? (
              <p className="px-2 py-2 text-center text-[11px] text-fg/40">No items match.</p>
            ) : (
              filteredItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setItemId(item.id)}
                  className={cn(
                    "flex w-full items-center gap-2 border-b border-line/50 px-2 py-1.5 text-left text-[11px] transition-colors last:border-b-0",
                    itemId === item.id ? "bg-accent/10 text-accent" : "text-fg/70 hover:bg-panel2/60",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{item.entityName || "Unnamed"}</span>
                  <span className="shrink-0 text-[10px] text-fg/30">
                    {item.quantity} {item.uom}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px]">Quantity</Label>
            <Input
              type="number"
              min={0}
              step={0.01}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value) || 0)}
            />
          </div>
          <div>
            <Label className="text-[10px]">Waste %</Label>
            <Input
              type="number"
              min={0}
              max={100}
              step={1}
              value={wastePct}
              onChange={(e) => setWastePct(Number(e.target.value) || 0)}
            />
          </div>
        </div>

        <div className="rounded-md bg-panel2/50 px-2 py-1.5">
          <p className="text-[10px] text-fg/40">Preview</p>
          <p className="text-[11px] font-medium text-fg">
            {quantity.toFixed(2)} × {multiplier.toFixed(2)} ={" "}
            <span className="text-accent">{derived.toFixed(2)}</span>
          </p>
        </div>

        {error && <p className="text-[11px] text-danger">{error}</p>}

        <Button size="sm" onClick={() => void handleCreate()} disabled={!itemId || submitting} className="w-full">
          {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Create link
        </Button>
      </div>
    </Section>
  );
}

function AnnotationLinkPane({
  workspace,
  annotationId,
  annotations,
  activeWorksheetId,
  onLinksMutated,
}: {
  workspace: ProjectWorkspaceData;
  annotationId: string;
  annotations: TakeoffAnnotation[];
  activeWorksheetId?: string;
  onLinksMutated: () => void;
}) {
  const projectId = workspace.project.id;
  const annotation = annotations.find((a) => a.id === annotationId);
  const [links, setLinks] = useState<TakeoffLinkRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const next = await listTakeoffLinks(projectId, annotationId);
      setLinks(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load links");
    } finally {
      setLoading(false);
    }
  }, [annotationId, projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleDelete = useCallback(
    async (linkId: string) => {
      if (!projectId) return;
      try {
        await deleteTakeoffLink(projectId, linkId);
        await reload();
        onLinksMutated();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete link");
      }
    },
    [onLinksMutated, projectId, reload],
  );

  const handleCreated = useCallback(async () => {
    await reload();
    onLinksMutated();
  }, [onLinksMutated, reload]);

  const itemLookup = useMemo(() => {
    const map = new Map<string, { name: string; worksheetName: string; uom: string }>();
    for (const ws of workspace.worksheets) {
      for (const item of ws.items ?? []) {
        map.set(item.id, {
          name: item.entityName || "Unnamed",
          worksheetName: ws.name,
          uom: item.uom,
        });
      }
    }
    return map;
  }, [workspace.worksheets]);

  return (
    <div className="flex h-full flex-col gap-3 text-xs">
      <SelectionHeader
        title={annotation?.label || annotation?.type || "Annotation"}
        subtitle={annotation ? formatAnnotationMeasurement(annotation) : undefined}
        accent={annotation?.color}
      />

      <Section label={`Linked items (${links.length})`}>
        {loading && links.length === 0 ? (
          <div className="flex items-center gap-2 text-fg/40">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        ) : links.length === 0 ? (
          <p className="text-[11px] italic text-fg/40">No links yet.</p>
        ) : (
          <ul className="space-y-1">
            {links.map((link) => {
              const meta = itemLookup.get(link.worksheetItemId);
              return (
                <li
                  key={link.id}
                  className="flex items-start gap-2 rounded-md border border-line bg-panel/60 px-2 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-fg">{meta?.name ?? link.worksheetItemId}</p>
                    <p className="truncate text-[10px] text-fg/40">
                      {meta?.worksheetName ?? "—"} · {link.quantityField} · ×{link.multiplier.toFixed(2)} ={" "}
                      <span className="text-fg/60">
                        {link.derivedQuantity.toFixed(2)} {meta?.uom ?? ""}
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDelete(link.id)}
                    className="rounded p-1 text-fg/30 transition-colors hover:bg-danger/10 hover:text-danger"
                    title="Remove link"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {error && <p className="text-[11px] text-danger">{error}</p>}
      </Section>

      {annotation && projectId && (
        <CreateLinkForm
          projectId={projectId}
          annotation={annotation}
          worksheets={workspace.worksheets}
          activeWorksheetId={activeWorksheetId}
          onCreated={handleCreated}
        />
      )}

      {annotation && projectId && (
        <SuggestSection
          projectId={projectId}
          annotation={annotation}
          worksheets={workspace.worksheets}
          activeWorksheetId={activeWorksheetId}
          entityCategories={workspace.entityCategories ?? []}
          defaultMarkup={workspace.currentRevision.defaultMarkup ?? 0.2}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}

function CreateLinkForm({
  projectId,
  annotation,
  worksheets,
  activeWorksheetId,
  onCreated,
}: {
  projectId: string;
  annotation: TakeoffAnnotation;
  worksheets: WorkspaceWorksheet[];
  activeWorksheetId?: string;
  onCreated: () => void | Promise<void>;
}) {
  const fields = useMemo(() => availableQuantityFields(annotation.measurement), [annotation.measurement]);
  const initialWsId =
    activeWorksheetId && activeWorksheetId !== "all" && worksheets.some((w) => w.id === activeWorksheetId)
      ? activeWorksheetId
      : worksheets[0]?.id ?? "";
  const [wsId, setWsId] = useState(initialWsId);
  const [itemId, setItemId] = useState("");
  const [quantityField, setQuantityField] = useState<string>(fields[0]?.value ?? "value");
  const [wastePct, setWastePct] = useState(0);
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync the worksheet picker if the user switches active worksheet outside this form.
  useEffect(() => {
    if (activeWorksheetId && activeWorksheetId !== "all" && worksheets.some((w) => w.id === activeWorksheetId)) {
      setWsId(activeWorksheetId);
      setItemId("");
    }
  }, [activeWorksheetId, worksheets]);

  const ws = worksheets.find((w) => w.id === wsId);
  const filteredItems = useMemo(() => {
    const items = ws?.items ?? [];
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(
      (i) =>
        i.entityName.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q),
    );
  }, [ws, search]);

  const multiplier = 1 + wastePct / 100;
  const rawValue = annotation.measurement
    ? Number((annotation.measurement as Record<string, unknown>)[quantityField] ?? annotation.measurement.value ?? 0) || 0
    : 0;
  const derived = rawValue * multiplier;

  const handleCreate = useCallback(async () => {
    if (!itemId) return;
    setSubmitting(true);
    setError(null);
    try {
      await createTakeoffLink(projectId, {
        annotationId: annotation.id,
        worksheetItemId: itemId,
        quantityField,
        multiplier,
      });
      setItemId("");
      setSearch("");
      setWastePct(0);
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create link");
    } finally {
      setSubmitting(false);
    }
  }, [annotation.id, itemId, multiplier, onCreated, projectId, quantityField]);

  return (
    <Section label="Link to line item">
      <div className="space-y-2">
        {worksheets.length > 1 && (
          <div>
            <Label className="text-[10px]">Worksheet</Label>
            <Select
              value={wsId}
              onValueChange={(v) => {
                setWsId(v);
                setItemId("");
              }}
              options={worksheets.map((w) => ({ value: w.id, label: w.name }))}
            />
          </div>
        )}

        <div>
          <Label className="text-[10px]">Item</Label>
          <Input
            placeholder="Search items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-1.5"
          />
          <div className="max-h-40 overflow-auto rounded-md border border-line">
            {filteredItems.length === 0 ? (
              <p className="px-2 py-2 text-center text-[11px] text-fg/40">No items match.</p>
            ) : (
              filteredItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setItemId(item.id)}
                  className={cn(
                    "flex w-full items-center gap-2 border-b border-line/50 px-2 py-1.5 text-left text-[11px] transition-colors last:border-b-0",
                    itemId === item.id ? "bg-accent/10 text-accent" : "text-fg/70 hover:bg-panel2/60",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{item.entityName || "Unnamed"}</span>
                  <span className="shrink-0 text-[10px] text-fg/30">
                    {item.quantity} {item.uom}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px]">Field</Label>
            <Select
              value={quantityField}
              onValueChange={setQuantityField}
              options={fields.map((f) => ({ value: f.value, label: f.label }))}
            />
          </div>
          <div>
            <Label className="text-[10px]">Waste %</Label>
            <Input
              type="number"
              min={0}
              max={100}
              step={1}
              value={wastePct}
              onChange={(e) => setWastePct(Number(e.target.value) || 0)}
            />
          </div>
        </div>

        <div className="rounded-md bg-panel2/50 px-2 py-1.5">
          <p className="text-[10px] text-fg/40">Preview</p>
          <p className="text-[11px] font-medium text-fg">
            {rawValue.toFixed(2)} {annotation.measurement?.unit ?? ""} × {multiplier.toFixed(2)} ={" "}
            <span className="text-accent">{derived.toFixed(2)}</span>
          </p>
        </div>

        {error && <p className="text-[11px] text-danger">{error}</p>}

        <Button size="sm" onClick={() => void handleCreate()} disabled={!itemId || submitting} className="w-full">
          {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Create link
        </Button>
      </div>
    </Section>
  );
}

function SuggestSection({
  projectId,
  annotation,
  worksheets,
  activeWorksheetId,
  entityCategories,
  defaultMarkup,
  onCreated,
}: {
  projectId: string;
  annotation: TakeoffAnnotation;
  worksheets: WorkspaceWorksheet[];
  activeWorksheetId?: string;
  entityCategories: EntityCategory[];
  defaultMarkup: number;
  onCreated: () => void | Promise<void>;
}) {
  const [suggestions, setSuggestions] = useState<LineItemSuggestionRecord[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const targetWs = useMemo(
    () =>
      (activeWorksheetId && activeWorksheetId !== "all"
        ? worksheets.find((w) => w.id === activeWorksheetId)
        : worksheets[0]) ?? null,
    [activeWorksheetId, worksheets],
  );

  const handleSuggest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await suggestLineItemsForAnnotation(projectId, annotation.id);
      setSuggestions(result.suggestions);
      setWarnings(result.warnings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch suggestions");
    } finally {
      setLoading(false);
    }
  }, [annotation.id, projectId]);

  const handleApply = useCallback(
    async (suggestion: LineItemSuggestionRecord) => {
      if (!targetWs || !annotation.measurement) {
        setError("Pick a worksheet and ensure the annotation has a measurement.");
        return;
      }
      const targetCat = pickCategoryForSuggestion(entityCategories, suggestion);
      if (!targetCat) {
        setError("Configure at least one entity category in Settings before applying suggestions.");
        return;
      }
      setApplyingId(suggestion.id);
      setError(null);
      try {
        const quantity =
          suggestion.recommendedQuantity > 0 ? suggestion.recommendedQuantity : annotation.measurement.value ?? 0;
        const uom = suggestion.unit || annotation.measurement.unit || "EA";
        const entityName = suggestion.code ? `[${suggestion.code}] ${suggestion.name}` : suggestion.name;

        const result = await createWorksheetItem(projectId, targetWs.id, {
          categoryId: targetCat.id,
          category: targetCat.name,
          entityType: targetCat.entityType,
          entityName,
          description: suggestion.reasoning ?? "",
          quantity,
          uom,
          cost: 0,
          markup: defaultMarkup,
          price: 0,
          sourceNotes: `AI-suggested from takeoff: ${annotation.label || annotation.type}`,
          ...(suggestion.kind === "rateScheduleItem"
            ? { rateScheduleItemId: suggestion.id }
            : { itemId: suggestion.id }),
        });

        const newItems =
          (result?.workspace?.worksheets?.flatMap((ws: { items?: { id: string }[] }) => ws.items ?? []) ??
            []) as { id: string }[];
        const knownIds = new Set(worksheets.flatMap((ws) => (ws.items ?? []).map((i) => i.id)));
        const newItem = newItems.find((i) => !knownIds.has(i.id));

        if (newItem) {
          await createTakeoffLink(projectId, {
            annotationId: annotation.id,
            worksheetItemId: newItem.id,
          });
        }
        await onCreated();
        setSuggestions((prev) => (prev ? prev.filter((s) => s.id !== suggestion.id) : prev));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to apply suggestion");
      } finally {
        setApplyingId(null);
      }
    },
    [annotation, defaultMarkup, entityCategories, onCreated, projectId, targetWs, worksheets],
  );

  return (
    <Section label="AI suggestions">
      {!suggestions ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void handleSuggest()}
          disabled={loading}
          className="w-full"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          Suggest line items
        </Button>
      ) : suggestions.length === 0 ? (
        <div className="flex items-center justify-between gap-2 text-[11px] text-fg/40">
          <span>No matches found.</span>
          <button
            type="button"
            onClick={() => setSuggestions(null)}
            className="rounded p-1 text-fg/30 hover:bg-panel2 hover:text-fg/60"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {suggestions.map((s) => (
            <div key={s.id} className="rounded-md border border-line bg-panel/60 px-2 py-1.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium text-fg">{s.code ? `[${s.code}] ${s.name}` : s.name}</p>
                  {s.reasoning && (
                    <p className="mt-0.5 line-clamp-2 text-[10px] text-fg/45">{s.reasoning}</p>
                  )}
                  <p className="mt-1 text-[10px] text-fg/40">
                    {s.recommendedQuantity > 0 ? s.recommendedQuantity.toFixed(2) : "?"} {s.unit || ""}
                  </p>
                </div>
                <Button
                  size="xs"
                  onClick={() => void handleApply(s)}
                  disabled={applyingId !== null}
                  className="shrink-0"
                >
                  {applyingId === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Apply"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="mt-1 list-disc pl-4 text-[10px] text-fg/40">
          {warnings.map((w, idx) => (
            <li key={idx}>{w}</li>
          ))}
        </ul>
      )}
      {error && <p className="text-[11px] text-danger">{error}</p>}
    </Section>
  );
}

function SelectionHeader({
  title,
  subtitle,
  accent,
}: {
  title: string;
  subtitle?: string;
  accent?: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-panel2/50 px-2 py-1.5">
      {accent && (
        <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-fg">{title}</p>
        {subtitle && <p className="truncate text-[10px] text-fg/40">{subtitle}</p>}
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-fg/40">{label}</div>
      {children}
    </div>
  );
}

function pickCategoryForSuggestion(
  categories: EntityCategory[],
  suggestion: LineItemSuggestionRecord,
): EntityCategory | null {
  const enabled = categories.filter((c) => c.enabled);
  if (enabled.length === 0) return null;
  if (suggestion.kind === "rateScheduleItem") {
    const rateCat = enabled.find((c) => {
      const haystack = `${c.name} ${c.entityType}`.toLowerCase();
      return haystack.includes("labour") || haystack.includes("labor");
    });
    if (rateCat) return rateCat;
  }
  return enabled.slice().sort((a, b) => a.order - b.order)[0] ?? null;
}

function formatAnnotationMeasurement(ann: TakeoffAnnotation): string | undefined {
  const m = ann.measurement;
  if (!m) return undefined;
  const parts: string[] = [];
  if (typeof m.value === "number" && Number.isFinite(m.value)) {
    parts.push(`${m.value.toFixed(2)} ${m.unit ?? ""}`.trim());
  }
  if (typeof m.area === "number" && Number.isFinite(m.area) && m.area > 0) {
    parts.push(`${m.area.toFixed(2)} ${m.unit ?? ""}²`.trim());
  }
  if (typeof m.volume === "number" && Number.isFinite(m.volume) && m.volume > 0) {
    parts.push(`${m.volume.toFixed(2)} ${m.unit ?? ""}³`.trim());
  }
  return parts.join(" · ");
}
