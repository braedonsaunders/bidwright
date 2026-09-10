import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Route-level wiring for the "one live agent per project" rule.
 *
 * The rule itself is exercised for real in
 * `services/cli-runtime-liveness.test.ts`. It has to be: this file used to
 * assert that `resumeSession` contained `session.status === "running"`, which
 * stayed true for three weeks while the guard did nothing in production -- the
 * session registry it consulted had been emptied by an unrelated timer, so the
 * check never fired and resumes kept colliding with running agents. Matching
 * source text cannot tell a working guard from an inert one.
 */

const runtime = readFileSync(new URL("./services/cli-runtime.ts", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes/cli-routes.ts", import.meta.url), "utf8");

function functionBody(source: string, signature: string) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} not found`);
  const rest = source.slice(start + signature.length);
  const next = rest.search(/\nexport (async )?function |\n(async )?function /);
  return next === -1 ? rest : rest.slice(0, next);
}

test("the resume guard probes the process rather than trusting the registry", () => {
  const body = functionBody(runtime, "export async function resumeSession(");
  const guardIndex = body.indexOf("probeLiveAgent(");
  assert.notEqual(guardIndex, -1, "must probe for a live agent");
  assert.ok(
    guardIndex < body.indexOf("let sessionId"),
    "the guard must run before resolving a session id to resume",
  );
});

test("spawn and resume agree that one live session per project is the rule", () => {
  const spawn = functionBody(runtime, "export async function spawnSession(");
  assert.match(spawn, /existing\.status === "running"/, "spawn already had this guard");
});

test("the resume route surfaces the guard's status code", () => {
  const route = routes.slice(routes.indexOf('app.post("/api/cli/:projectId/resume"'));
  assert.match(
    route.slice(0, 700),
    /statusCode\?: number.*\?\? 500/s,
    "route maps the thrown statusCode rather than always returning 500",
  );
});

test("answering a question reports a failed resume instead of losing the answer", () => {
  // The answer is persisted first, so a 409 here must not read as "answer lost".
  const answer = routes.slice(routes.indexOf('app.post("/api/cli/:projectId/answer"'));
  const block = answer.slice(0, answer.indexOf("\n  app.post(", 1));
  assert.match(block, /resumeError/);
  assert.match(block, /ok: true/);
});
