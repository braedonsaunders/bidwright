/**
 * Per-user CLI auth namespace resolver.
 *
 * Bidwright runs in two deployment modes:
 *   • desktop  — single-user Electron / `pnpm dev` shell. Each CLI uses the
 *                operator's own `~/.claude`, `~/.codex`, etc. on the host.
 *                There is no isolation problem because there is one user.
 *   • server   — multi-tenant Docker (self-host or hosted SaaS). Multiple
 *                authenticated users share one container. Each user gets a
 *                private runtime-state home; organization-managed provider
 *                API keys are the default server credential.
 *
 * In server mode this resolver returns `<AGENT_HOME_ROOT>/users/<userId>`
 * (default `/data/agent-home/users/<userId>`). The CLI adapters bind that
 * dir into the spawned process via `CLAUDE_CONFIG_DIR`, `CODEX_HOME`,
 * `XDG_DATA_HOME`, etc. so each child sees its own auth state.
 *
 * In desktop mode this resolver returns `null` and adapters fall through
 * to their current OS-default lookup (`~/.claude/`, `~/.codex/`, …).
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export type BidwrightMode = "desktop" | "server";

/**
 * Read the deployment mode. Development defaults to desktop; production
 * defaults to server so a missing flag fails toward process isolation.
 * The desktop shell and production Docker images both set the mode explicitly.
 */
export function getBidwrightMode(): BidwrightMode {
  const raw = (process.env.BIDWRIGHT_MODE || "").trim().toLowerCase();
  if (raw === "server" || raw === "desktop") return raw;
  // A production service must fail toward isolation if an operator forgets
  // the deployment flag. The desktop shell sets `desktop` explicitly.
  return process.env.NODE_ENV === "production" ? "server" : "desktop";
}

/**
 * Root dir under which per-user agent-home dirs live. Production Docker
 * mounts a host volume at `/data/agent-home`; self-host can override via env.
 */
export function getAgentHomeRoot(): string {
  return (process.env.AGENT_HOME_ROOT || "/data/agent-home").trim();
}

/**
 * Path to the per-user agent-home dir for `userId`, or `null` when running
 * in desktop mode (where the host user's own `~/.claude` etc. should win).
 */
export function getUserAgentHome(userId: string | null | undefined): string | null {
  if (!userId) return null;
  if (getBidwrightMode() !== "server") return null;
  return join(getAgentHomeRoot(), "users", userId);
}

/**
 * Like {@link getUserAgentHome} but also creates the dir on first use so
 * adapters can blindly write `<dir>/.claude/.credentials.json` etc. without
 * worrying about parent existence.
 */
export async function ensureUserAgentHome(
  userId: string | null | undefined,
): Promise<string | null> {
  const dir = getUserAgentHome(userId);
  if (!dir) return null;
  await mkdir(dir, { recursive: true });
  return dir;
}
