"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout, type LayoutStorage } from "react-resizable-panels";
import { Compass, Link2, Maximize2, Minimize2 } from "lucide-react";
import type { ProjectWorkspaceData, WorkspaceResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import { TakeoffTab } from "./takeoff-tab";
import { EstimateGrid } from "./estimate-grid";
import { TakeoffLinkView, type TakeoffSelection } from "./takeoff-link-view";
import { TakeoffInspectView, type InspectActions, type InspectSnapshot } from "./takeoff-inspect-view";
import type { TakeoffAnnotation } from "./takeoff/annotation-canvas";
import type { BidwrightModelSelectionMessage } from "./editors/bidwright-model-editor";

type PluginToolsTarget = { pluginId?: string; pluginSlug?: string; toolId?: string };
type RightPanelTab = "inspect" | "link";

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
                  onSelectionChange={setTakeoffSelection}
                  onAnnotationsChange={setAnnotationsCache}
                  linksReloadSignal={linksReloadSignal}
                  onLinksMutated={handleLinksMutated}
                  modelSendToEstimateRef={modelSendToEstimateRef}
                  modelElementCreateLineItemRef={modelElementCreateLineItemRef}
                  inspectActionsRef={inspectActionsRef}
                  onInspectSnapshotChange={setInspectSnapshot}
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
    { id: "link", label: "Link", icon: Link2 },
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

      {/* Inspect view has its own internal scrolling on the element list so the
          header / search / basis / group toggles stay sticky while the list
          fills the remaining height. Anything else (Link tab content) gets
          the old overflow-auto behaviour. */}
      <div className={cn("flex-1 min-h-0 p-3", tab === "inspect" ? "flex flex-col" : "overflow-auto")}>
        {tab === "inspect" && <TakeoffInspectView snapshot={inspectSnapshot} actions={inspectActionsRef.current} />}
        {tab === "link" && (
          <TakeoffLinkView
            workspace={workspace}
            selection={takeoffSelection}
            annotations={annotationsCache}
            activeWorksheetId={activeWorksheetId}
            onLinksMutated={onLinksMutated}
            onSendModelSelectionToEstimate={onSendModelSelectionToEstimate}
            onCreateLineItemFromModelElement={onCreateLineItemFromModelElement}
          />
        )}
      </div>
    </>
  );
}

function InspectView({
  workspace,
  activeWorksheetId,
}: {
  workspace: ProjectWorkspaceData;
  activeWorksheetId?: string;
}) {
  const activeWs =
    activeWorksheetId && activeWorksheetId !== "all"
      ? workspace.worksheets.find((w) => w.id === activeWorksheetId)
      : undefined;
  const itemCount = activeWs?.items?.length ?? workspace.worksheets.reduce((acc, w) => acc + (w.items?.length ?? 0), 0);
  const wsCount = workspace.worksheets.length;

  return (
    <div className="space-y-5 text-xs">
      <Section label="Active worksheet">
        <div className="text-sm text-fg">
          {activeWs?.name ?? <span className="text-fg/40 italic">All worksheets</span>}
        </div>
        <Stat label={activeWs ? "Items" : "Worksheets"} value={activeWs ? itemCount : wsCount} />
        {!activeWs && <Stat label="Items (total)" value={itemCount} />}
      </Section>
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

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <div className="text-fg/40">{label}</div>
      <div className="text-fg tabular-nums">{value}</div>
    </div>
  );
}
