"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Award,
  Brain,
  Clock,
  Library,
  Sparkles,
  Upload,
  Zap,
} from "lucide-react";
import { motion, animate, useMotionValue, useTransform } from "motion/react";
import type { AiRun, CatalogSummary, ProjectListItem } from "@/lib/api";
import { formatCompactMoney, formatDateTime, formatMoney, formatPercent } from "@/lib/format";
import { getClientDisplayName } from "@/lib/client-display";
import { AIReviewQueue } from "@/components/ai-review-queue";
import { useAuth } from "@/components/auth-provider";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@/components/ui";
import { cn } from "@/lib/utils";

/* ──────────────────────────────────────────────────────────────────
   Helpers
─────────────────────────────────────────────────────────────────── */

type Stage = "active" | "won" | "lost" | "other";

const STAGE_LABEL: Record<Stage, string> = {
  active: "Active",
  won: "Won",
  lost: "Lost",
  other: "Other",
};

const STAGE_COLOR: Record<Stage, string> = {
  active: "rgb(59,130,246)",
  won: "rgb(16,185,129)",
  lost: "rgb(239,68,68)",
  other: "rgba(160,160,160,0.4)",
};

function statusToStage(status?: string): Stage {
  switch (status?.toLowerCase()) {
    case "open":
    case "pending":
      return "active";
    case "awarded":
    case "closed":
      return "won";
    case "didnotget":
    case "declined":
    case "cancelled":
      return "lost";
    default:
      return "other";
  }
}

function statusTone(status: string) {
  switch (status.toLowerCase()) {
    case "review":
      return "warning" as const;
    case "estimate":
    case "closed":
    case "awarded":
      return "success" as const;
    default:
      return "default" as const;
  }
}

function greetingFor(date: Date) {
  const h = date.getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Working late";
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function AnimatedNumber({
  value,
  format = (v: number) => Math.round(v).toLocaleString(),
  duration = 0.9,
  className,
}: {
  value: number;
  format?: (v: number) => string;
  duration?: number;
  className?: string;
}) {
  const mv = useMotionValue(0);
  const display = useTransform(mv, (v) => format(v));
  useEffect(() => {
    const controls = animate(mv, value, { duration, ease: [0.25, 1, 0.5, 1] });
    return controls.stop;
  }, [mv, value, duration]);
  return <motion.span className={className}>{display}</motion.span>;
}

/* ──────────────────────────────────────────────────────────────────
   Component
─────────────────────────────────────────────────────────────────── */

export function ProjectDashboard({
  projects,
  aiRuns,
  catalogs,
}: {
  projects: ProjectListItem[];
  aiRuns: AiRun[];
  catalogs: CatalogSummary[];
}) {
  const { user, organization } = useAuth();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const stats = useMemo(() => {
    const pipelineCount = projects.filter((p) => p.ingestionStatus !== "closed").length;
    const totalValue = projects.reduce((s, p) => s + (p.latestRevision?.subtotal ?? 0), 0);
    const totalProfit = projects.reduce((s, p) => s + (p.latestRevision?.estimatedProfit ?? 0), 0);
    const avgMargin = projects.length
      ? projects.reduce((s, p) => s + (p.latestRevision?.estimatedMargin ?? 0), 0) / projects.length
      : 0;

    const pendingAi = aiRuns.filter((r) => /pending|review|running/i.test(r.status)).length;

    const stale = projects.filter((p) => {
      const stage = statusToStage(p.quote?.status);
      return stage === "active" && daysSince(p.updatedAt ?? p.createdAt) > 14;
    });

    const recentlyWon = projects.filter((p) => {
      return statusToStage(p.quote?.status) === "won" && daysSince(p.updatedAt ?? p.createdAt) <= 30;
    });

    const stageCounts: Record<Stage, number> = { active: 0, won: 0, lost: 0, other: 0 };
    const stageValue: Record<Stage, number> = { active: 0, won: 0, lost: 0, other: 0 };
    for (const p of projects) {
      const s = statusToStage(p.quote?.status);
      stageCounts[s] += 1;
      stageValue[s] += p.latestRevision?.subtotal ?? 0;
    }

    const won = stageCounts.won;
    const decided = stageCounts.won + stageCounts.lost;
    const winRate = decided > 0 ? won / decided : 0;

    return {
      pipelineCount,
      totalValue,
      totalProfit,
      avgMargin,
      pendingAi,
      stale,
      recentlyWon,
      stageCounts,
      stageValue,
      winRate,
      decided,
      won,
    };
  }, [projects, aiRuns]);

  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const sa = statusToStage(a.quote?.status);
      const sb = statusToStage(b.quote?.status);
      if (sa !== sb) {
        if (sa === "active") return -1;
        if (sb === "active") return 1;
      }
      return new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime();
    });
  }, [projects]);

  const recentActivity = useMemo(() => {
    return [...projects]
      .sort((a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime())
      .slice(0, 6);
  }, [projects]);

  const stageMax = Math.max(1, ...Object.values(stats.stageCounts));

  return (
    <div className="flex flex-1 flex-col gap-6 min-h-0 overflow-y-auto pr-1">
      {/* Hero greeting */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="shrink-0"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" />
              <span className="text-[11px] font-medium uppercase tracking-wider text-accent">
                {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
              </span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-fg">
              {greetingFor(now)}{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
            </h1>
            <p className="mt-1 text-sm text-fg/50">
              {projects.length === 0
                ? "Upload a package to get started."
                : `${stats.pipelineCount} active in pipeline · ${formatCompactMoney(stats.stageValue.active)} live · ${stats.pendingAi} AI ${stats.pendingAi === 1 ? "run" : "runs"} awaiting review`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {organization && (
              <Badge className="text-xs">
                {organization.name}
              </Badge>
            )}
            <Button size="sm" asChild>
              <Link href="/intake">
                <Upload className="h-3.5 w-3.5" />
                New project
              </Link>
            </Button>
          </div>
        </div>
      </motion.div>

      {/* KPI strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          delay={0.04}
          label="Projects"
          value={projects.length}
          format={(v) => Math.round(v).toLocaleString()}
          sub={`${stats.pipelineCount} active`}
          accent="accent"
        />
        <KpiTile
          delay={0.08}
          label="Pipeline value"
          value={stats.totalValue}
          format={(v) => formatCompactMoney(v)}
          sub={`${formatCompactMoney(stats.totalProfit)} projected profit`}
          accent={stats.totalProfit >= 0 ? "success" : "danger"}
        />
        <KpiTile
          delay={0.12}
          label="Avg margin"
          value={stats.avgMargin * 100}
          format={(v) => `${v.toFixed(1)}%`}
          sub={stats.decided > 0 ? `${formatPercent(stats.winRate, 0)} win rate` : "—"}
          accent={stats.avgMargin >= 0 ? "success" : "danger"}
        />
        <KpiTile
          delay={0.16}
          label="AI runs"
          value={aiRuns.length}
          format={(v) => Math.round(v).toLocaleString()}
          sub={`${catalogs.length} ${catalogs.length === 1 ? "catalog" : "catalogs"}`}
          accent="accent"
        />
      </div>

      {/* Focus strip */}
      {projects.length > 0 && (
        <FocusStrip
          stale={stats.stale}
          recentlyWon={stats.recentlyWon}
          pendingAi={stats.pendingAi}
          activeValue={stats.stageValue.active}
          activeCount={stats.stageCounts.active}
        />
      )}

      {/* Pipeline visualizer */}
      {projects.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22, duration: 0.4 }}
        >
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Pipeline</CardTitle>
                <Link href="/performance" className="text-[11px] text-accent hover:underline inline-flex items-center gap-1">
                  Performance <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </CardHeader>
            <CardBody>
              <div className="grid gap-3 md:grid-cols-4">
                {(Object.keys(STAGE_LABEL) as Stage[]).map((stage, i) => {
                  const c = stats.stageCounts[stage];
                  const v = stats.stageValue[stage];
                  const pct = (c / stageMax) * 100;
                  return (
                    <motion.div
                      key={stage}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.25 + i * 0.05 }}
                      className="space-y-2"
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full" style={{ background: STAGE_COLOR[stage] }} />
                          <span className="font-medium uppercase tracking-wider text-fg/55">{STAGE_LABEL[stage]}</span>
                        </div>
                        <span className="text-fg/40 tabular-nums">{c}</span>
                      </div>
                      <div className="relative h-1.5 rounded-full bg-panel2/40 overflow-hidden">
                        <motion.div
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{ background: STAGE_COLOR[stage] }}
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.7, delay: 0.3 + i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                        />
                      </div>
                      <div className="text-sm font-semibold tabular-nums text-fg/85">
                        {formatCompactMoney(v)}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </CardBody>
          </Card>
        </motion.div>
      )}

      {/* Main grid: projects | sidebar */}
      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[1.4fr_0.6fr]">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28, duration: 0.4 }}
        >
          <Card className="h-full flex flex-col overflow-hidden">
            <CardHeader className="shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle>Projects</CardTitle>
                <Button size="xs" variant="ghost" asChild>
                  <Link href="/intake">
                    <Upload className="h-3 w-3" />
                    New
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardBody className="overflow-y-auto min-h-0 flex-1 px-2 py-2">
              {projects.length === 0 ? (
                <EmptyState>No projects yet. Upload a package to begin.</EmptyState>
              ) : (
                <div className="space-y-1.5">
                  {sortedProjects.map((project, i) => {
                    const stage = statusToStage(project.quote?.status);
                    const stageColor = STAGE_COLOR[stage];
                    const margin = project.latestRevision?.estimatedMargin ?? 0;
                    const subtotal = project.latestRevision?.subtotal ?? 0;
                    return (
                      <motion.div
                        key={project.id}
                        layout
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i * 0.025, 0.4), duration: 0.3, ease: "easeOut" }}
                        whileHover={{ y: -1 }}
                      >
                        <Link
                          href={`/projects/${project.id}`}
                          className="group relative flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 hover:border-line hover:bg-panel2/40 transition-colors"
                        >
                          <span
                            className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-full opacity-70 group-hover:opacity-100 transition-opacity"
                            style={{ background: stageColor }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-fg">{project.name}</span>
                              {project.quote?.status && (
                                <Badge tone={statusTone(project.quote.status)} className="text-[10px]">
                                  {project.quote.status}
                                </Badge>
                              )}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fg/40">
                              <span className="truncate">{getClientDisplayName(project, project.quote)}</span>
                              {project.location && (
                                <>
                                  <span>·</span>
                                  <span className="truncate">{project.location}</span>
                                </>
                              )}
                              {project.quote?.quoteNumber && (
                                <>
                                  <span>·</span>
                                  <span>{project.quote.quoteNumber}</span>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="hidden sm:flex items-center gap-5 text-right">
                            <div>
                              <div className="text-sm font-medium tabular-nums text-fg">{formatMoney(subtotal)}</div>
                              <div className="text-[10px] text-fg/35">subtotal</div>
                            </div>
                            <div>
                              <div className={cn(
                                "text-sm font-medium tabular-nums",
                                margin >= 0 ? "text-success" : "text-danger",
                              )}>
                                {formatPercent(margin, 0)}
                              </div>
                              <div className="text-[10px] text-fg/35">margin</div>
                            </div>
                            <ArrowRight className="h-3.5 w-3.5 text-fg/20 group-hover:text-fg/55 transition-colors" />
                          </div>
                        </Link>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </CardBody>
          </Card>
        </motion.div>

        {/* Sidebar */}
        <div className="space-y-5 min-h-0 flex flex-col">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.34, duration: 0.4 }}
          >
            <AIReviewQueue compact runs={aiRuns} />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.4 }}
          >
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Recent activity</CardTitle>
                  <Activity className="h-3.5 w-3.5 text-fg/30" />
                </div>
              </CardHeader>
              <CardBody className="space-y-0.5">
                {recentActivity.length === 0 ? (
                  <EmptyState>Nothing recent.</EmptyState>
                ) : (
                  recentActivity.map((p, i) => {
                    const stage = statusToStage(p.quote?.status);
                    return (
                      <motion.div
                        key={p.id}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.45 + i * 0.04 }}
                        className="relative flex items-start gap-2 px-1 py-1.5"
                      >
                        <span
                          className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: STAGE_COLOR[stage] }}
                        />
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/projects/${p.id}`}
                            className="block truncate text-xs font-medium text-fg/85 hover:text-accent transition-colors"
                          >
                            {p.name}
                          </Link>
                          <div className="text-[10px] text-fg/35">
                            {formatDateTime(p.updatedAt ?? p.createdAt)}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </CardBody>
            </Card>
          </motion.div>

          {catalogs.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.46, duration: 0.4 }}
            >
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Catalogs</CardTitle>
                    <Library className="h-3.5 w-3.5 text-fg/30" />
                  </div>
                </CardHeader>
                <CardBody className="space-y-1.5">
                  {catalogs.slice(0, 5).map((catalog, i) => (
                    <motion.div
                      key={catalog.id}
                      initial={{ opacity: 0, scale: 0.97 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.5 + i * 0.04 }}
                      className="flex items-center justify-between rounded-md bg-panel2/40 px-2.5 py-1.5"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-fg/85 truncate">{catalog.name}</div>
                        <div className="text-[10px] text-fg/35">{catalog.scope}</div>
                      </div>
                      <Badge className="text-[10px]">{catalog.kind.replace(/_/g, " ")}</Badge>
                    </motion.div>
                  ))}
                </CardBody>
              </Card>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   KPI tile
─────────────────────────────────────────────────────────────────── */

function KpiTile({
  label,
  value,
  format,
  sub,
  delay = 0,
  accent = "accent",
}: {
  label: string;
  value: number;
  format: (v: number) => string;
  sub?: string;
  delay?: number;
  accent?: "accent" | "success" | "danger";
}) {
  const accentBar =
    accent === "success" ? "bg-success/60"
    : accent === "danger" ? "bg-danger/60"
    : "bg-accent/60";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -2 }}
    >
      <Card className="h-full overflow-hidden relative">
        <span className={cn("absolute left-0 top-0 h-full w-0.5", accentBar)} />
        <CardBody className="py-3 pl-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-fg/45">{label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-fg">
            <AnimatedNumber value={value} format={format} />
          </div>
          {sub && <div className="mt-1 text-[11px] text-fg/40">{sub}</div>}
        </CardBody>
      </Card>
    </motion.div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Focus strip — actionable cards
─────────────────────────────────────────────────────────────────── */

function FocusStrip({
  stale,
  recentlyWon,
  pendingAi,
  activeValue,
  activeCount,
}: {
  stale: ProjectListItem[];
  recentlyWon: ProjectListItem[];
  pendingAi: number;
  activeValue: number;
  activeCount: number;
}) {
  const cards: Array<{
    key: string;
    icon: typeof Zap;
    label: string;
    value: string;
    sub: string;
    href: string;
    tone: "accent" | "warning" | "success" | "info";
    delay: number;
  }> = [];

  if (activeCount > 0) {
    cards.push({
      key: "active",
      icon: Zap,
      label: "Active pipeline",
      value: formatCompactMoney(activeValue),
      sub: `${activeCount} ${activeCount === 1 ? "quote" : "quotes"} in flight`,
      href: "/performance",
      tone: "info",
      delay: 0.18,
    });
  }
  if (stale.length > 0) {
    cards.push({
      key: "stale",
      icon: Clock,
      label: "Going stale",
      value: String(stale.length),
      sub: `Active >14 days · oldest ${daysSince(stale[0].updatedAt ?? stale[0].createdAt)}d`,
      href: stale[0] ? `/projects/${stale[0].id}` : "/",
      tone: "warning",
      delay: 0.22,
    });
  }
  if (pendingAi > 0) {
    cards.push({
      key: "ai",
      icon: Brain,
      label: "AI awaiting review",
      value: String(pendingAi),
      sub: pendingAi === 1 ? "1 run needs eyes" : `${pendingAi} runs need eyes`,
      href: "/",
      tone: "accent",
      delay: 0.26,
    });
  }
  if (recentlyWon.length > 0) {
    const wonValue = recentlyWon.reduce((s, p) => s + (p.latestRevision?.subtotal ?? 0), 0);
    cards.push({
      key: "won",
      icon: Award,
      label: "Won this month",
      value: formatCompactMoney(wonValue),
      sub: `${recentlyWon.length} ${recentlyWon.length === 1 ? "win" : "wins"}`,
      href: "/performance",
      tone: "success",
      delay: 0.3,
    });
  }

  if (cards.length === 0) return null;

  const toneClasses = {
    accent: "from-accent/15 to-accent/0 text-accent border-accent/20",
    warning: "from-warning/15 to-warning/0 text-warning border-warning/20",
    success: "from-success/15 to-success/0 text-success border-success/20",
    info: "from-accent/12 to-accent/0 text-accent border-accent/15",
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <motion.div
            key={c.key}
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: c.delay, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            whileHover={{ y: -2, scale: 1.01 }}
          >
            <Link href={c.href} className="block">
              <Card className={cn("relative overflow-hidden h-full bg-gradient-to-br", toneClasses[c.tone])}>
                <CardBody className="py-3.5 relative">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5" />
                        <span className="text-[10px] uppercase tracking-wider font-semibold">
                          {c.label}
                        </span>
                      </div>
                      <div className="mt-1.5 text-xl font-semibold tabular-nums text-fg">
                        {c.value}
                      </div>
                      <div className="mt-0.5 text-[11px] text-fg/55 truncate">{c.sub}</div>
                    </div>
                    <ArrowUpRight className="h-3.5 w-3.5 opacity-50" />
                  </div>
                </CardBody>
              </Card>
            </Link>
          </motion.div>
        );
      })}
    </div>
  );
}
