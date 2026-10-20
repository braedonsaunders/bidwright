"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@braedonsaunders/appkit-ui";
import {
  ApiError,
  deletePipingSpecLibraryEntry,
  getPipingSpecLibraryEntry,
  listPipingSpecLibrary,
  putPipingSpecLibraryEntry,
  type PipingSpecLibrarySummary,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type SaveStatus = "opening" | "saved" | "unsaved" | "saving" | "error";
type SpoolyardMessage = {
  source?: string;
  type?: string;
  id?: string;
  content?: string;
  status?: SaveStatus;
  error?: string;
  op?: string;
  specId?: string;
  spec?: { id?: unknown } & Record<string, unknown>;
};

/** The summary Spoolyard keeps for a library spec; updatedAt is epoch milliseconds. */
const spoolyardSummary = (s: PipingSpecLibrarySummary) => ({
  id: s.specId,
  name: s.name,
  material: s.material,
  service: s.service,
  rating: s.rating,
  revision: s.revision,
  rowCount: s.rowCount,
  updatedAt: Date.parse(s.updatedAt),
});

/** The API's own message where it gave one: the drafter sees it in Spoolyard. */
function libraryErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    try {
      const body = JSON.parse(error.body);
      if (typeof body.message === "string") return body.message;
    } catch {
      /* use the request error below */
    }
  }
  return error instanceof Error ? error.message : String(error);
}

/** Answers a spoolyard:library request from the organisation's piping specification library. */
async function answerLibraryRequest(data: SpoolyardMessage): Promise<unknown> {
  const specId = () => {
    if (typeof data.specId !== "string" || !data.specId) throw new Error("The request names no specification.");
    return data.specId;
  };
  switch (data.op) {
    case "list":
      return (await listPipingSpecLibrary()).map(spoolyardSummary).sort((a, b) => a.id.localeCompare(b.id));
    case "get":
      return (await getPipingSpecLibraryEntry(specId()))?.spec ?? null;
    case "put": {
      const spec = data.spec;
      if (!spec || typeof spec.id !== "string") throw new Error("The request carries no specification.");
      // The server derives the summary from the spec; the one Spoolyard sends is not trusted.
      return spoolyardSummary(await putPipingSpecLibraryEntry({ ...spec, id: spec.id }));
    }
    case "remove":
      await deletePipingSpecLibraryEntry(specId());
      return null;
    default:
      throw new Error(`Unknown specification library request "${String(data.op)}".`);
  }
}

const hostTheme = () =>
  typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";

/**
 * Spoolyard (github.com/braedonsaunders/spoolyard), the piping isometric editor, embedded from
 * /spoolyard like the CAD and model editors. BidWright draws the single header; Spoolyard autosaves
 * through postMessage and this host writes the file. BidWright also keeps the drafter's piping
 * specification library (the organisation's), offered in answer to spoolyard:ready.
 */
export function SpoolyardEditor({
  fileUrl,
  fileName,
  onSave,
  headerActions,
}: {
  fileUrl: string;
  fileName: string;
  onSave: (content: string) => Promise<void>;
  headerActions?: ReactNode;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<SaveStatus>("opening");
  const [error, setError] = useState("");
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const src = useMemo(() => {
    const params = new URLSearchParams({ embed: "1", file: fileUrl, name: fileName, theme: hostTheme() });
    return "/spoolyard/index.html?" + params.toString();
  }, [fileName, fileUrl]);

  const post = useCallback((message: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage({ source: "spoolyard-host", ...message }, window.location.origin);
  }, []);

  useEffect(() => {
    const listener = async (event: MessageEvent<SpoolyardMessage>) => {
      if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (data?.source !== "spoolyard") return;
      if (data.type === "spoolyard:ready") {
        post({ type: "spoolyard:capabilities", library: { label: "BidWright" } });
      } else if (data.type === "spoolyard:library" && typeof data.id === "string") {
        try {
          post({ type: "spoolyard:library-result", id: data.id, ok: true, result: await answerLibraryRequest(data) });
        } catch (e) {
          post({ type: "spoolyard:library-result", id: data.id, ok: false, error: libraryErrorMessage(e) });
        }
      } else if (data.type === "spoolyard:status" && data.status) {
        setStatus(data.status);
        setError(data.error ?? "");
      } else if (data.type === "spoolyard:save" && typeof data.content === "string") {
        try {
          await saveRef.current(data.content);
          post({ type: "spoolyard:saved", id: data.id });
        } catch (e) {
          post({ type: "spoolyard:save-failed", id: data.id, error: e instanceof Error ? e.message : String(e) });
        }
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [post]);

  // Follow BidWright's light/dark theme.
  useEffect(() => {
    const observer = new MutationObserver(() => post({ type: "spoolyard:theme", theme: hostTheme() }));
    observer.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [post]);

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-bg">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-fg">{fileName}</span>
        <span
          role={status === "error" ? "alert" : "status"}
          title={error || "Isometric autosaves to Files"}
          className={cn("text-[10px]", status === "error" ? "text-red-500" : "text-fg/50")}
        >
          {status === "opening"
            ? "Opening…"
            : status === "saving"
              ? "Saving…"
              : status === "unsaved"
                ? "Unsaved"
                : status === "error"
                  ? "Save failed"
                  : "Saved"}
        </span>
        <Button
          size="sm"
          variant="ghost"
          aria-label={status === "error" ? "Retry saving isometric" : "Save isometric"}
          title={error || "Save isometric (Ctrl/Cmd+S)"}
          disabled={status === "opening"}
          onClick={() => post({ type: "spoolyard:save-now" })}
        >
          {status === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
        {headerActions}
      </div>
      <iframe
        ref={iframeRef}
        title={`${fileName} piping isometric`}
        src={src}
        className="block min-h-0 w-full flex-1 border-0 bg-bg"
        sandbox="allow-downloads allow-forms allow-modals allow-same-origin allow-scripts"
      />
    </div>
  );
}
