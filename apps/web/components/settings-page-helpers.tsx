"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Plus, Search, X } from "lucide-react";

import { Button, Card, CardBody, CardHeader, CardTitle, Input, Label, Select } from "@/components/ui";
import { detectCli } from "@/lib/api";
import { cn } from "@/lib/utils";

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
  const [cliStatus, setCliStatus] = useState<{
    claude: { available: boolean; path: string; version?: string; auth: { authenticated: boolean; method: string }; models?: { id: string; name: string; description: string }[] };
    codex: { available: boolean; path: string; version?: string; auth: { authenticated: boolean; method: string }; models?: { id: string; name: string; description: string }[] };
    configured: { runtime: string | null; model: string | null };
  } | null>(null);
  const [detecting, setDetecting] = useState(true);

  useEffect(() => {
    setDetecting(true);
    detectCli()
      .then((result) => setCliStatus(result as any))
      .catch(() => setCliStatus(null))
      .finally(() => setDetecting(false));
  }, []);

  const currentRuntime = settings.integrations.agentRuntime || cliStatus?.configured?.runtime || "";
  const currentModel = settings.integrations.agentModel || cliStatus?.configured?.model || "";

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
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-md border border-line px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${cliStatus?.claude?.available ? "bg-success" : "bg-fg/20"}`} />
                  <span className="text-sm font-medium">Claude Code</span>
                  {cliStatus?.claude?.version && (
                    <span className="text-[10px] text-fg/30">{cliStatus.claude.version}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {cliStatus?.claude?.available ? (
                    <>
                      <span className="text-[10px] text-fg/40">{cliStatus.claude.path}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${cliStatus.claude.auth?.authenticated ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                        {cliStatus.claude.auth?.authenticated ? `Auth: ${cliStatus.claude.auth.method}` : "Not authenticated"}
                      </span>
                    </>
                  ) : (
                    <span className="text-[10px] text-fg/30">Not installed — run: npm i -g @anthropic-ai/claude-code</span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-md border border-line px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${cliStatus?.codex?.available ? "bg-success" : "bg-fg/20"}`} />
                  <span className="text-sm font-medium">Codex CLI</span>
                  {cliStatus?.codex?.version && (
                    <span className="text-[10px] text-fg/30">{cliStatus.codex.version}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {cliStatus?.codex?.available ? (
                    <>
                      <span className="text-[10px] text-fg/40">{cliStatus.codex.path}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${cliStatus.codex.auth?.authenticated ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                        {cliStatus.codex.auth?.authenticated ? `Auth: ${cliStatus.codex.auth.method}` : "Not authenticated"}
                      </span>
                    </>
                  ) : (
                    <span className="text-[10px] text-fg/30">Not installed — see openai.com/codex</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div>
          <Label>Preferred Runtime</Label>
          <Select
            value={currentRuntime}
            onChange={(e) => onUpdate({ agentRuntime: e.target.value || null })}
          >
            <option value="">Auto-detect (best available)</option>
            <option value="claude-code" disabled={!cliStatus?.claude?.available}>
              Claude Code CLI {!cliStatus?.claude?.available ? "(not installed)" : ""}
            </option>
            <option value="codex" disabled={!cliStatus?.codex?.available}>
              Codex CLI {!cliStatus?.codex?.available ? "(not installed)" : ""}
            </option>
          </Select>
        </div>

        <div>
          <Label>Model</Label>
          {(() => {
            const models = currentRuntime === "codex"
              ? (cliStatus?.codex?.models || [])
              : currentRuntime === "claude-code"
              ? (cliStatus?.claude?.models || [])
              : [...(cliStatus?.claude?.models || []), ...(cliStatus?.codex?.models || [])];
            const filtered = models.filter((m) => !m.id.startsWith("claude-") && !m.id.startsWith("gpt-5."));
            const displayModels = filtered.length > 0 ? filtered : models;
            return (
              <Select
                value={currentModel}
                onChange={(e) => onUpdate({ agentModel: e.target.value || null })}
              >
                <option value="">Default</option>
                {displayModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} — {m.description}</option>
                ))}
              </Select>
            );
          })()}
          <p className="text-[10px] text-fg/30 mt-1.5">Models detected from installed CLI runtimes. Change runtime above to see different models.</p>
        </div>

        <div>
          <Label>CLI Path Override (optional)</Label>
          <Input
            type="text"
            placeholder={currentRuntime === "codex" ? cliStatus?.codex?.path || "/usr/local/bin/codex" : cliStatus?.claude?.path || "/usr/local/bin/claude"}
            value={currentRuntime === "codex" ? settings.integrations.codexPath || "" : settings.integrations.claudeCodePath || ""}
            onChange={(e) => {
              if (currentRuntime === "codex") {
                onUpdate({ codexPath: e.target.value || null });
              } else {
                onUpdate({ claudeCodePath: e.target.value || null });
              }
            }}
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
            onChange={(e) => onUpdate({ maxConcurrentSubAgents: parseInt(e.target.value) })}
          >
            <option value="1">1 — Sequential (safest, slowest)</option>
            <option value="2">2 — Recommended</option>
            <option value="3">3 — Faster, higher rate limit risk</option>
            <option value="5">5 — Aggressive (may hit API rate limits)</option>
          </Select>
          <p className="mt-1 text-[11px] text-fg/40">How many worksheet sub-agents the AI runs in parallel. Lower values avoid Anthropic API rate limit errors; higher values finish faster.</p>
        </div>

        <div className="rounded-lg border border-line/50 bg-panel2/30 p-3 text-xs text-fg/40 space-y-1">
          <p className="font-medium text-fg/50">Authentication</p>
          <p>Claude Code uses your <code className="text-fg/50">ANTHROPIC_API_KEY</code> environment variable or OAuth login (run <code className="text-fg/50">claude</code> in terminal and type <code className="text-fg/50">/login</code>).</p>
          <p>Codex uses your <code className="text-fg/50">OPENAI_API_KEY</code> environment variable or OAuth login.</p>
          <p>API keys configured in the API Keys tab are also passed to the CLI automatically.</p>
        </div>
      </CardBody>
    </Card>
  );
}
