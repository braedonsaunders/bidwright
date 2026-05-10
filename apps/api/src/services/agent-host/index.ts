/**
 * Host factory.
 *
 * Selects an `AgentRuntimeHost` based on environment:
 *
 *   • `BIDWRIGHT_MODE=desktop`                — LocalProcessHost
 *   • `BIDWRIGHT_MODE=server`,
 *     `BIDWRIGHT_MULTITENANT` unset/false     — LocalProcessHost
 *   • `BIDWRIGHT_MODE=server`,
 *     `BIDWRIGHT_MULTITENANT=true`            — LocalProcessHost (today;
 *                                                BubblewrappedHost in B1)
 *
 * The factory is intentionally simple: today every mode uses the same
 * implementation, but the seam exists so B1 can swap in `BubblewrappedHost`
 * for multi-tenant Docker without touching the spawn pipeline or any
 * adapter. The cloud sandbox tier (B4) plugs in a third host the same way.
 */

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
  // Placeholder for future selection; today every branch resolves to
  // LocalProcessHost. B1 replaces the multitenant branch with bubblewrap.
  if (isMultitenantServer()) {
    cached = localProcessHost;
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
