"use client";

/**
 * "My Credentials" page — per-user CLI auth + API key management.
 *
 * Each row corresponds to an agent runtime (Claude, Codex, OpenRouter,
 * OpenCode, Gemini). Server deployments default to organization-managed API keys.
 * Interactive OAuth remains an optional desktop-only capability.
 *
 * Resolution at spawn time is user-overrides → org defaults → env (handled
 * by `store.getEffectiveIntegrations(userId)` server-side). This page
 * doesn't have to re-implement the chain — it just writes user values.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@braedonsaunders/appkit-ui";
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
  openrouter: "openrouterKey",
  opencode: "anthropicKey",
  gemini: "geminiKey",
};

const RUNTIME_API_KEY_LABEL: Record<string, string> = {
  "claude-code": "Anthropic API key",
  codex: "OpenAI API key",
  openrouter: "OpenRouter API key",
  opencode: "Anthropic API key (OpenCode also accepts OpenAI / Google / OpenRouter)",
  gemini: "Google / Gemini API key",
};

const RUNTIME_API_KEY_PLACEHOLDER: Record<string, string> = {
  "claude-code": "sk-ant-…",
  codex: "sk-…",
  openrouter: "sk-or-…",
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
  const [interactiveLoginAvailable, setInteractiveLoginAvailable] = useState(false);
  const [deploymentMode, setDeploymentMode] = useState<"desktop" | "server">("desktop");

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
      setInteractiveLoginAvailable(detect.interactiveLoginAvailable);
      setDeploymentMode(detect.deploymentMode);
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
    <>
      <div className="space-y-6">
        <div>
          <h2 className="text-base font-semibold text-fg">Agent credentials</h2>
          <p className="mt-1 text-sm text-fg-muted">
            {interactiveLoginAvailable
              ? "Desktop mode can use your local interactive sign-in or a personal API key."
              : "Your organization manages the default OpenAI and Anthropic credentials. Personal API keys remain an optional override."}
          </p>
        </div>

        {message && (
          <Alert variant={message.kind === "ok" ? "success" : "destructive"}>
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}

        {loadError && (
          <Alert variant="destructive"><AlertDescription>{loadError}</AlertDescription></Alert>
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
                      <Badge variant="warning">
                        {deploymentMode === "server" ? "Unavailable" : "Not installed"}
                      </Badge>
                    ) : runtime.authenticated ? (
                      <Badge variant="success">
                        {deploymentMode === "server"
                          ? "Provider ready"
                          : `Auth: ${runtime.authMethod === "api_key" ? "API key" : runtime.authMethod}`}
                      </Badge>
                    ) : (
                      <Badge variant="warning">
                        {deploymentMode === "server" ? "Provider key required" : "Not signed in"}
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {!runtime.available ? (
                  <p className="text-xs text-fg/60">
                    {deploymentMode === "server"
                      ? "This runtime is not included in the current managed deployment."
                      : runtime.installHint}
                  </p>
                ) : null}

                {interactiveLoginAvailable && runtime.id !== "openrouter" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="default"
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
                      Opens a local terminal session and stores credentials in your desktop profile.
                    </span>
                  </div>
                ) : runtime.id === "openrouter" ? (
                  <Alert>
                    <AlertDescription>
                      OpenRouter uses API-key authentication. Add a personal key below or use the organization-managed default.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert>
                    <AlertDescription>
                      This managed runtime uses the organization provider key by default. A personal key below is an optional override for your own runs.
                    </AlertDescription>
                  </Alert>
                )}

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
              </CardContent>
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
    </>
  );
}
