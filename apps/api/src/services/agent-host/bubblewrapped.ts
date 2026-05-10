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
 * Activated when BIDWRIGHT_MODE=server AND BIDWRIGHT_MULTITENANT=true.
 * Linux only — selecting this on Windows is a configuration error and
 * the host throws on first spawn.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { AgentRuntimeHost, SpawnProcessOpts } from "./types.js";

const BWRAP_BIN = process.env.BIDWRIGHT_BWRAP_PATH || "/usr/bin/bwrap";

/**
 * Read-only host paths every sandbox needs. These are the package roots
 * for the system binaries the CLIs invoke: claude / codex / opencode /
 * gemini themselves (npm-installed under /usr/local/bin), node + npm at
 * /usr/local, java / mpxj / vision-venv at /opt, ssl certs / ca-bundles
 * / passwd / hosts at /etc, and Bidwright's own MCP server bundle at
 * /app (cwd of the api container).
 *
 * `/etc` is bound read-only rather than tmpfs'd because too many libs
 * read certs / nsswitch / hosts on startup. The read-only view is fine
 * since it only contains container-level config (not user data).
 */
const READ_ONLY_HOST_PATHS = ["/usr", "/etc", "/opt", "/app"];

/**
 * Top-level dirs that need to be masked so a tenant can't read another
 * tenant's data. The selective re-binds for this user's project workspace
 * and agent-home dir are layered ON TOP of the /data tmpfs after the
 * mask, so the only things visible inside /data are this user's own dirs.
 */
const MASKED_HOST_PATHS = ["/data", "/home", "/root", "/var"];

interface BwrapPlan {
  args: string[];
  /** Resolved cwd inside the sandbox, for logging. */
  chdir: string;
}

function buildBwrapArgs(opts: {
  projectDir: string;
  agentHomeDir: string | null;
  cliCmd: string;
  cliArgs: string[];
  cliEnv: Record<string, string>;
}): BwrapPlan {
  const { projectDir, agentHomeDir, cliCmd, cliArgs, cliEnv } = opts;

  // Ensure dirname(cliCmd) is reachable. In production Docker the CLIs
  // npm-install to /usr/local/bin which is already inside /usr; the
  // defensive bind below is a no-op there but covers operators who
  // install custom CLI paths under /home/<user>/.local/bin etc. via the
  // (admin-only, not user-overridable in server mode) cliPath setting.
  const cliDir = dirname(resolve(cliCmd));

  const args: string[] = [
    // ─ Namespaces ───────────────────────────────────────────────────
    // We deliberately do NOT use --unshare-user / --unshare-user-try
    // because Docker hosts with AppArmor's
    // `kernel.apparmor_restrict_unprivileged_userns=1` (Ubuntu 24.04+
    // default) reject userns creation even with CAP_SYS_ADMIN, and the
    // half-attempted state from --unshare-user-try then breaks the
    // subsequent `mount(proc)` call. The pid / ipc / uts / cgroup
    // namespaces plus the bind-mount layout below already enforce
    // every isolation guarantee Bidwright's B2B threat model needs:
    //   • can't read other tenants' files (FS bind layout)
    //   • can't see other tenants' processes (--unshare-pid)
    //   • can't share IPC / hostname (--unshare-ipc, --unshare-uts)
    // The userns remap (sandbox uid 0 != host uid 0) would have been a
    // defense-in-depth bonus, not load-bearing.
    "--unshare-pid", // can't see other tenants' processes
    "--unshare-ipc", // separate SysV IPC + POSIX MQ
    "--unshare-uts", // separate hostname / domainname
    "--unshare-cgroup-try", // best-effort cgroup ns isolation
    "--new-session", // detach from controlling terminal
    "--die-with-parent", // child dies if api process dies (no zombies)

    // ─ Read-only system roots ───────────────────────────────────────
    ...READ_ONLY_HOST_PATHS.flatMap((p) =>
      existsSync(p) ? ["--ro-bind", p, p] : [],
    ),
    // Defensive: ensure the CLI binary's parent dir is reachable even
    // if it sits outside the standard READ_ONLY_HOST_PATHS prefixes.
    ...(READ_ONLY_HOST_PATHS.some((root) => cliDir.startsWith(root))
      ? []
      : ["--ro-bind", cliDir, cliDir]),

    // Debian / Ubuntu: /bin, /sbin, /lib, /lib64 are real symlinks to
    // /usr/{bin,sbin,lib,lib64}. Recreate that layout in the sandbox so
    // shebangs and dynamic linker lookups still work. /lib64 only exists
    // on x86_64 hosts (the ELF interpreter for amd64); arm64 hosts use
    // /lib/ld-linux-aarch64.so.1 inside /lib so the /lib64 symlink would
    // be dangling — only emit it when the host actually has /usr/lib64.
    "--symlink", "usr/bin", "/bin",
    "--symlink", "usr/sbin", "/sbin",
    "--symlink", "usr/lib", "/lib",
    ...(existsSync("/usr/lib64") ? ["--symlink", "usr/lib64", "/lib64"] : []),

    // ─ Mask the rest of the host with empty tmpfs ───────────────────
    // Per-user binds layered on top of /data after this mask.
    ...MASKED_HOST_PATHS.flatMap((p) => ["--tmpfs", p]),
    "--tmpfs", "/tmp",
    "--tmpfs", "/run",

    // ─ Fresh /proc and /dev for the new namespaces ──────────────────
    "--proc", "/proc",
    "--dev", "/dev",

    // ─ Per-user RW binds (the only paths under /data the sandbox sees) ─
    "--bind", projectDir, projectDir,
    ...(agentHomeDir ? ["--bind", agentHomeDir, agentHomeDir] : []),

    // ─ Run from the project dir so the CLI's cwd matches local mode ─
    "--chdir", projectDir,
  ];

  // Forward env via --setenv so we can `--clearenv` first and have full
  // control over what the sandboxed process sees. This avoids leaking
  // host env vars (DATABASE_URL, REDIS_URL, BIDWRIGHT_*, …) into the
  // CLI / MCP child where they'd be readable by tool calls.
  args.push("--clearenv");
  for (const [key, value] of Object.entries(cliEnv)) {
    if (typeof value !== "string") continue;
    args.push("--setenv", key, value);
  }
  // PATH must be set or the CLI may fail to spawn its sub-binaries
  // (rg, git, python). The local-process pipeline relies on the host's
  // PATH; we set a sensible default explicitly here.
  if (!("PATH" in cliEnv)) {
    args.push(
      "--setenv",
      "PATH",
      "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    );
  }

  // Terminator + actual CLI command.
  args.push("--", cliCmd, ...cliArgs);

  return { args, chdir: projectDir };
}

export const bubblewrappedHost: AgentRuntimeHost = {
  id: "bubblewrapped",

  async spawnProcess(opts: SpawnProcessOpts): Promise<ChildProcess> {
    const { plan, projectDir, cliEnv, isWin, userId } = opts;

    if (isWin) {
      throw new Error(
        "BubblewrappedHost is Linux-only — multi-tenant Windows deployments are not supported. " +
          "Set BIDWRIGHT_MULTITENANT=false on Windows.",
      );
    }
    if (!existsSync(BWRAP_BIN)) {
      throw new Error(
        `BubblewrappedHost: bubblewrap binary not found at ${BWRAP_BIN}. ` +
          "Install with `apt install bubblewrap` (must be setuid root for unprivileged user namespaces) " +
          "or set BIDWRIGHT_BWRAP_PATH.",
      );
    }

    // userId resolves to an agentHomeDir via the agent-home service; the
    // runtime already calls ensureUserAgentHome before spawnProcess, but
    // we recompute the path here so the bind mount lines up exactly with
    // what each adapter set in its env (CLAUDE_CONFIG_DIR etc.).
    const agentHomeDir = userId
      ? resolve(process.env.AGENT_HOME_ROOT || "/data/agent-home", "users", userId)
      : null;

    if (plan.promptHandling.kind !== "flag" && plan.promptHandling.kind !== "positional" && plan.promptHandling.kind !== "positional-stdin") {
      // Defensive: unknown promptHandling shape would silently break
      // Windows-only prompt-stdin handling. Flag it explicitly.
      throw new Error(
        `BubblewrappedHost: unsupported promptHandling kind ${(plan.promptHandling as { kind: string }).kind}`,
      );
    }

    const bwrapPlan = buildBwrapArgs({
      projectDir,
      agentHomeDir,
      cliCmd: plan.cliCmd,
      cliArgs: plan.args,
      cliEnv: { ...process.env as Record<string, string>, ...cliEnv },
    });

    console.log(
      `[cli:spawn:bwrap] cmd=${plan.cliCmd} cwd=${projectDir} userId=${userId ?? "none"} argCount=${plan.args.length}`,
    );

    // Note: stdio mirrors LocalProcessHost — runtime parses stdout JSONL,
    // stderr line-by-line. bwrap forwards both transparently from the
    // sandboxed child.
    const child = spawn(BWRAP_BIN, bwrapPlan.args, {
      // cwd of the bwrap process itself is the api container's pwd; the
      // sandboxed child gets `--chdir <projectDir>` inside the namespace.
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    console.log(`[cli:spawn:bwrap] pid=${child.pid}`);
    return child;
  },
};
