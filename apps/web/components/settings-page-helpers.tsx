"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Eye, EyeOff, KeyRound, Loader2, Plus, Search, X } from "lucide-react";

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@appkit/ui";
import {
  Select,
} from "@/components/legacy-controls";
import { detectCli, listCliModels, type CliRuntimeStatus } from "@/lib/api";
import {
  testProviderKey,
  updateSettings,
  type AppSettingsRecord,
} from "@/lib/api/settings";
import { cn } from "@/lib/utils";

type AgentRuntime = string;
type AgentReasoningEffort = "auto" | "low" | "medium" | "high" | "extra_high" | "max";
type CliModelOption = {
  id: string;
  name: string;
  description: string;
  defaultReasoningEffort?: string | null;
  hidden?: boolean;
  isDefault?: boolean;
  supportedReasoningEfforts?: string[];
};

type DetectCliResult = {
  claude: CliRuntimeStatus;
  codex: CliRuntimeStatus;
  runtimes: Record<string, CliRuntimeStatus>;
  deploymentMode: "desktop" | "server";
  interactiveLoginAvailable: boolean;
  configured: { runtime: string | null; model: string | null };
};

type RuntimeProviderConfig = {
  provider: "anthropic" | "openai" | "openrouter" | "gemini";
  label: string;
  apiField: "anthropicKey" | "openaiKey" | "openrouterKey" | "geminiKey";
  uiField: "anthropicApiKey" | "openaiApiKey" | "openrouterApiKey" | "geminiApiKey";
  placeholder: string;
};

const RUNTIME_PROVIDER_CONFIG: Record<string, RuntimeProviderConfig> = {
  "claude-code": {
    provider: "anthropic",
    label: "Anthropic API key",
    apiField: "anthropicKey",
    uiField: "anthropicApiKey",
    placeholder: "sk-ant-…",
  },
  codex: {
    provider: "openai",
    label: "OpenAI API key",
    apiField: "openaiKey",
    uiField: "openaiApiKey",
    placeholder: "sk-…",
  },
  openrouter: {
    provider: "openrouter",
    label: "OpenRouter API key",
    apiField: "openrouterKey",
    uiField: "openrouterApiKey",
    placeholder: "sk-or-…",
  },
  opencode: {
    provider: "anthropic",
    label: "Anthropic API key",
    apiField: "anthropicKey",
    uiField: "anthropicApiKey",
    placeholder: "sk-ant-…",
  },
  gemini: {
    provider: "gemini",
    label: "Google / Gemini API key",
    apiField: "geminiKey",
    uiField: "geminiApiKey",
    placeholder: "AIza…",
  },
};

const REASONING_EFFORT_OPTIONS: Array<{
  value: AgentReasoningEffort;
  label: string;
  description: string;
}> = [
  { value: "auto", label: "Auto", description: "Use the runtime default for the active model" },
  { value: "low", label: "Low", description: "Fastest, lightest reasoning" },
  { value: "medium", label: "Medium", description: "Balanced speed and depth" },
  { value: "high", label: "High", description: "Stronger reasoning with more compute" },
  { value: "extra_high", label: "Extra High", description: "Best default for difficult coding and agentic runs" },
  { value: "max", label: "Max", description: "Deepest available reasoning for the current runtime" },
];

function listRegisteredRuntimes(status: DetectCliResult | null): CliRuntimeStatus[] {
  if (!status?.runtimes) return [];
  return Object.values(status.runtimes);
}

function isAgentRuntime(value: unknown, status: DetectCliResult | null): value is AgentRuntime {
  if (typeof value !== "string" || !value) return false;
  if (!status?.runtimes) {
    // Fall back to known legacy ids while detection is still loading.
    return value === "claude-code" || value === "codex" || value === "openrouter" || value === "opencode" || value === "gemini";
  }
  return value in status.runtimes;
}

function normalizeAgentReasoningEffort(value: unknown): AgentReasoningEffort {
  if (value === "auto" || value === "low" || value === "medium" || value === "high" || value === "extra_high" || value === "max") {
    return value;
  }
  return "extra_high";
}

function getAutoRuntime(status: DetectCliResult | null): AgentRuntime | null {
  // Prefer non-experimental adapters that are installed; fall back to any
  // installed adapter if only experimental ones are around.
  const runtimes = listRegisteredRuntimes(status);
  const stable = runtimes.find((r) => r.available && !r.experimental);
  if (stable) return stable.id;
  const any = runtimes.find((r) => r.available);
  return any ? any.id : null;
}

function getRuntimeStatus(runtime: AgentRuntime | null, status: DetectCliResult | null): CliRuntimeStatus | null {
  if (!runtime || !status?.runtimes) return null;
  return status.runtimes[runtime] ?? null;
}

function isCompatibleModel(runtime: AgentRuntime | null, model: string | null | undefined, status: DetectCliResult | null) {
  // Provider model catalogs change faster than the application. Preserve an
  // explicitly configured model even if a stale or unauthenticated catalog
  // response does not contain it yet.
  void runtime;
  void model;
  void status;
  return true;
}

function getRuntimeCliPath(runtime: AgentRuntime | null, integrations: Record<string, any>, status: DetectCliResult | null): string {
  if (!runtime) return "";
  const r = getRuntimeStatus(runtime, status);
  if (!r) return "";
  const value = integrations[r.pathSettingKey];
  return typeof value === "string" ? value : "";
}

export function SearchableModelSelect({
  value,
  onChange,
  models,
  loading,
  placeholder = "Select a model...",
}: {
  value: string;
  onChange: (v: string) => void;
  models: { id: string; name: string }[];
  loading: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = useMemo(
    () =>
      models.filter(
        (m) =>
          m.id.toLowerCase().includes(search.toLowerCase()) ||
          m.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [models, search],
  );

  const selected = models.find((m) => m.id === value) ?? (value ? { id: value, name: value } : undefined);
  const customModel = search.trim();
  const canUseCustomModel = !!customModel && !models.some((model) => model.id === customModel);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(!open); setTimeout(() => inputRef.current?.focus(), 0); }}
        className={cn(
          "w-full flex items-center justify-between rounded-lg border border-line bg-panel px-3 py-2 text-xs text-fg transition-colors hover:border-accent focus:outline-none focus:ring-1 focus:ring-accent",
          open && "border-accent ring-1 ring-accent",
        )}
      >
        <span className={selected ? "text-fg" : "text-fg/40"}>
          {loading ? "Loading models..." : selected ? selected.name : placeholder}
        </span>
        <ChevronDown className={cn("h-3 w-3 text-fg/40 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-line bg-panel shadow-lg">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <Search className="h-3 w-3 text-fg/40 shrink-0" />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models..."
              className="flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg/30"
            />
          </div>
          <div className="max-h-56 overflow-y-auto overscroll-contain">
            {loading ? (
              <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-fg/40">
                <Loader2 className="h-3 w-3 animate-spin" /> Fetching models...
              </div>
            ) : filtered.length === 0 && !canUseCustomModel ? (
              <div className="px-3 py-4 text-center text-xs text-fg/40">
                {models.length === 0 ? "Add the provider key below to load its model catalog" : "No models match your search"}
              </div>
            ) : (
              <>
                {filtered.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => { onChange(m.id); setOpen(false); setSearch(""); }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent/10",
                      m.id === value && "bg-accent/5 text-accent",
                    )}
                  >
                    {m.id === value && <Check className="h-3 w-3 shrink-0 text-accent" />}
                    <div className={m.id === value ? "" : "pl-5"}>
                      <div className="font-medium">{m.name}</div>
                      {m.name !== m.id && <div className="text-[10px] text-fg/30">{m.id}</div>}
                    </div>
                  </button>
                ))}
                {canUseCustomModel && (
                  <button
                    type="button"
                    onClick={() => { onChange(customModel); setOpen(false); setSearch(""); }}
                    className="flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-xs text-accent transition-colors hover:bg-accent/10"
                  >
                    <Plus className="h-3 w-3 shrink-0" />
                    Use exact model ID “{customModel}”
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function TagInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState("");
  const add = () => {
    const trimmed = input.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInput("");
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {values.map((v, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-0.5 text-xs text-accent">
            {v}
            <button onClick={() => onChange(values.filter((_, j) => j !== i))} className="hover:text-danger">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={placeholder}
          className="flex-1"
        />
        <Button variant="secondary" size="sm" onClick={add} disabled={!input.trim()}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-8 cursor-pointer rounded border border-line"
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="#000000" className="flex-1" />
      </div>
    </div>
  );
}

export function AgentRuntimeSettings({
  settings,
  onUpdate,
  onUpdateDefaults,
}: {
  settings: { integrations: Record<string, any>; defaults: Record<string, any> };
  onUpdate: (patch: Record<string, any>) => void;
  onUpdateDefaults: (patch: Record<string, any>) => void;
}) {
  const [cliStatus, setCliStatus] = useState<DetectCliResult | null>(null);
  const [detecting, setDetecting] = useState(true);
  const [liveModels, setLiveModels] = useState<Record<string, CliModelOption[]>>({});
  const [modelsLoading, setModelsLoading] = useState(false);
  const [debouncedCliPath, setDebouncedCliPath] = useState("");
  const [providerKeyDraft, setProviderKeyDraft] = useState("");
  const [showProviderKey, setShowProviderKey] = useState(false);
  const [savingProviderKey, setSavingProviderKey] = useState(false);
  const [providerKeyMessage, setProviderKeyMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const isServerMode = cliStatus?.deploymentMode === "server";

  const refreshDetection = useCallback(async () => {
    setDetecting(true);
    try {
      const nextStatus = await detectCli() as DetectCliResult;
      setCliStatus(nextStatus);
      const initialModels: Record<string, CliModelOption[]> = {};
      for (const [runtimeId, runtime] of Object.entries(nextStatus.runtimes || {})) {
        initialModels[runtimeId] = runtime.models || [];
      }
      setLiveModels(initialModels);
    } catch {
      setCliStatus(null);
    } finally {
      setDetecting(false);
    }
  }, []);

  useEffect(() => {
    void refreshDetection();
  }, [refreshDetection]);

  const registeredRuntimes = listRegisteredRuntimes(cliStatus);
  const currentRuntime = isAgentRuntime(settings.integrations.agentRuntime, cliStatus)
    ? (settings.integrations.agentRuntime as string)
    : isAgentRuntime(cliStatus?.configured?.runtime, cliStatus)
      ? (cliStatus!.configured.runtime as string)
      : "";
  const effectiveRuntime = currentRuntime || getAutoRuntime(cliStatus);
  const effectiveRuntimeStatus = getRuntimeStatus(effectiveRuntime, cliStatus);
  const rawCurrentModel = settings.integrations.agentModel || cliStatus?.configured?.model || "";
  const currentModel = isCompatibleModel(effectiveRuntime, rawCurrentModel, cliStatus) ? rawCurrentModel : "";
  const reasoningEffort = normalizeAgentReasoningEffort(settings.integrations.agentReasoningEffort);
  const selectedCliPath = getRuntimeCliPath(effectiveRuntime, settings.integrations, cliStatus);
  const providerConfig = effectiveRuntime ? RUNTIME_PROVIDER_CONFIG[effectiveRuntime] : undefined;

  useEffect(() => {
    setProviderKeyDraft("");
    setShowProviderKey(false);
    setProviderKeyMessage(null);
  }, [providerConfig?.provider]);

  const saveProviderKey = useCallback(async () => {
    if (!providerConfig) return;
    const apiKey = providerKeyDraft.trim();
    if (!apiKey) {
      setProviderKeyMessage({ ok: false, text: `Enter the ${providerConfig.label} first.` });
      return;
    }
    setSavingProviderKey(true);
    setProviderKeyMessage(null);
    try {
      await testProviderKey(providerConfig.provider, apiKey);
      await updateSettings({
        integrations: {
          [providerConfig.apiField]: apiKey,
        } as unknown as AppSettingsRecord["integrations"],
      });
      onUpdate({ [providerConfig.uiField]: apiKey });
      setProviderKeyDraft("");
      setProviderKeyMessage({
        ok: true,
        text: `${providerConfig.label} verified and saved for the organization.`,
      });
      await refreshDetection();
      if (effectiveRuntime) {
        const result = await listCliModels(effectiveRuntime);
        setLiveModels((prev) => ({ ...prev, [effectiveRuntime]: result.models || [] }));
      }
    } catch (error) {
      setProviderKeyMessage({
        ok: false,
        text: error instanceof Error ? error.message : `Could not verify the ${providerConfig.label}.`,
      });
    } finally {
      setSavingProviderKey(false);
    }
  }, [effectiveRuntime, onUpdate, providerConfig, providerKeyDraft, refreshDetection]);

  const clearProviderKey = useCallback(async () => {
    if (!providerConfig) return;
    setSavingProviderKey(true);
    setProviderKeyMessage(null);
    try {
      await updateSettings({
        integrations: {
          [providerConfig.apiField]: "",
        } as unknown as AppSettingsRecord["integrations"],
      });
      onUpdate({ [providerConfig.uiField]: "" });
      setProviderKeyDraft("");
      setProviderKeyMessage({
        ok: true,
        text: `${providerConfig.label} cleared for the organization.`,
      });
      await refreshDetection();
    } catch (error) {
      setProviderKeyMessage({
        ok: false,
        text: error instanceof Error ? error.message : `Could not clear the ${providerConfig.label}.`,
      });
    } finally {
      setSavingProviderKey(false);
    }
  }, [onUpdate, providerConfig, refreshDetection]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedCliPath(selectedCliPath);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [selectedCliPath]);

  useEffect(() => {
    if (!effectiveRuntime) return;
    const runtimeAvailable = !!effectiveRuntimeStatus?.available;
    if (!runtimeAvailable) return;

    let active = true;
    let pollingTimer: number | null = null;

    const pollRuntimeModels = async () => {
      setModelsLoading(true);
      try {
        const result = await listCliModels(effectiveRuntime, debouncedCliPath);
        if (!active) return;
        const models = result.models || [];
        setLiveModels((prev) => ({ ...prev, [effectiveRuntime]: models }));
        setCliStatus((prev) => {
          if (!prev) return prev;
          const existing = prev.runtimes?.[effectiveRuntime];
          if (!existing) return prev;
          return {
            ...prev,
            runtimes: { ...prev.runtimes, [effectiveRuntime]: { ...existing, models } },
            ...(effectiveRuntime === "claude-code"
              ? { claude: { ...prev.claude, models } as CliRuntimeStatus }
              : {}),
            ...(effectiveRuntime === "codex"
              ? { codex: { ...prev.codex, models } as CliRuntimeStatus }
              : {}),
          };
        });
      } catch {
        // Keep the most recent successful model list visible.
      } finally {
        if (active) setModelsLoading(false);
      }
    };

    void pollRuntimeModels();
    pollingTimer = window.setInterval(() => {
      void pollRuntimeModels();
    }, 30000);

    return () => {
      active = false;
      if (pollingTimer != null) window.clearInterval(pollingTimer);
    };
  }, [effectiveRuntime, effectiveRuntimeStatus?.available, debouncedCliPath]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent Runtime</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-fg-muted">
          {isServerMode
            ? "Choose the centrally managed runtime used for estimating and project questions. Enter and verify the organization provider credential directly below; users do not install or sign in to local tools."
            : "Choose the local runtime used for estimating and project questions on this desktop."}
        </p>
        <div className="rounded-lg border border-line p-4 space-y-3">
          <h4 className="text-xs font-semibold text-fg/60 uppercase tracking-wider">
            {isServerMode ? "Managed runtimes" : "Detected CLIs"}
          </h4>
          {detecting ? (
            <div className="text-xs text-fg/40">
              {isServerMode ? "Checking managed runtimes..." : "Detecting installed CLIs..."}
            </div>
          ) : registeredRuntimes.length === 0 ? (
            <div className="text-xs text-fg/40">No agent runtimes are registered.</div>
          ) : (
            <div className="space-y-2">
              {registeredRuntimes.map((runtime) => (
                <div key={runtime.id} className="flex items-center justify-between rounded-md border border-line px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${runtime.available ? "bg-success" : "bg-fg/20"}`} />
                    <span className="text-sm font-medium">{runtime.displayName}</span>
                    {runtime.experimental && (
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-warning/10 text-warning">
                        Beta
                      </span>
                    )}
                    {runtime.version && (
                      <span className="text-[10px] text-fg/30">{runtime.version}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {runtime.available ? (
                      <>
                        {!isServerMode && (
                          <span className="text-[10px] text-fg/40">{runtime.path}</span>
                        )}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${runtime.auth?.authenticated ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                          {runtime.auth?.authenticated
                            ? isServerMode
                              ? "Provider ready"
                              : `Auth: ${runtime.auth.method}`
                            : isServerMode
                              ? "Provider key required"
                              : "Not authenticated"}
                        </span>
                      </>
                    ) : (
                      <span className="text-[10px] text-fg/30">
                        {isServerMode ? "Unavailable in this deployment" : runtime.installHint}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <Label>Preferred Runtime</Label>
          <Select
            value={currentRuntime || "__auto__"}
            onValueChange={(v) => {
              const raw = v === "__auto__" ? "" : v;
              const nextRuntime = isAgentRuntime(raw, cliStatus) ? raw : null;
              const nextEffectiveRuntime = nextRuntime ?? getAutoRuntime(cliStatus);
              onUpdate({
                agentRuntime: nextRuntime,
                agentModel: isCompatibleModel(nextEffectiveRuntime, rawCurrentModel, cliStatus) ? rawCurrentModel : null,
              });
            }}
            options={[
              {
                value: "__auto__",
                label: isServerMode ? "Automatic (best available)" : "Auto-detect (best available)",
              },
              ...registeredRuntimes.map((runtime) => ({
                value: runtime.id,
                label: `${runtime.displayName}${runtime.experimental ? " (Beta)" : ""}${!runtime.available ? (isServerMode ? " (unavailable)" : " (not installed)") : ""}`,
                disabled: !runtime.available,
              })),
            ]}
          />
        </div>

        {providerConfig && (
          <div className="rounded-lg border border-line bg-panel2/30 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-accent" />
                  <Label>{providerConfig.label}</Label>
                </div>
                <p className="mt-1 text-[11px] text-fg/45">
                  Primary organization credential for {effectiveRuntimeStatus?.displayName ?? effectiveRuntime}.
                  It is encrypted at rest and used by managed agent runs.
                </p>
              </div>
              <span className={cn(
                "shrink-0 rounded px-2 py-1 text-[10px]",
                effectiveRuntimeStatus?.auth?.authenticated
                  ? "bg-success/10 text-success"
                  : "bg-warning/10 text-warning",
              )}>
                {effectiveRuntimeStatus?.auth?.authenticated ? "Credential ready" : "Required"}
              </span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Input
                  type={showProviderKey ? "text" : "password"}
                  value={providerKeyDraft}
                  onChange={(event) => setProviderKeyDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void saveProviderKey();
                    }
                  }}
                  placeholder={
                    effectiveRuntimeStatus?.auth?.authenticated
                      ? "Credential configured — enter a replacement"
                      : providerConfig.placeholder
                  }
                  autoComplete="new-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowProviderKey((value) => !value)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg/40 hover:text-fg"
                  aria-label={showProviderKey ? "Hide API key" : "Show API key"}
                >
                  {showProviderKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                type="button"
                onClick={() => void saveProviderKey()}
                disabled={savingProviderKey || !providerKeyDraft.trim()}
              >
                {savingProviderKey && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                Verify & save
              </Button>
              {effectiveRuntimeStatus?.auth?.authenticated && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void clearProviderKey()}
                  disabled={savingProviderKey}
                >
                  Clear
                </Button>
              )}
            </div>
            {providerKeyMessage && (
              <p className={cn(
                "text-xs",
                providerKeyMessage.ok ? "text-success" : "text-danger",
              )}>
                {providerKeyMessage.text}
              </p>
            )}
          </div>
        )}

        <div>
          <Label>Model</Label>
          {(() => {
            const models = effectiveRuntime ? liveModels[effectiveRuntime] || [] : [];
            const displayModels = models.filter((model, index) => models.findIndex((candidate) => candidate.id === model.id) === index);
            return (
              <SearchableModelSelect
                value={currentModel}
                onChange={(value) => onUpdate({ agentModel: value || null })}
                models={displayModels}
                loading={modelsLoading}
                placeholder="Default"
              />
            );
          })()}
          <p className="text-[10px] text-fg/30 mt-1.5">
            {isServerMode
              ? "Models are loaded from the selected managed runtime and provider."
              : "Models are polled directly from the selected CLI on load and refreshed while this page is open."}
            {modelsLoading && effectiveRuntime ? ` Refreshing ${effectiveRuntime}...` : ""}
          </p>
        </div>

        <div>
          <Label>Reasoning Effort</Label>
          <Select
            value={reasoningEffort}
            onValueChange={(v) => onUpdate({ agentReasoningEffort: v || "extra_high" })}
            options={REASONING_EFFORT_OPTIONS.map((option) => ({
              value: option.value,
              label: `${option.label} - ${option.description}`,
            }))}
          />
          <p className="text-[10px] text-fg/30 mt-1.5">`Extra High` maps to `xhigh` for Codex and the strongest supported non-max level for Claude when a model does not support `xhigh`.</p>
        </div>

        {!isServerMode && (
          <div>
            <Label>CLI Path Override (optional)</Label>
            <Input
              type="text"
              placeholder={effectiveRuntimeStatus?.path || "/usr/local/bin/<cli>"}
              value={effectiveRuntimeStatus
                ? (settings.integrations[effectiveRuntimeStatus.pathSettingKey] || "")
                : ""}
              onChange={(e) => {
                if (!effectiveRuntimeStatus) return;
                onUpdate({ [effectiveRuntimeStatus.pathSettingKey]: e.target.value || null });
              }}
              disabled={!effectiveRuntimeStatus}
            />
            <p className="text-[10px] text-fg/30 mt-1.5">Leave blank to use auto-detected path. Override if the CLI is installed in a custom location.</p>
          </div>
        )}

        <div>
          <Label>Max Agent Iterations</Label>
          <Input
            type="number"
            value={settings.defaults.maxAgentIterations ?? 200}
            onChange={(e) => onUpdateDefaults({ maxAgentIterations: parseInt(e.target.value) || 200 })}
            placeholder="200"
            min={10}
            max={1000}
          />
          <p className="mt-1 text-[11px] text-fg/40">Maximum tool call iterations for AI estimating runs</p>
        </div>

        <div>
          <Label>Max Concurrent Sub-Agents</Label>
          <Select
            value={String(settings.integrations.maxConcurrentSubAgents ?? 2)}
            onValueChange={(v) => onUpdate({ maxConcurrentSubAgents: parseInt(v) })}
            options={[
              { value: "1", label: "1 — Sequential (safest, slowest)" },
              { value: "2", label: "2 — Recommended" },
              { value: "3", label: "3 — Faster, higher rate limit risk" },
              { value: "5", label: "5 — Aggressive (may hit API rate limits)" },
            ]}
          />
          <p className="mt-1 text-[11px] text-fg/40">How many worksheet sub-agents the AI runs in parallel. Lower values avoid Anthropic API rate limit errors; higher values finish faster.</p>
        </div>

        <div className="rounded-lg border border-line/50 bg-panel2/30 p-3 text-xs text-fg/40 space-y-1">
          <p className="font-medium text-fg/50">{isServerMode ? "Managed authentication" : "Authentication"}</p>
          {isServerMode ? (
            <>
              <p>
                The organization credential above is used for every managed agent run.
                It is encrypted at rest and never exposed to estimators.
              </p>
              <p>
                No local CLI installation, copied OAuth session, or browser sign-in is required.
              </p>
            </>
          ) : (
            <>
              <p>
                Each estimator can sign in to a local runtime or paste a personal API key on the{' '}
                <a href="/profile/credentials" className="underline-offset-4 hover:underline text-fg/60">My credentials</a>{' '}
                page.
              </p>
              <p>API keys configured in AI Providers are used as the organization fallback.</p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
