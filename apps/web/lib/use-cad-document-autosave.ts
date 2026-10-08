"use client";

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { BidwrightCadDocumentSaveMessage } from "@/components/workspace/editors/bidwright-cad-editor";

type Capture = () => BidwrightCadDocumentSaveMessage | undefined;
type CaptureDetail = { capture?: Capture };
type SaveState = { status: "opening" | "saved" | "unsaved" | "saving" | "error"; error?: string };
interface Options {
  iframe: RefObject<HTMLIFrameElement | null>;
  documentKey: string;
  autosave?: boolean;
  onSave?: (message: BidwrightCadDocumentSaveMessage) => void | Promise<void>;
}

export function useCadDocumentAutosave(options: Options) {
  const [state, setState] = useState<SaveState>({ status: "opening" });
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const controls = useRef<{ save: () => void; enqueue: (message: BidwrightCadDocumentSaveMessage) => void } | null>(null);

  useLayoutEffect(() => {
    if (!options.onSave) return;
    let disposed = false;
    let captureReader: Capture | undefined;
    let baseline: string | undefined;
    let latest: string | undefined;
    let saving = false;
    let inFlight: string | undefined;
    let pending: { message: BidwrightCadDocumentSaveMessage; persist: NonNullable<Options["onSave"]> } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const update = (next: SaveState) => { if (!disposed) setState(next); };
    update({ status: "opening" });

    async function drain() {
      if (saving || !pending) return;
      clearTimeout(timer);
      clearTimeout(retry);
      saving = true;
      while (pending) {
        const snapshot = pending;
        pending = undefined;
        inFlight = snapshot.message.dxfContent;
        update({ status: "saving" });
        try {
          await snapshot.persist(snapshot.message);
          baseline = snapshot.message.dxfContent;
        } catch (error) {
          pending ??= snapshot;
          saving = false;
          inFlight = undefined;
          update({ status: "error", error: error instanceof Error ? error.message : String(error) });
          if (!disposed) retry = setTimeout(() => void drain(), 5000);
          return;
        }
      }
      saving = false;
      inFlight = undefined;
      update({ status: latest === baseline ? "saved" : "unsaved" });
    }

    function enqueue(message: BidwrightCadDocumentSaveMessage) {
      latest = message.dxfContent;
      const owner = optionsRef.current.documentKey === options.documentKey ? optionsRef.current : options;
      pending = { message, persist: owner.onSave! };
      update({ status: saving ? "saving" : "unsaved" });
      clearTimeout(timer);
      timer = setTimeout(() => void drain(), 400);
    }

    function capture(force = false) {
      try {
        if (!captureReader) {
          const detail: CaptureDetail = {};
          options.iframe.current?.contentWindow?.dispatchEvent(new CustomEvent("bidwright:cad-document-capture", { detail }));
          captureReader = detail.capture;
        }
        const message = captureReader?.();
        if (!message) return;
        latest = message.dxfContent;
        // Opening a saved drawing establishes its baseline without uploading it.
        if (baseline === undefined && !force) {
          baseline = latest;
          update({ status: "saved" });
        } else if (force || latest !== (pending?.message.dxfContent ?? inFlight ?? baseline)) {
          // Do not keep resetting the debounce for the same queued snapshot.
          if (pending?.message.dxfContent !== latest) enqueue(message);
        }
      } catch (error) {
        update({ status: "error", error: error instanceof Error ? error.message : "Could not read the drawing to save it" });
      }
    }

    const save = () => { capture(true); void drain(); };
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== options.iframe.current?.contentWindow || event.data?.source !== "bidwright-cad-editor") return;
      if (event.data.type === "bidwright:cad-loaded") capture();
      if (event.data.type === "bidwright:cad-save") { enqueue(event.data); void drain(); }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      capture();
      if (!pending && !saving && latest === baseline) return;
      event.preventDefault();
      event.returnValue = "";
      void drain();
    };
    const online = () => { capture(); void drain(); };
    controls.current = { save, enqueue };
    window.addEventListener("message", receive);
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("online", online);
    const poll = options.autosave === false ? undefined : setInterval(() => capture(), 2000);
    capture();
    return () => {
      // Layout cleanup captures before React removes the iframe. The saved
      // reader also works when a file switch has already changed the ref.
      if (options.autosave !== false) capture();
      disposed = true;
      controls.current = null;
      clearInterval(poll);
      clearTimeout(timer);
      clearTimeout(retry);
      window.removeEventListener("message", receive);
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("online", online);
      void drain();
    };
  }, [options.documentKey, options.iframe, options.autosave, Boolean(options.onSave)]);

  return { ...state, save: useCallback(() => controls.current?.save(), []) };
}
