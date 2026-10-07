import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createRuntimeBrokerPlan } from "./runtime-broker.js";

async function runWorker(requestPath: string, env: NodeJS.ProcessEnv = {}) {
  const workerPath = fileURLToPath(new URL("./runtime-broker-worker.ts", import.meta.url));
  const child = spawn(process.execPath, ["--import", "tsx", workerPath, requestPath], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    },
  );
  return {
    ...result,
    stdout,
    stderr,
    messages: stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  };
}

test("Codex App Server broker performs initialize, API-key auth, thread start, and turn completion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bidwright-runtime-broker-"));
  const fakeCodex = join(dir, "fake-codex.mjs");
  const requestPath = join(dir, "request.json");
  await writeFile(
    fakeCodex,
    `#!/usr/bin/env node
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") send({ id: msg.id, result: { userAgent: "fake" } });
  else if (msg.method === "account/read") send({ id: msg.id, result: { account: null, requiresOpenaiAuth: true } });
  else if (msg.method === "account/login/start") send({ id: msg.id, result: { type: "apiKey" } });
  else if (msg.method === "thread/start") {
    if (msg.params.sandbox !== "danger-full-access") {
      send({ id: msg.id, error: { code: -32602, message: "invalid sandbox enum" } });
      return;
    }
    send({ id: msg.id, result: { thread: { id: "thr_test" } } });
    send({ method: "thread/started", params: { thread: { id: "thr_test" } } });
  } else if (msg.method === "turn/start") {
    send({ id: msg.id, result: { turn: { id: "turn_test", status: "inProgress", items: [] } } });
    send({ method: "thread/tokenUsage/updated", params: { tokenUsage: { total: { totalTokens: 123 } } } });
    send({ method: "account/rateLimits/updated", params: { rateLimits: { limitId: "codex" } } });
    send({ method: "warning", params: { message: "Model metadata for \`gpt-test\` not found. Defaulting to fallback metadata; this can degrade performance and cause issues." } });
    send({ method: "warning", params: { message: "A different runtime warning" } });
    send({ method: "turn/started", params: { turn: { id: "turn_test", status: "inProgress" } } });
    send({ method: "item/completed", params: { item: { id: "item_test", type: "agentMessage", text: "done" } } });
    send({ method: "turn/completed", params: { turn: { id: "turn_test", status: "completed" } } });
  }
});`,
    { mode: 0o700 },
  );
  await writeFile(
    requestPath,
    JSON.stringify({
      transport: "codex-app-server",
      projectDir: dir,
      prompt: "verify transport",
      model: "gpt-test",
      reasoningEffort: "medium",
      codexCommand: fakeCodex,
      appServerArgs: [],
      suppressUnknownModelMetadataWarning: true,
    }),
    { mode: 0o600 },
  );

  const result = await runWorker(requestPath, { CODEX_API_KEY: "test-key" });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.messages.some((message) => message.type === "thread.started"), true);
  assert.equal(
    result.messages.some(
      (message) =>
        message.method === "item/completed" &&
        message.params?.item?.type === "agentMessage" &&
        message.params.item.text === "done",
    ),
    true,
  );
  assert.equal(
    result.messages.some(
      (message) =>
        message.method === "thread/tokenUsage/updated"
        || message.method === "account/rateLimits/updated",
    ),
    false,
  );
  assert.equal(
    result.messages.some(
      (message) =>
        message.method === "warning"
        && message.params?.message?.startsWith("Model metadata for `gpt-test` not found."),
    ),
    false,
  );
  assert.equal(
    result.messages.some(
      (message) =>
        message.method === "warning"
        && message.params?.message === "A different runtime warning",
    ),
    true,
  );
  assert.equal(
    result.messages.some(
      (message) =>
        message.method === "turn/completed" && message.params?.turn?.status === "completed",
    ),
    true,
  );
  await assert.rejects(() => readFile(requestPath), /ENOENT/);
});

test("source-mode broker plan resolves the tsx loader before changing to the project cwd", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bidwright-runtime-plan-"));
  const plan = await createRuntimeBrokerPlan(
    {
      transport: "codex-app-server",
      projectDir: dir,
      prompt: "verify loader resolution",
      model: "gpt-test",
      reasoningEffort: "medium",
      codexCommand: process.execPath,
      appServerArgs: [],
    },
    { OPENROUTER_API_KEY: "test-key" },
  );

  if (plan.args[0] === "--import") {
    assert.notEqual(plan.args[1], "tsx");
    assert.equal(isAbsolute(plan.args[1] || ""), true);
  } else {
    assert.equal(isAbsolute(plan.args[0] || ""), true);
  }
  assert.equal(plan.sandboxSelfExecutable, process.execPath);
});

test("broker enables shell and full native access regardless of legacy readOnly requests", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bidwright-review-broker-"));
  const fakeCodex = join(dir, "fake-readonly.mjs");
  const requestPath = join(dir, "request.json");
  await writeFile(fakeCodex, `#!/usr/bin/env node
import readline from "node:readline";
if (!process.argv.includes("features.shell_tool=true")) process.exit(9);
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") send({ id: msg.id, result: {} });
  else if (msg.method === "thread/start") {
    if (msg.params.sandbox !== "danger-full-access") process.exit(10);
    send({ id: msg.id, result: { thread: { id: "readonly-test" } } });
  } else if (msg.method === "turn/start") {
    if (msg.params.sandboxPolicy.type !== "dangerFullAccess") process.exit(11);
    send({ id: msg.id, result: {} });
    send({ method: "turn/completed", params: { turn: { status: "completed" } } });
  }
});`, { mode: 0o700 });
  await writeFile(requestPath, JSON.stringify({ transport: "codex-app-server", projectDir: dir,
    prompt: "review", model: "test", readOnly: true, reasoningEffort: "medium", codexCommand: fakeCodex, appServerArgs: [] }));
  const result = await runWorker(requestPath, { CODEX_API_KEY: "" });
  assert.equal(result.code, 0, result.stderr);
});

test("cache bridge changes only the child HTTP proxy and remains deployment opt-in", async () => {
  for (const enabled of [false, true]) {
    const dir = await mkdtemp(join(tmpdir(), "bidwright-cache-broker-"));
    const fakeCodex = join(dir, "fake-codex.mjs");
    const capturePath = join(dir, "capture.json");
    const requestPath = join(dir, "request.json");
    const originalProxy = "http://bidwright:fake-egress-secret@127.0.0.1:12345";
    await writeFile(fakeCodex, `#!/usr/bin/env node
import {writeFileSync} from "node:fs";
import readline from "node:readline";
writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({args:process.argv, http:process.env.HTTP_PROXY, lowerHttp:process.env.http_proxy, https:process.env.HTTPS_PROXY, lowerHttps:process.env.https_proxy, noProxy:process.env.NO_PROXY}));
const send = value => process.stdout.write(JSON.stringify(value)+"\\n");
readline.createInterface({input:process.stdin}).on("line",line=>{
 const msg=JSON.parse(line);
 if(msg.method==="initialize") send({id:msg.id,result:{}});
 else if(msg.method==="thread/start") send({id:msg.id,result:{thread:{id:"cache-test"}}});
 else if(msg.method==="turn/start") {
  send({id:msg.id,result:{}});
  send({method:"turn/completed",params:{turn:{status:"completed"}}});
 }
});`, {mode:0o700});
    await writeFile(requestPath, JSON.stringify({transport:"codex-app-server", projectDir:dir,
      prompt:"transport only", model:"anthropic/claude-opus-5.5", reasoningEffort:"medium",
      openRouterPromptCache:true, codexCommand:fakeCodex,
      appServerArgs:['-c','model_providers.openrouter.base_url="https://openrouter.ai/api/v1"']}));
    const result = await runWorker(requestPath, {CODEX_API_KEY:"", OPENROUTER_API_KEY:"fake-provider-key",
      BIDWRIGHT_OPENROUTER_PROMPT_CACHE:enabled ? "on" : "off",
      HTTP_PROXY:originalProxy, http_proxy:originalProxy, HTTPS_PROXY:originalProxy, https_proxy:originalProxy, NO_PROXY:""});
    assert.equal(result.code, 0, result.stderr);
    const captured = JSON.parse(await readFile(capturePath,"utf8"));
    assert.equal(captured.https, originalProxy);
    assert.equal(captured.lowerHttps, originalProxy);
    assert.equal(captured.noProxy, "");
    const configs = captured.args.filter((arg:string)=>arg.startsWith("model_providers.openrouter.base_url="));
    if (enabled) {
      const bridgeUrl = JSON.parse(configs.at(-1).split("=").slice(1).join("="));
      assert.match(bridgeUrl, /^http:\/\/127\.0\.0\.1:\d+\/api\/v1$/);
      assert.equal(captured.http, new URL(bridgeUrl).origin);
      assert.equal(captured.lowerHttp, captured.http);
      await assert.rejects(fetch(bridgeUrl+"/responses", {signal:AbortSignal.timeout(1000)}));
    } else {
      assert.equal(configs.length,1);
      assert.equal(captured.http,originalProxy);
      assert.equal(captured.lowerHttp,originalProxy);
    }
    assert.equal(result.stdout.includes("fake-egress-secret"),false);
    assert.equal(result.stderr.includes("fake-provider-key"),false);
  }
});
