"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence, LayoutGroup, animate, useMotionValue, useTransform } from "motion/react";
import {
  Award,
  BarChart3,
  CheckCircle2,
  DollarSign,
  Filter,
  Percent,
  Sparkles,
  TrendingUp,
  Trophy,
  X,
  XCircle,
} from "lucide-react";
import type { ProjectListItem } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Select,
} from "@/components/ui";
import { formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

type Stage = "active" | "won" | "lost" | "other";

interface Filters {
  dateFrom: string;
  dateTo: string;
  status: string;
  client: string;
  stage: Stage | "";
}

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

function Sparkline({ values, color = "currentColor", height = 28 }: { values: number[]; color?: string; height?: number }) {
  const width = 80;
  if (values.length === 0) {
    return <svg width={width} height={height} className="opacity-30"><line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke={color} strokeWidth="1" strokeDasharray="2 2" /></svg>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return [x, y] as const;
  });
  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${path} L${width},${height} L0,${height} Z`;
  const last = points[points.length - 1];

  return (
    <svg width={width} height={height} className="overflow-visible">
      <motion.path d={area} fill={color} opacity={0.12} initial={{ opacity: 0 }} animate={{ opacity: 0.12 }} transition={{ duration: 0.5, delay: 0.2 }} />
      <motion.path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: "easeOut" }} />
      {last && <motion.circle cx={last[0]} cy={last[1]} r={2} fill={color} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.9 }} />}
    </svg>
  );
}

interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

function Donut({ segments, size = 180, total, centerLabel, centerValue }: { segments: DonutSegment[]; size?: number; total: number; centerLabel: string; centerValue: string }) {
  const radius = size / 2 - 8;
  const inner = radius * 0.62;
  const cx = size / 2;
  const cy = size / 2;
  const safeTotal = total || 1;
  let cumulative = 0;
  const slices = segments.filter((s) => s.value > 0).map((s) => {
    const frac = s.value / safeTotal;
    const start = cumulative;
    cumulative += frac;
    return { ...s, frac, start, end: cumulative };
  });

  function arcPath(start: number, end: number) {
    const a0 = start * Math.PI * 2 - Math.PI / 2;
    const a1 = end * Math.PI * 2 - Math.PI / 2;
    const large = end - start > 0.5 ? 1 : 0;
    const x0 = cx + radius * Math.cos(a0);
    const y0 = cy + radius * Math.sin(a0);
    const x1 = cx + radius * Math.cos(a1);
    const y1 = cy + radius * Math.sin(a1);
    const xi0 = cx + inner * Math.cos(a0);
    const yi0 = cy + inner * Math.sin(a0);
    const xi1 = cx + inner * Math.cos(a1);
    const yi1 = cy + inner * Math.sin(a1);
    return `M${x0},${y0} A${radius},${radius} 0 ${large} 1 ${x1},${y1} L${xi1},${yi1} A${inner},${inner} 0 ${large} 0 ${xi0},${yi0} Z`;
  }

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size}>
        {slices.map((s, i) => (
          <motion.path key={s.label} d={arcPath(s.start, s.end)} fill={s.color} initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.55, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }} style={{ transformOrigin: `${cx}px ${cy}px` }} />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="text-[10px] uppercase tracking-wider text-fg/40">{centerLabel}</div>
        <div className="text-xl font-semibold text-fg tabular-nums">{centerValue}</div>
      </div>
    </div>
  );
}

function Funnel({ stages }: { stages: Array<{ key: Stage; count: number; value: number; color: string }> }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div className="space-y-2">
      {stages.map((s, i) => {
        const pct = (s.count / max) * 100;
        return (
          <motion.div key={s.key} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i, duration: 0.4, ease: "easeOut" }} className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                <span className="font-medium text-fg/70">{STAGE_LABEL[s.key]}</span>
                <span className="text-fg/30">{s.count} {s.count === 1 ? "quote" : "quotes"}</span>
              </div>
              <span className="font-mono text-fg/60">{formatMoney(s.value)}</span>
            </div>
            <div className="relative h-2 rounded-full bg-panel2/40 overflow-hidden">
              <motion.div className="absolute inset-y-0 left-0 rounded-full" style={{ background: s.color }} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.7, delay: 0.1 + i * 0.05, ease: [0.16, 1, 0.3, 1] }} />
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function Histogram({ values }: { values: number[] }) {
  const bins = useMemo(() => {
    if (values.length === 0) return [];
    const buckets = [
      { label: "<0%", min: -Infinity, max: 0, count: 0, color: "rgb(239,68,68)" },
      { label: "0-10%", min: 0, max: 0.1, count: 0, color: "rgba(239,68,68,0.55)" },
      { label: "10-20%", min: 0.1, max: 0.2, count: 0, color: "rgba(245,158,11,0.65)" },
      { label: "20-30%", min: 0.2, max: 0.3, count: 0, color: "rgba(16,185,129,0.5)" },
      { label: "30-40%", min: 0.3, max: 0.4, count: 0, color: "rgba(16,185,129,0.7)" },
      { label: "40%+", min: 0.4, max: Infinity, count: 0, color: "rgba(16,185,129,0.95)" },
    ];
    for (const v of values) {
      const b = buckets.find((bb) => v >= bb.min && v < bb.max);
      if (b) b.count += 1;
    }
    return buckets;
  }, [values]);

  const max = Math.max(1, ...bins.map((b) => b.count));
  if (values.length === 0) return <EmptyState>No data for distribution.</EmptyState>;

  return (
    <div className="flex items-end gap-2 h-28">
      {bins.map((b, i) => {
        const h = (b.count / max) * 100;
        return (
          <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
            <div className="relative w-full flex-1 flex items-end">
              <motion.div initial={{ height: 0 }} animate={{ height: `${h}%` }} transition={{ duration: 0.6, delay: 0.05 * i, ease: [0.16, 1, 0.3, 1] }} className="w-full rounded-t" style={{ background: b.color, minHeight: b.count > 0 ? 2 : 0 }} title={`${b.label}: ${b.count}`} />
              {b.count > 0 && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 + 0.05 * i }} className="absolute -top-4 left-0 right-0 text-center text-[10px] font-medium text-fg/55 tabular-nums">{b.count}</motion.span>}
            </div>
            <span className="text-[9px] text-fg/40 tabular-nums">{b.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function Leaderboard({ items }: { items: Array<{ key: string; label: string; primary: number; secondary: number; tone: "success" | "danger" | "default" }> }) {
  const max = Math.max(1, ...items.map((i) => Math.abs(i.primary)));
  if (items.length === 0) return <EmptyState>No client data yet.</EmptyState>;
  return (
    <ol className="space-y-2">
      {items.map((item, i) => {
        const pct = (Math.abs(item.primary) / max) * 100;
        return (
          <motion.li key={item.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * i }} className="flex items-center gap-3">
            <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold", i === 0 ? "bg-amber-500/15 text-amber-500" : i === 1 ? "bg-zinc-400/15 text-zinc-400" : i === 2 ? "bg-amber-700/15 text-amber-700" : "bg-panel2 text-fg/45")}>
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-medium text-fg/85">{item.label}</span>
                <span className={cn("shrink-0 font-mono tabular-nums", item.tone === "success" ? "text-success" : item.tone === "danger" ? "text-danger" : "text-fg/65")}>
                  {formatMoney(item.primary)}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="relative h-1.5 flex-1 rounded-full bg-panel2/40 overflow-hidden">
                  <motion.div className={cn("absolute inset-y-0 left-0 rounded-full", item.tone === "success" ? "bg-success" : item.tone === "danger" ? "bg-danger" : "bg-accent")} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.7, delay: 0.05 * i, ease: [0.16, 1, 0.3, 1] }} />
                </div>
                <span className="text-[10px] tabular-nums text-fg/40 w-10 text-right">{item.secondary}</span>
              </div>
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}

function TimeSeries({ buckets }: { buckets: Array<{ key: string; label: string; count: number; value: number }> }) {
  const max = Math.max(1, ...buckets.map((b) => b.value));
  if (buckets.length === 0) return <EmptyState>No data over time yet.</EmptyState>;
  return (
    <div className="flex items-end gap-1 h-36 px-1">
      {buckets.map((b, i) => {
        const h = (b.value / max) * 100;
        return (
          <div key={b.key} className="group flex flex-1 flex-col items-center gap-1 cursor-default">
            <div className="relative w-full flex-1 flex items-end">
              <motion.div className="w-full rounded-sm bg-accent/60 group-hover:bg-accent transition-colors" initial={{ height: 0 }} animate={{ height: `${h}%` }} transition={{ duration: 0.7, delay: 0.025 * i, ease: [0.16, 1, 0.3, 1] }} style={{ minHeight: b.value > 0 ? 2 : 0 }} />
              <div className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-panel px-2 py-1 text-[10px] text-fg shadow-sm opacity-0 group-hover:opacity-100 transition-opacity z-10">
                <div className="font-medium">{b.label}</div>
                <div className="text-fg/55 tabular-nums">{formatMoney(b.value)} · {b.count}</div>
              </div>
            </div>
            <span className="text-[9px] text-fg/35 tabular-nums">{b.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function PerformanceDashboard({ projects }: { projects: ProjectListItem[] }) {
  const [filters, setFilters] = useState<Filters>({ dateFrom: "", dateTo: "", status: "", client: "", stage: "" });
  const clients = useMemo(() => {
    const set = new Set(projects.map((p) => p.clientName).filter(Boolean));
    return Array.from(set).sort();
  }, [projects]);

  const statuses = useMemo(() => {
    const set = new Set(projects.map((p) => p.quote?.status).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [projects]);

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (filters.status && p.quote?.status !== filters.status) return false;
      if (filters.client && p.clientName !== filters.client) return false;
      if (filters.stage && statusToStage(p.quote?.status) !== filters.stage) return false;
      if (filters.dateFrom) {
        if (new Date(p.createdAt) < new Date(filters.dateFrom)) return false;
      }
      if (filters.dateTo) {
        const to = new Date(filters.dateTo);
        to.setHours(23, 59, 59, 999);
        if (new Date(p.createdAt) > to) return false;
      }
      return true;
    });
  }, [projects, filters]);

  const kpis = useMemo(() => {
    const totalEstimatedValue = filtered.reduce((s, p) => s + (p.latestRevision?.subtotal ?? 0), 0);
    const totalEstimatedProfit = filtered.reduce((s, p) => s + (p.latestRevision?.estimatedProfit ?? 0), 0);
    const margins = filtered.map((p) => p.latestRevision?.estimatedMargin ?? 0).filter((m) => Number.isFinite(m));
    const avgMargin = margins.length > 0 ? margins.reduce((s, m) => s + m, 0) / margins.length : 0;
    const won = filtered.filter((p) => statusToStage(p.quote?.status) === "won").length;
    const lost = filtered.filter((p) => statusToStage(p.quote?.status) === "lost").length;
    const decided = won + lost;
    const winRate = decided > 0 ? won / decided : 0;
    return { totalEstimatedValue, totalEstimatedProfit, avgMargin, quoteCount: filtered.length, margins, won, decided, winRate };
  }, [filtered]);

  const stages = useMemo(() => {
    const init: Record<Stage, { count: number; value: number }> = {
      active: { count: 0, value: 0 },
      won: { count: 0, value: 0 },
      lost: { count: 0, value: 0 },
      other: { count: 0, value: 0 },
    };
    for (const p of filtered) {
      const s = statusToStage(p.quote?.status);
      init[s].count += 1;
      init[s].value += p.latestRevision?.subtotal ?? 0;
    }
    const list: Stage[] = ["active", "won", "lost", "other"];
    return list.map((k) => ({ key: k, count: init[k].count, value: init[k].value, color: STAGE_COLOR[k] }));
  }, [filtered]);

  const timeSeries = useMemo(() => {
    const map = new Map<string, { count: number; value: number; date: Date }>();
    for (const p of filtered) {
      const d = new Date(p.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const cur = map.get(key) ?? { count: 0, value: 0, date: new Date(d.getFullYear(), d.getMonth(), 1) };
      cur.count += 1;
      cur.value += p.latestRevision?.subtotal ?? 0;
      map.set(key, cur);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([key, v]) => ({
      key, count: v.count, value: v.value,
      label: v.date.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
    }));
  }, [filtered]);

  const topClients = useMemo(() => {
    const map = new Map<string, { value: number; profit: number; count: number }>();
    for (const p of filtered) {
      const k = p.clientName || "Unknown";
      const cur = map.get(k) ?? { value: 0, profit: 0, count: 0 };
      cur.value += p.latestRevision?.subtotal ?? 0;
      cur.profit += p.latestRevision?.estimatedProfit ?? 0;
      cur.count += 1;
      map.set(k, cur);
    }
    return Array.from(map.entries()).map(([key, v]) => ({
      key, label: key, primary: v.profit, secondary: v.count,
      tone: (v.profit >= 0 ? "success" : "danger") as "success" | "danger",
    })).sort((a, b) => Math.abs(b.primary) - Math.abs(a.primary)).slice(0, 8);
  }, [filtered]);

  const activeChips: Array<{ key: keyof Filters; label: string }> = [];
  if (filters.dateFrom) activeChips.push({ key: "dateFrom", label: `From ${filters.dateFrom}` });
  if (filters.dateTo) activeChips.push({ key: "dateTo", label: `To ${filters.dateTo}` });
  if (filters.status) activeChips.push({ key: "status", label: `Status: ${filters.status}` });
  if (filters.client) activeChips.push({ key: "client", label: `Client: ${filters.client}` });
  if (filters.stage) activeChips.push({ key: "stage", label: `Stage: ${STAGE_LABEL[filters.stage]}` });
  const hasFilters = activeChips.length > 0;

  return (
    <LayoutGroup>
      <div className="flex flex-col gap-6">
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" />
              <span className="text-[11px] font-medium uppercase tracking-wider text-accent">Performance</span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-fg">Pipeline & quote intelligence</h1>
            <p className="mt-1 text-sm text-fg/50">
              Live signal across {projects.length} project{projects.length === 1 ? "" : "s"}{hasFilters && " · filtered view"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="info" className="text-xs">{filtered.length} of {projects.length} quotes</Badge>
            {kpis.decided > 0 && (
              <Badge tone={kpis.winRate >= 0.5 ? "success" : kpis.winRate >= 0.3 ? "warning" : "danger"} className="text-xs">
                {formatPercent(kpis.winRate, 0)} win rate
              </Badge>
            )}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.4 }}>
          <Card>
            <CardBody className="py-2.5">
              <div className="flex items-center gap-2 overflow-x-auto">
                <div className="flex shrink-0 items-center gap-1.5 text-fg/50">
                  <Filter className="h-3.5 w-3.5" />
                  <span className="text-[10px] font-medium uppercase tracking-wider">Filters</span>
                </div>
                <span className="ml-1 shrink-0 text-[10px] uppercase tracking-wider text-fg/35">From</span>
                <Input type="date" className="h-7 w-32 shrink-0 text-[11px]" aria-label="From date" value={filters.dateFrom} onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} />
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-fg/35">To</span>
                <Input type="date" className="h-7 w-32 shrink-0 text-[11px]" aria-label="To date" value={filters.dateTo} onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} />
                <Select size="xs" className="w-28 shrink-0" ariaLabel="Stage" value={filters.stage || "__all__"} onValueChange={(v) => setFilters((f) => ({ ...f, stage: v === "__all__" ? "" : (v as Stage) }))} options={[{ value: "__all__", label: "All stages" }, { value: "active", label: "Active" }, { value: "won", label: "Won" }, { value: "lost", label: "Lost" }, { value: "other", label: "Other" }]} />
                <Select size="xs" className="w-32 shrink-0" ariaLabel="Status" value={filters.status || "__all__"} onValueChange={(v) => setFilters((f) => ({ ...f, status: v === "__all__" ? "" : v }))} options={[{ value: "__all__", label: "All statuses" }, ...statuses.map((s) => ({ value: s, label: s }))]} />
                <Select size="xs" className="w-40 shrink-0" ariaLabel="Client" value={filters.client || "__all__"} onValueChange={(v) => setFilters((f) => ({ ...f, client: v === "__all__" ? "" : v }))} options={[{ value: "__all__", label: "All clients" }, ...clients.map((c) => ({ value: c, label: c }))]} />
                {hasFilters && (
                  <Button variant="ghost" size="xs" className="shrink-0" onClick={() => setFilters({ dateFrom: "", dateTo: "", status: "", client: "", stage: "" })}>
                    Clear
                  </Button>
                )}
              </div>
              <AnimatePresence initial={false}>
                {hasFilters && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {activeChips.map((chip) => (
                        <motion.button key={chip.key} layout initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }} onClick={() => setFilters((f) => ({ ...f, [chip.key]: "" }))} className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/8 px-2.5 py-1 text-[11px] text-accent hover:bg-accent/15 transition-colors">
                          {chip.label}
                          <X className="h-3 w-3" />
                        </motion.button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </CardBody>
          </Card>
        </motion.div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiTile delay={0.05} icon={DollarSign} label="Pipeline value" value={kpis.totalEstimatedValue} format={(v) => formatMoney(v, 0)} tone="accent" sparkValues={timeSeries.map((b) => b.value)} />
          <KpiTile delay={0.1} icon={TrendingUp} label="Estimated profit" value={kpis.totalEstimatedProfit} format={(v) => formatMoney(v, 0)} tone={kpis.totalEstimatedProfit >= 0 ? "success" : "danger"} sparkValues={kpis.margins.map((m) => m * 100)} />
          <KpiTile delay={0.15} icon={Percent} label="Average margin" value={kpis.avgMargin * 100} format={(v) => `${v.toFixed(1)}%`} tone={kpis.avgMargin >= 0 ? "success" : "danger"} sparkValues={kpis.margins.map((m) => m * 100)} />
          <KpiTile delay={0.2} icon={kpis.winRate >= 0.5 ? Trophy : Award} label="Win rate" value={kpis.winRate * 100} format={(v) => `${v.toFixed(0)}%`} sub={`${kpis.won}/${kpis.decided || 0} decided`} tone={kpis.winRate >= 0.5 ? "success" : kpis.winRate >= 0.3 ? "accent" : "danger"} sparkValues={[kpis.won, Math.max(0, kpis.decided - kpis.won)]} />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.4 }}>
            <Card className="h-full">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Pipeline funnel</CardTitle>
                  <span className="text-[11px] text-fg/40">{filtered.length} {filtered.length === 1 ? "quote" : "quotes"}</span>
                </div>
              </CardHeader>
              <CardBody>
                <Funnel stages={stages} />
                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line/50 pt-3">
                  <FunnelStat icon={CheckCircle2} label="Won" value={kpis.won} sub={kpis.decided > 0 ? formatPercent(kpis.won / kpis.decided, 0) : "—"} tone="success" />
                  <FunnelStat icon={XCircle} label="Lost" value={Math.max(0, kpis.decided - kpis.won)} sub={kpis.decided > 0 ? formatPercent((kpis.decided - kpis.won) / kpis.decided, 0) : "—"} tone="danger" />
                  <FunnelStat icon={BarChart3} label="Active" value={stages.find((s) => s.key === "active")?.count ?? 0} sub={formatMoney(stages.find((s) => s.key === "active")?.value ?? 0, 0)} tone="info" />
                </div>
              </CardBody>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.4 }}>
            <Card className="h-full">
              <CardHeader><CardTitle>Status mix</CardTitle></CardHeader>
              <CardBody className="flex flex-col items-center">
                <Donut segments={stages.map((s) => ({ label: STAGE_LABEL[s.key], value: s.count, color: s.color }))} total={stages.reduce((s, st) => s + st.count, 0)} centerLabel="Total" centerValue={String(filtered.length)} />
                <div className="mt-4 grid w-full grid-cols-2 gap-2 text-[11px]">
                  {stages.map((s) => (
                    <div key={s.key} className="flex items-center gap-2 rounded-md bg-panel2/30 px-2 py-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                      <span className="text-fg/65">{STAGE_LABEL[s.key]}</span>
                      <span className="ml-auto font-mono text-fg/85">{s.count}</span>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          </motion.div>
        </div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.4 }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Pipeline over time</CardTitle>
                <span className="text-[11px] text-fg/40">last 12 months</span>
              </div>
            </CardHeader>
            <CardBody><TimeSeries buckets={timeSeries} /></CardBody>
          </Card>
        </motion.div>

        <div className="grid gap-4 lg:grid-cols-2">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.4 }}>
            <Card className="h-full">
              <CardHeader><CardTitle>Margin distribution</CardTitle></CardHeader>
              <CardBody><Histogram values={kpis.margins} /></CardBody>
            </Card>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45, duration: 0.4 }}>
            <Card className="h-full">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Top clients by profit</CardTitle>
                  <span className="text-[11px] text-fg/40">top 8</span>
                </div>
              </CardHeader>
              <CardBody><Leaderboard items={topClients} /></CardBody>
            </Card>
          </motion.div>
        </div>

      </div>
    </LayoutGroup>
  );
}

function KpiTile({
  icon: Icon, label, value, format, tone = "accent", delay = 0, sub, sparkValues = [],
}: {
  icon: typeof DollarSign; label: string; value: number; format: (v: number) => string;
  tone?: "accent" | "success" | "danger"; delay?: number; sub?: string; sparkValues?: number[];
}) {
  const toneClass = tone === "success" ? "bg-success/10 text-success border-success/20" : tone === "danger" ? "bg-danger/10 text-danger border-danger/20" : "bg-accent/10 text-accent border-accent/20";
  const sparkColor = tone === "success" ? "rgb(16,185,129)" : tone === "danger" ? "rgb(239,68,68)" : "rgb(59,130,246)";
  return (
    <motion.div initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay, duration: 0.5, ease: [0.16, 1, 0.3, 1] }} whileHover={{ y: -2 }}>
      <Card className="overflow-hidden h-full">
        <CardBody className="py-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium uppercase tracking-wider text-fg/45">{label}</p>
              <p className="mt-1.5 text-2xl font-semibold tabular-nums text-fg">
                <AnimatedNumber value={value} format={format} duration={1.0} />
              </p>
              {sub && <p className="mt-1 text-[11px] text-fg/45">{sub}</p>}
            </div>
            <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border", toneClass)}>
              <Icon className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-end" style={{ color: sparkColor }}>
            <Sparkline values={sparkValues} color={sparkColor} />
          </div>
        </CardBody>
      </Card>
    </motion.div>
  );
}

function FunnelStat({ icon: Icon, label, value, sub, tone }: { icon: typeof CheckCircle2; label: string; value: number; sub: string; tone: "success" | "danger" | "info" }) {
  const c = tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-accent";
  return (
    <div className="flex items-center gap-2 rounded-md bg-panel2/25 px-2.5 py-2">
      <Icon className={cn("h-3.5 w-3.5", c)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-1">
          <span className="text-[10px] uppercase tracking-wider text-fg/45">{label}</span>
          <span className="text-sm font-semibold text-fg tabular-nums">{value}</span>
        </div>
        <div className="text-[10px] text-fg/45 truncate">{sub}</div>
      </div>
    </div>
  );
}

