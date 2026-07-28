/**
 * BubblewrappedHost — multi-tenant CLI isolation via Linux primitives.
 *
 * Wraps the spawn in `bwrap` (https://github.com/containers/bubblewrap), which
 * gives every CLI session its own user / pid / ipc / uts / cgroup namespace
 * and a tightly-scoped read-only view of the host filesystem. Each tenant
 * sees only their own project workspace and agent-home (.claude / .codex /
 * .gemini / opencode XDG dirs); other tenants' data is masked behind a
 * tmpfs over /data.
 *
 * Why this and not gVisor / Firecracker / managed sandbox: Bidwright's
 * threat model is B2B authenticated estimators, not anonymous public code
 * execution. The defenses we need are
 *   • file isolation between tenants (A user can't read B's project files)
 *   • no leakage of host secrets via /etc, /home, /root, /var
 *   • no leakage of one user's CLI auth into another user's spawn
 * bubblewrap covers all three with Linux user / mount namespaces, and ships
 * setuid root by default on Debian-based distros (no `--privileged` flag
 * needed at the container level).
 *
 * What we deliberately do NOT do:
 *   • Block network — the agent needs to call the LLM API and our MCP
 *     server. Egress allowlisting is a separate concern (B2's egress
 *     proxy) so this host stays focused on filesystem isolation.
 *   • Apply per-process resource limits via cgroup v2. Container-level
 *     limits in Docker already bound the worst case; intra-container
 *     fairness is a future concern.
 *
 * Activated for every BIDWRIGHT_MODE=server deployment. The shared AppKit
 * process sandbox owns the bubblewrap plan and fails closed when Linux,
 * bubblewrap, or a required bind source is unavailable.
 */

import type { ChildProcess } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { spawnBubblewrappedProcess } from "@appkit/process-sandbox";

import { getRunningEgressProxy } from "../egress-proxy-bootstrap.js";
import { stripBlankCredentialEnv } from "./env-sanitize.js";
import type { AgentRuntimeHost, SpawnProcessOpts } from "./types.js";

const SAFE_HOST_ENV = [
  "LANG",
  "LC_ALL",
  "TZ",
  "TERM",
  "COLORTERM",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
] as const;

function safeHostEnvironment(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of SAFE_HOST_ENV) {
    const value = process.env[key];
    if (value) result[key] = value;
  }
  return result;
}

const RUNTIME_STATE_ENV_KEYS = [
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "HOME",
  "XDG_DATA_HOME",
  "XDG_CONFIG_HOME",
] as const;

function runtimeWritablePaths(
  agentHomeDir: string | null,
  cliEnv: Record<string, string>,
): string[] {
  if (!agentHomeDir) return [];
  const root = resolve(agentHomeDir);
  const paths = new Set<string>();
  for (const key of RUNTIME_STATE_ENV_KEYS) {
    const value = cliEnv[key];
    if (!value || !isAbsolute(value)) continue;
    const candidate = resolve(value);
    const pathFromRoot = relative(root, candidate);
    if (
      pathFromRoot === "" ||
      pathFromRoot === ".." ||
      pathFromRoot.startsWith(`..${sep}`) ||
      isAbsolute(pathFromRoot)
    ) {
      continue;
    }
    paths.add(candidate);
  }
  return [...paths];
}

export const bubblewrappedHost: AgentRuntimeHost = {
  id: "bubblewrapped",

  async spawnProcess(opts: SpawnProcessOpts): Promise<ChildProcess> {
    const { plan, projectDir, cliEnv, isWin, userId } = opts;

    if (isWin) throw new Error("Server-mode agent execution requires the AppKit Linux process sandbox.");

    // userId resolves to an agentHomeDir via the agent-home service; the
    // runtime already calls ensureUserAgentHome before spawnProcess, but
    // we recompute the path here so the bind mount lines up exactly with
    // what each adapter set in its env (CLAUDE_CONFIG_DIR etc.).
    const agentHomeDir = userId
      ? resolve(process.env.AGENT_HOME_ROOT || "/data/agent-home", "users", userId)
      : null;
    const agentRuntimePaths = runtimeWritablePaths(agentHomeDir, cliEnv);

    if (plan.promptHandling.kind !== "flag" && plan.promptHandling.kind !== "positional" && plan.promptHandling.kind !== "positional-stdin") {
      // Defensive: unknown promptHandling shape would silently break
      // Windows-only prompt-stdin handling. Flag it explicitly.
      throw new Error(
        `BubblewrappedHost: unsupported promptHandling kind ${(plan.promptHandling as { kind: string }).kind}`,
      );
    }

    // Layer the egress-proxy env on top of the spawn env: bwrap'd CLI
    // sessions get HTTPS_PROXY pointing at the per-process proxy so all
    // outbound LLM API / MCP traffic is funneled through the allowlist.
    // The proxy may not be running on platforms where multitenant mode
    // is force-disabled (e.g. dev box) — fall through silently in that
    // case; the sandbox will still have direct network access since we
    // don't unshare-net.
    const proxy = getRunningEgressProxy();
    const proxyEnv = proxy ? proxy.toEnv() : {};

    console.log(
      `[cli:spawn:bwrap] cmd=${plan.cliCmd} cwd=${projectDir} userId=${userId ?? "none"} argCount=${plan.args.length}`,
    );

    const child = spawnBubblewrappedProcess({
      command: plan.cliCmd,
      args: plan.args,
      cwd: projectDir,
      writablePaths: [
        ...(opts.workspaceAccess === "read-only" ? [] : [projectDir]),
        ...agentRuntimePaths,
      ],
      readOnlyPaths: [
        "/usr",
        "/etc",
        "/opt",
        "/app",
        ...(opts.workspaceAccess === "read-only" ? [projectDir] : []),
      ],
      maskedPaths: ["/data", "/home", "/root", "/var"],
      bubblewrapPath: process.env.BIDWRIGHT_BWRAP_PATH,
      environment: stripBlankCredentialEnv({
        ...safeHostEnvironment(),
        ...cliEnv,
        ...proxyEnv,
      }),
      stdio: ["ignore", "pipe", "pipe"],
    });

    console.log(`[cli:spawn:bwrap] pid=${child.pid}`);
    return child;
  },
};
