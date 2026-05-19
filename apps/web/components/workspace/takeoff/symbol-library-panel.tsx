"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Play, Trash2, X } from "lucide-react";

import {
  deleteSymbolTemplate,
  listSymbolTemplates,
  runProjectLibraryOnDocument,
  runProjectLibraryOnPage,
  symbolTemplateImageUrl,
  updateSymbolTemplate,
  type RunLibraryOnDocumentResultRecord,
  type RunLibraryOnPageResultRecord,
  type SymbolTemplateRecord,
} from "@/lib/api";
import { cn } from "@/lib/utils";

interface SymbolLibraryPanelProps {
  projectId: string;
  /** Active document — needed for "Run on page" / "Run on document". */
  documentId: string | null;
  /** Active page number, 1-based. */
  pageNumber: number;
  /** Whether the active document is a PDF the matcher can operate on. */
  canRun: boolean;
  /** Fires after any successful library mutation (delete, toggle) OR batch
   *  run completion. Parent should re-fetch template count + annotations. */
  onLibraryChanged?: () => void;
  /** Close affordance — rendered as a small × in the header. */
  onClose: () => void;
}

type RunSummary =
  | { kind: "page"; result: RunLibraryOnPageResultRecord }
  | { kind: "document"; result: RunLibraryOnDocumentResultRecord };

export function SymbolLibraryPanel({
  projectId,
  documentId,
  pageNumber,
  canRun,
  onLibraryChanged,
  onClose,
}: SymbolLibraryPanelProps) {
  const [templates, setTemplates] = useState<SymbolTemplateRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyTemplateId, setBusyTemplateId] = useState<string | null>(null);
  const [running, setRunning] = useState<null | "page" | "document">(null);
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listSymbolTemplates(projectId);
      setTemplates(result.templates);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load library");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleToggleEnabled(template: SymbolTemplateRecord) {
    setBusyTemplateId(template.id);
    try {
      const updated = await updateSymbolTemplate(projectId, template.id, {
        enabled: !template.enabled,
      });
      setTemplates((cur) => cur?.map((t) => (t.id === updated.id ? updated : t)) ?? null);
      onLibraryChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusyTemplateId(null);
    }
  }

  async function handleDelete(template: SymbolTemplateRecord) {
    setBusyTemplateId(template.id);
    try {
      await deleteSymbolTemplate(projectId, template.id);
      setTemplates((cur) => cur?.filter((t) => t.id !== template.id) ?? null);
      onLibraryChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyTemplateId(null);
    }
  }

  async function handleRunOnPage() {
    if (!documentId || !canRun) return;
    setRunning("page");
    setRunError(null);
    setRunSummary(null);
    try {
      const result = await runProjectLibraryOnPage(projectId, {
        documentId,
        pageNumber,
        autoSave: true,
      });
      setRunSummary({ kind: "page", result });
      if (result.errors.length > 0) setRunError(result.errors[0]);
      onLibraryChanged?.();
      // Update last-run metadata visually without a full refetch.
      void refresh();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunning(null);
    }
  }

  async function handleRunOnDocument() {
    if (!documentId || !canRun) return;
    setRunning("document");
    setRunError(null);
    setRunSummary(null);
    try {
      const result = await runProjectLibraryOnDocument(projectId, {
        documentId,
        autoSave: true,
      });
      setRunSummary({ kind: "document", result });
      onLibraryChanged?.();
      void refresh();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunning(null);
    }
  }

  const enabledCount = templates?.filter((t) => t.enabled).length ?? 0;
  const totalCount = templates?.length ?? 0;

  return (
    <div className="w-[22rem] rounded-lg border border-line bg-panel shadow-xl outline-none">
      <div className="flex items-center gap-2 border-b border-line/70 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-fg">
          Symbol Library
          {totalCount > 0 && (
            <span className="ml-1.5 font-normal text-fg/45">
              {enabledCount}/{totalCount}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg/35 transition-colors hover:bg-panel2 hover:text-fg"
          aria-label="Close symbol library"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="flex items-center gap-2 border-b border-line/70 px-3 py-2">
        <button
          type="button"
          onClick={handleRunOnPage}
          disabled={!canRun || !documentId || running !== null || enabledCount === 0}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-bg/40 px-2.5 text-[11px] font-medium transition-colors",
            "hover:bg-panel2 disabled:cursor-not-allowed disabled:opacity-50",
          )}
          title={enabledCount === 0 ? "No enabled templates" : `Run ${enabledCount} templates on page ${pageNumber}`}
        >
          {running === "page" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          Run on page
        </button>
        <button
          type="button"
          onClick={handleRunOnDocument}
          disabled={!canRun || !documentId || running !== null || enabledCount === 0}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-bg/40 px-2.5 text-[11px] font-medium transition-colors",
            "hover:bg-panel2 disabled:cursor-not-allowed disabled:opacity-50",
          )}
          title={enabledCount === 0 ? "No enabled templates" : `Run ${enabledCount} templates across every page`}
        >
          {running === "document" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          Run on doc
        </button>
      </div>

      {runSummary && (
        <div className="border-b border-line/70 bg-emerald-500/5 px-3 py-2 text-[11px]">
          {runSummary.kind === "page" ? (
            <RunPageSummary result={runSummary.result} />
          ) : (
            <RunDocumentSummary result={runSummary.result} />
          )}
        </div>
      )}
      {runError && (
        <div className="border-b border-line/70 bg-rose-500/5 px-3 py-2 text-[11px] text-rose-500">
          {runError}
        </div>
      )}

      <div className="max-h-96 overflow-y-auto p-2">
        {loading && (
          <div className="flex items-center gap-2 py-2 text-[11px] text-fg/55">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading library…
          </div>
        )}
        {error && !loading && (
          <div className="rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1.5 text-[11px] text-rose-500">
            {error}
          </div>
        )}
        {!loading && templates && templates.length === 0 && (
          <div className="px-1 py-3 text-[11px] leading-relaxed text-fg/55">
            No symbols saved yet. Open the Page Legend and click "Save to library" on any entry with a captured glyph.
          </div>
        )}
        <div className="grid gap-1">
          {templates?.map((t) => (
            <TemplateRow
              key={t.id}
              template={t}
              projectId={projectId}
              busy={busyTemplateId === t.id || running !== null}
              onToggleEnabled={() => handleToggleEnabled(t)}
              onDelete={() => handleDelete(t)}
              lastRunForTemplate={
                runSummary?.kind === "page"
                  ? runSummary.result.templateResults.find((r) => r.templateId === t.id)
                  : runSummary?.kind === "document"
                  ? runSummary.result.pages
                      .flatMap((p) => p.templateResults)
                      .filter((r) => r.templateId === t.id)
                      .reduce(
                        (acc, r) => ({
                          ...r,
                          totalCount: acc.totalCount + r.totalCount,
                        }),
                        { templateId: t.id, symbol: t.symbol, label: t.label, totalCount: 0, matches: [] as never[] },
                      )
                  : undefined
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function TemplateRow({
  template,
  projectId,
  busy,
  onToggleEnabled,
  onDelete,
  lastRunForTemplate,
}: {
  template: SymbolTemplateRecord;
  projectId: string;
  busy: boolean;
  onToggleEnabled: () => void;
  onDelete: () => void;
  lastRunForTemplate?: { totalCount: number };
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded border px-2 py-1.5",
        template.enabled ? "border-line/70 bg-panel/80" : "border-line/40 bg-bg/40 opacity-60",
      )}
    >
      <img
        src={symbolTemplateImageUrl(projectId, template.id)}
        alt={template.symbol || template.label || "symbol"}
        className="h-10 w-10 shrink-0 rounded border border-line/60 bg-white object-contain"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate font-mono text-[11px] font-semibold text-amber-500">
            {template.symbol || "—"}
          </span>
          <span className="truncate text-[11px] text-fg/75">{template.label || "Unlabeled"}</span>
        </div>
        <div className="mt-0.5 text-[10px] text-fg/45">
          page {template.sourcePage} · thr {template.threshold.toFixed(2)}
          {template.crossScale && " · cross-scale"}
          {lastRunForTemplate !== undefined && (
            <>
              {" · "}
              <span className="font-semibold text-emerald-500">
                {lastRunForTemplate.totalCount} match{lastRunForTemplate.totalCount === 1 ? "" : "es"}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <button
          type="button"
          onClick={onToggleEnabled}
          disabled={busy}
          className={cn(
            "rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            template.enabled
              ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
              : "border-line/70 text-fg/45 hover:bg-panel2",
          )}
          title={template.enabled ? "Click to mute this template" : "Click to enable this template"}
        >
          {template.enabled ? "ON" : "off"}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="rounded text-fg/35 transition-colors hover:bg-panel2 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
          title="Delete template"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function RunPageSummary({ result }: { result: RunLibraryOnPageResultRecord }) {
  const total = result.templateResults.reduce((sum, r) => sum + r.totalCount, 0);
  const withMatches = result.templateResults.filter((r) => r.totalCount > 0).length;
  return (
    <div className="text-fg/80">
      Saved <span className="font-semibold text-emerald-500">{total}</span> match
      {total === 1 ? "" : "es"} from {withMatches} template{withMatches === 1 ? "" : "s"} on page{" "}
      <span className="font-mono">{result.pageNumber}</span>{" "}
      <span className="text-fg/45">({Math.round(result.duration_ms)}ms)</span>
    </div>
  );
}

function RunDocumentSummary({ result }: { result: RunLibraryOnDocumentResultRecord }) {
  return (
    <div className="text-fg/80">
      Saved <span className="font-semibold text-emerald-500">{result.grandTotal}</span> match
      {result.grandTotal === 1 ? "" : "es"} across {result.pageCount} pages{" "}
      <span className="text-fg/45">({Math.round(result.duration_ms / 1000)}s)</span>
    </div>
  );
}
