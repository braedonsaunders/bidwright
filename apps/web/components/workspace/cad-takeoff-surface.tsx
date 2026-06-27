"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import {
  Circle,
  Copy,
  Eraser,
  FolderOpen,
  GitBranch,
  Hand,
  Layers,
  Loader2,
  Maximize2,
  MousePointer2,
  Move,
  PenLine,
  Redo2,
  RotateCw,
  Save,
  Square,
  Undo2,
  Waypoints,
} from "lucide-react";
import { Button, EmptyState, Select } from "@/components/ui";
import { saveFileNodeContent, uploadFile, type ProjectWorkspaceData } from "@/lib/api";
import { cadEditorChannelName, postWorkspaceMutation } from "@/lib/workspace-sync";
import { cn } from "@/lib/utils";
import {
  BidwrightCadEditor,
  type BidwrightCadDocumentSaveMessage,
  type BidwrightCadEditorHandle,
  type BidwrightCadIntelligenceSnapshot,
  type BidwrightCadSelectionMessage,
} from "./editors/bidwright-cad-editor";
import type { InspectDwgIntelligenceSnapshot } from "./takeoff-inspect-view";

type CadDocument = {
  id: string;
  label: string;
  fileName: string;
  fileUrl: string;
  sourceKind?: "source_document" | "file_node";
};

type CadSelection = {
  documentId: string;
  entityId: string;
  entityType: string;
  layer: string;
  label: string;
  summary: string;
};

export interface CadTakeoffSurfaceProps {
  projectId: string;
  documents: CadDocument[];
  selectedDocumentId?: string;
  workspace: ProjectWorkspaceData;
  selectedWorksheetId?: string;
  defaultEstimateCategory?: { id?: string | null; name: string; entityType: string } | null;
  onSelectedDocumentChange?: (documentId: string) => void;
  onWorkspaceMutated?: () => void;
  onSelectedEntityChange?: (selection: CadSelection | null) => void;
  onSelectedAnnotationChange?: (pickupId: string | null) => void;
  onAnnotationsChange?: (annotations: []) => void;
  actionsRef?: MutableRefObject<{
    deleteAnnotation: (id: string) => Promise<void> | void;
    selectEntity: (id: string | null) => void;
    selectEntities: (ids: string[]) => void;
  } | null>;
  toolbarStart?: ReactNode;
  toolbarEnd?: ReactNode;
  onOpenDrawingIntelligence?: () => void;
  onIntelligenceChange?: (snapshot: InspectDwgIntelligenceSnapshot | null) => void;
}

const COMMANDS = [
  { id: "select", label: "Select", icon: MousePointer2, command: "select" },
  { id: "pan", label: "Pan", icon: Hand, command: "pan" },
  { id: "line", label: "Line", icon: PenLine, command: "line" },
  { id: "pline", label: "Polyline", icon: Waypoints, command: "pline" },
  { id: "circle", label: "Circle", icon: Circle, command: "circle" },
  { id: "rect", label: "Rectangle", icon: Square, command: "rectang" },
  { id: "move", label: "Move", icon: Move, command: "move" },
  { id: "copy", label: "Copy", icon: Copy, command: "copy" },
  { id: "rotate", label: "Rotate", icon: RotateCw, command: "rotate" },
  { id: "erase", label: "Erase", icon: Eraser, command: "erase" },
] as const;

function ensureDxfName(fileName: string): string {
  const cleaned = fileName.trim() || "Drawing";
  return cleaned.toLowerCase().endsWith(".dxf") ? cleaned : `${cleaned.replace(/\.[^.]+$/, "")}.dxf`;
}

function toInspectSnapshot(snapshot: BidwrightCadIntelligenceSnapshot): InspectDwgIntelligenceSnapshot {
  return {
    ...snapshot,
    autoCounts: [],
    systems: [],
  };
}

export function CadTakeoffSurface({
  projectId,
  documents,
  selectedDocumentId,
  onSelectedDocumentChange,
  onWorkspaceMutated,
  onSelectedEntityChange,
  onSelectedAnnotationChange,
  onAnnotationsChange,
  actionsRef,
  toolbarStart,
  toolbarEnd,
  onOpenDrawingIntelligence,
  onIntelligenceChange,
}: CadTakeoffSurfaceProps) {
  const editorRef = useRef<BidwrightCadEditorHandle | null>(null);
  const [status, setStatus] = useState("Preparing CAD editor");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeCommand, setActiveCommand] = useState("select");
  const activeDocument = useMemo(() => {
    return documents.find((document) => document.id === selectedDocumentId) ?? documents[0] ?? null;
  }, [documents, selectedDocumentId]);
  const syncChannelName = useMemo(() => cadEditorChannelName(projectId), [projectId]);

  useEffect(() => {
    onAnnotationsChange?.([]);
    onSelectedAnnotationChange?.(null);
    onSelectedEntityChange?.(null);
    onIntelligenceChange?.(null);
  }, [activeDocument?.id, onAnnotationsChange, onIntelligenceChange, onSelectedAnnotationChange, onSelectedEntityChange]);

  useEffect(() => {
    if (!actionsRef) return;
    actionsRef.current = {
      deleteAnnotation: () => undefined,
      selectEntity: (id) => {
        editorRef.current?.selectEntities(id ? [id] : []);
      },
      selectEntities: (ids) => {
        editorRef.current?.selectEntities(ids);
      },
    };
    return () => {
      actionsRef.current = null;
    };
  }, [actionsRef]);

  const handleCommand = useCallback((command: string, id: string) => {
    setActiveCommand(id);
    editorRef.current?.sendCommand(command);
  }, []);

  const handleSelection = useCallback((message: BidwrightCadSelectionMessage) => {
    const entity = message.entities[0];
    if (!entity) {
      onSelectedEntityChange?.(null);
      return;
    }
    onSelectedEntityChange?.({
      documentId: activeDocument?.id ?? message.documentId,
      entityId: entity.id,
      entityType: entity.type,
      layer: entity.layer,
      label: entity.label,
      summary: entity.measurementLabel,
    });
  }, [activeDocument?.id, onSelectedEntityChange]);

  const handleIntelligence = useCallback((snapshot: BidwrightCadIntelligenceSnapshot) => {
    onIntelligenceChange?.(toInspectSnapshot({
      ...snapshot,
      documentId: activeDocument?.id ?? snapshot.documentId,
      fileName: activeDocument?.fileName ?? snapshot.fileName,
    }));
  }, [activeDocument?.fileName, activeDocument?.id, onIntelligenceChange]);

  const handleSave = useCallback(async (message: BidwrightCadDocumentSaveMessage) => {
    if (!activeDocument) return;
    setSaving(true);
    setError(null);
    try {
      const fileName = ensureDxfName(message.fileName || activeDocument.fileName);
      const file = new File([message.dxfContent], fileName, { type: "application/dxf" });
      if (activeDocument.sourceKind === "file_node" && activeDocument.fileName.toLowerCase().endsWith(".dxf")) {
        await saveFileNodeContent(projectId, activeDocument.id, file);
      } else {
        await uploadFile(projectId, file, null);
      }
      postWorkspaceMutation(projectId, { reason: "cad-editor-save" });
      onWorkspaceMutated?.();
      setStatus(`Saved ${fileName}`);
    } catch (saveError) {
      const messageText = saveError instanceof Error ? saveError.message : "Unknown save error";
      setError(messageText);
      setStatus("Save failed");
    } finally {
      setSaving(false);
    }
  }, [activeDocument, onWorkspaceMutated, projectId]);

  if (!activeDocument) {
    return (
      <div className="flex h-full min-h-[420px] flex-col items-center justify-center border border-line bg-panel">
        <EmptyState className="max-w-sm px-6">
          <FolderOpen className="mx-auto mb-3 h-8 w-8 text-fg/35" />
          <p className="text-sm font-medium text-fg/70">No CAD drawings</p>
          <p className="mt-1 text-xs text-fg/45">Upload a DWG or DXF drawing to open the 2D CAD editor.</p>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-panel">
      <div className="flex min-h-[42px] shrink-0 items-center gap-2 border-b border-line bg-bg px-2 py-1.5">
        {toolbarStart}
        {documents.length > 1 ? (
          <Select
            value={activeDocument.id}
            onValueChange={(value) => onSelectedDocumentChange?.(value)}
            options={documents.map((document) => ({ value: document.id, label: document.label }))}
            className="h-7 max-w-[260px] text-xs"
          />
        ) : (
          <div className="min-w-0 max-w-[260px] truncate px-1.5 text-xs font-medium text-fg/75">{activeDocument.label}</div>
        )}
        <div className="hidden h-6 w-px bg-line md:block" />
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {COMMANDS.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                key={item.id}
                variant={activeCommand === item.id ? "secondary" : "ghost"}
                size="xs"
                onClick={() => handleCommand(item.command, item.id)}
                title={item.label}
                aria-label={item.label}
                className="h-7 w-7 shrink-0 px-0"
              >
                <Icon className="h-3.5 w-3.5" />
              </Button>
            );
          })}
          <div className="mx-1 h-6 w-px shrink-0 bg-line" />
          <Button variant="ghost" size="xs" onClick={() => editorRef.current?.sendCommand("undo")} title="Undo" aria-label="Undo" className="h-7 w-7 shrink-0 px-0">
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="xs" onClick={() => editorRef.current?.sendCommand("redo")} title="Redo" aria-label="Redo" className="h-7 w-7 shrink-0 px-0">
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="xs" onClick={() => editorRef.current?.fit()} title="Fit drawing" aria-label="Fit drawing" className="h-7 w-7 shrink-0 px-0">
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="xs" onClick={() => editorRef.current?.save()} title="Save DXF" aria-label="Save DXF" className="h-7 w-7 shrink-0 px-0" disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="xs" onClick={onOpenDrawingIntelligence} title="Open entities" aria-label="Open entities" className="h-7 w-7 shrink-0 px-0">
            <GitBranch className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="xs" onClick={() => editorRef.current?.sendCommand("-layer")} title="Layers" aria-label="Layers" className="h-7 w-7 shrink-0 px-0">
            <Layers className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className={cn("hidden max-w-[220px] truncate text-[11px] text-fg/45 lg:block", error && "text-danger")}>
          {error ?? status}
        </div>
        {toolbarEnd}
      </div>
      <div className="min-h-0 flex-1">
        <BidwrightCadEditor
          ref={editorRef}
          key={activeDocument.id}
          fileUrl={activeDocument.fileUrl}
          fileName={activeDocument.fileName}
          projectId={projectId}
          documentId={activeDocument.id}
          sourceKind={activeDocument.sourceKind}
          mode="takeoff"
          syncChannelName={syncChannelName}
          onReady={() => setStatus("CAD editor ready")}
          onLoaded={(message) => setStatus(`${message.entityCount.toLocaleString()} CAD entities`)}
          onError={(message) => {
            setError(message);
            setStatus("CAD editor error");
          }}
          onSelectionChange={handleSelection}
          onIntelligenceChange={handleIntelligence}
          onSaveDocument={handleSave}
        />
      </div>
    </div>
  );
}

export default CadTakeoffSurface;
