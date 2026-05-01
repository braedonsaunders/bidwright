"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Plus, Search, X } from "lucide-react";

import { Button, Card, CardBody, CardHeader, CardTitle, Input, Label, Select } from "@/components/ui";
import { detectCli, listCliModels, type CliRuntimeStatus } from "@/lib/api";
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
  configured: { runtime: string | null; model: string | null };
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
    return value === "claude-code" || value === "codex" || value === "opencode" || value === "gemini";
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
  if (!runtime || !model) return true;
  const r = getRuntimeStatus(runtime, status);
  if (!r) return true;
  // If the server returned a model list, treat membership as the compat signal.
  // Otherwise (no list yet), accept anything — the server will normalize on use.
  if (r.models && r.models.length > 0) {
    return r.models.some((m) => m.id === model);
  }
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

  const selected = models.find((m) => m.id === value);

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
            ) : filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-fg/40">
                {models.length === 0 ? "Enter an API key and test connection to load models" : "No models match your search"}
              </div>
            ) : (
              filtered.map((m) => (
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
              ))
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

  useEffect(() => {
    setDetecting(true);
    detectCli()
      .then((result) => {
        const nextStatus = result as DetectCliResult;
        setCliStatus(nextStatus);
        const initialModels: Record<string, CliModelOption[]> = {};
        for (const [runtimeId, runtime] of Object.entries(nextStatus.runtimes || {})) {
          initialModels[runtimeId] = runtime.models || [];
        }
        setLiveModels(initialModels);
      })
      .catch(() => setCliStatus(null))
      .finally(() => setDetecting(false));
  }, []);

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
      <CardBody className="space-y-4">
        <div className="rounded-lg border border-line p-4 space-y-3">
          <h4 className="text-xs font-semibold text-fg/60 uppercase tracking-wider">Detected CLIs</h4>
          {detecting ? (
            <div className="text-xs text-fg/40">Detecting installed CLIs...</div>
          ) : registeredRuntimes.length === 0 ? (
            <div className="text-xs text-fg/40">No CLI runtimes registered.</div>
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
                        <span className="text-[10px] text-fg/40">{runtime.path}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${runtime.auth?.authenticated ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                          {runtime.auth?.authenticated ? `Auth: ${runtime.auth.method}` : "Not authenticated"}
                        </span>
                      </>
                    ) : (
                      <span className="text-[10px] text-fg/30">{runtime.installHint}</span>
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
              { value: "__auto__", label: "Auto-detect (best available)" },
              ...registeredRuntimes.map((runtime) => ({
                value: runtime.id,
                label: `${runtime.displayName}${runtime.experimental ? " (Beta)" : ""}${!runtime.available ? " (not installed)" : ""}`,
                disabled: !runtime.available,
              })),
            ]}
          />
        </div>

        <div>
          <Label>Model</Label>
          {(() => {
            const models = effectiveRuntime ? liveModels[effectiveRuntime] || [] : [];
            const displayModels = models.filter((model, index) => models.findIndex((candidate) => candidate.id === model.id) === index);
            return (
              <Select
                value={currentModel || "__default__"}
                onValueChange={(v) => onUpdate({ agentModel: v === "__default__" ? null : v })}
                options={[
                  { value: "__default__", label: "Default" },
                  ...displayModels.map((m) => ({ value: m.id, label: `${m.name} — ${m.description}` })),
                ]}
              />
            );
          })()}
          <p className="text-[10px] text-fg/30 mt-1.5">
            Models are polled directly from the selected CLI on load and refreshed while this page is open.
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
          <p className="font-medium text-fg/50">Authentication</p>
          <p>Claude Code uses your <code className="text-fg/50">ANTHROPIC_API_KEY</code> environment variable or OAuth login (run <code className="text-fg/50">claude</code> in terminal and type <code className="text-fg/50">/login</code>).</p>
          <p>Codex uses your <code className="text-fg/50">OPENAI_API_KEY</code> environment variable or OAuth login.</p>
          <p>OpenCode reads provider keys (<code className="text-fg/50">ANTHROPIC_API_KEY</code> / <code className="text-fg/50">OPENAI_API_KEY</code> / <code className="text-fg/50">GOOGLE_API_KEY</code>) and supports its own OAuth via <code className="text-fg/50">opencode auth login</code>.</p>
          <p>Gemini CLI uses your <code className="text-fg/50">GOOGLE_API_KEY</code> / <code className="text-fg/50">GEMINI_API_KEY</code> or Google OAuth (run <code className="text-fg/50">gemini auth</code>).</p>
          <p>API keys configured in the API Keys tab are also passed to the CLI automatically.</p>
        </div>
      </CardBody>
    </Card>
  );
}
