"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GitCompare, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type ModelAsset,
  type RevisionImpactReport,
  type WorkspaceResponse,
  applyRevisionRetakeoff,
  analyzeRevisionDiff,
  createRevisionDiff,
  listModelAssets,
} from "@/lib/api";
import { Button, Label, ModalBackdrop } from "@/components/ui";
import { CompactSelect } from "@/components/ui";

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onApplied?: (workspace?: WorkspaceResponse) => void;
}

export function RevisionDiffModal({ open, onClose, projectId, onApplied }: Props) {
  const [assets, setAssets] = useState<ModelAsset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [baseId, setBaseId] = useState("");
  const [headId, setHeadId] = useState("");
  const [report, setReport] = useState<RevisionImpactReport | null>(null);
  const [computing, setComputing] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLinkIds, setSelectedLinkIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setError(null);
    setReport(null);
    setSelectedLinkIds(new Set());
    setLoadingAssets(true);
    listModelAssets(projectId)
      .then((res) => setAssets(res.assets ?? []))
      .catch((e: any) => setError(e?.message ?? "Failed to load model assets"))
      .finally(() => setLoadingAssets(false));
  }, [open, projectId]);

  useEffect(() => {
    if (!open) {
      setBaseId("");
      setHeadId("");
      setReport(null);
      setSelectedLinkIds(new Set());
    }
  }, [open]);

  const handleCompute = useCallback(async () => {
    if (!baseId || !headId) {
      setError("Pick both a base and head revision");
      return;
    }
    if (baseId === headId) {
      setError("Base and head must be different revisions");
      return;
    }
    setComputing(true);
    setError(null);
    try {
      const result = await createRevisionDiff(projectId, { baseModelId: baseId, headModelId: headId });
      setReport(result);
      // Default to selecting all impacted links so "Apply" works in one click.
      const all = new Set<string>();
      for (const c of result.changes) for (const it of c.impactedItems) all.add(it.linkId);
      setSelectedLinkIds(all);
    } catch (e: any) {
      setError(e?.message ?? "Failed to compute diff");
    } finally {
      setComputing(false);
    }
  }, [baseId, headId, projectId]);

  const handleAiNarrative = useCallback(async () => {
    if (!report) return;
    setAiBusy(true);
    setError(null);
    try {
      const next = await analyzeRevisionDiff(projectId, report.diffId);
      setReport(next);
    } catch (e: any) {
      setError(e?.message ?? "AI narrative failed");
    } finally {
      setAiBusy(false);
    }
  }, [projectId, report]);

  const handleApply = useCallback(async () => {
    if (!report) return;
    if (selectedLinkIds.size === 0) {
      setError("Select at least one row to apply");
      return;
    }
    if (!confirm(`Apply ${selectedLinkIds.size} change${selectedLinkIds.size === 1 ? "" : "s"} to worksheet items? This updates quantities directly.`)) return;
    setApplyBusy(true);
    setError(null);
    try {
      await applyRevisionRetakeoff(projectId, report.diffId, { onlyLinkIds: Array.from(selectedLinkIds) });
      onApplied?.();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Apply failed");
    } finally {
      setApplyBusy(false);
    }
  }, [projectId, report, selectedLinkIds, onApplied, onClose]);

  const assetOptions = useMemo(
    () =>
      assets.map((a) => ({
        value: a.id,
        label: `${a.fileName}${a.format ? ` (${a.format})` : ""}`,
      })),
    [assets],
  );

  if (!open) return null;

  return (
    <ModalBackdrop open={open} onClose={onClose}>
      <div className="bg-panel rounded-lg shadow-2xl w-[920px] max-w-[95vw] max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-fg/10">
          <div className="flex items-center gap-2">
            <GitCompare className="w-4 h-4" />
            <div className="text-sm font-medium">Compare drawing revisions</div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>

        {error && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-red-500/10 text-xs text-red-400 border border-red-500/30">
            {error}
          </div>
        )}

        {/* Selectors */}
        <div className="p-4 grid grid-cols-2 gap-3 border-b border-fg/10">
          <div>
            <Label className="text-[10px]">Base revision</Label>
            <CompactSelect
              value={baseId}
              onValueChange={setBaseId}
              options={assetOptions}
              placeholder={loadingAssets ? "Loading…" : "Select base"}
            />
          </div>
          <div>
            <Label className="text-[10px]">Head revision</Label>
            <CompactSelect
              value={headId}
              onValueChange={setHeadId}
              options={assetOptions}
              placeholder={loadingAssets ? "Loading…" : "Select head"}
            />
          </div>
          <div className="col-span-2 flex justify-end">
            <Button size="sm" onClick={handleCompute} disabled={computing || !baseId || !headId} className="text-xs">
              {computing ? "Computing…" : "Compute diff"}
            </Button>
          </div>
        </div>

        {/* Report */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {!report && !computing && (
            <div className="text-xs text-fg/40 text-center py-12">Pick a base and head revision to see what changed.</div>
          )}
          {report && (
            <>
              <div className="rounded-md border border-fg/10 bg-panel2/40 p-3 space-y-2">
                <div className="grid grid-cols-5 gap-2 text-[11px]">
                  <Stat label="Added" value={report.summary.elementsAdded.toString()} tone="success" />
                  <Stat label="Removed" value={report.summary.elementsRemoved.toString()} tone="danger" />
                  <Stat label="Modified" value={report.summary.elementsModified.toString()} tone="info" />
                  <Stat label="Affected lines" value={report.summary.affectedItems.toString()} />
                  <Stat label="Cost delta" value={formatCurrency(report.summary.totalCostDelta)} tone={report.summary.totalCostDelta >= 0 ? "danger" : "success"} />
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-fg/10">
                  <Button size="sm" variant="ghost" onClick={handleAiNarrative} disabled={aiBusy} className="text-xs">
                    <Sparkles className="w-3.5 h-3.5 mr-1" /> {aiBusy ? "Analyzing…" : "Run AI summary"}
                  </Button>
                  {report.warnings.length > 0 && (
                    <div className="text-[10px] text-amber-400">
                      {report.warnings.length} warning{report.warnings.length === 1 ? "" : "s"}
                    </div>
                  )}
                </div>
                {report.aiNarrative && (
                  <div className="text-[11px] text-fg/70 bg-accent/5 border border-accent/20 rounded-md p-2 whitespace-pre-wrap">
                    {report.aiNarrative}
                  </div>
                )}
              </div>

              <div className="rounded-md border border-fg/10 overflow-hidden">
                <table className="w-full text-[11px]">
                  <thead className="bg-panel2/40 text-fg/45">
                    <tr>
                      <th className="px-2 py-1.5 w-6"></th>
                      <th className="px-2 py-1.5 text-left">Change</th>
                      <th className="px-2 py-1.5 text-left">Element</th>
                      <th className="px-2 py-1.5 text-left">Linked item</th>
                      <th className="px-2 py-1.5 text-right">Old qty</th>
                      <th className="px-2 py-1.5 text-right">New qty</th>
                      <th className="px-2 py-1.5 text-right">Cost Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.changes.length === 0 && (
                      <tr>
                        <td colSpan={7} className="text-center text-fg/40 py-6">
                          No changes detected.
                        </td>
                      </tr>
                    )}
                    {report.changes.flatMap((change) => {
                      if (change.impactedItems.length === 0) {
                        return [
                          <tr key={`${change.externalId}-noimpact`} className="border-t border-fg/5 text-fg/40">
                            <td></td>
                            <td className="px-2 py-1">
                              <ChangeBadge type={change.changeType} />
                            </td>
                            <td className="px-2 py-1 truncate">
                              {change.name || change.externalId}{" "}
                              <span className="text-fg/30">({change.elementClass})</span>
                            </td>
                            <td className="px-2 py-1 text-fg/30 italic" colSpan={4}>
                              not linked
                            </td>
                          </tr>,
                        ];
                      }
                      return change.impactedItems.map((it, idx) => (
                        <tr key={`${change.externalId}-${it.linkId}-${idx}`} className="border-t border-fg/5">
                          <td className="px-2 py-1">
                            <input
                              type="checkbox"
                              checked={selectedLinkIds.has(it.linkId)}
                              onChange={(e) => {
                                setSelectedLinkIds((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(it.linkId);
                                  else next.delete(it.linkId);
                                  return next;
                                });
                              }}
                            />
                          </td>
                          <td className="px-2 py-1">
                            {idx === 0 ? <ChangeBadge type={change.changeType} /> : null}
                          </td>
                          <td className="px-2 py-1 truncate">
                            {idx === 0 ? (
                              <>
                                {change.name || change.externalId}{" "}
                                <span className="text-fg/30">({change.elementClass})</span>
                              </>
                            ) : null}
                          </td>
                          <td className="px-2 py-1 truncate">{it.entityName}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{it.oldQuantity.toFixed(2)} {it.uom}</td>
                          <td className={cn("px-2 py-1 text-right tabular-nums", it.newQuantity !== it.oldQuantity && "font-medium")}>
                            {it.newQuantity.toFixed(2)} {it.uom}
                          </td>
                          <td className={cn("px-2 py-1 text-right tabular-nums", it.costDelta > 0 ? "text-red-400" : it.costDelta < 0 ? "text-green-400" : "text-fg/40")}>
                            {it.costDelta === 0 ? "—" : formatCurrency(it.costDelta)}
                          </td>
                        </tr>
                      ));
                    })}
                  </tbody>
                </table>
              </div>

              {report.warnings.map((w, i) => (
                <div key={i} className="text-[11px] text-amber-400 border border-amber-400/30 rounded-md p-2 bg-amber-400/5">
                  ⚠ {w}
                </div>
              ))}
            </>
          )}
        </div>

        <div className="px-4 py-3 border-t border-fg/10 flex items-center justify-between">
          <div className="text-[11px] text-fg/45">
            {report ? `${selectedLinkIds.size} of ${report.changes.reduce((s, c) => s + c.impactedItems.length, 0)} changes selected` : ""}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button
              size="sm"
              onClick={handleApply}
              disabled={!report || selectedLinkIds.size === 0 || applyBusy}
              className="text-xs"
            >
              {applyBusy ? "Applying…" : `Apply ${selectedLinkIds.size > 0 ? selectedLinkIds.size : ""} change${selectedLinkIds.size === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" | "info" | "default" }) {
  const toneCls =
    tone === "success" ? "text-green-400" :
    tone === "danger" ? "text-red-400" :
    tone === "info" ? "text-blue-400" :
    "text-fg";
  return (
    <div className="flex flex-col">
      <span className="text-fg/40 text-[10px] uppercase tracking-wider">{label}</span>
      <span className={cn("font-medium tabular-nums", toneCls)}>{value}</span>
    </div>
  );
}

function ChangeBadge({ type }: { type: "added" | "removed" | "modified" }) {
  const cls =
    type === "added" ? "bg-green-500/15 text-green-400" :
    type === "removed" ? "bg-red-500/15 text-red-400" :
    "bg-blue-500/15 text-blue-400";
  return <span className={cn("inline-block rounded px-1.5 py-0.5 text-[9px] font-medium uppercase", cls)}>{type}</span>;
}

function formatCurrency(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
}
