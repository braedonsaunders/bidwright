"use client";

import { useEffect, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Compass, Maximize2, Minimize2, MousePointerClick, Sparkles } from "lucide-react";
import type { ProjectWorkspaceData, WorkspaceResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import { TakeoffTab } from "./takeoff-tab";
import { EstimateGrid } from "./estimate-grid";

type PluginToolsTarget = { pluginId?: string; pluginSlug?: string; toolId?: string };
type RightPanelTab = "inspect" | "detail" | "ai";

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
}: ComboViewProps) {
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>("inspect");
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const takeoffOriginId = workspaceSyncOriginId ? `${workspaceSyncOriginId}-combo` : undefined;

  return (
    <div
      className={cn(
        "flex flex-col",
        fullscreen ? "fixed inset-0 z-50 bg-bg p-2" : "flex-1 min-h-0",
      )}
    >
      <Group orientation="vertical" className="flex-1 min-h-0">
        <Panel defaultSize="67%" minSize="30%">
          <Group orientation="horizontal" className="h-full">
            <Panel defaultSize="67%" minSize="30%">
              <div className="h-full min-h-0 flex flex-col pr-1.5 pb-1.5">
                <TakeoffTab
                  workspace={workspace}
                  onOpenAgentChat={onOpenAgentChat}
                  onOpenRevisionDiff={onOpenRevisionDiff}
                  onWorkspaceMutated={onWorkspaceMutated}
                  workspaceSyncOriginId={takeoffOriginId}
                  selectedWorksheetId={selectedWorksheetId ?? null}
                  initialDocumentId={initialDocumentId}
                />
              </div>
            </Panel>

            <Separator className="group relative !w-px bg-line transition-colors hover:bg-accent/60 data-[resize-active]:bg-accent">
              <div className="absolute inset-y-0 -left-1 -right-1" />
            </Separator>

            <Panel defaultSize="33%" minSize="18%">
              <div className="h-full min-h-0 flex flex-col bg-panel/30">
                <RightPanel
                  workspace={workspace}
                  activeWorksheetId={activeWorksheetId}
                  tab={rightPanelTab}
                  onTabChange={setRightPanelTab}
                  onOpenAgentChat={onOpenAgentChat}
                  fullscreen={fullscreen}
                  onToggleFullscreen={() => setFullscreen((f) => !f)}
                />
              </div>
            </Panel>
          </Group>
        </Panel>

        <Separator className="group relative !h-px bg-line transition-colors hover:bg-accent/60 data-[resize-active]:bg-accent">
          <div className="absolute inset-x-0 -top-1 -bottom-1" />
        </Separator>

        <Panel defaultSize="33%" minSize="15%">
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
}: {
  workspace: ProjectWorkspaceData;
  activeWorksheetId?: string;
  tab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  onOpenAgentChat?: (prefill?: string) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  const tabs: Array<{ id: RightPanelTab; label: string; icon: typeof Compass }> = [
    { id: "inspect", label: "Inspect", icon: Compass },
    { id: "detail", label: "Detail", icon: MousePointerClick },
    { id: "ai", label: "AI", icon: Sparkles },
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

      <div className="flex-1 min-h-0 overflow-auto p-3">
        {tab === "inspect" && <InspectView workspace={workspace} activeWorksheetId={activeWorksheetId} />}
        {tab === "detail" && <DetailView />}
        {tab === "ai" && <AIView onOpenAgentChat={onOpenAgentChat} />}
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

      <Section label="Cross-pane links">
        <p className="text-[11px] leading-relaxed text-fg/50">
          Select an annotation in the takeoff or a row in the worksheet to see linked items here.
        </p>
      </Section>
    </div>
  );
}

function DetailView() {
  return <div className="text-[11px] italic text-fg/40">Nothing selected. Click an item to view its detail.</div>;
}

function AIView({ onOpenAgentChat }: { onOpenAgentChat?: (prefill?: string) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-relaxed text-fg/60">Open the agent chat to ask about this estimate.</p>
      {onOpenAgentChat && (
        <button
          type="button"
          onClick={() => onOpenAgentChat()}
          className="w-full rounded-md border border-line bg-panel px-2 py-1.5 text-xs font-medium text-fg/80 hover:bg-panel2"
        >
          Open agent chat
        </button>
      )}
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
