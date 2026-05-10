/**
 * Lifecycle glue for the egress allowlist proxy.
 *
 * Multi-tenant server mode runs the proxy as a sidecar inside the api
 * process: started once at boot, stopped on graceful shutdown. The
 * BubblewrappedHost reads the running instance to inject `HTTPS_PROXY`
 * env vars into every spawned CLI session so traffic is funneled through
 * the proxy and onto an explicit allowlist.
 *
 * Desktop / single-tenant deployments skip this entirely — the proxy
 * adds latency and a single point of failure for no isolation benefit
 * when there's only one user on the box.
 */

import { startEgressProxy, type RunningEgressProxy } from "./egress-proxy.js";

let runningProxy: RunningEgressProxy | null = null;

function isMultitenantServer(): boolean {
  if ((process.env.BIDWRIGHT_MODE || "").toLowerCase() !== "server") return false;
  const flag = (process.env.BIDWRIGHT_MULTITENANT || "").toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}

/**
 * Start the egress proxy if and only if we're in multi-tenant server
 * mode. Idempotent — safe to call multiple times. The shutdown hook is
 * registered once on first start.
 */
export async function ensureEgressProxyForMultitenant(opts: {
  apiBaseUrl: string;
}): Promise<RunningEgressProxy | null> {
  if (!isMultitenantServer()) return null;
  if (runningProxy) return runningProxy;
  const proxy = await startEgressProxy({ apiBaseUrl: opts.apiBaseUrl });
  runningProxy = proxy;
  // Best-effort graceful shutdown — flush logs and stop accepting new
  // connections so existing tunnels (in-flight LLM calls) finish.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      void proxy.close().catch(() => {});
    });
  }
  return proxy;
}

export function getRunningEgressProxy(): RunningEgressProxy | null {
  return runningProxy;
}
