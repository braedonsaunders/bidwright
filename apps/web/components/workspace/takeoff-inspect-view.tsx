"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Eye, EyeOff, FilePlus, Link2, Loader2, Pencil, RefreshCw, Trash2, X, BrainCircuit } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { TakeoffAnnotation } from "@/components/workspace/takeoff/annotation-canvas";
import type { TakeoffLinkRecord } from "@/lib/api";

/** `bim` is element-aware (IFC/Revit/Navisworks) and uses the BIM-specific
 *  inspect surface; `model` is geometry-only (STEP/glTF/OBJ/STL) and degrades
 *  to a metric summary without element semantics. */
export type InspectMode = "pdf" | "dwg" | "bim" | "model" | "empty";
export type InspectModelBasis = "count" | "area" | "volume";

export interface InspectModelElement {
  id: string;
  name: string;
  externalId: string;
  elementClass?: string | null;
  material?: string | null;
  level?: string | null;
  /** Construction classification keyed by standard. Same shape and keys as
   *  WorksheetItem.classification. UI surfaces Uniformat first (most common
   *  estimating reporting axis), then MasterFormat. */
  classification?: Record<string, string> | null;
  /** Level of Development: "" | "100" | "200" | "300" | "350" | "400" | "500". */
  lod?: string | null;
  /** Provenance of LOD: "manual" | "pset" | "". Used by the UI to badge how
   *  the LOD was determined and warn before re-ingest could clobber it. */
  lodSource?: string | null;
  quantitySummary: string;
  isLinked: boolean;
}

export interface InspectAssetSummary {
  id: string;
  fileName: string;
  status: string;
  parser: string;
  isEditable: boolean;
  counts: { elements: number; quantities: number; links: number; issues: number };
}

export interface InspectSnapshot {
  mode: InspectMode;
  // PDF / DWG annotations
  annotations: TakeoffAnnotation[];
  takeoffLinks: TakeoffLinkRecord[];
  selectedAnnotationId: string | null;
  editingAnnotationId: string | null;
  // 3D model
  modelElements: InspectModelElement[];
  modelElementsLoading: boolean;
  modelError: string | null;
  modelSyncing: boolean;
  modelSearch: string;
  modelBasis: InspectModelBasis;
  modelAsset: InspectAssetSummary | null;
  selectedModelElementId: string | null;
}

export interface InspectActions {
  selectAnnotation: (id: string | null) => void;
  toggleAnnotationVisibility: (id: string) => void;
  deleteAnnotation: (id: string) => void;
  editAnnotation: (id: string) => void;
  saveAnnotationEdit: (id: string, updates: { label?: string; color?: string; groupName?: string }) => void;
  setModelSearch: (s: string) => void;
  setModelBasis: (b: InspectModelBasis) => void;
  selectModelElement: (id: string | null) => void;
  /** Create a worksheet line item from the model element in one click. Preserves
   *  classification (Uniformat/MasterFormat/...) and the primary quantity, and
   *  binds a ModelTakeoffLink so the line stays in sync with the element on
   *  revision diff. Implemented by TakeoffTab; the inspect view just dispatches. */
  createLineItemFromElement: (id: string) => Promise<void> | void;
  refreshModel: () => void;
  askAiAboutModel: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  distance: "Distance",
  "area-rectangle": "Rectangle area",
  "area-polygon": "Polygon area",
  count: "Count",
  text: "Note",
};

const EDIT_COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"];

export function TakeoffInspectView({
  snapshot,
  actions,
}: {
  snapshot: InspectSnapshot | null;
  actions: InspectActions | null;
}) {
  if (!snapshot || snapshot.mode === "empty") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-[11px] leading-relaxed text-fg/45">
          Open a takeoff document to browse its annotations or model objects here.
        </p>
      </div>
    );
  }

  if (snapshot.mode === "bim" || snapshot.mode === "model") {
    return <ModelInspect snapshot={snapshot} actions={actions} />;
  }

  return <AnnotationsInspect snapshot={snapshot} actions={actions} />;
}

function AnnotationsInspect({
  snapshot,
  actions,
}: {
  snapshot: InspectSnapshot;
  actions: InspectActions | null;
}) {
  const { annotations, takeoffLinks, selectedAnnotationId, editingAnnotationId, mode } = snapshot;
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const linkCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const link of takeoffLinks) {
      map.set(link.annotationId, (map.get(link.annotationId) ?? 0) + 1);
    }
    return map;
  }, [takeoffLinks]);

  const groups = useMemo(() => {
    const map = new Map<string, TakeoffAnnotation[]>();
    for (const ann of annotations) {
      const key = ann.groupName || ann.type;
      const arr = map.get(key) ?? [];
      arr.push(ann);
      map.set(key, arr);
    }
    return map;
  }, [annotations]);

  const totalCount = annotations.length;
  const visibleCount = annotations.filter((a) => a.visible).length;
  const supportsInlineEdit = mode === "pdf";

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col gap-2 text-xs">
      <div className="shrink-0 rounded-md border border-line bg-panel/50 px-2.5 py-1.5">
        <p className="text-[10px] font-medium uppercase tracking-wider text-fg/40">
          {mode === "dwg" ? "DWG measurements" : "Takeoff marks"}
        </p>
        <p className="mt-0.5 text-[11px] text-fg/60">
          {totalCount} item{totalCount === 1 ? "" : "s"} · {visibleCount} visible
        </p>
      </div>

      {totalCount === 0 ? (
        <p className="rounded-md border border-line bg-panel/40 px-3 py-4 text-center text-[11px] text-fg/40">
          {mode === "dwg"
            ? "Draw a measurement to build the DWG ledger."
            : "Use a tool and click on the drawing to start measuring."}
        </p>
      ) : (
        <div className="flex flex-1 flex-col gap-1 overflow-auto pr-1">
          {Array.from(groups.entries()).map(([groupKey, items]) => {
            const collapsed = collapsedGroups.has(groupKey);
            const groupLabel = TYPE_LABELS[groupKey] ?? groupKey;
            return (
              <div key={groupKey}>
                <button
                  onClick={() => toggleGroup(groupKey)}
                  className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] font-medium text-fg/60 hover:bg-panel2/60 transition-colors"
                >
                  {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  <span className="truncate">{groupLabel}</span>
                  <span className="ml-auto text-[10px] text-fg/30">×{items.length}</span>
                </button>
                {!collapsed && (
                  <div className="ml-2 mt-0.5 space-y-0.5">
                    {items.map((ann) =>
                      supportsInlineEdit && editingAnnotationId === ann.id && actions ? (
                        <EditAnnotationRow
                          key={ann.id}
                          ann={ann}
                          onSave={(updates) => actions.saveAnnotationEdit(ann.id, updates)}
                          onCancel={() => actions.editAnnotation(ann.id)}
                        />
                      ) : (
                        <AnnotationRow
                          key={ann.id}
                          ann={ann}
                          isSelected={selectedAnnotationId === ann.id}
                          linkCount={linkCountMap.get(ann.id) ?? 0}
                          actions={actions}
                          supportsInlineEdit={supportsInlineEdit}
                        />
                      ),
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AnnotationRow({
  ann,
  isSelected,
  linkCount,
  actions,
  supportsInlineEdit,
}: {
  ann: TakeoffAnnotation;
  isSelected: boolean;
  linkCount: number;
  actions: InspectActions | null;
  supportsInlineEdit: boolean;
}) {
  return (
    <div
      onClick={() => actions?.selectAnnotation(isSelected ? null : ann.id)}
      className={cn(
        "group flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-[11px] transition-colors",
        isSelected ? "bg-accent/10 ring-1 ring-accent/30" : "hover:bg-panel2/40",
      )}
    >
      <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: ann.color }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <p className="truncate font-medium text-fg/80">
            {ann.label || TYPE_LABELS[ann.type] || ann.type}
          </p>
          {linkCount > 0 && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-accent/10 px-1 py-0.5 text-[9px] font-medium text-accent">
              <Link2 className="h-2 w-2" />
              {linkCount}
            </span>
          )}
        </div>
        <p className="text-[10px] text-fg/40">{formatMeasurement(ann)}</p>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            actions?.toggleAnnotationVisibility(ann.id);
          }}
          className="rounded p-1 text-fg/30 hover:bg-panel2 hover:text-fg/60"
          title={ann.visible ? "Hide" : "Show"}
        >
          {ann.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
        </button>
        {supportsInlineEdit && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              actions?.editAnnotation(ann.id);
            }}
            className="rounded p-1 text-fg/30 hover:bg-panel2 hover:text-fg/60"
            title="Edit"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            actions?.deleteAnnotation(ann.id);
          }}
          className="rounded p-1 text-fg/30 hover:bg-danger/10 hover:text-danger"
          title="Delete"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function EditAnnotationRow({
  ann,
  onSave,
  onCancel,
}: {
  ann: TakeoffAnnotation;
  onSave: (updates: { label?: string; color?: string; groupName?: string }) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(ann.label);
  const [color, setColor] = useState(ann.color);
  const [group, setGroup] = useState(ann.groupName ?? "");

  return (
    <div className="rounded-md border border-accent/30 bg-accent/5 p-1.5">
      <Input
        className="h-6 text-xs"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Label..."
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave({ label, color, groupName: group || undefined });
          if (e.key === "Escape") onCancel();
        }}
      />
      <Input
        className="mt-1 h-6 text-xs"
        value={group}
        onChange={(e) => setGroup(e.target.value)}
        placeholder="Group name..."
      />
      <div className="mt-1.5 flex items-center gap-1">
        {EDIT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            className={cn(
              "h-4 w-4 rounded-full border-2 transition-all",
              color === c ? "border-fg scale-110" : "border-transparent hover:border-fg/20",
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <div className="mt-1 flex items-center justify-end gap-1">
        <button onClick={onCancel} className="rounded p-1 text-fg/40 hover:text-fg/60" title="Cancel">
          <X className="h-3 w-3" />
        </button>
        <button
          onClick={() => onSave({ label, color, groupName: group || undefined })}
          className="rounded p-1 text-accent hover:text-accent/80"
          title="Save"
        >
          <Check className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

/** Grouping axes for the BIM element list. Reuses the same construction-
 *  classification primitive that powers the estimate summary rollups, so the
 *  element grouping is consistent with how the line items those elements
 *  back will appear in the quote summary. */
type InspectGroupBy = "none" | "uniformat" | "masterformat" | "elementClass" | "level" | "material";

const GROUP_BY_OPTIONS: { id: InspectGroupBy; label: string }[] = [
  { id: "none",         label: "Flat" },
  { id: "uniformat",    label: "Uniformat" },
  { id: "masterformat", label: "MasterFormat" },
  { id: "elementClass", label: "Class" },
  { id: "level",        label: "Level" },
  { id: "material",     label: "Material" },
];

function ModelInspect({
  snapshot,
  actions,
}: {
  snapshot: InspectSnapshot;
  actions: InspectActions | null;
}) {
  const { modelElements, modelElementsLoading, modelError, modelSyncing, modelSearch, modelBasis, modelAsset, selectedModelElementId } = snapshot;
  const isBim = snapshot.mode === "bim";
  const [groupBy, setGroupBy] = useState<InspectGroupBy>("none");
  const [collapsedElementGroups, setCollapsedElementGroups] = useState<Set<string>>(new Set());

  // Group elements by the selected axis. For classification axes (Uniformat,
  // MasterFormat) we read the code straight off element.classification[key]
  // — same shape as WorksheetItem.classification, so the grouping is
  // consistent with the by_uniformat_division / by_masterformat_division
  // summary rollups (no separate mapping needed). For class/level/material
  // we fall back to the element's typed columns. Elements with no value
  // bucket into "Unclassified" / "Untagged" so they're still discoverable.
  const groupedElements = useMemo(() => {
    if (groupBy === "none") return null;
    const groups = new Map<string, { key: string; label: string; elements: InspectModelElement[] }>();
    for (const element of modelElements) {
      let code = "";
      let label = "";
      if (groupBy === "uniformat" || groupBy === "masterformat") {
        code = element.classification?.[groupBy]?.trim() ?? "";
        label = code || (groupBy === "uniformat" ? "Unclassified — Uniformat" : "Unclassified — MasterFormat");
      } else if (groupBy === "elementClass") {
        code = element.elementClass?.trim() ?? "";
        label = code || "No class";
      } else if (groupBy === "level") {
        code = element.level?.trim() ?? "";
        label = code || "No level";
      } else if (groupBy === "material") {
        code = element.material?.trim() ?? "";
        label = code || "No material";
      }
      const key = code || `__unclassified__${groupBy}`;
      let group = groups.get(key);
      if (!group) {
        group = { key, label, elements: [] };
        groups.set(key, group);
      }
      group.elements.push(element);
    }
    // Sort: unclassified bucket(s) last; everything else alphabetical by key.
    return Array.from(groups.values()).sort((a, b) => {
      const aUn = a.key.startsWith("__unclassified__") ? 1 : 0;
      const bUn = b.key.startsWith("__unclassified__") ? 1 : 0;
      if (aUn !== bUn) return aUn - bUn;
      return a.key.localeCompare(b.key);
    });
  }, [modelElements, groupBy]);

  const toggleGroup = (key: string) => {
    setCollapsedElementGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col gap-2 text-xs">
      {modelAsset && (
        <div className="shrink-0 rounded-md border border-line bg-panel/50 px-2.5 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-[11px] font-semibold text-fg">{modelAsset.fileName}</p>
            <div className="flex shrink-0 items-center gap-1">
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium",
                  isBim ? "bg-violet-500/15 text-violet-500" : "bg-rose-500/15 text-rose-500",
                )}
                title={isBim ? "Building Information Model" : "Geometry-only model"}
              >
                {isBim ? "BIM" : "3D"}
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium",
                  modelAsset.isEditable ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
                )}
              >
                {modelAsset.isEditable ? "Editable" : "Preview"}
              </span>
            </div>
          </div>
          <div className="mt-1 grid grid-cols-4 gap-1 text-center text-[10px]">
            <Stat label="Objects" value={modelAsset.counts.elements} />
            <Stat label="Qty" value={modelAsset.counts.quantities} />
            <Stat label="Links" value={modelAsset.counts.links} />
            <Stat label="Issues" value={modelAsset.counts.issues} />
          </div>
        </div>
      )}

      <div className="shrink-0 space-y-1.5">
        <Input
          className="h-7 text-xs"
          value={modelSearch}
          onChange={(e) => actions?.setModelSearch(e.target.value)}
          placeholder="Search objects, classes, materials..."
        />
        <div className="flex items-center gap-0.5 rounded-md border border-line bg-panel p-0.5">
          {(["count", "area", "volume"] as InspectModelBasis[]).map((basis) => (
            <button
              key={basis}
              type="button"
              onClick={() => actions?.setModelBasis(basis)}
              className={cn(
                "flex-1 rounded px-1.5 py-1 text-[10px] font-medium capitalize transition-colors",
                modelBasis === basis ? "bg-accent/15 text-accent" : "text-fg/45 hover:text-fg/70",
              )}
            >
              {basis}
            </button>
          ))}
        </div>
        {/* Group-by selector. Reuses the same classification keys as the
            estimate summary rollups (Uniformat / MasterFormat) so the
            element grouping shown here aligns with how the resulting line
            items will appear in the quote summary. Class/level/material
            fall back to the typed columns for non-classification axes. */}
        <div className="flex items-center gap-1 overflow-x-auto rounded-md border border-line bg-panel p-0.5">
          <span className="shrink-0 px-1 text-[9px] font-medium uppercase tracking-wider text-fg/35">
            Group
          </span>
          {GROUP_BY_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                setGroupBy(opt.id);
                setCollapsedElementGroups(new Set());
              }}
              className={cn(
                "shrink-0 rounded px-1.5 py-1 text-[10px] font-medium transition-colors",
                groupBy === opt.id ? "bg-accent/15 text-accent" : "text-fg/45 hover:text-fg/70",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1 overflow-auto pr-1">
        {modelElementsLoading && modelElements.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-4 text-fg/40">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        ) : modelElements.length === 0 ? (
          <p className="rounded-md border border-line bg-panel/40 px-3 py-4 text-center text-[11px] text-fg/40">
            {modelAsset ? "No model objects match this search." : "Sync the model index to list model objects."}
          </p>
        ) : groupedElements ? (
          // Grouped rendering: each axis bucket gets a sticky-ish header with
          // a count and a collapse toggle. Element rows inside reuse the same
          // markup as the flat list.
          groupedElements.map((group) => {
            const collapsed = collapsedElementGroups.has(group.key);
            const linkedCount = group.elements.filter((e) => e.isLinked).length;
            return (
              <div key={group.key} className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  className="flex items-center gap-1.5 rounded-md border border-line bg-panel/80 px-2 py-1 text-left text-[10px] font-medium text-fg/70 transition-colors hover:bg-panel2/40"
                >
                  {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  <span className="min-w-0 flex-1 truncate">{group.label}</span>
                  <span className="shrink-0 text-fg/40">
                    {group.elements.length}
                    {linkedCount > 0 && (
                      <span className="ml-1 text-success/80">· {linkedCount} linked</span>
                    )}
                  </span>
                </button>
                {!collapsed && group.elements.map((element) => renderElementRow(
                  element,
                  selectedModelElementId,
                  actions,
                ))}
              </div>
            );
          })
        ) : (
          modelElements.map((element) => renderElementRow(element, selectedModelElementId, actions))
        )}
      </div>

      {modelError && (
        <div className="shrink-0 rounded-md border border-danger/30 bg-danger/5 px-2 py-1.5 text-[10px] text-danger">
          {modelError}
        </div>
      )}

      <div className="shrink-0 flex flex-col gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-center"
          disabled={modelSyncing}
          onClick={() => actions?.refreshModel()}
        >
          {modelSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Sync model index
        </Button>
        <Button variant="secondary" size="sm" className="w-full justify-center" onClick={() => actions?.askAiAboutModel()}>
          <BrainCircuit className="h-3 w-3" />
          Ask AI about this model
        </Button>
      </div>
    </div>
  );
}

/** Shared element-row renderer for the BIM Inspect list. Lives outside the
 *  ModelInspect component so the flat-list and grouped-list branches don't
 *  duplicate ~80 lines of JSX. */
function renderElementRow(
  element: InspectModelElement,
  selectedModelElementId: string | null,
  actions: InspectActions | null,
) {
  const isSelected = selectedModelElementId === element.id;
  const uniformat = element.classification?.uniformat?.trim();
  const masterformat = element.classification?.masterformat?.trim();
  const lod = element.lod?.trim();
  const lodFromPset = element.lodSource === "pset";
  return (
    <div
      key={element.id}
      onClick={() => actions?.selectModelElement(isSelected ? null : element.id)}
      className={cn(
        "cursor-pointer rounded-md border px-2 py-1.5 transition-colors",
        isSelected
          ? "border-accent/40 bg-accent/10"
          : element.isLinked
            ? "border-success/25 bg-success/5"
            : "border-line bg-panel/60 hover:bg-panel2/40",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium text-fg/80">{element.name || element.externalId}</p>
          <p className="mt-0.5 truncate text-[10px] text-fg/40">
            {[element.elementClass, element.material, element.level].filter(Boolean).join(" · ") || "Model element"}
          </p>
          {(uniformat || masterformat || lod) && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {uniformat && (
                <span
                  className="rounded bg-violet-500/12 px-1 py-px text-[9px] font-medium text-violet-500"
                  title={`Uniformat: ${uniformat}`}
                >
                  UF · {uniformat}
                </span>
              )}
              {masterformat && (
                <span
                  className="rounded bg-amber-500/12 px-1 py-px text-[9px] font-medium text-amber-600"
                  title={`MasterFormat: ${masterformat}`}
                >
                  MF · {masterformat}
                </span>
              )}
              {lod && (
                <span
                  className={cn(
                    "rounded px-1 py-px text-[9px] font-medium",
                    lodFromPset
                      ? "bg-sky-500/12 text-sky-500"
                      : "bg-fg/10 text-fg/70",
                  )}
                  title={`Level of Development${lodFromPset ? " (from model property set)" : " (manual)"}`}
                >
                  LOD {lod}
                </span>
              )}
            </div>
          )}
          <p className="mt-1 text-[10px] font-medium text-fg/60">{element.quantitySummary}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {element.isLinked ? (
            <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[9px] font-medium text-success">
              Linked
            </span>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void actions?.createLineItemFromElement(element.id);
              }}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-line bg-bg/50 px-1.5 text-[10px] font-medium text-fg/70 transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
              title="Create a worksheet line item from this element (carries classification + quantity, keeps it linked)"
            >
              <FilePlus className="h-3 w-3" />
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-line bg-bg/40 py-0.5">
      <p className="text-[9px] text-fg/40">{label}</p>
      <p className="text-[11px] font-semibold text-fg/80 tabular-nums">{value}</p>
    </div>
  );
}

function formatMeasurement(ann: TakeoffAnnotation): string {
  if (!ann.measurement) return "—";
  const { value, unit } = ann.measurement;
  if (unit === "count") return `${value}`;
  return `${value.toFixed(2)} ${unit}`;
}
