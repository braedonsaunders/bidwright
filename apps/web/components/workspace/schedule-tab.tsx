"use client";

import { useMemo, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import type { ProjectWorkspaceData } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Separator,
} from "@/components/ui";
import { cn } from "@/lib/utils";

/* ─── Types ─── */

type ZoomLevel = "day" | "week" | "month";

/* ─── Helpers ─── */

const MS_PER_DAY = 86_400_000;

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function diffDays(a: Date, b: Date) {
  return Math.round((a.getTime() - b.getTime()) / MS_PER_DAY);
}

function formatShortDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatMonthYear(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function startOfWeek(d: Date) {
  const day = d.getDay();
  return addDays(d, -day);
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

const PHASE_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-pink-500",
];

/* ─── Component ─── */

export function ScheduleTab({ workspace }: { workspace: ProjectWorkspaceData }) {
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("week");
  const [scrollOffset, setScrollOffset] = useState(0);

  const phases = workspace.phases ?? [];
  const rev = workspace.currentRevision;

  /* ─── Timeline range ─── */

  const timelineRange = useMemo(() => {
    const rawStart = rev.dateWorkStart ? new Date(rev.dateWorkStart) : new Date();
    const rawEnd = rev.dateWorkEnd
      ? new Date(rev.dateWorkEnd)
      : addDays(rawStart, 90);

    // Add some padding
    const start = addDays(rawStart, -7 + scrollOffset);
    const end = addDays(rawEnd, 14 + scrollOffset);
    const totalDays = diffDays(end, start);

    return { start, end, totalDays, rawStart, rawEnd };
  }, [rev.dateWorkStart, rev.dateWorkEnd, scrollOffset]);

  /* ─── Phase bars ─── */

  const phaseBars = useMemo(() => {
    if (phases.length === 0) return [];

    const { rawStart, rawEnd } = timelineRange;
    const projectDuration = diffDays(rawEnd, rawStart);
    const phaseDuration = projectDuration > 0 ? Math.max(7, Math.floor(projectDuration / phases.length)) : 14;

    return phases.map((phase, idx) => {
      const phaseStart = addDays(rawStart, idx * phaseDuration);
      const phaseEnd = addDays(phaseStart, phaseDuration);

      return {
        ...phase,
        startDate: phaseStart,
        endDate: phaseEnd,
        color: PHASE_COLORS[idx % PHASE_COLORS.length],
      };
    });
  }, [phases, timelineRange]);

  /* ─── Timeline columns ─── */

  const columns = useMemo(() => {
    const { start, totalDays } = timelineRange;
    const cols: { date: Date; label: string; isToday: boolean }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (zoomLevel === "day") {
      for (let i = 0; i < Math.min(totalDays, 60); i++) {
        const d = addDays(start, i);
        cols.push({
          date: d,
          label: formatShortDate(d),
          isToday: diffDays(d, today) === 0,
        });
      }
    } else if (zoomLevel === "week") {
      let current = startOfWeek(start);
      const end = timelineRange.end;
      while (current < end && cols.length < 30) {
        cols.push({
          date: current,
          label: formatShortDate(current),
          isToday: today >= current && today < addDays(current, 7),
        });
        current = addDays(current, 7);
      }
    } else {
      let current = startOfMonth(start);
      const end = timelineRange.end;
      while (current < end && cols.length < 24) {
        cols.push({
          date: current,
          label: formatMonthYear(current),
          isToday:
            today.getFullYear() === current.getFullYear() &&
            today.getMonth() === current.getMonth(),
        });
        current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
      }
    }

    return cols;
  }, [timelineRange, zoomLevel]);

  /* ─── Bar position calculation ─── */

  function getBarStyle(startDate: Date, endDate: Date) {
    if (columns.length === 0) return { left: "0%", width: "0%" };

    const timelineStart = columns[0].date.getTime();
    const timelineEnd = columns[columns.length - 1].date.getTime();
    const timelineSpan = timelineEnd - timelineStart || 1;

    const barStart = Math.max(0, (startDate.getTime() - timelineStart) / timelineSpan);
    const barEnd = Math.min(1, (endDate.getTime() - timelineStart) / timelineSpan);
    const barWidth = Math.max(0.02, barEnd - barStart);

    return {
      left: `${(barStart * 100).toFixed(2)}%`,
      width: `${(barWidth * 100).toFixed(2)}%`,
    };
  }

  /* ─── Today marker position ─── */

  const todayPosition = useMemo(() => {
    if (columns.length === 0) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const timelineStart = columns[0].date.getTime();
    const timelineEnd = columns[columns.length - 1].date.getTime();
    const span = timelineEnd - timelineStart;
    if (span <= 0) return null;
    const pos = (today.getTime() - timelineStart) / span;
    if (pos < 0 || pos > 1) return null;
    return `${(pos * 100).toFixed(2)}%`;
  }, [columns]);

  /* ─── Render ─── */

  if (phases.length === 0) {
    return (
      <EmptyState>
        <Calendar className="mx-auto mb-3 h-10 w-10 text-fg/20" />
        <p className="text-sm font-medium text-fg/50">No phases defined</p>
        <p className="mt-1 text-xs text-fg/30">
          Add phases in the Phases sub-tab to generate a schedule view.
        </p>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      {/* ─── Toolbar ─── */}
      <div className="flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setScrollOffset((o) => o - (zoomLevel === "month" ? 30 : zoomLevel === "week" ? 7 : 1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setScrollOffset(0)}
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setScrollOffset((o) => o + (zoomLevel === "month" ? 30 : zoomLevel === "week" ? 7 : 1))}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>

        <Separator className="!h-6 !w-px" />

        {/* Zoom level toggle */}
        <div className="flex items-center gap-1 rounded-md bg-bg/50 p-0.5">
          {(["day", "week", "month"] as const).map((level) => (
            <button
              key={level}
              onClick={() => setZoomLevel(level)}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded transition-colors",
                zoomLevel === level
                  ? "bg-panel2 text-fg shadow-sm"
                  : "text-fg/40 hover:text-fg/60"
              )}
            >
              {level.charAt(0).toUpperCase() + level.slice(1)}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2 text-xs text-fg/40">
          <Calendar className="h-3.5 w-3.5" />
          <span>
            {rev.dateWorkStart
              ? formatShortDate(new Date(rev.dateWorkStart))
              : "TBD"}{" "}
            &mdash;{" "}
            {rev.dateWorkEnd
              ? formatShortDate(new Date(rev.dateWorkEnd))
              : "TBD"}
          </span>
        </div>
      </div>

      {/* ─── Gantt Chart ─── */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[800px]">
            {/* Timeline header */}
            <div className="flex border-b border-line bg-panel2/30">
              {/* Phase name column */}
              <div className="w-52 shrink-0 border-r border-line px-4 py-2">
                <span className="text-xs font-medium text-fg/50">Phase</span>
              </div>
              {/* Timeline columns */}
              <div className="relative flex flex-1">
                {columns.map((col, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "flex-1 border-r border-line/50 px-1 py-2 text-center",
                      col.isToday && "bg-accent/5"
                    )}
                    style={{ minWidth: zoomLevel === "day" ? 40 : zoomLevel === "week" ? 80 : 100 }}
                  >
                    <span className={cn("text-[11px]", col.isToday ? "font-medium text-accent" : "text-fg/40")}>
                      {col.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Phase rows */}
            {phaseBars.map((phase, idx) => (
              <div key={phase.id} className="flex border-b border-line/50 hover:bg-panel2/20 transition-colors">
                {/* Phase name */}
                <div className="w-52 shrink-0 border-r border-line px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className={cn("h-2.5 w-2.5 rounded-full", phase.color)} />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-fg/80">
                        {phase.number ? `${phase.number}. ` : ""}
                        {phase.name}
                      </p>
                      <p className="text-[11px] text-fg/30">
                        {formatShortDate(phase.startDate)} &ndash;{" "}
                        {formatShortDate(phase.endDate)}
                      </p>
                    </div>
                  </div>
                </div>
                {/* Bar area */}
                <div className="relative flex-1 py-2.5" style={{ minHeight: 44 }}>
                  {/* Grid lines */}
                  <div className="absolute inset-0 flex">
                    {columns.map((col, colIdx) => (
                      <div
                        key={colIdx}
                        className={cn(
                          "flex-1 border-r border-line/30",
                          col.isToday && "bg-accent/5"
                        )}
                        style={{ minWidth: zoomLevel === "day" ? 40 : zoomLevel === "week" ? 80 : 100 }}
                      />
                    ))}
                  </div>
                  {/* Today marker */}
                  {todayPosition && (
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-accent/60 z-10"
                      style={{ left: todayPosition }}
                    />
                  )}
                  {/* Phase bar */}
                  <div
                    className={cn(
                      "absolute top-2.5 h-5 rounded-md shadow-sm z-20 flex items-center px-2 cursor-grab",
                      phase.color,
                      "opacity-80 hover:opacity-100 transition-opacity"
                    )}
                    style={getBarStyle(phase.startDate, phase.endDate)}
                    title={`${phase.name}: ${formatShortDate(phase.startDate)} - ${formatShortDate(phase.endDate)}`}
                  >
                    <span className="truncate text-[10px] font-medium text-white drop-shadow-sm">
                      {phase.name}
                    </span>
                  </div>
                </div>
              </div>
            ))}

            {/* Summary row */}
            <div className="flex bg-panel2/20 border-t border-line">
              <div className="w-52 shrink-0 border-r border-line px-4 py-2.5">
                <span className="text-xs font-medium text-fg/50">
                  {phases.length} phase{phases.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="relative flex-1 py-2.5">
                <div className="absolute inset-0 flex">
                  {columns.map((col, colIdx) => (
                    <div
                      key={colIdx}
                      className="flex-1 border-r border-line/30"
                      style={{ minWidth: zoomLevel === "day" ? 40 : zoomLevel === "week" ? 80 : 100 }}
                    />
                  ))}
                </div>
                {todayPosition && (
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-accent/60 z-10"
                    style={{ left: todayPosition }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* ─── Legend ─── */}
      <div className="flex flex-wrap items-center gap-4 px-1">
        <div className="flex items-center gap-1.5 text-xs text-fg/40">
          <div className="h-3 w-0.5 rounded bg-accent/60" />
          <span>Today</span>
        </div>
        {phaseBars.map((phase) => (
          <div key={phase.id} className="flex items-center gap-1.5 text-xs text-fg/40">
            <div className={cn("h-3 w-3 rounded", phase.color, "opacity-80")} />
            <span>{phase.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
