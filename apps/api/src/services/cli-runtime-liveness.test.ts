import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { probeLiveAgent, reapSession, resumeSession } from "./cli-runtime.js";

/**
 * Above pid_max on both Linux (2^22) and macOS (~99998), so it can never name a
 * running process.
 */
const DEAD_PID = 2_147_483_647;

async function projectDirWithSessionState(state: Record<string, unknown>) {
  const dir = await mkdtemp(join(tmpdir(), "bidwright-liveness-"));
  await mkdir(join(dir, ".bidwright"), { recursive: true });
  await writeFile(join(dir, ".bidwright", "session.json"), JSON.stringify(state));
  return dir;
}

// ── The eviction that caused the incident ──────────────────────────────────

test("reaping a finished session does not evict the run that took its slot", () => {
  // The exact shape of the failure: run 1 completes and schedules its reap;
  // run 2 starts on the same project inside the reap delay and claims the slot;
  // run 1's timer then fires. Deleting by key alone left the API blind to run 2,
  // which was still working and went on to finish normally.
  const registry = new Map<string, { projectId: string; name: string }>();
  const finished = { projectId: "project-1", name: "run-1" };
  const tookOverTheSlot = { projectId: "project-1", name: "run-2" };

  registry.set("project-1", finished);
  registry.set("project-1", tookOverTheSlot);

  assert.equal(reapSession(registry, finished), false, "must not evict a newer session");
  assert.equal(registry.get("project-1"), tookOverTheSlot, "the live run stays reachable");
});

test("reaping a finished session still clears its own slot", () => {
  const registry = new Map<string, { projectId: string }>();
  const finished = { projectId: "project-1" };
  registry.set("project-1", finished);

  assert.equal(reapSession(registry, finished), true);
  assert.equal(registry.has("project-1"), false);
});

// ── Liveness is decided by probing, not by holding a handle ────────────────

test("a project with no persisted session state has no live agent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bidwright-liveness-"));
  const probe = await probeLiveAgent("project-none", dir);
  assert.equal(probe.live, false);
  assert.equal(probe.source, "none");
});

test("a running agent owned by this API process reads as live", async () => {
  const dir = await projectDirWithSessionState({
    pid: process.pid,
    ownerPid: process.pid,
    status: "running",
    sessionId: "thread-abc",
    runtime: "openrouter",
  });

  const probe = await probeLiveAgent("project-live", dir);
  assert.equal(probe.live, true, "lost the handle, but the process is still there");
  assert.equal(probe.source, "disk");
  assert.equal(probe.sessionId, "thread-abc");
});

test("a recorded pid that is no longer running does not read as live", async () => {
  const dir = await projectDirWithSessionState({
    pid: DEAD_PID,
    ownerPid: process.pid,
    status: "running",
  });

  assert.equal((await probeLiveAgent("project-dead", dir)).live, false);
});

test("a pid owned by a different API process is never probed", async () => {
  // A pid from a previous API process, or restored with a workspace snapshot
  // taken on another host, names a process that is not ours -- and pid numbers
  // get reused. `process.pid` is very much alive here, so only the ownership
  // check can keep this from being reported as a live agent.
  const dir = await projectDirWithSessionState({
    pid: process.pid,
    ownerPid: process.pid + 1,
    status: "running",
  });

  assert.equal((await probeLiveAgent("project-foreign", dir)).live, false);
});

test("a session that finished does not read as live", async () => {
  const dir = await projectDirWithSessionState({
    pid: process.pid,
    ownerPid: process.pid,
    status: "completed",
  });

  assert.equal((await probeLiveAgent("project-done", dir)).live, false);
});

// ── The guard that the eviction used to disable ────────────────────────────

test("resume refuses to start on top of an agent it can still see running", async () => {
  // Codex rejects the second writer on a thread outright -- "thread-store
  // conflict: thread <id> already has an active writer" -- so the resumed run
  // dies instantly while the original keeps going. Refuse it here, with a 409
  // the caller can distinguish from a crash, rather than letting the runtime
  // produce a raw error the user reads as "my estimate failed".
  const dir = await projectDirWithSessionState({
    pid: process.pid,
    ownerPid: process.pid,
    status: "running",
    sessionId: "thread-abc",
    runtime: "openrouter",
  });

  await assert.rejects(
    () => resumeSession({ projectId: "project-live", projectDir: dir, prompt: "continue" }),
    (err: Error & { statusCode?: number }) => {
      assert.equal(err.statusCode, 409, "409, not a generic 500");
      assert.match(err.message, /already running/i);
      assert.match(err.message, /Stop it before resuming/, "tells the user what to do");
      return true;
    },
  );
});

test("resume proceeds when the recorded agent is gone", async () => {
  // Not live -> the guard must not fire. This one gets past the guard and fails
  // later, on the session id it cannot resume, which is the correct next error.
  const dir = await projectDirWithSessionState({
    pid: DEAD_PID,
    ownerPid: process.pid,
    status: "running",
  });

  await assert.rejects(
    () => resumeSession({ projectId: "project-dead", projectDir: dir, prompt: "continue" }),
    (err: Error & { statusCode?: number }) => {
      assert.notEqual(err.statusCode, 409, "the liveness guard must not have fired");
      return true;
    },
  );
});
