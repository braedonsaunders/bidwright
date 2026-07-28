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
import { verifyProcessSandbox } from "@appkit/process-sandbox";
import { getBidwrightMode } from "../agent-home.js";

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
  if (process.platform !== "linux") {
    throw new Error(
      `[agent-host] Server-mode agent execution requires Linux; received ${process.platform}.`,
    );
  }
  const result = await verifyProcessSandbox({
    bubblewrapPath: process.env.BIDWRIGHT_BWRAP_PATH,
  });
  console.log(`[agent-host] AppKit process sandbox verified at ${result.bubblewrapPath}`);
}

export function getAgentRuntimeHost(): AgentRuntimeHost {
  if (cached) return cached;
  if (isServerMode()) {
    if (process.platform !== "linux") {
      throw new Error(
        `[agent-host] Server-mode agent execution requires the AppKit Linux process sandbox; received ${process.platform}. ` +
          "Use desktop mode for a single-user local process or deploy the API on Linux.",
      );
    }
    cached = bubblewrappedHost;
    console.log(
      "[agent-host] selected: @appkit/process-sandbox — server CLI sessions run in per-tenant bubblewrap namespaces",
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
