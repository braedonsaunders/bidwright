"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";

export type BidwrightCadSourceKind = "source_document" | "file_node";
export type BidwrightCadMode = "preview" | "takeoff";

export interface BidwrightCadEntityRow {
  id: string;
  type: string;
  layer: string;
  layoutName: string;
  label: string;
  color: string;
  measurementLabel: string;
  quantity: number;
  uom: string;
  sourceEntityIds: string[];
  isLinked: boolean;
  linkCount: number;
}

export interface BidwrightCadIntelligenceSnapshot {
  documentId: string;
  fileName: string;
  selectedLayout: string;
  selectedEntityId: string | null;
  savingEntityId: string | null;
  entityCount: number;
  visibleEntityCount: number;
  layerCount: number;
  annotationCount: number;
  layouts: Array<{ name: string; entityCount: number }>;
  layers: Array<{ name: string; color: string; count: number; visible: boolean }>;
  entities: BidwrightCadEntityRow[];
  autoCounts: [];
  systems: [];
  status: "idle" | "processing" | "ready" | "error";
  processedAt: string;
}

export interface BidwrightCadDocumentSaveMessage {
  documentId: string;
  sourceKind?: BidwrightCadSourceKind | null;
  fileName: string;
  dxfContent: string;
}

export interface BidwrightCadSelectionMessage {
  documentId: string;
  entityIds: string[];
  entities: BidwrightCadEntityRow[];
}

export interface BidwrightCadEditorHandle {
  sendCommand: (command: string) => void;
  fit: () => void;
  save: () => void;
  selectEntities: (entityIds: string[]) => void;
}

export interface BidwrightCadEditorProps {
  fileUrl?: string | null;
  fileName: string;
  projectId?: string | null;
  documentId?: string | null;
  sourceKind?: BidwrightCadSourceKind | null;
  mode?: BidwrightCadMode;
  className?: string;
  syncChannelName?: string | null;
  onReady?: () => void;
  onLoaded?: (message: { documentId: string; fileName: string; entityCount: number }) => void;
  onError?: (message: string) => void;
  onSelectionChange?: (message: BidwrightCadSelectionMessage) => void;
  onIntelligenceChange?: (snapshot: BidwrightCadIntelligenceSnapshot) => void;
  onSaveDocument?: (message: BidwrightCadDocumentSaveMessage) => void | Promise<void>;
}

type EditorMessage =
  | { source: "bidwright-cad-editor"; type: "bidwright:cad-ready" }
  | { source: "bidwright-cad-editor"; type: "bidwright:cad-loaded"; documentId: string; fileName: string; entityCount: number }
  | { source: "bidwright-cad-editor"; type: "bidwright:cad-error"; message: string }
  | ({ source: "bidwright-cad-editor"; type: "bidwright:cad-selection" } & BidwrightCadSelectionMessage)
  | { source: "bidwright-cad-editor"; type: "bidwright:cad-intelligence"; snapshot: BidwrightCadIntelligenceSnapshot }
  | ({ source: "bidwright-cad-editor"; type: "bidwright:cad-save" } & BidwrightCadDocumentSaveMessage);

export function buildCadEditorUrl(
  fileUrl: string | null | undefined,
  fileName: string,
  options: {
    projectId?: string | null;
    documentId?: string | null;
    sourceKind?: BidwrightCadSourceKind | null;
    mode?: BidwrightCadMode;
    syncChannelName?: string | null;
  } = {},
) {
  const params = new URLSearchParams();
  params.set("embedded", "1");
  params.set("bidwright", "1");
  if (fileUrl) params.set("url", fileUrl);
  params.set("fileName", fileName);
  if (options.projectId) params.set("projectId", options.projectId);
  if (options.documentId) params.set("documentId", options.documentId);
  if (options.sourceKind) params.set("sourceKind", options.sourceKind);
  if (options.mode) params.set("mode", options.mode);
  if (options.syncChannelName) params.set("syncChannelName", options.syncChannelName);
  return `/cad-editor/index.html?${params.toString()}`;
}

export const BidwrightCadEditor = forwardRef<BidwrightCadEditorHandle, BidwrightCadEditorProps>(
  function BidwrightCadEditor(
    {
      fileUrl,
      fileName,
      projectId,
      documentId,
      sourceKind,
      mode = "preview",
      className,
      syncChannelName,
      onReady,
      onLoaded,
      onError,
      onSelectionChange,
      onIntelligenceChange,
      onSaveDocument,
    },
    ref,
  ) {
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const src = useMemo(
      () => buildCadEditorUrl(fileUrl, fileName, { projectId, documentId, sourceKind, mode, syncChannelName }),
      [documentId, fileName, fileUrl, mode, projectId, sourceKind, syncChannelName],
    );

    const postToEditor = useCallback((message: Record<string, unknown>) => {
      iframeRef.current?.contentWindow?.postMessage({ source: "bidwright-cad-host", ...message }, "*");
    }, []);

    useImperativeHandle(ref, () => ({
      sendCommand: (command) => postToEditor({ type: "bidwright:cad-command", command }),
      fit: () => postToEditor({ type: "bidwright:cad-fit" }),
      save: () => postToEditor({ type: "bidwright:cad-save" }),
      selectEntities: (entityIds) => postToEditor({ type: "bidwright:cad-select-entities", entityIds }),
    }), [postToEditor]);

    useEffect(() => {
      function handleMessage(event: MessageEvent) {
        const data = event.data as Partial<EditorMessage> | undefined;
        if (!data || data.source !== "bidwright-cad-editor") return;
        if (data.type === "bidwright:cad-ready") {
          onReady?.();
        } else if (data.type === "bidwright:cad-loaded") {
          onLoaded?.({ documentId: data.documentId ?? "", fileName: data.fileName ?? fileName, entityCount: data.entityCount ?? 0 });
        } else if (data.type === "bidwright:cad-error") {
          onError?.(data.message ?? "CAD editor error");
        } else if (data.type === "bidwright:cad-selection") {
          onSelectionChange?.({
            documentId: data.documentId ?? documentId ?? fileName,
            entityIds: data.entityIds ?? [],
            entities: data.entities ?? [],
          });
        } else if (data.type === "bidwright:cad-intelligence" && data.snapshot) {
          onIntelligenceChange?.(data.snapshot);
        } else if (data.type === "bidwright:cad-save") {
          void onSaveDocument?.({
            documentId: data.documentId ?? documentId ?? fileName,
            sourceKind: data.sourceKind,
            fileName: data.fileName ?? fileName,
            dxfContent: data.dxfContent ?? "",
          });
        }
      }

      window.addEventListener("message", handleMessage);
      return () => window.removeEventListener("message", handleMessage);
    }, [documentId, fileName, onError, onIntelligenceChange, onLoaded, onReady, onSaveDocument, onSelectionChange]);

    return (
      <iframe
        ref={iframeRef}
        title={`${fileName} CAD editor`}
        src={src}
        className={cn("h-full min-h-0 w-full flex-1 border-0 bg-[#090b10]", className)}
        sandbox="allow-downloads allow-forms allow-modals allow-same-origin allow-scripts"
      />
    );
  },
);
