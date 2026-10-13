import { estimateRevisionPrompt } from "@bidwright/domain";
import { prisma } from "@bidwright/db";
import type { SpawnSessionOpts } from "./cli-runtime.js";

type Cycle = { phase: "reviewing" | "revising" | "complete" | "failed"; startedAt: string; reviewId?: string; fact?: string };
/** The durable claim is written before launching either paid phase. A lost API process never replays a launch. */
export async function automaticEstimateReview(opts: SpawnSessionOpts, emit: (event: any) => void, db: any = prisma, signal?: AbortSignal): Promise<string | null> {
  if (opts.agentMode !== "build_estimate" || opts.reviewOnly || opts.autoReview === false || !opts.aiRunId || !opts.authToken) return null;
  const event = (phase: string, detail: string) => emit({ type: "progress", data: { phase, detail } });
  const run = await db.aiRun.findFirst({ where: { id: opts.aiRunId, projectId: opts.projectId } });
  if (!run) return null;
  const input = (run.input ?? {}) as Record<string, any>;
  const prior = input.autoReviewCycle as Cycle | undefined;
  if (prior) {
    if (prior.phase === "revising") await db.aiRun.update({ where: { id: run.id }, data: { input: { ...input, autoReviewCycle: { ...prior, phase: "complete" } } } });
    else if (prior.phase === "reviewing") {
      const fact = "An earlier automatic review was interrupted; it was not launched again. The saved estimate stands.";
      await db.aiRun.update({ where: { id: run.id }, data: { input: { ...input, autoReviewCycle: { ...prior, phase: "failed", fact } } } });
      event("reviewing", fact);
    }
    return null;
  }
  let cycle: Cycle = { phase: "reviewing", startedAt: new Date().toISOString() };
  const claim = await db.aiRun.updateMany({ where: { id: run.id, input: { equals: run.input } }, data: { input: { ...input, autoReviewCycle: cycle } } });
  if (claim.count !== 1) return null;
  const save = async () => db.aiRun.update({ where: { id: run.id }, data: { input: { ...input, autoReviewCycle: cycle } } });
  const api = async (path: string, body?: unknown) => {
    const response = await fetch(`${opts.apiBaseUrl}${path}`, { method: body === undefined ? "GET" : "POST", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${opts.authToken}`, "Content-Type": "application/json", "X-Bidwright-Run-Id": run.id },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) throw new Error(`Review API returned HTTP ${response.status}`);
    return response.json() as Promise<any>;
  };
  try {
    event("reviewing", "The first build turn finished. An independent review is checking the saved revision.");
    const started = await api(`/api/review/${opts.projectId}/start`, { advisory: true, runtime: opts.runtime, model: opts.model, expectedRevisionId: opts.revisionId });
    if (!started.reviewId) throw new Error(started.fact || "Review did not launch");
    cycle.reviewId = started.reviewId; await save();
    const deadline = Date.now() + 11 * 60_000;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      const { review } = await api(`/api/review/${opts.projectId}/latest?reviewId=${encodeURIComponent(started.reviewId)}`);
      if (!review || review.status === "failed" || review.status === "stopped") throw new Error("Independent review failed or timed out; the build remains saved");
      if (review.status === "completed") {
        if (review.revisionId !== opts.revisionId || (review.currentRevisionId && review.currentRevisionId !== opts.revisionId)) throw new Error("Current revision changed during review; no automatic edits were started");
        cycle.phase = "revising"; await save();
        event("revising", `Independent review returned ${(review.findings ?? []).length} findings. Resuming the same builder session once.`);
        return estimateRevisionPrompt({ reviewId: review.id, findings: review.findings, summary: review.summary });
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error("Independent review exceeded its time limit; the saved build stands");
  } catch (error) {
    cycle = { ...cycle, phase: "failed", fact: error instanceof Error ? error.message : String(error) };
    await save().catch(() => {});
    event("reviewing", `Automatic review unavailable: ${cycle.fact}. Completion is unaffected.`);
    return null;
  }
}

export async function recordAutomaticRevisionFailure(opts: SpawnSessionOpts, fact: string, db: any = prisma) {
  if (opts.agentMode !== "build_estimate" || !opts.aiRunId) return;
  const run = await db.aiRun.findFirst({ where: { id: opts.aiRunId, projectId: opts.projectId } });
  const input = run?.input as Record<string, any> | undefined;
  if (input?.autoReviewCycle?.phase !== "revising") return;
  await db.aiRun.update({ where: { id: run.id }, data: { input: { ...input, autoReviewCycle: { ...input.autoReviewCycle, phase: "failed", fact } } } });
}
