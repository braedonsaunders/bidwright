"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, ExternalLink, Loader2, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface BidwrightModelSelectionNode {
  id: string;
  name: string;
  kind: string;
  surfaceArea?: number;
  volume?: number;
  faceCount?: number;
  solidCount?: number;
  bbox?: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
    size: { x: number; y: number; z: number };
  };
}

export interface BidwrightModelSelectionMessage {
  type: "bidwright:model-selection";
  source: "bidwright-model-editor";
  version: number;
  eventId?: string;
  projectId?: string;
  modelId?: string;
  modelDocumentId?: string;
  fileName?: string;
  quantityBasis?: "count" | "area" | "volume";
  documentId?: string;
  documentName?: string;
  selectedCount: number;
  nodes: BidwrightModelSelectionNode[];
  totals: {
    surfaceArea: number;
    volume: number;
    faceCount: number;
    solidCount: number;
  };
}

export interface BidwrightModelLineItemDraft {
  worksheetId?: string;
  worksheetName?: string;
  category: string;
  entityType: string;
  entityName: string;
  description: string;
  quantity: number;
  uom: string;
  cost: number;
  markup: number;
  price: number;
  unit1: number;
  unit2: number;
  unit3: number;
  sourceNotes: string;
  source?: {
    kind: "model-selection";
    projectId?: string;
    modelDocumentId?: string;
    fileName?: string;
    documentId?: string;
    selectedNodeIds?: string[];
  };
}

export interface BidwrightModelLinkedLineItem {
  linkId: string;
  worksheetItemId: string;
  worksheetId?: string | null;
  worksheetName?: string | null;
  entityName: string;
  description: string;
  quantity: number;
  uom: string;
  cost: number;
  markup: number;
  price: number;
  sourceNotes?: string;
  derivedQuantity?: number;
  selection?: Record<string, unknown>;
}

interface BidwrightModelSendToEstimateMessage {
  type: "bidwright:model-send-to-estimate";
  source: "bidwright-model-editor";
  version: number;
  eventId?: string;
  projectId?: string;
  modelDocumentId?: string;
  selection: BidwrightModelSelectionMessage;
  lineItemDraft?: BidwrightModelLineItemDraft;
}

interface BidwrightModelLineItemsRequestMessage {
  type: "bidwright:model-line-items-request";
  source: "bidwright-model-editor";
  version: number;
  projectId?: string;
  modelId?: string;
  modelDocumentId?: string;
}

interface BidwrightModelLineItemUpdateMessage {
  type: "bidwright:model-line-item-update";
  source: "bidwright-model-editor";
  version: number;
  eventId?: string;
  projectId?: string;
  modelId?: string;
  modelDocumentId?: string;
  linkId: string;
  worksheetItemId: string;
  patch: {
    entityName?: string;
    description?: string;
    quantity?: number;
    uom?: string;
  };
}

interface BidwrightModelLineItemDeleteMessage {
  type: "bidwright:model-line-item-delete";
  source: "bidwright-model-editor";
  version: number;
  eventId?: string;
  projectId?: string;
  modelId?: string;
  modelDocumentId?: string;
  linkId: string;
  worksheetItemId: string;
}

interface BidwrightModelChannelMessage {
  type:
    | "model-selection"
    | "model-send-to-estimate"
    | "model-line-items-request"
    | "model-line-item-update"
    | "model-line-item-delete";
  source: "bidwright-model-editor";
  version: number;
  eventId?: string;
  originId?: string;
  projectId?: string;
  modelId?: string;
  modelDocumentId?: string;
  selection?: BidwrightModelSelectionMessage;
  lineItemDraft?: BidwrightModelLineItemDraft;
  linkId?: string;
  worksheetItemId?: string;
  patch?: BidwrightModelLineItemUpdateMessage["patch"];
}

interface BidwrightModelEditorProps {
  fileUrl?: string | null;
  fileName?: string | null;
  projectId?: string | null;
  modelAssetId?: string | null;
  modelDocumentId?: string | null;
  syncChannelName?: string | null;
  estimateTargetWorksheetId?: string | null;
  estimateTargetWorksheetName?: string | null;
  estimateDefaultMarkup?: number | null;
  estimateQuoteLabel?: string | null;
  estimateEnabled?: boolean;
  isolateSyncChannel?: boolean;
  className?: string;
  title?: string;
  showHeader?: boolean;
  variant?: "editor" | "takeoff";
  linkedLineItems?: BidwrightModelLinkedLineItem[];
  onModelSelection?: (selection: BidwrightModelSelectionMessage) => void;
  onSendSelectionToEstimate?: (
    selection: BidwrightModelSelectionMessage,
    lineItemDraft?: BidwrightModelLineItemDraft,
  ) => void | Promise<void>;
  onUpdateLinkedLineItem?: (
    payload: Pick<BidwrightModelLineItemUpdateMessage, "linkId" | "worksheetItemId" | "patch">,
  ) => void | Promise<void>;
  onDeleteLinkedLineItem?: (
    payload: Pick<BidwrightModelLineItemDeleteMessage, "linkId" | "worksheetItemId">,
  ) => void | Promise<void>;
}

export const MODEL_EDITOR_EDITABLE_EXTENSIONS = new Set(["step", "stp", "iges", "igs", "brep", "stl"]);

export function getModelFileExtension(fileName?: string | null): string {
  return fileName?.split(".").pop()?.toLowerCase() ?? "";
}

export function isBidwrightEditableModel(fileName?: string | null): boolean {
  return MODEL_EDITOR_EDITABLE_EXTENSIONS.has(getModelFileExtension(fileName));
}

export function buildModelEditorUrl(
  fileUrl?: string | null,
  fileName?: string | null,
  cacheKey = 0,
  options: {
    projectId?: string | null;
    modelAssetId?: string | null;
    modelDocumentId?: string | null;
    syncChannelName?: string | null;
    estimateEnabled?: boolean;
    estimateTargetWorksheetId?: string | null;
    estimateTargetWorksheetName?: string | null;
    estimateDefaultMarkup?: number | null;
    estimateQuoteLabel?: string | null;
  } = {}
) {
  const params = new URLSearchParams();
  params.set("embedded", "1");
  params.set("bidwright", "1");
  if (fileUrl) params.set("url", fileUrl);
  if (fileName) params.set("fileName", fileName);
  if (options.projectId) params.set("projectId", options.projectId);
  if (options.modelAssetId) params.set("modelId", options.modelAssetId);
  if (options.modelDocumentId) params.set("modelDocumentId", options.modelDocumentId);
  if (options.syncChannelName) params.set("channel", options.syncChannelName);
  if (options.estimateEnabled) params.set("estimate", "1");
  if (options.estimateTargetWorksheetId) params.set("estimateTargetWorksheetId", options.estimateTargetWorksheetId);
  if (options.estimateTargetWorksheetName) params.set("estimateTargetWorksheetName", options.estimateTargetWorksheetName);
  if (typeof options.estimateDefaultMarkup === "number" && Number.isFinite(options.estimateDefaultMarkup)) {
    params.set("estimateDefaultMarkup", String(options.estimateDefaultMarkup));
  }
  if (options.estimateQuoteLabel) params.set("estimateQuoteLabel", options.estimateQuoteLabel);
  if (cacheKey > 0) params.set("reload", String(cacheKey));
  const qs = params.toString();
  return `/model-editor/index.html${qs ? `?${qs}` : ""}`;
}

function isModelSelectionMessage(data: unknown): data is BidwrightModelSelectionMessage {
  return Boolean(
    data &&
      typeof data === "object" &&
      (data as { type?: unknown }).type === "bidwright:model-selection" &&
      Array.isArray((data as { nodes?: unknown }).nodes)
  );
}

function isModelSendToEstimateMessage(data: unknown): data is BidwrightModelSendToEstimateMessage {
  return Boolean(
    data &&
      typeof data === "object" &&
      (data as { type?: unknown }).type === "bidwright:model-send-to-estimate" &&
      isModelSelectionMessage((data as { selection?: unknown }).selection)
  );
}

function isLineItemsRequestMessage(data: unknown): data is BidwrightModelLineItemsRequestMessage {
  return Boolean(
    data &&
      typeof data === "object" &&
      (data as { type?: unknown }).type === "bidwright:model-line-items-request" &&
      (data as { source?: unknown }).source === "bidwright-model-editor"
  );
}

function isLineItemUpdateMessage(data: unknown): data is BidwrightModelLineItemUpdateMessage {
  return Boolean(
    data &&
      typeof data === "object" &&
      (data as { type?: unknown }).type === "bidwright:model-line-item-update" &&
      (data as { source?: unknown }).source === "bidwright-model-editor" &&
      typeof (data as { linkId?: unknown }).linkId === "string" &&
      typeof (data as { worksheetItemId?: unknown }).worksheetItemId === "string" &&
      typeof (data as { patch?: unknown }).patch === "object"
  );
}

function isLineItemDeleteMessage(data: unknown): data is BidwrightModelLineItemDeleteMessage {
  return Boolean(
    data &&
      typeof data === "object" &&
      (data as { type?: unknown }).type === "bidwright:model-line-item-delete" &&
      (data as { source?: unknown }).source === "bidwright-model-editor" &&
      typeof (data as { linkId?: unknown }).linkId === "string" &&
      typeof (data as { worksheetItemId?: unknown }).worksheetItemId === "string"
  );
}

function isModelChannelMessage(data: unknown): data is BidwrightModelChannelMessage {
  return Boolean(
    data &&
      typeof data === "object" &&
      ((data as { type?: unknown }).type === "model-selection" ||
        (data as { type?: unknown }).type === "model-send-to-estimate" ||
        (data as { type?: unknown }).type === "model-line-items-request" ||
        (data as { type?: unknown }).type === "model-line-item-update" ||
        (data as { type?: unknown }).type === "model-line-item-delete") &&
      (data as { source?: unknown }).source === "bidwright-model-editor"
  );
}

function formatModelQuantity(value: number, unit: string) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.000001) return `0 ${unit}`;
  return `${Intl.NumberFormat(undefined, { maximumFractionDigits: value >= 100 ? 0 : 2 }).format(value)} ${unit}`;
}

function makeModelEditorChannelId() {
  return `model-editor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function BidwrightModelEditor({
  fileUrl,
  fileName,
  projectId,
  modelAssetId,
  modelDocumentId,
  syncChannelName,
  estimateTargetWorksheetId,
  estimateTargetWorksheetName,
  estimateDefaultMarkup,
  estimateQuoteLabel,
  estimateEnabled: estimateEnabledProp,
  isolateSyncChannel = true,
  className,
  title = "Model Editor",
  showHeader = false,
  variant = "editor",
  linkedLineItems = [],
  onModelSelection,
  onSendSelectionToEstimate,
  onUpdateLinkedLineItem,
  onDeleteLinkedLineItem,
}: BidwrightModelEditorProps) {
  const [loading, setLoading] = useState(true);
  const [sendingSelection, setSendingSelection] = useState(false);
  const [selection, setSelection] = useState<BidwrightModelSelectionMessage | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const handledSendEventsRef = useRef<Set<string>>(new Set());
  const handledLineItemEventsRef = useRef<Set<string>>(new Set());
  const channelRef = useRef<BroadcastChannel | null>(null);
  const linkedLineItemsRef = useRef(linkedLineItems);
  const channelInstanceIdRef = useRef(makeModelEditorChannelId());
  const estimateEnabled = estimateEnabledProp ?? Boolean(onSendSelectionToEstimate);
  const hasLocalLineItemBridge = Boolean(
    onSendSelectionToEstimate ||
      onUpdateLinkedLineItem ||
      onDeleteLinkedLineItem ||
      linkedLineItems.length > 0
  );
  const effectiveSyncChannelName = useMemo(
    () => (syncChannelName ? (isolateSyncChannel ? `${syncChannelName}-${channelInstanceIdRef.current}` : syncChannelName) : null),
    [isolateSyncChannel, syncChannelName]
  );
  const editorUrl = useMemo(
    () =>
      buildModelEditorUrl(fileUrl, fileName, reloadKey, {
        projectId,
        modelAssetId,
        modelDocumentId,
        syncChannelName: effectiveSyncChannelName,
        estimateEnabled,
        estimateTargetWorksheetId,
        estimateTargetWorksheetName,
        estimateDefaultMarkup,
        estimateQuoteLabel,
      }),
    [
      effectiveSyncChannelName,
      estimateDefaultMarkup,
      estimateEnabled,
      estimateQuoteLabel,
      estimateTargetWorksheetId,
      estimateTargetWorksheetName,
      fileName,
      fileUrl,
      modelAssetId,
      modelDocumentId,
      projectId,
      reloadKey,
    ]
  );
  const ext = getModelFileExtension(fileName);

  useEffect(() => {
    linkedLineItemsRef.current = linkedLineItems;
  }, [linkedLineItems]);

  const postLinkedLineItemsState = useCallback((targetWindow?: Window | null) => {
    if (!hasLocalLineItemBridge) return;
    const parentMessage = {
      type: "bidwright:model-line-items-state",
      source: "bidwright-host",
      version: 1,
      projectId: projectId ?? undefined,
      modelId: modelAssetId ?? undefined,
      modelDocumentId: modelDocumentId ?? undefined,
      items: linkedLineItemsRef.current,
    };
    const channelMessage = {
      type: "model-line-items-state",
      source: "bidwright-host",
      version: 1,
      projectId: projectId ?? undefined,
      modelId: modelAssetId ?? undefined,
      modelDocumentId: modelDocumentId ?? undefined,
      items: linkedLineItemsRef.current,
    };

    targetWindow?.postMessage(parentMessage, window.location.origin);
    channelRef.current?.postMessage(channelMessage);
  }, [hasLocalLineItemBridge, modelAssetId, modelDocumentId, projectId]);

  const handleIncomingSelection = useCallback(
    (nextSelection: BidwrightModelSelectionMessage) => {
      setSelection(nextSelection);
      onModelSelection?.(nextSelection);
    },
    [onModelSelection]
  );

  const handleIncomingSendToEstimate = useCallback(
    async (message: Pick<BidwrightModelSendToEstimateMessage, "eventId" | "selection" | "lineItemDraft">) => {
      handleIncomingSelection(message.selection);
      if (!onSendSelectionToEstimate) return;

      if (message.eventId) {
        if (handledSendEventsRef.current.has(message.eventId)) return;
        handledSendEventsRef.current.add(message.eventId);
      }

      setSendingSelection(true);
      try {
        await onSendSelectionToEstimate(message.selection, message.lineItemDraft);
      } finally {
        setSendingSelection(false);
      }
    },
    [handleIncomingSelection, onSendSelectionToEstimate]
  );

  const handleIncomingLineItemUpdate = useCallback(
    async (message: Pick<BidwrightModelLineItemUpdateMessage, "eventId" | "linkId" | "worksheetItemId" | "patch">) => {
      if (!onUpdateLinkedLineItem) return;
      if (message.eventId) {
        if (handledLineItemEventsRef.current.has(message.eventId)) return;
        handledLineItemEventsRef.current.add(message.eventId);
      }
      await onUpdateLinkedLineItem({
        linkId: message.linkId,
        worksheetItemId: message.worksheetItemId,
        patch: message.patch,
      });
    },
    [onUpdateLinkedLineItem]
  );

  const handleIncomingLineItemDelete = useCallback(
    async (message: Pick<BidwrightModelLineItemDeleteMessage, "eventId" | "linkId" | "worksheetItemId">) => {
      if (!onDeleteLinkedLineItem) return;
      if (message.eventId) {
        if (handledLineItemEventsRef.current.has(message.eventId)) return;
        handledLineItemEventsRef.current.add(message.eventId);
      }
      await onDeleteLinkedLineItem({
        linkId: message.linkId,
        worksheetItemId: message.worksheetItemId,
      });
    },
    [onDeleteLinkedLineItem]
  );

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (iframeRef.current?.contentWindow && event.source !== iframeRef.current.contentWindow) return;
      if (isModelSelectionMessage(event.data)) {
        handleIncomingSelection(event.data);
        return;
      }
      if (isModelSendToEstimateMessage(event.data)) {
        void handleIncomingSendToEstimate(event.data);
        return;
      }
      if (isLineItemsRequestMessage(event.data)) {
        postLinkedLineItemsState(iframeRef.current?.contentWindow);
        return;
      }
      if (isLineItemUpdateMessage(event.data)) {
        void handleIncomingLineItemUpdate(event.data);
        return;
      }
      if (isLineItemDeleteMessage(event.data)) {
        void handleIncomingLineItemDelete(event.data);
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [
    handleIncomingLineItemDelete,
    handleIncomingLineItemUpdate,
    handleIncomingSelection,
    handleIncomingSendToEstimate,
    postLinkedLineItemsState,
  ]);

  useEffect(() => {
    if (!effectiveSyncChannelName || typeof window === "undefined" || !("BroadcastChannel" in window)) return;

    const channel = new BroadcastChannel(effectiveSyncChannelName);
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent) => {
      if (!isModelChannelMessage(event.data)) return;
      if (projectId && event.data.projectId && event.data.projectId !== projectId) return;
      if (modelAssetId && event.data.modelId && event.data.modelId !== modelAssetId) return;
      if (modelDocumentId && event.data.modelDocumentId && event.data.modelDocumentId !== modelDocumentId) return;

      if (event.data.type === "model-selection") {
        if (event.data.selection) handleIncomingSelection(event.data.selection);
        return;
      }
      if (event.data.type === "model-send-to-estimate") {
        if (!event.data.selection) return;
        void handleIncomingSendToEstimate({
          eventId: event.data.eventId,
          selection: event.data.selection,
          lineItemDraft: event.data.lineItemDraft,
        });
        return;
      }
      if (event.data.type === "model-line-items-request") {
        postLinkedLineItemsState();
        return;
      }
      if (event.data.type === "model-line-item-update" && event.data.linkId && event.data.worksheetItemId && event.data.patch) {
        void handleIncomingLineItemUpdate({
          eventId: event.data.eventId,
          linkId: event.data.linkId,
          worksheetItemId: event.data.worksheetItemId,
          patch: event.data.patch,
        });
        return;
      }
      if (event.data.type === "model-line-item-delete" && event.data.linkId && event.data.worksheetItemId) {
        void handleIncomingLineItemDelete({
          eventId: event.data.eventId,
          linkId: event.data.linkId,
          worksheetItemId: event.data.worksheetItemId,
        });
      }
    };

    return () => {
      if (channelRef.current === channel) channelRef.current = null;
      channel.close();
    };
  }, [
    effectiveSyncChannelName,
    handleIncomingLineItemDelete,
    handleIncomingLineItemUpdate,
    handleIncomingSelection,
    handleIncomingSendToEstimate,
    modelAssetId,
    modelDocumentId,
    postLinkedLineItemsState,
    projectId,
  ]);

  useEffect(() => {
    postLinkedLineItemsState(iframeRef.current?.contentWindow);
  }, [linkedLineItems, postLinkedLineItemsState]);

  useEffect(() => {
    handledSendEventsRef.current.clear();
  }, [editorUrl]);

  const canSendSelection = Boolean(
    onSendSelectionToEstimate && estimateTargetWorksheetId && selection && selection.selectedCount > 0,
  );

  return (
    <div className={cn("relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#101014]", className)}>
      {showHeader && (
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
          <Box className="h-4 w-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-fg">{title}</p>
            {fileName && <p className="truncate text-[10px] text-fg/40">{fileName}</p>}
          </div>
          {ext && (
            <span className="rounded-md border border-line bg-bg px-1.5 py-0.5 text-[10px] font-medium uppercase text-fg/50">
              {ext}
            </span>
          )}
          {selection && selection.selectedCount > 0 && (
            <div className="hidden min-w-0 items-center gap-1.5 rounded-md border border-line bg-bg px-2 py-1 text-[10px] text-fg/55 md:flex">
              <span className="font-medium text-fg/75">{selection.selectedCount} selected</span>
              <span>{formatModelQuantity(selection.totals.surfaceArea, "model^2")}</span>
              {selection.totals.volume > 0 && <span>{formatModelQuantity(selection.totals.volume, "model^3")}</span>}
            </div>
          )}
          {onSendSelectionToEstimate && (
            <Button
              variant="secondary"
              size="xs"
              title={estimateTargetWorksheetId ? "Create worksheet line item from selected model quantity" : "Create a worksheet before sending model quantities"}
              disabled={!canSendSelection || sendingSelection}
              onClick={async () => {
                if (!selection || !onSendSelectionToEstimate) return;
                setSendingSelection(true);
                try {
                  await onSendSelectionToEstimate(selection);
                } finally {
                  setSendingSelection(false);
                }
              }}
            >
              {sendingSelection ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="xs"
            title="Reload"
            onClick={() => {
              setLoading(true);
              setSelection(null);
              setReloadKey((key) => key + 1);
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            title="Open in new window"
            onClick={() => window.open(editorUrl, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <iframe
          ref={iframeRef}
          key={editorUrl}
          src={editorUrl}
          title={fileName ? `${title}: ${fileName}` : title}
          className="h-full w-full border-0 bg-[#101014]"
          sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
          onLoad={() => {
            setLoading(false);
            postLinkedLineItemsState(iframeRef.current?.contentWindow);
          }}
        />
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#101014] text-fg/60">
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
            {showHeader && (
              <p className="text-xs font-medium">
                {variant === "takeoff" ? "Opening 3D model..." : "Opening model..."}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
