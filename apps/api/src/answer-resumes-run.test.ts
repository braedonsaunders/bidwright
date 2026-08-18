import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const cliRoutes = readFileSync(new URL("./routes/cli-routes.ts", import.meta.url), "utf8");
const store = readFileSync(new URL("./prisma-store.ts", import.meta.url), "utf8");
const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
const quoteTools = readFileSync(
  new URL("../../../packages/mcp-server/src/tools/quote-tools.ts", import.meta.url),
  "utf8",
);

/** Body of the POST /answer handler. */
function answerHandler() {
  const start = cliRoutes.indexOf('app.post("/api/cli/:projectId/answer"');
  assert.notEqual(start, -1, "answer route not found");
  const rest = cliRoutes.slice(start);
  const end = rest.indexOf("\n  app.post(", 1);
  return end === -1 ? rest : rest.slice(0, end);
}

test("answering a question resumes a run that already stopped", () => {
  // askUser has no deadline, so the answer can arrive after the agent exited.
  // Without this the answer sat in run history with nobody polling for it.
  const body = answerHandler();
  assert.match(body, /startResumedSession\(request, \{/, "must start a resumed session");
  assert.match(body, /if \(session\) \{/, "must not resume when a live session is already polling");
});

test("the resumed agent is told the question and the answer", () => {
  const body = answerHandler();
  assert.match(body, /Question: \$\{pendingQuestionText\(/, "restates the question");
  assert.match(body, /Answer: \$\{normalizedAnswer\}/, "passes the answer through");
});

test("a failed resume still reports the answer as saved", () => {
  // The answer is persisted before the resume is attempted, so losing the
  // resume must not look like the answer was lost.
  const body = answerHandler();
  const catchBlock = body.slice(body.indexOf("} catch (err) {"));
  assert.match(catchBlock, /ok: true/, "answer delivery still succeeded");
  assert.match(catchBlock, /resumeError/, "surfaces why the resume failed");
});

test("resume logic is shared with the /resume route, not duplicated", () => {
  const declarations = cliRoutes.match(/async function startResumedSession\(/g) ?? [];
  assert.equal(declarations.length, 1, "exactly one implementation");
  const routeBody = cliRoutes.slice(cliRoutes.indexOf('app.post("/api/cli/:projectId/resume"'));
  assert.match(
    routeBody.slice(0, 600),
    /return await startResumedSession\(request, body\)/,
    "the /resume route delegates to it",
  );
});

test("the figures finalize validates against are reachable by the agent", () => {
  // finalizeEstimateStrategy checks a claimed summary to within 2%, but
  // buildEstimateComputedSummary was private and no tool returned total or
  // per-bucket labour hours -- so the claim could only ever be a guess.
  assert.match(
    store,
    /async getEstimateComputedSummary\(projectId: string\)/,
    "store exposes the computed summary",
  );
  assert.match(
    store,
    /return this\.buildEstimateComputedSummary\(workspace, strategy\)/,
    "it returns the SAME computation the validator uses",
  );
  const recalcRoute = server.slice(server.indexOf('app.post("/projects/:projectId/recalculate"'));
  assert.match(
    recalcRoute.slice(0, 900),
    /getEstimateComputedSummary\(projectId\)/,
    "recalculate ships the summary",
  );
});

test("recalculateTotals returns the numbers instead of a bare acknowledgement", () => {
  const tool = quoteTools.slice(
    quoteTools.indexOf('"recalculateTotals"'),
    quoteTools.indexOf('"listRateSchedules"'),
  );
  assert.match(tool, /computedSummary/, "reads the summary off the response");
  assert.match(tool, /JSON\.stringify\(summary/, "returns the figures to the caller");
  assert.ok(
    !/text: "Totals recalculated" \}\]/.test(tool),
    "the old numberless response is gone",
  );
});
