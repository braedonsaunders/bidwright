import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReviewCycle, transcriptResult } from "./review-cycle.js";
import { reviewPhaseScripts } from "./review-phase-scripts.js";

test("Codex and Claude revision commands address the original builder session", () => {
  const codex = reviewPhaseScripts('cd "$(dirname "$0")"\nexec codex exec --json --sandbox workspace-write -c \'mode="build_estimate"\' - < prompt.txt > transcript.jsonl 2> stderr.log', "codex", "/tmp/eval space");
  assert.match(codex.review, /mode="qa"/);
  assert.match(codex.review, /> '\/tmp\/eval space\/transcript-review.jsonl'/);
  assert.match(codex.revise, /codex exec resume --json.*"\$BIDWRIGHT_BUILDER_SESSION_ID" - </);
  assert.doesNotMatch(codex.revise, /--sandbox/);
  assert.match(reviewPhaseScripts("claude -p < prompt.txt", "claude-code", "/tmp/test").revise, /claude --resume "\$BIDWRIGHT_BUILDER_SESSION_ID" -p/);
  assert.deepEqual(transcriptResult('{"type":"system","session_id":"claude-session"}\n{"type":"result","result":"done"}'), { sessionId: "claude-session", result: "done" });
});

for (const reviewWorks of [true, false]) test(`harness cycle ${reviewWorks ? "resumes once" : "fails open"} and never relaunches a claimed run`, async t => {
  const dir = await mkdtemp(join(tmpdir(), "bidwright-review-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "token"), "test-token");
  await writeFile(join(dir, "review-cycle.json"), JSON.stringify({ tokenFile: join(dir, "token"), apiUrl: "http://example.invalid", projectId: "copy", autoReview: true,
    brief: { projectName: "Test", quoteNumber: "Test", scope: "Test", documents: [], knowledgeBookFiles: [], knowledgeDocumentFiles: [] } }));
  await writeFile(join(dir, "fake-phase.cjs"), `
    const fs = require('node:fs'); const phase = process.argv[2];
    fs.appendFileSync('phases.txt', phase + '\\n');
    if (phase === 'review' && !${reviewWorks}) process.exit(1);
    if (phase === 'revise' && process.env.BIDWRIGHT_BUILDER_SESSION_ID !== 'builder-session') process.exit(2);
    const result = phase === 'review' ? JSON.stringify({ findings: [{ id: 'F1', rowIds: ['row'], suggestedFix: 'Check quantity' }], summary: 'One finding' }) : 'done';
    fs.writeFileSync('transcript-' + phase + '.jsonl', JSON.stringify({ type: 'thread.started', thread_id: phase === 'review' ? 'review-session' : 'builder-session' }) + '\\n' + JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: result } }) + '\\n');
  `);
  for (const phase of ["build", "review", "revise"]) await writeFile(join(dir, `run-${phase}.sh`), `exec node ./fake-phase.cjs ${phase}\n`);
  t.mock.method(globalThis, "fetch", async (url) => Response.json(String(url).endsWith("/source-overview")
    ? { sources: [], takeoff: { byDocumentPage: [], calibrations: {} } }
    : { workspace: { worksheets: [], laborBasis: {} } }));
  await runReviewCycle(dir);
  const state = JSON.parse(await readFile(join(dir, "review-cycle-state.json"), "utf8"));
  assert.equal(state.status, reviewWorks ? "complete" : "review_unavailable");
  assert.equal(state.phases.length, reviewWorks ? 3 : 2);
  assert.equal(state.phases[0].exitCode, 0);
  for (const phase of state.phases) {
    assert.equal(phase.timeoutSeconds, 180 * 60);
    assert.ok(phase.finishedAt);
  }
  if (reviewWorks) {
    assert.equal(state.findingsCount, 1);
    assert.match(await readFile(join(dir, "revision-prompt.txt"), "utf8"), /record why you disagree/);
  }
  await assert.rejects(runReviewCycle(dir), /already started/);
  assert.equal((await readFile(join(dir, "phases.txt"), "utf8")).trim().split("\n").length, reviewWorks ? 3 : 2);
});

test("all harness phases retain the configured reasoning effort", () => {
  for (const [runtime, command] of [
    ["codex", "codex exec --json -c 'model_reasoning_effort=\"xhigh\"' - < prompt.txt"],
    ["claude-code", "claude -p --effort xhigh < prompt.txt"],
  ]) {
    const phases = reviewPhaseScripts(command, runtime, "/tmp/eval");
    for (const script of Object.values(phases)) assert.match(script, /xhigh/);
  }
});

test("phase timeout records its outcome and does not start review after an incomplete build", async t => {
  const dir = await mkdtemp(join(tmpdir(), "bidwright-timeout-test-"));
  const priorExitCode = process.exitCode;
  t.after(async () => { process.exitCode = priorExitCode; await rm(dir, { recursive: true, force: true }); });
  await writeFile(join(dir, "token"), "test-token");
  await writeFile(join(dir, "review-cycle.json"), JSON.stringify({ tokenFile: join(dir, "token"), phaseTimeoutSeconds: .05 }));
  await writeFile(join(dir, "run-build.sh"), 'exec node -e "setInterval(() => {}, 1000)"\n');
  await runReviewCycle(dir);
  const state = JSON.parse(await readFile(join(dir, "review-cycle-state.json"), "utf8"));
  assert.equal(state.status, "build_failed");
  assert.equal(state.phases.length, 1);
  assert.equal(state.phases[0].exitCode, 124);
  assert.equal(state.phases[0].timeout, true);
  assert.ok(state.phases[0].finishedAt);
});
