"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  DollarSign,
  Filter,
  Percent,
  TrendingUp,
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
  Separator,
} from "@/components/ui";
import { formatDate, formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/* ─── Types ─── */

interface Filters {
  dateFrom: string;
  dateTo: string;
  status: string;
  client: string;
}

/* ─── Component ─── */

export function PerformanceDashboard({ projects }: { projects: ProjectListItem[] }) {
  const [filters, setFilters] = useState<Filters>({
    dateFrom: "",
    dateTo: "",
    status: "",
    client: "",
  });

  /* ─── Derived data ─── */

  const clients = useMemo(() => {
    const set = new Set(projects.map((p) => p.clientName).filter(Boolean));
    return Array.from(set).sort();
  }, [projects]);

  const statuses = useMemo(() => {
    const set = new Set(projects.map((p) => p.quote.status).filter(Boolean));
    return Array.from(set).sort();
  }, [projects]);

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (filters.status && p.quote.status !== filters.status) return false;
      if (filters.client && p.clientName !== filters.client) return false;
      if (filters.dateFrom) {
        const from = new Date(filters.dateFrom);
        if (new Date(p.createdAt) < from) return false;
      }
      if (filters.dateTo) {
        const to = new Date(filters.dateTo);
        to.setHours(23, 59, 59, 999);
        if (new Date(p.createdAt) > to) return false;
      }
      return true;
    });
  }, [projects, filters]);

  /* ─── KPI calculations ─── */

  const kpis = useMemo(() => {
    const totalEstimatedValue = filtered.reduce(
      (sum, p) => sum + (p.latestRevision.subtotal ?? 0),
      0
    );
    const totalEstimatedProfit = filtered.reduce(
      (sum, p) => sum + (p.latestRevision.estimatedProfit ?? 0),
      0
    );
    const avgMargin =
      filtered.length > 0
        ? filtered.reduce(
            (sum, p) => sum + (p.latestRevision.estimatedMargin ?? 0),
            0
          ) / filtered.length
        : 0;
    return {
      totalEstimatedValue,
      totalEstimatedProfit,
      avgMargin,
      quoteCount: filtered.length,
    };
  }, [filtered]);

  /* ─── Chart data ─── */

  const chartData = useMemo(() => {
    return filtered
      .filter((p) => p.latestRevision.subtotal > 0)
      .slice(0, 20)
      .map((p) => ({
        id: p.id,
        label: p.quote.quoteNumber || p.name,
        margin: p.latestRevision.estimatedMargin ?? 0,
        profit: p.latestRevision.estimatedProfit ?? 0,
      }));
  }, [filtered]);

  const maxMargin = useMemo(() => {
    if (chartData.length === 0) return 1;
    return Math.max(...chartData.map((d) => Math.abs(d.margin)), 0.01);
  }, [chartData]);

  /* ─── Status badge tone ─── */

  function statusTone(status: string) {
    switch (status?.toLowerCase()) {
      case "awarded":
      case "closed":
        return "success" as const;
      case "open":
      case "pending":
        return "warning" as const;
      case "didnotget":
      case "declined":
      case "cancelled":
        return "danger" as const;
      default:
        return "default" as const;
    }
  }

  /* ─── Render ─── */

  return (
    <div className="space-y-6">
      {/* ─── Page header ─── */}
      <div>
        <h1 className="text-lg font-semibold text-fg">Performance</h1>
        <p className="mt-0.5 text-sm text-fg/50">
          Quote performance overview across all projects
        </p>
      </div>

      {/* ─── KPI Cards ─── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={DollarSign}
          label="Total Estimated Value"
          value={formatMoney(kpis.totalEstimatedValue)}
        />
        <KpiCard
          icon={TrendingUp}
          label="Total Estimated Profit"
          value={formatMoney(kpis.totalEstimatedProfit)}
          accent={kpis.totalEstimatedProfit >= 0}
        />
        <KpiCard
          icon={Percent}
          label="Average Margin"
          value={formatPercent(kpis.avgMargin)}
          accent={kpis.avgMargin >= 0}
        />
        <KpiCard
          icon={BarChart3}
          label="Quote Count"
          value={kpis.quoteCount.toString()}
        />
      </div>

      {/* ─── Filter Bar ─── */}
      <Card>
        <CardBody className="py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Filter className="h-4 w-4 text-fg/40" />
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-fg/50">From:</label>
              <Input
                type="date"
                className="h-8 w-40 text-xs"
                value={filters.dateFrom}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, dateFrom: e.target.value }))
                }
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-fg/50">To:</label>
              <Input
                type="date"
                className="h-8 w-40 text-xs"
                value={filters.dateTo}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, dateTo: e.target.value }))
                }
              />
            </div>
            <Select
              className="h-8 w-40 text-xs"
              value={filters.status}
              onChange={(e) =>
                setFilters((f) => ({ ...f, status: e.target.value }))
              }
            >
              <option value="">All Statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <Select
              className="h-8 w-48 text-xs"
              value={filters.client}
              onChange={(e) =>
                setFilters((f) => ({ ...f, client: e.target.value }))
              }
            >
              <option value="">All Clients</option>
              {clients.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            {(filters.dateFrom || filters.dateTo || filters.status || filters.client) && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() =>
                  setFilters({ dateFrom: "", dateTo: "", status: "", client: "" })
                }
              >
                Clear
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {/* ─── Chart: Margin % per Quote ─── */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Margin % by Quote</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="space-y-2">
              {chartData.map((d) => (
                <div key={d.id} className="flex items-center gap-3">
                  <span className="w-24 truncate text-xs text-fg/60">{d.label}</span>
                  <div className="relative flex-1 h-5 rounded bg-panel2/50">
                    <div
                      className={cn(
                        "absolute top-0 h-5 rounded transition-all",
                        d.margin >= 0 ? "bg-accent/70" : "bg-danger/60"
                      )}
                      style={{
                        width: `${Math.min(100, (Math.abs(d.margin) / maxMargin) * 100)}%`,
                      }}
                    />
                    <span className="absolute inset-0 flex items-center px-2 text-[11px] font-medium text-fg/80">
                      {formatPercent(d.margin)}
                    </span>
                  </div>
                  <span className="w-24 text-right text-xs text-fg/50">
                    {formatMoney(d.profit)}
                  </span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* ─── Table ─── */}
      <Card>
        <CardHeader>
          <CardTitle>Quote Details</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          {filtered.length === 0 ? (
            <CardBody>
              <EmptyState>No quotes match the current filters.</EmptyState>
            </CardBody>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-panel2/30 text-left">
                  <th className="px-4 py-2.5 text-xs font-medium text-fg/50">Quote #</th>
                  <th className="px-4 py-2.5 text-xs font-medium text-fg/50">Title</th>
                  <th className="px-4 py-2.5 text-xs font-medium text-fg/50">Client</th>
                  <th className="px-4 py-2.5 text-xs font-medium text-fg/50 text-right">
                    Est. Subtotal
                  </th>
                  <th className="px-4 py-2.5 text-xs font-medium text-fg/50 text-right">
                    Est. Profit
                  </th>
                  <th className="px-4 py-2.5 text-xs font-medium text-fg/50 text-right">
                    Est. Margin
                  </th>
                  <th className="px-4 py-2.5 text-xs font-medium text-fg/50">Status</th>
                  <th className="px-4 py-2.5 text-xs font-medium text-fg/50">Date</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-line/50 transition-colors hover:bg-panel2/20"
                  >
                    <td className="px-4 py-2.5 text-xs font-medium text-fg/80">
                      {p.quote.quoteNumber || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-fg/70 max-w-[200px] truncate">
                      {p.quote.title || p.name}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-fg/60">
                      {p.clientName || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-fg/70 text-right font-mono">
                      {formatMoney(p.latestRevision.subtotal)}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-2.5 text-xs text-right font-mono",
                        p.latestRevision.estimatedProfit >= 0
                          ? "text-success"
                          : "text-danger"
                      )}
                    >
                      {formatMoney(p.latestRevision.estimatedProfit)}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-2.5 text-xs text-right font-mono",
                        p.latestRevision.estimatedMargin >= 0
                          ? "text-success"
                          : "text-danger"
                      )}
                    >
                      {formatPercent(p.latestRevision.estimatedMargin)}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={statusTone(p.quote.status)}>
                        {p.quote.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-fg/50">
                      {formatDate(p.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>

              {/* Summary row */}
              <tfoot>
                <tr className="border-t border-line bg-panel2/30 font-medium">
                  <td className="px-4 py-2.5 text-xs text-fg/60" colSpan={3}>
                    Totals ({filtered.length} quote{filtered.length !== 1 ? "s" : ""})
                  </td>
                  <td className="px-4 py-2.5 text-xs text-fg/80 text-right font-mono">
                    {formatMoney(kpis.totalEstimatedValue)}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-2.5 text-xs text-right font-mono",
                      kpis.totalEstimatedProfit >= 0 ? "text-success" : "text-danger"
                    )}
                  >
                    {formatMoney(kpis.totalEstimatedProfit)}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-2.5 text-xs text-right font-mono",
                      kpis.avgMargin >= 0 ? "text-success" : "text-danger"
                    )}
                  >
                    {formatPercent(kpis.avgMargin)}
                  </td>
                  <td className="px-4 py-2.5" colSpan={2} />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}

/* ─── KPI Card ─── */

function KpiCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <Card>
      <CardBody className="py-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-fg/50">{label}</p>
            <p className="mt-1 text-xl font-semibold text-fg">{value}</p>
          </div>
          <div
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg",
              accent === false
                ? "bg-danger/10 text-danger"
                : accent === true
                  ? "bg-success/10 text-success"
                  : "bg-accent/10 text-accent"
            )}
          >
            <Icon className="h-4.5 w-4.5" />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
