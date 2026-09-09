/**
 * Host factory.
 *
 * Selects an `AgentRuntimeHost` based on environment:
 *
 *   • `BIDWRIGHT_MODE=desktop`                — LocalProcessHost
 *   • `BIDWRIGHT_MODE=server`                 — BubblewrappedHost
 *                                                (Linux only; fail closed)
 *
 * Future cloud-sandbox tier plugs in a third host (gVisor / Firecracker /
 * managed) the same way without touching adapters or the spawn pipeline.
 */

import { bubblewrappedHost } from "./bubblewrapped.js";
import { localProcessHost } from "./local-process.js";
import type { AgentRuntimeHost } from "./types.js";
import { verifyProcessSandbox } from "@braedonsaunders/appkit-process-sandbox";
import { getBidwrightMode } from "../agent-home.js";
import { isApiDemoMode } from "../../demo-flag.js";
import { getProcessSandboxLauncherIdentity } from "./launcher-identity.js";

export type { AgentRuntimeHost, SpawnProcessOpts } from "./types.js";

let cached: AgentRuntimeHost | null = null;

function isServerMode(): boolean {
  return getBidwrightMode() === "server";
}

/**
 * Prove the configured server sandbox can create namespaces and mounts before
 * the API accepts traffic. Desktop mode intentionally uses the local host.
 */
export async function assertAgentRuntimeHostReady(): Promise<void> {
  if (!isServerMode()) return;
  // The public demo never spawns an agent process — the demo middleware
  // refuses every /cli and /api/cli route — and its image deliberately ships
  // without bubblewrap. Verifying a sandbox it will never use would abort
  // startup (index.ts exits on a fatal), leaving the Worker with a container
  // that is not running. getAgentRuntimeHost() below still fails closed if
  // anything ever does reach the spawn path.
  if (isApiDemoMode()) {
    console.log("[agent-host] demo mode: agent execution disabled, skipping process-sandbox verification");
    return;
  }
  if (process.platform !== "linux") {
    throw new Error(
      `[agent-host] Server-mode agent execution requires Linux; received ${process.platform}.`,
    );
  }
  const result = await verifyProcessSandbox({
    bubblewrapPath: process.env.BIDWRIGHT_BWRAP_PATH,
    launcherIdentity: getProcessSandboxLauncherIdentity(),
  });
  console.log(`[agent-host] AppKit process sandbox verified at ${result.bubblewrapPath}`);
}

export function getAgentRuntimeHost(): AgentRuntimeHost {
  if (cached) return cached;
  // Demo mode skips the sandbox verification above, so it must never hand out
  // a host: an unsandboxed agent process is worse than a failed request.
  if (isApiDemoMode()) {
    throw new Error("[agent-host] Agent execution is disabled in the public demo.");
  }
  if (isServerMode()) {
    if (process.platform !== "linux") {
      throw new Error(
        `[agent-host] Server-mode agent execution requires the AppKit Linux process sandbox; received ${process.platform}. ` +
          "Use desktop mode for a single-user local process or deploy the API on Linux.",
      );
    }
    cached = bubblewrappedHost;
    console.log(
      "[agent-host] selected: @braedonsaunders/appkit-process-sandbox — server CLI sessions run in per-tenant bubblewrap namespaces",
    );
  } else {
    cached = localProcessHost;
  }
  return cached;
}

/**
 * Test-only seam: lets unit tests inject a stub host without poking env.
 * Production code never calls this.
 */
export function __setAgentRuntimeHostForTests(host: AgentRuntimeHost | null): void {
  cached = host;
}
