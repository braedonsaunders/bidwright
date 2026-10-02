"use client";

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { BidwrightModelDocumentSaveMessage } from "@/components/workspace/editors/bidwright-model-editor";

interface Options {
  iframe: RefObject<HTMLIFrameElement | null>;
  documentKey: string;
  fileUrl?: string | null;
  fileName?: string | null;
  projectId?: string | null;
  modelDocumentId?: string | null;
  onSave?: (message: BidwrightModelDocumentSaveMessage) => void | Promise<void>;
}

type Snapshot = { documentId: string; documentName: string; revision: string; serializedDocument?: Record<string, unknown> };
type Capture = (revision?: string) => Snapshot | undefined;
type CaptureDetail = { revision?: string; snapshot?: Snapshot; capture?: Capture };

type SaveState = { status: "opening" | "saved" | "unsaved" | "saving" | "error"; error?: string };

export function useModelDocumentAutosave(options: Options) {
  const [state, setState] = useState<SaveState>({ status: "opening" });
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const controls = useRef<{ save: () => void; enqueue: (message: BidwrightModelDocumentSaveMessage) => void } | null>(null);

  useLayoutEffect(() => {
    if (!options.onSave) return;
    let disposed = false;
    const editorWindow = options.iframe.current?.contentWindow;
    let capturing = false;
    let captureAgain = false;
    let forceAgain = false;
    let saving = false;
    let dirty = false;
    let ready = false;
    let revision: string | undefined;
    let snapshotReader: Capture | undefined;
    let pending: { message: BidwrightModelDocumentSaveMessage; persist: NonNullable<Options["onSave"]> } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let request: { id: string; timer: ReturnType<typeof setTimeout> } | undefined;
    const update = (next: SaveState) => { if (!disposed) setState(next); };
    update({ status: "opening" });

    // One upload at a time; edits made during it replace the pending snapshot.
    // This also finishes already-captured work after a SPA navigation unmounts us.
    async function drain() {
      if (saving || !pending) return;
      clearTimeout(timer);
      clearTimeout(retry);
      saving = true;
      while (pending) {
        const snapshot = pending;
        pending = undefined;
        update({ status: "saving" });
        try {
          await snapshot.persist(snapshot.message);
        } catch (error) {
          pending ??= snapshot;
          saving = false;
          update({ status: "error", error: error instanceof Error ? error.message : String(error) });
          if (!disposed) retry = setTimeout(() => void drain(), 5000);
          return;
        }
      }
      saving = false;
      update({ status: dirty ? "unsaved" : "saved" });
    }

    function enqueue(message: BidwrightModelDocumentSaveMessage) {
      pending = { message, persist: optionsRef.current.onSave! };
      update({ status: saving ? "saving" : "unsaved" });
      clearTimeout(timer);
      timer = setTimeout(() => void drain(), 400);
    }

    function capture(force = false) {
      if (disposed) return;
      if (capturing) { captureAgain = true; forceAgain ||= force; return; }
      const target = options.iframe.current?.contentWindow;
      if (!target) return;
      capturing = true;
      const id = crypto.randomUUID();
      const timeout = setTimeout(() => {
        request = undefined;
        capturing = false;
        if (ready && dirty) update({ status: "error", error: "Could not read the model to save it. Use Save to retry." });
      }, 2500);
      request = { id, timer: timeout };
      target.postMessage({ type: "bidwright:model-design-request", source: "bidwright-host", requestId: id, action: "document", revision: force ? undefined : revision }, window.location.origin);
    }

    function receive(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== options.iframe.current?.contentWindow || event.data?.source !== "bidwright-model-editor") return;
      if (event.data.type === "bidwright:model-document-dirty") {
        dirty = true;
        update({ status: saving ? "saving" : "unsaved" });
        capture();
        return;
      }
      if (!request || event.data.type !== "bidwright:model-design-result" || event.data.requestId !== request.id) return;
      clearTimeout(request.timer);
      request = undefined;
      capturing = false;
      if (event.data.ok) {
        const first = !ready;
        const wasDirty = dirty;
        ready = true;
        revision = event.data.revision;
        const detail: CaptureDetail = { revision };
        options.iframe.current?.contentWindow?.dispatchEvent(new CustomEvent("bidwright:model-document-capture", { detail }));
        snapshotReader = detail.capture;
        dirty = captureAgain;
        const data = event.data.serializedDocument;
        if (data && (!first || !options.fileUrl || wasDirty)) {
          enqueue({
            type: "bidwright:model-document-save", source: "bidwright-model-editor", version: 1,
            projectId: options.projectId ?? undefined, modelDocumentId: options.modelDocumentId ?? undefined,
            fileName: options.fileName ?? undefined, documentId: event.data.documentId,
            documentName: event.data.documentName, serializedDocument: data,
          });
        } else if (first) update({ status: "saved" });
      } else if (ready) update({ status: "error", error: event.data.error || "Could not read the model to save it" });
      if (captureAgain) { const force = forceAgain; captureAgain = false; forceAgain = false; capture(force); }
    }

    const save = () => { dirty = true; capture(true); if (pending) void drain(); };
    const online = () => { if (pending) void drain(); else if (dirty) capture(); };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty && !pending && !saving && !capturing) return;
      event.preventDefault();
      event.returnValue = "";
    };
    controls.current = { save, enqueue };
    window.addEventListener("message", receive);
    window.addEventListener("online", online);
    window.addEventListener("beforeunload", beforeUnload);
    const poll = setInterval(() => capture(), 2000);
    capture();
    return () => {
      // Layout cleanup runs before React removes the iframe. Capture synchronously
      // so an immediate file switch cannot discard the last edit or its debounce.
      const detail: CaptureDetail = { revision };
      try {
        if (snapshotReader) detail.snapshot = snapshotReader(revision);
        else (options.iframe.current?.contentWindow ?? editorWindow)?.dispatchEvent(new CustomEvent("bidwright:model-document-capture", { detail }));
        const snapshot = detail.snapshot;
        if (snapshot?.serializedDocument && (ready || !options.fileUrl || dirty)) enqueue({
          type: "bidwright:model-document-save", source: "bidwright-model-editor", version: 1,
          projectId: options.projectId ?? undefined, modelDocumentId: options.modelDocumentId ?? undefined,
          fileName: options.fileName ?? undefined, documentId: snapshot.documentId,
          documentName: snapshot.documentName, serializedDocument: snapshot.serializedDocument,
        });
      } catch { /* The iframe can already be gone during a full browser navigation. */ }
      disposed = true;
      controls.current = null;
      clearInterval(poll);
      clearTimeout(timer);
      clearTimeout(retry);
      if (request) clearTimeout(request.timer);
      window.removeEventListener("message", receive);
      window.removeEventListener("online", online);
      window.removeEventListener("beforeunload", beforeUnload);
      void drain();
    };
  }, [options.documentKey, options.iframe, Boolean(options.onSave)]);

  return {
    ...state,
    save: useCallback(() => controls.current?.save(), []),
    saveSnapshot: useCallback((message: BidwrightModelDocumentSaveMessage) => controls.current?.enqueue(message), []),
  };
}
