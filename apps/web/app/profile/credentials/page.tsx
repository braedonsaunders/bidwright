"use client";

/**
 * "My Credentials" page — per-user CLI auth + API key management.
 *
 * Each row corresponds to a CLI runtime (Claude Code, Codex, OpenCode,
 * Gemini). The user can:
 *   • Sign in with the runtime's interactive OAuth flow (PTY modal)
 *   • Paste a personal API key for the relevant provider
 *   • Clear their personal value (falls through to the org default)
 *
 * Resolution at spawn time is user-overrides → org defaults → env (handled
 * by `store.getEffectiveIntegrations(userId)` server-side). This page
 * doesn't have to re-implement the chain — it just writes user values.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@/components/ui";
import { AppShell } from "@/components/app-shell";
import { CliLoginModal } from "@/components/cli-login-modal";
import { detectCli, type CliRuntimeStatus } from "@/lib/api";
import {
  getUserSettings,
  updateUserSettings,
  type UserSettingsRecord,
} from "@/lib/api/settings";

interface RuntimeRow {
  id: string;
  displayName: string;
  installHint: string;
  available: boolean;
  authMethod: string;
  authenticated: boolean;
  /** Provider whose API key the user can paste alongside OAuth — e.g.
   *  Claude Code's API-key fallback writes to `anthropicKey`. */
  apiKeyField: keyof UserSettingsRecord["integrations"];
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
}

const RUNTIME_API_KEY_FIELD: Record<string, RuntimeRow["apiKeyField"]> = {
  "claude-code": "anthropicKey",
  codex: "openaiKey",
  opencode: "anthropicKey",
  gemini: "geminiKey",
};

const RUNTIME_API_KEY_LABEL: Record<string, string> = {
  "claude-code": "Anthropic API key",
  codex: "OpenAI API key",
  opencode: "Anthropic API key (OpenCode also accepts OpenAI / Google / OpenRouter)",
  gemini: "Google / Gemini API key",
};

const RUNTIME_API_KEY_PLACEHOLDER: Record<string, string> = {
  "claude-code": "sk-ant-…",
  codex: "sk-…",
  opencode: "sk-ant-…",
  gemini: "AIza…",
};

export default function MyCredentialsPage() {
  const [runtimes, setRuntimes] = useState<RuntimeRow[] | null>(null);
  const [userSettings, setUserSettings] = useState<UserSettingsRecord | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingFor, setSavingFor] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [loginModal, setLoginModal] = useState<{ runtime: string; label: string } | null>(null);
  const [pendingKeys, setPendingKeys] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const [detect, mySettings] = await Promise.all([detectCli(), getUserSettings()]);
      const list: RuntimeRow[] = Object.values(detect.runtimes ?? {}).map((r: CliRuntimeStatus) => ({
        id: r.id,
        displayName: r.displayName,
        installHint: r.installHint,
        available: r.available,
        authMethod: r.auth?.method ?? "none",
        authenticated: !!r.auth?.authenticated,
        apiKeyField: RUNTIME_API_KEY_FIELD[r.id] ?? "anthropicKey",
        apiKeyLabel: RUNTIME_API_KEY_LABEL[r.id] ?? "Provider API key",
        apiKeyPlaceholder: RUNTIME_API_KEY_PLACEHOLDER[r.id] ?? "",
      }));
      list.sort((a, b) => a.displayName.localeCompare(b.displayName));
      setRuntimes(list);
      setUserSettings(mySettings);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load credentials");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const writeApiKey = useCallback(
    async (runtime: RuntimeRow, value: string) => {
      setSavingFor(runtime.id);
      setMessage(null);
      try {
        const next = await updateUserSettings({
          integrations: { [runtime.apiKeyField]: value } as UserSettingsRecord["integrations"],
        });
        setUserSettings(next);
        setPendingKeys((prev) => {
          const out = { ...prev };
          delete out[runtime.id];
          return out;
        });
        setMessage({
          kind: "ok",
          text: value
            ? `Saved your personal ${runtime.displayName} key. The agent will use it on your next session.`
            : `Cleared your personal ${runtime.displayName} key. The agent will fall back to the org default.`,
        });
        await refresh();
      } catch (err) {
        setMessage({
          kind: "err",
          text: err instanceof Error ? err.message : "Failed to save",
        });
      } finally {
        setSavingFor(null);
      }
    },
    [refresh],
  );

  const handleLoginClosed = useCallback(
    async (result: { completed: boolean }) => {
      setLoginModal(null);
      if (result.completed) {
        setMessage({ kind: "ok", text: "Signed in successfully — credentials are stored in your private namespace." });
      }
      // Always refresh so the auth status pill reflects the latest state,
      // even if the user closed without completing.
      await refresh();
    },
    [refresh],
  );

  const userIntegrations = userSettings?.integrations ?? {};

  const cards = useMemo(() => runtimes ?? [], [runtimes]);

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-fg">My credentials</h1>
            <p className="mt-1 text-sm text-fg/60">
              Sign in to a CLI runtime with your own subscription, or paste a personal API key.
              These values override the organization defaults whenever they're set.
            </p>
          </div>
          <Link href="/profile" className="text-xs text-fg/60 hover:text-fg underline-offset-4 hover:underline">
            ← Back to profile
          </Link>
        </div>

        {message && (
          <div
            className={`rounded-lg border px-4 py-2 text-sm ${
              message.kind === "ok"
                ? "border-success/30 bg-success/10 text-success"
                : "border-danger/30 bg-danger/10 text-danger"
            }`}
          >
            {message.text}
          </div>
        )}

        {loadError && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
            {loadError}
          </div>
        )}

        {!runtimes && !loadError && (
          <div className="rounded-lg border border-line bg-panel px-4 py-8 text-center text-sm text-fg/60">
            Loading…
          </div>
        )}

        {cards.map((runtime) => {
          const userKeyValue = (userIntegrations[runtime.apiKeyField] as string | undefined) ?? "";
          const pending = pendingKeys[runtime.id];
          const draftValue = pending !== undefined ? pending : userKeyValue;
          const dirty = draftValue !== userKeyValue;

          return (
            <Card key={runtime.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>{runtime.displayName}</CardTitle>
                  <div className="flex items-center gap-2">
                    {!runtime.available ? (
                      <Badge tone="warning">Not installed</Badge>
                    ) : runtime.authenticated ? (
                      <Badge tone="success">
                        Auth: {runtime.authMethod === "api_key" ? "API key" : runtime.authMethod}
                      </Badge>
                    ) : (
                      <Badge tone="warning">Not signed in</Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardBody className="space-y-4">
                {!runtime.available ? (
                  <p className="text-xs text-fg/60">{runtime.installHint}</p>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="accent"
                    size="sm"
                    disabled={!runtime.available}
                    onClick={() =>
                      setLoginModal({ runtime: runtime.id, label: runtime.displayName })
                    }
                  >
                    {runtime.authenticated && runtime.authMethod !== "api_key"
                      ? "Re-authenticate"
                      : `Sign in with ${runtime.displayName}`}
                  </Button>
                  <span className="text-[11px] text-fg/50">
                    Opens a terminal session. Credentials are stored in your private namespace
                    on this server, scoped to your account only.
                  </span>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`apikey-${runtime.id}`}>{runtime.apiKeyLabel}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`apikey-${runtime.id}`}
                      type="password"
                      value={draftValue}
                      onChange={(e) =>
                        setPendingKeys((prev) => ({ ...prev, [runtime.id]: e.target.value }))
                      }
                      placeholder={runtime.apiKeyPlaceholder}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <Button
                      variant="default"
                      size="sm"
                      disabled={savingFor === runtime.id || !dirty}
                      onClick={() => void writeApiKey(runtime, draftValue.trim())}
                    >
                      {savingFor === runtime.id ? "Saving…" : "Save"}
                    </Button>
                    {userKeyValue ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={savingFor === runtime.id}
                        onClick={() => void writeApiKey(runtime, "")}
                      >
                        Clear
                      </Button>
                    ) : null}
                  </div>
                  <p className="text-[11px] text-fg/50">
                    {userKeyValue
                      ? "Your personal key is set — it overrides the organization default."
                      : "No personal key. The agent will use the organization default if one is configured."}
                  </p>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {loginModal ? (
        <CliLoginModal
          open
          runtime={loginModal.runtime}
          runtimeLabel={loginModal.label}
          onClose={handleLoginClosed}
        />
      ) : null}
    </AppShell>
  );
}
