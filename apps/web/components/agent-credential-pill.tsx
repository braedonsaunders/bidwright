"use client";

/**
 * Compact pill that surfaces *which* credential is driving the next agent
 * spawn. Lives in the agent drawer header / chat input area so the user
 * can tell at a glance whether they're about to bill against their own
 * Claude Pro subscription, their personal Anthropic API key, or the
 * org-wide default — and switch between them without leaving the flow.
 *
 * The truth is the GET /user/settings/effective endpoint: for each
 * (provider, kind) slot it returns whether the resolved credential came
 * from the user, the organization, or nowhere. This component renders a
 * single line summarizing the slot the active runtime cares about
 * (Anthropic for Claude Code / OpenCode-on-Anthropic, OpenAI for Codex,
 * Google for Gemini) so the message stays short.
 */

import { useEffect, useState } from "react";
import { ChevronDown, KeyRound, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { getEffectiveCredentialSources } from "@/lib/api/settings";

export interface AgentCredentialPillProps {
  /** The CLI runtime that's about to be spawned. Determines which provider
   *  slot we summarize. */
  runtime: string;
  /** Optional click handler — typically opens the My Credentials page or a
   *  small popover that lets the user toggle "use my OAuth" / "use my key" /
   *  "use org default". The pill renders as a button when set. */
  onClick?: () => void;
  className?: string;
}

interface SlotInfo {
  provider: "anthropic" | "openai" | "google" | "openrouter";
  label: string;
}

function slotForRuntime(runtime: string): SlotInfo {
  switch (runtime) {
    case "claude-code":
      return { provider: "anthropic", label: "Claude" };
    case "codex":
      return { provider: "openai", label: "Codex" };
    case "gemini":
      return { provider: "google", label: "Gemini" };
    case "opencode":
    default:
      return { provider: "anthropic", label: runtime === "opencode" ? "OpenCode" : runtime };
  }
}

interface ResolvedSlot {
  source: "user" | "organization" | "none";
  kind: "api_key" | "oauth" | null;
}

function pickSlot(
  sources: Record<string, { source: "user" | "organization" | "none"; kind: "api_key" | "oauth" | null }>,
  provider: SlotInfo["provider"],
): ResolvedSlot {
  // Prefer OAuth over API key when both are available — that's the order
  // the spawn pipeline actually uses (subscription billing first).
  const oauth = sources[`${provider}.oauth`];
  if (oauth && oauth.source !== "none") return oauth;
  const apiKey = sources[`${provider}.api_key`];
  if (apiKey && apiKey.source !== "none") return apiKey;
  return { source: "none", kind: null };
}

function describeSlot(slot: ResolvedSlot, label: string): string {
  if (slot.source === "none") return `No ${label} credential — sign in or add an API key`;
  const verb = slot.kind === "oauth" ? "OAuth" : "API key";
  if (slot.source === "user") return `Using your ${label} ${verb}`;
  return `Using org ${label} ${verb}`;
}

export function AgentCredentialPill({ runtime, onClick, className }: AgentCredentialPillProps) {
  const [slot, setSlot] = useState<ResolvedSlot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void getEffectiveCredentialSources()
      .then((res) => {
        if (cancelled) return;
        const info = slotForRuntime(runtime);
        setSlot(pickSlot(res.sources, info.provider));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not resolve credential source");
      });
    return () => {
      cancelled = true;
    };
  }, [runtime]);

  const info = slotForRuntime(runtime);

  const tone = (() => {
    if (error) return "border-warning/30 bg-warning/10 text-warning";
    if (!slot || slot.source === "none") return "border-warning/30 bg-warning/10 text-warning";
    if (slot.source === "user") {
      return slot.kind === "oauth"
        ? "border-success/30 bg-success/10 text-success"
        : "border-accent/30 bg-accent/10 text-accent";
    }
    return "border-fg/15 bg-panel2 text-fg/70";
  })();

  const Icon = !slot || slot.source === "none" || error ? KeyRound : ShieldCheck;

  const text = error
    ? "Credential check failed"
    : slot
      ? describeSlot(slot, info.label)
      : "Resolving credential…";

  const Component = onClick ? "button" : "div";
  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 truncate rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
        tone,
        onClick ? "cursor-pointer hover:opacity-80" : "",
        className,
      )}
      title={text}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{text}</span>
      {onClick ? <ChevronDown className="h-3 w-3 shrink-0 opacity-60" aria-hidden /> : null}
    </Component>
  );
}
