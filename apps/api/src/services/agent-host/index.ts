/**
 * Host factory.
 *
 * Selects an `AgentRuntimeHost` based on environment:
 *
 *   • `BIDWRIGHT_MODE=desktop`                — LocalProcessHost
 *   • `BIDWRIGHT_MODE=server`,
 *     `BIDWRIGHT_MULTITENANT` unset/false     — LocalProcessHost
 *   • `BIDWRIGHT_MODE=server`,
 *     `BIDWRIGHT_MULTITENANT=true`            — BubblewrappedHost
 *                                                (Linux only; CLI sessions
 *                                                run inside per-tenant
 *                                                bwrap user/mount/pid
 *                                                namespaces)
 *
 * Future cloud-sandbox tier plugs in a third host (gVisor / Firecracker /
 * managed) the same way without touching adapters or the spawn pipeline.
 */

import { bubblewrappedHost } from "./bubblewrapped.js";
import { localProcessHost } from "./local-process.js";
import type { AgentRuntimeHost } from "./types.js";

export type { AgentRuntimeHost, SpawnProcessOpts } from "./types.js";

let cached: AgentRuntimeHost | null = null;

function isMultitenantServer(): boolean {
  if ((process.env.BIDWRIGHT_MODE || "").toLowerCase() !== "server") return false;
  const flag = (process.env.BIDWRIGHT_MULTITENANT || "").toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}

export function getAgentRuntimeHost(): AgentRuntimeHost {
  if (cached) return cached;
  if (isMultitenantServer() && process.platform !== "win32") {
    cached = bubblewrappedHost;
    console.log(
      "[agent-host] selected: bubblewrapped (multi-tenant) — CLI sessions run in per-tenant namespaces",
    );
  } else {
    cached = localProcessHost;
    if (isMultitenantServer()) {
      console.warn(
        "[agent-host] BIDWRIGHT_MULTITENANT=true but platform is win32; falling back to LocalProcessHost. Multi-tenant Windows is not supported.",
      );
    }
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
