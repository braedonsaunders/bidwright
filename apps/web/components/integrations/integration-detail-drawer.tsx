"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, CheckCircle2, ClipboardCopy, Loader2, Play, Save, Trash2, Webhook, X,
} from "lucide-react";
import {
  Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, Label, Toggle,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  beginIntegrationOAuth, deleteIntegrationCredential, getIntegration,
  invokeIntegrationAction, listIntegrationEvents, listIntegrationRuns,
  setIntegrationCredential, testIntegration, updateIntegration,
  type IntegrationDetail, type IntegrationEvent, type IntegrationRun,
  type ManifestActionDescriptor, type ManifestField,
} from "@/lib/api/integrations";
import { ManifestFormFields } from "./manifest-form";

/**
 * Slide-over drawer for a single installed integration. Three internal tabs:
 *
 *   Configure — manifest-driven form (config + secrets + agent/MCP toggles)
 *   Actions   — invoke any action with a manifest-rendered input form
 *   Activity  — recent runs + inbound/outbound events with replay surface
 */

type Tab = "configure" | "actions" | "activity";

export function IntegrationDetailDrawer(props: {
  integrationId: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { integrationId, onClose, onChanged } = props;
  const [detail, setDetail] = useState<IntegrationDetail | null>(null);
  const [tab, setTab] = useState<Tab>("configure");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const d = await getIntegration(integrationId);
      setDetail(d);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => { void refresh(); }, [integrationId]);

  // Listen for the OAuth popup completion
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "bidwright:integration:connected" && e.data.integrationId === integrationId) {
        void refresh();
        onChanged?.();
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [integrationId, onChanged]);

  return (
    <div className="fixed inset-0 z-40 flex" onClick={onClose}>
      {/* Backdrop */}
      <div className="flex-1 bg-black/30" />

      {/* Panel */}
      <aside
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-[640px] max-w-full flex-col border-l border-line bg-panel shadow-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <div className="text-base font-semibold">
              {detail?.integration.displayName ?? "…"}
            </div>
            <div className="text-[11px] text-fg/55">
              {detail?.integration.manifestId} · v{detail?.integration.manifestVersion}
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-fg/60 hover:bg-panel2 hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="border-b border-line px-5 pt-2">
          <div className="flex gap-1">
            <DrawerTab active={tab === "configure"} onClick={() => setTab("configure")}>Configure</DrawerTab>
            <DrawerTab active={tab === "actions"} onClick={() => setTab("actions")}>Actions</DrawerTab>
            <DrawerTab active={tab === "activity"} onClick={() => setTab("activity")}>Activity</DrawerTab>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <div className="mb-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-600">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
              <div className="flex-1">{error}</div>
              <button onClick={() => setError(null)}><X className="h-4 w-4" /></button>
            </div>
          ) : null}
          {saved ? (
            <div className="mb-3 flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              {saved}
            </div>
          ) : null}

          {!detail ? (
            <div className="py-10 text-center text-fg/50">
              <Loader2 className="mx-auto h-4 w-4 animate-spin" />
            </div>
          ) : tab === "configure" ? (
            <ConfigureTab
              detail={detail}
              onChanged={async () => { await refresh(); onChanged?.(); }}
              setError={setError}
              setSaved={(m) => { setSaved(m); setTimeout(() => setSaved(null), 2_500); }}
            />
          ) : tab === "actions" ? (
            <ActionsTab detail={detail} setError={setError} />
          ) : (
            <ActivityTab integrationId={integrationId} setError={setError} />
          )}
        </div>
      </aside>
    </div>
  );
}

function DrawerTab(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        "rounded-t-md px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
        props.active ? "border-accent text-fg" : "border-transparent text-fg/55 hover:text-fg",
      )}
    >
      {props.children}
    </button>
  );
}

// ── Configure tab ─────────────────────────────────────────────────────────

function ConfigureTab(props: {
  detail: IntegrationDetail;
  onChanged: () => Promise<void>;
  setError: (m: string | null) => void;
  setSaved: (m: string) => void;
}) {
  const { detail, onChanged, setError, setSaved } = props;
  const fields = detail.manifest.connection.fields;
  const initialConfig = useMemo(() => ({ ...detail.integration.config }), [detail.integration.id]);
  const [values, setValues] = useState<Record<string, unknown>>(initialConfig);
  const [secretsToReplace, setSecretsToReplace] = useState<Record<string, boolean>>({});
  const [exposeAgent, setExposeAgent] = useState(detail.integration.exposeToAgent);
  const [exposeMcp, setExposeMcp] = useState(detail.integration.exposeToMcp);
  const [enabled, setEnabled] = useState(detail.integration.enabled);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [oauth, setOauth] = useState<{ clientId: string; clientSecret: string; redirectUri: string }>({
    clientId: "",
    clientSecret: "",
    redirectUri: typeof window !== "undefined"
      ? `${window.location.origin}/api/proxy/auth/integrations/oauth/callback`
      : "",
  });
  const [connecting, setConnecting] = useState(false);

  const credSet: Record<string, boolean> = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const c of detail.credentials) map[`__cred:${c.kind}`] = true;
    for (const f of fields) {
      if (f.type === "secret" && f.credentialKind) {
        map[f.key] = !!detail.credentials.find((c) => c.kind === f.credentialKind);
      }
    }
    return map;
  }, [detail.credentials, fields]);

  const isOAuth = detail.manifest.connection.auth.type === "oauth2";

  const handleSave = async () => {
    setSaving(true); setError(null);
    try {
      // Split secrets out of values into credential POSTs
      const config: Record<string, unknown> = {};
      const secretWrites: Array<{ kind: string; value: string }> = [];
      for (const f of fields) {
        if (f.type === "secret") {
          const v = values[f.key];
          if (typeof v === "string" && v.length > 0) {
            secretWrites.push({ kind: f.credentialKind ?? "api_key", value: v });
          }
        } else {
          if (values[f.key] !== undefined) config[f.key] = values[f.key];
        }
      }
      // Patch core integration first, then credentials
      await updateIntegration(detail.integration.id, {
        config,
        exposeToAgent: exposeAgent,
        exposeToMcp: exposeMcp,
        enabled,
      });
      for (const w of secretWrites) {
        await setIntegrationCredential(detail.integration.id, w);
      }
      setSaved("Saved");
      setSecretsToReplace({});
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const r = await testIntegration(detail.integration.id);
      setTestResult(r);
    } catch (e) {
      setTestResult({ success: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const handleOAuthConnect = async () => {
    setConnecting(true); setError(null);
    try {
      const { url } = await beginIntegrationOAuth(detail.integration.id, oauth);
      const w = window.open(url, "bidwright-oauth", "width=560,height=700");
      if (!w) {
        setError("Popup was blocked. Allow popups and retry.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="space-y-5">
      {detail.integration.status === "needs_auth" ? (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700">
          <AlertCircle className="h-4 w-4" />
          {isOAuth
            ? "Configure your OAuth client below, then click Connect."
            : "Provide credentials below to activate this integration."}
        </div>
      ) : null}

      {/* Manifest fields */}
      {fields.length > 0 ? (
        <Card>
          <CardHeader><CardTitle className="text-sm">Connection</CardTitle></CardHeader>
          <CardBody>
            <ManifestFormFields
              fields={fields}
              values={values}
              onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))}
              secretsAlreadySet={Object.fromEntries(
                fields
                  .filter((f) => f.type === "secret")
                  .map((f) => [f.key, !secretsToReplace[f.key] && credSet[f.key]]),
              )}
              onResetSecret={(k) => {
                setSecretsToReplace((s) => ({ ...s, [k]: true }));
                setValues((s) => ({ ...s, [k]: "" }));
              }}
            />
          </CardBody>
        </Card>
      ) : null}

      {/* OAuth client + connect */}
      {isOAuth ? (
        <Card>
          <CardHeader><CardTitle className="text-sm">OAuth client</CardTitle></CardHeader>
          <CardBody className="space-y-3">
            <div className="text-xs text-fg/60">
              You must register an OAuth app with the provider, then paste the client id / secret here.
              The redirect URL below must be allowlisted in the provider's app config.
            </div>
            <FieldRow label="Client ID" required>
              <Input value={oauth.clientId} onChange={(e) => setOauth((s) => ({ ...s, clientId: e.target.value }))} />
            </FieldRow>
            <FieldRow label="Client secret" required>
              <Input
                type="password"
                autoComplete="off"
                value={oauth.clientSecret}
                onChange={(e) => setOauth((s) => ({ ...s, clientSecret: e.target.value }))}
              />
            </FieldRow>
            <FieldRow label="Redirect URI">
              <CopyInput value={oauth.redirectUri} onChange={(v) => setOauth((s) => ({ ...s, redirectUri: v }))} />
            </FieldRow>
            <div className="flex justify-end">
              <Button size="sm" onClick={handleOAuthConnect} disabled={connecting || !oauth.clientId || !oauth.clientSecret}>
                {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Connect
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* Webhook URL when triggers exist */}
      {detail.manifest.capabilities.triggers.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Webhook className="h-4 w-4" /> Inbound webhook
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            <div className="text-xs text-fg/60">
              Configure the third-party tool to POST to this URL. Bidwright verifies the signature
              using the secret you saved above.
            </div>
            <CopyInput value={detail.webhookUrl} readOnly />
            {detail.manifest.capabilities.triggers.map((t) => (
              <div key={t.id} className="flex items-center gap-2 text-xs text-fg/55">
                <Badge tone="default" className="text-[10px]">{t.id}</Badge>
                <span>{t.description} · verify: {t.verify}</span>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      {/* Exposure */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Exposure</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          <ToggleRow
            label="Available to AI agent"
            help="Surface this integration's actions in the agent tool registry."
            checked={exposeAgent}
            onChange={setExposeAgent}
          />
          <ToggleRow
            label="Available over MCP"
            help="Expose this integration's actions to Claude Code / Cursor via the Bidwright MCP server."
            checked={exposeMcp}
            onChange={setExposeMcp}
          />
          <ToggleRow
            label="Enabled"
            help="Turn off without uninstalling. Disabled integrations are skipped by the agent and worker."
            checked={enabled}
            onChange={setEnabled}
          />
        </CardBody>
      </Card>

      {/* Save / test */}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
        <Button variant="secondary" onClick={handleTest} disabled={testing}>
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          Test connection
        </Button>
        {testResult ? (
          <span className={cn("text-xs", testResult.success ? "text-emerald-600" : "text-red-600")}>
            {testResult.message}
          </span>
        ) : null}
      </div>

      {/* Credentials list */}
      {detail.credentials.length > 0 ? (
        <Card>
          <CardHeader><CardTitle className="text-sm">Saved credentials</CardTitle></CardHeader>
          <CardBody>
            <ul className="divide-y divide-line">
              {detail.credentials.map((c) => (
                <li key={c.kind} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="font-mono text-xs">{c.kind}</div>
                    <div className="text-fg/55 text-[11px]">Encrypted · org-bound · {c.masked}</div>
                  </div>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={async () => {
                      if (!confirm(`Remove ${c.kind}?`)) return;
                      await deleteIntegrationCredential(detail.integration.id, c.kind);
                      await onChanged();
                    }}
                  >
                    <Trash2 className="h-3 w-3" /> Remove
                  </Button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function FieldRow(props: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{props.label}{props.required ? <span className="text-danger ml-0.5">*</span> : null}</Label>
      {props.children}
    </div>
  );
}

function ToggleRow(props: { label: string; help: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-sm font-medium">{props.label}</div>
        <div className="text-xs text-fg/55">{props.help}</div>
      </div>
      <Toggle checked={props.checked} onChange={props.onChange} />
    </div>
  );
}

function CopyInput(props: { value: string; readOnly?: boolean; onChange?: (v: string) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-1">
      <Input
        value={props.value}
        readOnly={props.readOnly}
        onChange={props.onChange ? (e) => props.onChange!(e.target.value) : undefined}
        className="font-mono text-xs"
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(props.value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1_500);
          } catch {}
        }}
      >
        {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

// ── Actions tab ───────────────────────────────────────────────────────────

function ActionsTab(props: { detail: IntegrationDetail; setError: (m: string | null) => void }) {
  const { detail, setError } = props;
  const actions = detail.manifest.capabilities.actions;
  const [openId, setOpenId] = useState<string | null>(actions[0]?.id ?? null);
  const open = actions.find((a) => a.id === openId) ?? null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {actions.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setOpenId(a.id)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs transition-colors",
              openId === a.id
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-line bg-panel2 text-fg/65 hover:text-fg",
            )}
          >
            {a.name}
          </button>
        ))}
      </div>
      {open ? <ActionForm key={open.id} integrationId={detail.integration.id} action={open} setError={setError} /> : null}
    </div>
  );
}

function ActionForm(props: { integrationId: string; action: ManifestActionDescriptor; setError: (m: string | null) => void }) {
  const { integrationId, action, setError } = props;
  const [input, setInput] = useState<Record<string, unknown>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<unknown>(null);

  const fields: ManifestField[] = action.input.map((p) => ({
    key: p.name,
    label: p.name,
    type: (p.type === "string"
      ? "string"
      : p.type === "number"
      ? "number"
      : p.type === "boolean"
      ? "boolean"
      : "json") as ManifestField["type"],
    required: p.required,
    helpText: p.description,
    default: p.default,
    options: p.enum ? p.enum.map((v) => ({ value: v, label: v })) : undefined,
  }));

  const run = async () => {
    setRunning(true); setError(null); setResult(null);
    try {
      const r = await invokeIntegrationAction(integrationId, action.id, input);
      if (!r.success) {
        setError(r.error ?? "Action failed");
      }
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{action.name}</CardTitle>
        <p className="text-xs text-fg/60 mt-1">{action.description}</p>
      </CardHeader>
      <CardBody className="space-y-3">
        {fields.length > 0 ? (
          <ManifestFormFields fields={fields} values={input} onChange={(k, v) => setInput((s) => ({ ...s, [k]: v }))} />
        ) : (
          <div className="text-xs text-fg/55">This action takes no inputs.</div>
        )}
        <div className="flex items-center gap-2">
          <Button onClick={run} disabled={running}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Invoke
          </Button>
          {action.requiresConfirmation ? (
            <span className="text-xs text-amber-600">Mutating — double-check before invoking.</span>
          ) : null}
        </div>
        {result !== null ? (
          <pre className="max-h-72 overflow-auto rounded-md border border-line bg-panel2 p-3 text-[11px]">
            {JSON.stringify(result, null, 2)}
          </pre>
        ) : null}
      </CardBody>
    </Card>
  );
}

// ── Activity tab ──────────────────────────────────────────────────────────

function ActivityTab(props: { integrationId: string; setError: (m: string | null) => void }) {
  const { integrationId, setError } = props;
  const [events, setEvents] = useState<IntegrationEvent[]>([]);
  const [runs, setRuns] = useState<IntegrationRun[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const [{ events: e }, { runs: r }] = await Promise.all([
        listIntegrationEvents(integrationId),
        listIntegrationRuns(integrationId),
      ]);
      setEvents(e); setRuns(r);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [integrationId]);

  if (loading) return <div className="py-8 text-center text-fg/55"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-2">Recent runs</h3>
        {runs.length === 0 ? (
          <div className="text-sm text-fg/55">No invocations yet.</div>
        ) : (
          <ul className="space-y-1.5">
            {runs.map((r) => (
              <li key={r.id} className="rounded-md border border-line bg-panel2 px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono">{r.actionId}</span>
                  <span className={cn(
                    "text-[10px] uppercase tracking-wide",
                    r.status === "success" ? "text-emerald-600" : r.status === "error" ? "text-red-600" : "text-fg/50",
                  )}>{r.status}</span>
                </div>
                <div className="text-fg/55 mt-0.5">
                  {new Date(r.startedAt).toLocaleString()} · {r.invokedBy}
                  {r.httpStatus ? ` · HTTP ${r.httpStatus}` : ""}
                  {r.durationMs ? ` · ${r.durationMs}ms` : ""}
                </div>
                {r.error ? <div className="mt-1 text-red-600">{r.error}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">Events</h3>
        {events.length === 0 ? (
          <div className="text-sm text-fg/55">No events yet.</div>
        ) : (
          <ul className="space-y-1.5">
            {events.map((e) => (
              <li key={e.id} className="rounded-md border border-line bg-panel2 px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono">{e.type}</span>
                  <span className={cn(
                    "text-[10px] uppercase tracking-wide",
                    e.status === "delivered" ? "text-emerald-600" : e.status === "failed" ? "text-red-600" : "text-fg/50",
                  )}>{e.status}</span>
                </div>
                <div className="text-fg/55 mt-0.5">
                  {e.direction === "inbound" ? "← incoming" : "→ outgoing"} · {new Date(e.createdAt).toLocaleString()}
                  {e.signatureValid !== null ? ` · sig ${e.signatureValid ? "ok" : "bad"}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
