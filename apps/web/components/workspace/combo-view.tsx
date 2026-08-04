"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout, type LayoutStorage } from "react-resizable-panels";
import { ArrowRight, Check, Compass, FileText, GripHorizontal, Layers, ListPlus, Maximize2, Minimize2, PanelRightClose, Sparkles, TableProperties } from "lucide-react";
import { Button, Drawer } from "@appkit/ui";
import type { ProjectWorkspaceData, WorkspaceResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import { TakeoffTab } from "./takeoff-tab";
import { EstimateGrid } from "./estimate-grid";
import { TakeoffLinkView, type TakeoffSelection } from "./takeoff-link-view";
import {
  TakeoffCategoryChooser,
  TakeoffInspectView,
  type InspectActions,
  type InspectCategoryPick,
  type InspectSnapshot,
  type TakeoffComposeRequest,
} from "./takeoff-inspect-view";
import type { Pickup } from "./takeoff/annotation-canvas";
import type { BidwrightModelSelectionMessage } from "./editors/bidwright-model-editor";

type PluginToolsTarget = { pluginId?: string; pluginSlug?: string; toolId?: string };
/** Pickups is the persistent query/grouping workspace. Inspect and Add are
 *  progressive AppKit drawers so the model/drawing never loses its working
 *  context while an estimator verifies or prices selected scope. */
type RightPanelTab = "pickups" | "inspect" | "add";

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

type TakeoffViewState = { documentId: string; page: number; zoom: number };

function serializeTakeoffViewState(state: TakeoffViewState | null) {
  return state ? JSON.stringify(state) : "null";
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
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>("pickups");
  const [inspectDrawerOpen, setInspectDrawerOpen] = useState(false);
  const [composeRequest, setComposeRequest] = useState<TakeoffComposeRequest | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [takeoffDetached, setTakeoffDetached] = useState(false);
  const [takeoffSelection, setTakeoffSelection] = useState<TakeoffSelection | null>(null);
  const [takeoffViewState, setTakeoffViewState] = useState<TakeoffViewState | null>(
    initialDocumentId ? { documentId: initialDocumentId, page: 1, zoom: 1 } : null,
  );
  const [annotationsCache, setAnnotationsCache] = useState<Pickup[]>([]);
  const [linksReloadSignal, setLinksReloadSignal] = useState(0);
  const handleLinksMutated = useCallback(() => setLinksReloadSignal((k) => k + 1), []);
  const handleTakeoffSelectionChange = useCallback((next: TakeoffSelection | null) => {
    setTakeoffSelection((prev) => (
      serializeTakeoffSelection(prev) === serializeTakeoffSelection(next) ? prev : next
    ));
    if (next) {
      setInspectDrawerOpen(true);
      setRightPanelTab("inspect");
    }
  }, []);
  const handleRequestCompose = useCallback((request: TakeoffComposeRequest) => {
    setComposeRequest(request);
    setRightPanelTab("add");
  }, []);
  const takeoffViewStateSignatureRef = useRef<string | null>(serializeTakeoffViewState(takeoffViewState));
  const handleTakeoffViewStateChange = useCallback((next: TakeoffViewState) => {
    const signature = serializeTakeoffViewState(next);
    if (signature === takeoffViewStateSignatureRef.current) return;
    takeoffViewStateSignatureRef.current = signature;
    setTakeoffViewState(next);
  }, []);
  useEffect(() => {
    if (!initialDocumentId) return;
    const next = { documentId: initialDocumentId, page: 1, zoom: 1 };
    const signature = serializeTakeoffViewState(next);
    if (signature === takeoffViewStateSignatureRef.current) return;
    takeoffViewStateSignatureRef.current = signature;
    setTakeoffViewState(next);
  }, [initialDocumentId]);
  const annotationsCacheSignatureRef = useRef<string | null>(null);
  const handleAnnotationsChange = useCallback((next: Pickup[]) => {
    const signature = JSON.stringify(next);
    if (signature === annotationsCacheSignatureRef.current) return;
    annotationsCacheSignatureRef.current = signature;
    setAnnotationsCache(next);
  }, []);
  const containerRef = useRef<HTMLDivElement>(null);
  const detachedTakeoffWindowRef = useRef<Window | null>(null);

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
  const handleRightPanelTabChange = useCallback((tab: RightPanelTab) => {
    setRightPanelTab(tab);
    if (tab === "pickups") {
      setInspectDrawerOpen(false);
      setComposeRequest(null);
    } else if (tab === "inspect") {
      setInspectDrawerOpen(true);
    } else if (tab === "add" && !composeRequest) {
      const actions = inspectActionsRef.current;
      const selection = takeoffSelection;
      if (!actions || !selection) return;
      if (selection.kind === "annotation") {
        const annotation = inspectSnapshot?.annotations.find((candidate) => candidate.id === selection.pickupId);
        handleRequestCompose({
          id: `selection:annotation:${selection.pickupId}`,
          title: annotation?.label || "Selected takeoff pickup",
          description: annotation?.measurement ? `${annotation.measurement.value ?? 1} ${annotation.measurement.unit ?? "EA"}` : undefined,
          sourceLabel: "Drawing pickup",
          count: 1,
          mode: "single",
          execute: (pick) => actions.createLineItemFromAnnotation(selection.pickupId, pick),
        });
      } else if (selection.kind === "model-element") {
        handleRequestCompose({
          id: `selection:model:${selection.elementId}`,
          title: selection.elementName,
          description: [selection.elementClass, selection.material, selection.level, selection.quantitySummary].filter(Boolean).join(" · "),
          sourceLabel: "Model element",
          count: 1,
          mode: "single",
          execute: (pick) => actions.createLineItemFromElement(selection.elementId, pick),
        });
      } else if (selection.kind === "cad-entity") {
        handleRequestCompose({
          id: `selection:cad:${selection.entityId}`,
          title: selection.label || selection.entityType || "CAD entity",
          description: [selection.layer, selection.summary].filter(Boolean).join(" · "),
          sourceLabel: "CAD entity",
          count: 1,
          mode: "single",
          execute: (pick) => actions.createLineItemFromDwgEntity(selection.entityId, pick),
        });
      } else if (selection.kind === "model-selection" && selection.selectedNodeIds.length > 0) {
        handleRequestCompose({
          id: `selection:model-group:${selection.selectedNodeIds.join(",")}`,
          title: `${selection.selectedCount} selected model objects`,
          description: selection.fileName,
          sourceLabel: "3D model selection",
          count: selection.selectedCount,
          mode: "group",
          execute: (pick) => actions.createLineItemFromElementGroup(selection.selectedNodeIds, `${selection.selectedCount} selected model objects`, pick),
        });
      }
    }
  }, [composeRequest, handleRequestCompose, inspectSnapshot, takeoffSelection]);

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

  const handleDetachedWindowChange = useCallback((open: boolean, win?: Window | null) => {
    detachedTakeoffWindowRef.current = open ? win ?? detachedTakeoffWindowRef.current : null;
    setTakeoffDetached(open);
    if (open) setRightPanelTab("pickups");
  }, []);

  const handleMergeDetachedTakeoff = useCallback(() => {
    const win = detachedTakeoffWindowRef.current;
    if (win && !win.closed) {
      win.close();
    }
    detachedTakeoffWindowRef.current = null;
    setTakeoffDetached(false);
  }, []);

  useEffect(() => {
    if (!takeoffDetached) return;
    const interval = window.setInterval(() => {
      const win = detachedTakeoffWindowRef.current;
      if (win && win.closed) {
        detachedTakeoffWindowRef.current = null;
        setTakeoffDetached(false);
      }
    }, 900);
    return () => window.clearInterval(interval);
  }, [takeoffDetached]);

  const layoutStorage = useMemo<LayoutStorage>(() => ({
    getItem: (key) => (typeof window === "undefined" ? null : window.localStorage.getItem(key)),
    setItem: (key, value) => {
      if (typeof window === "undefined") return;
      try { window.localStorage.setItem(key, value); } catch {}
    },
  }), []);

  const verticalLayout = useDefaultLayout({
    // Versioned so the Takeoff Studio cutover resets legacy, often-crushed
    // local panel sizes to the deliberate 2/3 canvas + 1/3 worksheet dock.
    id: "combo-view-vertical-studio-v1",
    panelIds: ["combo-top", "combo-bottom"],
    storage: layoutStorage,
  });
  const horizontalLayout = useDefaultLayout({
    id: "combo-view-horizontal",
    panelIds: ["combo-takeoff", "combo-right"],
    storage: layoutStorage,
  });

  const detachedLayout = useDefaultLayout({
    id: "combo-view-detached-v2",
    panelIds: ["combo-detached-worksheets", "combo-detached-entities"],
    storage: layoutStorage,
  });

  const takeoffSurface = (
    <TakeoffTab
      workspace={workspace}
      onOpenAgentChat={onOpenAgentChat}
      onOpenRevisionDiff={onOpenRevisionDiff}
      onWorkspaceMutated={onWorkspaceMutated}
      detached={takeoffDetached}
      workspaceSyncOriginId={takeoffOriginId}
      selectedWorksheetId={selectedWorksheetId ?? null}
      initialDocumentId={takeoffViewState?.documentId ?? initialDocumentId}
      initialPage={takeoffViewState?.page ?? 1}
      initialZoom={takeoffViewState?.zoom ?? 1}
      selection={takeoffSelection}
      onSelectionChange={handleTakeoffSelectionChange}
      onViewStateChange={handleTakeoffViewStateChange}
      onAnnotationsChange={handleAnnotationsChange}
      linksReloadSignal={linksReloadSignal}
      onLinksMutated={handleLinksMutated}
      modelSendToEstimateRef={modelSendToEstimateRef}
      modelElementCreateLineItemRef={modelElementCreateLineItemRef}
      inspectActionsRef={inspectActionsRef}
      onOpenInspectEntities={() => setRightPanelTab("pickups")}
      onInspectSnapshotChange={handleInspectSnapshotChange}
      onDetachedWindowChange={handleDetachedWindowChange}
    />
  );

  if (takeoffDetached) {
    return (
      <div
        ref={containerRef}
        className={cn(
          "relative flex flex-col flex-1 min-h-0",
          fullscreen && "bg-bg p-2",
        )}
      >
        <div className="fixed -left-[10000px] top-0 h-[720px] w-[1024px] overflow-hidden opacity-0 pointer-events-none" aria-hidden="true">
          {takeoffSurface}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-panel/80 px-3 py-1.5">
          <div className="min-w-0 text-xs">
            <span className="font-medium text-fg/75">Takeoff popped out</span>
            <span className="ml-2 text-fg/40">Worksheets left, entities right</span>
          </div>
          <button
            type="button"
            onClick={handleMergeDetachedTakeoff}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line bg-bg/40 px-2 text-[11px] font-medium text-fg/65 transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
            title="Close the detached takeoff window and restore the full workspace layout"
          >
            <PanelRightClose className="h-3.5 w-3.5" />
            Merge back
          </button>
        </div>
        <Group
          orientation="horizontal"
          className="flex-1 min-h-0"
          defaultLayout={detachedLayout.defaultLayout}
          onLayoutChanged={detachedLayout.onLayoutChanged}
        >
          <Panel id="combo-detached-worksheets" defaultSize="75%" minSize="45%">
            <div className="h-full min-h-0 pr-1.5">
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

          <Separator className="group relative !w-px bg-line transition-colors hover:bg-accent/60 data-[resize-active]:bg-accent">
            <div className="absolute inset-y-0 -left-1 -right-1" />
          </Separator>

          <Panel id="combo-detached-entities" defaultSize="25%" minSize="18%">
            <div className="h-full min-h-0 border-l border-line bg-panel/30">
              <RightPanel
                workspace={workspace}
                activeWorksheetId={activeWorksheetId}
                tab={rightPanelTab}
                onTabChange={handleRightPanelTabChange}
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
                inspectDrawerOpen={inspectDrawerOpen}
                onInspectDrawerOpenChange={setInspectDrawerOpen}
                composeRequest={composeRequest}
                onRequestCompose={handleRequestCompose}
                onCloseComposer={() => { setComposeRequest(null); setRightPanelTab(inspectDrawerOpen ? "inspect" : "pickups"); }}
                onActiveWorksheetChange={onActiveWorksheetChange}
              />
            </div>
          </Panel>
        </Group>
      </div>
    );
  }

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
        <Panel id="combo-top" defaultSize="67%" minSize="45%">
          <Group
            orientation="horizontal"
            className="h-full"
            defaultLayout={horizontalLayout.defaultLayout}
            onLayoutChanged={horizontalLayout.onLayoutChanged}
          >
            <Panel id="combo-takeoff" defaultSize="67%" minSize="30%">
              <div className="h-full min-h-0 flex flex-col pr-1.5 pb-1.5">
                {takeoffSurface}
              </div>
            </Panel>

            <Separator className="group relative !w-px bg-line transition-colors hover:bg-accent/60 data-[resize-active]:bg-accent">
              <div className="absolute inset-y-0 -left-1 -right-1" />
            </Separator>

            <Panel
              id="combo-right"
              defaultSize="28%"
              minSize="20%"
              collapsible
              collapsedSize="0%"
            >
              <div className="h-full min-h-0 flex flex-col bg-panel/30">
                <RightPanel
                  workspace={workspace}
                  activeWorksheetId={activeWorksheetId}
                  tab={rightPanelTab}
                  onTabChange={handleRightPanelTabChange}
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
                  inspectDrawerOpen={inspectDrawerOpen}
                  onInspectDrawerOpenChange={setInspectDrawerOpen}
                  composeRequest={composeRequest}
                  onRequestCompose={handleRequestCompose}
                  onCloseComposer={() => { setComposeRequest(null); setRightPanelTab(inspectDrawerOpen ? "inspect" : "pickups"); }}
                  onActiveWorksheetChange={onActiveWorksheetChange}
                />
              </div>
            </Panel>
          </Group>
        </Panel>

        <Separator className="group relative !h-px bg-line transition-colors hover:bg-accent/60 data-[resize-active]:bg-accent">
          <div className="absolute inset-x-0 -top-2 -bottom-2 z-10 flex items-center justify-center">
            <span className="flex h-4 w-8 items-center justify-center rounded-full border border-line bg-panel text-fg/25 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-data-[resize-active]:opacity-100">
              <GripHorizontal className="h-3 w-3" />
            </span>
          </div>
        </Separator>

        <Panel
          id="combo-bottom"
          defaultSize="33%"
          minSize="22%"
          maxSize="55%"
          collapsible
          collapsedSize="0%"
        >
          <div className="flex h-full min-h-0 flex-col bg-panel/15">
            <div className={cn(
              "flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 transition-colors",
              composeRequest && "border-accent/30 bg-accent/5",
            )}>
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-panel2 text-fg/55">
                <TableProperties className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-fg/40">Worksheet dock</p>
              </div>
              {(() => {
                const worksheet = workspace.worksheets.find((candidate) => candidate.id === activeWorksheetId) ?? workspace.worksheets[0];
                return worksheet ? (
                  <>
                    <span className="text-fg/20">/</span>
                    <span className="min-w-0 truncate text-xs font-medium text-fg/75">{worksheet.name}</span>
                    <span className="shrink-0 rounded-full border border-line bg-bg/40 px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-fg/40">
                      {(worksheet.items ?? []).length.toLocaleString()} lines
                    </span>
                  </>
                ) : null;
              })()}
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {composeRequest && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[9px] font-medium text-accent">
                    <ArrowRight className="h-2.5 w-2.5" />
                    {composeRequest.mode === "batch" ? `${composeRequest.count} staged lines` : "Incoming pickup"}
                  </span>
                )}
                <span className="hidden text-[9px] text-fg/30 xl:inline">Drag divider to resize</span>
              </div>
            </div>
            <div className="min-h-0 flex-1">
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
  inspectDrawerOpen,
  onInspectDrawerOpenChange,
  composeRequest,
  onRequestCompose,
  onCloseComposer,
  onActiveWorksheetChange,
}: {
  workspace: ProjectWorkspaceData;
  activeWorksheetId?: string;
  tab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  onOpenAgentChat?: (prefill?: string) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  takeoffSelection: TakeoffSelection | null;
  annotationsCache: Pickup[];
  onLinksMutated: () => void;
  onSendModelSelectionToEstimate: (selection: BidwrightModelSelectionMessage) => Promise<void> | void;
  onCreateLineItemFromModelElement: (elementId: string) => Promise<void> | void;
  inspectSnapshot: InspectSnapshot | null;
  inspectActionsRef: React.MutableRefObject<InspectActions | null>;
  inspectDrawerOpen: boolean;
  onInspectDrawerOpenChange: (open: boolean) => void;
  composeRequest: TakeoffComposeRequest | null;
  onRequestCompose: (request: TakeoffComposeRequest) => void;
  onCloseComposer: () => void;
  onActiveWorksheetChange?: (worksheetId: string) => void;
}) {
  const tabs: Array<{ id: RightPanelTab; label: string; icon: typeof Compass }> = [
    { id: "pickups", label: "Pickups", icon: Layers },
    { id: "inspect", label: "Inspect", icon: Compass },
    { id: "add", label: "Add", icon: ListPlus },
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
              disabled={(t.id === "inspect" && !takeoffSelection) || (t.id === "add" && !takeoffSelection && !composeRequest)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                isActive ? "bg-panel2 text-fg" : "text-fg/45 hover:text-fg/70",
                "disabled:cursor-not-allowed disabled:opacity-35",
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

      <div className="shrink-0 border-b border-line/70 bg-bg/25 px-3 py-2">
        <p className="text-[10px] font-semibold text-fg/70">Find, group, and stage measurable scope</p>
        <p className="mt-0.5 text-[9px] leading-relaxed text-fg/40">Click a row to inspect it. Check several rows to build a batch. Use a group action for one summed estimate line.</p>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-2">
        <TakeoffInspectView
          snapshot={inspectSnapshot}
          actions={inspectActionsRef.current}
          onRequestCompose={onRequestCompose}
        />
      </div>

      <Drawer
        open={inspectDrawerOpen}
        onClose={() => {
          onInspectDrawerOpenChange(false);
          if (!composeRequest) onTabChange("pickups");
        }}
        title="Inspect pickup"
        description="Verify source geometry, quantities, properties, and existing worksheet links."
        size="md"
        bodyClassName="min-h-0 overflow-hidden p-4"
        footer={takeoffSelection ? (
          <div className="flex w-full items-center justify-between gap-3">
            <p className="text-xs text-fg/45">Ready to place this pickup in the estimate?</p>
            <Button size="sm" onClick={() => onTabChange("add")}>
              Add to estimate <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : undefined}
      >
        <div className="flex h-full min-h-0 flex-col gap-3">
          <DocumentSummaryCard snapshot={inspectSnapshot} />
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-lg border border-line bg-panel/35 p-3">
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
        </div>
      </Drawer>

      <TakeoffComposerDrawer
        request={composeRequest}
        workspace={workspace}
        activeWorksheetId={activeWorksheetId}
        snapshot={inspectSnapshot}
        actions={inspectActionsRef.current}
        stacked={inspectDrawerOpen}
        onClose={onCloseComposer}
        onActiveWorksheetChange={onActiveWorksheetChange}
      />
    </>
  );
}

function TakeoffComposerDrawer({
  request,
  workspace,
  activeWorksheetId,
  snapshot,
  actions,
  stacked,
  onClose,
  onActiveWorksheetChange,
}: {
  request: TakeoffComposeRequest | null;
  workspace: ProjectWorkspaceData;
  activeWorksheetId?: string;
  snapshot: InspectSnapshot | null;
  actions: InspectActions | null;
  stacked: boolean;
  onClose: () => void;
  onActiveWorksheetChange?: (worksheetId: string) => void;
}) {
  const defaultWorksheetId = activeWorksheetId ?? workspace.worksheets[0]?.id ?? "";
  const [worksheetId, setWorksheetId] = useState(defaultWorksheetId);
  const [categoryPick, setCategoryPick] = useState<InspectCategoryPick | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setWorksheetId(activeWorksheetId ?? workspace.worksheets[0]?.id ?? "");
    const lastCategoryId = snapshot?.takeoffCategoryId;
    const lastCategory = snapshot?.availableCategories.find((category) => category.id === lastCategoryId);
    setCategoryPick(lastCategory && lastCategory.itemSource !== "rate_schedule" ? { categoryId: lastCategory.id } : null);
    setSubmitting(false);
  }, [activeWorksheetId, request?.id, snapshot?.takeoffCategoryId, workspace.worksheets[0]?.id]);

  const submit = async () => {
    if (!request || !categoryPick || submitting) return;
    setSubmitting(true);
    try {
      if (worksheetId && worksheetId !== activeWorksheetId) {
        onActiveWorksheetChange?.(worksheetId);
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }
      await request.execute(categoryPick);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const targetWorksheet = workspace.worksheets.find((worksheet) => worksheet.id === worksheetId);
  return (
    <Drawer
      open={Boolean(request)}
      onClose={onClose}
      title="Add to estimate"
      description="Turn verified takeoff scope into traceable worksheet pricing."
      size="lg"
      stacked={stacked}
      bodyClassName="p-0"
      footer={(
        <div className="flex w-full items-center justify-between gap-3">
          <div className="min-w-0 text-xs text-fg/45">
            <span className="font-medium text-fg/70">{targetWorksheet?.name ?? "Worksheet"}</span>
            <span> · {request?.mode === "batch" ? `${request.count} lines` : "1 line"}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={() => void submit()} disabled={!categoryPick || !worksheetId || submitting}>
              {submitting ? "Adding…" : "Add to estimate"}
              {!submitting && <ArrowRight className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      )}
    >
      <div className="flex min-h-full flex-col">
        <div className="border-b border-line bg-panel/30 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
              {request?.mode === "group" ? <Sparkles className="h-5 w-5" /> : request?.mode === "batch" ? <ListPlus className="h-5 w-5" /> : <Check className="h-5 w-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-sm font-semibold text-fg">{request?.title ?? "Pickup"}</h3>
                <span className="rounded-full border border-line bg-bg/50 px-2 py-0.5 text-[10px] font-medium text-fg/50">{request?.sourceLabel}</span>
                {request && request.count > 1 && <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">{request.count.toLocaleString()} pickups</span>}
              </div>
              {request?.description && <p className="mt-1 text-xs leading-relaxed text-fg/50">{request.description}</p>}
            </div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="border-b border-line bg-bg/30 p-4 lg:border-b-0 lg:border-r">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-fg/40">Destination</p>
            <label className="mt-3 block text-xs font-medium text-fg/70" htmlFor="takeoff-target-worksheet">Worksheet</label>
            <select
              id="takeoff-target-worksheet"
              value={worksheetId}
              onChange={(event) => setWorksheetId(event.target.value)}
              className="mt-1.5 h-9 w-full rounded-md border border-line bg-panel px-2.5 text-xs text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
            >
              {workspace.worksheets.map((worksheet) => <option key={worksheet.id} value={worksheet.id}>{worksheet.name}</option>)}
            </select>
            <div className="mt-4 rounded-lg border border-line bg-panel/45 p-3">
              <p className="text-[10px] font-semibold text-fg/65">Creation mode</p>
              <p className="mt-1 text-[11px] leading-relaxed text-fg/45">
                {request?.mode === "group"
                  ? "One summed worksheet line with every source pickup linked for revision traceability."
                  : request?.mode === "batch"
                    ? "One worksheet line per staged pickup, all placed into the same category."
                    : "One worksheet line linked back to this source pickup."}
              </p>
            </div>
          </aside>
          <main className="min-h-0 p-5">
            <div className="mb-3">
              <p className="text-sm font-semibold text-fg">Price as</p>
              <p className="mt-0.5 text-xs text-fg/45">Choose the estimate category and, when required, the exact ratebook item.</p>
            </div>
            <TakeoffCategoryChooser snapshot={snapshot} actions={actions} value={categoryPick} onChange={setCategoryPick} />
          </main>
        </div>
      </div>
    </Drawer>
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
  const linkCount = snapshot.pickupLinks.length;

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
