#!/usr/bin/env tsx
import { spawn } from "node:child_process";
import { mkdir, writeFile, open } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const value = (flag: string, fallback?: string) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const sourceProject = value("--project-id", "project-92c0a6f3-b9c6-42d0-9ff0-1f078ba8a823")!;
const api = value("--api-url", process.env.BIDWRIGHT_API_URL || "https://bidwright.rassaun.com/proxy")!;
const output = resolve(value("--out", `.bidwright/evals/matrix-${Date.now()}`)!);
const models = (value("--models", "openrouter:moonshotai/kimi-k3,claude-code:claude-opus-5-5,codex:gpt-6.1-sol,claude-code:claude-sonnet-5-5")!).split(",").map((entry) => {
  const split = entry.indexOf(":");
  if (split < 1) throw new Error("Each model must be runtime:model-id");
  return { runtime: entry.slice(0, split), model: entry.slice(split + 1) };
});
const scope = value("--scope", "Mechanical installation of Alexanderwerk and Servo-Lift equipment, including platform installation. Exclude platform fabrication and electrical work. Do not price customer-supplied equipment as new supply.")!;
const plan = { sourceProject, api, models, repeat: Number(value("--repeat", "1")), scope, output,
  copyProjectPerRun: true, reingestArchives: true, autoAnswer: false, stopOnQuestion: true, referenceFile: resolve("scripts/eval/alexanderwerk-ground-truth.json") };
if (!args.includes("--execute")) {
  console.log(JSON.stringify({ ...plan, instruction: "Pass --execute and authenticated environment or --token-file to run. Each attempt copies and resets the source estimate." }, null, 2));
} else {
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "matrix-plan.json"), JSON.stringify(plan, null, 2));
  const results = [];
  let interrupted = false;
  for (const candidate of models) {
    const destination = join(output, `${candidate.runtime}-${candidate.model.replace(/[^a-z0-9._-]/gi, "_")}`);
    const cmd = ["--import", createRequire(import.meta.url).resolve("tsx"), resolve("scripts/agent-evals/run-agent-evals.ts"),
      "--api-url", api, "--project-id", sourceProject, "--runtime", candidate.runtime, "--model", candidate.model,
      "--out", destination, "--scope", scope, "--repeat", String(plan.repeat), "--reingest-archives", "--no-auto-answer-questions", "--stop-on-question"];
    const tokenFile = value("--token-file");
    if (tokenFile) cmd.push("--token-file", tokenFile);
    const log = await open(`${destination}.log`, "w", 0o600);
    console.log(`Running ${candidate.runtime} / ${candidate.model}; log ${destination}.log`);
    const child = spawn(process.execPath, cmd, { stdio: ["ignore", log.fd, log.fd], env: { ...process.env, BIDWRIGHT_EVAL_COPY_PROJECT_PER_RUN: "true" } });
    const stop = () => { interrupted = true; child.kill("SIGTERM"); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    let code;
    try { code = await new Promise<number | null>((resolveCode, reject) => { child.once("error", reject); child.once("exit", resolveCode); }); }
    finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); await log.close(); }
    results.push({ ...candidate, exitCode: code, output: destination });
    await writeFile(join(output, "matrix-results.json"), JSON.stringify(results, null, 2));
    if (interrupted) { process.exitCode = 130; break; }
    if (code !== 0) process.exitCode = 1;
  }
}
