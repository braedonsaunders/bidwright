"use client";

import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Download, Loader2, PanelRightClose, Send, Square, Undo2, Sparkles } from "lucide-react";
import { Button } from "@braedonsaunders/appkit-ui";
import type { ModelDesign } from "@bidwright/domain";
import { ApiError, apiRequest } from "@/lib/api";

function designError(error: unknown): string {
  if (error instanceof ApiError) {
    try { const body = JSON.parse(error.body); if (typeof body.message === "string") return body.message; } catch { /* use the request error below */ }
  }
  return error instanceof Error ? error.message : String(error);
}

type Message = { role: "user" | "assistant"; content: string };
interface ModelState {
  recipe: ModelDesign | null;
  history: Message[];
  name: string;
  kernelVersion: string;
  nodes: Array<{ id: string; name: string; selected?: boolean; sizeMm?: number[] }>;
  step?: string;
  editedParts?: number;
}
interface Props {
  iframe: RefObject<HTMLIFrameElement | null>;
  projectId: string;
  fileName?: string | null;
  toolbar: HTMLDivElement | null;
}

export function ModelDesignAssistant({ iframe, projectId, fileName, toolbar }: Props) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [state, setState] = useState<ModelState | null>(null);
  const [history, setHistory] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("Opening model…");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const pending = useRef(new Map<string, { resolve: (value: ModelState) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>());
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const request = useCallback((action: string, extra: Record<string, unknown> = {}): Promise<ModelState> => {
    const target = iframe.current?.contentWindow;
    if (!target) return Promise.reject(new Error("The model is still opening"));
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.current.delete(requestId);
        reject(new Error(action === "state" ? "The model is still opening" : "The editor did not finish the operation. Check the model before retrying."));
      }, action === "state" ? 2000 : 60000);
      pending.current.set(requestId, { resolve, reject, timer });
      target.postMessage({ type: "bidwright:model-design-request", source: "bidwright-host", requestId, action, ...extra }, window.location.origin);
    });
  }, [iframe]);

  useEffect(() => {
    mounted.current = true;
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== iframe.current?.contentWindow || event.data?.type !== "bidwright:model-design-result" || event.data?.source !== "bidwright-model-editor") return;
      const entry = pending.current.get(event.data.requestId);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.current.delete(event.data.requestId);
      if (event.data.ok) entry.resolve(event.data as ModelState);
      else entry.reject(new Error(event.data.error || "Model operation failed"));
    };
    window.addEventListener("message", receive);
    return () => {
      mounted.current = false;
      controller.current?.abort();
      window.removeEventListener("message", receive);
      for (const entry of pending.current.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("The model was closed"));
      }
      pending.current.clear();
    };
  }, [iframe]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();
    async function load() {
      try {
        const next = await request("state");
        if (disposed) return;
        setState(next);
        setHistory(next.history ?? []);
        setStatus("Ready to design");
      } catch (err) {
        if (disposed) return;
        if (Date.now() - started < 60000) timer = setTimeout(load, 500);
        else { setError(err instanceof Error ? err.message : "Could not open model"); setStatus("Model unavailable"); }
      }
    }
    void load();
    return () => { disposed = true; clearTimeout(timer); };
  }, [request]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [history, status, expanded]);

  useEffect(() => { if (expanded) promptRef.current?.focus(); }, [expanded]);

  async function submit() {
    const text = prompt.trim();
    if (!text || busy || !state) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError(null);
    setPrompt("");
    const before = history;
    setHistory([...before, { role: "user", content: text }]);
    let candidate: ModelDesign | null = null;
    try {
      let current = await request("state");
      let feedback: string | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        setStatus(attempt ? "Repairing the model…" : "Designing your model…");
        const response: { message: string; recipe: ModelDesign | null } = await apiRequest(`/api/models/${encodeURIComponent(projectId)}/design`, {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.signal,
          body: JSON.stringify({ prompt: text, recipe: candidate ?? current.recipe, context: { nodes: current.nodes, kernelVersion: current.kernelVersion }, history: before.slice(-16), feedback }),
        });
        if (abort.signal.aborted || !mounted.current) return;
        candidate = response.recipe;
        if (response.recipe) {
          setStatus("Building and checking geometry…");
          try { current = await request("apply", { recipe: response.recipe }); if (mounted.current) setState(current); }
          catch (err) {
            feedback = err instanceof Error ? err.message : String(err);
            if (attempt < 2) continue;
            throw new Error(`Could not build this design: ${feedback}`);
          }
        }
        if (abort.signal.aborted || !mounted.current) return;
        const content = response.recipe ? `${response.message}\n\nUpdated ${current.editedParts ?? response.recipe.parts.length} part${current.editedParts === 1 ? "" : "s"} in the current model.` : response.message;
        const next: Message[] = [...before, { role: "user", content: text }, { role: "assistant", content }];
        await request("conversation", { history: next.slice(-100) });
        setHistory(next);
        setState(current);
        setStatus("Ready to design");
        return;
      }
    } catch (err) {
      if (mounted.current && !abort.signal.aborted) {
        setError(designError(err));
        setStatus("Ready to design");
        setPrompt(text);
        setHistory(before);
      }
    } finally {
      if (mounted.current) { setBusy(false); if (abort.signal.aborted) setStatus("Stopped"); }
      if (controller.current === abort) controller.current = null;
    }
  }

  async function exportStep() {
    setExporting(true);
    setError(null);
    try {
      const next = await request("export");
      const blob = new Blob([next.step!], { type: "application/step" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(fileName || next.name || "Model").replace(/\.[^.]+$/, "")}.step`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setState(next);
    } catch (err) { if (mounted.current) { setError(designError(err)); setExpanded(true); } }
    finally { if (mounted.current) setExporting(false); }
  }

  async function changeParameter(key: string, value: number) {
    if (!state?.recipe || !Number.isFinite(value) || busy) return;
    setError(null);
    setBusy(true);
    setStatus("Updating dimensions…");
    try {
      const current = await request("state");
      if (!current.recipe) return;
      setState(await request("apply", { recipe: { ...current.recipe, parameters: { ...current.recipe.parameters, [key]: value } } }));
    } catch (err) { setError(designError(err)); }
    finally { if (mounted.current) { setBusy(false); setStatus("Ready to design"); } }
  }

  // Keep the bridge and conversation mounted while the dock is collapsed.
  // Portal the model controls into the shared toolbar so export stays available.
  return (
    <>
      {toolbar && createPortal(<>
        <Button ref={toggleRef} size="sm" variant={expanded ? "secondary" : "ghost"} aria-label="Design with AI" aria-expanded={expanded} aria-controls={panelId} title={error ? `Design with AI: ${error}` : busy ? status : "Design with AI"} onClick={() => setExpanded(value => !value)}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 text-accent" />}<span className="hidden @[600px]/model:inline">Design with AI</span>
          {error && <span className="h-1.5 w-1.5 rounded-full bg-red-400" aria-label="Design needs attention" />}
        </Button>
        <Button size="sm" variant="ghost" aria-label="Undo model change" title="Undo model change" disabled={!state || busy || exporting} onClick={async () => {
          try { setState(await request("undo")); setError(null); } catch (err) { setError(String(err)); setExpanded(true); }
        }}><Undo2 className="h-3.5 w-3.5" /></Button>
        <Button size="sm" variant="secondary" title="Export current geometry to SolidWorks as STEP" disabled={!state || busy || exporting} onClick={() => void exportStep()}>
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} STEP
        </Button>
      </>, toolbar)}
      <aside id={panelId} hidden={!expanded} className={expanded ? "flex w-[320px] min-w-[260px] max-w-[45%] shrink-0 flex-col border-l border-line bg-panel" : "hidden"} aria-label="3D design assistant">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-medium"><Sparkles className="h-4 w-4 text-accent" />Design with AI</div>
          <Button size="sm" variant="ghost" title="Collapse AI panel" aria-label="Collapse AI panel" onClick={() => { setExpanded(false); toggleRef.current?.focus(); }}><PanelRightClose className="h-3.5 w-3.5" /></Button>
        </div>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
          {!history.length && <div className="text-xs leading-relaxed text-fg/60">Describe a part or assembly, including dimensions and material. You can revise it here or select a part in the model to identify what to change.<p className="mt-3 text-fg/80">“Build a 48 × 30 × 36 inch steel stand using 2 inch square tube with 1/8 inch walls and a 1/4 inch top plate.”</p></div>}
          {history.map((message, index) => <div key={index} className={`whitespace-pre-wrap rounded-md px-3 py-2 text-xs leading-relaxed ${message.role === "user" ? "bg-accent/10 text-fg" : "bg-bg text-fg/80"}`}>{message.content}</div>)}
          {state?.recipe && <details className="rounded-md border border-line p-2 text-xs" open>
            <summary className="cursor-pointer text-fg/70">Dimensions ({state.recipe.units}) · {state.recipe.parts.length} parts</summary>
            <div className="mt-2 space-y-1.5">{Object.entries(state.recipe.parameters).map(([key, value]) => <label key={`${key}-${value}`} className="flex items-center justify-between gap-2"><span className="truncate text-fg/60">{key.replace(/_/g, " ")}</span><input aria-label={key} type="number" step="any" defaultValue={value} disabled={busy || exporting} className="w-24 rounded border border-line bg-bg px-2 py-1 text-right" onBlur={event => { if (event.target.value.trim() && Number(event.target.value) !== value) void changeParameter(key, Number(event.target.value)); }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>)}</div>
            {state.recipe.assumptions.length > 0 && <div className="mt-3 text-fg/55">Assumptions: {state.recipe.assumptions.join("; ")}</div>}
          </details>}
          {error && <div role="alert" className="rounded border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-400 break-words">{error}</div>}
        </div>
        <div className="border-t border-line p-3">
          <div role="status" className="mb-2 flex items-center gap-1.5 text-[11px] text-fg/50">{busy && <Loader2 className="h-3 w-3 animate-spin" />}{status}</div>
          <textarea ref={promptRef} aria-label="Describe your 3D model" value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Describe what you want built…" rows={3} className="w-full resize-none rounded-md border border-line bg-bg px-2 py-2 text-xs outline-none focus:border-accent" onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} />
          <div className="mt-2 flex justify-end">{busy ? <Button size="sm" variant="secondary" onClick={() => controller.current?.abort()} disabled={!controller.current}><Square className="h-3 w-3" />Stop</Button> : <Button size="sm" disabled={!state || !prompt.trim() || exporting} onClick={() => void submit()}><Send className="h-3 w-3" />Build</Button>}</div>
        </div>
      </aside>
    </>
  );
}
