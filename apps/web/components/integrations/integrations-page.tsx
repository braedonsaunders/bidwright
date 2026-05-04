"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, CheckCircle2, Globe, Loader2, Plus, RefreshCw, Search, Settings, Webhook, X,
} from "lucide-react";
import {
  Badge, Button, Card, CardBody, CardHeader, CardTitle, Input,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  listManifests, listIntegrations, installIntegration, uninstallIntegration,
  testIntegration,
  type IntegrationSummary, type ManifestSummary,
} from "@/lib/api/integrations";
import { IntegrationDetailDrawer } from "./integration-detail-drawer";
import { CustomManifestModal } from "./custom-manifest-modal";

/**
 * Settings → Integrations subtab — separate from Plugins.
 *
 * Three views:
 *   - Browse:     catalog of available manifests (built-in + custom)
 *   - Installed:  current org instances with status + last-tested
 *   - Activity:   per-integration events log (rendered inside the detail drawer)
 */

type Tab = "browse" | "installed";

const CATEGORY_LABELS: Record<string, string> = {
  erp: "ERP",
  accounting: "Accounting",
  crm: "CRM",
  construction: "Construction PM",
  estimating: "Estimating",
  cad_bim: "CAD / BIM",
  pricing: "Pricing",
  sales: "Sales",
  documents: "Documents",
  comms: "Comms",
  compliance: "Compliance",
  identity: "Identity / SSO",
  storage: "Storage",
  other: "Other",
};

const STATUS_STYLES: Record<string, string> = {
  connected:   "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  needs_auth:  "bg-amber-500/15  text-amber-600  border-amber-500/30",
  error:       "bg-red-500/15    text-red-600    border-red-500/30",
  paused:      "bg-blue-500/15   text-blue-600   border-blue-500/30",
  disabled:    "bg-fg/10         text-fg/60      border-line",
};

export function IntegrationsPage() {
  const [tab, setTab] = useState<Tab>("installed");
  const [installed, setInstalled] = useState<IntegrationSummary[] | null>(null);
  const [manifests, setManifests] = useState<ManifestSummary[] | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCustomModal, setShowCustomModal] = useState(false);

  const refreshAll = async () => {
    try {
      setError(null);
      const [{ integrations }, { manifests: m }] = await Promise.all([
        listIntegrations(),
        listManifests(),
      ]);
      setInstalled(integrations);
      setManifests(m);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => { void refreshAll(); }, []);

  const filteredManifests = useMemo(() => {
    if (!manifests) return [];
    const q = search.trim().toLowerCase();
    return manifests.filter((m) => {
      if (category !== "all" && m.category !== category) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q)
        || m.description.toLowerCase().includes(q)
        || m.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [manifests, search, category]);

  const filteredInstalled = useMemo(() => {
    if (!installed) return [];
    const q = search.trim().toLowerCase();
    return installed.filter((i) => {
      if (category !== "all" && i.category !== category) return false;
      if (!q) return true;
      return (
        i.displayName.toLowerCase().includes(q)
        || i.description.toLowerCase().includes(q)
        || i.manifestId.toLowerCase().includes(q)
      );
    });
  }, [installed, search, category]);

  const handleInstall = async (manifestId: string) => {
    setInstalling(manifestId);
    setError(null);
    try {
      const created = await installIntegration({ manifestId, manifestSource: "builtin" });
      await refreshAll();
      setTab("installed");
      setOpenDetailId(created.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setInstalling(null);
    }
  };

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const m of manifests ?? []) set.add(m.category);
    for (const i of installed ?? []) set.add(i.category);
    return ["all", ...Array.from(set).sort()];
  }, [manifests, installed]);

  return (
    <div className="space-y-4">
      {/* Header tabs */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-line bg-panel2 p-1">
          <TabButton active={tab === "installed"} onClick={() => setTab("installed")}>
            Installed {installed ? <span className="ml-1 text-fg/50">{installed.length}</span> : null}
          </TabButton>
          <TabButton active={tab === "browse"} onClick={() => setTab("browse")}>
            Browse {manifests ? <span className="ml-1 text-fg/50">{manifests.length}</span> : null}
          </TabButton>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={refreshAll}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setShowCustomModal(true)}>
            <Plus className="h-3.5 w-3.5" /> Build your own
          </Button>
        </div>
      </div>

      {/* Search + category filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg/40" />
          <Input
            placeholder={tab === "browse" ? "Search NetSuite, Procore, Slack, QuickBooks…" : "Search installed integrations…"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs whitespace-nowrap transition-colors",
                category === c
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-line bg-panel2 text-fg/60 hover:text-fg",
              )}
            >
              {c === "all" ? "All" : (CATEGORY_LABELS[c] ?? c)}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-600">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
          <div className="flex-1">{error}</div>
          <button type="button" onClick={() => setError(null)}><X className="h-4 w-4" /></button>
        </div>
      ) : null}

      {/* Body */}
      {tab === "installed" ? (
        installed === null ? (
          <Loading />
        ) : filteredInstalled.length === 0 ? (
          <EmptyState
            title={installed.length === 0 ? "No integrations yet" : "No matches"}
            body={
              installed.length === 0
                ? "Browse the catalog to connect Bidwright to your other systems."
                : "Try a different filter."
            }
            cta={installed.length === 0 ? { label: "Browse catalog", onClick: () => setTab("browse") } : undefined}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filteredInstalled.map((i) => (
              <InstalledCard
                key={i.id}
                integration={i}
                onOpen={() => setOpenDetailId(i.id)}
                onTest={async () => {
                  await testIntegration(i.id);
                  await refreshAll();
                }}
                onUninstall={async () => {
                  if (!confirm(`Uninstall "${i.displayName}"? This removes credentials and history.`)) return;
                  await uninstallIntegration(i.id);
                  await refreshAll();
                }}
              />
            ))}
          </div>
        )
      ) : manifests === null ? (
        <Loading />
      ) : filteredManifests.length === 0 ? (
        <EmptyState title="No manifests match" body="Try a different search or category." />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredManifests.map((m) => (
            <ManifestCard
              key={m.id}
              manifest={m}
              installing={installing === m.id}
              onInstall={() => handleInstall(m.id)}
              alreadyInstalled={!!installed?.some((i) => i.manifestId === m.id)}
            />
          ))}
        </div>
      )}

      {/* Detail drawer */}
      {openDetailId ? (
        <IntegrationDetailDrawer
          integrationId={openDetailId}
          onClose={() => { setOpenDetailId(null); void refreshAll(); }}
          onChanged={refreshAll}
        />
      ) : null}

      {/* Custom manifest modal */}
      {showCustomModal ? (
        <CustomManifestModal
          onClose={() => setShowCustomModal(false)}
          onInstalled={async (id) => {
            setShowCustomModal(false);
            await refreshAll();
            setTab("installed");
            setOpenDetailId(id);
          }}
        />
      ) : null}
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────

function TabButton(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        props.active ? "bg-panel text-fg shadow-sm" : "text-fg/60 hover:text-fg",
      )}
    >
      {props.children}
    </button>
  );
}

function ManifestCard(props: {
  manifest: ManifestSummary;
  installing: boolean;
  onInstall: () => void;
  alreadyInstalled: boolean;
}) {
  const { manifest, installing, onInstall, alreadyInstalled } = props;
  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-line bg-panel2 text-fg/60">
            <Globe className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-sm">{manifest.name}</CardTitle>
            <div className="text-[11px] text-fg/50 mt-0.5">
              {manifest.vendor} · v{manifest.version} · {CATEGORY_LABELS[manifest.category] ?? manifest.category}
            </div>
          </div>
        </div>
        <Badge tone="default" className="text-[10px]">
          {manifest.authType}
        </Badge>
      </CardHeader>
      <CardBody>
        <p className="text-sm text-fg/70 line-clamp-3 min-h-[3em]">{manifest.description}</p>
        <div className="mt-3 flex items-center justify-between">
          <div className="text-xs text-fg/55">
            {manifest.capabilities.actions} action{manifest.capabilities.actions === 1 ? "" : "s"}
            {manifest.capabilities.triggers ? ` · ${manifest.capabilities.triggers} trigger${manifest.capabilities.triggers === 1 ? "" : "s"}` : ""}
            {manifest.capabilities.syncs ? ` · ${manifest.capabilities.syncs} sync${manifest.capabilities.syncs === 1 ? "" : "s"}` : ""}
          </div>
          <Button
            size="sm"
            variant={alreadyInstalled ? "ghost" : "default"}
            onClick={onInstall}
            disabled={installing}
          >
            {installing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : alreadyInstalled ? (
              "Install another"
            ) : (
              "Install"
            )}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function InstalledCard(props: {
  integration: IntegrationSummary;
  onOpen: () => void;
  onTest: () => Promise<void>;
  onUninstall: () => Promise<void>;
}) {
  const { integration: i, onOpen, onTest, onUninstall } = props;
  const [testing, setTesting] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const status = STATUS_STYLES[i.status] ?? STATUS_STYLES.disabled;
  return (
    <Card className="cursor-pointer" onClick={onOpen}>
      <CardHeader className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-line bg-panel2 text-fg/60">
            {i.category === "comms" ? <Webhook className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
          </div>
          <div>
            <CardTitle className="text-sm">{i.displayName}</CardTitle>
            <div className="text-[11px] text-fg/50 mt-0.5">
              {i.manifestId} · v{i.manifestVersion} · {CATEGORY_LABELS[i.category] ?? i.category}
            </div>
          </div>
        </div>
        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide", status)}>
          {i.status.replace("_", " ")}
        </span>
      </CardHeader>
      <CardBody>
        {i.lastError ? (
          <p className="text-xs text-red-600 line-clamp-2">{i.lastError}</p>
        ) : (
          <p className="text-sm text-fg/65 line-clamp-2">{i.description || "—"}</p>
        )}
        <div className="mt-3 flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
          <div className="text-xs text-fg/50">
            {i.lastConnectedAt ? `Connected ${timeAgo(i.lastConnectedAt)}` : "Not connected"}
          </div>
          <div className="flex gap-1">
            <Button
              size="xs"
              variant="ghost"
              onClick={async () => { setTesting(true); try { await onTest(); } finally { setTesting(false); } }}
              disabled={testing}
            >
              {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Test
            </Button>
            <Button size="xs" variant="ghost" onClick={onOpen}>
              <Settings className="h-3 w-3" /> Open
            </Button>
            <Button
              size="xs"
              variant="danger"
              onClick={async () => { setUninstalling(true); try { await onUninstall(); } finally { setUninstalling(false); } }}
              disabled={uninstalling}
            >
              Remove
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-10 text-fg/50">
      <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
    </div>
  );
}

function EmptyState(props: { title: string; body: string; cta?: { label: string; onClick: () => void } }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-panel2/40 p-8 text-center">
      <h3 className="text-sm font-medium">{props.title}</h3>
      <p className="text-sm text-fg/60 mt-1">{props.body}</p>
      {props.cta ? (
        <Button size="sm" className="mt-3" onClick={props.cta.onClick}>{props.cta.label}</Button>
      ) : null}
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
