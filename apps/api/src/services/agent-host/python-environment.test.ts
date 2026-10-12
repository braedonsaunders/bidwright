import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBubblewrapPlan, DEFAULT_PROCESS_PATH } from "@braedonsaunders/appkit-process-sandbox";
import { agentPythonEnvironment, agentPythonFacts } from "./python-environment.js";

test("sandbox plan retains explicit vision Python PATH and the independent CAD interpreter", () => {
  const environment = agentPythonEnvironment({ LANG: "C.UTF-8", BIDWRIGHT_PROJECT_ID: "project" });
  const plan = buildBubblewrapPlan({ command: "/usr/bin/node", args: [], cwd: "/data/project", writablePaths: ["/data/project"], environment }, { pathExists: () => true });
  assert.equal(plan.environment.PATH, `/opt/vision-venv/bin:${DEFAULT_PROCESS_PATH}`);
  assert.equal(plan.environment.PYTHON_PATH, "/opt/vision-venv/bin/python");
  assert.equal(plan.environment.BIDWRIGHT_CAD_PYTHON, "/opt/cad-venv/bin/python");
  assert.equal(plan.environment.BASH_ENV, existsSync("/opt/vision-venv/bin/activate") ? "/opt/vision-venv/bin/activate" : undefined);
  assert.equal(plan.environment.BIDWRIGHT_PROJECT_ID, "project");
  assert.equal(plan.environment.LANG, "C.UTF-8");
  const custom = agentPythonEnvironment({ PATH: "/pool/bin:/usr/bin:/opt/vision-venv/bin" });
  assert.equal(custom.PATH, "/opt/vision-venv/bin:/pool/bin:/usr/bin");
});

test("both Python names resolve to the selected venv after a CLI login shell resets PATH", { skip: process.platform !== "linux" }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "bidwright-python-env-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const venv = join(directory, "vision");
  execFileSync("/usr/bin/python3", ["-m", "venv", "--without-pip", venv], { timeout: 30_000 });
  const environment = agentPythonEnvironment({ PATH: "/usr/bin:/bin" }, { visionVenv: venv, cadPython: "/custom/cad/python" });
  const output = execFileSync("/bin/bash", ["-c", "PATH=/usr/bin:/bin exec /bin/bash -lc 'command -v python; command -v python3'"], { env: environment, encoding: "utf8", timeout: 10_000 });
  assert.deepEqual(output.trim().split("\n"), [join(venv, "bin/python"), join(venv, "bin/python3")]);
  assert.match(agentPythonFacts(environment), /custom\/cad\/python/);
  assert.ok(agentPythonFacts(environment).includes(join(venv, "bin/python")));
});


test("eval hosts without the vision venv do not source a nonexistent activation file", () => {
  const environment = agentPythonEnvironment({ PATH: "/usr/bin" }, { visionVenv: "/missing-vision-venv" });
  assert.equal(environment.BASH_ENV, undefined);
});
