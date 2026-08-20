import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const runtime = readFileSync(new URL("./services/cli-runtime.ts", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes/cli-routes.ts", import.meta.url), "utf8");

function functionBody(source: string, signature: string) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} not found`);
  const rest = source.slice(start + signature.length);
  const next = rest.search(/\nexport (async )?function |\n(async )?function /);
  return next === -1 ? rest : rest.slice(0, next);
}

test("resume refuses to start on top of a running session", () => {
  // The real incident: a resume was issued 4 minutes into a session that kept
  // running for another 90 seconds. Codex refused the second writer --
  // "thread-store conflict: thread <id> already has an active writer" -- and the
  // new run died. spawnSession already guarded this; resume did not.
  const body = functionBody(runtime, "export async function resumeSession(");
  assert.match(body, /session\.status === "running"/, "must check the live session's status");
  const guardIndex = body.indexOf('session.status === "running"');
  const sessionIdIndex = body.indexOf("let sessionId");
  assert.ok(
    guardIndex < sessionIdIndex,
    "the guard must run before resolving a session id to resume",
  );
});

test("the guard reports a conflict, not a generic failure", () => {
  const body = functionBody(runtime, "export async function resumeSession(");
  assert.match(body, /statusCode: 409/, "409 so callers can distinguish it from a crash");
  assert.match(body, /Stop it before resuming/, "tells the user what to do");
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
