import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, symlink, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildReviewClaudeMdContent } from "../../apps/api/src/services/claude-md-generator.js";
import { estimateRevisionPrompt } from "../../packages/domain/src/estimate-review-loop.js";

export function transcriptResult(text: string) {
  let sessionId: string | undefined, result = "";
  for (const line of text.split("\n")) {
    let event: any; try { event = JSON.parse(line); } catch { continue; }
    sessionId ??= event.thread_id ?? event.session_id;
    if (event.type === "item.completed" && event.item?.type === "agent_message") result = event.item.text;
    if (event.type === "result") result = event.result ?? result;
  }
  return { sessionId, result };
}

export async function runReviewCycle(dir: string) {
  const config = JSON.parse(await readFile(join(dir, "review-cycle.json"), "utf8"));
  // Exclusive persistent claim: rerunning this launch file cannot create a second review or revision.
  const claim = await open(join(dir, "review-cycle-state.json"), "wx").catch(() => null);
  if (!claim) throw new Error("This eval cycle has already started. Its phase transcripts/state show the outcome; no process was relaunched.");
  await claim.close();
  const deadline = Date.now() + 90 * 60_000;
  let buildSucceeded = false;
  const state: any = { status: "building", phases: [] };
  const save = () => writeFile(join(dir, "review-cycle-state.json"), JSON.stringify(state, null, 2));
  await save();
  const raw = (await readFile(config.tokenFile, "utf8")).trim();
  const token = (raw.match(/^(?:BIDWRIGHT_EVAL_TOKEN|BIDWRIGHT_AUTH_TOKEN)=(.*)$/m)?.[1] ?? raw).trim().replace(/^(['"])(.*)\1$/, "$2");
  const api = async (path: string) => {
    const response = await fetch(config.apiUrl + path, { headers: { Authorization: `Bearer ${token}`, "X-Bidwright-Actor": "eval-harness" }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Eval snapshot HTTP ${response.status}`);
    return response.json() as Promise<any>;
  };
  const run = async (phase: string, seconds: number, env: Record<string, string> = {}) => {
    seconds = Math.min(seconds, Math.max(0, (deadline - Date.now()) / 1000));
    state.status = phase; const record: any = { phase, startedAt: new Date().toISOString() }; state.phases.push(record); await save();
    const started = performance.now();
    const child = spawn("sh", [join(dir, `run-${phase}.sh`)], { cwd: dir, env: { ...process.env, ...env }, stdio: "inherit", detached: true });
    // This group belongs only to this phase. Outer timeout signals are forwarded to it.
    const stop = (signal: NodeJS.Signals) => { try { process.kill(-child.pid!, signal); } catch (error: any) { if (error.code !== "ESRCH") throw error; } };
    const interrupted = () => { stop("SIGKILL"); process.exit(124); };
    process.once("SIGTERM", interrupted); process.once("SIGINT", interrupted);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; stop("SIGTERM"); }, seconds * 1000);
    const escalation = setTimeout(() => stop("SIGKILL"), (seconds + 5) * 1000);
    try {
      const code = await new Promise<number>((resolve, reject) => { child.once("error", reject); child.once("exit", code => resolve(code ?? 1)); });
      Object.assign(record, { elapsedSeconds: (performance.now() - started) / 1000, exitCode: code, timeout: timedOut });
      return code;
    } finally { clearTimeout(timer); clearTimeout(escalation); stop("SIGKILL"); process.off("SIGTERM", interrupted); process.off("SIGINT", interrupted); await save(); }
  };
  try {
    const code = await run("build", 5400);
    if (code !== 0) { state.status = "build_failed"; process.exitCode = code; return; }
    buildSucceeded = true;
    const before = await api(`/projects/${config.projectId}/workspace`);
    await writeFile(join(dir, "workspace-before-review.json"), JSON.stringify(before, null, 2));
    if (!config.autoReview) { state.status = "complete_review_disabled"; return; }
    const builder = transcriptResult(await readFile(join(dir, "transcript-build.jsonl"), "utf8"));
    if (!builder.sessionId || !/^[a-zA-Z0-9_-]+$/.test(builder.sessionId)) throw new Error("Builder returned no resumable session id; saved build stands");
    const reviewDir = join(dir, ".bidwright-review");
    await mkdir(reviewDir, { recursive: true });
    await symlink(join(dir, "documents"), join(reviewDir, "documents"), "dir").catch(error => { if (error.code !== "EEXIST") throw error; });
    await symlink(join(dir, ".bidwright"), join(reviewDir, ".bidwright"), "dir").catch(error => { if (error.code !== "EEXIST") throw error; });
    const workspace = before.workspace;
    const brief = buildReviewClaudeMdContent({ ...config.brief, projectDir: reviewDir, advisoryReview: true, reviewOutput: "json",
      sourceOverview: await api(`/api/projects/${config.projectId}/source-overview`), laborBasis: workspace.laborBasis, pricingIntegrity: workspace.pricingIntegrity, unlinkedMeasurements: workspace.unlinkedMeasurements });
    for (const name of ["AGENTS.md", "CLAUDE.md"]) await writeFile(join(reviewDir, name), brief);
    await writeFile(join(reviewDir, "review-prompt.txt"), "Read the review instruction file. Independently spot-check this saved estimate against its sources using the seven review dimensions. Return your findings as JSON. No user is available. Benchmarks and calibration lessons are disabled. The estimate stays unchanged during this review.");
    if (await run("review", 600) !== 0) throw new Error("Independent review failed or timed out; saved build stands");
    const reviewed = transcriptResult(await readFile(join(dir, "transcript-review.jsonl"), "utf8"));
    let findings: any;
    try { findings = JSON.parse(reviewed.result.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { throw new Error("Review did not return valid findings JSON; saved build stands"); }
    if (!Array.isArray(findings.findings)) throw new Error("Review returned no findings array; saved build stands");
    state.findingsCount = findings.findings.length;
    await writeFile(join(dir, "review-findings.json"), JSON.stringify(findings, null, 2));
    await writeFile(join(dir, "revision-prompt.txt"), estimateRevisionPrompt(findings));
    const revised = await run("revise", 5400, { BIDWRIGHT_BUILDER_SESSION_ID: builder.sessionId });
    state.status = revised === 0 ? "complete" : "revision_failed";
    await writeFile(join(dir, "workspace-after-revision.json"), JSON.stringify(await api(`/projects/${config.projectId}/workspace`), null, 2));
  } catch (error) {
    state.status = buildSucceeded ? "review_unavailable" : "build_failed";
    if (!buildSucceeded) process.exitCode = 1;
    state.fact = error instanceof Error ? error.message : String(error);
    console.error(state.fact); // Advisory failure does not turn a successful saved build into a failed estimate.
  } finally {
    await save();
    const transcripts = await Promise.all(["build", "review", "revise"].map(phase => readFile(join(dir, `transcript-${phase}.jsonl`), "utf8").catch(() => "")));
    await writeFile(join(dir, "transcript.jsonl"), transcripts.join("\n"));
    const errors = await Promise.all(["build", "review", "revise"].map(phase => readFile(join(dir, `stderr-${phase}.log`), "utf8").catch(() => "")));
    await writeFile(join(dir, "stderr.log"), errors.join("\n"));
  }
}
if (process.argv[1]?.endsWith("review-cycle.ts")) await runReviewCycle(resolve(process.argv[2]));
