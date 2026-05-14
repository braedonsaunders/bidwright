"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout, type LayoutStorage } from "react-resizable-panels";
import { Compass, FileText, Layers, Maximize2, Minimize2 } from "lucide-react";
import type { ProjectWorkspaceData, WorkspaceResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import { TakeoffTab } from "./takeoff-tab";
import { EstimateGrid } from "./estimate-grid";
import { TakeoffLinkView, type TakeoffSelection } from "./takeoff-link-view";
import { TakeoffInspectView, type InspectActions, type InspectSnapshot } from "./takeoff-inspect-view";
import type { TakeoffAnnotation } from "./takeoff/annotation-canvas";
import type { BidwrightModelSelectionMessage } from "./editors/bidwright-model-editor";

type PluginToolsTarget = { pluginId?: string; pluginSlug?: string; toolId?: string };
/** Inspect = current document summary + details about the selected entity.
 *  Entities = full scrolling list of every entity in the document, with
 *  per-row "+ Add" to the active worksheet. The old "Link" tab folded into
 *  Inspect's selection details since both were keyed off the same selection. */
type RightPanelTab = "inspect" | "entities";

export interface ComboViewProps {
  workspace: ProjectWorkspaceData;
  onApply: (next: WorkspaceResponse | ((prev: WorkspaceResponse) => WorkspaceResponse)) => void;
  onError: (msg: string) => void;
  onRefresh: () => void;
  onOpenAgentChat?: (prefill?: string) => void;
  onOpenRevisionDiff?: () => void;
  onOpenPluginTools?: (target?: PluginToolsTarget) => void;
  onOpenTakeoffLink?: (worksheetItemId: string) => void;
  onWorkspaceMutated?: () => void;
  workspaceSyncOriginId?: string;
  selectedWorksheetId?: string | null;
  activeWorksheetId?: string;
  onActiveWorksheetChange?: (worksheetId: string) => void;
  initialDocumentId?: string | null;
  highlightItemId?: string;
  /** Forwarded to the embedded EstimateGrid so BIM-linked worksheet rows
   *  display the latest revision-diff impact chip. */
  revisionImpactByItem?: Record<string, {
    oldQuantity: number;
    newQuantity: number;
    costDelta: number;
    changeType: "added" | "removed" | "modified";
    changeName: string;
    changeClass: string;
  }>;
}

function serializeTakeoffSelection(selection: TakeoffSelection | null) {
  return selection ? JSON.stringify(selection) : "null";
}

export function ComboView({
  workspace,
  onApply,
  onError,
  onRefresh,
  onOpenAgentChat,
  onOpenRevisionDiff,
  onOpenPluginTools,
  onOpenTakeoffLink,
  onWorkspaceMutated,
  workspaceSyncOriginId,
  selectedWorksheetId,
  activeWorksheetId,
  onActiveWorksheetChange,
  initialDocumentId,
  highlightItemId,
  revisionImpactByItem,
}: ComboViewProps) {
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>("inspect");
  const [fullscreen, setFullscreen] = useState(false);
  const [takeoffSelection, setTakeoffSelection] = useState<TakeoffSelection | null>(null);
  const [annotationsCache, setAnnotationsCache] = useState<TakeoffAnnotation[]>([]);
  const [linksReloadSignal, setLinksReloadSignal] = useState(0);
  const handleLinksMutated = useCallback(() => setLinksReloadSignal((k) => k + 1), []);
  const handleTakeoffSelectionChange = useCallback((next: TakeoffSelection | null) => {
    setTakeoffSelection((prev) => (
      serializeTakeoffSelection(prev) === serializeTakeoffSelection(next) ? prev : next
    ));
  }, []);
  const annotationsCacheSignatureRef = useRef<string | null>(null);
  const handleAnnotationsChange = useCallback((next: TakeoffAnnotation[]) => {
    const signature = JSON.stringify(next);
    if (signature === annotationsCacheSignatureRef.current) return;
    annotationsCacheSignatureRef.current = signature;
    setAnnotationsCache(next);
  }, []);
  const containerRef = useRef<HTMLDivElement>(null);

  // Bridge: TakeoffTab populates these refs with its action handlers so the
  // side-panel link view can trigger them without TakeoffTab having to expose
  // its entire state graph.
  const modelSendToEstimateRef = useRef<
    ((selection: BidwrightModelSelectionMessage) => Promise<void> | void) | null
  >(null);
  const handleModelSendToEstimate = useCallback(
    async (selection: BidwrightModelSelectionMessage) => {
      await modelSendToEstimateRef.current?.(selection);
    },
    [],
  );
  const modelElementCreateLineItemRef = useRef<((elementId: string) => Promise<void> | void) | null>(null);
  const handleCreateLineItemFromModelElement = useCallback(async (elementId: string) => {
    await modelElementCreateLineItemRef.current?.(elementId);
  }, []);

  // Inspect bridge: TakeoffTab publishes a snapshot of what's currently
  // inspectable (annotations or model elements) and populates an actions ref
  // so the side-panel Inspect tab can drive everything.
  const [inspectSnapshot, setInspectSnapshot] = useState<InspectSnapshot | null>(null);
  const inspectActionsRef = useRef<InspectActions | null>(null);
  const inspectSnapshotSignatureRef = useRef<string | null>(null);
  const handleInspectSnapshotChange = useCallback((next: InspectSnapshot) => {
    const signature = JSON.stringify(next);
    if (signature === inspectSnapshotSignatureRef.current) return;
    inspectSnapshotSignatureRef.current = signature;
    setInspectSnapshot(next);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (typeof document === "undefined") return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void containerRef.current?.requestFullscreen();
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const takeoffOriginId = workspaceSyncOriginId ? `${workspaceSyncOriginId}-combo` : undefined;

  const layoutStorage = useMemo<LayoutStorage>(() => ({
    getItem: (key) => (typeof window === "undefined" ? null : window.localStorage.getItem(key)),
    setItem: (key, value) => {
      if (typeof window === "undefined") return;
      try { window.localStorage.setItem(key, value); } catch {}
    },
  }), []);

  const verticalLayout = useDefaultLayout({
    id: "combo-view-vertical",
    panelIds: ["combo-top", "combo-bottom"],
    storage: layoutStorage,
  });
  const horizontalLayout = useDefaultLayout({
    id: "combo-view-horizontal",
    panelIds: ["combo-takeoff", "combo-right"],
    storage: layoutStorage,
  });

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex flex-col flex-1 min-h-0",
        fullscreen && "bg-bg p-2",
      )}
    >
      <Group
        orientation="vertical"
        className="flex-1 min-h-0"
        defaultLayout={verticalLayout.defaultLayout}
        onLayoutChanged={verticalLayout.onLayoutChanged}
      >
        <Panel id="combo-top" defaultSize="67%" minSize="30%">
          <Group
            orientation="horizontal"
            className="h-full"
            defaultLayout={horizontalLayout.defaultLayout}
            onLayoutChanged={horizontalLayout.onLayoutChanged}
          >
            <Panel id="combo-takeoff" defaultSize="67%" minSize="30%">
              <div className="h-full min-h-0 flex flex-col pr-1.5 pb-1.5">
                <TakeoffTab
                  workspace={workspace}
                  onOpenAgentChat={onOpenAgentChat}
                  onOpenRevisionDiff={onOpenRevisionDiff}
                  onWorkspaceMutated={onWorkspaceMutated}
                  workspaceSyncOriginId={takeoffOriginId}
                  selectedWorksheetId={selectedWorksheetId ?? null}
                  initialDocumentId={initialDocumentId}
                  selection={takeoffSelection}
                  onSelectionChange={handleTakeoffSelectionChange}
                  onAnnotationsChange={handleAnnotationsChange}
                  linksReloadSignal={linksReloadSignal}
                  onLinksMutated={handleLinksMutated}
                  modelSendToEstimateRef={modelSendToEstimateRef}
                  modelElementCreateLineItemRef={modelElementCreateLineItemRef}
                  inspectActionsRef={inspectActionsRef}
                  onOpenInspectEntities={() => setRightPanelTab("entities")}
                  onInspectSnapshotChange={handleInspectSnapshotChange}
                />
              </div>
            </Panel>

            <Separator className="group relative !w-px bg-line transition-colors hover:bg-accent/60 data-[resize-active]:bg-accent">
              <div className="absolute inset-y-0 -left-1 -right-1" />
            </Separator>

            <Panel
              id="combo-right"
              defaultSize="22%"
              minSize="15%"
              collapsible
              collapsedSize="0%"
            >
              <div className="h-full min-h-0 flex flex-col bg-panel/30">
                <RightPanel
                  workspace={workspace}
                  activeWorksheetId={activeWorksheetId}
                  tab={rightPanelTab}
                  onTabChange={setRightPanelTab}
                  onOpenAgentChat={onOpenAgentChat}
                  fullscreen={fullscreen}
                  onToggleFullscreen={toggleFullscreen}
                  takeoffSelection={takeoffSelection}
                  annotationsCache={annotationsCache}
                  onLinksMutated={handleLinksMutated}
                  onSendModelSelectionToEstimate={handleModelSendToEstimate}
                  onCreateLineItemFromModelElement={handleCreateLineItemFromModelElement}
                  inspectSnapshot={inspectSnapshot}
                  inspectActionsRef={inspectActionsRef}
                />
              </div>
            </Panel>
          </Group>
        </Panel>

        <Separator className="group relative !h-px bg-line transition-colors hover:bg-accent/60 data-[resize-active]:bg-accent">
          <div className="absolute inset-x-0 -top-1 -bottom-1" />
        </Separator>

        <Panel
          id="combo-bottom"
          defaultSize="33%"
          minSize="15%"
          collapsible
          collapsedSize="0%"
        >
          <div className="h-full min-h-0 flex flex-col">
            <EstimateGrid
              workspace={workspace}
              onApply={onApply}
              onError={onError}
              onRefresh={onRefresh}
              highlightItemId={highlightItemId}
              activeWorksheetId={activeWorksheetId}
              onActiveWorksheetChange={onActiveWorksheetChange}
              onOpenPluginTools={onOpenPluginTools}
              onOpenTakeoffLink={onOpenTakeoffLink}
              revisionImpactByItem={revisionImpactByItem}
              onOpenRevisionDiff={onOpenRevisionDiff}
            />
          </div>
        </Panel>
      </Group>
    </div>
  );
}

function RightPanel({
  workspace,
  activeWorksheetId,
  tab,
  onTabChange,
  onOpenAgentChat,
  fullscreen,
  onToggleFullscreen,
  takeoffSelection,
  annotationsCache,
  onLinksMutated,
  onSendModelSelectionToEstimate,
  onCreateLineItemFromModelElement,
  inspectSnapshot,
  inspectActionsRef,
}: {
  workspace: ProjectWorkspaceData;
  activeWorksheetId?: string;
  tab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  onOpenAgentChat?: (prefill?: string) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  takeoffSelection: TakeoffSelection | null;
  annotationsCache: TakeoffAnnotation[];
  onLinksMutated: () => void;
  onSendModelSelectionToEstimate: (selection: BidwrightModelSelectionMessage) => Promise<void> | void;
  onCreateLineItemFromModelElement: (elementId: string) => Promise<void> | void;
  inspectSnapshot: InspectSnapshot | null;
  inspectActionsRef: React.MutableRefObject<InspectActions | null>;
}) {
  const tabs: Array<{ id: RightPanelTab; label: string; icon: typeof Compass }> = [
    { id: "inspect", label: "Inspect", icon: Compass },
    { id: "entities", label: "Entities", icon: Layers },
  ];

  const FsIcon = fullscreen ? Minimize2 : Maximize2;

  return (
    <>
      <div className="flex items-center gap-0.5 border-b border-line px-1.5 py-1 shrink-0">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                isActive ? "bg-panel2 text-fg" : "text-fg/45 hover:text-fg/70",
              )}
            >
              <Icon className="h-3 w-3" />
              {t.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onToggleFullscreen}
          title={fullscreen ? "Exit full screen (Esc)" : "Full screen"}
          className="ml-auto rounded-md p-1 text-fg/40 transition-colors hover:bg-panel2 hover:text-fg/80"
        >
          <FsIcon className="h-3 w-3" />
        </button>
      </div>

      {/* Inspect needs flex flex-col so the doc summary stays pinned at the top
          and the selection-details pane below it owns its own internal scroll
          on the linked-items list — the primary action button (Send to estimate)
          must never fall off-screen, so the pane itself stays fit-to-height. */}
      <div className="flex-1 min-h-0 p-3 flex flex-col gap-2 overflow-hidden">
        {tab === "inspect" && (
          <>
            <DocumentSummaryCard snapshot={inspectSnapshot} />
            <div className="flex min-h-0 flex-1 flex-col rounded-md border border-line bg-panel/40 p-2">
              <TakeoffLinkView
                workspace={workspace}
                selection={takeoffSelection}
                annotations={annotationsCache}
                activeWorksheetId={activeWorksheetId}
                onLinksMutated={onLinksMutated}
                onSendModelSelectionToEstimate={onSendModelSelectionToEstimate}
                onCreateLineItemFromModelElement={onCreateLineItemFromModelElement}
              />
            </div>
          </>
        )}
        {tab === "entities" && (
          <TakeoffInspectView snapshot={inspectSnapshot} actions={inspectActionsRef.current} />
        )}
      </div>
    </>
  );
}

/** Document summary header pinned at the top of the Inspect tab. For BIM /
 *  3D model documents this carries the full KPI block (BIM / Editable badges
 *  plus Objects / Qty / Links / Issues stats); for PDF / DWG it falls back to
 *  a compact filename + counts row. The block used to live inside the
 *  Entities list; surfacing it here gives the list its vertical space back. */
function DocumentSummaryCard({ snapshot }: { snapshot: InspectSnapshot | null }) {
  if (!snapshot || snapshot.mode === "empty") {
    return (
      <div className="shrink-0 rounded-md border border-line bg-panel/50 px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] text-fg/45">
          <FileText className="h-3.5 w-3.5 text-fg/30" />
          <span>No document open</span>
        </div>
      </div>
    );
  }

  const isModelMode = snapshot.mode === "bim" || snapshot.mode === "model";
  const isBim = snapshot.mode === "bim";

  if (isModelMode && snapshot.modelAsset) {
    return (
      <div className="shrink-0 rounded-md border border-line bg-panel/50 px-2.5 py-1.5 text-xs">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-[11px] font-semibold text-fg" title={snapshot.modelAsset.fileName}>
            {snapshot.modelAsset.fileName}
          </p>
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
                snapshot.modelAsset.isEditable ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
              )}
            >
              {snapshot.modelAsset.isEditable ? "Editable" : "Preview"}
            </span>
          </div>
        </div>
        <div className="mt-1 grid grid-cols-4 gap-1 text-center text-[10px]">
          <CardStat label="Objects" value={snapshot.modelAsset.counts.elements} />
          <CardStat label="Qty" value={snapshot.modelAsset.counts.quantities} />
          <CardStat label="Links" value={snapshot.modelAsset.counts.links} />
          <CardStat label="Issues" value={snapshot.modelAsset.counts.issues} />
        </div>
      </div>
    );
  }

  if (snapshot.mode === "spreadsheet") {
    const ss = snapshot.spreadsheet;
    return (
      <div className="shrink-0 rounded-md border border-line bg-panel/50 px-2.5 py-1.5 text-xs">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-[11px] font-semibold text-fg" title={ss?.sourceName}>
            {ss?.sourceName ?? "Spreadsheet"}
          </p>
          <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-medium text-emerald-600">
            Spreadsheet
          </span>
        </div>
        {ss ? (
          <div className="mt-1 grid grid-cols-3 gap-1 text-center text-[10px]">
            <CardStat label="Rows" value={ss.rowCount} />
            <CardStat label="Columns" value={ss.columnCount} />
            <CardStat label="Mapped" value={[ss.mapping.name, ss.mapping.quantity, ss.mapping.uom, ss.mapping.cost].filter(Boolean).length} />
          </div>
        ) : (
          <p className="mt-1 text-[10px] text-fg/45">Loading preview…</p>
        )}
      </div>
    );
  }

  // PDF / DWG fallback — no modelAsset to lean on.
  const modeLabel =
    snapshot.mode === "pdf" ? "PDF takeoff"
      : snapshot.mode === "dwg" ? "DWG / DXF takeoff"
      : "Document";
  const fileName = snapshot.modelAsset?.fileName;
  const annotationCount = snapshot.annotations.length;
  const linkCount = snapshot.takeoffLinks.length;

  return (
    <div className="shrink-0 rounded-md border border-line bg-panel/50 px-3 py-2 text-[11px]">
      <div className="flex items-center gap-2">
        <FileText className="h-3.5 w-3.5 shrink-0 text-fg/40" />
        <span className="min-w-0 truncate font-semibold text-fg/80" title={fileName ?? undefined}>
          {fileName ?? modeLabel}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-fg/55">
        <span className="font-medium text-fg/70">{modeLabel}</span>
        <span className="tabular-nums">{annotationCount.toLocaleString()} marks</span>
        {linkCount > 0 && (
          <span className="tabular-nums">{linkCount.toLocaleString()} linked</span>
        )}
        <span className="tabular-nums">
          {snapshot.annotations.filter((a) => a.visible).length} visible
        </span>
      </div>
    </div>
  );
}

/** Tiny KPI cell — same shape as ModelInspect's old Stat helper, kept local
 *  to DocumentSummaryCard so the inspect-view rewrite can drop its copy. */
function CardStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-bg/30 py-1">
      <p className="text-[9px] uppercase tracking-wider text-fg/40">{label}</p>
      <p className="text-[12px] font-semibold tabular-nums text-fg">{value.toLocaleString()}</p>
    </div>
  );
}
