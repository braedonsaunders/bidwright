"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

interface BidwrightModelEditorProps {
  fileUrl?: string | null;
  fileName?: string | null;
  className?: string;
  title?: string;
  variant?: "editor" | "takeoff";
  onModelSelection?: (selection: BidwrightModelSelectionMessage) => void;
  onSendSelectionToEstimate?: (selection: BidwrightModelSelectionMessage) => void | Promise<void>;
}

export const MODEL_EDITOR_EDITABLE_EXTENSIONS = new Set(["step", "stp", "iges", "igs", "brep", "stl"]);

export function getModelFileExtension(fileName?: string | null): string {
  return fileName?.split(".").pop()?.toLowerCase() ?? "";
}

export function isBidwrightEditableModel(fileName?: string | null): boolean {
  return MODEL_EDITOR_EDITABLE_EXTENSIONS.has(getModelFileExtension(fileName));
}

function buildModelEditorUrl(fileUrl?: string | null, fileName?: string | null, cacheKey = 0) {
  const params = new URLSearchParams();
  params.set("embedded", "1");
  params.set("bidwright", "1");
  if (fileUrl) params.set("url", fileUrl);
  if (fileName) params.set("fileName", fileName);
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

function formatModelQuantity(value: number, unit: string) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.000001) return `0 ${unit}`;
  return `${Intl.NumberFormat(undefined, { maximumFractionDigits: value >= 100 ? 0 : 2 }).format(value)} ${unit}`;
}

export function BidwrightModelEditor({
  fileUrl,
  fileName,
  className,
  title = "Model Editor",
  variant = "editor",
  onModelSelection,
  onSendSelectionToEstimate,
}: BidwrightModelEditorProps) {
  const [loading, setLoading] = useState(true);
  const [sendingSelection, setSendingSelection] = useState(false);
  const [selection, setSelection] = useState<BidwrightModelSelectionMessage | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const editorUrl = useMemo(
    () => buildModelEditorUrl(fileUrl, fileName, reloadKey),
    [fileName, fileUrl, reloadKey]
  );
  const ext = getModelFileExtension(fileName);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (iframeRef.current?.contentWindow && event.source !== iframeRef.current.contentWindow) return;
      if (!isModelSelectionMessage(event.data)) return;
      setSelection(event.data);
      onModelSelection?.(event.data);
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onModelSelection]);

  const canSendSelection = Boolean(onSendSelectionToEstimate && selection && selection.selectedCount > 0);

  return (
    <div className={cn("relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#101014]", className)}>
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
            title="Send selected model quantity to the estimate"
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
          title="Reload model editor"
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
          title="Open model editor in a new window"
          onClick={() => window.open(editorUrl, "_blank", "noopener,noreferrer")}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="relative min-h-0 flex-1">
        <iframe
          ref={iframeRef}
          key={editorUrl}
          src={editorUrl}
          title={fileName ? `${title}: ${fileName}` : title}
          className="h-full w-full border-0 bg-[#101014]"
          sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
          onLoad={() => setLoading(false)}
        />
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#101014] text-fg/60">
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
            <p className="text-xs font-medium">
              {variant === "takeoff" ? "Opening 3D takeoff model..." : "Opening BidWright model editor..."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
