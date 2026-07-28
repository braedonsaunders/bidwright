import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import type { AgentReasoningEffort, SpawnPlan } from "./cli-adapters/types.js";

export type RuntimeBrokerRequest =
  | {
      transport: "codex-app-server";
      projectDir: string;
      prompt: string;
      model: string;
      reasoningEffort: AgentReasoningEffort;
      resumeSessionId?: string;
      codexCommand: string;
      appServerArgs: string[];
    }
  | {
      transport: "claude-agent-sdk";
      projectDir: string;
      prompt: string;
      model: string;
      reasoningEffort: AgentReasoningEffort;
      resumeSessionId?: string;
      mcpRunner: string;
      mcpArgs: string[];
      claudeExecutable?: string;
    };

function brokerWorkerInvocation(): { command: string; args: string[] } {
  const compiledWorker = fileURLToPath(new URL("./runtime-broker-worker.js", import.meta.url));
  if (existsSync(compiledWorker)) {
    return { command: process.execPath, args: [compiledWorker] };
  }

  const sourceWorker = fileURLToPath(new URL("./runtime-broker-worker.ts", import.meta.url));
  if (!existsSync(sourceWorker)) {
    throw new Error("Agent runtime broker worker is missing from the API installation.");
  }
  return { command: process.execPath, args: ["--import", "tsx", sourceWorker] };
}

export async function createRuntimeBrokerPlan(
  request: RuntimeBrokerRequest,
  extraEnv: Record<string, string>,
): Promise<SpawnPlan> {
  const requestDir = join(request.projectDir, ".bidwright", "runtime-broker");
  await mkdir(requestDir, { recursive: true });
  const requestPath = join(requestDir, `${request.transport}-${randomUUID()}.json`);
  await writeFile(requestPath, JSON.stringify(request), {
    encoding: "utf-8",
    mode: 0o600,
  });

  const worker = brokerWorkerInvocation();
  return {
    cliCmd: worker.command,
    args: [...worker.args, requestPath],
    extraEnv: {
      ...extraEnv,
      BIDWRIGHT_RUNTIME_TRANSPORT: request.transport,
    },
    promptHandling: { kind: "positional", index: worker.args.length },
  };
}
