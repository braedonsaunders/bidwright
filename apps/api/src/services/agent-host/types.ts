/**
 * Agent runtime host abstraction.
 *
 * The CLI runtime was originally written as one monolithic `spawnSession`
 * that knew (a) which CLI to invoke, (b) where to write its config files,
 * AND (c) how to actually fork the child process. Now we split those:
 *
 *   • Adapter (`cli-adapters/*`)  — describes HOW to invoke a specific CLI:
 *     binary discovery, native config files (`.claude/settings.json`,
 *     `.codex/config.toml`), prompt-handling shape, JSONL stdout parser.
 *
 *   • Host    (`agent-host/*`)    — describes WHERE to invoke it. The default
 *     `LocalProcessHost` just runs `child_process.spawn(cliCmd, args)` with
 *     the right cwd/env. Future hosts (B1's `BubblewrappedHost`, the cloud
 *     sandbox tier) wrap the same logic in stronger isolation primitives
 *     without touching adapter code.
 *
 * The host abstraction owns the *single* operation that differs across
 * deployment modes — the actual `spawn(...)` call. Workspace prep, credential
 * resolution, MCP config, watchdog timers, and stdout parsing all stay in
 * `cli-runtime.ts` because they're identical across hosts.
 */

import type { ChildProcess } from "node:child_process";
import type { SpawnPlan } from "../cli-adapters/types.js";

export interface SpawnProcessOpts {
  /** The fully-resolved adapter plan: binary path, args, extraEnv, prompt
   *  shape. Hosts should not modify this — they just execute it. */
  plan: SpawnPlan;
  /** Per-project working directory. The MCP config + adapter native config
   *  files were already written here by the runtime / adapter. */
  projectDir: string;
  /** Final env vars to pass to the child (already merged from MCP env,
   *  prepareWorkspace's extraEnv, and plan.extraEnv). The host is free to
   *  add more (e.g. cgroup hints) but should not silently drop entries. */
  cliEnv: Record<string, string>;
  /** True on Windows hosts — picks the .bat-shim spawn path. */
  isWin: boolean;
  /** Names the launcher .bat written for Windows: `.bidwright-run.bat` or
   *  `.bidwright-resume.bat`. Ignored on non-Windows hosts. */
  batSuffix: "run" | "resume";
  /** Bidwright user that owns this spawn. Hosts that need per-user
   *  isolation (multi-tenant Docker → bubblewrap, cloud sandbox →
   *  per-tenant sandbox routing) read this; LocalProcessHost ignores it. */
  userId?: string | null;
}

export interface AgentRuntimeHost {
  /** Stable id of the host implementation, used in logs / health checks. */
  readonly id: string;

  /**
   * Fork a CLI process per the plan and return its `ChildProcess`. The
   * runtime is responsible for wiring stdout/stderr/exit handlers — the
   * host only owns the spawn itself.
   *
   * Throwing here is treated as a hard spawn failure by the runtime; the
   * caller catches and reports it to the user.
   */
  spawnProcess(opts: SpawnProcessOpts): Promise<ChildProcess>;
}
