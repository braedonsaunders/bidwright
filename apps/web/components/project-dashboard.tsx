"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Award,
  BarChart3,
  CalendarClock,
  CircleDollarSign,
  Clock,
  Gauge,
  Layers3,
  RadioTower,
  Sparkles,
  Upload,
  Zap,
} from "lucide-react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import type { ProjectListItem } from "@/lib/api";
import { formatCompactMoney, formatDateTime, formatPercent } from "@/lib/format";
import { useAuth } from "@/components/auth-provider";
import { Badge, Button, EmptyState } from "@/components/ui";
import { cn } from "@/lib/utils";

type Stage = "active" | "won" | "lost" | "other";
type Tone = "accent" | "success" | "warning" | "danger" | "info";

const STAGE_COLOR: Record<Stage, string> = {
  active: "rgb(59,130,246)",
  won: "rgb(16,185,129)",
  lost: "rgb(239,68,68)",
  other: "rgba(160,160,160,0.44)",
};

function statusToStage(status?: string): Stage {
  switch (status?.toLowerCase()) {
    case "open":
    case "pending":
    case "review":
    case "estimate":
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

function greetingKeyFor(date: Date) {
  const h = date.getHours();
  if (h < 5) return "late";
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  if (h < 21) return "evening";
  return "late";
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function formatInteger(v: number) {
  return Math.round(v).toLocaleString();
}

function AnimatedNumber({
  value,
  format = formatInteger,
  duration = 0.85,
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

export function ProjectDashboard({
  projects,
}: {
  projects: ProjectListItem[];
}) {
  const t = useTranslations("Dashboard");
  const { user, organization } = useAuth();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const stats = useMemo(() => {
    const stageCounts: Record<Stage, number> = { active: 0, won: 0, lost: 0, other: 0 };
    const stageValue: Record<Stage, number> = { active: 0, won: 0, lost: 0, other: 0 };

    for (const project of projects) {
      const stage = statusToStage(project.quote?.status);
      stageCounts[stage] += 1;
      stageValue[stage] += project.latestRevision?.subtotal ?? 0;
    }

    const totalValue = projects.reduce((sum, project) => sum + (project.latestRevision?.subtotal ?? 0), 0);
    const totalProfit = projects.reduce((sum, project) => sum + (project.latestRevision?.estimatedProfit ?? 0), 0);
    const avgMargin = projects.length
      ? projects.reduce((sum, project) => sum + (project.latestRevision?.estimatedMargin ?? 0), 0) / projects.length
      : 0;
    const stale = projects.filter((project) => {
      const stage = statusToStage(project.quote?.status);
      return stage === "active" && daysSince(project.updatedAt ?? project.createdAt) > 14;
    });
    const lowMargin = projects.filter((project) => {
      const margin = project.latestRevision?.estimatedMargin;
      return typeof margin === "number" && margin > 0 && margin < 0.12;
    });
    const recentlyWon = projects.filter((project) => {
      return statusToStage(project.quote?.status) === "won" && daysSince(project.updatedAt ?? project.createdAt) <= 30;
    });
    const decided = stageCounts.won + stageCounts.lost;
    const winRate = decided > 0 ? stageCounts.won / decided : 0;

    return {
      activeCount: stageCounts.active,
      avgMargin,
      decided,
      lowMargin,
      recentlyWon,
      stageCounts,
      stageValue,
      stale,
      totalProfit,
      totalValue,
      winRate,
    };
  }, [projects]);

  const recentQuotes = useMemo(() => {
    return [...projects]
      .filter((project) => project.quote)
      .sort((a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime())
      .slice(0, 4);
  }, [projects]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
        className="shrink-0"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <RadioTower className="h-4 w-4 text-accent" />
              <span className="text-[11px] font-medium uppercase tracking-wider text-accent">
                {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
              </span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-fg">
              {t(`greeting.${greetingKeyFor(now)}`)}{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {organization ? <Badge className="text-xs">{organization.name}</Badge> : null}
            <Button size="sm" asChild>
              <Link href="/intake">
                <Upload className="h-3.5 w-3.5" />
                {t("newIntake")}
              </Link>
            </Button>
          </div>
        </div>
      </motion.header>

      <div className="grid shrink-0 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCell
          delay={0.03}
          icon={CircleDollarSign}
          label={t("activeValue")}
          value={stats.stageValue.active}
          format={formatCompactMoney}
          sub={t("activeQuoteCount", { count: stats.activeCount })}
          tone="accent"
        />
        <MetricCell
          delay={0.06}
          icon={Gauge}
          label={t("averageMargin")}
          value={stats.avgMargin * 100}
          format={(value) => `${value.toFixed(1)}%`}
          sub={t("projectedProfit", { profit: formatCompactMoney(stats.totalProfit) })}
          tone={stats.avgMargin >= 0.18 ? "success" : stats.avgMargin >= 0.1 ? "warning" : "danger"}
        />
        <MetricCell
          delay={0.09}
          icon={Award}
          label={t("winRate")}
          value={stats.winRate * 100}
          format={(value) => `${Math.round(value)}%`}
          sub={stats.decided ? t("decidedQuotes", { count: stats.decided }) : t("noDecisionsYet")}
          tone="success"
        />
        <MetricCell
          delay={0.12}
          icon={AlertTriangle}
          label={t("exceptions")}
          value={stats.stale.length + stats.lowMargin.length}
          format={formatInteger}
          sub={t("exceptionSummary", { aging: stats.stale.length, margin: stats.lowMargin.length })}
          tone={stats.stale.length + stats.lowMargin.length > 0 ? "warning" : "success"}
        />
      </div>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1.62fr)_minmax(330px,0.78fr)]">
        <div className="grid min-h-0 gap-3 lg:grid-rows-[minmax(0,1fr)_minmax(150px,0.42fr)]">
          <PipelineMap projects={projects} stats={stats} />
          <BidQualityPanel stats={stats} />
        </div>

        <div className="grid min-h-0 gap-3 lg:grid-rows-[minmax(220px,0.72fr)_minmax(130px,0.38fr)]">
          <AttentionPanel stats={stats} />
          <QuotePulse quotes={recentQuotes} />
        </div>
      </div>
    </div>
  );
}

function MetricCell({
  delay,
  format,
  icon: Icon,
  label,
  sub,
  tone,
  value,
}: {
  delay: number;
  format: (value: number) => string;
  icon: typeof CircleDollarSign;
  label: string;
  sub: string;
  tone: Tone;
  value: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.28 }}
      className="relative overflow-hidden rounded-lg border border-line bg-panel px-3 py-2.5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg/45">
            <Icon className={cn("h-3.5 w-3.5", toneClass(tone))} />
            {label}
          </div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-fg">
            <AnimatedNumber value={value} format={format} />
          </div>
          <div className="mt-0.5 truncate text-[11px] text-fg/40">{sub}</div>
        </div>
        <span className={cn("mt-1 h-2 w-2 rounded-full", dotClass(tone))} />
      </div>
    </motion.div>
  );
}

function PipelineMap({
  projects,
  stats,
}: {
  projects: ProjectListItem[];
  stats: {
    stageCounts: Record<Stage, number>;
    stageValue: Record<Stage, number>;
    totalValue: number;
  };
}) {
  const t = useTranslations("Dashboard");
  const stages: Stage[] = ["active", "won", "lost", "other"];
  const maxValue = Math.max(1, ...stages.map((stage) => stats.stageValue[stage]));
  const visibleProjects = projects
    .filter((project) => project.quote)
    .sort((a, b) => (b.latestRevision?.subtotal ?? 0) - (a.latestRevision?.subtotal ?? 0))
    .slice(0, 16);

  return (
    <Panel className="relative min-h-0 overflow-hidden">
      <div className="relative z-10 flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Layers3 className="h-4 w-4 text-accent" />
            {t("pipelineTitle")}
          </div>
          <div className="mt-0.5 text-[11px] text-fg/40">{t("trackedValue", { value: formatCompactMoney(stats.totalValue) })}</div>
        </div>
        <Link href="/quotes" className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline">
          {t("quotes")} <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden p-4">
        <motion.div
          aria-hidden
          className="absolute inset-4 opacity-40 [background-image:linear-gradient(hsl(var(--fg)/0.07)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--fg)/0.05)_1px,transparent_1px)] [background-size:30px_30px]"
          animate={{ backgroundPosition: ["0px 0px", "60px 30px"] }}
          transition={{ duration: 22, repeat: Infinity, ease: "linear" }}
        />
        <motion.svg aria-hidden className="absolute inset-0 h-full w-full opacity-75" preserveAspectRatio="none" viewBox="0 0 900 420">
          <defs>
            <linearGradient id="pipeline-flow" x1="0" x2="1" y1="0" y2="0">
              <stop stopColor="hsl(var(--accent) / 0)" />
              <stop offset="0.45" stopColor="hsl(var(--accent) / 0.5)" />
              <stop offset="0.75" stopColor="hsl(169 62% 45% / 0.4)" />
              <stop offset="1" stopColor="hsl(214 84% 56% / 0)" />
            </linearGradient>
          </defs>
          {[98, 190, 282].map((y, index) => (
            <motion.path
              key={y}
              d={`M40 ${y} C190 ${y - 62} 285 ${y + 54} 430 ${y} S660 ${y - 38} 860 ${y + 32}`}
              fill="none"
              stroke="url(#pipeline-flow)"
              strokeLinecap="round"
              strokeWidth={index === 1 ? 2.6 : 1.7}
              strokeDasharray="34 210"
              animate={{ strokeDashoffset: [0, -480] }}
              transition={{ duration: 5.2 + index * 0.7, repeat: Infinity, ease: "linear" }}
            />
          ))}
        </motion.svg>

        {projects.length === 0 ? (
          <div className="relative z-10 flex h-full items-center justify-center">
            <EmptyState className="w-full max-w-md">{t("noPipeline")}</EmptyState>
          </div>
        ) : (
          <div className="relative z-10 grid h-full gap-3 md:grid-cols-4">
            {stages.map((stage, stageIndex) => {
              const count = stats.stageCounts[stage];
              const value = stats.stageValue[stage];
              const height = Math.max(12, (value / maxValue) * 100);
              const stageProjects = visibleProjects.filter((project) => statusToStage(project.quote?.status) === stage).slice(0, 5);
              return (
                <motion.div
                  key={stage}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.12 + stageIndex * 0.05, duration: 0.32 }}
                  className="flex min-h-0 flex-col rounded-lg border border-line/70 bg-bg/55 p-3 backdrop-blur"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg/50">
                        <span className="h-2 w-2 rounded-full" style={{ background: STAGE_COLOR[stage] }} />
                        {t(`stages.${stage}`)}
                      </div>
                      <div className="mt-1 text-lg font-semibold tabular-nums text-fg">{formatCompactMoney(value)}</div>
                    </div>
                    <div className="font-mono text-xs font-semibold text-fg/45">{count}</div>
                  </div>

                  <div className="mt-3 flex min-h-0 flex-1 gap-3">
                    <div className="relative w-2 overflow-hidden rounded-full bg-panel2">
                      <motion.div
                        className="absolute bottom-0 left-0 right-0 rounded-full"
                        style={{ background: STAGE_COLOR[stage] }}
                        initial={{ height: 0 }}
                        animate={{ height: `${height}%` }}
                        transition={{ delay: 0.25 + stageIndex * 0.06, duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
                      />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1 overflow-hidden">
                      {stageProjects.length === 0 ? (
                        <div className="rounded-md border border-dashed border-line px-2 py-4 text-center text-[11px] text-fg/30">{t("noQuotes")}</div>
                      ) : (
                        stageProjects.map((project, index) => {
                          const subtotal = project.latestRevision?.subtotal ?? 0;
                          const width = Math.max(18, Math.min(100, (subtotal / Math.max(1, value)) * 100));
                          return (
                            <Link key={project.id} href={`/projects/${project.id}`} className="block rounded-md px-2 py-1.5 transition-colors hover:bg-panel2/60">
                              <div className="truncate text-[11px] font-medium text-fg/75">{project.quote?.quoteNumber || project.name}</div>
                              <div className="mt-1 h-1 overflow-hidden rounded-full bg-panel2/70">
                                <motion.div
                                  className="h-full rounded-full"
                                  style={{ background: STAGE_COLOR[stage] }}
                                  initial={{ width: 0 }}
                                  animate={{ width: `${width}%` }}
                                  transition={{ delay: 0.35 + index * 0.04, duration: 0.45 }}
                                />
                              </div>
                            </Link>
                          );
                        })
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </Panel>
  );
}

function BidQualityPanel({
  stats,
}: {
  stats: {
    activeCount: number;
    avgMargin: number;
    lowMargin: ProjectListItem[];
    recentlyWon: ProjectListItem[];
    stale: ProjectListItem[];
    winRate: number;
  };
}) {
  const t = useTranslations("Dashboard");
  const marginPct = Math.max(0, Math.min(100, stats.avgMargin * 100));
  const winPct = Math.max(0, Math.min(100, stats.winRate * 100));

  return (
    <div className="grid min-h-0 gap-3 md:grid-cols-[0.92fr_1.08fr]">
      <Panel className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <BarChart3 className="h-4 w-4 text-success" />
            {t("bidQuality")}
          </div>
          <Badge tone={stats.lowMargin.length ? "warning" : "success"}>{stats.lowMargin.length ? t("watch") : t("clear")}</Badge>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <RadialMeter label={t("margin")} value={marginPct} display={`${marginPct.toFixed(1)}%`} tone="success" />
          <RadialMeter label={t("win")} value={winPct} display={`${Math.round(winPct)}%`} tone="accent" />
        </div>
      </Panel>

      <Panel className="p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Zap className="h-4 w-4 text-accent" />
          {t("operatingSignal")}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <SignalBlock label={t("active")} value={stats.activeCount} tone="accent" />
          <SignalBlock label={t("aging")} value={stats.stale.length} tone={stats.stale.length ? "warning" : "success"} />
          <SignalBlock label={t("won30d")} value={stats.recentlyWon.length} tone="success" />
        </div>
      </Panel>
    </div>
  );
}

function AttentionPanel({
  stats,
}: {
  stats: {
    lowMargin: ProjectListItem[];
    recentlyWon: ProjectListItem[];
    stale: ProjectListItem[];
  };
}) {
  const t = useTranslations("Dashboard");
  const attention = [
    stats.stale.length
      ? {
          key: "stale",
          icon: Clock,
          label: t("agingActiveWork"),
          value: String(stats.stale.length),
          detail: t("oldestDays", { days: daysSince(stats.stale[0].updatedAt ?? stats.stale[0].createdAt) }),
          tone: "warning" as Tone,
          href: `/projects/${stats.stale[0].id}`,
        }
      : null,
    stats.lowMargin.length
      ? {
          key: "margin",
          icon: AlertTriangle,
          label: t("marginUnder"),
          value: String(stats.lowMargin.length),
          detail: t("needsPricingReview"),
          tone: "danger" as Tone,
          href: `/projects/${stats.lowMargin[0].id}`,
        }
      : null,
    stats.recentlyWon.length
      ? {
          key: "won",
          icon: Award,
          label: t("wonThisMonth"),
          value: String(stats.recentlyWon.length),
          detail: t("recentDecisions"),
          tone: "success" as Tone,
          href: "/performance",
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <Panel className="flex min-h-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-fg">
          <AlertTriangle className="h-4 w-4 text-warning" />
          {t("attention")}
        </div>
        <Badge tone={attention.length ? "warning" : "success"}>{attention.length || t("clear")}</Badge>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-hidden p-3">
        {attention.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-line text-sm text-fg/35">
            {t("noUrgentExceptions")}
          </div>
        ) : (
          attention.slice(0, 4).map((item, index) => {
            const Icon = item.icon;
            return (
              <motion.div
                key={item.key}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.16 + index * 0.04 }}
              >
                <Link
                  href={item.href}
                  className="group flex items-center gap-3 rounded-lg border border-line/70 bg-bg/45 px-3 py-2.5 transition-colors hover:border-accent/25 hover:bg-panel2/45"
                >
                  <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-panel2", toneClass(item.tone))}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-fg/80">{item.label}</div>
                    <div className="mt-0.5 text-[10px] text-fg/35">{item.detail}</div>
                  </div>
                  <div className="font-mono text-lg font-semibold tabular-nums text-fg">{item.value}</div>
                </Link>
              </motion.div>
            );
          })
        )}
      </div>
    </Panel>
  );
}

function QuotePulse({ quotes }: { quotes: ProjectListItem[] }) {
  const t = useTranslations("Dashboard");
  return (
    <Panel className="flex min-h-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-fg">
          <CalendarClock className="h-4 w-4 text-accent" />
          {t("quotePulse")}
        </div>
        <Link href="/quotes" className="text-[11px] font-medium text-accent hover:underline">{t("all")}</Link>
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-hidden p-3">
        {quotes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-sm text-fg/35">{t("noRecentQuotes")}</div>
        ) : (
          quotes.map((quote) => {
            const stage = statusToStage(quote.quote?.status);
            return (
              <Link key={quote.id} href={`/projects/${quote.id}`} className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-panel2/50">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STAGE_COLOR[stage] }} />
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-fg/70 group-hover:text-fg">
                  {quote.quote?.quoteNumber || quote.name}
                </span>
                <span className="shrink-0 text-[10px] text-fg/35">{formatDateTime(quote.updatedAt ?? quote.createdAt)}</span>
              </Link>
            );
          })
        )}
      </div>
    </Panel>
  );
}

function RadialMeter({ display, label, tone, value }: { display: string; label: string; tone: Tone; value: number }) {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.max(0, Math.min(100, value)) / 100) * circumference;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line/70 bg-bg/45 px-3 py-2">
      <svg className="h-16 w-16 shrink-0 -rotate-90" viewBox="0 0 80 80" aria-hidden>
        <circle cx="40" cy="40" r={radius} fill="none" stroke="hsl(var(--line))" strokeWidth="7" />
        <motion.circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
          strokeLinecap="round"
          className={toneClass(tone)}
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div>
        <div className="text-lg font-semibold tabular-nums text-fg">{display}</div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-fg/40">{label}</div>
      </div>
    </div>
  );
}

function SignalBlock({ label, tone, value }: { label: string; tone: Tone; value: number }) {
  return (
    <div className="rounded-lg border border-line/70 bg-bg/45 px-3 py-2">
      <div className={cn("text-lg font-semibold tabular-nums", toneClass(tone))}>{value}</div>
      <div className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-wider text-fg/40">{label}</div>
    </div>
  );
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
      className={cn("rounded-lg border border-line bg-panel shadow-sm", className)}
    >
      {children}
    </motion.section>
  );
}

function toneClass(tone: Tone) {
  switch (tone) {
    case "success":
      return "text-success";
    case "warning":
      return "text-warning";
    case "danger":
      return "text-danger";
    case "info":
      return "text-blue-500";
    default:
      return "text-accent";
  }
}

function dotClass(tone: Tone) {
  switch (tone) {
    case "success":
      return "bg-success";
    case "warning":
      return "bg-warning";
    case "danger":
      return "bg-danger";
    case "info":
      return "bg-blue-500";
    default:
      return "bg-accent";
  }
}
