import { spawn, type ChildProcess } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { createInterface } from "node:readline";

import type { RuntimeBrokerRequest } from "./runtime-broker.js";

function emit(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizedEffort(
  effort: RuntimeBrokerRequest["reasoningEffort"],
): "low" | "medium" | "high" | "xhigh" | "max" | undefined {
  if (effort === "extra_high") return "xhigh";
  if (effort === "low" || effort === "medium" || effort === "high" || effort === "max") {
    return effort;
  }
  return undefined;
}

async function runClaude(request: Extract<RuntimeBrokerRequest, { transport: "claude-agent-sdk" }>) {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  const stream = query({
    prompt: request.prompt,
    options: {
      cwd: request.projectDir,
      model: request.model,
      effort: normalizedEffort(request.reasoningEffort),
      maxTurns: 200,
      resume: request.resumeSessionId,
      persistSession: true,
      settingSources: ["project"],
      systemPrompt: { type: "preset", preset: "claude_code" },
      tools: { type: "preset", preset: "claude_code" },
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      mcpServers: {
        bidwright: {
          command: request.mcpRunner,
          args: request.mcpArgs,
        },
      },
      strictMcpConfig: true,
      pathToClaudeCodeExecutable: request.claudeExecutable,
      env: {
        ...process.env,
        CLAUDE_AGENT_SDK_CLIENT_APP: "bidwright/0.1.0",
      },
    },
  });

  const close = () => stream.close();
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  try {
    for await (const message of stream) emit(message);
  } finally {
    process.off("SIGINT", close);
    process.off("SIGTERM", close);
  }
}

interface RpcMessage {
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: { code?: number; message?: string };
}

const FORWARDED_CODEX_NOTIFICATIONS = new Set([
  "turn/started",
  "turn/completed",
  "item/started",
  "item/completed",
  "mcpServer/startupStatus/updated",
  "warning",
]);

export function shouldForwardCodexNotification(message: RpcMessage): boolean {
  return typeof message.method === "string"
    && FORWARDED_CODEX_NOTIFICATIONS.has(message.method);
}

async function runCodex(request: Extract<RuntimeBrokerRequest, { transport: "codex-app-server" }>) {
  const child = spawn(request.codexCommand, ["app-server", ...request.appServerArgs], {
    cwd: request.projectDir,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (!child.stdin || !child.stdout) {
    throw new Error("Codex App Server did not expose bidirectional stdio.");
  }

  child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  const pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  let nextId = 1;
  let turnCompletion:
    | { resolve: (status: string) => void; reject: (error: Error) => void }
    | undefined;

  const requestRpc = (method: string, params: Record<string, unknown> = {}) => {
    const id = nextId++;
    child.stdin!.write(`${JSON.stringify({ method, id, params })}\n`);
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codex App Server timed out waiting for ${method}.`));
      }, 30_000);
      pending.set(id, { resolve, reject, timer });
    });
  };

  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      process.stderr.write(`[codex-app-server] Invalid JSONL: ${line}\n`);
      return;
    }

    if (typeof message.id === "number" && !message.method) {
      const waiting = pending.get(message.id);
      if (!waiting) return;
      clearTimeout(waiting.timer);
      pending.delete(message.id);
      if (message.error) {
        waiting.reject(new Error(message.error.message || `JSON-RPC error ${message.error.code ?? ""}`));
      } else {
        waiting.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      if (shouldForwardCodexNotification(message)) emit(message);
      if (message.method === "turn/completed" && turnCompletion) {
        const status = String(message.params?.turn?.status || "completed");
        turnCompletion.resolve(status);
      }
    }
  });

  const exited = new Promise<never>((_, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      reject(
        new Error(
          `Codex App Server exited before the turn completed (code ${code ?? "unknown"}, signal ${signal ?? "none"}).`,
        ),
      );
    });
  });
  const stop = () => child.kill("SIGTERM");
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await Promise.race([
      requestRpc("initialize", {
        clientInfo: { name: "bidwright", title: "Bidwright", version: "0.1.0" },
      }),
      exited,
    ]);
    child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);

    // CODEX_API_KEY is injected into this short-lived broker by the
    // tenant-aware spawn plan; never fall back to the API container env.
    const apiKey = process.env.CODEX_API_KEY;
    if (apiKey) {
      const account = await Promise.race([
        requestRpc("account/read", { refreshToken: false }),
        exited,
      ]);
      if (!account?.account || account.account.type !== "apiKey") {
        await Promise.race([
          requestRpc("account/login/start", { type: "apiKey", apiKey }),
          exited,
        ]);
      }
    }

    const threadResult = await Promise.race([
      request.resumeSessionId
        ? requestRpc("thread/resume", {
            threadId: request.resumeSessionId,
            model: request.model,
            cwd: request.projectDir,
            approvalPolicy: "never",
            sandbox: "danger-full-access",
          })
        : requestRpc("thread/start", {
            model: request.model,
            cwd: request.projectDir,
            approvalPolicy: "never",
            sandbox: "danger-full-access",
            serviceName: "bidwright",
          }),
      exited,
    ]);
    const threadId = threadResult?.thread?.id;
    if (!threadId) throw new Error("Codex App Server did not return a thread id.");
    emit({ type: "thread.started", thread_id: threadId, transport: "codex-app-server" });

    const completion = new Promise<string>((resolve, reject) => {
      turnCompletion = { resolve, reject };
    });
    await Promise.race([
      requestRpc("turn/start", {
        threadId,
        input: [{ type: "text", text: request.prompt }],
        cwd: request.projectDir,
        model: request.model,
        effort: normalizedEffort(request.reasoningEffort),
        approvalPolicy: "never",
        sandboxPolicy: { type: "externalSandbox", networkAccess: "enabled" },
      }),
      exited,
    ]);
    const status = await Promise.race([completion, exited]);
    if (status === "failed") throw new Error("Codex App Server reported a failed turn.");
  } finally {
    for (const waiting of pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(new Error("Codex App Server transport closed."));
    }
    pending.clear();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    if (!child.killed) child.kill("SIGTERM");
  }
}

async function main() {
  const requestPath = process.argv[2];
  if (!requestPath) throw new Error("Runtime broker request path is required.");
  const request = JSON.parse(await readFile(requestPath, "utf-8")) as RuntimeBrokerRequest;
  await unlink(requestPath).catch(() => undefined);

  if (request.transport === "codex-app-server") {
    await runCodex(request);
  } else if (request.transport === "claude-agent-sdk") {
    await runClaude(request);
  } else {
    throw new Error("Unsupported runtime broker transport.");
  }
}

main().catch((error) => {
  const message = errorMessage(error);
  emit({ type: "broker.error", message });
  process.stderr.write(`[runtime-broker] ${message}\n`);
  process.exitCode = 1;
});
